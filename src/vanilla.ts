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
  DEFAULT_DENSE_FONT,
  DEFAULT_TEXT_FONT,
  buildKeyframeTargets,
  bump,
  isMobile,
  smooth,
} from "./internal/geometry.js";
import { alignGlyphOverlay, viewSizeAtZ0 } from "./dom-overlay.js";
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
  /**
   * 自動再生するか。既定 `true`（時間で 0→1 を進める）。
   * `false` にすると時間では進めず、進捗は {@link GlyphTextHandle.setProgress} で外部から
   * 与える（スクロール連動・GSAP・任意のドライバ用）。スクロールに繋ぐには毎フレーム/毎
   * スクロールで `setProgress(scrollY / scrollable)` を呼ぶ（提案者: 凜さん 2026-07-01）。
   */
  autoplay?: boolean;
  /**
   * {@link GlyphTextHandle.morphTo} / {@link GlyphTextHandle.scatter} の既定モーフ秒数。
   * 既定 1.6（会話テンポ向け。`duration` はあくまで autoplay の 0→1 秒数で別物）。
   */
  morphDuration?: number;
  /**
   * 最初の表示（autoplay / setProgress 駆動の既定キーフレーム）の終端でも、粒子を
   * 本物の実テキストへ凝縮解決する。既定 `true`（morphTo と表現を統一。
   * 提案者: 凜さん 2026-07-02「なんで(最初の)ハローはパーティクルのままなんですか？」）。
   * `false` で従来どおり粒子字形のまま保持。custom `keyframes` / `loop` / `pingpong` /
   * 複数行テキストでは自動的に無効（従来挙動のまま）。
   */
  resolve?: boolean;
  /**
   * 収束点で粒子を実 DOM テキストへ受け渡すか。既定 `false`（粒子字形を保持）。
   * `true` にすると glyphdust 本来の看板挙動になる: 終端で粒子をフェードアウトし、
   * 最後の text キーフレームに紐づく実 DOM 要素（`domSelector` 指定）を crisp な本物の
   * テキストとして出す。先頭 text も `domSelector` があれば冒頭に実文字を出し、swap 点で
   * 粒子へ即切替える。**ピクセル一致には各 text キーフレームに `domSelector` が必要**
   * （実要素の矩形・フォントから粒子を生成し、同位置に実文字を重ねる）。指定が無い
   * キーフレームは従来どおり粒子字形のまま（提案者: 凜さん 2026-07-01。「元々の仕様＝実
   * テキストに解決」を vanilla にも積む）。
   */
  resolveToDom?: boolean;
}

/** {@link GlyphTextHandle.morphTo} のオプション。すべて任意。 */
export interface MorphToOptions {
  /** このモーフにかける秒数。既定 {@link GlyphTextOptions.morphDuration}（1.6）。 */
  duration?: number;
  /**
   * 収束の終端で粒子を「本物のくっきりした実テキスト」へクロスフェードして解決する。
   * 既定 `true`（glyphdust の看板挙動。粒子のままの霞んだ終端にしない。
   * 提案者: 凜さん 2026-07-02「ちゃんとしたテキストに収束するように」）。
   * `false` で従来どおり粒子字形のまま保持。複数行（`\n` 入り）は自動的に粒子フィニッシュ。
   */
  resolve?: boolean;
  /** 字形フォント（`"900 260px 'Helvetica Neue', ..."` 形式）。既定は dense 標準。 */
  font?: string;
  /** 密サンプリング（見出し向けのくっきり字形）。既定 true。 */
  dense?: boolean;
  /** 字形のワールド幅。既定は画面幅から自動。 */
  worldW?: number;
  /** 字形の X オフセット（ワールド単位）。 */
  offsetX?: number;
  /** 字形の Y オフセット（ワールド単位）。 */
  offsetY?: number;
}

