# Changelog

All notable changes to **glyphdust** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

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
