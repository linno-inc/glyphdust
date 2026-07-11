import { useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import { GlyphDust } from "glyphdust";

// 【2026-07-11 本番ペーシングに一致】従来の 2.4（全行程140vh）は本番 LINNO サイト
// （1駅あたり 132vh×1.95≈257vh、凜さんが実機で2度「短すぎる」と伸ばして調整した値）
// の約5倍速で、拡散が一瞬で駆け抜けて「スムーズじゃない」と知覚されていた
// （凜さん 2026-07-11。ライブラリを 0.10.0 と数学的同一に戻しても「変わってない」
// ことから、原因はライブラリではなくデモのスクロール設計と確定）。
// 2駅 × 257vh ≈ 515vh → triggerHeight = 1 + 5.15 ≈ 6.2。
const TRIGGER_HEIGHT = 6.2;
// 【2026-07-11 導入の流れを3段階化（凜さん「テキストが2段階くらいで消えるようになってる？
// スッと消えて→凝縮したテキストの形が表れて→拡散し始める、をスムーズに」）】
// 旧: SWAP_AT=0.08 で DOM 見出しを即・非表示＋粒子は既に動き出している＝段差が2つ。
// 新（凜さん 2026-07-11「収束はテキストに収束→背景から白いテキストが黒に変わって
// いくからスムーズ。拡散はその逆をやればいいだけでは」＋ 2026-07-12「テキストと
// 粒子のズレをなくせばいい」）: 静止した粒子テキストと実テキストを並べて見せると
// 点描の質感差・サンプリング厚みの視差が「ズレ」として見える。なので
//  ①静止保持（〜hold）の間は **実 DOM テキストだけ** を見せる（粒子は不可視）
//  ②粒子が動き出す瞬間（swapAt=hold）に、実文字フェードアウト × 粒子フェードインを
//    同窓・同カーブ（smootherstep）の相補クロスフェードで行う
//    ＝「crisp な文字が、飛び立つ粒子に変わりながらほどけていく」
//  収束側（動きが終わる瞬間に実テキストへ解決）の正確な鏡像。
// SWAP_AT はライブラリ既定の swapAt = times[1] * 0.15（hold=0 のリセット時に使う）。
const SWAP_AT = 0.54 * 0.15;

/**
 * glyphdust デモ。LINNO ヒーロー演出を再現:
 * 見出し（実 DOM 文字）→ 粒子化 → 飛散 → "LINNO" 字形 → 実文字へ解決。
 *
 * 本番 LINNO サイト相当の作り込み:
 *  - timing でタグライン保持→飛散→LINNO を 0.84 までに形成し、0.84→1.0 はくっきり保持。
 *  - 見出しのフェードアウトと粒子のフェードインは同窓・相補（収束クロスフェードの逆再生）。
 */
export function App() {
  const headlineRef = useRef<HTMLHeadingElement>(null);

  // 【品質向上 調整パネル】初期値 = ライブラリ既定（2026-07-12 凜さん承認
  // 「美しくする提案はもうデフォルトで全部入れて」→ alphaVar/dof/wave が
  // リサーチ提案値で既定オン）。スライダーで個別に増減・ゼロ化できる。
  const [alphaVar, setAlphaVar] = useState(0.55);
  const [dof, setDof] = useState(0.5);
  const [wave, setWave] = useState(0.75);
  const [stagger, setStagger] = useState(0.08);
  // 導入3段階化のノブ（凜さん承認済みの提案値）
  const [hold, setHold] = useState(0.16);
  const [swapFade, setSwapFade] = useState(0.06);

  // 慣性スクロール（Lenis）。本番 LINNO サイトと同じ設定。
  // なぜ必要か: 素のホイールスクロールは一段ごとに scrollY が離散ジャンプし、
  // スクロール駆動の演出が「ガクガク」に見える（凜さん 2026-07-11「どちらも
  // ダメ」＝新旧実装とも同じ粗さ→ライブラリではなくデモに慣性が無いことが
  // 真因と切り分け）。glyphdust は設計上、慣性を driver 側（Lenis 等）に
  // 委ねている（GlyphPoints は進捗を lerp しない）ため、デモ側で入れる。
  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      syncTouch: true,
      syncTouchLerp: 0.1,
    });
    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  // 実見出しのフェードアウト = 粒子フェードイン（uSwap の smootherstep）の正確な相補。
  // 同じ窓・同じカーブなので、ピクセル整列した実文字と粒子文字の合計濃度がほぼ一定の
  // まま入れ替わる（収束側の resolve クロスフェードの逆再生）。swapFade=0 なら従来の
  // 瞬時切替に一致する。
  useEffect(() => {
    const onScroll = () => {
      const el = headlineRef.current;
      if (!el) return;
      const total = (TRIGGER_HEIGHT - 1) * window.innerHeight;
      const p = total > 0 ? window.scrollY / total : 0;
      const at = hold > 0 ? hold : SWAP_AT;
      const t =
        swapFade > 0
          ? Math.min(1, Math.max(0, (p - at) / swapFade))
          : p >= at
            ? 1
            : 0;
      const s = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep（ライブラリと同カーブ）
      el.style.opacity = String(1 - s);
      el.style.filter = `blur(${(s * 2.5).toFixed(2)}px)`;
      el.style.visibility = s >= 1 ? "hidden" : "visible";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [swapFade, hold]);

  return (
    <main>
      <GlyphDust
        keyframes={[
          { type: "text", text: "次のユーザーは、\n人じゃない。", domSelector: "#headline" },
          { type: "scatter", spread: 1 },
          { type: "text", text: "LINNO", dense: true, resolveToDom: true },
        ]}
        // 本番と同じ軌道形状: 既定 [0, 0.33, 0.85] は 0.33 から集まり始め
        // 「中央にじわっと」になる。本番は scatter を広く保持し 0.52→0.84 で
        // LINNO へ収束する（GlyphDustHero.tsx の検証結果と同じ値）。
        // timing[0]=hold: 粒子は hold まで「凝縮したテキストの形」で完全静止し、
        // そこから初めて拡散が始まる（導入3段階化。スワップ時に既に動いている段差を解消）。
        // timing[2]=0.90: 実テキストへの解決開始点（ライブラリの終端カーブ 0.90-0.98）と
        // 粒子の到着を完全に一致させる。着地の瞬間にクロスフェードが始まり、最後の
        // 遅参粒子（stagger 分 ≈0.908 まで）は固まりつつある文字に滑り込む＝待ち時間ゼロ。
        // 経緯: 0.84（無イベント6%の時差）→0.88（凜さん「時差がある」）→0.90
        // （凜さん 2026-07-12「もっと差を縮めて」）。
        timing={[hold, 0.54, 0.9]}
        swapFade={swapFade}
        swapAt={hold > 0 ? hold : undefined}
        driver={{ type: "scroll", triggerHeight: TRIGGER_HEIGHT }}
        // 【2026-07-11 本番 GlyphStageEngine と完全一致】凜さんの「元々良かった」
        // 体感の実体は、プリセット既定ではなく本番の削ぎ落とした構成:
        // 有機ノイズ全オフ（drift/sparkle/curl/burst=0。飛行中の粒が揺れない
        // 純粋な補間移動）・インク単色（アクセント無し）・34,000粒・dpr上限3。
        // デモがプリセット既定（全部オン・11,000粒・dpr1.75）だったのが
        // 「拡散がスムーズじゃない」の残る差分だった。
        style={{ drift: 0, sparkle: 0, curl: 0, burst: 0, alphaVar, dof, wave, stagger }}
        dpr={[1, 3]}
        count={{ desktop: 34000, mobile: 18000 }}
        colors={{ ink: "#1b2330", accent: "#1b2330", accentRatio: 0 }}
        fallback={
          <h1 style={{ padding: "20vh 8vw", fontSize: "8vw", lineHeight: 1.1 }}>
            次のユーザーは、
            <br />
            人じゃない。
          </h1>
        }
      />

      {/* 【品質向上 目視用】調整パネル（判定後に撤去する一時 UI）。 */}
      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 10,
          background: "rgba(20, 26, 40, 0.88)",
          color: "#dbe4f5",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          userSelect: "none",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          品質向上 調整パネル（初期値 = 新しい既定・全部入り）
        </div>
        {(
          [
            ["静止保持 hold", hold, 0, 0.3, 0.01, setHold, "実テキストのまま保つ長さ＝拡散開始点（0=すぐ動き出す）"],
            ["入替幅 swapFade", swapFade, 0, 0.2, 0.01, setSwapFade, "動き出す瞬間の実文字→粒子クロスフェード幅（0=瞬時）"],
            ["ばらけ波 wave", wave, 0, 1, 0.05, setWave, "0=一様にほどける / 1=塊単位で溶ける（既定 0.75）"],
            ["ばらけ幅 stagger", stagger, 0, 0.4, 0.01, setStagger, "早く発つ粒と残る粒の時間差（既定 0.08）"],
            ["質感 alphaVar", alphaVar, 0, 1, 0.05, setAlphaVar, "粒の透明度の個体差（既定 0.55）"],
            ["奥行き dof", dof, 0, 1, 0.05, setDof, "遠い粒のボケ（既定 0.5。明滅が気になれば 0 に）"],
          ] as const
        ).map(([label, value, min, max, step, set, hint]) => (
          <div key={label} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ minWidth: 118 }}>{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => set(Number(e.target.value))}
                style={{ width: 150 }}
              />
              <code style={{ minWidth: 34, textAlign: "right" }}>{value.toFixed(2)}</code>
            </div>
            <div style={{ opacity: 0.6, fontSize: 11, marginLeft: 126 }}>{hint}</div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setWave(0.75);
            setStagger(0.08);
            setAlphaVar(0.55);
            setDof(0.5);
            setHold(0.16);
            setSwapFade(0.06);
          }}
          style={{
            border: "1px solid #4a5a7a",
            background: "transparent",
            color: "#dbe4f5",
            borderRadius: 6,
            padding: "2px 10px",
            cursor: "pointer",
          }}
        >
          既定値に戻す
        </button>
      </div>

      {/* domSelector で粒子が重なる実見出し（演出開始時に表示→swapで非表示）。 */}
      <h1
        id="headline"
        ref={headlineRef}
        style={{
          position: "fixed",
          top: "34vh",
          left: "8vw",
          margin: 0,
          fontWeight: 700,
          fontSize: "clamp(40px, 7vw, 116px)",
          lineHeight: 1.08,
          letterSpacing: "0.01em",
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        次のユーザーは、
        <br />
        人じゃない。
      </h1>

      {/* autoplay デモ: scroll 不要・親の箱にフィット・画面内で自動再生。
          「普通にテキストとして、どんな箱にも置いて勝手に動かす」最小例。 */}
      <section
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "8vw",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ width: "min(560px, 80vw)", height: 240, margin: "0 auto" }}>
            <GlyphDust
              driver={{ type: "autoplay", duration: 3.5, loop: true, pingpong: true }}
              preset="minimal"
              keyframes={[
                { type: "scatter", spread: 0.9 },
                { type: "text", text: "glyphdust", dense: true },
              ]}
              colors={{ ink: "#1b2330", accent: "#1b2330", accentRatio: 0 }}
            />
          </div>
          <p style={{ marginTop: 16, opacity: 0.65, maxWidth: 560 }}>
            ↑ <code>driver="autoplay"</code> + <code>preset="minimal"</code>. No
            scroll, no setup — drop it in any box and it plays in view.
          </p>
        </div>
      </section>

      {/* 書体混在デモ: 1 つの字形を区間（segments）に分け、区間ごとに別フォント。
          粒子は「インク跡」に乗るだけなので、明朝＋ゴシック＋斜体を 1 塊に混ぜられる。 */}
      <section
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "8vw",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ width: "min(720px, 88vw)", height: 260, margin: "0 auto" }}>
            <GlyphDust
              driver={{ type: "autoplay", duration: 3.5, loop: true, pingpong: true }}
              preset="minimal"
              keyframes={[
                { type: "scatter", spread: 0.9 },
                {
                  type: "text",
                  text: "Mix fonts",
                  segments: [
                    { text: "Mix ", font: "900 200px Georgia, 'Times New Roman', serif" },
                    { text: "fonts", font: "300 150px 'Helvetica Neue', Arial, sans-serif" },
                  ],
                },
              ]}
              colors={{ ink: "#1b2330", accent: "#0055ff", accentRatio: 0.18 }}
            />
          </div>
          <p style={{ marginTop: 16, opacity: 0.65, maxWidth: 640 }}>
            ↑ <code>segments</code>: one glyph, two typefaces — bold serif
            “Mix” + light sans “fonts”, stamped into one particle field.
          </p>
        </div>
      </section>

      {/* 光（bloom）デモ: 暗背景 + glow プリセット。きらめき粒・アクセント粒だけが
          selective bloom で「内側から光る」（2026-07-11「光」の軸。粒子の
          軌道・タイミングは一切不変のポスト処理のみ）。 */}
      <section
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "8vw",
          textAlign: "center",
          background: "#070b14",
        }}
      >
        <div>
          <div style={{ width: "min(720px, 88vw)", height: 280, margin: "0 auto" }}>
            <GlyphDust
              driver={{ type: "autoplay", duration: 4, loop: true, pingpong: true }}
              preset="glow"
              keyframes={[
                { type: "scatter", spread: 0.9 },
                { type: "text", text: "magic", dense: true },
              ]}
              colors={{ ink: "#7fa8ff", accent: "#cfe0ff", accentRatio: 0.3 }}
            />
          </div>
          <p style={{ marginTop: 16, opacity: 0.65, maxWidth: 640, color: "#8ea2c8" }}>
            ↑ <code>preset="glow"</code> — selective bloom. Sparkle and accent
            particles glow from within on dark backgrounds.
          </p>
        </div>
      </section>
    </main>
  );
}
