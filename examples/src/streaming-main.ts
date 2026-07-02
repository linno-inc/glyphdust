// streaming morphTo() のデモ。React 不要。
// 「AI エージェントがその場で決めた言葉を次々出す」を、destroy/再生成なしで行う。
import { glyphText } from "glyphdust";

const handle = glyphText("#hero", "HELLO");

// 手動入力: Enter でその言葉へモーフ（連打すると latest-wins で向かい直す）。
const input = document.querySelector<HTMLInputElement>("#say")!;
input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !input.value.trim()) return;
  void handle.morphTo(input.value);
  input.value = "";
});

document.querySelector("#scatter")!.addEventListener("click", () => {
  void handle.scatter();
});

// 疑似エージェント: 状態 → 発話 → 沈黙、を await で順に流す。
document.querySelector("#demo")!.addEventListener("click", async () => {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await handle.morphTo("LISTENING");
  await pause(600);
  await handle.morphTo("THINKING…");
  await pause(600);
  await handle.morphTo("答えは 42");
  await pause(900);
  await handle.scatter();
});

// Playwright / 手動検証用にハンドルを露出。
(window as unknown as { __glyph: unknown }).__glyph = handle;
