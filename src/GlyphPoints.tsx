/**
 * GlyphPoints.tsx — THREE.Points + ShaderMaterial 本体。
 *
 * keyframes から各キーフレームの位置ターゲット（aPos0..aPosN-1）を生成し、
 * 進捗 0→1 を毎フレーム読んで補間スカラ（stage/form/settle/burst/swap/resolve）を
 * 算出し uniform に流す。位置補間自体はシェーダ（{@link buildVertexShader}）が行う。
 */

import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import {
  buildTextTargets,
  buildDenseTextTargets,
  type Random,
} from "./sampling.js";
import {
  buildGlyphFromDOM,
  computeScreenRect,
  viewSizeAtZ0,
} from "./dom-overlay.js";
import {
  buildVertexShader,
  FRAGMENT_SHADER,
  glyphPositionAttribute,
} from "./shaders.js";
import type { Keyframe } from "./types.js";

/** GlyphPoints が解決済みで受け取る配色。 */
export interface ResolvedColors {
  ink: THREE.Color;
  accent: THREE.Color;
  accentRatio: number;
}

/** GlyphPoints が解決済みで受け取る質感（プリセット＋上書き済み）。 */
export interface ResolvedStyle {
  size: number;
  blend: "normal" | "additive";
  drift: number;
  sparkle: number;
}

/**
 * シェーダの uniform 群（型付き）。
 * r3f は `uniforms` prop をクローンしてマテリアルへ適用するため、
 * 毎フレームの更新は必ず `material.uniforms`（このクローン側）を直接ミューテートする。
 * 元の useMemo オブジェクトを更新しても GPU には届かない。
 */
interface GlyphUniforms {
  uTime: THREE.IUniform<number>;
  uStage: THREE.IUniform<number>;
  uTimes: THREE.IUniform<number[]>;
  uForm: THREE.IUniform<number>;
  uSettle: THREE.IUniform<number>;
  uBurst: THREE.IUniform<number>;
  uSwap: THREE.IUniform<number>;
  uResolve: THREE.IUniform<number>;
  uReduced: THREE.IUniform<number>;
  uPointer: THREE.IUniform<THREE.Vector3>;
  uPointerActive: THREE.IUniform<number>;
  uSize: THREE.IUniform<number>;
  uSizeScale: THREE.IUniform<number>;
  uDrift: THREE.IUniform<number>;
  uSparkle: THREE.IUniform<number>;
  uPixelRatio: THREE.IUniform<number>;
  uColorInk: THREE.IUniform<THREE.Color>;
  uColorAccent: THREE.IUniform<THREE.Color>;
}

/** GlyphPoints が解決済みで受け取る設定。 */
export interface GlyphPointsProps {
  keyframes: Keyframe[];
  count: number;
  colors: ResolvedColors;
  style: ResolvedStyle;
  cameraZ: number;
  cameraFov: number;
  pointer: boolean;
  drag: boolean;
  getProgress: () => number;
  /** 各キーフレームの正規化時刻（省略時は等間隔）。 */
  timing?: number[] | undefined;
  /** resolveToDom 用の実文字オーバーレイ要素。 */
  resolveRef?: RefObject<HTMLDivElement | null> | undefined;
  /**
   * resolveToDom の解決先が「ユーザーの実 DOM 要素」のときのセレクタ。
   * 指定時は自前オーバーレイを使わず、粒子がピクセル整列している
   * その実要素の不透明度を直接フェードする（整列が原理保証される）。
   */
  resolveDomSelector?: string | undefined;
}

const DEFAULT_TEXT_FONT =
  "700 140px system-ui, 'Hiragino Sans', 'Noto Sans JP', sans-serif";
const DEFAULT_DENSE_FONT =
  "900 260px 'Helvetica Neue', Helvetica, Arial, sans-serif";

function isMobile(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches
  );
}

