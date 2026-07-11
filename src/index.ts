/**
 * glyphdust — scroll-driven text → particles → glyph → real-text resolve
 * for react-three-fiber.
 *
 * 公開 API はこのファイルから re-export する。
 * 公開面は <GlyphDust> コンポーネントとその props 型のみ（0.10.0 で
 * 低レベル関数・vanilla/CDN 経路を削除。理由: 外部利用ゼロでメンテ負債の
 * 最大塊だったため。提案者: 凜さん 2026-07-11「いらないものを削除して
 * 徹底的に簡素化」）。内部実装（sampling / shaders / dom-overlay 等）は
 * パッケージ内部モジュールとして残る。
 */

// 公開コンポーネント
export { GlyphDust } from "./GlyphDust.js";

// 公開型（GlyphDustProps とそこから辿れる型のみ）
export type {
  Keyframe,
  TextKeyframe,
  TextSegment,
  ScatterKeyframe,
  ShapeKeyframe,
  GlyphColors,
  GlyphStyle,
  GlyphPreset,
  GlyphCount,
  GlyphCamera,
  GlyphDustProps,
} from "./types.js";

// driver prop の型（GlyphDustProps.driver で使う union と各メンバー）
export type {
  DriverConfig,
  ScrollDriverConfig,
  ManualDriverConfig,
  AutoplayDriverConfig,
} from "./drivers.js";
