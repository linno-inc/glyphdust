/**
 * glyphdust — scroll-driven text → particles → glyph → real-text resolve
 * for react-three-fiber.
 *
 * 公開 API はこのファイルから re-export する。
 */

/** ライブラリのバージョン（package.json と一致させる）。 */
export const VERSION = "0.8.6";

// 文字 → 粒子ターゲット生成（Task-002）
export {
  buildTextTargets,
  buildDenseTextTargets,
  type Random,
  type TextTargetOptions,
  type DenseTextTargetOptions,
} from "./sampling.js";

// GLSL シェーダ（Task-003）
export {
  buildVertexShader,
  FRAGMENT_SHADER,
  glyphPositionAttribute,
  GLYPH_POSITION_ATTRIBUTE_PREFIX,
} from "./shaders.js";

// DOM 重ね合わせ・幾何（Task-004）
export {
  viewSizeAtZ0,
  buildGlyphFromDOM,
  computeScreenRect,
  type ViewSize,
  type DomGlyphOptions,
  type GlyphScreenRect,
} from "./dom-overlay.js";

// 進捗ドライバ（React 非依存）
export {
  createScrollProgress,
  computeAutoplayProgress,
  DEFAULT_TRIGGER_HEIGHT,
  type DriverConfig,
  type ScrollDriverConfig,
  type ManualDriverConfig,
  type AutoplayDriverConfig,
} from "./drivers.js";

// スクロール進捗 React フック（React 依存は別ファイルに隔離）
export { useScrollProgress } from "./use-scroll-progress.js";

// reduced-motion（Task-005）。imperative 判定は React 非依存ファイルに分離。
export { prefersReducedMotion } from "./prefers-reduced-motion.js";
export { useReducedMotion } from "./useReducedMotion.js";

// 公開コンポーネント（Task-006）
export { GlyphDust } from "./GlyphDust.js";

// 最小ワンコール API（React 不要・vanilla）
export {
  glyphText,
  type GlyphTextOptions,
  type GlyphTextHandle,
  type MorphToOptions,
  type ScatterOptions,
} from "./vanilla.js";

// 公開型（Task-006 / 007）
export type {
  Keyframe,
  TextKeyframe,
  TextSegment,
  ScatterKeyframe,
  GlyphColors,
  GlyphStyle,
  GlyphPreset,
  GlyphCount,
  GlyphCamera,
  GlyphDustProps,
} from "./types.js";