/** {@link GlyphTextHandle.scatter} のオプション。すべて任意。 */
export interface ScatterOptions {
  /** このモーフにかける秒数。既定 {@link GlyphTextOptions.morphDuration}（1.6）。 */
  duration?: number;
  /** 飛散雲の半径倍率。既定は `glyphText` の `spread`（1.3）。 */
  spread?: number;
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
  /**
   * 進捗 0..1 を外部から与える（`autoplay:false` 用）。スクロール量や任意のドライバを
   * そのまま渡せる。範囲外は 0..1 にクランプ。autoplay 中でも呼べるが、次の自動更新で
   * 上書きされる。
   */
  setProgress(progress: number): void;
  /**
   * **ストリーミング用**: 表示中の粒子を、その場の姿から新しいテキストへ再収束させる。
   * インスタンス・WebGL コンテキスト・シェーダは作り直さない（毎回 `destroy()` →
   * `glyphText()` する必要が無い）。AI エージェントが「その場で決めた言葉」を次々
   * 出す用途の本命 API（提案者: 凜さん 2026-07-02「ストリーミングでできるようにしたい」）。
   *
   * - モーフ進行中に再度呼ぶと **latest-wins**: 途中の姿から新テキストへ向かい直す。
   *   置き換えられた前の morph の Promise は `false` で解決する。
   * - 順番に見せたいときは `await h.morphTo("A"); await h.morphTo("B");` と待てばよい
   *   （Promise は字形が定着した時点で `true` になる）。
   * - 空文字は {@link scatter} と同じ（雲へ溶ける）。
   * - 呼んだ時点で autoplay / setProgress 駆動のタイムラインからストリーミング駆動へ
   *   移行する（`resolveToDom` の実 DOM 受け渡しは任意テキストと整合しないため停止）。
   * - reduced-motion / WebGL 不可のフォールバック時は静的テキストを書き換えて `true`。
   *
   * @returns 字形に定着したら `true`、後続の morph に置き換えられたか destroy されたら `false`。
   */
  morphTo(text: string, options?: MorphToOptions): Promise<boolean>;
  /** {@link morphTo} の対: 粒子を飛散雲へ溶かす（「話していない」状態の表現に）。 */
  scatter(options?: ScatterOptions): Promise<boolean>;
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

/**
 * 何もしない（フォールバック・要素なし）ハンドル。
 * `fallbackEl` があれば morphTo で静的テキストを書き換える（ストリーミングの
 * アクセシブル版: reduced-motion でもエージェントの言葉は更新される）。
 */
function inertHandle(
  canvas: HTMLCanvasElement | null = null,
  fallbackEl: HTMLElement | null = null,
): GlyphTextHandle {
  return {
    canvas,
    restart() {},
    pause() {},
    play() {},
    setProgress() {},
    morphTo(text: string) {
      if (fallbackEl) fallbackEl.textContent = text.replace(/\n/g, " ");
      return Promise.resolve(true);
    },
    scatter() {
      return Promise.resolve(true);
    },
    destroy() {
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

/** 対象要素に静的な実文字を描く（真っ白防止）。 */
function renderFallback(
  el: HTMLElement,
  text: string,
  colors?: GlyphColors,
): HTMLElement {
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
  return span;
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
    const span = wantFallback ? renderFallback(el, text, options.colors) : null;
    return inertHandle(null, span);
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
      // canvas 実寸（=対象要素の実寸）を渡し、スクロールバー分の横ズレを消す。
      // これが無いと domSelector サンプリングが window.innerWidth 基準になり、粒子字形が
      // 実 DOM 文字から数 px 横へずれる（凜さん 2026-07-01「ちょっとずれてる」）。
      viewportW: w,
      viewportH: h,
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

  // アクティブな補間タイムライン。通常は初期 keyframes のものだが、morphTo（ストリーミング）
  // 開始後は「現在位置スナップショット → 新ターゲット」の 2 点タイムラインへ差し替わる。
  // renderFrame（uniform 算出）と snapshotInto（CPU 位置再現）が同じメタを共有することで、
  // モーフ途中の割り込みでも粒子が飛ばない。
  interface TimelineMeta {
    n: number;
    times: number[];
    isText: boolean[];
    isScatter: boolean[];
    lastIsText: boolean;
    firstIsText: boolean;
    buffers: Float32Array[];
  }
  let tl: TimelineMeta = {
    n,
    times,
    isText,
    isScatter,
    lastIsText: lastIsText === true,
    firstIsText,
    buffers,
  };

  // 実 DOM テキストへの受け渡し（看板機能）。resolveToDom=true のときだけ有効。
  // 先頭/末尾の text キーフレームに紐づく実要素をフェード制御する（粒子はサンプリング元と
  // 同位置なのでクロスフェードで文字が動かない）。
  const resolveMode = options.resolveToDom === true;
  const firstKf = keyframes[0];
  const firstSel =
    firstKf?.type === "text" ? firstKf.domSelector : undefined;
  const firstResolveEl =
    resolveMode && firstIsText && firstSel ? resolveTarget(firstSel) : null;
  const lastKf = keyframes[n - 1];
  const lastSel = lastKf?.type === "text" ? lastKf.domSelector : undefined;
  const lastResolveEl =
    resolveMode && lastSel ? resolveTarget(lastSel) : null;
  // 冒頭の実文字→粒子クロスフェード窓（0→swapWindow で溶け合わせる）。resolveMode 時のみ。
  // 瞬時 swap ではなく短い窓にして「拡散の出だし」を滑らかにする（凜さん 2026-07-01）。
  const swapWindow =
    times[1] !== undefined ? Math.max(times[1] * 0.35, 0.1) : 0.1;
  // 非 resolve 時は進捗 0 から粒子を可視にする（uSwap=1 固定）。ゲートを残すと先頭が
  // 空白になり、特にスクロール駆動で「最初が真っ白」になるため（凜さん 2026-07-01）。

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
  // autoplay=false は手動（スクロール等）駆動。時間では進めず setProgress に従う。
  const manual = options.autoplay === false;
  let playing = manual || options.playOnView === false; // 手動 or playOnView=false なら即「再生中」
  let startMs: number | null = null;
  let lastProgress = 0;
  let lastStage = 0; // 直近フレームの進捗（morphTo のスナップショット基準点）
  let disposed = false;

  // --- ストリーミング（morphTo）状態 ---
  interface StreamState {
    startMs: number;
    duration: number;
    settled: boolean;
    resolve: (converged: boolean) => void;
    /** 終端で立てる実テキスト要素（解決しないモーフでは null）。 */
    resolveEl: HTMLElement | null;
    /** 直前モーフの実テキスト要素（出だしで粒子へ溶かし戻す）。 */
    prevOverlay: HTMLElement | null;
    /** モーフ開始時点の prevOverlay の不透明度（ここから 0 へ落とす）。 */
    prevOverlayOp0: number;
    /** モーフ開始時点の uResolve（粒子の消え具合。ここから 0 へ戻す）。 */
    prevResolve0: number;
  }
  let stream: StreamState | null = null;

  // 実テキスト解決用オーバーレイ（2 枚をピンポン: 前の言葉が消えながら次の言葉が立つ）。
  const overlays: (HTMLElement | null)[] = [null, null];
  const nextOverlay = (avoid: HTMLElement | null): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    const idx = overlays[0] !== null && overlays[0] === avoid ? 1 : 0;
    let o = overlays[idx];
    if (!o) {
      // overlay は el 基準の絶対配置。el が static なら位置基準を持たせる。
      if (
        typeof getComputedStyle !== "undefined" &&
        getComputedStyle(el).position === "static"
      ) {
        el.style.position = "relative";
      }
      o = document.createElement("div");
      o.setAttribute("data-glyphdust-resolve", "");
      o.style.cssText = [
        "position:absolute",
        "opacity:0",
        "pointer-events:none",
        "white-space:nowrap",
        "line-height:1",
        `color:${options.colors?.ink ?? DEFAULT_INK}`,
      ].join(";");
      el.appendChild(o);
      overlays[idx] = o;
    }
    return o;
  };
  let streaming = false; // 一度でも morphTo/scatter したら true（元タイムラインへは戻らない）
  let activeMaterial = material; // stream 移行で N=2 シェーダへ差し替わり得る

  // 最初の表示（既定キーフレーム scatter→text）の終端も morphTo と同じ
  // 「実テキストへ凝縮」で締める（表現の統一）。custom keyframes は resolveToDom
  // （domSelector）の既存機構が担い、loop/pingpong は s が往復して overlay が
  // パカつくため対象外。
  let initResolveEl: HTMLElement | null = null;
  if (
    !options.keyframes &&
    !resolveMode &&
    options.resolve !== false &&
    options.loop !== true &&
    !text.includes("\n")
  ) {
    const o = nextOverlay(null);
    if (o) {
      const initText = text;
      o.textContent = initText;
      o.style.opacity = "0";
      const finalBuf = buffers[n - 1];
      if (finalBuf) {
        const { worldW: visWNow } = viewSizeAtZ0(w, h, cameraFov, cameraZ);
        const aligned = alignGlyphOverlay(o, finalBuf, {
          text: initText,
          font: DEFAULT_DENSE_FONT,
          viewportW: w,
          viewportH: h,
          visibleWorldW: visWNow,
        });
        if (aligned) initResolveEl = o;
      }
    }
  }

  // タイムラインのメタから補間スカラ（settle/burst/form）を算出。
  // renderFrame（毎フレーム uniform 用）と snapshotInto（morphTo の位置再現）で共有する。
  const computeScalars = (s: number) => {
    let settle = 0;
    let burst = 0;
    for (let i = 0; i < tl.n; i++) {
      const c = tl.times[i] ?? 0;
      const prev = tl.times[i - 1] ?? 0;
      const next = tl.times[i + 1] ?? 1;
      const b = bump(s, c, prev, next);
      if (tl.isText[i]) settle = Math.max(settle, b);
      if (tl.isScatter[i]) burst = Math.max(burst, b);
    }

    let form = 0;
    if (tl.lastIsText && tl.n >= 2) {
      form = smooth(tl.times[tl.n - 2] ?? 0, tl.times[tl.n - 1] ?? 1, s);
    }
    if (tl.firstIsText && tl.n >= 2) {
      form = Math.max(form, 1 - smooth(tl.times[0] ?? 0, tl.times[1] ?? 1, s));
    }

    // 終端保持の収束: 最後が text のとき、保持区間（times[n-1]→1.0）で settle を
    // 1 に張り付かせ、粒子の字形を「くっきり密」に定着させる。settle は
    // bump(c=times[n-1], …, next=1) 由来で s=1.0 に向け 0 へ戻るため、これが無いと
    // 保持中にエッジ締め・不透明度・サイズ均一化（uSettle 依存）が抜けて逆に緩んで
    // 見える。form は最終遷移で 1 に達し 1.0 まで保持するのでそれを下限に使う
    // （resolve しない vanilla は粒子の字形がそのまま最終絵。提案者: 凜さん 2026-07-01 指摘）。
    if (tl.lastIsText) settle = Math.max(settle, form);

    return { settle, burst, form };
  };

  // ストリーミング駆動の進捗（モーフ開始からの経過秒 / duration）。
  const streamProgress = (): number => {
    if (!stream || typeof performance === "undefined") return lastProgress;
    const elapsed = (performance.now() - stream.startMs) / 1000;
    lastProgress = Math.min(1, Math.max(0, elapsed / stream.duration));
    return lastProgress;
  };

  const renderFrame = () => {
    // 駆動源の優先順: ストリーミング > 手動(setProgress) > autoplay。
    const raw = stream
      ? streamProgress()
      : manual
        ? lastProgress
        : playing
          ? progressNow()
          : lastProgress;
    const s = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    lastStage = s;

    const { settle, burst, form } = computeScalars(s);

    u.uTime!.value = elapsedSeconds();
    u.uStage!.value = s;
    u.uForm!.value = form;
    u.uSettle!.value = settle;
    u.uBurst!.value = burst * (1 - form);
    // ストリーミング中は実 DOM 受け渡し（resolve）を使わない（任意テキストと整合しない）。
    if (resolveMode && !streaming) {
      // 拡散（冒頭）: 実文字→粒子を swap 点で瞬時に切らず、短い窓でクロスフェードして
      // 滑らかに散り出す。粒子はこの区間ではまだ字形（同位置）なので、実文字と溶け合う。
      const swapIn = smooth(0, swapWindow, s); // 0→1
      // 収束（終端）: 字形完成(≈0.85)直後からゆっくり粒子を消し、実文字をゆるやかに立てる。
      // 窓を広く重ねることで「硬い切替」を無くし、なめらかに集まって実テキストへ解決する。
      const resolve = smooth(0.85, 1.0, s);
      const textReveal = smooth(0.88, 1.0, s);
      u.uSwap!.value = swapIn;
      u.uResolve!.value = resolve;
      if (firstResolveEl) firstResolveEl.style.opacity = String(1 - swapIn);
      if (lastResolveEl) lastResolveEl.style.opacity = String(textReveal);
    } else if (stream) {
      u.uSwap!.value = 1;
      // 出だし: 直前モーフの実テキストを「ぼやけながら」粒子へ溶かし戻す
      // （フェードだけだと消えた瞬間が分かる。ボケを足すと粒子雲に還る感じになる）。
      const back = smooth(0, 0.22, s); // 0→1
      const backResolve = stream.prevResolve0 * (1 - back);
      // 終端: 「収束が終わってから切り替える」のをやめる。粒子がまだ飛んでいる最中
      // （字形形成 0.8 より手前）から実テキストを強いボケ＋低不透明度で滲み出させ、
      // 粒子の着地と同時にピントが合い、着地した粒子から溶けて一体化する。
      // 2 段階（収束完了→切替）が知覚できた旧カーブ（resolve 0.8→0.99 / reveal 0.82→1.0）
      // への凜さんフィードバック 2026-07-02「パーティクルが収束してその後テキストに
      // 切り替わるのがわかっちゃう。自然にパーティクルからテキストになるように」を受けた設計。
      const endResolve = stream.resolveEl ? smooth(0.68, 0.97, s) : 0;
      const reveal = stream.resolveEl ? smooth(0.52, 0.92, s) : 0;
      u.uResolve!.value = Math.max(backResolve, endResolve);
      if (stream.prevOverlay && stream.prevOverlay !== stream.resolveEl) {
        const prevOp = stream.prevOverlayOp0 * (1 - back);
        stream.prevOverlay.style.opacity = String(prevOp);
        const prevBlur = back * 6;
        stream.prevOverlay.style.filter =
          prevBlur > 0.1 && prevOp > 0.01 ? `blur(${prevBlur.toFixed(1)}px)` : "";
      }
      if (stream.resolveEl) {
        stream.resolveEl.style.opacity = String(reveal);
        // 粒子雲の「まだ形になっていない」うちは強くぼかし、着地に合わせてピントを合わせる。
        const blur = (1 - smooth(0.52, 0.97, s)) * 7;
        stream.resolveEl.style.filter =
          blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : "";
      }
    } else {
      u.uSwap!.value = 1; // 進捗 0 から可視（実 DOM 文字の受け渡しゲート無し）
      if (initResolveEl) {
        // 最初の表示の終端も morphTo と同じ「凝縮して実テキストになる」カーブで締める。
        const endResolve = smooth(0.68, 0.97, s);
        const reveal = smooth(0.52, 0.92, s);
        u.uResolve!.value = endResolve;
        initResolveEl.style.opacity = String(reveal);
        const blur = (1 - smooth(0.52, 0.97, s)) * 7;
        initResolveEl.style.filter =
          blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : "";
      } else {
        u.uResolve!.value = 0;
      }
    }

    // モーフ完走（保持区間まで到達）で Promise を解決。ループは止めない
    // （uTime の漂いで「生きて待っている」見た目を保つ。autoplay 定着後と同じ扱い）。
    if (stream && !stream.settled && s >= 1) {
      stream.settled = true;
      stream.resolve(true);
    }

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

  // --- ストリーミング（morphTo / scatter）---
  const morphDurationDefault = options.morphDuration ?? 1.6;

  // シェーダの smoothRange と同じカーブ（uSmoother 切替を style.easing で再現）。
  const smoothMix = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return style.easing === "smoothstep"
      ? t * t * (3 - 2 * t)
      : t * t * t * (t * (t * 6 - 15) + 10);
  };

  /**
   * 「いま画面に見えている粒子位置」を CPU で再現して out に書く。
   * 頂点シェーダの位置決定（stagger 済み進捗 → mix 連鎖 → burst オフセット）と同じ式。
   * ドリフト（uTime の漂い）だけは省く: 振幅 ≤0.06 ワールド単位のゆらぎで、モーフの
   * 移動量に対して視認できないため（ここで uTime まで再現する価値がない）。
   */
  const snapshotInto = (out: Float32Array) => {
    const s = lastStage;
    const { burst, form } = computeScalars(s);
    const burstAmt = burst * (1 - form); // renderFrame が uBurst に入れる値と同じ
    const w = style.stagger * (1 - smoothMix(0.55, 0.85, s));
    const invW = 1 / Math.max(1 - w, 0.001);
    const bufs = tl.buffers;
    const first = bufs[0];
    if (!first) return;
    for (let i = 0; i < count; i++) {
      const sd = seed[i] ?? 0;
      const stageP = Math.min(1, Math.max(0, (s - sd * w) * invW));
      let x = first[i * 3] ?? 0;
      let y = first[i * 3 + 1] ?? 0;
      let z = first[i * 3 + 2] ?? 0;
      for (let k = 0; k < tl.n - 1; k++) {
        const next = bufs[k + 1];
        if (!next) break;
        const t = smoothMix(tl.times[k] ?? 0, tl.times[k + 1] ?? 1, stageP);
        x += ((next[i * 3] ?? 0) - x) * t;
        y += ((next[i * 3 + 1] ?? 0) - y) * t;
        z += ((next[i * 3 + 2] ?? 0) - z) * t;
      }
      if (burstAmt > 0.001) {
        const len = Math.hypot(x, y, z) + 0.0001;
        const f = (burstAmt * (0.4 + sd * 0.6)) / len;
        x += x * f;
        y += y * f;
        z += z * f;
      }
      out[i * 3] = x;
      out[i * 3 + 1] = y;
      out[i * 3 + 2] = z;
    }
  };

  /**
   * ストリーミングモーフを開始:「現在位置スナップショット → target」の 2 点タイムラインへ
   * 差し替え、進捗クロックをリセットする。WebGL コンテキスト・geometry・粒子数は既存の
   * まま（シェーダだけ、初回かつ元キーフレーム数 ≠ 2 のとき N=2 版へ 1 度だけ差し替え）。
   */
  const beginStream = (
    target: Float32Array,
    targetIsText: boolean,
    duration: number,
    // 終端で立てる実テキスト（text と、粒子サンプリングに使った font）。null なら粒子フィニッシュ。
    resolveInfo: { text: string; font: string } | null,
  ): Promise<boolean> => {
    // スナップショットは属性書き換えの前に取る（元バッファを参照するため）。
    const from = new Float32Array(count * 3);
    snapshotInto(from);

    if (!streaming) {
      streaming = true;
      // 実 DOM 受け渡し要素は任意テキストと整合しないので引っ込める。
      if (firstResolveEl) firstResolveEl.style.opacity = "0";
      if (lastResolveEl) lastResolveEl.style.opacity = "0";
      // 元キーフレーム数 ≠ 2 なら N=2 シェーダへ移行（uniforms は共有し、旧のみ破棄）。
      if (n !== 2) {
        const mat2 = new THREE.ShaderMaterial({
          uniforms: u,
          transparent: true,
          depthWrite: false,
          blending: activeMaterial.blending,
          vertexShader: buildVertexShader(2),
          fragmentShader: FRAGMENT_SHADER,
        });
        points.material = mat2;
        activeMaterial.dispose();
        activeMaterial = mat2;
      }
      // n === 1 で aPos1 が無いケースに備えて確保。
      if (!geo.getAttribute(glyphPositionAttribute(1))) {
        geo.setAttribute(
          glyphPositionAttribute(1),
          new THREE.BufferAttribute(new Float32Array(count * 3), 3),
        );
      }
    }

    const a0 = geo.getAttribute(glyphPositionAttribute(0)) as THREE.BufferAttribute;
    const a1 = geo.getAttribute(glyphPositionAttribute(1)) as THREE.BufferAttribute;
    (a0.array as Float32Array).set(from);
    (a1.array as Float32Array).set(target);
    a0.needsUpdate = true;
    a1.needsUpdate = true;

    // 最後が text なら 0.8 で形成し切り、残り 0.8→1.0 を実テキストへの
    // ゆったりしたクロスフェードに使う（0.85 では溶け合う時間が足りず切替が硬い）。
    const settleAt = targetIsText ? 0.8 : 1;
    tl = {
      n: 2,
      times: [0, settleAt],
      isText: [false, targetIsText],
      isScatter: [false, !targetIsText],
      lastIsText: targetIsText,
      firstIsText: false,
      buffers: [a0.array as Float32Array, a1.array as Float32Array],
    };
    u.uTimes!.value = [0, settleAt];

    // 直前モーフの実テキスト・粒子フェード状態を引き継ぐ（割り込みでも硬い切替をしない）。
    // 初回 morph では「最初の表示」の解決テキスト（initResolveEl）が引き継ぎ元。
    const prevOverlay = stream?.resolveEl ?? initResolveEl;
    const prevOverlayOp0 = prevOverlay
      ? Math.min(1, Math.max(0, parseFloat(prevOverlay.style.opacity || "0") || 0))
      : 0;
    const rawResolve = u.uResolve!.value;
    const prevResolve0 =
      typeof rawResolve === "number" ? Math.min(1, Math.max(0, rawResolve)) : 0;

    // 終端で立てる実テキスト要素を用意し、粒子字形の矩形へピクセル整列させておく。
    let resolveEl: HTMLElement | null = null;
    if (resolveInfo) {
      const o = nextOverlay(prevOverlay);
      if (o) {
        o.textContent = resolveInfo.text;
        o.style.opacity = "0";
        const { worldW: visWNow } = viewSizeAtZ0(w, h, cameraFov, cameraZ);
        const aligned = alignGlyphOverlay(o, target, {
          text: resolveInfo.text,
          font: resolveInfo.font,
          viewportW: w,
          viewportH: h,
          visibleWorldW: visWNow,
        });
        if (aligned) resolveEl = o;
      }
    }

    // 進行中のモーフは latest-wins: 置き換えられた側の Promise は false で返す。
    if (stream && !stream.settled) {
      stream.settled = true;
      stream.resolve(false);
    }
    lastProgress = 0;
    lastStage = 0;
    let resolveFn: (converged: boolean) => void = () => {};
    const promise = new Promise<boolean>((res) => {
      resolveFn = res;
    });
    stream = {
      startMs: typeof performance !== "undefined" ? performance.now() : 0,
      duration: Math.max(0.05, duration),
      settled: false,
      resolve: resolveFn,
      resolveEl,
      prevOverlay,
      prevOverlayOp0,
      prevResolve0,
    };

    // 画面外 pause 中でも必ず動かす（エージェントの発話は待たせない）。
    playing = true;
    startLoop();
    return promise;
  };

  const morphToImpl = (
    text: string,
    opts: MorphToOptions = {},
  ): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    // 空文字は「言葉が無い」= 雲へ溶ける。
    if (!text || text.trim() === "") {
      return scatterImpl(
        opts.duration !== undefined ? { duration: opts.duration } : {},
      );
    }
    const { worldW: visWNow } = viewSizeAtZ0(w, h, cameraFov, cameraZ);
    const target = buildKeyframeTargets(
      {
        type: "text",
        text,
        dense: opts.dense ?? true,
        ...(opts.font !== undefined ? { font: opts.font } : {}),
        ...(opts.worldW !== undefined ? { worldW: opts.worldW } : {}),
        ...(opts.offsetX !== undefined ? { offsetX: opts.offsetX } : {}),
        ...(opts.offsetY !== undefined ? { offsetY: opts.offsetY } : {}),
      },
      count,
      {
        visW: visWNow,
        mobile,
        cameraFov,
        cameraZ,
        scatterPattern: style.scatterPattern,
        viewportW: w,
        viewportH: h,
      },
    );
    // 終端は既定で本物の実テキストへ解決する（複数行は overlay 整列が単一行前提のため粒子フィニッシュ）。
    const fontUsed =
      opts.font ??
      ((opts.dense ?? true) ? DEFAULT_DENSE_FONT : DEFAULT_TEXT_FONT);
    const resolveInfo =
      opts.resolve !== false && !text.includes("\n")
        ? { text, font: fontUsed }
        : null;
    return beginStream(
      target,
      true,
      opts.duration ?? morphDurationDefault,
      resolveInfo,
    );
  };

  const scatterImpl = (opts: ScatterOptions = {}): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    const { worldW: visWNow } = viewSizeAtZ0(w, h, cameraFov, cameraZ);
    const target = buildKeyframeTargets(
      { type: "scatter", spread: opts.spread ?? options.spread ?? 1.3 },
      count,
      {
        visW: visWNow,
        mobile,
        cameraFov,
        cameraZ,
        scatterPattern: style.scatterPattern,
        viewportW: w,
        viewportH: h,
      },
    );
    return beginStream(target, false, opts.duration ?? morphDurationDefault, null);
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
      // ストリーミング中は「直近のモーフ」を最初からやり直す（元タイムラインには戻らない）。
      if (stream && typeof performance !== "undefined") {
        stream.startMs = performance.now();
      }
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
    setProgress(progress: number) {
      if (disposed) return;
      const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
      lastProgress = Number.isFinite(p) ? p : 0;
      // ループが回っていなければ（画面外・手動で停止中など）1 枚だけ描いて反映する。
      if (!running) renderFrame();
    },
    morphTo(text: string, opts?: MorphToOptions) {
      return morphToImpl(text, opts);
    },
    scatter(opts?: ScatterOptions) {
      return scatterImpl(opts);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      if (stream && !stream.settled) {
        stream.settled = true;
        stream.resolve(false);
      }
      stream = null;
      stopLoop();
      ro?.disconnect();
      io?.disconnect();
      geo.dispose();
      activeMaterial.dispose();
      renderer.dispose();
      for (const o of overlays) {
        if (o && o.parentNode) o.parentNode.removeChild(o);
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}
