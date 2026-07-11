import { useEffect, useRef } from "react";
import Lenis from "lenis";
import { GlyphDust } from "glyphdust";

// 【2026-07-11 本番ペーシングに一致】従来の 2.4（全行程140vh）は本番 LINNO サイト
// （1駅あたり 132vh×1.95≈257vh、凜さんが実機で2度「短すぎる」と伸ばして調整した値）
// の約5倍速で、拡散が一瞬で駆け抜けて「スムーズじゃない」と知覚されていた
// （凜さん 2026-07-11。ライブラリを 0.10.0 と数学的同一に戻しても「変わってない」
// ことから、原因はライブラリではなくデモのスクロール設計と確定）。
// 2駅 × 257vh ≈ 515vh → triggerHeight = 1 + 5.15 ≈ 6.2。
const TRIGGER_HEIGHT = 6.2;
const SWAP_AT = 0.08; // 粒子が現れる点。ここで DOM 見出しを即・非表示にする。

/**
 * glyphdust デモ。LINNO ヒーロー演出を再現:
 * 見出し（実 DOM 文字）→ 粒子化 → 飛散 → "LINNO" 字形 → 実文字へ解決。
 *
 * 本番 LINNO サイト相当の作り込み:
 *  - timing でタグライン保持→飛散→LINNO を 0.84 までに形成し、0.84→1.0 はくっきり保持。
 *  - 見出しは SWAP_AT で即・非表示（粒子タグラインと瞬時に入れ替わり、二重像を防ぐ）。
 */
export function App() {
  const headlineRef = useRef<HTMLHeadingElement>(null);

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

  // スクロール進捗に応じて DOM 見出しを瞬時にスワップ（粒子が現れたら隠す）。
  useEffect(() => {
    const onScroll = () => {
      const el = headlineRef.current;
      if (!el) return;
      const total = (TRIGGER_HEIGHT - 1) * window.innerHeight;
      const p = total > 0 ? window.scrollY / total : 0;
      const swapped = p >= SWAP_AT;
      el.style.opacity = swapped ? "0" : "1";
      el.style.visibility = swapped ? "hidden" : "visible";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

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
        timing={[0, 0.52, 0.84]}
        driver={{ type: "scroll", triggerHeight: TRIGGER_HEIGHT }}
        colors={{ ink: "#1b2330", accent: "#0055ff", accentRatio: 0.18 }}
        fallback={
          <h1 style={{ padding: "20vh 8vw", fontSize: "8vw", lineHeight: 1.1 }}>
            次のユーザーは、
            <br />
            人じゃない。
          </h1>
        }
      />

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
