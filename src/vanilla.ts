/**
 * vanilla.ts — React 不要の最小ワンコール API。
 *
 *   import { glyphText } from "glyphdust";
 *   const h = glyphText("#hero", "LINNO");
 *   // …
 *   h.destroy();
 *
 * three.js を内部で勝手に立て、対象要素いっぱいに canvas を敷き、
 * 「粒子が飛んできて文字に集まり、少し止まる」を autoplay で再生する。
 * 設定はすべて任意（preset 任せ）。AI エージェントが「1 import + 1 call」を
 * 生成するだけで動くことを最優先にした入口。
 *
 * R3F 版 {@link import("./GlyphDust.js").GlyphDust} と同じ粒子幾何・補間カーブを
 * {@link import("./internal/geometry.js")} 経由で共有する（質感を一致させる）。
 */

import * as THREE from "three";

import {
  buildKeyframeTargets,
  bump,
  isMobile,
  smooth,
} from "./internal/geometry.js";
import { viewSizeAtZ0 } from "./dom-overlay.js";
import {
  buildVertexShader,
  FRAGMENT_SHADER,
  glyphPositionAttribute,
} from "./shaders.js";
import { computeAutoplayProgress } from "./drivers.js";
import { prefersReducedMotion } from "./prefers-reduced-motion.js";
import type { GlyphColors, GlyphPreset, GlyphStyle, Keyframe } from "./types.js";

/** {@link glyphText} のオプション。すべて任意。 */
export interface GlyphTextOptions {
  /**
   * キーフレーム列を明示する（上級者向け）。
   * 未指定なら「飛散 → 文字（dense）」の標準シーケンスを自動生成する。
   */
  keyframes?: Keyframe[];
  /** 質感プリセット。既定 `"default"`。`style` で部分上書き可。 */
  preset?: GlyphPreset;
  /** 粒子の見た目・モーションの個別上書き（プリセットより優先）。 */
  style?: GlyphStyle;
  /** 配色。 */
  colors?: GlyphColors;
  /** 粒子数。既定 デスクトップ 11000 / モバイル 5200。 */
  count?: number;
  /** カメラ z 位置。既定 7。 */
  cameraZ?: number;
  /** カメラ縦 fov（度）。既定 42。 */
  cameraFov?: number;
  /** 飛散雲の半径倍率（自動キーフレーム時のみ）。既定 1.3。 */
  spread?: number;
  /** 0→1 にかける秒数。既定 3.6。 */
  duration?: number;
  /** 再生開始までの遅延秒。既定 0。 */
  delay?: number;
  /** ループ再生。既定 false（1 回で文字に定着して止まる）。 */
  loop?: boolean;
  /** ループ時に 0→1→0 を往復（loop 必須）。既定 false。 */
  pingpong?: boolean;
  /** 画面内に入ってから再生開始（IntersectionObserver）。既定 true。 */
  playOnView?: boolean;
  /** devicePixelRatio の上限。既定 1.75。 */
  maxDpr?: number;
  /**
   * reduced-motion / WebGL 不可時に対象要素へ静的フォールバックを描く。既定 true。
   * false にすると何も描かない（真っ白）。
   */
  fallback?: boolean;
}

/** {@link glyphText} が返す操作ハンドル。 */
export interface GlyphTextHandle {
  /** 生成した canvas（フォールバック時は null）。 */
  readonly canvas: HTMLCanvasElement | null;
  /** 再生を最初から始める。 */
  restart(): void;
  /** 一時停止（rAF を止める）。 */
  pause(): void;
  /** 再開。 */
  play(): void;
  /** すべて破棄（canvas 除去・three リソース解放・監視解除）。冪等。 */
  destroy(): void;
}

const DEFAULT_INK = "#1b2330";
const DEFAULT_ACCENT = "#0055ff";
const DEFAULT_ACCENT_RATIO = 0.18;
const DEFAULT_COUNT_DESKTOP = 11000;
const DEFAULT_COUNT_MOBILE = 5200;

const SMOOTH = "smootherstep" as const;
const FIB = "fibonacci" as const;

