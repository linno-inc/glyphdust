/**
 * GlyphDust.tsx — 公開コンポーネント。
 *
 * Canvas ラッパー + フォールバック判定 + ドライバ（scroll / manual）の結線。
 * reduced-motion / WebGL 不可時は `fallback` をそのまま描画（真っ白防止）。
 */

import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { GlyphPoints, type ResolvedColors, type ResolvedStyle } from "./GlyphPoints.js";
import { DEFAULT_TRIGGER_HEIGHT, computeAutoplayProgress } from "./drivers.js";
import { useReducedMotion } from "./useReducedMotion.js";
import type { GlyphDustProps, GlyphPreset } from "./types.js";

// bloom（光）は動的 import: 使わない限り @react-three/postprocessing は
// バンドルにもランタイムにも現れない（optional peer dependency）。
const BloomEffect = lazy(() => import("./BloomEffect.js"));

/**
 * bloom の動的 import 失敗（optional peer が未インストール等）を握りつぶして
 * 演出本体は生かすエラーバウンダリ。lazy の失敗は Suspense では捕まらないため必要。
 */
class BloomBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.warn(
      "[glyphdust] bloom を有効化できません（@react-three/postprocessing は" +
        "インストールされていますか？）。bloom 無しで描画を続けます。",
      err,
    );
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

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
// alphaVar / dof（2026-07-11 品質向上 Phase 1）は全プリセットで既定 0 の opt-in。
// 当初は既定オンだったが、dof は飛散中の粒のサイズ・ボケ・彩度を移動と連動して
// 毎フレーム変調し、alphaVar は拡散の途中で粒群の質感を変えるため、凜さんが
// 「拡散がスムーズじゃない」と却下（2026-07-11。既定の拡散・収束は 0.10.0 と
// ピクセル一致であること、質感は style での明示指定のみ）。
// bloom は「光」の軸（凜さん指示「収束拡散は元のまま提案を全て実装」）。
// ポスト処理のみで粒子の軌道・タイミングは不変。発光は暗背景向けなので glow プリセット
// だけ既定オン。モバイルは負荷対策で自動オフ（uBloom ブーストも 0 に畳む）。
const PRESETS: Record<GlyphPreset, ResolvedStyle> = {
  default: { size: 1, blend: "normal", drift: 1, sparkle: 1, stagger: 0.08, curl: 1, easing: SMOOTH, scatterPattern: FIB, burst: 1, alphaVar: 0, dof: 0, wave: 0, bloom: 0 },
  minimal: { size: 0.92, blend: "normal", drift: 0.35, sparkle: 0, stagger: 0.04, curl: 0, easing: SMOOTH, scatterPattern: FIB, burst: 1, alphaVar: 0, dof: 0, wave: 0, bloom: 0 },
  lively: { size: 1.05, blend: "normal", drift: 1.4, sparkle: 1.4, stagger: 0.12, curl: 1.3, easing: SMOOTH, scatterPattern: FIB, burst: 1, alphaVar: 0, dof: 0, wave: 0, bloom: 0 },
  glow: { size: 1.1, blend: "additive", drift: 1.1, sparkle: 1.5, stagger: 0.1, curl: 1.1, easing: SMOOTH, scatterPattern: FIB, burst: 1, alphaVar: 0, dof: 0, wave: 0, bloom: 0.6 },
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
    swapFade,
    swapAt,
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
      burst: style?.burst ?? base.burst,
      alphaVar: style?.alphaVar ?? base.alphaVar,
      dof: style?.dof ?? base.dof,
      wave: style?.wave ?? base.wave,
      bloom: style?.bloom ?? base.bloom,
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
    style?.burst,
    style?.alphaVar,
    style?.dof,
    style?.wave,
    style?.bloom,
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
          swapFade={swapFade}
          swapAt={swapAt}
          resolveRef={useOwnOverlay ? resolveRef : undefined}
          resolveDomSelector={resolveDomSelector}
          resampleSignal={resampleSignal}
        />
        {/* 光（bloom）。モバイルは負荷対策で自動オフ。lazy なので bloom=0 なら
            postprocessing はロードすらされない。 */}
        {resolvedStyle.bloom > 0 && !mobile ? (
          <BloomBoundary>
            <Suspense fallback={null}>
              <BloomEffect strength={resolvedStyle.bloom} />
            </Suspense>
          </BloomBoundary>
        ) : null}
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
