import { GlyphDust } from "glyphdust";

/**
 * glyphdust デモ。LINNO ヒーロー演出を再現:
 * 見出し（実 DOM 文字）→ 粒子化 → 飛散 → "LINNO" 字形 → 実文字へ解決。
 */
export function App() {
  return (
    <main>
      {/* スクロール演出。triggerHeight 分の高さを持つ。 */}
      <GlyphDust
        keyframes={[
          { type: "text", text: "次のユーザーは、\n人じゃない。", domSelector: "#headline" },
          { type: "scatter", spread: 1 },
          { type: "text", text: "LINNO", dense: true, resolveToDom: true },
        ]}
        driver={{ type: "scroll", triggerHeight: 2.4 }}
        colors={{ ink: "#1b2330", accent: "#0055ff", accentRatio: 0.18 }}
        fallback={
          <h1 style={{ padding: "20vh 8vw", fontSize: "8vw", lineHeight: 1.1 }}>
            次のユーザーは、
            <br />
            人じゃない。
          </h1>
        }
      />

      {/* domSelector で粒子が重なる実見出し（演出開始時に表示）。 */}
      <h1
        id="headline"
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
          <h2 style={{ fontSize: "clamp(28px, 4vw, 56px)", fontWeight: 800 }}>
            glyphdust
          </h2>
          <p style={{ marginTop: 16, opacity: 0.65, maxWidth: 560 }}>
            Scroll-driven text → particles → glyph → real-text resolve, in one
            declarative react-three-fiber component.
          </p>
        </div>
      </section>
    </main>
  );
}
