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
  type Random,
} from "../sampling.js";
import { buildGlyphFromDOM } from "../dom-overlay.js";
import type { Keyframe } from "../types.js";

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

/** {@link buildKeyframeTargets} が必要とする描画コンテキスト。 */
export interface KeyframeBuildContext {
  visW: number;
  mobile: boolean;
  cameraFov: number;
  cameraZ: number;
  scatterPattern: "random" | "fibonacci";
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

  const lines = kf.text.split("\n");

  // 実 DOM 要素に重ねる（取得できればピクセル一致）。
  if (kf.domSelector) {
    const dom = buildGlyphFromDOM(count, lines, {
      selector: kf.domSelector,
      fovDeg: ctx.cameraFov,
      cameraZ: ctx.cameraZ,
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
