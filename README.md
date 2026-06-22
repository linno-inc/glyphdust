# glyphdust

> Scroll-driven **text → particles → glyph → real-text resolve**, in one declarative [react-three-fiber](https://r3f.docs.pmnd.rs/) component.

Pass any text and glyphdust dissolves it into thousands of GPU particles, scatters them into a cloud, reforms them into the next glyph, and finally **resolves into crisp, real DOM text** — all driven by a single scroll progress `0 → 1`.

<p align="center">
  <img src="https://raw.githubusercontent.com/linno-inc/glyphdust/main/docs/demo.gif" alt="glyphdust: text dissolving into particles and resolving into real text" width="720" />
</p>

```tsx
<GlyphDust
  keyframes={[
    { type: "text", text: "Hello", domSelector: "#headline" },
    { type: "scatter", spread: 1 },
    { type: "text", text: "WORLD", dense: true, resolveToDom: true },
  ]}
/>
```

That's the whole thing. Scroll, and it animates.

---

## Why glyphdust?

Existing tools each cover a slice — but none give you *"text → particles → another glyph → resolve back to selectable real text"* declaratively from one scroll driver.

| | particles | text → particles | particle → **another glyph** | resolve to **real DOM text** | scroll-driven, declarative |
|---|:---:|:---:|:---:|:---:|:---:|
| tsParticles | ✅ | partial | — | — | — |
| GSAP + custom | ✅ | manual | manual | manual | manual |
| three.js shape-morph demos | ✅ | manual | ✅ | — | — |
| **glyphdust** | ✅ | ✅ | ✅ | ✅ | ✅ |

- **Resolves to real text.** The finale isn't a picture of letters — particles cross-fade into actual, selectable, accessible DOM text, pixel-aligned to the glyph they formed (`resolveToDom` + `domSelector`).
- **One driver, any number of keyframes.** `text → scatter → text → scatter → text …`; timing is auto-distributed (override with `timing`).
- **Never blanks.** `prefers-reduced-motion` or no-WebGL falls back to your own static markup.

---

## Install

```bash
npm i glyphdust three @react-three/fiber
# or: pnpm add glyphdust three @react-three/fiber
```

`three`, `@react-three/fiber`, `react`, and `react-dom` are **peer dependencies** (React 18+, three 0.160+).

---

## Quick start (5 minutes)

A scroll hero that reads a real headline, dissolves it into particles, and resolves into a wordmark:

```tsx
import { GlyphDust } from "glyphdust";

export function Hero() {
  return (
    <main>
      <GlyphDust
        keyframes={[
          // 1. Read an existing DOM heading, pixel-aligned (particles overlap it exactly).
          { type: "text", text: "Next user\nisn't human.", domSelector: "#headline" },
          // 2. Scatter into a cloud.
          { type: "scatter", spread: 1 },
          // 3. Reform as a dense wordmark, then cross-fade to real text.
          { type: "text", text: "LINNO", dense: true, resolveToDom: true },
        ]}
        driver={{ type: "scroll", triggerHeight: 2.4 }}
        colors={{ ink: "#1b2330", accent: "#0055ff", accentRatio: 0.18 }}
        fallback={<h1>Next user isn't human.</h1>}
      />

      {/* The heading the first keyframe aligns to. */}
      <h1 id="headline">Next user isn't human.</h1>
    </main>
  );
}
```

- The `<canvas>` is a `position: fixed` full-viewport layer; `triggerHeight` (×100vh) controls how much scroll the animation spans.
- `domSelector` makes particles land exactly on an existing element's box and font — no jump on cross-fade.
- `resolveToDom` on the final keyframe hands off from particles to crisp real text.

### Drive it yourself (no scroll)

```tsx
const [p, setP] = useState(0); // 0 → 1 from time, GSAP, a slider, anything

<GlyphDust
  keyframes={[/* … */]}
  driver={{ type: "manual", progress: p }}
/>
```

---

## API

### `<GlyphDust>` props

| prop | type | default | description |
|---|---|---|---|
| `keyframes` | `Keyframe[]` | — (required) | The animation timeline. Minimum 1; typically `text → scatter → text`. |
| `driver` | `DriverConfig` | `{ type: "scroll" }` | Progress source: `scroll` or `manual`. |
| `colors` | `GlyphColors` | see below | Particle ink / accent colors. |
| `count` | `GlyphCount` | `{ desktop: 11000, mobile: 5200 }` | Particle count per device class. |
| `timing` | `number[]` | even spacing | Normalized time `0..1` per keyframe (interpolation boundaries). Length must match `keyframes`. |
| `interaction` | `GlyphInteraction` | `{ pointer: true, drag: true }` | Pointer repulsion / drag-to-rotate (with inertia). |
| `camera` | `GlyphCamera` | `{ z: 7, fov: 42 }` | Camera position / vertical FOV. |
| `dpr` | `[number, number]` | `[1, 1.75]` | r3f Canvas device-pixel-ratio range. |
| `fallback` | `ReactNode` | — | Rendered on reduced-motion / no-WebGL (prevents a blank screen). |
| `className` | `string` | — | Class on the wrapper element. |

### Keyframes

```ts
type Keyframe = TextKeyframe | ScatterKeyframe;
```

**`TextKeyframe`** (`type: "text"`) — turns text into a particle glyph:

| field | type | description |
|---|---|---|
| `text` | `string` | Text to render. Use `\n` for line breaks. |
| `domSelector` | `string?` | Selector of a real element; particles align pixel-perfect to its rect & font. |
| `resolveToDom` | `boolean?` | At the finale, cross-fade particles → real DOM text (usually the last keyframe). |
| `dense` | `boolean?` | High-density, uniform sampling (best for solid wordmarks). |
| `font` | `string?` | Canvas2D `font` string. Defaults to a density-appropriate value. |
| `worldW` | `number?` | Visible world width to fit the glyph into. |
| `offsetX` / `offsetY` | `number?` | World-space offset (right / up are positive). |

**`ScatterKeyframe`** (`type: "scatter"`) — scatters particles into a random cloud:

| field | type | description |
|---|---|---|
| `spread` | `number?` | Scatter-radius multiplier. Default `1`. |

### Drivers

```ts
{ type: "scroll", triggerHeight?: number }   // default triggerHeight: 2 (×100vh)
{ type: "manual", progress: number }         // you supply 0..1
```

### Colors

```ts
{ ink?: "#1b2330", accent?: "#0055ff", accentRatio?: 0.18 }
```

`accentRatio` (`0..1`) is the fraction of particles drawn in `accent`.

### Low-level helpers

For custom rigs, the building blocks are exported too: `buildTextTargets`, `buildDenseTextTargets`, `buildVertexShader`, `FRAGMENT_SHADER`, `createScrollProgress`, `useScrollProgress`, `useReducedMotion`, `prefersReducedMotion`, `viewSizeAtZ0`, `buildGlyphFromDOM`, `computeScreenRect`.

---

## Accessibility & resilience

- **`prefers-reduced-motion`** → renders `fallback`, no animation.
- **No WebGL** → renders `fallback`, never a blank canvas.
- **SSR-safe** — guards `window`; server render yields static markup.
- **Real text finale** — `resolveToDom` output is selectable, copyable, and screen-reader friendly.

---

## Status

`0.1.0` — the component and API above are implemented and demoed (see [`examples/`](./examples)). Published from [LINNO](https://linno.co.jp). Semantic-versioned; expect minor API polish before `1.0`.

## License

[MIT](./LICENSE) © [LINNO](https://linno.co.jp) (NOGUCHILin)

> glyphdust is the first open-source product from **LINNO** — built in the open, for the joy of the challenge.
