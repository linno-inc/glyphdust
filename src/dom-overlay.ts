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

  // Range 矩形はテキストにタイトなので、画面原点＝テキスト左上
  // （下の pad 分だけ内側にオフセットする。すぐ下のコメント参照）。
  const contentLeft = rect.left;
  const contentTop = rect.top;

  // 安全マージン: canvas の fillText は Range API（レイアウトエンジンの実測）より
  // わずかに広く描画されることがある（負の letter-spacing・bold 系フォントウェイト
  // で実測: canvas 側の実描画幅が Range 幅より数px 大きい）。canvas を Range 矩形
  // ぴったりのサイズにすると、はみ出た右端（太字の最終文字の右肩など）が canvas の
  // 外に描かれて getImageData に一切写らず、粒子字形の右端が欠ける
  // （凜さん 2026-07-08「右側が切れてる」実機報告・実測で確認: canvas 実測幅が
  // Range 幅より約3px 広いケースを確認）。四辺に pad 分の余白を持たせ、描画原点も
  // 同じだけ内側にずらすことで、どの方向のはみ出しも canvas 内に収まるようにする。
  const pad = Math.max(4, fontSize * 0.08);
  // textBoxW/H は「元の（パディング無し）テキスト矩形」— 描画原点は ctx.translate(pad,pad)
  // で既にずらしてあるので、揃え位置（lineX 等）の基準はこちらを使う。cwCss/chCss は
  // canvas 実寸（パディング込み）にのみ使う。
  const textBoxW = rect.width;
  const cwCss = rect.width + pad * 2;
  const chCss = rect.height + pad * 2;

  const res = opts.resolution ?? 2;
  const cw = Math.max(2, Math.ceil(cwCss * res));
  const ch = Math.max(2, Math.ceil(chCss * res));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, cw, ch);
  ctx.scale(res, res); // 以降は CSS px 座標で描く
  ctx.translate(pad, pad); // 安全マージン分だけ描画原点をずらす
  ctx.fillStyle = "#000";
  // 各行の水平位置は要素の text-align に従う。旧実装は常に中央寄せで、
  // 左揃えの複数行（行幅が違う）だと短い行が (最長行幅 − 行幅)/2 だけ右にずれた
  // （実例: コーポレートサイトのタグライン2行目が 76.5px 右にゴースト。
  // 発見: 凜さん 2026-07-03「やっぱずれてる」）。単一行は矩形がタイトなので
  // どの揃えでも同一＝従来挙動不変。start/end は direction で解決する。
  const dir = cs.direction === "rtl" ? "rtl" : "ltr";
  const ta = cs.textAlign;
  const align: "left" | "center" | "right" =
    ta === "center"
      ? "center"
      : ta === "right" || (ta === "end" && dir === "ltr") || (ta === "start" && dir === "rtl")
        ? "right"
        : "left"; // left / start(ltr) / justify / その他
  ctx.textAlign = align;
  const lineX = align === "center" ? textBoxW / 2 : align === "right" ? textBoxW : 0;
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

  // 【2026-07-09 発見・修正】呼び出し側が渡す `lines`（`text.split("\n")`）は
  // 明示的な改行（<br/> 等）の区切りでしかなく、コンテナ幅（例: max-w-2xl）を
  // 超えて CSS が自動折り返しした行は考慮されていなかった。この canvas は
  // fillText で折り返しをせず 1 論理行 = 1 描画行として lineHeight 間隔で
  // 積むため、実 DOM 側で自動折り返しが発生する文言（例: マニフェスト本文の
  // 長い文）だと、粒子字形が実テキストより行数が少なく描画され、折り返された
  // 後半部分の粒子が欠落・実文字とズレる不具合があった（凜さん 2026-07-09
  // 「マニフェストの本文、全部粒子の旅から発生するものでないといけないのに
  // 一部がそうじゃない」実機報告）。要素の実際の折り返し幅（elRect.width。
  // パディング等を考慮せず要素ボックス幅をそのまま使う近似）に対して
  // fillText と同じ font 設定で貪欲法の単語折り返しを行い、実 DOM の自動
  // 折り返しを模倣した「本当の描画行」を作ってから積む。canvas の高さ
  // （chCss、上の rect.height 由来）は Range 実測値なので既に折り返し後の
  // 実サイズを反映しており、ここで行数が変わっても canvas 内に収まる。
  const wrapWidth = Math.max(1, elRect.width);
  const wrappedLines: string[] = [];
  for (const line of lines) {
    if (ctx.measureText(line).width <= wrapWidth) {
      wrappedLines.push(line);
      continue;
    }
    const words = line.split(" ");
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(test).width > wrapWidth) {
        wrappedLines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) wrappedLines.push(cur);
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
  const fm = ctx.measureText(wrappedLines[0] ?? "M");
  const fbAsc = fm.fontBoundingBoxAscent;
  const useMetrics = Number.isFinite(fbAsc);
  const fallbackAscent = fontSize * (opts.ascentRatio ?? 0.82);
  wrappedLines.forEach((line, i) => {
    const lineTop = i * lineHeight;
    const baseline = useMetrics
      ? lineTop + fbAsc
      : lineTop + fallbackAscent;
    ctx.fillText(line, lineX, baseline);
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

  // インデックスを一度だけ Fisher–Yates シャッフル → 巡回割当で均一カバレッジ。
  // 旧実装（連番ストライド + 乗算ハッシュを filled の全域に適用）は、ハッシュの
  // 振れ幅がストライドの均等性を丸ごと打ち消してしまい、実質ただのランダム
  // 選択と同じになっていた。ランダム選択は「くじ引きの偏り」で同じピクセルに
  // 複数の粒子が重なる一方、選ばれないピクセルも生まれ、文字が均一な砂目でなく
  // 「団子状」にムラ立って見える原因になっていた（凜さん 2026-07-06
  // 「収束・拡散のテキストの粒子がボコボコダンゴみたいでスマート感がない」）。
  // buildDenseTextTargets（非DOM高密度サンプリング）が既に同じ問題を
  // シャッフル+巡回割当で解決済みだったため、同じ方式をDOMサンプリングにも
  // 移植する: 各塗りピクセルに floor/ceil(count/filled) 個がほぼ均等に乗る。
  const order = new Uint32Array(filled);
  for (let i = 0; i < filled; i++) order[i] = i;
  for (let i = filled - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const idx = order[i % filled]!;
    // canvas → CSS px（コンテンツ原点）。ctx.translate(pad,pad) で描画原点をずらした分、
    // ここで pad を引いて「元のテキスト矩形」基準の座標に戻す。
    const cx = pts[idx * 2]! / res - pad;
    const cy = pts[idx * 2 + 1]! / res - pad;

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

/** {@link sampleAnchorCenterWorld} のオプション。 */
export interface AnchorCenterOptions {
  /** 対象 DOM 要素のセレクタ。 */
  selector: string;
  fovDeg: number;
  cameraZ: number;
  viewportW?: number;
  viewportH?: number;
}

/**
 * 指定セレクタの DOM 要素の画面中心を world(z=0) 座標へ変換する。
 * {@link buildGlyphFromDOM} と違い文字の塗りピクセルは走査せず、要素の
 * バウンディングボックス中心だけを使う（他 canvas の scatter の着地点を
 * 示すためだけの軽量版。{@link import("./types.js").ScatterKeyframe.anchorSelector} 参照）。
 * 要素が無い/計測不能なら null。
 */
export function sampleAnchorCenterWorld(
  opts: AnchorCenterOptions,
): { cx: number; cy: number } | null {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }
  const el = document.querySelector(opts.selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;

  const vpW = opts.viewportW ?? window.innerWidth;
  const vpH = opts.viewportH ?? window.innerHeight;
  const { worldW, worldH } = viewSizeAtZ0(vpW, vpH, opts.fovDeg, opts.cameraZ);
  const sx = rect.left + rect.width / 2;
  const sy = rect.top + rect.height / 2;
  return {
    cx: (sx / vpW - 0.5) * worldW,
    cy: -(sy / vpH - 0.5) * worldH,
  };
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
