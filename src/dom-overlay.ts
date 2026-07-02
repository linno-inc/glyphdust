/**
 * dom-overlay.ts — 実 DOM 文字との重ね合わせ／受け渡しのための幾何ユーティリティ。
 *
 *  - {@link viewSizeAtZ0}      … カメラから z=0 平面の可視ワールド幅・高さを求める（screen↔world 変換の素）。
 *  - {@link buildGlyphFromDOM} … 指定セレクタの DOM 要素の矩形・フォントから粒子ターゲットを生成。
 *                                粒子字形が実 DOM 文字とピクセル単位で重なる（クロスフェードで文字が動かない）。
 *  - {@link computeScreenRect} … 粒子ターゲット群の world 範囲を screen(px) 矩形へ変換。
 *                                フィナーレで実 DOM 文字を同位置・同サイズに合わせるのに使う。
 *
 * いずれも SSR セーフ（`document` / `window` 不在時は null を返す）。
 * グローバル変数や固定イベント名には依存しない（配信方法は呼び出し側が決める）。
 */

import type { Random } from "./sampling.js";

/** alpha がこの値を超えるピクセルを「塗り」とみなす。 */
const ALPHA_THRESHOLD = 128;

/** z=0 平面における可視ワールド寸法。 */
export interface ViewSize {
  worldW: number;
  worldH: number;
}

/**
 * カメラ（縦 fov / z=cameraZ）から、z=0 平面の可視ワールド幅・高さを返す。
 * screen(px) → world 変換のスケール算出に使う（等方: `worldW/viewportW === worldH/viewportH`）。
 */
export function viewSizeAtZ0(
  viewportW: number,
  viewportH: number,
  fovDeg: number,
  cameraZ: number,
): ViewSize {
  const worldH = 2 * Math.tan((fovDeg * Math.PI) / 360) * cameraZ;
  const worldW = worldH * (viewportW / viewportH);
  return { worldH, worldW };
}

/** {@link buildGlyphFromDOM} のオプション。 */
export interface DomGlyphOptions {
  /** 対象 DOM 要素のセレクタ（`document.querySelector`）。 */
  selector: string;
  /** カメラ縦 fov（度）。canvas が viewport 全面の sticky 前提。 */
  fovDeg: number;
  /** カメラ z 位置。 */
  cameraZ: number;
  /** CSS px に対する描画倍率（文字を太く拾うため高め）。既定 2。 */
  resolution?: number;
  /** ピクセル走査間隔。既定 2。 */
  step?: number;
  /** z 方向の厚み。既定 0.14。 */
  thickness?: number;
  /** ベースライン近似に使うアセント比（fontSize に対する）。既定 0.82。 */
  ascentRatio?: number;
  /**
   * 実際の canvas 表示サイズ（CSS px）。省略時は window.innerWidth/Height。
   * 縦スクロールバーがあると innerWidth と canvas 幅が数 px ずれ、
   * 画面→ワールド変換が狂って粒子字形が横にずれる。整列には canvas 実寸を渡す。
   */
  viewportW?: number;
  viewportH?: number;
  /** 乱数生成器（ジッタ用）。既定 `Math.random`。 */
  random?: Random;
}

/**
 * 指定セレクタの DOM 要素の画面矩形・computed フォントから粒子ターゲットを生成する。
 * - 要素の rect / computed font をそのまま使い、同サイズのオフスクリーン Canvas に行を描画。
 * - 各塗りピクセルを「画面座標(px)」→「ワールド座標(z=0平面)」へ変換。
 *   → 粒子字形が DOM 要素とピタリ重なり、クロスフェード中に文字が動かない。
 * - 要素が無い / 小さすぎる / 塗りが 0 のときは null（呼び出し側でフォールバック）。
 *
 * @param count 粒子数（戻り値は `count * 3` の Float32Array）
 * @param lines 描画する行（要素のテキストを行分割したもの。文言は呼び出し側が決める）
 */
