/**
 * shaders.ts — THREE.Points 用の GLSL（頂点 / フラグメント）。
 *
 * 位置補間は「キーフレーム数」に依存するため、頂点シェーダは
 * {@link buildVertexShader} で動的生成する（GLSL は属性の動的添字を許さないので
 * 隣接キーフレーム間の `mix` 連鎖をアンロールして埋め込む）。
 *
 * 演出スカラ（burst / drift / settle / form / swap / resolve）は
 * 「どのキーフレームが scatter か text か」を知る CPU 側（GlyphPoints, useFrame）が
 * 毎フレーム算出して uniform で渡す。これでシェーダはキーフレーム数だけに依存し、
 * 意味論を持たない。
 *
 * 属性（GlyphPoints が設定）:
 *  - `aPos0 .. aPos{N-1}` … 各キーフレームのターゲット座標（vec3）
 *  - `aSeed`              … 0..1 個体差シード（ドリフト位相・サイズ・きらめき）
 *  - `aAccent`            … 0/1 アクセント色フラグ
 *
 * uniform（頂点）:
 *  - `uTimes[N]`     … 各キーフレームの正規化時刻 0..1（補間区間の境界）
 *  - `uStage`        … 進捗 0..1（位置補間に使う。CPU 側で easing 済みでも可）
 *  - `uTime`         … アイドル漂い用の時計（秒）
 *  - `uForm`         … 0..1 字形に締まった度合い（サイズ均一化・ドリフト停止）
 *  - `uSettle`       … 0..1 整列ホールド度合い（ドリフト減衰・エッジ締め）
 *  - `uBurst`        … 0..1 外向き飛散量（飛散区間中で上げる）
 *  - `uSwap`         … 0..1 可視ゲート（最初のスワップ点まで 0）
 *  - `uResolve`      … 0..1 フィナーレで実 DOM 文字へ受け渡す減衰
 *  - `uReduced`      … 0/1 reduced-motion
 *  - `uPointer`      … vec3 ワールド空間のポインタ位置
 *  - `uPointerActive`… 0/1 ポインタ反発の有効化
 *  - `uSize`         … 基準点サイズ
 *  - `uPixelRatio`   … dpr
 *
 * uniform（フラグメント）:
 *  - `uColorInk` / `uColorAccent` … 配色
 */

/** 位置ターゲット属性の接頭辞。`aPos0`, `aPos1`, ... */
export const GLYPH_POSITION_ATTRIBUTE_PREFIX = "aPos";

/** キーフレーム番号 i に対応する位置属性名を返す。 */
export function glyphPositionAttribute(index: number): string {
  return `${GLYPH_POSITION_ATTRIBUTE_PREFIX}${index}`;
}

/**
 * キーフレーム数 N に対応する頂点シェーダ文字列を生成する。
 *
 * 隣接キーフレーム間を `smoothRange(uTimes[k], uTimes[k+1], uStage)` で補間し、
 * `mix` 連鎖でつなぐ。各区間の t は順次 0→1 になるため、uStage が区間 k にあるとき
 * 先行区間は t=1（次キーフレームへ到達済み）・後続は t=0 となり、正しく k→k+1 を補間する。
 *
 * @param keyframeCount キーフレーム数（>= 1）
 * @throws keyframeCount < 1 のとき
 */
