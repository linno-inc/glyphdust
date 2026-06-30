/**
 * use-scroll-progress.ts — sticky スクロール進捗を返す React フック。
 *
 * React 依存はこのファイルに隔離する。React 非依存の進捗ロジック
 * （{@link import("./drivers.js").createScrollProgress} 等）は drivers.ts 側にあり、
 * vanilla（CDN）経路はそちらだけを参照するため React がグラフに混入しない
 * （提案者: 凜さん 2026-06-30。CDN IIFE への React 混入を断つための分離）。
 */

import { useCallback } from "react";
import type { RefObject } from "react";

/**
 * sticky トリガー要素の ref からスクロール進捗ゲッターを返す React フック。
 * 返り値は ref を遅延参照する安定した関数（useFrame からそのまま polling できる）。
 * 進捗 = `-rect.top / (rect.height - innerHeight)`。SSR / 要素 null 時は 0。
 */
export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
): () => number {
  return useCallback(() => {
    const el = ref.current;
    if (el === null || typeof window === "undefined") return 0;
    const rect = el.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    if (total <= 0) return 0;
    const p = -rect.top / total;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }, [ref]);
}
