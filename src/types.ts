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
  /**
   * この解決窓（resolveToDom グループ）を「出発駅」として扱う: 粒子の溶解ゲート
   * （uResolve）の計算には従来どおり参加するが、**実 DOM 要素の opacity / filter は
   * 一切書かない**。
   *
   * なぜ必要か: 「一つの粒子群がページを旅する」構成（セグメント方式）では、
   * 群れが出発駅の字形から飛び立つとき、粒子だけが湧き出て実文字は crisp の
   * まま残ってほしい（読了済みのテキストが群れに連れ去られて消えるのは読書体験の
   * 破壊）。従来の窓は出発時に実文字の opacity も一緒に下げてしまうため、
   * 出発駅専用のこのフラグを用意する（提案者: 凜さん 2026-07-08
   * 「パーティクルズの旅みたいにしたい」の実装要件として Claude 提案）。
   * 副次効果として、同じ要素を別の GlyphDust インスタンス（例: ヒーロー）が
   * 駆動している場合の opacity 二重書き込み競合も防げる。
   */
  holdResolved?: boolean;
  /** 高密度・均一サンプリング（穴の目立たないワードマーク向け）。 */
  dense?: boolean;
}

/** 飛散キーフレーム。粒子をランダム雲へ拡散する。 */
export interface ScatterKeyframe {
  type: "scatter";
  /** 拡散半径の倍率。既定 1。 */
  spread?: number;
  /**
   * 飛散雲の広がりの基準。
   *  - `"viewport"`（既定）… 従来どおり画面中心の全面クラウド（半径は可視領域スケール）。
   *  - `"glyph"` … 隣接する字形キーフレーム（次を優先、無ければ前）のターゲット
   *    バウンディングボックスに合わせた局所クラウド。粒子は「これから形成される
   *    （または直前まで形成していた）文字の近傍」にだけ漂う。
   *
   * なぜ必要か: `"viewport"` の全面クラウドは、ページ内のどれか 1 要素でも
   * 飛散フェーズにあると画面全体が砂まみれになる。本文など複数要素を順に
   * 粒子化する構成では「文字が何も読めない砂嵐の画面」が構造的に発生していた
   * （凜さん 2026-07-08「砂嵐」「文字が出るのが遅い」の根本解決として局所散開を
   * 選択。チューニングでの軽減ではなく構造の除去）。
   */
  around?: "viewport" | "glyph";
  /**
   * scatter の中心を、キーフレーム配列内の隣接字形（`around:"glyph"`）ではなく
   * 外部の実 DOM 要素の画面位置に固定する。指定時はこちらが `around` より優先。
   *
   * なぜ必要か: 複数の GlyphDust インスタンス（チャプター）が同じ画面を順番に
   * 使う構成（例: 永続 sticky 舞台に複数チャプターを同居させる設計）では、
   * 前チャプターの「旅立ちの雲」は自分の canvas 内の字形にしか
   * `around:"glyph"` できず、次チャプターの雲は別 canvas の別画面位置に現れる
   * ため、両者の位置が一致せず「一瞬で別の場所へ瞬間移動した」ように見えた
   * （凜さん 2026-07-08 実機確認: マニフェスト［中央寄せ］→事業内容見出し
   * ［左寄せ］の受け渡しで再現）。anchorSelector で次チャプターの最初の駅の
   * 実 DOM 位置を明示的に狙わせることで、前チャプターの雲がその場所へ向けて
   * 溶けていくようにする（要素が見つからない/計測不能なら `around` の挙動へ
   * フォールバック）。
   */
  anchorSelector?: string;
}

