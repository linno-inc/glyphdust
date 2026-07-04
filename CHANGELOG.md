# Changelog

All notable changes to **glyphdust** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.7] — 2026-07-05

### Fixed

- **解決窓（per-keyframe resolveToDom）と、末尾の domSelector 無しフィナーレ
  （自前オーバーレイ resolveToDom）を同じタイムラインで併用すると、フィナーレの
  opacity が永久に 0 のまま固まる問題を修正。** 途中に domSelector 窓が 1 つでも
  あると `windows.length === 0` のガードでフィナーレ側の更新処理ごとスキップして
  いたため。自前オーバーレイは解決窓の対象に絶対に入らない（窓は domSelector
  付きキーフレームだけを束ねる）ので、窓の有無と関係なく独立して駆動するよう修正
  （発見: コードレビュー 2026-07-05）。
- **0.8.6 の「最低保持幅（hold 幅の 15%）」保証が、幅の狭い解決窓では効かず
  「一瞬光ってすぐ消える」不具合が再発する問題を修正。** 旧実装は幅が狭いと
  フェードイン開始点を `t0` にクランプするだけで、退場フェード開始点（span に
  関わらず固定計算）を追い越すケアをしていなかった。rise（フェード幅）と
  minPlateau（最低保持幅）を窓の幅に比例縮小し、フェードイン完了が退場フェード
  開始を追い越さないことを窓の幅によらず数式的に保証するよう変更
  （発見: コードレビュー 2026-07-05）。
- **ウィンドウリサイズ / モバイル回転後、domSelector の再サンプリングが古い
  viewport 寸法のまま行われ、粒子と実 DOM テキストがピクセルずれする問題を修正。**
  リサイズリスナーがマウント時の viewport サイズを閉じ込めたクロージャのまま
  張り替えられていなかったため。常に最新の viewport サイズを ref 経由で読むように
  修正（発見: コードレビュー 2026-07-05）。
- **解決窓の対象 DOM 要素が React によって差し替えられた場合、古い（DOM から
  外れた）要素への参照をキャッシュし続け、以後 opacity 更新が無警告で効かなく
  なる問題を修正。** `isConnected` を見て、外れていれば再取得するように
  （発見: コードレビュー 2026-07-05）。

### Changed

- `GlyphPoints` 内で実文字オーバーレイをピクセル整列させるロジック
  （`positionOverlay`）が `dom-overlay.ts` の独自実装を約90行コピペしていたのを、
  既に `vanilla.ts` が使っている共通関数 `alignGlyphOverlay` の呼び出しに統合。
  今後同種のアラインメント修正が必要になっても1箇所で済む（発見: コードレビュー
  2026-07-05）。
- 公開 `timing` prop に非単調な値や範囲外の値を渡した場合、開発者向けに
  `console.warn` を出すように（従来は無警告で補間が破綻していた）。

## [0.8.6] — 2026-07-04

### Fixed

- **0.8.5 の stagger 待ちが退場フェード開始点に食い込み、保持区間がほぼゼロになる
  問題を修正。** 0.8.5 は出現フェードの開始を stagger の実質完全収束点まで送らせたが、
  退場フェード開始点（`t1 - rise`）は変更しなかったため、狭い hold 幅の構成では
  両者がほぼ衝突し「一瞬光ってすぐ消える」新たな不具合になった（発見: 凜さん
  2026-07-04「また収束がスムーズじゃなくなってる」）。折衷案として、待つのは
  実質収束点までの半分に留め（rise 中のぼかしが残りのズレを吸収する）、
  最低限の保持幅（hold 幅の 15%）を必ず確保するよう修正。

## [0.8.5] — 2026-07-04

### Fixed

