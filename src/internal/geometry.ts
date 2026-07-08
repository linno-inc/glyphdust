/**
 * internal/geometry.ts — フレームワーク非依存の純粋な幾何・補間ヘルパー。
 *
 * R3F 版 {@link import("../GlyphPoints.js").GlyphPoints} と vanilla 版
 * {@link import("../vanilla.js").glyphText} が同じ粒子幾何・補間カーブを共有するための土台。
 * ここに React / r3f への依存は持ち込まない（three の純粋ユーティリティのみ）。
 */

import * as THREE from "three";

import {
  buildTextTargets,
  buildDenseTextTargets,
  buildShapeTargets,
  type Random,
} from "../sampling.js";
import { buildGlyphFromDOM, sampleAnchorCenterWorld } from "../dom-overlay.js";
import type { Keyframe } from "../types.js";

/**
 * 「字形（形）を形成する」キーフレームか。text と shape が該当する。
 * settle / form / 終端保持（0.85 で形成し切る）の判定は「text かどうか」ではなく
 * この述語で行う（shape も収束して形を保持する点でテキストと同じ意味論のため）。
 * resolveToDom / domSelector 系の「実 DOM テキストへの解決」は text 限定のまま。
 */
export function formsGlyph(kf: Keyframe | undefined): boolean {
  return kf?.type === "text" || kf?.type === "shape";
}

export const DEFAULT_TEXT_FONT =
  "700 140px system-ui, 'Hiragino Sans', 'Noto Sans JP', sans-serif";
export const DEFAULT_DENSE_FONT =
  "900 260px 'Helvetica Neue', Helvetica, Arial, sans-serif";

export function isMobile(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches
  );
}