/**
 * シェイプキーフレーム。SVG パスデータ（`<path d="…">` の中身）を粒子で形にする。
 * テキスト同様、字形（＝形）として settle / form の補間対象になる
 * （提案者: 凜さん 2026-07-06「テキストだけでなく形も表現できるようにしたい」）。
 *
 * ```tsx
 * { type: "shape", path: "M12 2 L22 22 L2 22 Z" }               // 三角形
 * { type: "shape", path: heartPathD, viewBox: [0, 0, 24, 24] }  // アイコン
 * ```
 *
 * 任意の SVG は `<path>` の `d` を渡せば表現できる（複数 `<path>` は配列で）。
 * アスペクト比は保存され、`worldW` はシェイプのバウンディングボックスの
 * ワールド幅を意味する（テキストの「canvas 全幅」とは違い、形そのものの幅）。
 */
export interface ShapeKeyframe {
  type: "shape";
  /**
   * SVG パスデータ（`d` 属性の文字列）。複数の `<path>` からなるアイコンは
   * 配列で渡す（すべて塗りとして合成）。
   */
  path: string | string[];
  /**
   * パス座標系の表示範囲 `[minX, minY, width, height]`（SVG の `viewBox` と同形式）。
   * 未指定なら実行時にパスのバウンディングボックスを自動計測する。
   * サイズ・位置を決定的にしたいとき（アイコンの余白込みで揃えたい等）は明示する。
   */
  viewBox?: [number, number, number, number];
  /**
   * 塗りの規則。SVG の `fill-rule` と同じ。既定 `"nonzero"`。
   * ドーナツ状の抜き（穴）があるパスで穴が塗り潰されるときは `"evenodd"` を試す。
   */
  fillRule?: "nonzero" | "evenodd";
  /** シェイプ（バウンディングボックス）のワールド幅。未指定なら可視幅からの既定比率。 */
  worldW?: number;
  /** ワールド x オフセット（右が +）。 */
  offsetX?: number;
  /** ワールド y オフセット（上が +）。 */
  offsetY?: number;
}

/** キーフレーム（テキスト / 飛散 / シェイプ）。 */
export type Keyframe = TextKeyframe | ScatterKeyframe | ShapeKeyframe;

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
  /**
   * 飛散（scatter）区間の外向きの膨らみの強さ 0..1。既定 1。
   *
   * シェーダー内部でこの膨らみは「ワールド原点からの外向き」に押し出す実装
   * （`dir = normalize(pos)`）になっている。画面中心付近（原点近く）の字形
   * 同士の遷移では自然な「ふわっと膨らむ」演出に見えるが、原点から離れた
   * 位置（例: 左寄せの見出し）へ向かう長距離の遷移では、この押し出しが
   * 進行方向と同じ向きに強く効き、「目標より行き過ぎてから戻って収束する」
   * ように見える（凜さん 2026-07-08 実機確認・複数チャプターの永続舞台構成で
   * 顕在化）。0 に設定すると膨らみを完全に無効化し、位置補間（mix）だけで
   * 動きを表現する（ふわっとした膨張感は失うが、進行方向のブレは消える）。
   */
  burst?: number;
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
  /**
   * `true` の間、r3f の描画ループ（requestAnimationFrame）を止める
   * （WebGL コンテキストは維持したまま、最後のフレームで凍結する）。既定 `false`。
   *
   * なぜ必要か: `<Canvas>` は既定で毎フレーム描画し続けるため（不可視でも）、
   * `display:none` 等の CSS で隠しているだけでは GPU 負荷は一切減らない。
   * 「WebGL コンテキストを使い回すために常時マウントしておく（生成・破棄の
   * churn を避ける）が、実際に見えていない/使っていない間は描画コストを
   * 払いたくない」という構成（例: 複数要素をキューで順に処理する持続的
   * Canvas プール）で、非アクティブなインスタンス分だけ `paused` を立てて
   * レンダリングコストをゼロに落とす（発見: 凜さん 2026-07-07「全然ダメ」
   * 指摘の調査。持続的 Canvas 化でコンテキスト枯渇は解決したが、非表示中も
   * 全インスタンスが毎フレーム描画し続けており、GPU 負荷の累積でページ全体が
   * 重くなっていた）。
   */
  paused?: boolean;
}