- **`<GlyphDust>` の per-keyframe resolveToDom（解決窓）で、粒子が収束し切る前に
  透明化し始める問題を修正。** stagger（粒子ごとの到着タイミングのばらつき、既定
  0.08）により最も遅れる粒子は、そのキーフレームの目標形状に `t0 + stagger*(1-t0)`
  付近まで到達しない。旧式の解決窓は出現フェード（rise）を `t0` の直前後
  （`t0 - rise*0.4`）に固定していたため、多くの粒子がまだ字形へ収束し切っていない
  うちから透明化が始まり、「収束する前に粒子がスーっと消えていく」ように見えた
  （発見: 凜さん 2026-07-04「収束する前にパーティクルズが消えていく」）。
  出現フェードの開始点を stagger の実質収束完了点まで送らせるよう修正。
  最終グループ（既定の単一 resolveToDom）や `isStart` グループの挙動は変化なし。

## [0.8.4] — 2026-07-04

### Removed

- **`interaction`（ポインタ反発・ドラッグ回転）を完全削除（破壊的変更）。** `GlyphDustProps.interaction` /
  `GlyphInteraction` 型、`<GlyphDust>` のポインタ/ドラッグイベントリスナー、シェーダの
  `uPointer`/`uPointerActive` uniform とワールド空間反発計算、ドラッグ慣性回転（`rot` /
  `guard` 連動の recenter ロジック）を丸ごと除去。既定で有効だったこの機能が、
  コーポレートサイトのヒーローで意図せずカーソル反応・ドラッグ回転を起こしていた
  （提案者: 凜さん 2026-07-04「カーソルに反応するのは要らない」→「glyphdustライブラリ本体
  から機能を完全削除」）。**移行**: `interaction` prop を渡しているコードは型エラーになる
  ので削除する（`GlyphDustProps` から `interaction` フィールドごと除去したため）。
  粒子は常にポインタ非反応・無回転になる。

## [0.8.3] — 2026-07-04

### Added

- **`<GlyphDust>`（R3F）: per-keyframe `resolveToDom`（解決窓）** — 最終キーフレームだけ
  でなく、途中の text キーフレーム（domSelector 付き）でも `resolveToDom: true` で
  「粒子が集まる → 実 DOM テキストへ溶けて結晶化（ボケ→ピント）→ 離れると粒子へ
  溶け戻る」が使えるように。同一 selector の連続キーフレーム（form→hold）は 1 つの
  窓として扱い、先頭グループは進捗 0 から実テキスト表示・保持全体で粒子へ受け渡し、
  最終グループは実テキストのまま残る。従来は途中の見出しで「実テキストの裏に粒子が
  残って見える」ため利用側が opacity を手動振り付けするしかなかった
  （提案者: 凜さん 2026-07-04「テキストの裏にいるのが見える。そのまま使うようにしよう」）。
  窓が 1 つも無い場合は従来挙動のまま。

## [0.8.2] — 2026-07-03

### Fixed

- **左揃え複数行の domSelector サンプリングで短い行が右にずれる** — `buildGlyphFromDOM`
  が各行を常に中央寄せで描いていたため、text-align:left の複数行では短い行の粒子が
  `(最長行幅 − 行幅)/2` だけ右にゴースト化した（実例: コーポレートサイトのタグライン
  2行目「人じゃない。」が 76.5px 右へ。発見: 凜さん 2026-07-03「やっぱずれてる」）。
  要素の text-align（left/center/right、start/end は direction で解決）に従って描画する
  よう修正。単一行は矩形がタイトなのでどの揃えでも同一＝従来挙動不変。

## [0.8.1] — 2026-07-03

### Fixed

- **domSelector サンプリングの縦ずれ** — `buildGlyphFromDOM` のベースライン式が
  Range 矩形（=字形ボックス、half-leading を含まない）を「行ボックス」とみなして
  half-leading `(lineHeight - (fontAscent+fontDescent))/2` を余計に加算していた。
  line-height がフォント実高さ（Helvetica ≈1.194em）から離れるほど粒子が縦にずれる
  （例: line-height:1 × 192px の LINNO コーポレートサイトワードマークで粒子が
  実文字より 18.7px 上に浮いた。発見: 凜さん 2026-07-03「コーポレートサイトでは
  パーティクルとテキストがずれています」）。正しくは矩形上端 + fontAscent。
  0.6.2 の検証（line-height 未指定 ≈1.2 ≒ 実高さ）では誤差 ≈0px で潜伏していた。

