# glyphdust

> Scroll-driven **text → particles → glyph → real-text resolve**, in one declarative [react-three-fiber](https://r3f.docs.pmnd.rs/) component.

Pass any text and glyphdust dissolves it into thousands of GPU particles, scatters them into a cloud, reforms them into the next glyph, and finally **resolves into crisp, real DOM text** — all driven by a single scroll progress `0 → 1`.

> **Building with an AI agent / codegen?** glyphdust is designed to be generated and driven by agents:
> one component, safe defaults, a single `progress 0→1` you drive from anything (scroll, timer,
> agent, audio), and a machine-readable spec at [`llms.txt`](./llms.txt)
> (CDN: `https://cdn.jsdelivr.net/npm/glyphdust/llms.txt`).

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

### Just drop in text — no scroll choreography

For anything that isn't a full-screen scroll hero, use the **`autoplay`** driver. It
fits its parent box and plays once when it scrolls into view — drop it anywhere and it
just animates:

```tsx
<div style={{ width: 480, height: 220 }}>
  <GlyphDust
    driver={{ type: "autoplay", duration: 3.5 }}   // loop / pingpong / delay too
    preset="minimal"                                 // tasteful out of the box
    keyframes={[
      { type: "scatter" },
      { type: "text", text: "glyphdust", dense: true },
    ]}
  />
</div>
```

### Pick a look with presets (then tweak)

```tsx
<GlyphDust preset="glow" style={{ size: 1.2 }} keyframes={[/* … */]} />
```

`preset` is a tasteful starting point; `style` overrides just the fields you name.

### Drive it yourself (manual)

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
| `driver` | `DriverConfig` | `{ type: "scroll" }` | Progress source: `scroll`, `autoplay`, or `manual`. |
| `preset` | `GlyphPreset` | `"default"` | Look/motion preset: `default`, `minimal`, `lively`, `glow`. |
| `style` | `GlyphStyle` | — | Per-field overrides on top of `preset` (see below). |
| `colors` | `GlyphColors` | see below | Particle ink / accent colors. |
| `count` | `GlyphCount` | `{ desktop: 11000, mobile: 5200 }` | Particle count per device class. |
| `timing` | `number[]` | even spacing | Normalized time `0..1` per keyframe (interpolation boundaries). Length must match `keyframes`. |
| `camera` | `GlyphCamera` | `{ z: 7, fov: 42 }` | Camera position / vertical FOV. |
| `dpr` | `[number, number]` | `[1, 1.75]` | r3f Canvas device-pixel-ratio range. |
| `fallback` | `ReactNode` | — | Rendered on reduced-motion / no-WebGL (prevents a blank screen). |
| `className` | `string` | — | Class on the wrapper element. |
| `resampleSignal` | `number` | — | Change this value to re-sample `domSelector` keyframe targets (re-run `buildGlyphFromDOM`) while keeping the same Canvas/WebGL context — useful when the target element keeps scrolling (not sticky) and drifts from its initially-sampled position. |
| `paused` | `boolean` | `false` | Freeze the render loop (WebGL context stays alive, last frame holds) without unmounting. Use this for a persistent multi-instance pool: keep every `<GlyphDust>` mounted once (to avoid WebGL context churn / `Context Lost` from repeated mount+unmount) and set `paused` on whichever instances are currently idle/hidden, so they cost zero GPU time instead of rendering forever in the background. |

### Keyframes

```ts
type Keyframe = TextKeyframe | ScatterKeyframe | ShapeKeyframe;
```

**`TextKeyframe`** (`type: "text"`) — turns text into a particle glyph:

| field | type | description |
|---|---|---|
| `text` | `string` | Text to render. Use `\n` for line breaks. |
| `segments` | `{ text, font? }[]?` | Mix fonts in one glyph (see below). Particles are stamped from the runs; `text` stays the accessible / `resolveToDom` string. |
| `domSelector` | `string?` | Selector of a real element; particles align pixel-perfect to its rect & font. |
| `resolveToDom` | `boolean?` | At the finale, cross-fade particles → real DOM text (usually the last keyframe). |
| `dense` | `boolean?` | High-density, uniform sampling (best for solid wordmarks). |
| `font` | `string?` | Canvas2D `font` string. Defaults to a density-appropriate value. Also the default for `segments` runs. |
| `worldW` | `number?` | Visible world width to fit the glyph into. |
| `offsetX` / `offsetY` | `number?` | World-space offset (right / up are positive). |

#### Mix fonts in one glyph (`segments`)

Particles just ride wherever there's "ink", so a single glyph isn't bound to one
typeface. Split a keyframe into `segments` and each run gets its own `font`,
flowing inline (a `\n` inside a run starts a new line; the next run continues there):

```tsx
{
  type: "text",
  text: "Mix fonts",                 // accessible / resolve string
  segments: [
    { text: "Mix ",  font: "900 200px Georgia, serif" },        // bold serif
    { text: "fonts", font: "300 150px 'Helvetica Neue', sans-serif" }, // light sans
  ],
}
```

Runs without a `font` fall back to the keyframe `font`. `segments` is ignored when
`domSelector` is set (the DOM provides the layout there). Particle **color** is still
governed globally by `colors` (ink/accent ratio), not per segment.

**`ScatterKeyframe`** (`type: "scatter"`) — scatters particles into a random cloud:

| field | type | description |
|---|---|---|
| `spread` | `number?` | Scatter-radius multiplier. Default `1`. |

**`ShapeKeyframe`** (`type: "shape"`) — forms particles into any **SVG path** (icons,
logos, symbols — anything you can express as a `<path d="…">`):

```tsx
<GlyphDust
  keyframes={[
    { type: "text", text: "LOVE" },
    { type: "scatter", spread: 1 },
    { type: "shape", path: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 …" }, // a heart
  ]}
/>
```

| field | type | description |
|---|---|---|
| `path` | `string \| string[]` | SVG path data (the `d` attribute). Multi-`<path>` icons: pass an array — all are filled together. |
| `viewBox` | `[x, y, w, h]?` | Path coordinate range (same as SVG `viewBox`). Auto-measured when omitted; set it to keep an icon's built-in padding or make sizing deterministic. |
| `fillRule` | `"nonzero" \| "evenodd"?` | Fill rule. If a hole (e.g. a donut) gets filled in, try `"evenodd"`. |
| `worldW` | `number?` | World width of the **shape's bounding box** (aspect ratio is preserved; tall shapes auto-shrink to stay on screen when this is omitted). |
| `offsetX` / `offsetY` | `number?` | World-space offset (right / up are positive). |

Shapes behave like text glyphs in the timeline (they settle, hold at `0.85`, and get the
same crisp formation) — they just don't resolve to DOM text.

### Drivers

```ts
{ type: "scroll", triggerHeight?: number }   // full-screen sticky hero. default triggerHeight: 2 (×100vh)
{ type: "manual", progress: number }         // you supply 0..1
{ type: "autoplay",                          // time-based; fits its parent box
  duration?: number,    // seconds for 0→1 (default 4)
  delay?: number,       // start delay (default 0)
  loop?: boolean,       // repeat (default false)
  pingpong?: boolean,   // 0→1→0 when looping (default false)
  playOnView?: boolean, // start when scrolled into view (default true)
}
```

`scroll` builds a tall sticky wrapper for a full-screen hero. `manual` and `autoplay`
simply **fill their parent**, so you can place them in any sized container.

### Presets & style

```ts
preset: "default" | "minimal" | "lively" | "glow"

style: {
  size?: number,                  // point-size multiplier (default 1)
  blend?: "normal" | "additive",  // "additive" = glow, for dark backgrounds
  drift?: number,                 // idle/scatter wander 0..1 (default 1; 0 = still)
  sparkle?: number,               // sparkle strength 0..1 (default 1; 0 = off)
}
```

`style` always wins over `preset`. Defaults reproduce the original look exactly.

### Colors

```ts
{ ink?: "#1b2330", accent?: "#0055ff", accentRatio?: 0.18 }
```

`accentRatio` (`0..1`) is the fraction of particles drawn in `accent`.

---

## Accessibility & resilience

- **`prefers-reduced-motion`** → renders `fallback`, no animation.
- **No WebGL** → renders `fallback`, never a blank canvas.
- **SSR-safe** — guards `window`; server render yields static markup.
- **Real text finale** — `resolveToDom` output is selectable, copyable, and screen-reader friendly.

---

## Status

`0.10.0` — the `<GlyphDust>` component and everything above are implemented and demoed
(see [`examples/`](./examples)) and [`CHANGELOG.md`](./CHANGELOG.md). The former React-free
`glyphText()` / CDN path was removed in `0.10.0` to keep the package small and focused
(use `0.9.x` if you need it). Published from [LINNO](https://linno.co.jp).
Semantic-versioned; expect minor API polish before `1.0`.

## License

[MIT](./LICENSE) © [LINNO](https://linno.co.jp) (NOGUCHILin)

> glyphdust is the first open-source product from **LINNO** — built in the open, for the joy of the challenge.
