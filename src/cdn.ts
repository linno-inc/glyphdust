/**
 * cdn.ts — CDN（<script>）配信用エントリ。
 *
 * three.js を内部同梱した単独 IIFE ビルドの入口。install 不要で、
 *
 *   <script src="https://cdn.jsdelivr.net/npm/glyphdust"></script>
 *   <script>glyphdust.glyphText("#hero", "LINNO")</script>
 *
 * のように貼るだけで動く。React も bundler も要らない「その場で」入口（提案者: 凜さん 2026-06-30）。
 *
 * 公開する index.ts と違い、React / react-three-fiber 依存の API は一切 re-export
 * しない。グラフが three とブラウザ DOM だけで閉じるため、IIFE に React が混入しない。
 */

export {
  glyphText,
  type GlyphTextOptions,
  type GlyphTextHandle,
  type MorphToOptions,
  type MorphToShapeOptions,
  type ScatterOptions,
} from "./vanilla.js";

/** ライブラリのバージョン（package.json と一致させる）。 */
export const VERSION = "0.9.4";