## [0.8.0] — 2026-07-03

初期表示の終端も morphTo と同じ「実テキストへ凝縮」で締める（提案者: 凜さん 2026-07-02
「今ハローが表示されたけど、これはなんでパーティクルのままなんですか？」→ 初回と
2 語目以降で終端表現が不統一だった）。

### Changed

- **`glyphText` の最初の表示（既定キーフレーム）も、終端で実テキストへ解決**するのが既定に。
  粒子飛行中から実テキストがボケ＋低不透明度で滲み出し、着地とともにピントが合う
  （morphTo の終端と同じカーブ）。初回 morphTo ではこの実テキストが粒子へ溶け戻る。
- 新オプション **`resolve: false`**（`glyphText`）で従来の粒子フィニッシュに戻せる。
  custom `keyframes` / `loop` / `pingpong` / 複数行テキストでは自動的に従来挙動。

## [0.7.0] — 2026-07-02

ストリーミング対応リリース（提案者: 凜さん 2026-07-02「ストリーミングでできるようにしたい」
「ちゃんとしたテキストに収束するようにして」）。AIエージェントが**その場で決めた言葉**を、
インスタンスの作り直しなしに次々出せるようにする。

### Added

- **`handle.morphTo(text, opts?) → Promise<boolean>`** — 表示中の粒子を「いまの姿」から
  新しいテキストへ再収束させる。WebGL コンテキスト・canvas・シェーダは再利用（毎語
  `destroy()`→`glyphText()` する必要なし）。モーフ中の再呼び出しは latest-wins で
  途中の姿から向かい直す（置き換えられた Promise は `false`）。`await` で順次表示も可。
  実装: 頂点属性 `aPos0/aPos1` の 2 スロットピンポン + CPU でのシェーダ位置再現スナップショット。
- **`handle.scatter(opts?)`** — 言葉が無い状態（飛散雲）へ溶かす対の API。
- **終端の実テキスト解決（既定 ON）** — 各モーフの終端で粒子を本物の crisp な DOM テキストへ
  クロスフェード（`alignGlyphOverlay` で粒子字形へインク中心整列した overlay を自動生成・
  2 枚ピンポン）。`{resolve:false}` で従来の粒子フィニッシュ。複数行は自動的に粒子フィニッシュ。
- **`morphDuration` オプション** — `morphTo`/`scatter` の既定モーフ秒数（1.6）。
- reduced-motion / WebGL 不可のフォールバックでも `morphTo` が静的テキストを書き換える
  （エージェント出力がアクセシブルに保たれる）。
- `examples/streaming.html` — 手入力・scatter・疑似エージェントのストリーミングデモ。

### Fixed

- **長いテキストの左右見切れ** — 固定フォントサイズがサンプリング canvas からはみ出す場合に
  自動縮小して全体を収める（`fitFontToWidth`。例「こんにちは、凜さん」が切れていた）。
  `buildTextTargets` / `buildDenseTextTargets` / segments 描画すべてに適用。

## [0.6.3] — 2026-07-01

Docs release for the agent-native positioning (メインターゲット = AIエージェント)。コードは変更なし。

### Added

- **`llms.txt`** — AIエージェント／codegen 向けの機械可読な最小 API 仕様（そのまま貼れる正しい
  例つき）。npm パッケージに同梱し、CDN でも配信（`https://cdn.jsdelivr.net/npm/glyphdust/llms.txt`）。
- README 冒頭に「for AI agents / codegen」導線と `llms.txt` へのリンクを追加。

## [0.6.2] — 2026-07-01

AIエージェント第一（agent-native）方針のもとで `glyphText()` を強化する非破壊リリース
（提案者: 凜さん 2026-07-01。glyphdust のメインターゲット = AIエージェント）。

### Added

- **`glyphText` を外部/実時間ドライブ可能に。** オプション `autoplay: false` と操作ハンドルの
  `setProgress(0..1)` を追加。スクロール量・時間・センサー・**AIエージェント**など任意の
  ソースから進捗を毎フレーム流し込める（従来は時間ベース autoplay のみ）。
