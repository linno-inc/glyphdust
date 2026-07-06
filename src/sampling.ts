/**
 * sampling.ts — 文字 → 粒子ターゲット座標の生成。
 *
 * オフスクリーン Canvas にテキストを描画し、塗りピクセルをサンプリングして
 * 各粒子のワールド座標ターゲット（Float32Array, xyz × count）を作る。
 * フォント非依存・任意文字対応（CJK 含む）。
 *
 * 2 つの戦略:
 *  - {@link buildTextTargets}      … 通常密度。読める字形をフォールバック付きで生成。
 *  - {@link buildDenseTextTargets} … 高密度・均一カバレッジ。穴の目立たないワードマーク向け。
 *
 * いずれも SSR セーフ（`document` 不在時は原点クラスタ or 空配列を返し、例外を投げない）。
 */

import type { TextSegment } from "./types.js";

/** alpha がこの値を超えるピクセルを「塗り」とみなす。 */
const ALPHA_THRESHOLD = 128;

/** 0..1 を返す乱数生成器。テスト時に決定論的な関数を注入できる。 */
export type Random = () => number;

/** {@link buildTextTargets} のオプション。 */
export interface TextTargetOptions {
  /** Canvas2D の `font` 文字列（例 `"600 64px 'Noto Sans JP', sans-serif"`）。 */
  font: string;
  /**
   * 書体混在の区間列。指定すると `lines` の代わりに各区間を `font` 付きで
   * インライン描画する（区間内 `\n` で改行）。区間の `font` 省略時は上の `font`。
   */
  segments?: TextSegment[] | undefined;
  /** 字形を収める可視ワールド幅。canvas 幅 `cw` 全体がこの幅にマップされる。 */
  worldW: number;
  /** 行送り（px, canvas 座標）。複数行のとき行間に使う。 */
  lineHeight: number;
  /** ワールド y オフセット（上が +）。既定 0。 */
  offsetY?: number;
  /** ワールド x オフセット（右が +）。既定 0。 */
  offsetX?: number;
  /** z 方向の厚み。既定 0.18。 */
  thickness?: number;
  /** ピクセル走査間隔。大きいほど粗く高速。既定 2。 */
  step?: number;
  /** オフスクリーン canvas 幅。既定 1280。 */
  cw?: number;
  /** オフスクリーン canvas 高さ。既定 480。 */
  ch?: number;
  /** テキスト寄せ。DOM 見出しと重ねるときは `"left"`。既定 `"center"`。 */
  align?: "center" | "left";
  /** 乱数生成器（ジッタ・フォールバック用）。既定 `Math.random`。 */
  random?: Random;
}

/** {@link buildDenseTextTargets} のオプション。 */
export interface DenseTextTargetOptions {
  /** Canvas2D の `font` 文字列。 */
  font: string;
  /** 書体混在の区間列（{@link TextTargetOptions.segments} と同じ）。 */
  segments?: TextSegment[] | undefined;
  /** 字形を収める可視ワールド幅。 */
  worldW: number;
  /** ワールド y オフセット（上が +）。既定 0。 */
  offsetY?: number;
  /** ワールド x オフセット（右が +）。既定 0。 */
  offsetX?: number;
  /** z 方向の厚み。既定 0.08（字形塗りにきっちり乗せる）。 */
  thickness?: number;
  /** ピクセル走査間隔。密に拾うため既定 1。 */
  step?: number;
  /** オフスクリーン canvas 幅。既定 1280。 */
  cw?: number;
  /** オフスクリーン canvas 高さ。既定 400。 */
  ch?: number;
  /** 行送りを `ch` 比で指定。既定 0.46。 */
  lineHeightRatio?: number;
  /** 乱数生成器。既定 `Math.random`。 */
  random?: Random;
}

/**
 * オフスクリーン 2D canvas コンテキストを作る。
 * SSR / 2D 非対応時は null を返す（呼び出し側でフォールバック）。
 */
