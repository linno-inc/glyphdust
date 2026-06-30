# Changelog

All notable changes to **glyphdust** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.1] — 2026-07-01

### Fixed

- **`glyphText()` の終端が「くっきり収束」しきらず緩い粒子のまま保持されていた問題を修正。**
  保持区間（最終 text キーフレーム 0.85→1.0）で整列ホールド度合い `uSettle`
  （エッジ締め・不透明度・点サイズ均一化を駆動）が `bump` 由来で 0 へ戻ってしまい、
  止まった後にむしろ緩んで見えていた。最終キーフレームが text のとき `uSettle` を
  `uForm` で下限留めし、保持中 1 に張り付かせて密に定着させる。`<GlyphDust>`（R3F・
  resolveToDom で実文字へ受け渡す経路）は対象外で挙動不変。_提案者: 凜さん 2026-07-01。_

## [0.6.0] — 2026-06-30

Non-breaking feature release. Existing npm/bundler usage is unchanged.

### Added

- **CDN (`<script>`) build — zero install.** A standalone IIFE bundle
  (`dist/glyphdust.min.js`, ~140&nbsp;KB gzipped) with **three.js bundled in**,
  exposing a global `glyphdust` with `glyphText()` and `VERSION`. Drop
  `https://cdn.jsdelivr.net/npm/glyphdust` (or unpkg) into any HTML file — no
  `npm install`, no bundler — and call `glyphdust.glyphText("#hero", "LINNO")`.
  Wired via the `unpkg` / `jsdelivr` package fields and a `./cdn` export.
  _Why: let an AI agent (or anyone) use glyphdust on the spot, by pasting a snippet
  that runs with no toolchain (提案者: 凜さん 2026-06-30)._ The React-dependent API is
  intentionally excluded from this bundle (a dedicated `src/cdn.ts` entry re-exports
  only the vanilla `glyphText`), so React is never pulled into the script.

## [0.5.0] — 2026-06-30

Non-breaking feature release. The existing `<GlyphDust>` component is unchanged.

### Added

- **`glyphText(target, text, options?)` — a React-free one-call API.** Drop a single
  line and get particles: it creates the `<canvas>`, boots three.js, fits the target
  element, and autoplays (scatter → text, then holds). Returns a handle
  (`destroy()` / `pause()` / `play()` / `restart()`). Preset-driven, so it looks right
  with zero config; `prefers-reduced-motion` / no-WebGL fall back to static centered
  text. Needs only `three` (no React / react-three-fiber). Exported types
  `GlyphTextOptions`, `GlyphTextHandle`.
  _Why: let an AI agent (or anyone) use glyphdust lightly and on the spot, without
  R3F setup. (提案者: 凜さん 2026-06-30)_

### Changed

- Internal: the framework-agnostic particle geometry/interpolation helpers
  (`buildScatter`, `buildKeyframeTargets`, `smooth`, `bump`) moved to
  `src/internal/geometry.ts` and are now shared by both the R3F component and
  `glyphText()`. Byte-identical extraction — the component's behavior is unchanged.

## [0.4.0] — 2026-06-28

Non-breaking feature release. Defaults reproduce 0.3.0 exactly.

### Added

- **Motion math controls in `style`** — `stagger` (per-particle arrival spread),
  `curl` (curl-noise idle drift), `easing` (`"smoothstep"` C1 vs `"smootherstep"` C2,
  Perlin 2002), and `scatterPattern` (`"random"` vs `"fibonacci"` golden-angle cloud,
  Vogel 1979). Backed by new shader uniforms; the example gains a before/after toggle.
  Defaults preserve the prior look. _(提案者: 凜さん)_

## [0.3.0] — 2026-06-28

Non-breaking feature release. Defaults reproduce 0.2.1 exactly.

### Added

- **Mixed fonts in one glyph (`segments`)** — a `TextKeyframe` can now carry a
  `segments: { text, font? }[]` array. Each run is stamped with its own font and
  flows inline (a `\n` inside any run breaks the line; the next run continues on the
  new line), so a single particle glyph can blend, e.g., a bold serif word with a
  light sans one. `text` stays the accessible/`resolveToDom` string; per-run `font`
  falls back to the keyframe `font`. Works on the normal and `dense` sampling paths;
  ignored under `domSelector` (the DOM provides layout). Defaults unchanged —
  omitting `segments` reproduces prior behavior exactly.
  _Why: particles only ride "ink", so the stamp was never font-bound — the limit was
  the API exposing one font. (提案者: 凜さん)_

## [0.2.1] — 2026-06-26

Flexibility & polish release. Glyphdust is no longer scroll-and-hero only — it now
drops into any box, plays without scroll, and ships tasteful presets you can override.
**Defaults reproduce 0.2.0 exactly**, so upgrading is non-breaking.

### Added

- **`autoplay` driver** — time-based progress with no scroll choreography. Fits its
  parent box and starts when scrolled into view (`playOnView`, default on). Options:
  `duration`, `delay`, `loop`, `pingpong`, `playOnView`. Exposed
  `computeAutoplayProgress()` for custom rigs.
- **`preset` prop** — `"default" | "minimal" | "lively" | "glow"`: a tasteful bundle
  of look + motion.
- **`style` prop** — per-field overrides on top of the preset:
  `size`, `blend` (`"normal" | "additive"`), `drift`, `sparkle`. Backed by new shader
  uniforms (`uSizeScale`, `uDrift`, `uSparkle`); `additive` enables glow blending for
  dark backgrounds.

### Changed

- Particles render finer and crisper on high-DPI screens: point-size base ×0.62,
  clamp lowered to 4–5 px, and `devicePixelRatio` cap raised 2 → 3. (Validated on the
  LINNO corporate site.)
- Scroll follow no longer lags: stage progress is applied directly instead of an
  internal lerp. Add inertia in your driver (e.g. Lenis) if you want it.

### Fixed

- No more blank gap when the **first keyframe is text** — particles now start in the
  formed glyph and dissolve outward, instead of appearing only after the real text
  fades.
- `VERSION` export corrected (was a stale `"0.1.0"`).

## [0.2.0] — 2026-06-23

- Resolve to real DOM elements with pixel alignment; scrollbar & baseline fixes.

## [0.1.0]

- Initial public release: text → particles → glyph → real-text resolve, scroll-driven.
