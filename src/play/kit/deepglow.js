/**
 * deepglow.js — Deep Glow: a bloom in the spirit of After Effects' Deep Glow, a hot core with a long,
 * natural tail. One implementation, shared by:
 *
 *  - the Studio's Deep Glow (texture) node (nodes/definitions/deepGlow.ts), whose hidden passes
 *    (compiler/blurPasses.ts planDeepGlow, hiddenBlurs.ts) run the chain below, then composite;
 *  - the builders' Effects page (builders/look/effects.ts: the Deep Glow card builds that node);
 *  - Play's Deep Glow finish effect (finish.js: its own chain before the pass it heads, the same GLSL).
 *
 * See docs/deep-glow.md.
 *
 * The chain:
 *  1. prefilter: the picture halved (a dual-filter downsample, 5 reads) keeping only what is over
 *     Threshold, with a soft Knee (no hard edge where the glow starts);
 *  2. down: halved again and again (dual filter, 5 reads each) to DG_LEVELS levels, 1/2 … 1/256;
 *  3. up: from the smallest back to the half-size level, each step the level below upsampled (a
 *     Kawase dual-filter tent, 8 reads) plus this level × its weight.
 * Each level is a wider blur (about twice the one before), so the sum is many radii at once: weighted
 * by an exponential falloff (each level DG_TAIL stops below the one before) out to Radius, it gives a
 * hot core and a long tail that fades out smoothly instead of a single soft disc. Chromatic spread
 * lets red reach a little further than green and blue a little less. Half-float targets, so what is
 * brighter than white glows brighter.
 *
 * Pure: GLSL strings and plan numbers. Part of the layer kit (exportHtml.ts inlines it into web
 * exports), so every top-level name keeps the `dg`/`DG_` prefix.
 */

/** Levels of the chain (1/2 … 1/2^DG_LEVELS of the source). */
export const DG_LEVELS = 8;
/** The smallest a level may be, as a fraction of the picture (a level smaller is dropped). */
export const DG_MIN_SCALE = 1 / 256;
/** Each level weighs 2^−DG_TAIL of the one before: the exponential falloff of the tail. */
export const DG_TAIL = 0.4;
/** How many levels Chromatic spread 1 moves red's reach out (and blue's in). */
export const DG_SPREAD_LEVELS = 1;
/** Reads of the one-pass fallback (a node where hidden passes can't go). */
export const DG_SINGLE_TAPS = 32;
/** Composite modes, in their numeric order. */
export const DG_COMPOSITES = ['add', 'screen'];

const dgNum = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Levels for a source at `srcScale` of the picture: DG_LEVELS, fewer while the smallest would pass DG_MIN_SCALE. */
export function dgLevels(srcScale = 1) {
  const s = srcScale > 0 ? srcScale : 1;
  let n = DG_LEVELS;
  while (n > 2 && s / 2 ** n < DG_MIN_SCALE) n--;
  return n;
}

/** The chain's passes: the prefilter, the downs after it and the ups (2 × levels − 1). */
export function dgPassCount(levels = DG_LEVELS) {
  return 1 + (levels - 1) + (levels - 1);
}

/** The levels' scales (fractions of the picture) for a source at `srcScale`. */
export function dgScales(srcScale = 1, levels = dgLevels(srcScale)) {
  const s = srcScale > 0 ? srcScale : 1;
  return Array.from({ length: levels }, (_, i) => s / 2 ** (i + 1));
}

/**
 * The reach in levels for a Radius in picture pixels with the source at `srcScale` (level k's
 * blur is about 2^k of its source's pixels): log2(Radius × srcScale), at least 1.
 */
export function dgReach(radius, srcScale = 1) {
  return Math.max(1, Math.log2(Math.max(1, dgNum(radius, 1)) * (srcScale > 0 ? srcScale : 1)));
}

