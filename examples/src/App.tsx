import { useEffect, useRef } from "react";
import { GlyphDust } from "glyphdust";

const TRIGGER_HEIGHT = 2.4;
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
    </main>
  );
}