function createSamplingContext(
  cw: number,
  ch: number,
): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  return canvas.getContext("2d", { willReadFrequently: true });
}

/**
 * 塗りピクセルの座標を `[x0, y0, x1, y1, ...]` 形式で収集する。
 * 戻り値の長さ / 2 が塗りピクセル数。
 */
function collectFilledPixels(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  step: number,
): number[] {
  const { data } = ctx.getImageData(0, 0, cw, ch);
  const pts: number[] = [];
  for (let y = 0; y < ch; y += step) {
    for (let x = 0; x < cw; x += step) {
      if (data[(y * cw + x) * 4 + 3]! > ALPHA_THRESHOLD) pts.push(x, y);
    }
  }
  return pts;
}

/**
 * 塗りピクセルが 0 個だったときのフォールバック。
 * 粒子を小さな楕円体クラスタに集約し、真っ白・破綻を防ぐ。
 */
function fillScatterCluster(
  out: Float32Array,
  count: number,
  offsetX: number,
  offsetY: number,
  random: Random,
): void {
  for (let i = 0; i < count; i++) {
    const r = Math.cbrt(random()) * 1.4;
    const th = random() * Math.PI * 2;
    out[i * 3] = Math.cos(th) * r + offsetX;
    out[i * 3 + 1] = Math.sin(th) * r * 0.4 + offsetY;
    out[i * 3 + 2] = (random() - 0.5) * 0.2;
  }
}

/** canvas 幅に対する字形の最大占有率（両端に 4% ずつ余白を残す）。 */
const MAX_INK_RATIO = 0.92;

/** font 文字列の px 数値を ratio 倍に置き換える（下限 8px）。 */
function scaleFontPx(font: string, ratio: number): string {
  return font.replace(/(\d+(?:\.\d+)?)px/, (_, px: string) => {
    const size = Math.max(8, Math.floor(parseFloat(px) * ratio));
    return `${size}px`;
  });
}

/**
 * 最長行が canvas 幅に収まるようフォントを自動縮小した font 文字列を返す。
 * 固定フォントサイズのまま長文（例「こんにちは、凜さん」）を描くと canvas から
 * はみ出して字形が左右見切れするため、必ず通す（発見: Claude 2026-07-02、
 * morphTo ストリーミングの実ブラウザ検証で長文が切れた）。収まっていれば無変更。
 */
function fitFontToWidth(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  font: string,
  cw: number,
): string {
  ctx.font = font;
  let maxW = 0;
  for (const line of lines) {
    maxW = Math.max(maxW, ctx.measureText(line).width);
  }
  const limit = cw * MAX_INK_RATIO;
  if (maxW <= limit || maxW === 0) return font;
  return scaleFontPx(font, limit / maxW);
}

/** レイアウト済みのラン（1 区間ぶんの文字＋確定書体）。 */
interface SegRun {
  text: string;
  font: string;
}

/**
 * 区間列を「行（ランの並び）」へ展開する。
 * 各区間の `\n` で改行し、次の区間は新しい行の続きに流れる。
 * 空文字のランは捨てる（測定・描画に寄与しない）。
 */
function segmentsToRunLines(
  segments: TextSegment[],
  defaultFont: string,
): SegRun[][] {
  const lines: SegRun[][] = [[]];
  for (const seg of segments) {
    const font = seg.font ?? defaultFont;
    const parts = seg.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1]!.push({ text: part, font });
    });
  }
  return lines;
}

/**
 * 書体混在の行をオフスクリーン canvas に描画する。
 * 各行は左→右にランを流し（区間ごとに `ctx.font` を切替え measureText で字送り）、
 * `align` に応じて行全体を中央寄せ／左寄せする。塗りは黒・baseline middle。
 */
