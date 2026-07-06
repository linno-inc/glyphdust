/**
 * types.ts — glyphdust の公開型。
 */

import type { ReactNode } from "react";
import type { DriverConfig } from "./drivers.js";

/**
 * 文字塊の一部（ラン）。{@link TextKeyframe.segments} で使う。
 * 区間ごとに別の `font` を当て、1 つの字形の中で書体を混在させる。
 */
export interface TextSegment {
  /** この区間のテキスト。`\n` で行分割（次の区間は次行へ続く）。 */
  text: string;
  /** この区間の Canvas2D `font` 文字列。未指定なら親キーフレームの `font`（さらに無ければ既定）。 */
  font?: string;
}

/**
 * テキストキーフレーム。文字を粒子字形にする。
 * 改行は `\n` で明示する（`"次のユーザーは、\n人じゃない。"`）。
 */
export interface TextKeyframe {
  type: "text";
  /** 描画テキスト。`\n` で行分割。 */
  text: string;
  /**
   * 区間ごとに書体を変えて 1 つの字形を組む（書体混在）。
   * 指定すると粒子のスタンプは `segments` から生成され、各区間はインラインに流れる
   * （区間内の `\n` で改行）。`text` は引き続きアクセシブルな文言・`resolveToDom` の
   * 解決先テキストとして使われる（`segments` の連結と一致させるのが望ましい）。
   * `domSelector` 併用時は無効（DOM 側のレイアウトを使う）。`dense` とは併用しない。
   */
  segments?: TextSegment[];
  /** Canvas2D の `font` 文字列。未指定なら密度に応じた既定。`segments` の既定書体にもなる。 */
  font?: string;
  /** 字形を収める可視ワールド幅。未指定なら可視幅からの既定比率。 */
  worldW?: number;
  /** ワールド x オフセット（右が +）。 */
  offsetX?: number;
  /** ワールド y オフセット（上が +）。 */
  offsetY?: number;
  /**
   * 実 DOM 要素のセレクタ。指定すると、その要素の矩形・フォントに
   * ピクセル単位で重なる字形を生成する（クロスフェード中に文字が動かない）。
   */
  domSelector?: string;
  /**
   * フィナーレでこの字形を実 DOM 文字へ解決（粒子を消し実テキストへクロスフェード）。
   * 通常は最終キーフレームに付ける。
   */
  resolveToDom?: boolean;
  /** 高密度・均一サンプリング（穴の目立たないワードマーク向け）。 */
  dense?: boolean;
}

/** 飛散キーフレーム。粒子をランダム雲へ拡散する。 */
export interface ScatterKeyframe {
  type: "scatter";
  /** 拡散半径の倍率。既定 1。 */
  spread?: number;
}

/** キーフレーム（テキスト or 飛散）。 */
export type Keyframe = TextKeyframe | ScatterKeyframe;

/** 配色。 */
export interface GlyphColors {
  /** 主体色（多数の粒）。既定 `#1b2330`。 */
  ink?: string;
  /** アクセント色（少数の粒）。既定 `#0055ff`。 */
  accent?: string;
  /** アクセント色になる粒の割合 0..1。既定 0.18。 */
  accentRatio?: number;
}

/** デバイス別の粒子数。 */
export interface GlyphCount {
  /** デスクトップの粒子数。既定 11000。 */
  desktop?: number;
  /** モバイル（<=768px）の粒子数。既定 5200。 */
  mobile?: number;
}

/** カメラ設定。 */
export interface GlyphCamera {
  /** z 位置。既定 7。 */
  z?: number;
  /** 縦 fov（度）。既定 42。 */
  fov?: number;
}

/**
 * 粒子の見た目・モーションの質感。
 * すべて省略可。{@link GlyphPreset} の上に個別上書きできる（プリセット＋上書き）。
 */