/**
 * Level k's weight (1-based) per channel, [r, g, b]: the tail's exponential falloff (2^−DG_TAIL a
 * level), cut off smoothly over the level past the reach. Spread moves red's reach out and blue's in.
 * Level 1 (the core) always counts.
 */
export function dgWeight(k, reach, spread = 0) {
  const sp = dgNum(spread, 0) * DG_SPREAD_LEVELS;
  return [sp, 0, -sp].map(o => (k <= 1 ? 1 : Math.min(1, Math.max(0, reach + o - k + 1))) * Math.pow(2, -DG_TAIL * (k - 1)));
}

/** The weights' sum per channel over `levels` levels (the glow is divided by it: Radius doesn't change its total). */
export function dgWeightSum(reach, spread = 0, levels = DG_LEVELS) {
  const s = [0, 0, 0];
  for (let k = 1; k <= levels; k++) dgWeight(k, reach, spread).forEach((w, c) => { s[c] += w; });
  return s;
}

/** How much of a colour with brightest channel `v` glows: 0 under Threshold − Knee, a soft curve to it, then v − Threshold (Unity's soft knee). */
export function dgKnee(v, threshold, knee) {
  const t = dgNum(threshold, 0), k = Math.max(dgNum(knee, 0), 1e-4);
  const q = Math.min(2 * k, Math.max(0, v - t + k));
  return Math.max(q * q / (4 * k), v - t);
}

/** The composite on the CPU (one channel), as the GLSL does it after the tint and Preserve colour: for the tests. */
export function dgCompositePixel(c, glow, mode) {
  const m = typeof mode === 'string' ? DG_COMPOSITES.indexOf(mode) : mode;
  return m === 1 ? 1 - (1 - c) * (1 - Math.min(Math.max(glow, 0), 1)) : c + glow;
}

const fl = n => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * Helpers that don't read a texture (any GLSL version): the soft knee, the weights, a dither and the
 * composite.
 */
export const DG_BASE_GLSL = `// Deep Glow (play/kit/deepglow.js).
float dgIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// What glows of a colour: its brightest channel over Threshold, with a soft Knee, as a factor of the colour.
vec3 dgKeep(vec3 c, float thr, float knee) {
  float v = max(c.r, max(c.g, c.b));
  float k = max(knee, 1e-4);
  float q = clamp(v - thr + k, 0.0, 2.0 * k);
  return c * (max(q * q / (4.0 * k), v - thr) / max(v, 1e-4));
}
// The reach in levels for Radius picture pixels, the source at scale s.
float dgReach(float radius, float s) { return max(1.0, log2(max(radius, 1.0) * s)); }
// Level k's weight per channel: each level ${DG_TAIL} stops below the one before, cut off over the level past the reach (red's reach Spread levels further, blue's less).
vec3 dgW(float k, float reach, float spread) {
  vec3 r = vec3(reach) + vec3(1.0, 0.0, -1.0) * spread * ${fl(DG_SPREAD_LEVELS)};
  vec3 cut = k <= 1.0 ? vec3(1.0) : clamp(r - k + 1.0, 0.0, 1.0);
  return cut * exp2(-${fl(DG_TAIL)} * (k - 1.0));
}
vec3 dgWSum(float reach, float spread, float levels) {
  vec3 s = vec3(0.0);
  for (int i = 1; i <= ${DG_LEVELS}; i++) { if (float(i) > levels) break; s += dgW(float(i), reach, spread); }
  return s;
}
// The glow over the picture: tinted, at Intensity; Preserve colour 1 keeps the glow's own colours, 0 lets its
// hot core bloom to white; Add, or Screen (never past white).
vec3 dgComposite(vec3 c, vec3 glow, float intensity, vec3 tint, float preserve, float mode) {
  vec3 g = max(glow, 0.0) * max(intensity, 0.0) * tint;
  float m = max(g.r, max(g.g, g.b));
  float hot = 1.0 - exp(-m * 1.5);
  g = mix(g, vec3(m), (1.0 - clamp(preserve, 0.0, 1.0)) * hot);
  return mode > 0.5 ? 1.0 - (1.0 - c) * (1.0 - clamp(g, 0.0, 1.0)) : c + g;
}
`;

