/**
 * GlyphDust.tsx — 公開コンポーネント。
 *
 * Canvas ラッパー + フォールバック判定 + ドライバ（scroll / manual）の結線。
 * reduced-motion / WebGL 不可時は `fallback` をそのまま描画（真っ白防止）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import { GlyphPoints, type ResolvedColors } from "./GlyphPoints.js";
import { DEFAULT_TRIGGER_HEIGHT } from "./drivers.js";
import { useReducedMotion } from "./useReducedMotion.js";
import type { GlyphDustProps } from "./types.js";

const DEFAULT_INK = "#1b2330";
const DEFAULT_ACCENT = "#0055ff";
const DEFAULT_ACCENT_RATIO = 0.18;
const DEFAULT_COUNT_DESKTOP = 11000;
const DEFAULT_COUNT_MOBILE = 5200;
const DEFAULT_CAMERA_Z = 7;
const DEFAULT_CAMERA_FOV = 42;
const DEFAULT_DPR: [number, number] = [1, 1.75];

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
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
    colors,
    count,
    dpr = DEFAULT_DPR,
    interaction,
    camera,
    timing,
    fallback = null,
    className,
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

  const getProgress = useCallback(() => {
    if (driver.type === "manual") return manualRef.current;
    const el = wrapperRef.current;
    if (el === null || typeof window === "undefined") return 0;
    const rect = el.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    if (total <= 0) return 0;
    return clamp01(-rect.top / total);
  }, [driver.type]);

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
  const pointerEnabled = interaction?.pointer ?? true;
  const dragEnabled = interaction?.drag ?? true;

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
        frameloop="always"
        style={{ width: "100%", height: "100%" }}
      >
        <GlyphPoints
          keyframes={keyframes}
          count={particleCount}
          colors={resolvedColors}
          cameraZ={cameraZ}
          cameraFov={cameraFov}
          pointer={pointerEnabled}
          drag={dragEnabled}
          getProgress={getProgress}
          timing={timing}
          resolveRef={useOwnOverlay ? resolveRef : undefined}
          resolveDomSelector={resolveDomSelector}
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

  // manual: 親要素にフィット。scroll: 背の高いラッパー + sticky 内枠。
  if (driver.type === "manual") {
    return (
      <div
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
