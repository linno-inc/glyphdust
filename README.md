# glyphdust

> Scroll-driven **text → particles → glyph → real-text resolve**, in one declarative [react-three-fiber](https://r3f.docs.pmnd.rs/) component.

Pass any text and glyphdust dissolves it into thousands of GPU particles, scatters them, reforms them into the next glyph, and finally resolves into crisp real DOM text — all driven by a single scroll progress `0 → 1`.

> **Status: 0.1.0 — work in progress.** Scaffold only. The component API below is the target shape; implementation lands in upcoming releases.

## Why

Existing tools each cover a slice — `tsParticles` for particle systems, `particle-morph`/GSAP for 3D shape morphs — but none provide *"text → particles → another glyph → resolve to real text"* declaratively from one scroll driver. glyphdust does exactly that.

## Install

```bash
npm i glyphdust three @react-three/fiber
```

`three` and `@react-three/fiber` are peer dependencies.

## Quick start (target API)

```tsx
import { GlyphDust } from "glyphdust";

<GlyphDust
  keyframes={[
    { type: "text", text: "Hello", domSelector: "#headline" },
    { type: "scatter", spread: 1 },
    { type: "text", text: "WORLD", dense: true, resolveToDom: true },
  ]}
  driver={{ type: "scroll", triggerHeight: 2 }}
  colors={{ ink: "#1b2330", accent: "#0055ff", accentRatio: 0.18 }}
  fallback={<h1>Hello</h1>}
/>;
```

- `prefers-reduced-motion` / no-WebGL → renders `fallback` (never blank).
- SSR-safe, tree-shakeable, TypeScript types bundled.

## License

[MIT](./LICENSE) © LINNO / NOGUCHILin