interface ResolvedStyle {
  size: number;
  blend: "normal" | "additive";
  drift: number;
  sparkle: number;
  stagger: number;
  curl: number;
  easing: "smoothstep" | "smootherstep";
  scatterPattern: "random" | "fibonacci";
}

const PRESETS: Record<GlyphPreset, ResolvedStyle> = {
  default: { size: 1, blend: "normal", drift: 1, sparkle: 1, stagger: 0.08, curl: 1, easing: SMOOTH, scatterPattern: FIB },
  minimal: { size: 0.92, blend: "normal", drift: 0.35, sparkle: 0, stagger: 0.04, curl: 0, easing: SMOOTH, scatterPattern: FIB },
  lively: { size: 1.05, blend: "normal", drift: 1.4, sparkle: 1.4, stagger: 0.12, curl: 1.3, easing: SMOOTH, scatterPattern: FIB },
  glow: { size: 1.1, blend: "additive", drift: 1.1, sparkle: 1.5, stagger: 0.1, curl: 1.1, easing: SMOOTH, scatterPattern: FIB },
};

function resolveStyle(preset: GlyphPreset, style?: GlyphStyle): ResolvedStyle {
  const base = PRESETS[preset] ?? PRESETS.default;
  return {
    size: style?.size ?? base.size,
    blend: style?.blend ?? base.blend,
    drift: style?.drift ?? base.drift,
    sparkle: style?.sparkle ?? base.sparkle,
    stagger: style?.stagger ?? base.stagger,
    curl: style?.curl ?? base.curl,
    easing: style?.easing ?? base.easing,
    scatterPattern: style?.scatterPattern ?? base.scatterPattern,
  };
}

function isWebGLAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

function resolveTarget(target: string | HTMLElement): HTMLElement | null {
  if (typeof target === "string") {
    if (typeof document === "undefined") return null;
    return document.querySelector<HTMLElement>(target);
  }
  return target ?? null;
}