// smootherstep（Perlin 2002, C2 連続）。シェーダ側 smoothRange と式を揃える
// （settle/form/resolve など CPU 側の補間カーブも加速度を滑らかにする）。
export function smooth(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 中心 c で 1、左右の neighbor 時刻でほぼ 0 になる山。 */
export function bump(x: number, c: number, prev: number, next: number): number {
  const rise = c <= 0 ? 1 : smooth(prev, c, x);
  const fall = c >= 1 ? 1 : 1 - smooth(c, next, x);
  return rise * fall;
}

/** 黄金角 ≈ 137.5°（ラジアン）。π(3−√5)。 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * 飛散雲を生成。
 *
 * `pattern="fibonacci"`（既定）: 緯度を等間隔・経度を黄金角で回す「フィボナッチ球」。
 * ひまわりの種配置（Vogel 1979, phyllotaxis）と同じ最適充填で、どの方向にも均しく・
 * 有機的に散る。半径だけ軽い乱数揺らぎを残し scatter キーフレーム間で雲が変化する。
 *
 * `pattern="random"`: 一様乱数球殻。理論上は一様だが局所的に粒が固まり（クランプ）
 * 視覚的にムラが出る（比較用の旧方式）。
 */
export function buildScatter(
  count: number,
  spread: number,
  random: Random,
  pattern: "random" | "fibonacci" = "fibonacci",
): Float32Array {
  const out = new Float32Array(count * 3);
  if (pattern === "random") {
    for (let i = 0; i < count; i++) {
      const r = (3.0 + Math.cbrt(random()) * 2.6) * spread;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      out[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      out[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.8;
      out[i * 3 + 2] = r * Math.cos(phi) * 0.9;
    }
    return out;
  }
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const y = 1 - 2 * t; // 緯度: -1..1 を等間隔に
    const rxy = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE; // 経度: 黄金角で回す
    const r = (3.0 + Math.cbrt(t) * 2.6) * spread * (0.92 + random() * 0.16);
    out[i * 3] = Math.cos(theta) * rxy * r;
    out[i * 3 + 1] = y * r * 0.8;
    out[i * 3 + 2] = Math.sin(theta) * rxy * r * 0.9;
  }
  return out;
}

/**
 * 決定論的な疑似乱数（mulberry32）。粒子 index から作る。
 *
 * 局所散開（{@link buildScatterAroundTargets}）専用。局所散開のターゲットは
 * domSelector の再サンプリングのたびに再生成されるため、`Math.random` を使うと
 * 再生成のたびに雲の形そのものが変わり、散開フェーズ表示中の再サンプリングで
 * 粒子が一斉にワープする。index 決定論なら再生成しても各粒子の相対配置は同一で、
 * 雲は「参照字形の移動分だけ平行移動」しかしない。
 */
function seededRandom(seed: number): Random {
  let a = (seed * 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 参照ターゲット（字形キーフレームの粒子座標）の近傍に漂う局所飛散雲を生成。
 *
 * `around:"glyph"`（{@link import("../types.js").ScatterKeyframe.around}）の実体。
 * 参照字形のバウンディングボックスを計測し、その中心に「字形より一回り大きい
 * 楕円体」のクラウドを張る。文字行は横長・低背なので、横は字形幅ちょい増し、
 * 縦は字形高さの倍率を大きめ＋絶対パディングで「文字の上下にふわっと霞む」形にする。
 *
 * 参照が退化している（粒子が一点に潰れている等）ときは null を返す
 * （呼び出し側が従来の全面クラウドへフォールバックする）。
 */
export function buildScatterAroundTargets(
  count: number,
  spread: number,
  ref: Float32Array,
  pattern: "random" | "fibonacci" = "fibonacci",
  visW?: number,
): Float32Array | null {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i + 2 < ref.length; i += 3) {
    const x = ref[i]!;
    const y = ref[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const halfW = (maxX - minX) / 2;
  const halfH = (maxY - minY) / 2;
  // 一点クラスタ（サンプリング失敗のフォールバック等）は「字形の近傍」が定義
  // できないので全面クラウドに任せる。
  if (halfW < 0.05 && halfH < 0.05) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // 楕円体の半径。横は字形幅に沿わせ、縦は膨らませて「行の上下の霞」を作る。
  // 絶対パディング 0.45 は、短い単語でも点にならない最低限の雲サイズ。
  let rx = (halfW * 1.2 + 0.45) * spread;
  let ry = (halfH * 2.4 + 0.45) * spread;
  // 上限クランプ: 参照字形が長文（複数行パラグラフ等）だと halfW/halfH が
  // 大きく、雲が画面のほとんどを覆う「全面砂嵐」に戻ってしまう（実測で確認:
  // マニフェスト［5行パラグラフ］の退場 scatter が視野角いっぱいの巨大な雲に
  // なっていた。凜さん 2026-07-08「マニフェストより下がちゃんと旅になって
  // ない」報告の実体はこれだった）。可視ワールド幅 visW が分かるときは、
  // 絶対的な上限として掛け、長文参照でも「近傍の局所雲」の見た目を保つ
  // （短い参照はそもそもこの上限より小さいので影響しない）。
  //
  // 【2026-07-08 さらに拡大】旧上限（画面幅18%/11%）は粒子密度が高く、
  // 雲が「団子状の丸い塊」に見えていた（凜さん 2026-07-08「一度円になるのが
  // 変。やめて」「バラバラに拡散したまま移動（団まらない）」との指示）。
  // 同じ粒子数でも広い範囲に散らせば密度が下がり、個々の粒子がバラけて
  // 見える＝「丸い塊」ではなく「拡散した粒子群」に見える。上限を約2.4倍に
  // 拡大。
  if (visW !== undefined) {
    rx = Math.min(rx, visW * 0.1);
    ry = Math.min(ry, visW * 0.065);
  }
  const rz = 0.5 * spread;
  return distributeAroundPoint(count, cx, cy, rx, ry, rz, pattern);
}

/**
 * 中心点 (cx, cy) の周りに粒子を散らす（ガウス分布・決定論的乱数）。
 * {@link buildScatterAroundTargets}（参照字形の bbox から半径を出す版）と
 * {@link buildScatterAroundAnchor}（外部 DOM 要素の位置に固定サイズで着地する版）
 * の共通実装。
 *
 * 【2026-07-08 一様充填 → ガウス分布に変更】旧実装は「半径 rx/ry 以内を体積
 * 一様に充填し、それより外には 1 粒も置かない」方式だったため、雲の輪郭が
 * くっきりした楕円（実質「丸」）に見えていた（凜さん 2026-07-08「一度円に
 * なるのが変。やめて」「バラバラに拡散したまま移動（団まらない）」）。
 * 各軸独立の正規分布（Box-Muller）に変えると、中心ほど密で外側ほど指数的に
 * 疎らになる自然な減衰になり、「ここで粒子が終わる」という幾何学的な境界線が
 * 消える＝輪郭のある形として認識されにくくなる。rx/ry/rz は「標準偏差」として
 * 使う（旧実装の「充填半径」とは尺度が異なるため、呼び出し側の値をそのまま
 * 使うと薄く広がりすぎる場合がある点に注意）。
 */
function distributeAroundPoint(
  count: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rz: number,
  pattern: "random" | "fibonacci",
): Float32Array {
  const out = new Float32Array(count * 3);
  // Box-Muller: 決定論的な一様乱数2つから標準正規乱数2つを作る。
  const gaussianPair = (rnd: Random): [number, number] => {
    const u1 = Math.max(rnd(), 1e-6); // log(0) 回避
    const u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1));
    return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
  };
  for (let i = 0; i < count; i++) {
    const rnd = pattern === "random" ? seededRandom(i + 1) : seededRandom(i + 1001);
    const [gx, gy] = gaussianPair(rnd);
    const [gz] = gaussianPair(rnd);
    out[i * 3] = cx + gx * rx;
    out[i * 3 + 1] = cy + gy * ry;
    out[i * 3 + 2] = gz * rz;
  }
  return out;
}

/**
 * `anchorSelector`（{@link import("../types.js").ScatterKeyframe.anchorSelector}）
 * の実体。外部 DOM 要素の画面中心を world 座標へ変換し、そこへ固定サイズの
 * 楕円体クラウドを着地させる（参照字形のバウンディングボックスは使わない —
 * 別 canvas の要素なので粒子バッファを持たないため）。要素が見つからない/
 * 計測不能なら null（呼び出し側が `around` の挙動へフォールバックする）。
 */
export function buildScatterAroundAnchor(
  count: number,
  spread: number,
  selector: string,
  ctx: { cameraFov: number; cameraZ: number; viewportW?: number; viewportH?: number; visW: number },
  pattern: "random" | "fibonacci" = "fibonacci",
): Float32Array | null {
  const center = sampleAnchorCenterWorld({
    selector,
    fovDeg: ctx.cameraFov,
    cameraZ: ctx.cameraZ,
    ...(ctx.viewportW !== undefined ? { viewportW: ctx.viewportW } : {}),
    ...(ctx.viewportH !== undefined ? { viewportH: ctx.viewportH } : {}),
  });
  if (!center) return null;
  // buildScatterAroundTargets の上限クランプと同じ比率（2026-07-08 拡大後）
  // に揃える。参照テキストの実際のサイズは分からない＝別 canvas の要素なので、
  // 常にこのサイズで着地する。
  const rx = ctx.visW * 0.08 * spread;
  const ry = ctx.visW * 0.05 * spread;
  const rz = 0.5 * spread;
  return distributeAroundPoint(count, center.cx, center.cy, rx, ry, rz, pattern);
}

/**
 * `around:"glyph"` の scatter が近傍の基準にする字形キーフレームの index を返す。
 * 「これから形成する字形」を優先（後方で最初の formsGlyph）、無ければ
 * 「直前まで形成していた字形」（前方で最後の formsGlyph）。どちらも無ければ -1。
 */
export function scatterGlyphRefIndex(
  keyframes: Keyframe[],
  index: number,
): number {
  for (let i = index + 1; i < keyframes.length; i++) {
    if (formsGlyph(keyframes[i])) return i;
  }
  for (let i = index - 1; i >= 0; i--) {
    if (formsGlyph(keyframes[i])) return i;
  }
  return -1;
}

/** {@link buildKeyframeTargets} が必要とする描画コンテキスト。 */
export interface KeyframeBuildContext {
  visW: number;
  mobile: boolean;
  cameraFov: number;
  cameraZ: number;
  scatterPattern: "random" | "fibonacci";
  /**
   * canvas の実表示サイズ（CSS px）。domSelector サンプリングの画面→ワールド変換に使う。
   * 省略時は window.innerWidth/Height だが、縦スクロールバーがあると innerWidth と canvas
   * 幅が数 px ずれ、粒子字形が実 DOM 文字から横にずれる。整列には canvas 実寸を渡す。
   */
  viewportW?: number;
  viewportH?: number;
}

/** 1 つのキーフレームの位置ターゲットを生成。 */
export function buildKeyframeTargets(
  kf: Keyframe,
  count: number,
  ctx: KeyframeBuildContext,
): Float32Array {
  if (kf.type === "scatter") {
    return buildScatter(count, kf.spread ?? 1, Math.random, ctx.scatterPattern);
  }

  if (kf.type === "shape") {
    // 可視ワールド高さ（アスペクトは canvas 実寸 > window の順で推定）。
    const vpW =
      ctx.viewportW ??
      (typeof window !== "undefined" ? window.innerWidth : 1440);
    const vpH =
      ctx.viewportH ??
      (typeof window !== "undefined" ? window.innerHeight : 900);
    const visH = ctx.visW * (vpH / Math.max(vpW, 1));
    return buildShapeTargets(count, {
      path: kf.path,
      viewBox: kf.viewBox,
      ...(kf.fillRule !== undefined ? { fillRule: kf.fillRule } : {}),
      // 既定はテキストより控えめな幅（形は正方形に近いことが多く、テキストの
      // 0.7 相当だと縦に画面をはみ出しやすい）。
      worldW: kf.worldW ?? ctx.visW * (ctx.mobile ? 0.5 : 0.32),
      // worldW 未指定（自動サイズ）のときだけ、縦長シェイプが可視高さを
      // はみ出さないよう高さもキャップする（明示指定はユーザーの意図を尊重）。
      ...(kf.worldW === undefined ? { maxWorldH: visH * 0.62 } : {}),
      offsetX: kf.offsetX ?? 0,
      offsetY: kf.offsetY ?? 0,
    });
  }

  const lines = kf.text.split("\n");

  // 実 DOM 要素に重ねる（取得できればピクセル一致）。
  if (kf.domSelector) {
    const dom = buildGlyphFromDOM(count, lines, {
      selector: kf.domSelector,
      fovDeg: ctx.cameraFov,
      cameraZ: ctx.cameraZ,
      // 実寸が分かる場合のみ渡す（exactOptionalPropertyTypes: undefined を明示しない）。
      ...(ctx.viewportW !== undefined ? { viewportW: ctx.viewportW } : {}),
      ...(ctx.viewportH !== undefined ? { viewportH: ctx.viewportH } : {}),
    });
    if (dom) return dom;
    // 取れなければ通常サンプリングへフォールバック。
  }

  if (kf.dense) {
    return buildDenseTextTargets(count, lines, {
      font: kf.font ?? DEFAULT_DENSE_FONT,
      segments: kf.segments,
      worldW: kf.worldW ?? ctx.visW * (ctx.mobile ? 0.86 : 0.62),
      offsetX: kf.offsetX ?? 0,
      offsetY: kf.offsetY ?? 0,
      thickness: 0.06,
      cw: 1400,
      ch: 440,
      step: 1,
    });
  }

  return buildTextTargets(count, lines, {
    font: kf.font ?? DEFAULT_TEXT_FONT,
    segments: kf.segments,
    worldW: kf.worldW ?? ctx.visW * 0.7,
    lineHeight: 178,
    offsetX: kf.offsetX ?? 0,
    offsetY: kf.offsetY ?? 0,
    thickness: 0.16,
    cw: 1280,
    ch: 560,
    step: 2,
  });
}

/**
 * 連続する 2 つのキーフレームが「同一の字形」か（＝ターゲットバッファを共有してよいか）。
 *
 * text の form→hold の 2 連キーフレーム（同一テキスト・同一 domSelector）は同じ
 * 字形のはずだが、独立にサンプリングすると粒子→ピクセルの割り当てが乱数で毎回
 * 変わるため、保持区間で全粒子が「同じ字形の別の配置」へゆっくり泳ぎ直す。
 * 見た目は「収束が終わったのにもう一度粒子が動いて再収束する」不具合になる
 * （凜さん 2026-07-08「収束したと思ったらもう一回粒子が動いて、そっから収束する」）。
 * 同一字形ならバッファを共有し、保持区間の移動距離を数学的にゼロにする。
 */
function sameGlyphKeyframe(a: Keyframe | undefined, b: Keyframe): boolean {
  if (!a || a.type !== "text" || b.type !== "text") return false;
  return (
    a.text === b.text &&
    a.domSelector === b.domSelector &&
    a.font === b.font &&
    a.worldW === b.worldW &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.dense === b.dense &&
    a.segments === undefined &&
    b.segments === undefined
  );
}

/**
 * キーフレーム列全体の位置ターゲットを一括生成する（2 パス）。
 *
 * `around:"glyph"` の scatter は「隣接する字形キーフレームのターゲット」を参照して
 * 初めて位置が決まるため、1 キーフレームずつ独立に作る {@link buildKeyframeTargets}
 * では表現できない。先に字形（と従来 scatter）を全部作り、その後で局所 scatter を
 * 参照解決する。参照が取れない・退化している場合は従来の全面クラウドへ
 * フォールバックする（真っ白/無配置にはしない）。
 * 連続する同一字形キーフレームはバッファを共有する（{@link sameGlyphKeyframe}）。
 */
export function buildKeyframeTargetsList(
  keyframes: Keyframe[],
  count: number,
  ctx: KeyframeBuildContext,
): Float32Array[] {
  const out: (Float32Array | null)[] = [];
  keyframes.forEach((kf, i) => {
    if (kf.type === "scatter" && (kf.around === "glyph" || kf.anchorSelector)) {
      out.push(null);
      return;
    }
    const prevBuf = out[i - 1];
    if (prevBuf && sameGlyphKeyframe(keyframes[i - 1], kf)) {
      out.push(prevBuf);
      return;
    }
    out.push(buildKeyframeTargets(kf, count, ctx));
  });
  keyframes.forEach((kf, i) => {
    if (out[i] !== null || kf.type !== "scatter") return;
    // anchorSelector が最優先（別 canvas の実 DOM 位置への着地。types.ts の
    // ScatterKeyframe.anchorSelector コメント参照）。取れなければ通常の
    // around:"glyph"/"viewport" ロジックへフォールバックする。
    const anchored = kf.anchorSelector
      ? buildScatterAroundAnchor(count, kf.spread ?? 1, kf.anchorSelector, ctx, ctx.scatterPattern)
      : null;
    if (anchored) {
      out[i] = anchored;
      return;
    }
    const refIdx = scatterGlyphRefIndex(keyframes, i);
    const ref = refIdx >= 0 ? (out[refIdx] ?? null) : null;
    const local = ref
      ? buildScatterAroundTargets(count, kf.spread ?? 1, ref, ctx.scatterPattern, ctx.visW)
      : null;
    out[i] =
      local ?? buildScatter(count, kf.spread ?? 1, Math.random, ctx.scatterPattern);
  });
  return out as Float32Array[];
}
