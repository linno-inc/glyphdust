// vanilla glyphText() のデモ。React は一切使わない。
import { glyphText } from "glyphdust";

// 1 import + 1 call。これだけで箱いっぱいに粒子→文字が動く。
const handle = glyphText("#hero", "LINNO");

// 動作確認用にハンドルを露出（手動で destroy/pause を試せる）。
(window as unknown as { __glyph: unknown }).__glyph = handle;