- **`resolveToDom: true`（本来の看板挙動を vanilla にも）。** 収束点で粒子をフェードアウトし、
  最後の text キーフレームに紐づく実 DOM 要素（`domSelector`）を crisp な本物のテキストとして
  出す。先頭 text も実文字→粒子へクロスフェードで受け渡す。粒子はサンプリング元と同位置の
  ためクロスフェード中に文字がずれない。

### Fixed

- **`resolveToDom` の整列 footgun を除去。** `buildGlyphFromDOM` が要素ボックス左上を原点に
  テキストを描いていたため、`display:flex` 中央寄せや padding 付きの大きな箱では粒子だけ
  大きくずれた。実際に描画されたテキストの矩形（`Range.getBoundingClientRect`）基準に変更し、
  中央寄せ・padding の要素でもピクセル一致する。AIエージェントが要素の作り方を選べない前提で
  ライブラリ側が吸収する。
- **スクロールバー由来の横ズレを補正。** `domSelector` サンプリングが `window.innerWidth`
  基準だったのを、canvas 実寸（`viewportW`/`viewportH`、`KeyframeBuildContext` 経由で vanilla が
  供給）基準に変更。縦スクロールバーがあっても粒子字形が実 DOM 文字から横にずれない。
- **収束/拡散のクロスフェードを滑らかに。** 冒頭の実文字→粒子は瞬時 swap をやめ短い窓で
  クロスフェード、終端の粒子→実文字は窓を広げて硬い切替を解消。

### Changed

- 点サイズ上限に `uSizeScale`（`style.size`）を反映（既定 1 で挙動不変）。`style.size > 1` で
  収束時に「隙間なく塗られた solid なテキスト」を作れるように。

## [0.6.1] — 2026-07-01

### Fixed

- **`glyphText()` の終端が「くっきり収束」しきらず緩い粒子のまま保持されていた問題を修正。**
  保持区間（最終 text キーフレーム 0.85→1.0）で整列ホールド度合い `uSettle`
  （エッジ締め・不透明度・点サイズ均一化を駆動）が `bump` 由来で 0 へ戻ってしまい、
  止まった後にむしろ緩んで見えていた。最終キーフレームが text のとき `uSettle` を
  `uForm` で下限留めし、保持中 1 に張り付かせて密に定着させる。`<GlyphDust>`（R3F・
  resolveToDom で実文字へ受け渡す経路）は対象外で挙動不変。_提案者: 凜さん 2026-07-01。_

## [0.6.0] — 2026-06-30

Non-breaking feature release. Existing npm/bundler usage is unchanged.

### Added

- **CDN (`<script>`) build — zero install.** A standalone IIFE bundle
  (`dist/glyphdust.min.js`, ~140&nbsp;KB gzipped) with **three.js bundled in**,
  exposing a global `glyphdust` with `glyphText()` and `VERSION`. Drop
  `https://cdn.jsdelivr.net/npm/glyphdust` (or unpkg) into any HTML file — no
  `npm install`, no bundler — and call `glyphdust.glyphText("#hero", "LINNO")`.
  Wired via the `unpkg` / `jsdelivr` package fields and a `./cdn` export.
  _Why: let an AI agent (or anyone) use glyphdust on the spot, by pasting a snippet
  that runs with no toolchain (提案者: 凜さん 2026-06-30)._ The React-dependent API is
  intentionally excluded from this bundle (a dedicated `src/cdn.ts` entry re-exports
  only the vanilla `glyphText`), so React is never pulled into the script.

## [0.5.0] — 2026-06-30

Non-breaking feature release. The existing `<GlyphDust>` component is unchanged.

### Added