function drawSegmentedLines(
  ctx: CanvasRenderingContext2D,
  runLines: SegRun[][],
  cw: number,
  ch: number,
  lineHeight: number,
  align: "center" | "left",
  leftPad: number,
): void {
  // 最長行が canvas 幅を超えるときは全ランのフォントを一律縮小（比率維持で見切れ防止）。
  let maxTotal = 0;
  for (const runs of runLines) {
    let total = 0;
    for (const r of runs) {
      ctx.font = r.font;
      total += ctx.measureText(r.text).width;
    }
    maxTotal = Math.max(maxTotal, total);
  }
  const limit = cw * MAX_INK_RATIO;
  if (maxTotal > limit && maxTotal > 0) {
    const ratio = limit / maxTotal;
    runLines = runLines.map((runs) =>
      runs.map((r) => ({ text: r.text, font: scaleFontPx(r.font, ratio) })),
    );
  }

  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const blockH = lineHeight * (runLines.length - 1);
  runLines.forEach((runs, i) => {
    const y = ch / 2 - blockH / 2 + i * lineHeight;
    let total = 0;
    for (const r of runs) {
      ctx.font = r.font;
      total += ctx.measureText(r.text).width;
    }
    let x = align === "left" ? leftPad : cw / 2 - total / 2;
    for (const r of runs) {
      ctx.font = r.font;
      ctx.fillText(r.text, x, y);
      x += ctx.measureText(r.text).width;
    }
  });
}

/**
 * テキスト行をオフスクリーン canvas に描画し、塗りピクセルをワールド座標ターゲットへ変換する。
 *
 * 割り当ては {@link buildDenseTextTargets} と同じ「シャッフル + 巡回割当」方式
 * （2026-07-06 統一。旧・連番ストライド+乗算ハッシュ方式はハッシュの振れ幅が
 * ストライドの均等性を打ち消し実質ランダム選択と同じになり、団子状のムラが
 * 出ていた）。塗りが 0 のときは {@link fillScatterCluster} へフォールバック。
 *
 * @param count 粒子数（戻り値は `count * 3` の Float32Array）
 * @param lines 描画する行（文言は呼び出し側が決める。本関数は文言非依存）
 */
export function buildTextTargets(
  count: number,
  lines: string[],
  opts: TextTargetOptions,
): Float32Array {
  const out = new Float32Array(count * 3);
  const random = opts.random ?? Math.random;
  const cw = opts.cw ?? 1280;
  const ch = opts.ch ?? 480;

  const ctx = createSamplingContext(cw, ch);
  if (!ctx) return out;

  const align = opts.align ?? "center";
  const lh = opts.lineHeight;
  ctx.clearRect(0, 0, cw, ch);

  if (opts.segments && opts.segments.length > 0) {
    // 書体混在: 区間ごとに font を切替えてインライン描画。
    const runLines = segmentsToRunLines(opts.segments, opts.font);
    drawSegmentedLines(ctx, runLines, cw, ch, lh, align, cw * 0.04);
  } else {
    ctx.fillStyle = "#000";
    ctx.textAlign = align === "left" ? "left" : "center";
    ctx.textBaseline = "middle";
    ctx.font = fitFontToWidth(ctx, lines, opts.font, cw);

    // 左寄せ時は左端に余白を取り、各行を揃える。
    const drawX = align === "left" ? cw * 0.04 : cw / 2;
    const blockH = lh * (lines.length - 1);
    lines.forEach((line, i) => {
      ctx.fillText(line, drawX, ch / 2 - blockH / 2 + i * lh);
    });
  }

  const step = opts.step ?? 2;
  const pts = collectFilledPixels(ctx, cw, ch, step);
  const filled = pts.length / 2;

  const offsetX = opts.offsetX ?? 0;
  const offsetY = opts.offsetY ?? 0;

  if (filled === 0) {
    fillScatterCluster(out, count, offsetX, offsetY, random);
    return out;
  }

  const scale = opts.worldW / cw;
  const thickness = opts.thickness ?? 0.18;

  // buildDenseTextTargets と同じ理由でシャッフル+巡回割当に統一（旧: 連番ストライド
  // + 乗算ハッシュだと実質ランダム選択と同じになり団子状のムラが出る。詳細は
  // dom-overlay.ts の buildGlyphFromDOM 側コメント参照）。
  const order = new Uint32Array(filled);
  for (let i = 0; i < filled; i++) order[i] = i;
  for (let i = filled - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }

  for (let i = 0; i < count; i++) {
    const idx = order[i % filled]!;
    const px = pts[idx * 2]!;
    const py = pts[idx * 2 + 1]!;

    const wx = (px - cw / 2) * scale + offsetX;
    const wy = -(py - ch / 2) * scale + offsetY;
    const jx = (random() - 0.5) * scale * step;
    const jy = (random() - 0.5) * scale * step;

    out[i * 3] = wx + jx;
    out[i * 3 + 1] = wy + jy;
    out[i * 3 + 2] = (random() - 0.5) * thickness;
  }

  return out;
}

