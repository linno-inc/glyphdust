/**
 * drivers.ts — 進捗 0→1 の供給源。
 *
 *  - scroll  … sticky トリガー領域のスクロール量から進捗を算出（標準）。
 *  - manual  … 呼び出し側が `progress` を注入（時間・GSAP・任意）。
 *
 * 進捗ゲッターは「毎フレーム呼ばれる純粋な関数」として表現する（useFrame から polling）。
 * SSR セーフ（`window` 不在時は 0 を返す）。
 */

import { useCallback } from "react";
import type { RefObject } from "react";

/** sticky トリガー領域の既定高さ（×100vh）。 */
export const DEFAULT_TRIGGER_HEIGHT = 2;

/** スクロール連動ドライバ設定。 */
export interface ScrollDriverConfig {
  type: "scroll";
  /**
   * sticky トリガー領域の高さ（×100vh）。大きいほど演出がゆっくり進む。既定 {@link DEFAULT_TRIGGER_HEIGHT}。
   * （ラッパー要素の高さ生成に使う。進捗式自体は要素実寸から算出するため値に依存しない。）
   */
  triggerHeight?: number;
}

/** 手動ドライバ設定（progress を外部制御）。 */
export interface ManualDriverConfig {
  type: "manual";
  /** 0..1 の進捗。 */
  progress: number;
}

/** ドライバ設定の合併型。 */
export type DriverConfig = ScrollDriverConfig | ManualDriverConfig;

/** 0..1 にクランプ。 */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * 要素の sticky スクロール進捗 0→1 を返すゲッターを作る。
 * 進捗 = `-rect.top / (rect.height - innerHeight)`（要素上端が viewport 上端を通過し切るまでで 0→1）。
 * SSR / 要素 null 時は 0。
 */
export function createScrollProgress(
  element: HTMLElement | null,
): () => number {
  return () => {
    if (element === null || typeof window === "undefined") return 0;
    const rect = element.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    if (total <= 0) return 0;
    return clamp01(-rect.top / total);
  };
}

/**
 * sticky トリガー要素の ref からスクロール進捗ゲッターを返す React フック。
 * 返り値は ref を遅延参照する安定した関数（useFrame からそのまま polling できる）。
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
    return clamp01(-rect.top / total);
  }, [ref]);
}
