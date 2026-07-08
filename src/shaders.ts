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
  // 進捗は per-particle stagger 済みの `stageP` を使う（粒子ごとに到達タイミングをずらす）。
  const mixChain = Array.from(
    { length: keyframeCount - 1 },
    (_, k) =>
      `    pos = mix(pos, ${glyphPositionAttribute(k + 1)}, ` +
      `smoothRange(uTimes[${k}], uTimes[${k + 1}], stageP));`,
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
  uniform float uSize;
  uniform float uSizeScale;
  uniform float uDrift;
  uniform float uStagger;
  uniform float uStaggerCollapse;
  uniform float uCurl;
  uniform float uSmoother;
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

  // smoothstep(C1) と Perlin 2002 の smootherstep(C2) を uSmoother で切替（比較用）。
  // smootherstep は端点で 1 次・2 次微分が 0＝加速度が滑らか（最小躍度・人の手の動き）。
  // 既定 uSmoother=1（smootherstep）。0 で旧 smoothstep（C1・境界で加速度ジャンプ）。
  float smoothRange(float a, float b, float x) {
    float t = clamp((x - a) / (b - a), 0.0, 1.0);
    float s3 = t * t * (3.0 - 2.0 * t);
    float s5 = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    return mix(s3, s5, uSmoother);
  }

  // --- Simplex 3D noise（Ashima Arts / Stefan Gustavson, MIT/public domain） ---
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  // 3 つの独立ポテンシャル（オフセット seed）から成るベクトル場。
  vec3 snoiseVec3(vec3 x) {
    return vec3(
      snoise(x),
      snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2)),
      snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4))
    );
  }
  // Curl noise（Bridson 2007）。∇×（ベクトルポテンシャル）で発散ゼロ＝流体的な漂い。
  // 軸独立 sin/cos と違い「湧き出し/吸い込み」が無く、渦を巻きながら自然に流れる。
  vec3 curlNoise(vec3 p) {
    const float e = 0.1;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    vec3 px0 = snoiseVec3(p - dx), px1 = snoiseVec3(p + dx);
    vec3 py0 = snoiseVec3(p - dy), py1 = snoiseVec3(p + dy);
    vec3 pz0 = snoiseVec3(p - dz), pz1 = snoiseVec3(p + dz);
    float x = (py1.z - py0.z) - (pz1.y - pz0.y);
    float y = (pz1.x - pz0.x) - (px1.z - px0.z);
    float z = (px1.y - px0.y) - (py1.x - py0.x);
    return vec3(x, y, z) / (2.0 * e);
  }

  void main() {
    vSeed = aSeed;
    vAccent = aAccent;
    vForm = uForm;

    // --- per-particle stagger: seed で各粒子の到達タイミングを分散 ---
    // 早い粒/遅い粒が生まれ「一斉移動」が「群れが集まる」波動感になる。
    // 各キーフレーム到達点の直前で窓 w を 0 に畳み、全粒子を正確にターゲットへ
    // 収束させる（DOM 整列・resolve のピクセル一致を壊さないため）。
    //
    // 【2026-07-08 修正】旧実装は uStage の固定範囲 0.55→0.85 でだけ畳んでいた。
    // これは元々「2キーフレームのみ（LINNO→タグライン）」の GlyphHero 用に
    // 決め打ちされた値で、そのキーフレームの唯一の収束点がたまたまこの範囲に
    // 来るよう調整されていた。駅を N 個つなぐ現在の構成（GlyphStageEngine）では
    // ほとんどの駅の収束点がこの固定範囲の外にあり、stagger が畳まれないまま
    // 収束するため、他の粒子が止まった後も一部の粒子だけ揺れながら遅れて
    // 到着し続ける「収束の最後が緩い」体感になっていた（凜さん 2026-07-08
    // 「収束の最後をもっとスムーズに」）。CPU 側（GlyphPoints.tsx）で
    // 「現在地から最も近い今後のキーフレーム到達点」までの距離を毎フレーム
    // 計算し uStaggerCollapse として渡す。固定範囲ではなく全ての到達点で
    // 同じように畳まれる。
    float w = uStagger * (1.0 - uStaggerCollapse);
    float stageP = clamp((uStage - aSeed * w) / max(1.0 - w, 0.001), 0.0, 1.0);

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
    // uCurl>0 で curl noise の流体的な漂い、0 で軽量な軸独立 sin/cos。
    // uCurl は uniform なので分岐は draw 全体で一様＝GPU の wave 分岐ペナルティ無し。
    if (uCurl > 0.001) {
      // 流れ場は「空間座標」で引く（粒子ごとに位相 ph をずらさない）。
      // 近傍粒子が同じ方向へ流れて初めて流体的に見える。座標を撹乱すると
      // 粒子ごとに無相関なランダム変位になり全面ノイズに崩れる。
      // 振幅は旧 sin/cos ドリフト（±0.06）と同等に抑え、雲を散らさない。
      vec3 flow = curlNoise(pos * 0.5 + vec3(0.0, 0.0, uTime * 0.06));
      pos += flow * 0.015 * drift * uCurl;
    } else {
      pos.x += sin(uTime * 0.35 + ph) * 0.06 * drift;
      pos.y += cos(uTime * 0.30 + ph * 1.7) * 0.06 * drift;
      pos.z += sin(uTime * 0.27 + ph * 2.3) * 0.06 * drift;
    }

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vec4 mvPosition = viewMatrix * world;
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;

    // --- 透明度: スワップ点まで不可視、スワップ点で即・不透明（フェード無し）。 ---
    // DOM 見出しと同位置・同サイズで一致しているため、瞬時の切替が「文字→粒子」に見える。
    // フィナーレ(uResolve)で粒子を素早く消し、実 DOM 文字へ受け渡す。
    vAlpha = uSwap * (1.0 - uResolve);

    // 点サイズ（遠近 + 個体差）。整列時はやや均一・小さめにして可読性を上げる。
    //
    // 【2026-07-08 収束後に薄くなる不具合を修正】粒子が「粗く太いにじみ」から
    // 「精密な文字の形」へ収束すると、文字のストロークは細くなるため、同じ
    // 粒子数でも塗りつぶす面積（見た目の濃さ）が自然と減っていた。実文字への
    // クロスフェードが始まるまでの間、この「薄くなった精密な粒子文字」が
    // そのまま表示され続け、「黒いパーティクルが収束した後に白くなって黒に
    // なっていく」ように見えていた（凜さん 2026-07-08 実機報告。ピクセル
    // 密度の実測で可視darkness比が0.365→0.268へ約27%低下することを確認済み）。
    // 整列時の粒サイズ下限を引き上げ、薄く見える現象を打ち消す。
    float sizeVar = mix(0.55 + aSeed * 0.9, 1.55 + aSeed * 0.35, uSettle);
    // 字形収束時は隣接粒子で隙間を埋めるためわずかに大きめ＆均一に。
    sizeVar = mix(sizeVar, 0.95 + aSeed * 0.18, uForm);
    // 高 dpr 環境では小粒・上限低めの方がエッジが締まり高精細に見える
    // （コーポレートサイト実装で実証。0.62 と clamp 4〜5 が最も「霞まない」）。
    float s = uSize * sizeVar * 0.62 * uSizeScale;
    gl_PointSize = s * uPixelRatio * (1.0 / -mvPosition.z);
    // 点サイズ上限。既定は 4〜5px（高精細・霞まない実証値）。uSizeScale(style.size) を
    // 掛けることで、収束時に「隙間なく塗られた solid なテキスト」を作りたいときは
    // style.size>1 で上限も引き上げられる（既定 uSizeScale=1 で挙動不変）。
    // 【2026-07-08】uSettle も上限に反映する。旧式は uForm（駅N全体の先頭/
    // 末尾遷移でのみ非ゼロ）だけが上限を上げていたため、途中の駅（uForm=0の
    // まま）では sizeVar 側をいくら大きくしてもこの上限にクランプされ、
    // 「収束後に薄くなる」不具合の修正が効かなかった。
    gl_PointSize = clamp(gl_PointSize, 1.0, mix(4.0, 5.5, max(uForm, uSettle)) * uPixelRatio * max(uSizeScale, 1.0));
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
    // 【2026-07-08 ブースト倍率を1.3→1.7に引き上げ】上の sizeVar コメント
    // 参照。粒サイズ拡大と合わせて、精密な字形に収束した粒子がストローク幅の
    // 減少分だけ薄く見える現象を打ち消す。
    float a = alpha * depthFade * vAlpha;
    a = mix(a, clamp(a * 2.2, 0.0, 1.0), vSettle);

    gl_FragColor = vec4(col, a);
  }
`;
