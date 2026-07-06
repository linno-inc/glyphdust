/**
 * sampling.ts — 文字・シェイプ → 粒子ターゲット座標の生成。
 *
 * オフスクリーン Canvas にテキスト（またはSVGパス）を描画し、塗りピクセルを
 * サンプリングして各粒子のワールド座標ターゲット（Float32Array, xyz × count）を作る。
 * フォント非依存・任意文字対応（CJK 含む）。
 *
 * 3 つの戦略:
 *  - {@link buildTextTargets}      … 通常密度。読める字形をフォールバック付きで生成。
 *  - {@link buildDenseTextTargets} … 高密度・均一カバレッジ。穴の目立たないワードマーク向け。
 *  - {@link buildShapeTargets}     … SVG パスデータを形として塗る（アスペクト比保存）。
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

/** {@link buildShapeTargets} のオプション。 */
export interface ShapeTargetOptions {
  /** SVG パスデータ（`d` 属性）。複数パスは配列（すべて塗りとして合成）。 */
  path: string | string[];
  /**
   * パス座標系の表示範囲 `[minX, minY, width, height]`。
   * 未指定なら SVG `getBBox()` で自動計測（SSR / 計測不能時はフォールバック）。
   */
  viewBox?: [number, number, number, number] | undefined;
  /** 塗り規則。既定 `"nonzero"`。 */
  fillRule?: "nonzero" | "evenodd";
  /**
   * シェイプのバウンディングボックスのワールド幅。
   * テキスト系の「canvas 全幅をマップ」とは違い、形そのものの幅（アスペクト比保存）。
   */
  worldW: number;
  /**
   * シェイプのワールド高さの上限。アスペクト比により `worldW * (vbH/vbW)` が
   * これを超える場合、比率を保ったまま縮小する（縦長シェイプが可視領域を
   * はみ出すのを防ぐ。既定の worldW を使う呼び出し元が可視高さから渡す）。
   */
  maxWorldH?: number;
  /** ワールド x オフセット（右が +）。既定 0。 */
  offsetX?: number;
  /** ワールド y オフセット（上が +）。既定 0。 */
  offsetY?: number;
  /** z 方向の厚み。既定 0.1。 */
  thickness?: number;
  /** ピクセル走査間隔。形は塗りが太いので密に拾う。既定 1。 */
  step?: number;
  /** オフスクリーン canvas 幅。既定 1024。 */
  cw?: number;
  /** オフスクリーン canvas 高さ。既定 1024。 */
  ch?: number;
  /** 乱数生成器。既定 `Math.random`。 */
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

/**
 * 塗りピクセル列を「シャッフル + 巡回割当」で粒子ターゲットへ変換する共通処理。
 * インデックスを一度だけ Fisher–Yates シャッフルし、粒子へ巡回割当することで
 * 各塗りピクセルに `floor/ceil(count / filled)` 個がほぼ均等に乗り、粗密ムラ・穴を防ぐ
 * （旧・連番ストライド+乗算ハッシュ方式はハッシュの振れ幅がストライドの均等性を
 * 打ち消し実質ランダム選択と同じになり、団子状のムラが出ていた。2026-07-06 統一）。
 *
 * 乱数の消費順は「シャッフル → 粒子ごとに jitterX, jitterY, z の 3 回」で固定
 * （決定論的テストのため、呼び出し元を統合しても順序を変えない）。
 */
function assignShuffledTargets(
  out: Float32Array,
  count: number,
  pts: number[],
  opts: {
    cw: number;
    ch: number;
    /** canvas px → ワールドの変換係数。 */
    scale: number;
    offsetX: number;
    offsetY: number;
    /** ジッタ振幅（ワールド単位）。`(random()-0.5) * jitter` が加わる。 */
    jitter: number;
    thickness: number;
    random: Random;
  },
): void {
  const { cw, ch, scale, offsetX, offsetY, jitter, thickness, random } = opts;
  const filled = pts.length / 2;

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
    out[i * 3] = wx + (random() - 0.5) * jitter;
    out[i * 3 + 1] = wy + (random() - 0.5) * jitter;
    out[i * 3 + 2] = (random() - 0.5) * thickness;
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

  assignShuffledTargets(out, count, pts, {
    cw,
    ch,
    scale,
    offsetX,
    offsetY,
    jitter: scale * step,
    thickness: opts.thickness ?? 0.18,
    random,
  });
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

  assignShuffledTargets(out, count, pts, {
    cw,
    ch,
    scale,
    offsetX,
    offsetY,
    // ジッタは塗り内に収める控えめな量（穴が開かない範囲）。
    jitter: scale * step * 0.5,
    thickness: opts.thickness ?? 0.08,
    random,
  });
  return out;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * SVG パス群のバウンディングボックスを `getBBox()` で計測する。
 * 非表示（`visibility:hidden`・0×0）の SVG を一時的に DOM へ差して測る
 * （`getBBox` はレイアウト非依存のジオメトリ境界を返すが、`display:none` や
 * 未接続ノードでは 0 を返すブラウザがあるため接続は必須）。
 * SSR / 計測不能時は null（呼び出し側でフォールバック）。
 */
export function measureSvgPathBounds(
  paths: string[],
): [number, number, number, number] | null {
  if (typeof document === "undefined" || !document.body) return null;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  document.body.appendChild(svg);
  try {
    const b = svg.getBBox();
    if (!(b.width > 0) || !(b.height > 0)) return null;
    return [b.x, b.y, b.width, b.height];
  } catch {
    return null;
  } finally {
    svg.remove();
  }
}

/**
 * SVG パスデータをオフスクリーン canvas に塗り、塗りピクセルをワールド座標ターゲットへ
 * 変換する（テキスト系と同じ「シャッフル + 巡回割当」パイプライン）。
 *
 * - アスペクト比は保存。`worldW` は**シェイプのバウンディングボックスのワールド幅**
 *   （テキストの「canvas 全幅マップ」と違い、形そのものの幅。テキストは字形が canvas に
 *   占める比率が文言依存で予測不能だが、形は境界が既知なので直接指定できる方が使いやすい）。
 * - `viewBox` 省略時は {@link measureSvgPathBounds} で自動計測。
 * - SSR / 不正パス / 塗り 0 は {@link fillScatterCluster} へフォールバック（真っ白防止）。
 */
export function buildShapeTargets(
  count: number,
  opts: ShapeTargetOptions,
): Float32Array {
  const out = new Float32Array(count * 3);
  const random = opts.random ?? Math.random;
  const cw = opts.cw ?? 1024;
  const ch = opts.ch ?? 1024;
  const offsetX = opts.offsetX ?? 0;
  const offsetY = opts.offsetY ?? 0;

  const ctx = createSamplingContext(cw, ch);
  if (!ctx) return out;

  const paths = Array.isArray(opts.path) ? opts.path : [opts.path];
  const vb = opts.viewBox ?? measureSvgPathBounds(paths);
  if (!vb || !(vb[2] > 0) || !(vb[3] > 0)) {
    fillScatterCluster(out, count, offsetX, offsetY, random);
    return out;
  }
  const [vbX, vbY, vbW, vbH] = vb;

  // viewBox を canvas へ contain フィット（周囲 4% 余白・中央寄せ）。
  const fit = Math.min((cw * MAX_INK_RATIO) / vbW, (ch * MAX_INK_RATIO) / vbH);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(
    fit,
    0,
    0,
    fit,
    cw / 2 - (vbX + vbW / 2) * fit,
    ch / 2 - (vbY + vbH / 2) * fit,
  );
  ctx.fillStyle = "#000";
  const fillRule = opts.fillRule ?? "nonzero";
  for (const d of paths) {
    try {
      ctx.fill(new Path2D(d), fillRule);
    } catch {
      // 不正なパスデータは無視（他のパスの塗りは活かす）。
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const step = opts.step ?? 1;
  const pts = collectFilledPixels(ctx, cw, ch, step);
  if (pts.length === 0) {
    fillScatterCluster(out, count, offsetX, offsetY, random);
    return out;
  }

  // worldW は「viewBox のワールド幅」: 描画された viewBox 幅（vbW * fit px）が
  // worldW にマップされるよう px → ワールド係数を決める。
  // 縦長シェイプはワールド高さが maxWorldH を超えないよう比率保存で縮小する。
  let worldW = opts.worldW;
  const worldH = worldW * (vbH / vbW);
  if (opts.maxWorldH !== undefined && worldH > opts.maxWorldH) {
    worldW *= opts.maxWorldH / worldH;
  }
  const scale = worldW / (vbW * fit);

  assignShuffledTargets(out, count, pts, {
    cw,
    ch,
    scale,
    offsetX,
    offsetY,
    jitter: scale * step * 0.5,
    thickness: opts.thickness ?? 0.1,
    random,
  });
  return out;
}
