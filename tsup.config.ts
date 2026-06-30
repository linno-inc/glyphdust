import { defineConfig } from "tsup";

export default defineConfig([
  // ── npm / bundler 向け（ESM + CJS）。peerDependencies は外部化する ──
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    // peerDependencies はバンドルせず外部化する（重複 three インスタンス回避）。
    external: ["react", "react-dom", "three", "@react-three/fiber"],
  },
  // ── CDN（<script>）向け。install 不要の単独 IIFE。three を同梱する ──
  // グローバル変数 `glyphdust` に glyphText を生やす。React 依存 API は含めない
  // （src/cdn.ts が vanilla だけを re-export するため react は混入しない）。
  {
    entry: { glyphdust: "src/cdn.ts" },
    format: ["iife"],
    globalName: "glyphdust",
    platform: "browser",
    dts: false,
    sourcemap: true,
    clean: false, // 上の ESM/CJS ビルド成果物を消さない
    treeshake: true,
    minify: true,
    // ブラウザに `process` は無い。three / React 残骸の process.env.NODE_ENV 参照で
    // 評価時クラッシュ（global が定義されない）を防ぐため定数に畳む。
    define: { "process.env.NODE_ENV": '"production"' },
    // three は同梱（external にしない）。React 系は vanilla 経路では未使用なので除外。
    external: ["react", "react-dom", "@react-three/fiber"],
    outExtension: () => ({ js: ".min.js" }),
  },
]);
