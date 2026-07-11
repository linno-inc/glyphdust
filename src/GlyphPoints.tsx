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
  alignGlyphOverlay,
  buildGlyphFromDOM,
  viewSizeAtZ0,
} from "./dom-overlay.js";
import {
  buildVertexShader,
  FRAGMENT_SHADER,
  glyphPositionAttribute,
} from "./shaders.js";
import {
  DEFAULT_DENSE_FONT,
  buildKeyframeTargetsList,
  buildScatterAroundAnchor,
  buildScatterAroundTargets,
  bump,
  formsGlyph,
  isMobile,
  scatterGlyphRefIndex,
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
  burst: number;
  alphaVar: number;
  dof: number;
  wave: number;
  bloom: number;
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
  uStaggerCollapse: THREE.IUniform<number>;
  uCurl: THREE.IUniform<number>;
  uSmoother: THREE.IUniform<number>;
  uSparkle: THREE.IUniform<number>;
  uPixelRatio: THREE.IUniform<number>;
  uColorInk: THREE.IUniform<THREE.Color>;
  uColorAccent: THREE.IUniform<THREE.Color>;
  uAlphaVar: THREE.IUniform<number>;
  uDof: THREE.IUniform<number>;
  uFocus: THREE.IUniform<number>;
  uWave: THREE.IUniform<number>;
  uBloom: THREE.IUniform<number>;
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
  /** 粒子の出現をフェードインにする進捗幅。既定 0（瞬時切替）。GlyphDustProps 参照。 */
  swapFade?: number | undefined;
  /** resolveToDom 用の実文字オーバーレイ要素。 */
  resolveRef?: RefObject<HTMLDivElement | null> | undefined;
  /**
   * resolveToDom の解決先が「ユーザーの実 DOM 要素」のときのセレクタ。
   * 指定時は自前オーバーレイを使わず、粒子がピクセル整列している
   * その実要素の不透明度を直接フェードする（整列が原理保証される）。
   */
  resolveDomSelector?: string | undefined;
  /**
   * この値が変化するたびに Canvas/WebGLコンテキストを維持したまま
   * domSelector サンプリングを再実行する（{@link GlyphDustProps.resampleSignal}
   * 参照）。
   */
  resampleSignal?: number | undefined;
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
    swapFade,
    resolveRef,
    resolveDomSelector,
    resampleSignal,
  } = props;

  const pointsRef = useRef<THREE.Points>(null);
  // domSelector 解決先の実 DOM 要素をキャッシュ（毎フレーム querySelector を避ける）。
  const resolveDomElRef = useRef<HTMLElement | null>(null);
  // 解決窓（per-keyframe resolveToDom）の実 DOM 要素キャッシュ。
  const windowElsRef = useRef<Map<string, HTMLElement | null>>(new Map());
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  // resize リスナーはマウント時に一度だけ張るため、常に最新の size を読めるよう ref 経由にする
  // （size を直接クロージャに閉じ込めると、マウント後のリサイズで古い viewport 寸法のまま
  // 再サンプリングし続け、粒子と DOM テキストがピクセルずれる）。
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const stage = useRef(0);

  const n = keyframes.length;

  // 各キーフレームの正規化時刻（補間境界）。
  // 既定: 最終キーフレームが text/shape の場合は 0.85 で形成し切り、0.85→1.0 を「くっきり保持」区間にする
  //（最後の瞬間まで雲のままにせず、字形を読ませる／フィナーレ解決へ綺麗に受け渡すため）。
  const times = useMemo<number[]>(() => {
    if (timing && timing.length === n) {
      // bump()/smooth() や解決窓の計算はすべて times が [0,1] で単調非減少である
      // ことを前提にしている。手書きの timing でここが崩れると、補間やフェード
      // タイミングが無警告で破綻する（NaN にはならないが視覚的に無意味な値になる）。
      // useMemo 内（timing/n/keyframes 変化時のみ）なので毎フレームのコストにはならない。
      for (let i = 0; i < timing.length; i++) {
        const t = timing[i]!;
        if (t < 0 || t > 1 || (i > 0 && t < timing[i - 1]!)) {
          console.warn(
            `[glyphdust] \`timing\` は [0,1] の範囲で単調非減少である必要があります: ${JSON.stringify(timing)}`,
          );
          break;
        }
      }
      return timing.slice();
    }
    if (n <= 1) return [0];
    const end = formsGlyph(keyframes[n - 1]) ? 0.85 : 1;
    return Array.from({ length: n }, (_, i) => (i / (n - 1)) * end);
  }, [timing, n, keyframes]);

  // タイムライン上の意味論（どこが字形形成 / scatter か、解決の有無）。
  // isText は「字形（形）を形成する」の意（text/shape 両方 true）。
  const timeline = useMemo(() => {
    const isText = keyframes.map((k) => formsGlyph(k));
    const isScatter = keyframes.map((k) => k.type === "scatter");

    // settle 用の「同一字形グループ」境界（各要素 i の所属グループの
    // [start, end] キーフレーム index）。同一 text+domSelector が連続する
    // キーフレーム（例: 駅の form→hold ペア。同一バッファを共有する
    // geometry.ts の sameGlyphKeyframe と同じ判定基準）は 1 つのグループに
    // まとめる。
    //
    // 【2026-07-08 発見・修正】旧実装は settle を「キーフレームごとに個別の
    // bump(s,c,prev,next)」の max で求めていた。form→hold ペアは同一位置
    // （バッファ共有）だが times 上は t0≠t1 の別キーフレームなので、
    // form 側の bump は c=t0 をピークに t0→t1 で下降し、hold 側の bump は
    // c=t1 をピークに t0→t1 で上昇する——2 つの相補的カーブの max は、
    // ちょうど中間点（t0とt1の中央）で最小値 0.5 まで沈む。settle は
    // 点サイズ・不透明度ブースト（フラグメントシェーダの 1.3 倍ブースト）の
        // 両方を駆動するため、この沈み込みが「収束した直後に一度薄く（白っぽく）
    // なってからまた濃くなる」という実在のちらつきを生んでいた（凜さん
    // 2026-07-08「黒いパーティクルが収束した後に白くなって黒になっていく」
    // 実機報告・実測でDOM opacity=0のまま可視密度が0.366→0.268へ約27%低下
    // することを確認）。同一グループの内部境界を無視し、グループ全体を
    // 「1つの安定した山（前だけ立ち上がり・後だけ下降、中は常に1）」として
    // 扱うことで沈み込みを解消する。
    const groupStart: number[] = new Array(n).fill(0);
    const groupEnd: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; ) {
      const kf = keyframes[i];
      if (kf?.type !== "text") {
        groupStart[i] = i;
        groupEnd[i] = i;
        i += 1;
        continue;
      }
      let j = i;
      while (
        j + 1 < n &&
        keyframes[j + 1]?.type === "text" &&
        (keyframes[j + 1] as { text: string; domSelector?: string }).text === kf.text &&
        (keyframes[j + 1] as { domSelector?: string }).domSelector === kf.domSelector
      ) {
        j += 1;
      }
      for (let k = i; k <= j; k++) {
        groupStart[k] = i;
        groupEnd[k] = j;
      }
      i = j + 1;
    }
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
    // 先頭グループ（isStart）はフェードイン因子が常に1（進捗0から実テキスト
    // 表示済みのため）。退場フェード窓 [c,d] は他グループと同じ式
    // （c=t1-rise, d=t1）を使う（2026-07-10、下の a/c 計算コメント参照）。
    // 最終グループは立った実テキストがそのまま残る（従来の終端 resolve と同じ着地）。
    const windows: {
      selector: string;
      a: number; // 出現フェード開始
      b: number; // 出現フェード完了
      c: number; // 退場フェード開始
      d: number; // 退場フェード完了
      isStart: boolean;
      isFinal: boolean;
      /** 出発駅窓: 粒子ゲートにだけ参加し、実 DOM の opacity/filter は書かない。 */
      holdResolved: boolean;
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
      const holdResolved = keyframes
        .slice(gi, gj + 1)
        .some((g) => g.type === "text" && g.holdResolved === true);
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
        //
        // ただし単純に「完全収束（100%）を待つ」と、退場フェード開始点
        // （c = t1 - rise、stagger とは無関係な固定計算）に食い込み、保持区間
        // （rise 完了〜退場開始）がほぼゼロになって「一瞬光ってすぐ消える」新たな
        // 不具合を生んだ（凜さん 2026-07-04「また収束がスムーズじゃなくなってる」）。
        // 折衷案: 待つのは実質収束点までの半分（0.5）に留める。rise 中は実テキストに
        // ぼかし（骨: (1-amt)*6px）がかかるため、ごく一部の最遅粒子がまだ収束し切って
        // いなくてもクロスフェードのボケが吸収し、境界のズレとしては見えない。
        // 加えて最低限の保持幅 minPlateau を必ず確保する。
        //
        // rise/minPlateau は span（t1-t0）の 42%/15% が理想だが、span が狭いキーフレーム
        // 構成では 2*rise+minPlateau が span を超え、旧実装は a を t0 にクランプするだけ
        // だった。c（退場フェード開始 = t1-rise）は span に関わらず変わらないため、
        // クランプされた a（→ b = a+rise）が c を追い越し「一瞬光ってすぐ消える」不具合が
        // 再発した（0.8.6 が直したはずの不具合。凜さん 2026-07-04「また収束がスムーズ
        // じゃなくなってる」）。ここでは rise と minPlateau を span に収まるよう比例縮小し、
        // b <= c（フェードイン完了 <= フェードアウト開始）を span の広さによらず数式的に
        // 保証する（0.001 は smooth() の a===b 除算 0 を避けるための下限）。
        //
        // 【2026-07-08 rise を 25%→32%に拡大】実測で判明: 実文字は opacity=0・
        // blur=6px のまま長く待機した後、わずかなスクロール量で一気に
        // opacity=1・blur=0 まで到達していた（凜さん 2026-07-08「テキストが
        // 白から黒に変わるので、なんかちらつきが見えます」）。当初 42% まで
        // 広げたが、2*rise+minPlateau が span のほぼ全体（0.99）を占め、
        // 真ん中の安定保持区間がほぼ消滅。非最終駅（isFinal でない駅）は
        // 「一瞬光ってすぐ消える」（この直前のコメントで既知の不具合として
        // 警告されていたまさにその症状）が再発した。
        //
        // 【付随要素とのズレも同時に発覚・修正】このrise変更とは別に、
        // 付随要素（番号・要約。glyph-stage.ts の wireChapterAccessories）が
        // 実文字本体とは異なる式（単純な smoothstep(t0,t1)）でフェードして
        // いたため、rise の値によらず「実文字はもう明滅し終わっているのに、
        // 番号・要約はまだ上がっている最中」という構造的なズレが以前から
        // 常に存在していた（凜さん 2026-07-08「ずれるようになりました。
        // まただ」実機報告。rise=25%に完全に戻しても再現したことで、
        // rise拡大が原因ではなく既存の設計不整合だったと判明）。
        // glyph-stage.ts 側に同一の窓計算（computeWindow）を追加し、
        // 付随要素も実文字と全く同じ [a,b,c,d] 窓でフェードするよう修正した
        // （そちら側のコメント参照）。これで rise を安全に広げられるように
        // なったため、安定保持区間を十分残しつつ改善幅を確保する 32% を採用
        // （2*0.32+0.15=0.79、span に対して余裕あり）。
        //
        // 【2026-07-10 isStart の a/c 特例を撤廃 → plateau 長で揃える方式に
        // 修正（提案者: 凜さん実機報告「LINNOの状態が長すぎる、次のテキストは
        // 短すぎる」。一度 c=t1-rise に統一する修正を入れたが、それでも
        // 「Being human is wanting things. の滞在時間がLINNOと比べてまだ
        // 短い」と再指摘があり、根本的に式が違うことが判明）】
        // isStart は amt 計算で最初の因子が常に 1（`w.isStart ? 1 : ...`）＝
        // フェードイン不要（進捗0より前から既に実文字表示済みのため）。
        // 中間駅は span の中に「rise（到着直後のフェードイン）＋ plateau
        // （くっきり静止）＋ fall（退場フェードアウト）」の3つを収める必要が
        // あり、rise が span の大半（2*44%=88%）を食うため plateau は
        // desiredPlateau*shrink（span の約14.6%）まで圧縮される。
        // isStart はこの rise が要らない分、c を t1-rise に置くと
        // 「中間駅が rise+plateau に使う分すべて」を丸ごと plateau に
        // 使うことになり、中間駅の plateau（span の約14.6%）よりずっと
        // 長い静止時間になってしまう（これが c=t1-rise でも直らなかった
        // 理由）。真に公平にするには、isStart の plateau 長そのものを
        // 中間駅の plateau 長（minPlateau）に、fall 長を中間駅の fall 長
        // （rise）に一致させる必要がある。c = t0 + minPlateau（rise 分を
        // 待たずに、中間駅と同じ静止時間が経ったらすぐ退場を始める）、
        // d = c + rise とする。
        // 【対になる修正】このタイミング式が「そもそも LINNO だけ無駄な
        // form フェーズ幅を持っている」根本原因も併せて修正: GlyphStageEngine.tsx
        // の buildTiming と glyph-stage.ts の computeStationTimes で、
        // hasLeadingMorph=false の駅0の FORM 重みを 0 にした（駅0は
        // 「粒子が収束してくる」形成過程が存在せず＝最初から実文字表示済みの
        // ため、形成フェーズに時間を割く意味がない）。二つの修正は独立だが、
        // 片方だけでは体感時間は変わらない（後者が times[] 自体を圧縮し、
        // 前者はその圧縮された times[] の中で他駅と同じ plateau/fall 長を
        // 保証する）。
        const span = Math.max(t1 - t0, 0);
        const desiredRise = span > 0 ? span * 0.44 : 0.02;
        const desiredPlateau = span * 0.15;
        const totalDesired = desiredRise * 2 + desiredPlateau;
        const shrink =
          totalDesired > 0 && totalDesired > span ? span / totalDesired : 1;
        const rise = Math.max(0.001, desiredRise * shrink);
        const minPlateau = Math.max(0, desiredPlateau * shrink);
        const staggerCatchUp = t0 + style.stagger * 0.5 * (1 - t0);
        const latestA = t1 - 2 * rise - minPlateau;
        const a = gi === 0 ? t0 : Math.min(staggerCatchUp, latestA);
        const c = gi === 0 ? Math.min(t0 + minPlateau, t1 - rise) : t1 - rise;
        windows.push({
          selector: kf.domSelector,
          a,
          b: a + rise,
          c,
          d: c + rise,
          isStart: gi === 0,
          isFinal: gj === n - 1,
          holdResolved,
        });
      }
      gi = gj + 1;
    }

    return { isText, isScatter, hasResolve, resolveText, swapAt, windows, groupStart, groupEnd };
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

    const buffers = buildKeyframeTargetsList(keyframes, count, {
      visW,
      mobile,
      cameraFov,
      cameraZ,
      scatterPattern: style.scatterPattern,
    });

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
      uStaggerCollapse: { value: 0 },
      uCurl: { value: style.curl },
      uSmoother: { value: style.easing === "smoothstep" ? 0 : 1 },
      uSparkle: { value: style.sparkle },
      uPixelRatio: { value: 1 },
      uColorInk: { value: colors.ink.clone() },
      uColorAccent: { value: colors.accent.clone() },
      uAlphaVar: { value: style.alphaVar },
      uDof: { value: style.dof },
      uFocus: { value: cameraZ },
      uWave: { value: style.wave },
      uBloom: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vertexShader],
  );

  // --- 動く DOM ターゲットの毎フレーム追跡（2026-07-07 追加） ---
  // buildGlyphFromDOM のサンプルは「その瞬間の要素位置」を座標に焼き込むため、
  // 対象が sticky でなく普通にスクロールで流れる要素だと、収束アニメーション中に
  // 位置がどんどん古くなり「粒子は昔の位置へ集まり、実テキストは今の位置に出る」
  // 二重像になる（凜さん 2026-07-07「収束がおかしい」。実ブラウザ録画のコマ分解で
  // 上下にズレた二重像を確認）。resampleSignal による離散的な再サンプリングでは
  // バケット境界でターゲットが数百 px 飛ぶため根本解決にならない。
  // 対策: 形の再サンプリング（オフスクリーン描画＋getImageData、重い）は初回だけに
  // 留め、毎フレームは「サンプリング時点からのスクロール差分」だけ points 全体を
  // 平行移動する。差分は window.scrollY の引き算のみ＝DOM 読み取りゼロで、
  // 毎フレーム走ってもレイアウト強制（forced synchronous layout）を起こさない。
  // sticky な対象（ヒーロー見出し等）はスクロールしても画面位置が変わらないため
  // このオフセットを適用してはならない — rebase 時に「対象が sticky 配置か」を
  // 一度だけ判定し、sticky なら追跡を無効化する。再サンプリングが走った時は
  // 基準も取り直すので二重適用にはならない（サンプルが現在位置を焼き込む＝
  // オフセット 0 から再スタート）。
  const trackingActiveRef = useRef(false);
  const trackBaseScrollYRef = useRef(0);

  // 追跡の基準を取り直す（サンプリング直後に呼ぶ）。points の平行移動もリセット。
  const rebaseTracking = () => {
    trackingActiveRef.current = false;
    // 最後の domSelector 付きキーフレーム＝収束先を基準要素にする。
    for (let i = n - 1; i >= 0; i--) {
      const kf = keyframes[i];
      if (kf?.type === "text" && kf.domSelector) {
        const el = document.querySelector<HTMLElement>(kf.domSelector);
        if (el) {
          // sticky 祖先を持つ対象は画面位置がスクロールに追従しない（ヒーロー
          // 構成）。その場合オフセットはむしろ位置を壊すので追跡しない。
          let sticky = false;
          for (
            let node: HTMLElement | null = el;
            node;
            node = node.parentElement
          ) {
            const pos = getComputedStyle(node).position;
            if (pos === "sticky" || pos === "fixed") {
              sticky = true;
              break;
            }
          }
          if (!sticky) {
            trackingActiveRef.current = true;
            trackBaseScrollYRef.current = window.scrollY;
          }
        }
        break;
      }
    }
    const p = pointsRef.current;
    if (p) p.position.y = 0;
  };

  // resolveToDom: 実文字オーバーレイを粒子グリフにピクセル整列させる。
  // アルゴリズムは vanilla.ts の同種の解決処理と共通化されている（{@link alignGlyphOverlay}）。
  const positionOverlay = () => {
    const el = resolveRef?.current;
    if (!el || !timeline.hasResolve) return;
    const finalBuf = built.buffers[n - 1];
    if (!finalBuf) return;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const { worldW: visW } = viewSizeAtZ0(vpW, vpH, cameraFov, cameraZ);

    // 最終キーフレームのフォント文字列から family / weight を取り出す
    // （例 "900 260px 'Helvetica Neue', Helvetica, Arial, sans-serif"）。
    const finalKf = keyframes[n - 1];
    const fontStr =
      finalKf?.type === "text" && finalKf.font
        ? finalKf.font
        : DEFAULT_DENSE_FONT;

    alignGlyphOverlay(el, finalBuf, {
      text: timeline.resolveText,
      font: fontStr,
      viewportW: vpW,
      viewportH: vpH,
      visibleWorldW: visW,
    });
  };

  // 初回 / フォント読込 / リサイズで再サンプリング・再配置（DOM とピタリ重ねる）。
  const rebuildDomGlyphs = () => {
    const updated = new Set<number>();
    // 同一字形（同一テキスト・同一 domSelector）の連続キーフレームは 1 回だけ
    // サンプリングして共有する。独立にサンプリングすると粒子割り当てが乱数で
    // 変わり、保持区間で「同じ字形の別の配置」へ泳ぎ直す再収束が起きる
    // （geometry.ts の sameGlyphKeyframe コメント参照）。
    const sampleCache = new Map<string, Float32Array>();
    keyframes.forEach((kf, i) => {
      if (kf.type !== "text" || !kf.domSelector) return;
      const cacheKey = `${kf.domSelector}\u0000${kf.text}`;
      let next = sampleCache.get(cacheKey) ?? null;
      if (!next) {
        next = buildGlyphFromDOM(count, kf.text.split("\n"), {
          selector: kf.domSelector,
          fovDeg: cameraFov,
          cameraZ,
          // 粒子がレンダリングされる canvas の実寸（CSS px）。
          // window.innerWidth だとスクロールバー分ずれるため size を使う（常に最新値を
          // 読むため ref 経由。理由は sizeRef 宣言部のコメント参照）。
          viewportW: sizeRef.current.width,
          viewportH: sizeRef.current.height,
        });
        if (next) sampleCache.set(cacheKey, next);
      }
      if (!next) return;
      const attr = built.geo.getAttribute(glyphPositionAttribute(i)) as
        | THREE.BufferAttribute
        | undefined;
      if (!attr) return;
      (attr.array as Float32Array).set(next);
      attr.needsUpdate = true;
      updated.add(i);
    });
    // `around:"glyph"` の局所 scatter は参照字形の位置に追従して作り直す
    // （参照側が動いたのに雲だけ古い位置に残ると、局所化の意味がなくなる）。
    // 生成は index 決定論（buildScatterAroundTargets のコメント参照）なので、
    // 再生成しても雲は参照字形の移動分だけ平行移動し、粒子はワープしない。
    // attr.array と built.buffers[i] は同一の Float32Array を指すため、
    // 上の text 更新は built.buffers 経由でここから既に見えている。
    keyframes.forEach((kf, i) => {
      if (kf.type !== "scatter") return;
      let next: Float32Array | null = null;
      if (kf.anchorSelector) {
        // 別 canvas の実 DOM 位置への着地（types.ts の anchorSelector 参照）。
        // 対象は普通のスクロール要素の場合もあるため、参照テキストの更新有無に
        // 関わらず毎回追従させる（sticky 固定なら値は変わらず無害）。
        next = buildScatterAroundAnchor(
          count,
          kf.spread ?? 1,
          kf.anchorSelector,
          {
            cameraFov,
            cameraZ,
            viewportW: sizeRef.current.width,
            viewportH: sizeRef.current.height,
            visW: built.visW,
          },
          style.scatterPattern,
        );
      }
      if (!next) {
        if (kf.around !== "glyph") return;
        const refIdx = scatterGlyphRefIndex(keyframes, i);
        if (refIdx < 0 || !updated.has(refIdx)) return;
        const ref = built.buffers[refIdx];
        if (!ref) return;
        next = buildScatterAroundTargets(
          count,
          kf.spread ?? 1,
          ref,
          style.scatterPattern,
          built.visW,
        );
      }
      if (!next) return;
      const attr = built.geo.getAttribute(glyphPositionAttribute(i)) as
        | THREE.BufferAttribute
        | undefined;
      if (!attr) return;
      (attr.array as Float32Array).set(next);
      attr.needsUpdate = true;
    });
    positionOverlay();
    // 新しいサンプルは現在の DOM 位置を焼き込んでいるため、追跡の基準もここで
    // 取り直す（rebaseTracking のコメント参照）。
    rebaseTracking();
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

  // resampleSignal 変化時: マウント直後の初回サンプリングと同じ rebuildDomGlyphs
  // を、Canvas/WebGLコンテキストは維持したまま再実行する（呼び出し側コメント
  // 参照）。初回マウント時（built 変化時の上の effect）と重複実行しても
  // rebuildDomGlyphs は冪等（現在の DOM 位置を読み直すだけ）なので副作用はない。
  const isFirstResample = useRef(true);
  useEffect(() => {
    if (isFirstResample.current) {
      // 初回マウントは上の [built] effect が既に処理するため二重実行を避ける。
      isFirstResample.current = false;
      return;
    }
    rebuildDomGlyphs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resampleSignal]);

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
    u.uAlphaVar.value = style.alphaVar;
    u.uDof.value = style.dof;
    u.uFocus.value = cameraZ;
    u.uWave.value = style.wave;
    // bloom の HDR ブーストはコンポーザー（GlyphDust 側）とペアで効く。モバイルは
    // コンポーザーを積まないので、ブーストだけ残って色が飛ばないよう 0 に畳む。
    u.uBloom.value = isMobile() ? 0 : style.bloom;
    mat.blending =
      style.blend === "additive"
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;
    mat.needsUpdate = true;
  }, [style.size, style.drift, style.stagger, style.curl, style.easing, style.sparkle, style.blend, style.alphaVar, style.dof, style.wave, style.bloom, cameraZ]);

  useFrame((state) => {
    const p = pointsRef.current;
    const mat = matRef.current;
    if (!p || !mat) return;
    const u = mat.uniforms as unknown as GlyphUniforms;

    // 動く DOM ターゲットの追跡: サンプリング時点からのスクロール差分だけ
    // points 全体を平行移動する（trackingActiveRef 宣言部のコメント参照）。
    // window.scrollY の読み取りのみ＝DOM 読み取りゼロで毎フレーム安全。
    if (trackingActiveRef.current) {
      const dyPx = window.scrollY - trackBaseScrollYRef.current;
      // 画面 px → ワールドの換算（z=0 平面では縦横同スケール）。
      const w = sizeRef.current.width || 1;
      const { worldW: visWNow } = viewSizeAtZ0(
        w,
        sizeRef.current.height || 1,
        cameraFov,
        cameraZ,
      );
      p.position.y = dyPx * (visWNow / w);
    }

    const raw = THREE.MathUtils.clamp(getProgress(), 0, 1);
    // スクロール進捗を直接ステージに反映（lerp 追従は間延びの原因になる）。
    // 慣性は driver 側（Lenis 等）で付けるのが正しい役割分担。
    stage.current = raw;
    const s = stage.current;

    // --- 補間スカラ（CPU 側で意味論を解決し uniform へ） ---
    let settle = 0;
    let burst = 0;
    // 全キーフレーム到達点に対する stagger 収束窓（shaders.ts の uStaggerCollapse
    // コメント参照）。各到達点 times[i] の直前で 0→1 に立ち上がり、その瞬間には
    // 必ず全粒子が寸分違わずターゲットへ揃う。窓幅は前のキーフレームとの間隔の
    // 半分（間隔が狭い駅では窓も比例して狭める。広すぎると手前の駅の保持中に
    // 次の収束の畳み込みが早期発火してしまう）。
    let staggerCollapse = 0;
    for (let i = 0; i < n; i++) {
      const c = times[i] ?? 0;
      const prev = times[i - 1] ?? 0;
      const next = times[i + 1] ?? 1;
      // settle は「同一字形グループ」単位で計算する（timeline.groupStart/End
      // コメント参照。個別キーフレームごとの bump の max だと、同一グループ
      // 内部の境界で沈み込みが起きるため、グループの先頭でのみ 1 回計算する）。
      if (timeline.isText[i] && i === timeline.groupStart[i]) {
        const gEnd = timeline.groupEnd[i]!;
        const groupPrev = times[i - 1] ?? 0;
        const groupNext = times[gEnd + 1] ?? 1;
        const rise = smooth(groupPrev, c, s);
        const fall = 1 - smooth(times[gEnd] ?? c, groupNext, s);
        settle = Math.max(settle, rise * fall);
      }
      if (timeline.isScatter[i]) burst = Math.max(burst, bump(s, c, prev, next));
      const width = Math.max(0.02, (c - prev) * 0.5);
      staggerCollapse = Math.max(staggerCollapse, smooth(c - width, c, s));
    }

    // form: 最終キーフレームが text/shape のとき、その最終遷移の進捗。
    let form = 0;
    const lastIsText = timeline.isText[n - 1] === true;
    if (lastIsText && n >= 2) {
      form = smooth(times[n - 2] ?? 0, times[n - 1] ?? 1, s);
    }
    // 先頭キーフレームが text/shape のとき: 冒頭は「字形が締まった」状態から始め、
    // 最初の遷移で解けていく。これがないと「実文字が消えてから粒子が湧く」空白が出る。
    const firstIsText = timeline.isText[0] === true;
    if (firstIsText && n >= 2) {
      const formStart = 1 - smooth(times[0] ?? 0, times[1] ?? 1, s);
      form = Math.max(form, formStart);
    }
    // swapFade > 0 なら瞬時切替の代わりに swap 点から swapFade 幅で滑らかに立ち上げる
    // （凜さん 2026-07-11「スッと消えて→凝縮したテキストの形→拡散、をスムーズに」。
    // 既定 0 は従来どおりの瞬時切替＝挙動不変）。
    let swapped =
      swapFade && swapFade > 0
        ? smooth(timeline.swapAt, timeline.swapAt + swapFade, raw)
        : raw >= timeline.swapAt
          ? 1
          : 0;
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
        // isStart と isFinal が両方 true（＝キーフレーム全体が単一の domSelector 窓）
        // だと amt は常に 1 になり、粒子は一切現れない。これは意図した挙動:
        // isStart=「進捗0から既に解決済みなのでフェードイン不要」、isFinal=「最後まで
        // 解決済みのままなのでフェードアウト不要」を素直に合成すると「常に解決済み」＝
        // アニメーションすべき遷移がそもそも存在しない設定になる。
        const amt =
          (w.isStart ? 1 : smooth(w.a, w.b, s)) *
          (w.isFinal ? 1 : 1 - smooth(w.c, w.d, s));
        // 出発駅窓（holdResolved）は粒子ゲートにだけ参加し、実 DOM には触らない
        // （群れが飛び立っても実文字は crisp のまま残る。types.ts のコメント参照）。
        if (!w.holdResolved) {
          let el = windowElsRef.current.get(w.selector);
          // el が取れているのに DOM から外れている（React の条件描画/キー変更で
          // 差し替えられた等）場合は再取得する。isConnected を見ないと、差し替え後の
          // 要素には一切書き込まれず無警告のまま外れた古い要素に opacity を流し続ける。
          if (el === undefined || (el !== null && !el.isConnected)) {
            el = document.querySelector<HTMLElement>(w.selector);
            windowElsRef.current.set(w.selector, el);
          }
          if (el) {
            el.style.opacity = String(amt);
            // 滲み出し/溶け戻り中は軽くぼかし、定着でピントが合う（morphTo と同じ表現）。
            //
            // 【2026-07-08 filter の on/off 切替を廃止】旧実装は blur が閾値を下回ると
            // `filter` プロパティ自体を空文字列に戻していた（"blur(0.05px)" → ""）。
            // ブラウザは filter 適用中と未適用で描画パイプライン（GPU合成レイヤーの
            // 有無）が異なるため、この境界をまたぐ瞬間にレンダリングが一瞬切り替わり
            // 「収束したときにちらつく」ように見えていた（凜さん 2026-07-08 実機報告）。
            // filter プロパティは常に blur() で設定したままにし（0px でも filter 自体は
            // 適用され続ける）、値だけを連続的に 0 へ近づける。これで描画パイプラインの
            // 切り替わりが一切発生しなくなる。
            const blur = Math.max(0, (1 - amt) * 6);
            el.style.filter = `blur(${blur.toFixed(2)}px)`;
          }
        }
        if (amt > amtMax) amtMax = amt;
      }
      // 粒子の溶解は実テキストの立ち上がりに「先行」させる（0.9.5）。
      // 旧: resolve = amtMax（粒子の透明化＝テキスト不透明度の同一カーブ）。
      // 同一カーブだと、テキストがほぼ読める状態（amt 0.7〜0.95）でも stagger の
      // 遅参粒子がうっすら見えたまま動き続け、「収束しきった後もスタート地点で
      // 粒子がちょっと揺れる」体感になっていた（凜さん 2026-07-08「これなくしたい」。
      // 実測: 収束後もテキスト前面で約 1 秒間ピクセル変化が継続）。
      //
      // 【2026-07-08 再調整】初版は amt 0.2→0.72 で粒子を消し切っていたが、
      // 0.72 という早いカットオフのせいで「amt 0.72〜1.0 の間は何も起きない
      // 静止区間」が生まれ、収束が「途中で唐突にパッと切り替わって終わる」
      // 体感になっていた（凜さん 2026-07-08「収束のスタイルが変わった・
      // 収束が急になった」）。上限を 0.9 まで押し戻し、粒子が消えるまでの
      // 余韻を長く保ちつつ（残り揺れが出ていた amt=1 付近の直前で確実に
      // 消し切るので元の不具合は再発しない）、唐突さを解消する。
      resolve = smooth(0.3, 0.9, amtMax);
      textReveal = 0; // 旧経路（resolveRef / resolveDomSelector）は使わない
    }

    u.uTime.value = state.clock.elapsedTime;
    u.uStage.value = s;
    u.uForm.value = form;
    u.uSettle.value = settle;
    u.uStaggerCollapse.value = staggerCollapse;
    u.uBurst.value = burst * (1 - form) * style.burst;
    u.uSwap.value = swapped;
    u.uResolve.value = resolve;

    // resolveToDom: 解決先（自前オーバーレイ or 実 DOM 要素）の不透明度を
    // textReveal（少し遅らせた出現）に同期する。
    // 自前オーバーレイ（domSelector 無しの最終キーフレーム）は解決窓（windows）の
    // 対象に絶対に入らない（windows は domSelector 付きキーフレームだけを束ねるため）。
    // 途中に domSelector 窓があっても、フィナーレの自前オーバーレイは独立して駆動する
    // 必要がある。以前は `windows.length === 0` を条件にしていたため、途中に窓が
    // ひとつでもあるとフィナーレの opacity が永久に 0 のまま固まっていた
    // （resolveRef と resolveDomSelector を同列に windows.length===0 でガードしていた
    // せい。resolveDomSelector 版フィナーレは窓ループが同じ要素を既に駆動しているので
    // 二重駆動を避けるためそちらだけ引き続きガードする）。
    if (timeline.hasResolve) {
      const ownOverlay = resolveRef?.current ?? null;
      if (ownOverlay) {
        ownOverlay.style.opacity = String(textReveal);
      } else if (resolveDomSelector && timeline.windows.length === 0) {
        if (!resolveDomElRef.current || !resolveDomElRef.current.isConnected) {
          resolveDomElRef.current =
            document.querySelector<HTMLElement>(resolveDomSelector);
        }
        if (resolveDomElRef.current) {
          resolveDomElRef.current.style.opacity = String(textReveal);
        }
      }
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