- **`glyphText(target, text, options?)` — a React-free one-call API.** Drop a single
  line and get particles: it creates the `<canvas>`, boots three.js, fits the target
  element, and autoplays (scatter → text, then holds). Returns a handle
  (`destroy()` / `pause()` / `play()` / `restart()`). Preset-driven, so it looks right
  with zero config; `prefers-reduced-motion` / no-WebGL fall back to static centered
  text. Needs only `three` (no React / react-three-fiber). Exported types
  `GlyphTextOptions`, `GlyphTextHandle`.
  _Why: let an AI agent (or anyone) use glyphdust lightly and on the spot, without
  R3F setup. (提案者: 凜さん 2026-06-30)_

### Changed

- Internal: the framework-agnostic particle geometry/interpolation helpers
  (`buildScatter`, `buildKeyframeTargets`, `smooth`, `bump`) moved to
  `src/internal/geometry.ts` and are now shared by both the R3F component and
  `glyphText()`. Byte-identical extraction — the component's behavior is unchanged.

## [0.4.0] — 2026-06-28

Non-breaking feature release. Defaults reproduce 0.3.0 exactly.

### Added

- **Motion math controls in `style`** — `stagger` (per-particle arrival spread),
  `curl` (curl-noise idle drift), `easing` (`"smoothstep"` C1 vs `"smootherstep"` C2,
  Perlin 2002), and `scatterPattern` (`"random"` vs `"fibonacci"` golden-angle cloud,
  Vogel 1979). Backed by new shader uniforms; the example gains a before/after toggle.
  Defaults preserve the prior look. _(提案者: 凜さん)_

## [0.3.0] — 2026-06-28

Non-breaking feature release. Defaults reproduce 0.2.1 exactly.

### Added

- **Mixed fonts in one glyph (`segments`)** — a `TextKeyframe` can now carry a
  `segments: { text, font? }[]` array. Each run is stamped with its own font and
  flows inline (a `\n` inside any run breaks the line; the next run continues on the
  new line), so a single particle glyph can blend, e.g., a bold serif word with a
  light sans one. `text` stays the accessible/`resolveToDom` string; per-run `font`
  falls back to the keyframe `font`. Works on the normal and `dense` sampling paths;
  ignored under `domSelector` (the DOM provides layout). Defaults unchanged —
  omitting `segments` reproduces prior behavior exactly.
  _Why: particles only ride "ink", so the stamp was never font-bound — the limit was
  the API exposing one font. (提案者: 凜さん)_

## [0.2.1] — 2026-06-26

Flexibility & polish release. Glyphdust is no longer scroll-and-hero only — it now
drops into any box, plays without scroll, and ships tasteful presets you can override.
**Defaults reproduce 0.2.0 exactly**, so upgrading is non-breaking.

### Added

- **`autoplay` driver** — time-based progress with no scroll choreography. Fits its
  parent box and starts when scrolled into view (`playOnView`, default on). Options:
  `duration`, `delay`, `loop`, `pingpong`, `playOnView`. Exposed
  `computeAutoplayProgress()` for custom rigs.
- **`preset` prop** — `"default" | "minimal" | "lively" | "glow"`: a tasteful bundle
  of look + motion.
- **`style` prop** — per-field overrides on top of the preset:
  `size`, `blend` (`"normal" | "additive"`), `drift`, `sparkle`. Backed by new shader
  uniforms (`uSizeScale`, `uDrift`, `uSparkle`); `additive` enables glow blending for
  dark backgrounds.

### Changed

- Particles render finer and crisper on high-DPI screens: point-size base ×0.62,
  clamp lowered to 4–5 px, and `devicePixelRatio` cap raised 2 → 3. (Validated on the
  LINNO corporate site.)
- Scroll follow no longer lags: stage progress is applied directly instead of an
  internal lerp. Add inertia in your driver (e.g. Lenis) if you want it.

### Fixed

- No more blank gap when the **first keyframe is text** — particles now start in the
  formed glyph and dissolve outward, instead of appearing only after the real text
  fades.
- `VERSION` export corrected (was a stale `"0.1.0"`).

## [0.2.0] — 2026-06-23

- Resolve to real DOM elements with pixel alignment; scrollbar & baseline fixes.

## [0.1.0]

- Initial public release: text → particles → glyph → real-text resolve, scroll-driven.
