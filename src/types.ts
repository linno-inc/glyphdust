/**
 * types.ts — glyphdust の公開型。
 */

import type { ReactNode } from "react";
import type { DriverConfig } from "./drivers.js";

/**
 * テキストキーフレーム。文字を粒子字形にする。
 * 改行は `\n` で明示する（`"次のユーザーは、\n人じゃない。"`）。
 */
export interface TextKeyframe {
  type: "text";
  /** 描画テキスト。`\n` で行分割。 */
  text: string;
  /** Canvas2D の `font` 文字列。未指定なら密度に応じた既定。 */
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

/** インタラクション設定。 */
export interface GlyphInteraction {
  /** ポインタ追従（近傍反発）。既定 true。 */
  pointer?: boolean;
  /** ドラッグ回転（慣性つき）。既定 true。 */
  drag?: boolean;
}

/** {@link GlyphDust} の props。 */
export interface GlyphDustProps {
  /** キーフレーム列（最低 1、通常 text → scatter → text）。 */
  keyframes: Keyframe[];
  /** 進捗ドライバ。既定 `{ type: "scroll" }`。 */
  driver?: DriverConfig;
  /** 配色。 */
  colors?: GlyphColors;
  /** デバイス別粒子数。 */
  count?: GlyphCount;
  /** r3f Canvas の dpr 範囲。既定 `[1, 1.75]`。 */
  dpr?: [number, number];
  /** インタラクション設定。 */
  interaction?: GlyphInteraction;
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
}