/**
 * The chain's GLSL for texture function `T` ('texture2D' for the Studio's GLSL ES 1.00, 'texture' for the
 * Finish stack's 3.00). With `read` (a function of a vec2 expression) dgDownR reads through it and takes
 * no sampler (Finish's prefilter reads its pass's input).
 *
 *  - dgDown(s, uv, texel): the dual-filter downsample: the point ×4 and four diagonal reads a texel out, ÷ 8.
 *  - dgPre(s, uv, texel, thr, knee): the same, keeping what glows per read (the prefilter).
 *  - dgUp(s, uv, texel): the Kawase dual-filter upsample, a tent of 8 reads round the point.
 */
export function dgGlsl(T = 'texture2D', read) {
  const rd = read || (q => `${T}(s, ${q})`);
  const sig = read ? '' : 'sampler2D s, ';
  const sfx = read ? 'R' : '';
  const out = [];
  out.push(`vec4 dgDown${sfx}(${sig}vec2 uv, vec2 t) {
  return (${rd('uv')} * 4.0 + ${rd('uv - t')} + ${rd('uv + t')} + ${rd('uv + vec2(t.x, -t.y)')} + ${rd('uv - vec2(t.x, -t.y)')}) / 8.0;
}
vec4 dgPre${sfx}(${sig}vec2 uv, vec2 t, float thr, float knee) {
  vec4 a = ${rd('uv')}, b = ${rd('uv - t')}, c = ${rd('uv + t')}, d = ${rd('uv + vec2(t.x, -t.y)')}, e = ${rd('uv - vec2(t.x, -t.y)')};
  return vec4((dgKeep(a.rgb, thr, knee) * 4.0 + dgKeep(b.rgb, thr, knee) + dgKeep(c.rgb, thr, knee) + dgKeep(d.rgb, thr, knee) + dgKeep(e.rgb, thr, knee)) / 8.0, 1.0);
}
`);
  if (!read) {
    out.push(`vec4 dgUp(sampler2D s, vec2 uv, vec2 t) {
  vec4 o = ${T}(s, uv + vec2(-2.0 * t.x, 0.0)) + ${T}(s, uv + vec2(2.0 * t.x, 0.0)) + ${T}(s, uv + vec2(0.0, 2.0 * t.y)) + ${T}(s, uv + vec2(0.0, -2.0 * t.y));
  o += (${T}(s, uv + vec2(-t.x, t.y)) + ${T}(s, uv + vec2(t.x, t.y)) + ${T}(s, uv + vec2(t.x, -t.y)) + ${T}(s, uv + vec2(-t.x, -t.y))) * 2.0;
  return o / 12.0;
}
// Where hidden passes can't go: one pass of ${DG_SINGLE_TAPS} reads on a spiral out to Radius (denser in the core), turned per pixel. Grainy, but a glow.
vec3 dgSingle(sampler2D s, vec2 uv, vec2 t, float radius, float thr, float knee, float jit) {
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < ${DG_SINGLE_TAPS}; i++) {
    float f = (float(i) + jit) / ${fl(DG_SINGLE_TAPS)};
    float a = float(i) * 2.39996 + jit * 6.28318;
    float w = exp(-4.0 * f);
    acc += dgKeep(${T}(s, uv + vec2(cos(a), sin(a)) * radius * f * f * t).rgb, thr, knee) * w;
    ws += w;
  }
  return acc / ws;
}
`);
  }
  return out.join('');
}

/** The Studio's chain (GLSL ES 1.00, texture2D), one string so a program that has it twice declares it once. */
export const DG_GLSL2 = dgGlsl('texture2D');