export interface GlyphStyle {
  /** 点サイズ倍率。既定 1。大きいほど太い粒（可読性↓・密度感↑）。 */
  size?: number;
  /**
   * 合成モード。
   *  - `"normal"`（既定）… 明背景で可読性が高い。
   *  - `"additive"` … 重なりで発光する。暗背景のアンビエント/グロー向け。
   */
  blend?: "normal" | "additive";
  /** アイドル/飛散時の漂い量 0..1。既定 1。0 で静止（端正）。 */
  drift?: number;
  /** きらめく粒の強さ 0..1。既定 1。0 で無効（ミニマル）。 */
  sparkle?: number;
  /**
   * 粒子ごとの到達タイミング分散（stagger）の強さ 0..~0.4。既定はプリセット依存。
   * seed で各粒子の morph 開始を遅らせ「一斉移動」を「群れが集まる」波動感にする。
   * 終盤（字形形成〜保持）では自動で 0 に畳まれ、整列・resolve のピクセル一致は保たれる。
   */
  stagger?: number;
  /**
   * アイドル漂いに curl noise（発散ゼロの流れ場）を使う強さ 0..~1.5。既定はプリセット依存。
   * 0 で軸独立 sin/cos の軽量漂い、>0 で流体的な渦の漂い。
   * モバイルでは負荷軽減のため内部で自動的に軽量パス（0）へフォールバックする。
   */
  curl?: number;
  /**
   * 位置補間の easing。既定 `"smootherstep"`（C2・加速度が滑らか, Perlin 2002）。
   * `"smoothstep"` で旧来の C1（境界で加速度ジャンプ）。比較・検証用の切替。
   */
  easing?: "smoothstep" | "smootherstep";
  /**
   * 飛散雲の点分布。既定 `"fibonacci"`（黄金角・均等で有機的, Vogel 1979）。
   * `"random"` で一様乱数球殻（局所的にクランプ＝ムラが出る）。比較・検証用の切替。
   */
  scatterPattern?: "random" | "fibonacci";
}

/**
 * 質感プリセット。`style` で部分上書きできる。
 *  - `"default"` … 現行の標準（バランス型）。
 *  - `"minimal"` … 漂い・きらめき控えめで端正。明背景の本文向け。
 *  - `"lively"`  … 漂い・きらめき強めで躍動的。
 *  - `"glow"`    … additive 合成の発光。暗背景のヒーロー/アンビエント向け。
 */
export type GlyphPreset = "default" | "minimal" | "lively" | "glow";

/** {@link GlyphDust} の props。 */
export interface GlyphDustProps {
  /** キーフレーム列（最低 1、通常 text → scatter → text）。 */
  keyframes: Keyframe[];
  /** 進捗ドライバ。既定 `{ type: "scroll" }`。 */
  driver?: DriverConfig;
  /** 質感プリセット。既定 `"default"`。`style` で部分上書き可。 */
  preset?: GlyphPreset;
  /** 粒子の見た目・モーションの個別上書き（プリセットより優先）。 */
  style?: GlyphStyle;
  /** 配色。 */
  colors?: GlyphColors;
  /** デバイス別粒子数。 */
  count?: GlyphCount;
  /** r3f Canvas の dpr 範囲。既定 `[1, 1.75]`。 */
  dpr?: [number, number];
  /** カメラ設定。 */
  camera?: GlyphCamera;
  /**
   * 各キーフレームの正規化時刻 0..1（補間境界）。
   * 未指定なら等間隔。長さは keyframes と一致させる。
   */
  timing?: number[];
  /** reduced-motion / WebGL 不可時に描画するフォールバック（真っ白防止）。 */
  fallback?: ReactNode;
  /** ラッパーに付けるクラス名。 */
  className?: string;
  /**
   * この値が変化するたびに、domSelector 付きキーフレームの目標座標を
   * Canvas/WebGLコンテキストを維持したまま再サンプリングする（buildGlyphFromDOM
   * の再実行のみ。マウント・アンマウントは発生しない）。
   *
   * なぜ必要か: domSelector サンプリングはマウント時（＋resize/font-load）にしか
   * 走らないため、sticky でなく普通にスクロールする要素（例: 縦長の段落）を
   * 対象にすると、マウント直後にサンプリングした座標のまま以後スクロールしても
   * 更新されない。ユーザーがスクロールを続けるとサンプリング時点の座標と
   * 実際の要素位置がどんどんズレていき、粒子が「実際には画面外の古い位置」へ
   * 収束しようとして何も見えなくなる（発見: 凜さん 2026-07-06「粒子が正しい
   * 位置に収束しない」。事業サイトの GlyphManifesto コンポーネントで実証:
   * マウントから ~1500px スクロールする間、粒子canvasも実テキストも両方
   * 不可視になる区間があった）。呼び出し側がスクロール位置に応じてこの値を
   * 定期的に変えることで、ズレを許容範囲に留められる。
   */
  resampleSignal?: number;
}
