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
  buildGlyphFromDOM,
  computeScreenRect,
  viewSizeAtZ0,
} from "./dom-overlay.js";
import {
  buildVertexShader,
  FRAGMENT_SHADER,
  glyphPositionAttribute,
} from "./shaders.js";
import {
  DEFAULT_DENSE_FONT,
  buildKeyframeTargets,
  bump,
  isMobile,
  smooth,
} from "./internal/geometry.js";
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
  stagger: number;
  curl: number;
  easing: "smoothstep" | "smootherstep";
  scatterPattern: "random" | "fibonacci";
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
  uSize: THREE.IUniform<number>;
  uSizeScale: THREE.IUniform<number>;
  uDrift: THREE.IUniform<number>;
  uStagger: THREE.IUniform<number>;
  uCurl: THREE.IUniform<number>;
  uSmoother: THREE.IUniform<number>;
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

export function GlyphPoints(props: GlyphPointsProps) {
  const {
    keyframes,
    count,
    colors,
    style,
    cameraZ,
    cameraFov,
    getProgress,
    timing,
    resolveRef,
    resolveDomSelector,
  } = props;

  const pointsRef = useRef<THREE.Points>(null);
  // domSelector 解決先の実 DOM 要素をキャッシュ（毎フレーム querySelector を避ける）。
  const resolveDomElRef = useRef<HTMLElement | null>(null);
  // 解決窓（per-keyframe resolveToDom）の実 DOM 要素キャッシュ。
  const windowElsRef = useRef<Map<string, HTMLElement | null>>(new Map());
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();

  const stage = useRef(0);

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

    // ── 実テキスト解決の「窓」（per-keyframe resolveToDom）──
    // domSelector 付き text キーフレームの連続グループ（同一 selector = 収束→保持）ごとに、
    // グループ内のどれかが resolveToDom:true なら解決窓を作る:
    // 滞在中は粒子を uResolve で溶かし、実 DOM 要素をクロスフェード（+ボケ→ピント）で
    // 立てる。離れる際は逆再生で粒子へ溶け戻る。従来は最終キーフレームしか解決できず、
    // 途中の見出しでは「実テキストの裏に粒子が残って見える」ため、利用側が opacity を
    // 手で振り付けるしかなかった。それをライブラリの標準機能にする
    // （提案者: 凜さん 2026-07-04「テキストの裏にいるのが見える。そのまま使うようにしよう」）。
    // 先頭グループは進捗 0 から実テキスト表示＝保持区間全体を使って粒子へ溶け出す。
    // 最終グループは立った実テキストがそのまま残る（従来の終端 resolve と同じ着地）。
    const windows: {
      selector: string;
      a: number; // 出現フェード開始
      b: number; // 出現フェード完了
      c: number; // 退場フェード開始
      d: number; // 退場フェード完了
      isStart: boolean;
      isFinal: boolean;
    }[] = [];
    let gi = 0;
    while (gi < n) {
      const kf = keyframes[gi];
      if (kf?.type !== "text" || !kf.domSelector) {
        gi += 1;
        continue;
      }
      let gj = gi;
      while (gj + 1 < n) {
        const nx = keyframes[gj + 1];
        if (nx?.type !== "text" || nx.domSelector !== kf.domSelector) break;
        gj += 1;
      }
      const wantsResolve = keyframes
        .slice(gi, gj + 1)
        .some((g) => g.type === "text" && g.resolveToDom === true);
      if (wantsResolve) {
        const t0 = times[gi] ?? 0;
        const t1 = times[gj] ?? 1;
        // stagger（粒子ごとの到着タイミングばらつき）を考慮した「実質収束完了点」。
        // 頂点シェーダの stageP = (uStage - aSeed*w)/(1-w) より、最も遅れる粒子
        // （aSeed→1）がこのキーフレームの mix 目標（t0）に到達する raw progress は
        // 概ね t0 + stagger*(1-t0)。旧式は rise 窓を t0 の直前後に置いていたため、
        // stagger分だけ収束し切っていない粒子がいる間に透明化が始まり、
        // 「形になる前に消えていく」ように見えた（凜さん 2026-07-04
        // 「収束する前にパーティクルズがスーって消えていく」）。
        // rise の開始をこの収束完了点まで送らせ、収束後にだけ透明化させる。
        const staggerCatchUp = t0 + style.stagger * (1 - t0);
        const rise = Math.max(0.006, t1 > t0 ? (t1 - t0) * 0.25 : 0.02);
        const a = gi === 0 ? t0 - rise * 0.4 : Math.min(staggerCatchUp, t1 - rise);
        windows.push({
          selector: kf.domSelector,
          a,
          b: a + rise,
          // 先頭グループは保持区間全体でゆっくり粒子へ受け渡す。
          c: gi === 0 ? t0 : t1 - rise,
          d: t1,
          isStart: gi === 0,
          isFinal: gj === n - 1,
        });
      }
      gi = gj + 1;
    }

    return { isText, isScatter, hasResolve, resolveText, swapAt, windows };
  }, [keyframes, n, times, style.stagger]);

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
        scatterPattern: style.scatterPattern,
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
  }, [keyframes, count, colors.accentRatio, cameraFov, cameraZ, style.scatterPattern]);

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
      uSize: { value: 1 },
      uSizeScale: { value: style.size },
      uDrift: { value: style.drift },
      uStagger: { value: style.stagger },
      uCurl: { value: style.curl },
      uSmoother: { value: style.easing === "smoothstep" ? 0 : 1 },
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
    u.uStagger.value = style.stagger;
    // curl noise はモバイルで負荷が高いので軽量パス（0=軸独立 sin/cos）へフォールバック。
    u.uCurl.value = isMobile() ? 0 : style.curl;
    u.uSmoother.value = style.easing === "smoothstep" ? 0 : 1;
    u.uSparkle.value = style.sparkle;
    mat.blending =
      style.blend === "additive"
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;
    mat.needsUpdate = true;
  }, [style.size, style.drift, style.stagger, style.curl, style.easing, style.sparkle, style.blend]);

  useFrame((state) => {
    const p = pointsRef.current;
    const mat = matRef.current;
    if (!p || !mat) return;
    const u = mat.uniforms as unknown as GlyphUniforms;

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
    let swapped = raw >= timeline.swapAt ? 1 : 0;
    // 粒子の消失（フェードアウト）。
    let resolve = timeline.hasResolve ? smooth(0.9, 0.98, raw) : 0;
    // 実文字の出現（フェードイン）は粒子の消失より少し遅らせる。
    // 同じカーブだと粒子と実文字が同時に重なり二重像になるため、
    // 「粒子が消えてから文字が立つ」クリーンな受け渡しにする（0.92→1.0）。
    let textReveal = timeline.hasResolve ? smooth(0.92, 1.0, raw) : 0;

    // ── 解決窓（per-keyframe resolveToDom）──
    // 窓があるときは、可視ゲート（swap）・粒子の溶解（resolve）・実テキストの
    // 不透明度をすべて窓が駆動する（旧 swapAt / 終端 0.9-1.0 の固定カーブは使わない）。
    if (timeline.windows.length > 0) {
      swapped = 1;
      let amtMax = 0;
      for (const w of timeline.windows) {
        const amt =
          (w.isStart ? 1 : smooth(w.a, w.b, s)) *
          (w.isFinal ? 1 : 1 - smooth(w.c, w.d, s));
        let el = windowElsRef.current.get(w.selector);
        if (el === undefined) {
          el = document.querySelector<HTMLElement>(w.selector);
          windowElsRef.current.set(w.selector, el);
        }
        if (el) {
          el.style.opacity = String(amt);
          // 滲み出し/溶け戻り中は軽くぼかし、定着でピントが合う（morphTo と同じ表現）。
          const blur = (1 - amt) * 6;
          el.style.filter =
            amt > 0.01 && blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : "";
        }
        if (amt > amtMax) amtMax = amt;
      }
      resolve = amtMax;
      textReveal = 0; // 旧経路（resolveRef / resolveDomSelector）は使わない
    }

    u.uTime.value = state.clock.elapsedTime;
    u.uStage.value = s;
    u.uForm.value = form;
    u.uSettle.value = settle;
    u.uBurst.value = burst * (1 - form);
    u.uSwap.value = swapped;
    u.uResolve.value = resolve;

    // resolveToDom: 解決先（自前オーバーレイ or 実 DOM 要素）の不透明度を
    // textReveal（少し遅らせた出現）に同期する。解決窓があるときは窓側が駆動済み。
    if (timeline.hasResolve && timeline.windows.length === 0) {
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