export function buildGlyphFromDOM(
  count: number,
  lines: string[],
  opts: DomGlyphOptions,
): Float32Array | null {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }
  const el = document.querySelector(opts.selector);
  if (!el) return null;

  const elRect = el.getBoundingClientRect();
  if (elRect.width < 2 || elRect.height < 2) return null;

  const random = opts.random ?? Math.random;
  const cs = window.getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 64;
  // line-height は "normal" の場合があるので算出。
  let lineHeight = parseFloat(cs.lineHeight);
  if (!isFinite(lineHeight) || lineHeight <= 0) lineHeight = fontSize * 1.1;
  const letterSpacing = parseFloat(cs.letterSpacing) || 0;
  const fontWeight = cs.fontWeight || "600";
  const fontFamily = cs.fontFamily || "sans-serif";

  // 「実際に描画されたテキスト」の画面矩形を Range から取る。要素が display:flex や
  // 中央寄せ・padding 付きの大きな箱でも、文字が実際に載っている場所へ粒子を合わせられる。
  // 旧方式（要素ボックス左上を原点に描画）は、全画面 flex 箱などでテキストは中央なのに
  // 粒子だけ左上へ大きくズレる footgun だった（AIエージェントは要素の作り方を選べない前提で
  //  吸収する。提案者: 凜さん 2026-07-01）。Range 不可時のみ要素矩形へフォールバック。
  let rect: DOMRect = elRect;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tr = range.getBoundingClientRect();
    if (tr.width >= 2 && tr.height >= 2) rect = tr;
  } catch {
    /* Range 不可 → 要素矩形のまま */
  }

  // Range 矩形はテキストにタイトなので、画面原点＝テキスト左上。
  const contentLeft = rect.left;
  const contentTop = rect.top;
  const cwCss = rect.width;

  const res = opts.resolution ?? 2;
  const cw = Math.max(2, Math.ceil(rect.width * res));
  const ch = Math.max(2, Math.ceil(rect.height * res));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, cw, ch);
  ctx.scale(res, res); // 以降は CSS px 座標で描く
  ctx.fillStyle = "#000";
  // 各行を canvas 幅の中央に描く。Range 矩形は実描画テキストにタイトなため、単一行は
  // ぴったり充填し、複数行の中央寄せ（text-align:center や flex 中央）とも一致する。
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  if ("letterSpacing" in ctx) {
    try {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
        `${letterSpacing}px`;
    } catch {
      /* 一部ブラウザ非対応。無視 */
    }
  }

  // ベースライン位置をブラウザの実描画に正確に合わせる。
  // Range.getBoundingClientRect が返す矩形は「字形ボックス」（fontAscent+fontDescent、
  // half-leading を含まない）— 実測で rect.height === fbAsc+fbDesc（Chrome）。
  // したがって矩形上端からのベースラインは単純に `fbAsc`（+ 行送り）。
  // 旧式は矩形上端を「行ボックス上端」とみなして half-leading
  // `(lineHeight - (fbAsc+fbDesc))/2` を足しており、line-height がフォント実高さ
  // （Helvetica ≈1.194em）から離れるほど縦にずれた（例: line-height:1 × 192px の
  // コーポレートサイトワードマークで -18.7px、粒子が実文字より上に浮いた。
  // 発見: 凜さん 2026-07-03「パーティクルとテキストがずれています」）。
  // フォントの実アセントは canvas の measureText から取得する
  // （近似 ascentRatio=0.82 では実フォントと数 px ずれ、DOM 整列が崩れるため）。
  const fm = ctx.measureText(lines[0] ?? "M");
  const fbAsc = fm.fontBoundingBoxAscent;
  const useMetrics = Number.isFinite(fbAsc);
  const fallbackAscent = fontSize * (opts.ascentRatio ?? 0.82);
  lines.forEach((line, i) => {
    const lineTop = i * lineHeight;
    const baseline = useMetrics
      ? lineTop + fbAsc
      : lineTop + fallbackAscent;
    ctx.fillText(line, cwCss / 2, baseline);
  });

  const { data } = ctx.getImageData(0, 0, cw, ch);
  const pts: number[] = [];
  const step = opts.step ?? 2;
  for (let y = 0; y < ch; y += step) {
    for (let x = 0; x < cw; x += step) {
      if (data[(y * cw + x) * 4 + 3]! > ALPHA_THRESHOLD) pts.push(x, y);
    }
  }
  const filled = pts.length / 2;
  if (filled === 0) return null;

  // 画面(px) → ワールド(z=0) 変換係数。canvas は sticky で viewport 全面。
  // スクロールバー分のズレを避けるため、可能なら canvas 実寸を使う。
  const vpW = opts.viewportW ?? window.innerWidth;
  const vpH = opts.viewportH ?? window.innerHeight;
  const { worldW, worldH } = viewSizeAtZ0(vpW, vpH, opts.fovDeg, opts.cameraZ);
  const pxToWorld = worldW / vpW; // = worldH / vpH（等方）
  const thickness = opts.thickness ?? 0.14;

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const idx =
      (Math.floor((i / count) * filled) + ((i * 2654435761) % filled)) % filled;
    const cx = pts[idx * 2]! / res; // canvas → CSS px（コンテンツ原点）
    const cy = pts[idx * 2 + 1]! / res;

    // CSS px（画面絶対座標）。
    const sx = contentLeft + cx;
    const sy = contentTop + cy;

    // 画面 → ワールド（中央原点・y上向き）。
    const wx = (sx / vpW - 0.5) * worldW;
    const wy = -(sy / vpH - 0.5) * worldH;

    // 格子感を消す微小ジッタ + 薄い厚み。
    out[i * 3] = wx + (random() - 0.5) * pxToWorld * step;
    out[i * 3 + 1] = wy + (random() - 0.5) * pxToWorld * step;
    out[i * 3 + 2] = (random() - 0.5) * thickness;
  }
  return out;
}