/**
 * 高密度・均一カバレッジで字形をサンプリングする（穴の目立たないワードマーク用）。
 *
 * 細かい step で塗りピクセルを収集 → 一度だけ Fisher–Yates シャッフル → 粒子へ巡回割当。
 * 各塗りピクセルに `floor/ceil(count / filled)` 個がほぼ均等に乗り、粗密ムラ・穴を防ぐ。
 * ジッタ・z 厚みは小さめにして字形塗りにきっちり乗せる。
 */
export function buildDenseTextTargets(
  count: number,
  lines: string[],
  opts: DenseTextTargetOptions,
): Float32Array {
  const out = new Float32Array(count * 3);
  const random = opts.random ?? Math.random;
  const cw = opts.cw ?? 1280;
  const ch = opts.ch ?? 400;

  const ctx = createSamplingContext(cw, ch);
  if (!ctx) return out;

  ctx.clearRect(0, 0, cw, ch);
  const lh = ch * (opts.lineHeightRatio ?? 0.46);

  if (opts.segments && opts.segments.length > 0) {
    const runLines = segmentsToRunLines(opts.segments, opts.font);
    drawSegmentedLines(ctx, runLines, cw, ch, lh, "center", cw * 0.04);
  } else {
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = fitFontToWidth(ctx, lines, opts.font, cw);

    const blockH = lh * (lines.length - 1);
    lines.forEach((line, i) => {
      ctx.fillText(line, cw / 2, ch / 2 - blockH / 2 + i * lh);
    });
  }

  const step = opts.step ?? 1; // 細かく走査して密に拾う
  const pts = collectFilledPixels(ctx, cw, ch, step);
  const filled = pts.length / 2;

  const offsetX = opts.offsetX ?? 0;
  const offsetY = opts.offsetY ?? 0;

  if (filled === 0) {
    fillScatterCluster(out, count, offsetX, offsetY, random);
    return out;
  }

  const scale = opts.worldW / cw;
  const thickness = opts.thickness ?? 0.08;

  // インデックスを一度だけシャッフル（Fisher–Yates）→ 巡回割当で均一カバレッジ。
  const order = new Uint32Array(filled);
  for (let i = 0; i < filled; i++) order[i] = i;
  for (let i = filled - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }

  // ジッタは塗り内に収める控えめな量（穴が開かない範囲）。
  const jitter = scale * step * 0.5;
  for (let i = 0; i < count; i++) {
    const idx = order[i % filled]!;
    const px = pts[idx * 2]!;
    const py = pts[idx * 2 + 1]!;
    const wx = (px - cw / 2) * scale + offsetX;
    const wy = -(py - ch / 2) * scale + offsetY;
    out[i * 3] = wx + (random() - 0.5) * jitter;
    out[i * 3 + 1] = wy + (random() - 0.5) * jitter;
    out[i * 3 + 2] = (random() - 0.5) * thickness;
  }

  return out;
}
