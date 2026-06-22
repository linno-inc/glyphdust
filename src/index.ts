/**
 * glyphdust — scroll-driven text → particles → glyph → real-text resolve
 * for react-three-fiber.
 *
 * 公開 API はこのファイルから re-export する（Task-007）。
 * 雛形段階のプレースホルダ。実装は Phase 1 (Task-002〜) で追加する。
 */

/** ライブラリのバージョン（package.json と一致させる）。 */
export const VERSION = "0.1.0";

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
