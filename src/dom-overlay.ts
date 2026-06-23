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

  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;

  const random = opts.random ?? Math.random;
  const cs = window.getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 64;
  // line-height は "normal" の場合があるので算出。
  let lineHeight = parseFloat(cs.lineHeight);
  if (!isFinite(lineHeight) || lineHeight <= 0) lineHeight = fontSize * 1.1;
  const letterSpacing = parseFloat(cs.letterSpacing) || 0;
  const fontWeight = cs.fontWeight || "600";
  const fontFamily = cs.fontFamily || "sans-serif";

  // パディング/ボーダーを除いたコンテンツ左端・上端。
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const contentLeft = rect.left + padL;
  const contentTop = rect.top + padT;

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
  ctx.textAlign = "left";
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

  // ベースライン位置をブラウザの行レイアウトに正確に合わせる。
  // 行ボックス内では baseline = 行頂点 + half-leading + fontAscent。
  // フォントの実アセント/ディセントは canvas の measureText から取得する
  // （近似 ascentRatio=0.82 では実フォントと数 px ずれ、DOM 整列が崩れるため）。
  const fm = ctx.measureText(lines[0] ?? "M");
  const fbAsc = fm.fontBoundingBoxAscent;
  const fbDesc = fm.fontBoundingBoxDescent;
  const useMetrics = Number.isFinite(fbAsc) && Number.isFinite(fbDesc);
  const fallbackAscent = fontSize * (opts.ascentRatio ?? 0.82);
  lines.forEach((line, i) => {
    const lineTop = i * lineHeight;
    const baseline = useMetrics
      ? lineTop + (lineHeight - (fbAsc + fbDesc)) / 2 + fbAsc
      : lineTop + (lineHeight - fontSize) / 2 + fallbackAscent;
    ctx.fillText(line, 0, baseline);
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