/** {@link alignGlyphOverlay} のオプション。 */
export interface AlignGlyphOverlayOptions {
  /** 重ねる 1 行テキスト（`\n` は呼び出し側で除去しておく）。 */
  text: string;
  /** 粒子サンプリングに使った font 文字列（weight / family を抽出する）。 */
  font: string;
  /** canvas の実表示サイズ（CSS px）。 */
  viewportW: number;
  viewportH: number;
  /** z=0 平面の可視ワールド幅（{@link viewSizeAtZ0} の `worldW`）。 */
  visibleWorldW: number;
}

/**
 * 実テキスト要素を「粒子ターゲット群の字形」へピクセル整列させる
 * （left/top/font-size/font-family/font-weight を直接設定する）。
 *
 * 字送り幅(advance)ではなく「実際のインク範囲」をオフスクリーン canvas でピクセル走査し、
 * インクの中心を粒子グリフ矩形の中心へ合わせる（L と O など左右ベアリングが非対称な語は
 * advance 基準だと横にズレる）。morphTo ストリーミングの「本物のテキストへ解決」で使う
 * （提案者: 凜さん 2026-07-02「ちゃんとしたテキストに収束するように」。
 * アルゴリズムは GlyphPoints.positionOverlay と同一）。
 *
 * @returns 整列できたら true（rect 算出不能・SSR では false）。
 */
