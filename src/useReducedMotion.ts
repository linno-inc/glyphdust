/**
 * useReducedMotion.ts — `prefers-reduced-motion: reduce` の購読。
 *
 * 演出を無効化（静的フォールバック表示）すべきかの判定に使う。
 * SSR では false から始め、マウント後にメディアクエリへ同期する（ハイドレーション不一致回避）。
 */

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** 現在 reduced-motion かを同期的に返す（イベント購読なし。imperative 用）。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/**
 * `prefers-reduced-motion: reduce` を購読する React フック。
 * 変更にも追随する。SSR セーフ（初期 false → マウント後に同期）。
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