/** 何もしない（フォールバック・要素なし）ハンドル。 */
function inertHandle(canvas: HTMLCanvasElement | null = null): GlyphTextHandle {
  return {
    canvas,
    restart() {},
    pause() {},
    play() {},
    destroy() {
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

/** 対象要素に静的な実文字を描く（真っ白防止）。 */
function renderFallback(el: HTMLElement, text: string, colors?: GlyphColors) {
  const span = document.createElement("div");
  span.textContent = text.replace(/\n/g, " ");
  span.setAttribute("data-glyphdust-fallback", "");
  span.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "width:100%",
    "height:100%",
    "font-weight:900",
    "line-height:1.1",
    "text-align:center",
    "white-space:pre-line",
    `color:${colors?.ink ?? DEFAULT_INK}`,
  ].join(";");
  el.appendChild(span);
}

/**
 * 文字を粒子で描くワンコール API。React も `<Canvas>` も不要。
 *
 * @param target  描画先（CSS セレクタ or 要素）。要素いっぱいに canvas を敷く。
 * @param text    描く文字。`\n` で改行。
 * @param options 任意設定（preset 任せでよい）。
 * @returns 操作ハンドル（`destroy()` で完全撤去）。
 */
export function glyphText(
  target: string | HTMLElement,
  text: string,
  options: GlyphTextOptions = {},
): GlyphTextHandle {
  const el = resolveTarget(target);
  if (el === null) {
    if (typeof console !== "undefined") {
      console.warn(`[glyphdust] target が見つかりません: ${String(target)}`);
    }
    return inertHandle();
  }

  const wantFallback = options.fallback !== false;
  if (prefersReducedMotion() || !isWebGLAvailable()) {
    if (wantFallback) renderFallback(el, text, options.colors);
    return inertHandle();
  }

  const mobile = isMobile();
  const count =
    options.count ?? (mobile ? DEFAULT_COUNT_MOBILE : DEFAULT_COUNT_DESKTOP);
  const cameraZ = options.cameraZ ?? 7;
  const cameraFov = options.cameraFov ?? 42;
  const maxDpr = options.maxDpr ?? 1.75;
  const duration = options.duration ?? 3.6;
  const style = resolveStyle(options.preset ?? "default", options.style);

  // 既定キーフレーム: 飛散 → 文字（dense）。最後が文字なので 0.85 で形成し切り、
  // 0.85→1.0 を「くっきり保持して少し止まる」区間にする。
  const keyframes: Keyframe[] = options.keyframes ?? [
    { type: "scatter", spread: options.spread ?? 1.3 },
    { type: "text", text, dense: true },
  ];
  const n = keyframes.length;

  const ink = new THREE.Color(options.colors?.ink ?? DEFAULT_INK);
  const accent = new THREE.Color(options.colors?.accent ?? DEFAULT_ACCENT);
  const accentRatio = options.colors?.accentRatio ?? DEFAULT_ACCENT_RATIO;

  // --- サイズ（対象要素の実寸。0 のときは無難な既定へ） ---
  const measure = () => {
    const w = el.clientWidth || 480;
    const h = el.clientHeight || 320;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  };
  let { w, h } = measure();

  // --- three セットアップ ---
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setSize(w, h, false);

  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  el.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(cameraFov, w / h, 0.1, 100);
  camera.position.set(0, 0, cameraZ);

  // --- geometry ---
  const { worldW: visW } = viewSizeAtZ0(w, h, cameraFov, cameraZ);
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(count);
  const accentAttr = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    seed[i] = Math.random();
    accentAttr[i] = Math.random() < accentRatio ? 1 : 0;
  }
  const buffers = keyframes.map((kf) =>
    buildKeyframeTargets(kf, count, {
      visW,
      mobile,
      cameraFov,
      cameraZ,
      scatterPattern: style.scatterPattern,
    }),
  );
  buffers.forEach((buf, i) => {
    geo.setAttribute(glyphPositionAttribute(i), new THREE.BufferAttribute(buf, 3));
  });
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aAccent", new THREE.BufferAttribute(accentAttr, 1));
  const first = buffers[0] ?? new Float32Array(count * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(first.slice(), 3));
  geo.computeBoundingSphere();

  // --- material ---
  const vertexShader = buildVertexShader(Math.max(n, 1));
  // 各キーフレームの正規化時刻（最後が文字なら 0.85 で形成し切る）。
  const lastIsText = keyframes[n - 1]?.type === "text";
  const end = lastIsText ? 0.85 : 1;
  const times =
    n <= 1 ? [0] : Array.from({ length: n }, (_, i) => (i / (n - 1)) * end);
  const isText = keyframes.map((k) => k.type === "text");
  const isScatter = keyframes.map((k) => k.type === "scatter");
  const firstIsText = isText[0] === true;
  const swapAt = times[1] !== undefined ? times[1] * 0.15 : 0;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStage: { value: 0 },
      uTimes: { value: times.slice() },
      uForm: { value: 0 },
      uSettle: { value: 0 },
      uBurst: { value: 0 },
      uSwap: { value: 0 },
      uResolve: { value: 0 },
      uReduced: { value: 0 },
      uPointer: { value: new THREE.Vector3(0, 0, 0) },
      uPointerActive: { value: 0 },
      uSize: { value: 1 },
      uSizeScale: { value: style.size },
      uDrift: { value: style.drift },
      uStagger: { value: style.stagger },
      // curl noise はモバイルで負荷が高いので軽量パス（0）へフォールバック。
      uCurl: { value: mobile ? 0 : style.curl },
      uSmoother: { value: style.easing === "smoothstep" ? 0 : 1 },
      uSparkle: { value: style.sparkle },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 3) },
      uColorInk: { value: ink.clone() },
      uColorAccent: { value: accent.clone() },
    },
    transparent: true,
    depthWrite: false,
    blending:
      style.blend === "additive"
        ? THREE.AdditiveBlending
        : THREE.NormalBlending,
    vertexShader,
    fragmentShader: FRAGMENT_SHADER,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  scene.add(points);

  const u = material.uniforms;
  const applySizeUniforms = () => {
    u.uPixelRatio!.value = Math.min(window.devicePixelRatio || 1, 3);
    u.uSize!.value = Math.min(h / 18, 26);
  };
  applySizeUniforms();

  // --- 再生制御 ---
  // uTime（シェーダのアイドル漂い/きらめき用）は単調増加の経過秒。
  // THREE.Clock は deprecated なので performance.now() ベースで自前計時する。
  const epochMs =
    typeof performance !== "undefined" ? performance.now() : 0;
  const elapsedSeconds = () =>
    typeof performance !== "undefined" ? (performance.now() - epochMs) / 1000 : 0;
  let rafId = 0;
  let running = false;
  let playing = options.playOnView === false; // playOnView=false なら即再生
  let startMs: number | null = null;
  let lastProgress = 0;
  let disposed = false;

  const renderFrame = () => {
    const raw = playing ? progressNow() : lastProgress;
    const s = raw < 0 ? 0 : raw > 1 ? 1 : raw;

    let settle = 0;
    let burst = 0;
    for (let i = 0; i < n; i++) {
      const c = times[i] ?? 0;
      const prev = times[i - 1] ?? 0;
      const next = times[i + 1] ?? 1;
      const b = bump(s, c, prev, next);
      if (isText[i]) settle = Math.max(settle, b);
      if (isScatter[i]) burst = Math.max(burst, b);
    }

    let form = 0;
    if (lastIsText && n >= 2) {
      form = smooth(times[n - 2] ?? 0, times[n - 1] ?? 1, s);
    }
    if (firstIsText && n >= 2) {
      form = Math.max(form, 1 - smooth(times[0] ?? 0, times[1] ?? 1, s));
    }

    // 終端保持の収束: 最後が text のとき、保持区間（times[n-1]→1.0）で settle を
    // 1 に張り付かせ、粒子の字形を「くっきり密」に定着させる。settle は
    // bump(c=times[n-1], …, next=1) 由来で s=1.0 に向け 0 へ戻るため、これが無いと
    // 保持中にエッジ締め・不透明度・サイズ均一化（uSettle 依存）が抜けて逆に緩んで
    // 見える。form は最終遷移で 1 に達し 1.0 まで保持するのでそれを下限に使う
    // （resolve しない vanilla は粒子の字形がそのまま最終絵。提案者: 凜さん 2026-07-01 指摘）。
    if (lastIsText) settle = Math.max(settle, form);

    u.uTime!.value = elapsedSeconds();
    u.uStage!.value = s;
    u.uForm!.value = form;
    u.uSettle!.value = settle;
    u.uBurst!.value = burst * (1 - form);
    u.uSwap!.value = raw >= swapAt ? 1 : 0;
    u.uResolve!.value = 0;
    u.uPointerActive!.value = 0;

    renderer.render(scene, camera);
  };

  const progressNow = (): number => {
    if (typeof performance === "undefined") return lastProgress;
    if (startMs === null) startMs = performance.now();
    const elapsed = (performance.now() - startMs) / 1000;
    lastProgress = computeAutoplayProgress(elapsed, {
      duration,
      delay: options.delay ?? 0,
      loop: options.loop ?? false,
      pingpong: options.pingpong ?? false,
    });
    return lastProgress;
  };

  const loop = () => {
    if (disposed) return;
    renderFrame();
    rafId = requestAnimationFrame(loop);
  };

  const startLoop = () => {
    if (running || disposed) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  };
  const stopLoop = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  // --- 監視（リサイズ・画面内）---
  const onResize = () => {
    const next = measure();
    w = next.w;
    h = next.h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applySizeUniforms();
  };
  const ro =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  ro?.observe(el);

  let io: IntersectionObserver | null = null;
  const playOnView = options.playOnView !== false;
  if (playOnView && typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            if (!playing) {
              playing = true;
              startMs = null; // 入った瞬間を開始点に
            }
            startLoop();
          } else {
            stopLoop(); // 画面外では止めて省電力
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
  } else {
    playing = true;
    startLoop();
  }

  return {
    canvas,
    restart() {
      startMs = null;
      lastProgress = 0;
      playing = true;
      startLoop();
    },
    pause() {
      playing = false;
      stopLoop();
      renderFrame(); // 最後の状態を 1 枚描いておく
    },
    play() {
      playing = true;
      startLoop();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      stopLoop();
      ro?.disconnect();
      io?.disconnect();
      geo.dispose();
      material.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}