export function buildVertexShader(keyframeCount: number): string {
  if (!Number.isInteger(keyframeCount) || keyframeCount < 1) {
    throw new Error(
      `buildVertexShader: keyframeCount must be an integer >= 1 (got ${keyframeCount})`,
    );
  }

  const attributeDecls = Array.from(
    { length: keyframeCount },
    (_, i) => `  attribute vec3 ${glyphPositionAttribute(i)};`,
  ).join("\n");

  // 隣接キーフレームの mix 連鎖（アンロール）。N==1 のときは補間なし。
  const mixChain = Array.from(
    { length: keyframeCount - 1 },
    (_, k) =>
      `    pos = mix(pos, ${glyphPositionAttribute(k + 1)}, ` +
      `smoothRange(uTimes[${k}], uTimes[${k + 1}], uStage));`,
  ).join("\n");

  return /* glsl */ `
  uniform float uTime;
  uniform float uStage;
  uniform float uTimes[${keyframeCount}];
  uniform float uForm;
  uniform float uSettle;
  uniform float uBurst;
  uniform float uSwap;
  uniform float uResolve;
  uniform float uReduced;
  uniform vec3 uPointer;
  uniform float uPointerActive;
  uniform float uSize;
  uniform float uSizeScale;
  uniform float uDrift;
  uniform float uPixelRatio;

${attributeDecls}
  attribute float aSeed;
  attribute float aAccent;

  varying float vSeed;
  varying float vAccent;
  varying float vDepth;
  varying float vForm;
  varying float vAlpha;
  varying float vSettle;

  float smoothRange(float a, float b, float x) {
    float t = clamp((x - a) / (b - a), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  void main() {
    vSeed = aSeed;
    vAccent = aAccent;
    vForm = uForm;

    // --- キーフレーム間の位置補間（隣接ペアの mix 連鎖） ---
    vec3 pos = ${glyphPositionAttribute(0)};
${mixChain}

    // 遷移中（飛散区間）に外向きドリフトを足してダイナミックに。
    // 方向は原点からの外向き（特定キーフレームに依存しない一般形）。
    float ph = aSeed * 6.2831;
    vec3 dir = normalize(pos + 0.0001);
    pos += dir * uBurst * (0.4 + aSeed * 0.6);

    // アイドルの漂い（整列時 settle / 字形時 form で弱める）。
    vSettle = uSettle;
    float drift = (1.0 - uReduced) * (1.0 - uSettle * 0.9) * (1.0 - uForm) * uDrift;
    pos.x += sin(uTime * 0.35 + ph) * 0.06 * drift;
    pos.y += cos(uTime * 0.30 + ph * 1.7) * 0.06 * drift;
    pos.z += sin(uTime * 0.27 + ph * 2.3) * 0.06 * drift;

    // ワールド空間でポインタ反発（回転後の見た目に合わせ modelMatrix 経由）。
    vec4 world = modelMatrix * vec4(pos, 1.0);
    if (uPointerActive > 0.5) {
      vec3 diff = world.xyz - uPointer;
      float dist = length(diff);
      float radius = 1.3;
      float force = (1.0 - smoothstep(0.0, radius, dist)) * 0.55;
      world.xyz += normalize(diff + 0.0001) * force;
    }

    vec4 mvPosition = viewMatrix * world;
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;

    // --- 透明度: スワップ点まで不可視、スワップ点で即・不透明（フェード無し）。 ---
    // DOM 見出しと同位置・同サイズで一致しているため、瞬時の切替が「文字→粒子」に見える。
    // フィナーレ(uResolve)で粒子を素早く消し、実 DOM 文字へ受け渡す。
    vAlpha = uSwap * (1.0 - uResolve);

    // 点サイズ（遠近 + 個体差）。整列時はやや均一・小さめにして可読性を上げる。
    float sizeVar = mix(0.55 + aSeed * 0.9, 0.72 + aSeed * 0.35, uSettle);
    // 字形収束時は隣接粒子で隙間を埋めるためわずかに大きめ＆均一に。
    sizeVar = mix(sizeVar, 0.95 + aSeed * 0.18, uForm);
    // 高 dpr 環境では小粒・上限低めの方がエッジが締まり高精細に見える
    // （コーポレートサイト実装で実証。0.62 と clamp 4〜5 が最も「霞まない」）。
    float s = uSize * sizeVar * 0.62 * uSizeScale;
    gl_PointSize = s * uPixelRatio * (1.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, mix(4.0, 5.0, uForm) * uPixelRatio);
  }
`;
}

/**
 * フラグメントシェーダ。キーフレーム数に依存しないため定数。
 * 円形ソフト点 + アクセント色 + きらめき + 奥行き濃淡。
 */
export const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColorInk;
  uniform vec3 uColorAccent;
  uniform float uSparkle;

  varying float vSeed;
  varying float vAccent;
  varying float vDepth;
  varying float vForm;
  varying float vAlpha;
  varying float vSettle;

  void main() {
    // 円形のソフトな点。中心で 1、縁で 0（smoothstep は edge0<edge1 必須なので反転して使う）。
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    float alpha = 1.0 - smoothstep(0.12, 0.5, r);
    if (alpha < 0.02) discard;

    // 主体はインク、一部の粒だけアクセント色。字形収束時はやや控えめに。
    float accentAmt = vAccent * mix(0.85, 0.55, vForm);
    vec3 col = mix(uColorInk, uColorAccent, accentAmt);

    // 一部の粒に明るいきらめき（飛散時に映える）。整列時は控えめ。
    float spark = step(0.94, vSeed);
    col = mix(col, uColorAccent, spark * mix(0.45, 0.15, vSettle) * uSparkle);

    // 奥行きで濃淡（明背景での視認性確保のため下限を持たせる）。
    float floorFade = mix(0.45, 0.78, vSettle);
    float depthFade = clamp(1.0 - (vDepth - 3.0) * 0.10, floorFade, 1.0);

    // 整列時は不透明寄りにしてエッジを締める。
    float a = alpha * depthFade * vAlpha;
    a = mix(a, clamp(a * 1.3, 0.0, 1.0), vSettle);

    gl_FragColor = vec4(col, a);
  }
`;