export function alignGlyphOverlay(
  el: HTMLElement,
  targets: Float32Array,
  opts: AlignGlyphOverlayOptions,
): boolean {
  if (typeof document === "undefined") return false;
  const rect = computeScreenRect(
    targets,
    opts.viewportW,
    opts.viewportH,
    opts.visibleWorldW,
  );
  if (!rect || rect.width < 2 || rect.height < 2) return false;

  // font 文字列（例 "900 260px 'Helvetica Neue', Helvetica, sans-serif"）から weight / family。
  const fontMatch = opts.font.match(/^\s*(\d+)\s+[\d.]+px\s+(.+)$/);
  const fontWeight = fontMatch?.[1] ?? "900";
  const fontFamily = fontMatch?.[2] ?? "sans-serif";
  const text = opts.text;
  const ctx = document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });

  let positioned = false;
  if (ctx && text) {
    // 1) 基準サイズで描いて塗りピクセルの bbox を実測。
    const baseSize = 200;
    ctx.font = `${fontWeight} ${baseSize}px ${fontFamily}`;
    const advBase = ctx.measureText(text).width;
    const pad = Math.ceil(baseSize * 0.6);
    const cw = Math.ceil(advBase + pad * 2);
    const ch = Math.ceil(baseSize * 1.8);
    const oc = document.createElement("canvas");
    oc.width = cw;
    oc.height = ch;
    const octx = oc.getContext("2d", { willReadFrequently: true });
    if (octx && cw > 0 && ch > 0) {
      const drawX = pad;
      const drawY = Math.round(ch * 0.72);
      octx.font = `${fontWeight} ${baseSize}px ${fontFamily}`;
      octx.textAlign = "left";
      octx.textBaseline = "alphabetic";
      octx.fillStyle = "#000";
      octx.fillText(text, drawX, drawY);
      const data = octx.getImageData(0, 0, cw, ch).data;
      let minX = cw;
      let maxX = 0;
      let minY = ch;
      let maxY = 0;
      let found = 0;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          if (data[(y * cw + x) * 4 + 3]! > 20) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            found++;
          }
        }
      }
      if (found > 0 && maxX > minX) {
        // 2) インク幅を粒子グリフ幅に合わせて fontSize を決定。
        const fontSize = baseSize * (rect.width / (maxX - minX));
        const scale = fontSize / baseSize;
        const inkCenterXFromStart = ((minX + maxX) / 2 - drawX) * scale;
        const inkCenterYFromBaseline = ((minY + maxY) / 2 - drawY) * scale;
        // line-height:1 のときの「要素頂点 → ベースライン」距離。
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        const fm = ctx.measureText(text);
        const leading =
          fontSize - (fm.fontBoundingBoxAscent + fm.fontBoundingBoxDescent);
        const baselineFromTop = leading / 2 + fm.fontBoundingBoxAscent;
        // 3) インク中心 = 粒子グリフ矩形の中心 となるよう left/top を決める。
        const targetCx = rect.left + rect.width / 2;
        const targetCy = rect.top + rect.height / 2;
        el.style.display = "block";
        el.style.textAlign = "left";
        el.style.whiteSpace = "nowrap";
        el.style.width = "auto";
        el.style.height = "auto";
        el.style.fontFamily = fontFamily;
        el.style.fontWeight = fontWeight;
        el.style.fontSize = `${fontSize}px`;
        el.style.left = `${targetCx - inkCenterXFromStart}px`;
        el.style.top = `${targetCy - inkCenterYFromBaseline - baselineFromTop}px`;
        positioned = true;
      }
    }
  }

  // フォールバック（canvas 不可）: 矩形フィット。
  if (!positioned) {
    const measureSize = 100;
    let fontSize = rect.height * 0.92;
    if (ctx && text) {
      ctx.font = `${fontWeight} ${measureSize}px ${fontFamily}`;
      const mw = ctx.measureText(text).width;
      if (mw > 0) fontSize = measureSize * (rect.width / mw);
    }
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.fontFamily = fontFamily;
    el.style.fontWeight = fontWeight;
    el.style.fontSize = `${fontSize}px`;
  }
  return true;
}

/** 画面座標（px・左上原点）での字形矩形。実 DOM 文字を重ねるのに使う。 */
export interface GlyphScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** 中心 x。 */
  cx: number;
  /** 中心 y。 */
  cy: number;
}

/**
 * 粒子ターゲット群（world 座標）の範囲を screen(px) 矩形へ変換する。
 * z=0 / 無回転前提（フィナーレは正面復帰している前提で成立）。
 *
 * @param targets `[x,y,z, ...]` の Float32Array（build*Targets の戻り値）
 * @param viewportW / viewportH 画面ピクセル寸法
 * @param visibleWorldW z=0 平面の可視ワールド幅（{@link viewSizeAtZ0} の `worldW`）
 * @returns 字形矩形。targets が空などで算出不能なら null。
 */
export function computeScreenRect(
  targets: Float32Array,
  viewportW: number,
  viewportH: number,
  visibleWorldW: number,
): GlyphScreenRect | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < targets.length; i += 3) {
    const x = targets[i]!;
    const y = targets[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return null;

  const worldW = visibleWorldW;
  const worldH = visibleWorldW * (viewportH / viewportW);
  // world(中央原点・y上向き) → screen(px・左上原点・y下向き)
  const toScreenX = (wx: number) => (wx / worldW + 0.5) * viewportW;
  const toScreenY = (wy: number) => (0.5 - wy / worldH) * viewportH;
  const left = toScreenX(minX);
  const right = toScreenX(maxX);
  const top = toScreenY(maxY); // 上端 = world y 最大
  const bottom = toScreenY(minY);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  };
}
