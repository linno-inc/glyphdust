import { defineConfig } from "tsup";

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
