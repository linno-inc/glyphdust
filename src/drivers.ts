/**
 * drivers.ts — 進捗 0→1 の供給源。
 *
 *  - scroll  … sticky トリガー領域のスクロール量から進捗を算出（標準）。
 *  - manual  … 呼び出し側が `progress` を注入（時間・GSAP・任意）。
 *
 * 進捗ゲッターは「毎フレーム呼ばれる純粋な関数」として表現する（useFrame から polling）。
 * SSR セーフ（`window` 不在時は 0 を返す）。
 *
 * このファイルは React 非依存に保つ（CDN ビルドへの React 混入回避）。React フック
 * {@link import("./use-scroll-progress.js").useScrollProgress} は別ファイルへ分離してある。
 */

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

/**
 * 自動再生ドライバ設定。スクロール不要で、時間ベースに進捗 0→1 を進める。
 * 「普通にテキストとして、どんな箱にも置いて勝手に動かす」用途の標準。
 * 既定では画面内に入った瞬間に再生開始（`playOnView`）。
 */
export interface AutoplayDriverConfig {
  type: "autoplay";
  /** 0→1 にかける秒数。既定 4。 */
  duration?: number;
  /** 再生開始までの遅延秒。既定 0。 */
  delay?: number;
  /** ループ再生。既定 false（1 回で 1.0 に張り付く）。 */
  loop?: boolean;
  /** ループ時に 0→1→0 を往復する（loop 必須）。既定 false。 */
  pingpong?: boolean;
  /** 画面内に入ってから再生開始（IntersectionObserver）。既定 true。 */
  playOnView?: boolean;
}

/** ドライバ設定の合併型。 */
export type DriverConfig =
  | ScrollDriverConfig
  | ManualDriverConfig
  | AutoplayDriverConfig;

/** 0→1→0 の三角波（pingpong 用）。 */
function triangle(x: number): number {
  const t = x % 2;
  return t <= 1 ? t : 2 - t;
}

/**
 * 自動再生ドライバの進捗を、経過秒から純粋に算出する。
 * `loop`/`pingpong`/`delay` を解決し 0..1 を返す。SSR セーフ（時計は呼び出し側が渡す）。
 */
export function computeAutoplayProgress(
  elapsedSec: number,
  cfg: Pick<AutoplayDriverConfig, "duration" | "delay" | "loop" | "pingpong">,
): number {
  const duration = cfg.duration && cfg.duration > 0 ? cfg.duration : 4;
  const delay = cfg.delay && cfg.delay > 0 ? cfg.delay : 0;
  const t = elapsedSec - delay;
  if (t <= 0) return 0;
  const raw = t / duration;
  if (cfg.loop) {
    return cfg.pingpong ? triangle(raw) : raw % 1;
  }
  return clamp01(raw);
}

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
