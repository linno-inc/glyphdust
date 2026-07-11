import { defineConfig } from "tsup";

// npm / bundler 向け（ESM + CJS）。peerDependencies は外部化する。
// （0.10.0 で CDN 向け IIFE ビルドを削除。vanilla/CDN 経路ごと廃止したため。）
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // peerDependencies はバンドルせず外部化する（重複 three インスタンス回避）。
  external: ["react", "react-dom", "three", "@react-three/fiber"],
});