function smooth(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 中心 c で 1、左右の neighbor 時刻でほぼ 0 になる山。 */
function bump(x: number, c: number, prev: number, next: number): number {
  const rise = c <= 0 ? 1 : smooth(prev, c, x);
  const fall = c >= 1 ? 1 : 1 - smooth(c, next, x);
  return rise * fall;
}

/** 飛散雲（ランダム球殻）を生成。 */
function buildScatter(
  count: number,
  spread: number,
  random: Random,
): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = (3.0 + Math.cbrt(random()) * 2.6) * spread;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    out[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    out[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.8;
    out[i * 3 + 2] = r * Math.cos(phi) * 0.9;
  }
  return out;
}

/** 1 つのキーフレームの位置ターゲットを生成。 */
function buildKeyframeTargets(
  kf: Keyframe,
  count: number,
  ctx: { visW: number; mobile: boolean; cameraFov: number; cameraZ: number },
): Float32Array {
  if (kf.type === "scatter") {
    return buildScatter(count, kf.spread ?? 1, Math.random);
  }

  const lines = kf.text.split("\n");

  // 実 DOM 要素に重ねる（取得できればピクセル一致）。
  if (kf.domSelector) {
    const dom = buildGlyphFromDOM(count, lines, {
      selector: kf.domSelector,
      fovDeg: ctx.cameraFov,
      cameraZ: ctx.cameraZ,
    });
    if (dom) return dom;
    // 取れなければ通常サンプリングへフォールバック。
  }

  if (kf.dense) {
    return buildDenseTextTargets(count, lines, {
      font: kf.font ?? DEFAULT_DENSE_FONT,
      worldW: kf.worldW ?? ctx.visW * (ctx.mobile ? 0.86 : 0.62),
      offsetX: kf.offsetX ?? 0,
      offsetY: kf.offsetY ?? 0,
      thickness: 0.06,
      cw: 1400,
      ch: 440,
      step: 1,
    });
  }

  return buildTextTargets(count, lines, {
    font: kf.font ?? DEFAULT_TEXT_FONT,
    worldW: kf.worldW ?? ctx.visW * 0.7,
    lineHeight: 178,
    offsetX: kf.offsetX ?? 0,
    offsetY: kf.offsetY ?? 0,
    thickness: 0.16,
    cw: 1280,
    ch: 560,
    step: 2,
  });
}

export function GlyphPoints(props: GlyphPointsProps) {
  const {
    keyframes,
    count,
    colors,
    style,
    cameraZ,
    cameraFov,
    pointer: pointerEnabled,
    drag: dragEnabled,
    getProgress,
    timing,
    resolveRef,
    resolveDomSelector,
  } = props;

  const pointsRef = useRef<THREE.Points>(null);
  // domSelector 解決先の実 DOM 要素をキャッシュ（毎フレーム querySelector を避ける）。
  const resolveDomElRef = useRef<HTMLElement | null>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { size, gl } = useThree();

  const pointer = useRef({ x: 0, y: 0, active: 0 });
  const rot = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const dragState = useRef({ down: false, lx: 0, ly: 0 });
  const stage = useRef(0);
  // 「字形が読める度合い」を frame 間で共有（ドラッグの効き調整に使う）。
  const guardRef = useRef(0);

  const n = keyframes.length;

  // 各キーフレームの正規化時刻（補間境界）。
  // 既定: 最終キーフレームが text の場合は 0.85 で形成し切り、0.85→1.0 を「くっきり保持」区間にする
  //（最後の瞬間まで雲のままにせず、字形を読ませる／フィナーレ解決へ綺麗に受け渡すため）。
  const times = useMemo<number[]>(() => {
    if (timing && timing.length === n) return timing.slice();
    if (n <= 1) return [0];
    const lastIsText = keyframes[n - 1]?.type === "text";
    const end = lastIsText ? 0.85 : 1;
    return Array.from({ length: n }, (_, i) => (i / (n - 1)) * end);
  }, [timing, n, keyframes]);

  // タイムライン上の意味論（どこが text / scatter か、解決の有無）。
  const timeline = useMemo(() => {
    const isText = keyframes.map((k) => k.type === "text");
    const isScatter = keyframes.map((k) => k.type === "scatter");
    const last = keyframes[n - 1];
    const hasResolve =
      n >= 1 && last?.type === "text" && last.resolveToDom === true;
    const resolveText =
      last?.type === "text" ? last.text.replace(/\n/g, " ") : "";
    const swapAt = times[1] !== undefined ? times[1] * 0.15 : 0;
    return { isText, isScatter, hasResolve, resolveText, swapAt };
  }, [keyframes, n, times]);

  // geometry（aPos0..aPosN-1 + aSeed + aAccent）。
  const built = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const seed = new Float32Array(count);
    const accent = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seed[i] = Math.random();
      accent[i] = Math.random() < colors.accentRatio ? 1 : 0;
    }

    const mobile = isMobile();
    const vpW = typeof window !== "undefined" ? window.innerWidth : 1440;
    const vpH = typeof window !== "undefined" ? window.innerHeight : 900;
    const { worldW: visW } = viewSizeAtZ0(vpW, vpH, cameraFov, cameraZ);

    const buffers = keyframes.map((kf) =>
      buildKeyframeTargets(kf, count, {
        visW,
        mobile,
        cameraFov,
        cameraZ,
      }),
    );

    buffers.forEach((buf, i) => {
      geo.setAttribute(
        glyphPositionAttribute(i),
        new THREE.BufferAttribute(buf, 3),
      );
    });
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setAttribute("aAccent", new THREE.BufferAttribute(accent, 1));
    // position は shader で計算するが、bounding 用にダミー（最初のキーフレーム）。
    const first = buffers[0] ?? new Float32Array(count * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(first.slice(), 3));
    geo.computeBoundingSphere();

    return { geo, buffers, visW, vpW, vpH };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyframes, count, colors.accentRatio, cameraFov, cameraZ]);

  const vertexShader = useMemo(() => buildVertexShader(Math.max(n, 1)), [n]);

  const uniforms = useMemo(
    () => ({
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
      uSparkle: { value: style.sparkle },
      uPixelRatio: { value: 1 },
      uColorInk: { value: colors.ink.clone() },
      uColorAccent: { value: colors.accent.clone() },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vertexShader],
  );

  // resolveToDom: 実文字オーバーレイを粒子グリフにピクセル整列させる。
  // 粒子グリフは最終キーフレームのフォント（既定 Helvetica Neue 900）でサンプリングされる。
  // クロスフェードで字形がズレないよう、実文字も同じフォントファミリ／ウェイトにし、
  // フォントサイズは「高さ基準」ではなく「粒子グリフの実幅にフィット」させる
  // （幅広ワードマークは高さ基準だと痩せて中央に縮こまるため）。
  const positionOverlay = () => {
    const el = resolveRef?.current;
    if (!el || !timeline.hasResolve) return;
    const finalBuf = built.buffers[n - 1];
    if (!finalBuf) return;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const { worldW: visW } = viewSizeAtZ0(vpW, vpH, cameraFov, cameraZ);
    const rect = computeScreenRect(finalBuf, vpW, vpH, visW);
    if (!rect) return;

    // 最終キーフレームのフォント文字列から family / weight を取り出す
    // （例 "900 260px 'Helvetica Neue', Helvetica, Arial, sans-serif"）。
    const finalKf = keyframes[n - 1];
    const fontStr =
      finalKf?.type === "text" && finalKf.font
        ? finalKf.font
        : DEFAULT_DENSE_FONT;
    const fontMatch = fontStr.match(/^\s*(\d+)\s+[\d.]+px\s+(.+)$/);
    const fontWeight = fontMatch?.[1] ?? "900";
    const fontFamily = fontMatch?.[2] ?? "sans-serif";

    // 実文字を粒子グリフへ厳密整列させる。
    // 字送り幅(advance)ではなく「実際のインク範囲」をオフスクリーン canvas で
    // ピクセル走査し、インクの中心を粒子グリフ矩形の中心へ合わせる。
    // （L と O など左右ベアリングが非対称な語は advance 基準だと横にズレる。）
    const text = timeline.resolveText;
    const ctx = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });

    let positioned = false;
    if (ctx && text) {
      // 1) 基準サイズで描いて塗りピクセルの bbox を実測。
      const baseSize = 200;
      ctx.font = `${fontWeight} ${baseSize}px ${fontFamily}`;
      const advBase = ctx.measureText(text).width;
      const pad = Math.ceil(baseSize * 0.6);
      const cw = Math.ceil(advBase + pad * 2);
      const ch = Math.ceil(baseSize * 1.8);
      const oc = document.createElement("canvas");
      oc.width = cw;
      oc.height = ch;
      const octx = oc.getContext("2d", { willReadFrequently: true });
      if (octx) {
        const drawX = pad;
        const drawY = Math.round(ch * 0.72);
        octx.font = `${fontWeight} ${baseSize}px ${fontFamily}`;
        octx.textAlign = "left";
        octx.textBaseline = "alphabetic";
        octx.fillStyle = "#000";
        octx.fillText(text, drawX, drawY);
        const data = octx.getImageData(0, 0, cw, ch).data;
        let minX = cw;
        let maxX = 0;
        let minY = ch;
        let maxY = 0;
        let found = 0;
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            if (data[(y * cw + x) * 4 + 3]! > 20) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              found++;
            }
          }
        }
        if (found > 0) {
          // 2) インク幅を粒子グリフ幅に合わせて fontSize を決定。
          const fontSize = baseSize * (rect.width / (maxX - minX));
          const scale = fontSize / baseSize;
          // 描画原点(text 先頭, baseline)基準のインク中心オフセット（fitted px）。
          const inkCenterXFromStart = ((minX + maxX) / 2 - drawX) * scale;
          const inkCenterYFromBaseline = ((minY + maxY) / 2 - drawY) * scale;
          // line-height:1 のときの「要素頂点 → ベースライン」距離。
          ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
          const fm = ctx.measureText(text);
          const leading = fontSize - (fm.fontBoundingBoxAscent + fm.fontBoundingBoxDescent);
          const baselineFromTop = leading / 2 + fm.fontBoundingBoxAscent;
          // 3) インク中心 = 粒子グリフ矩形の中心 となるよう left/top を決める。
          const targetCx = rect.left + rect.width / 2;
          const targetCy = rect.top + rect.height / 2;
          el.style.display = "block";
          el.style.textAlign = "left";
          el.style.whiteSpace = "nowrap";
          el.style.width = "auto";
          el.style.height = "auto";
          el.style.fontFamily = fontFamily;
          el.style.fontWeight = fontWeight;
          el.style.fontSize = `${fontSize}px`;
          el.style.left = `${targetCx - inkCenterXFromStart}px`;
          el.style.top = `${targetCy - inkCenterYFromBaseline - baselineFromTop}px`;
          positioned = true;
        }
      }
    }

    // フォールバック（canvas 不可）: 従来の矩形フィット。
    if (!positioned) {
      const measureSize = 100;
      let fontSize = rect.height * 0.92;
      if (ctx && text) {
        ctx.font = `${fontWeight} ${measureSize}px ${fontFamily}`;
        const w = ctx.measureText(text).width;
        if (w > 0) fontSize = measureSize * (rect.width / w);
      }
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
      el.style.fontFamily = fontFamily;
      el.style.fontWeight = fontWeight;
      el.style.fontSize = `${fontSize}px`;
    }
  };

  // 初回 / フォント読込 / リサイズで再サンプリング・再配置（DOM とピタリ重ねる）。
  const rebuildDomGlyphs = () => {
    keyframes.forEach((kf, i) => {
      if (kf.type !== "text" || !kf.domSelector) return;
      const next = buildGlyphFromDOM(count, kf.text.split("\n"), {
        selector: kf.domSelector,
        fovDeg: cameraFov,
        cameraZ,
        // 粒子がレンダリングされる canvas の実寸（CSS px）。
        // window.innerWidth だとスクロールバー分ずれるため size を使う。
        viewportW: size.width,
        viewportH: size.height,
      });
      if (!next) return;
      const attr = built.geo.getAttribute(glyphPositionAttribute(i)) as
        | THREE.BufferAttribute
        | undefined;
      if (!attr) return;
      (attr.array as Float32Array).set(next);
      attr.needsUpdate = true;
    });
    positionOverlay();
  };

  useEffect(() => {
    const raf = requestAnimationFrame(rebuildDomGlyphs);
    const t1 = window.setTimeout(rebuildDomGlyphs, 120);
    const t2 = window.setTimeout(rebuildDomGlyphs, 500);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts && typeof fonts.ready?.then === "function") {
      fonts.ready.then(() => rebuildDomGlyphs()).catch(() => {});
    }
    const onResize = () => rebuildDomGlyphs();
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  // ポインタ / ドラッグ。
  useEffect(() => {
    if (!pointerEnabled && !dragEnabled) return;
    const el = gl.domElement;
    const toNDC = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return {
        x: ((clientX - r.left) / r.width) * 2 - 1,
        y: -(((clientY - r.top) / r.height) * 2 - 1),
      };
    };
    const onMove = (e: PointerEvent) => {
      if (pointerEnabled) {
        const ndc = toNDC(e.clientX, e.clientY);
        pointer.current.x = ndc.x;
        pointer.current.y = ndc.y;
        pointer.current.active = 1;
      }
      if (dragEnabled && dragState.current.down) {
        const dx = e.clientX - dragState.current.lx;
        const dy = e.clientY - dragState.current.ly;
        const grip = 1.0 - guardRef.current * 0.85;
        rot.current.vy += dx * 0.00035 * grip;
        rot.current.vx += dy * 0.00025 * grip;
        dragState.current.lx = e.clientX;
        dragState.current.ly = e.clientY;
      }
    };
    const onDown = (e: PointerEvent) => {
      dragState.current.down = true;
      dragState.current.lx = e.clientX;
      dragState.current.ly = e.clientY;
    };
    const onUp = () => {
      dragState.current.down = false;
    };
    const onLeave = () => {
      pointer.current.active = 0;
      dragState.current.down = false;
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    if (dragEnabled) el.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [gl, pointerEnabled, dragEnabled]);

  // 解像度に応じた点サイズ。マテリアル側 uniforms（クローン）を更新する。
  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    const u = mat.uniforms as unknown as GlyphUniforms;
    u.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 3);
    u.uSize.value = Math.min(size.height / 18, 26);
  }, [size]);

  // 質感（プリセット＋上書き）をマテリアル uniforms / 合成モードへ反映。
  // uniforms メモは vertexShader にしか依存しないため、style 変化はここで同期する。
  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    const u = mat.uniforms as unknown as GlyphUniforms;
    u.uSizeScale.value = style.size;
    u.uDrift.value = style.drift;
    u.uSparkle.value = style.sparkle;
    mat.blending =
      style.blend === "additive"
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;
    mat.needsUpdate = true;
  }, [style.size, style.drift, style.sparkle, style.blend]);

  useFrame((state, delta) => {
    const p = pointsRef.current;
    const mat = matRef.current;
    if (!p || !mat) return;
    const u = mat.uniforms as unknown as GlyphUniforms;
    const d = Math.min(delta, 0.05);

    const raw = THREE.MathUtils.clamp(getProgress(), 0, 1);
    // スクロール進捗を直接ステージに反映（lerp 追従は間延びの原因になる）。
    // 慣性は driver 側（Lenis 等）で付けるのが正しい役割分担。
    stage.current = raw;
    const s = stage.current;

    // --- 補間スカラ（CPU 側で意味論を解決し uniform へ） ---
    let settle = 0;
    let burst = 0;
    for (let i = 0; i < n; i++) {
      const c = times[i] ?? 0;
      const prev = times[i - 1] ?? 0;
      const next = times[i + 1] ?? 1;
      const b = bump(s, c, prev, next);
      if (timeline.isText[i]) settle = Math.max(settle, b);
      if (timeline.isScatter[i]) burst = Math.max(burst, b);
    }

    // form: 最終キーフレームが text のとき、その最終遷移の進捗。
    let form = 0;
    const lastIsText = timeline.isText[n - 1] === true;
    if (lastIsText && n >= 2) {
      form = smooth(times[n - 2] ?? 0, times[n - 1] ?? 1, s);
    }
    // 先頭キーフレームが text のとき: 冒頭は「字形が締まった」状態から始め、
    // 最初の遷移で解けていく。これがないと「実文字が消えてから粒子が湧く」空白が出る。
    const firstIsText = timeline.isText[0] === true;
    if (firstIsText && n >= 2) {
      const formStart = 1 - smooth(times[0] ?? 0, times[1] ?? 1, s);
      form = Math.max(form, formStart);
    }
    const guard = THREE.MathUtils.clamp(Math.max(settle, form), 0, 1);
    guardRef.current = guard;

    const swapped = raw >= timeline.swapAt ? 1 : 0;
    // 粒子の消失（フェードアウト）。
    const resolve = timeline.hasResolve ? smooth(0.9, 0.98, raw) : 0;
    // 実文字の出現（フェードイン）は粒子の消失より少し遅らせる。
    // 同じカーブだと粒子と実文字が同時に重なり二重像になるため、
    // 「粒子が消えてから文字が立つ」クリーンな受け渡しにする（0.92→1.0）。
    const textReveal = timeline.hasResolve ? smooth(0.92, 1.0, raw) : 0;

    u.uTime.value = state.clock.elapsedTime;
    u.uStage.value = s;
    u.uForm.value = form;
    u.uSettle.value = settle;
    u.uBurst.value = burst * (1 - form);
    u.uSwap.value = swapped;
    u.uResolve.value = resolve;

    u.uPointer.value.set(pointer.current.x * 3.2, pointer.current.y * 2.0, 0);
    u.uPointerActive.value = pointer.current.active * (1.0 - guard);

    // ドラッグ回転（慣性 + 飛散時の自転 + 字形整列で正面復帰）。
    rot.current.x += rot.current.vx;
    rot.current.y += rot.current.vy;
    rot.current.vx *= 0.92;
    rot.current.vy *= 0.92;
    rot.current.y += d * 0.05 * (1.0 - guard);
    const recenter = 0.02 + guard * 0.2;
    const wrappedY = Math.atan2(
      Math.sin(rot.current.y),
      Math.cos(rot.current.y),
    );
    rot.current.y = THREE.MathUtils.lerp(
      rot.current.y,
      rot.current.y - wrappedY,
      recenter,
    );
    rot.current.x = THREE.MathUtils.lerp(rot.current.x, 0, 0.04 + guard * 0.14);
    p.rotation.x = rot.current.x;
    p.rotation.y = rot.current.y;

    // resolveToDom: 解決先（自前オーバーレイ or 実 DOM 要素）の不透明度を
    // textReveal（少し遅らせた出現）に同期する。
    if (timeline.hasResolve) {
      let target: HTMLElement | null = resolveRef?.current ?? null;
      if (!target && resolveDomSelector) {
        if (!resolveDomElRef.current) {
          resolveDomElRef.current =
            document.querySelector<HTMLElement>(resolveDomSelector);
        }
        target = resolveDomElRef.current;
      }
      if (target) target.style.opacity = String(textReveal);
    }
  });

  return (
    <points ref={pointsRef} geometry={built.geo} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={
          style.blend === "additive"
            ? THREE.AdditiveBlending
            : THREE.NormalBlending
        }
        vertexShader={vertexShader}
        fragmentShader={FRAGMENT_SHADER}
      />
    </points>
  );
}
