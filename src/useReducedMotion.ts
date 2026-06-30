/**
 * useReducedMotion.ts — `prefers-reduced-motion: reduce` の購読（React フック）。
 *
 * 演出を無効化（静的フォールバック表示）すべきかの判定に使う。
 * SSR では false から始め、マウント後にメディアクエリへ同期する（ハイドレーション不一致回避）。
 *
 * 同期的な imperative 判定 {@link prefersReducedMotion} は React 非依存の
 * `./prefers-reduced-motion.js` に分離してある（CDN ビルドへの React 混入回避）。
 * 後方互換のためここからも re-export する。
 */

import { useEffect, useState } from "react";

import { REDUCED_MOTION_QUERY } from "./prefers-reduced-motion.js";

export { prefersReducedMotion } from "./prefers-reduced-motion.js";

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
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
