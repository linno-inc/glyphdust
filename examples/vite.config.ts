import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 公開後は npm の "glyphdust" を参照。デモではソースを直接エイリアス。
      glyphdust: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
    // src を直接エイリアスすると lib 側 node_modules の重複コピーを拾い、
    // react/r3f が二重化して Canvas が子を描けない。単一インスタンスへ強制。
    dedupe: ["react", "react-dom", "three", "@react-three/fiber"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "three", "@react-three/fiber"],
  },
  server: { port: 5180 },
});
