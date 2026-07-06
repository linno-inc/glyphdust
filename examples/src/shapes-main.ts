// shape キーフレーム / morphToShape() のデモ。React は一切使わない。
import { glyphText } from "glyphdust";

// よくある 24×24 アイコン系の SVG パスデータ（d 属性そのまま）。
const HEART =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";
const STAR =
  "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
const BOLT = "M7 2v11h3v9l7-12h-4l4-8z";

// 初期表示は通常どおりテキスト。
const handle = glyphText("#hero", "LINNO");

// ボタンで テキスト ⇄ 形 ⇄ 雲 を行き来する。
document.querySelectorAll<HTMLButtonElement>("[data-morph]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.morph;
    if (kind === "text") void handle.morphTo("LINNO");
    else if (kind === "heart") void handle.morphToShape(HEART);
    else if (kind === "star") void handle.morphToShape(STAR);
    else if (kind === "bolt") void handle.morphToShape(BOLT);
    else if (kind === "scatter") void handle.scatter();
  });
});

// 動作確認用にハンドルと glyphText を露出。
(window as unknown as { __glyph: unknown }).__glyph = handle;
(window as unknown as { __glyphText: unknown }).__glyphText = glyphText;
