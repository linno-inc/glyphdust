/**
 * BloomEffect.tsx — selective bloom（光）ポストプロセッシング。
 *
 * 「美しすぎて魔法」品質向上の光の軸（2026-07-11、提案者: Claude、凜さん承認
 * 「収束拡散は元のまま提案を全て実装」）。粒子の軌道・タイミングには一切
 * 触れないポスト処理のみ。
 *
 * selective の仕組み: Bloom の luminanceThreshold を 0.85 に置き、フラグメント
 * シェーダ側（GlyphPoints の uBloom ブースト）で「きらめき・アクセントの粒」
 * だけを輝度 1.0 超の HDR 域へ押し上げる。閾値未満の通常粒は光らない。
 * React Postprocessing の推奨設計（threshold で選ぶのではなく素材側の色を
 * 持ち上げる）に従う。
 *
 * このモジュールは GlyphDust から React.lazy で動的 import される。
 * `@react-three/postprocessing` は optional peer dependency —— bloom を使わない
 * 利用者は依存もバンドルも増えない。
 */
import { Bloom, EffectComposer } from "@react-three/postprocessing";

export default function BloomEffect({ strength }: { strength: number }) {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        mipmapBlur
        intensity={1.6 * strength}
        luminanceThreshold={0.85}
        luminanceSmoothing={0.2}
      />
    </EffectComposer>
  );
}
