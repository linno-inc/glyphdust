/**
 * GlyphDust.tsx — 公開コンポーネント。
 *
 * Canvas ラッパー + フォールバック判定 + ドライバ（scroll / manual）の結線。
 * reduced-motion / WebGL 不可時は `fallback` をそのまま描画（真っ白防止）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { GlyphPoints, type ResolvedColors, type ResolvedStyle } from "./GlyphPoints.js";
import { DEFAULT_TRIGGER_HEIGHT, computeAutoplayProgress } from "./drivers.js";
import { useReducedMotion } from "./useReducedMotion.js";
import type { GlyphDustProps, GlyphPreset } from "./types.js";

const DEFAULT_INK = "#1b2330";
const DEFAULT_ACCENT = "#0055ff";
const DEFAULT_ACCENT_RATIO = 0.18;
const DEFAULT_COUNT_DESKTOP = 11000;
const DEFAULT_COUNT_MOBILE = 5200;
const DEFAULT_CAMERA_Z = 7;
const DEFAULT_CAMERA_FOV = 42;
const DEFAULT_DPR: [number, number] = [1, 1.75];

/** 質感プリセット → 解決済みスタイル。`style` で部分上書きされる土台。 */
const SMOOTH = "smootherstep" as const;
const FIB = "fibonacci" as const;
const PRESETS: Record<GlyphPreset, ResolvedStyle> = {
  default: { size: 1, blend: "normal", drift: 1, sparkle: 1, stagger: 0.08, curl: 1, easing: SMOOTH, scatterPattern: FIB },
  minimal: { size: 0.92, blend: "normal", drift: 0.35, sparkle: 0, stagger: 0.04, curl: 0, easing: SMOOTH, scatterPattern: FIB },
  lively: { size: 1.05, blend: "normal", drift: 1.4, sparkle: 1.4, stagger: 0.12, curl: 1.3, easing: SMOOTH, scatterPattern: FIB },
  glow: { size: 1.1, blend: "additive", drift: 1.1, sparkle: 1.5, stagger: 0.1, curl: 1.1, easing: SMOOTH, scatterPattern: FIB },
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * `paused: true → false` の立ち下がりで r3f の描画ループを明示的に再始動する。
 *
 * なぜ必要か: r3f の内部ループは「何も invalidate しなければ requestAnimationFrame
 * を止める」省電力設計になっている（`frameloop="never"` の間は当然ずっと止まった
 * まま）。`<Canvas frameloop>` prop を `"never"` → `"always"` に変えると内部の
 * `state.frameloop` は更新されるが、それだけではループそのものは再始動しない —
 * r3f の `invalidate()` が明示的に `requestAnimationFrame(loop)` を呼んで初めて
 * 再始動する（かつ `invalidate()` 自身は `state.frameloop === "never"` の間は
 * 何もしない no-op なので、`setFrameloop` が先に効いた**後**に呼ぶ必要がある）。
 * これを怠ると、一度停止した描画ループが二度と再開せず、`resolveToDom` の
 * opacity 書き込み（useFrame 内で行われる）も含めて永久に凍結する
 * （発見: 凜さん 2026-07-07「全然ダメ」指摘の調査。`paused` 初出時にこの
 * `invalidate()` 呼び出しを欠いており、一部要素が永久に opacity 0 のまま
 * 固まる退行を引き起こした）。
 */
function ResumeOnUnpause({ paused }: { paused: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const prevPausedRef = useRef(paused);
  useEffect(() => {
    if (prevPausedRef.current && !paused) invalidate();
    prevPausedRef.current = paused;
  }, [paused, invalidate]);
  return null;
}

function isWebGLAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") ||
          canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

export function GlyphDust(props: GlyphDustProps) {
  const {
    keyframes,
    driver = { type: "scroll" },
    preset = "default",
    style,
    colors,
    count,
    dpr = DEFAULT_DPR,
    camera,
    timing,
    fallback = null,
    className,
    resampleSignal,
    paused = false,
  } = props;

  const reduced = useReducedMotion();
  const [webgl, setWebgl] = useState(true);
  useEffect(() => {
    setWebgl(isWebGLAvailable());
  }, []);

  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setMobile(window.matchMedia("(max-width: 768px)").matches);
  }, []);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const resolveRef = useRef<HTMLDivElement>(null);

  // 手動進捗は ref に保持（getProgress を安定させる）。
  const manualRef = useRef(0);
  if (driver.type === "manual") manualRef.current = clamp01(driver.progress);

  // autoplay 用: 再生中フラグと開始時刻（playOnView の場合は画面内で起動）。
  const autoplay = driver.type === "autoplay" ? driver : null;
  const playingRef = useRef(false);
  const startMsRef = useRef<number | null>(null);
  const lastAutoRef = useRef(0);

  // autoplay: playOnView が false なら即再生、true なら IntersectionObserver で起動。
  useEffect(() => {
    if (!autoplay) return;
    if (autoplay.playOnView === false) {
      playingRef.current = true;
      return;
    }
    const el = wrapperRef.current;
    if (el === null || typeof IntersectionObserver === "undefined") {
      playingRef.current = true; // 観測不可なら無条件再生（真っ白防止）。
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !playingRef.current) {
            playingRef.current = true;
            startMsRef.current = null; // 入った瞬間を開始点に。
          }
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
    // duration/loop 等の変化では貼り直し不要（毎フレーム参照するため）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay?.playOnView]);

  // autoplay: keyframes の参照が変わったら「新しい物語」として時計を巻き戻す。
  // 従来 startMsRef/lastAutoRef はコンポーネント生存中ずっとリセットされず、
  // 呼び出し側が同一インスタンスを使い回して keyframes だけ差し替える構成
  // （例: 1 つの WebGL コンテキストを複数要素で使い回すプール実装）だと、
  // 最初の 1 回しか進捗が 0 から進まず、以後は elapsed 時間がずっと duration を
  // 超えたまま＝常に progress=1（アニメーションなしで即座に完成形）になって
  // いた。keyframes 変化を「新規再生の合図」として明示的に扱う。
  // playOnView:true で画面外にいる間の keyframes 差し替えは、時計だけ戻し
  // 再生開始は引き続き IntersectionObserver に委ねる（無条件再生はしない）。
  useEffect(() => {
    if (!autoplay) return;
    startMsRef.current = null;
    lastAutoRef.current = 0;
    if (autoplay.playOnView === false) playingRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyframes]);

  const getProgress = useCallback(() => {
    if (driver.type === "manual") return manualRef.current;
    if (driver.type === "autoplay") {
      if (!playingRef.current || typeof performance === "undefined") {
        return lastAutoRef.current;
      }
      if (startMsRef.current === null) startMsRef.current = performance.now();
      const elapsed = (performance.now() - startMsRef.current) / 1000;
      lastAutoRef.current = computeAutoplayProgress(elapsed, driver);
      return lastAutoRef.current;
    }
    const el = wrapperRef.current;
    if (el === null || typeof window === "undefined") return 0;
    const rect = el.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    if (total <= 0) return 0;
    return clamp01(-rect.top / total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver]);

  // プリセット＋上書き: プリセットを土台に、style で指定された項目だけ上書き。
  const resolvedStyle = useMemo<ResolvedStyle>(() => {
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
  }, [
    preset,
    style?.size,
    style?.blend,
    style?.drift,
    style?.sparkle,
    style?.stagger,
    style?.curl,
    style?.easing,
    style?.scatterPattern,
  ]);

  const resolvedColors = useMemo<ResolvedColors>(
    () => ({
      ink: new THREE.Color(colors?.ink ?? DEFAULT_INK),
      accent: new THREE.Color(colors?.accent ?? DEFAULT_ACCENT),
      accentRatio: colors?.accentRatio ?? DEFAULT_ACCENT_RATIO,
    }),
    [colors?.ink, colors?.accent, colors?.accentRatio],
  );

  const particleCount = mobile
    ? (count?.mobile ?? DEFAULT_COUNT_MOBILE)
    : (count?.desktop ?? DEFAULT_COUNT_DESKTOP);

  const cameraZ = camera?.z ?? DEFAULT_CAMERA_Z;
  const cameraFov = camera?.fov ?? DEFAULT_CAMERA_FOV;

  const finalKf = keyframes[keyframes.length - 1];
  const hasResolve =
    finalKf?.type === "text" && finalKf.resolveToDom === true;
  // 最終キーフレームが domSelector を持つなら、その「実 DOM 要素」へ解決する。
  // 粒子はその要素にピクセル整列してサンプリングされる（最初の見出しと同じ仕組み）ため、
  // 別オーバーレイをフィットさせる必要がなく、整列が原理的に保証される。
  const resolveDomSelector =
    finalKf?.type === "text" && finalKf.resolveToDom === true && finalKf.domSelector
      ? finalKf.domSelector
      : undefined;
  // 自前オーバーレイを使うのは「resolveToDom かつ domSelector 無し」のときだけ。
  const useOwnOverlay = hasResolve && !resolveDomSelector;
  const resolveText =
    finalKf?.type === "text" ? finalKf.text.replace(/\n/g, " ") : "";

  // reduced-motion / WebGL 不可 → フォールバックを描画（真っ白防止）。
  if (reduced || !webgl) {
    return <>{fallback}</>;
  }

  const scene = (
    <>
      <Canvas
        dpr={dpr}
        camera={{ position: [0, 0, cameraZ], fov: cameraFov }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        frameloop={paused ? "never" : "always"}
        style={{ width: "100%", height: "100%" }}
      >
        <ResumeOnUnpause paused={paused} />
        <GlyphPoints
          keyframes={keyframes}
          count={particleCount}
          colors={resolvedColors}
          style={resolvedStyle}
          cameraZ={cameraZ}
          cameraFov={cameraFov}
          getProgress={getProgress}
          timing={timing}
          resolveRef={useOwnOverlay ? resolveRef : undefined}
          resolveDomSelector={resolveDomSelector}
          resampleSignal={resampleSignal}
        />
      </Canvas>
      {useOwnOverlay ? (
        <div
          ref={resolveRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            opacity: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            whiteSpace: "nowrap",
            fontWeight: 900,
            color: colors?.ink ?? DEFAULT_INK,
            pointerEvents: "none",
          }}
        >
          {resolveText}
        </div>
      ) : null}
    </>
  );

  // manual / autoplay: 親要素にフィット（どんな箱にも置ける）。
  // scroll のみ背の高いラッパー + sticky 内枠でフルスクリーン演出。
  if (driver.type === "manual" || driver.type === "autoplay") {
    return (
      <div
        ref={wrapperRef}
        className={className}
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        {scene}
      </div>
    );
  }

  const triggerHeight = driver.triggerHeight ?? DEFAULT_TRIGGER_HEIGHT;
  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{ position: "relative", height: `${triggerHeight * 100}vh` }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          width: "100%",
          overflow: "hidden",
        }}
      >
        {scene}
      </div>
    </div>
  );
}
