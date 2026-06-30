/**
 * prefers-reduced-motion.ts — `prefers-reduced-motion: reduce` の同期判定（React 非依存）。
 *
 * 純粋な imperative 判定だけをここに置く。React フック {@link import("./useReducedMotion.js").useReducedMotion}
 * とは分離し、vanilla（CDN）経路がこのファイルだけを参照すれば React がグラフに混入しないようにする
 * （提案者: 凜さん 2026-06-30。CDN IIFE への React 混入を断つための分離）。
 */

/** prefers-reduced-motion メディアクエリ。 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 現在 reduced-motion かを同期的に返す（イベント購読なし。imperative 用）。SSR セーフ。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
