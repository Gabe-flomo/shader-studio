/**
 * rays.js — Radial Fast Blur / Light rays, in the spirit of After Effects' CC Radial Fast Blur:
 * long zoom streaks and light rays made by blurring the picture toward (or away from) a centre.
 * One implementation, shared by:
 *
 *  - the Studio's Radial Fast Blur node (nodes/definitions/radialFastBlur.ts), whose hidden passes
 *    (compiler/hiddenBlurs.ts) run the log-step passes below, then composite;
 *  - the builders' Effects page (builders/look/effects.ts: the Light rays card builds that node);
 *  - Play's Light rays finish effect (finish.js: its own passes, the same GLSL).
 *
 * See docs/radial-fast-blur.md.
 *
 * Fast: a log-step zoom. A streak is the picture read at many scales about the centre:
 * c + (uv − c) · e^(−t), t from 0 to the span. Scaling about a point composes by adding the
 * exponents, so a pass that averages RF_TAPS reads 1 step apart, followed by a pass whose reads are
 * RF_TAPS steps apart, and so on, is the same as one pass of RF_TAPS^RF_PASSES reads 1 step apart:
 * 4 passes × 8 taps = 4096 effective taps for 32 reads a pixel, at any Length, with no gaps and no
 * banding. Brightest (the max along the streak) composes the same way (a max of maxes), and Decay
 * (an exponential weight along the streak) multiplies across passes, so it is exact too.
 *
 * Pure: GLSL strings and plan numbers. Part of the layer kit (exportHtml.ts inlines it into web
 * exports), so every top-level name keeps the `rf`/`RF_` prefix.
 */

/** Reads per pass, and passes. RF_TAPS ** RF_PASSES is the effective number of reads along a streak. */
export const RF_TAPS = 8;
export const RF_PASSES = 4;
/** Reads of the one-pass fallback (a node where hidden passes can't go), jittered per pixel. */
export const RF_SINGLE_TAPS = 48;
/** Composite modes, in their numeric order (Play keeps the mode as a number). */
export const RF_MODES = ['average', 'brightest', 'add'];
/** Zoom directions, in their numeric order: out from the centre (streaks fly outward), into it. */
export const RF_DIRECTIONS = ['out', 'in'];
/** The longest Length the controls offer (typing past it is allowed). */
export const RF_MAX_LENGTH = 4;

const rfNum = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Effective reads along a streak for `passes` passes of `taps` reads. */
export function rfEffective(passes = RF_PASSES, taps = RF_TAPS) {
  return Math.pow(taps, passes);
}

/**
 * The streak's span in log-scale units for a Length: the farthest copy is (1 + Length) times
 * bigger than the nearest. Length 1: Out reads from half way to the centre; 0 is no streak.
 */
export function rfSpan(length) {
  return Math.log(1 + Math.max(0, rfNum(length, 0)));
}

/**
 * Brightest's tail. Each read along the streak is weighed e^(−rate·t) BEFORE the max, so a ray fades
 * smoothly from its source instead of holding its brightness and stopping where the streak ends. So
 * that the fade can run on past Length instead of being cut off, Brightest reads RF_TAIL_REACH times
 * as far: at Length the weight is e^(−(RF_TAIL_BASE + RF_TAIL_DECAY·Decay)) (half at Decay 0,
 * 30 % at 0.17), at the end of the reads its fifth power (3 % at Decay 0, 0.2 % at 0.17). An exponential
 * multiplies across the log-step passes, so the max stays exact.
 */
export const RF_TAIL_REACH = 5;
export const RF_TAIL_BASE = 0.7;
export const RF_TAIL_DECAY = 3;
/** The default Opacity: how much of the rays shows over the picture in Brightest and Add. */
export const RF_OPACITY = 0.6;

/** How far the reads go, in log units: the span (Average, Add) or RF_TAIL_REACH spans (Brightest). */
export function rfReach(length, useMax = false) {
  return rfSpan(length) * (useMax ? RF_TAIL_REACH : 1);
}

/** Pass k's step: log units between its reads (k = 0 the finest). */
export function rfStep(length, k, passes = RF_PASSES, taps = RF_TAPS, useMax = false) {
  const n = rfEffective(passes, taps);
  return n > 1 ? rfReach(length, useMax) / (n - 1) * Math.pow(taps, k) : 0;
}

/**
 * Every offset (log units) the passes read together, ascending: what `passes` × `taps` add up to.
 * For the tests: RF_TAPS^RF_PASSES offsets, evenly spaced from 0 to the reach.
 */
export function rfOffsets(length, passes = RF_PASSES, taps = RF_TAPS, useMax = false) {
  let out = [0];
  for (let k = 0; k < passes; k++) {
    const s = rfStep(length, k, passes, taps, useMax);
    const next = [];
    for (const o of out) for (let j = 0; j < taps; j++) next.push(o + j * s);
    out = next;
  }
  return out.sort((a, b) => a - b);
}

/**
 * Decay's rate along the streak, per log unit. Average and Add (averages): the far end weighs
 * e^(−4·Decay) of the near end, as before. Brightest (`useMax`): the tail above, always fading out.
 */
export function rfDecayRate(length, decay, useMax = false) {
  const s = rfSpan(length);
  if (!(s > 1e-6)) return 0;
  const d = Math.max(0, rfNum(decay, 0));
  return (useMax ? RF_TAIL_BASE + RF_TAIL_DECAY * d : 4 * d) / s;
}

/**
 * Brightest along one streak on the CPU, as the passes compute it (the tests): `f(t)` is the picture's
 * brightness t log units along the streak from this pixel; the max of f(t)·e^(−rate·t) over the reads.
 */
export function rfBrightest(f, length, decay) {
  const rate = rfDecayRate(length, decay, true);
  let m = 0;
  for (const t of rfOffsets(length, RF_PASSES, RF_TAPS, true)) m = Math.max(m, f(t) * Math.exp(-rate * t));
  return m;
}

/** How much of a colour of brightness `luma` streaks: 1 with Threshold 0, else a soft knee of ±Knee round it. */
export function rfKnee(luma, threshold, knee) {
  if (!(threshold > 0)) return 1;
  const k = Math.max(rfNum(knee, 0), 1e-4);
  const x = Math.min(1, Math.max(0, (luma - (threshold - k)) / (2 * k)));
  return x * x * (3 - 2 * x);
}

/** The composite on the CPU (one channel, premultiplied), as the GLSL does it: for the tests. */
export function rfCompositePixel(orig, rays, mode, amount, opacity = RF_OPACITY) {
  const m = typeof mode === 'string' ? RF_MODES.indexOf(mode) : mode;
  const a = Math.max(0, amount);
  const o = Math.min(1, Math.max(0, rfNum(opacity, RF_OPACITY)));
  if (m <= 0) return orig + (rays * Math.max(a, 1) - orig) * Math.min(a, 1);
  if (m === 1) return orig + Math.max(0, 1 - orig) * rays * a * o;
  return orig + rays * a * o;
}

/**
 * Helpers that don't read a texture (any GLSL version): the knee, the span and steps, the
 * falloff from the centre, the composite and a dither.
 */
export const RF_BASE_GLSL = `// Radial Fast Blur / Light rays (play/kit/rays.js).
float rfIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float rfKnee(vec3 c, float thr, float knee) {
  if (thr <= 0.0) return 1.0;
  float k = max(knee, 1e-4);
  return smoothstep(thr - k, thr + k, dot(c, vec3(0.2126, 0.7152, 0.0722)));
}
float rfSpan(float len) { return log(1.0 + max(len, 0.0)); }
// How far the reads go: the span, or ${RF_TAIL_REACH} spans for Brightest's tail (useMax).
float rfReach(float len, float useMax) { return rfSpan(len) * (useMax > 0.5 ? ${RF_TAIL_REACH.toFixed(1)} : 1.0); }
// Pass k's step: the reach over ${rfEffective()} - 1 reads, times ${RF_TAPS}^k.
float rfStep(float len, float k, float useMax) { return rfReach(len, useMax) / ${(rfEffective() - 1).toFixed(1)} * pow(${RF_TAPS.toFixed(1)}, k); }
// Average and Add: the far end weighs e^(-4 Decay). Brightest (useMax): e^(-(${RF_TAIL_BASE} + ${RF_TAIL_DECAY} Decay)) at Length, a tail fading on past it.
float rfDecayRate(float len, float decay, float useMax) {
  float s = rfSpan(len);
  float d = max(decay, 0.0);
  return s > 1e-6 ? (useMax > 0.5 ? ${RF_TAIL_BASE.toFixed(2)} + ${RF_TAIL_DECAY.toFixed(1)} * d : 4.0 * d) / s : 0.0;
}
// How much shows at uv (0-1) with the centre c: 1 at the centre, fading with the distance (picture heights) by Falloff.
float rfFalloff(vec2 uv, vec2 c, float aspect, float falloff) { vec2 d = (uv - c) * vec2(aspect, 1.0); return exp(-max(falloff, 0.0) * 4.0 * dot(d, d)); }
// The light over the picture, both premultiplied. mode 0 Average (the zoom blur in place of the picture),
// 1 Brightest (the brightest along each streak, screened over the picture by Opacity: it only lightens, what is
// behind shows through, and a ray that fades along its length fades into the picture), 2 Add (the rays' light added, times Opacity). Average ignores Opacity.
vec4 rfComposite(vec4 orig, vec4 rays, float mode, float amount, vec3 tint, float opacity) {
  float a = max(amount, 0.0);
  float o = clamp(opacity, 0.0, 1.0);
  vec4 r = vec4(rays.rgb * tint, rays.a);
  if (mode < 0.5) return mix(orig, vec4(r.rgb * max(a, 1.0), r.a), min(a, 1.0));
  vec4 l = vec4(r.rgb * a, r.a * min(a, 1.0));
  if (mode < 1.5) return vec4(orig.rgb + l.rgb * max(vec3(1.0) - orig.rgb, 0.0) * o, orig.a + l.a * o * (1.0 - orig.a));
  return vec4(orig.rgb + l.rgb * o, orig.a + l.a * o * (1.0 - orig.a));
}
`;

/**
 * The passes' GLSL for texture function `T` ('texture2D' for the Studio's GLSL ES 1.00, 'texture'
 * for the Finish stack's 3.00). With `read` (a function of a vec2 expression), the passes read
 * through it and take no sampler: rfPassR / rfSingleR.
 *
 *  - rfPass: one log-step pass. RF_TAPS reads at t = (j + jit) · step, weighted e^(−rate·t);
 *    averaged, or the max (Brightest). dir 1 zooms out from the centre (reads nearer it), −1 in.
 *    thr > 0 keeps only what is over the threshold (the first pass only).
 *  - rfSingle: the whole streak in one pass of RF_SINGLE_TAPS reads, jittered per pixel (grain,
 *    not copies): for a node where hidden passes can't go.
 */
export function rfGlsl(T = 'texture2D', read) {
  const sig = read ? '' : 'sampler2D s, ';
  const sfx = read ? 'R' : '';
  const rd = read || (p => `${T}(s, ${p})`);
  const body = (n, tExpr) => `
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int j = 0; j < ${n}; j++) {
    float t = ${tExpr};
    vec4 v = ${rd('c + (uv - c) * exp(-dir * t)')};
    if (thr > 0.0) v *= rfKnee(v.rgb, thr, knee);
    float w = exp(-rate * t);
    if (useMax > 0.5) acc = max(acc, v * w); else acc += v * w;
    ws += w;
  }
  return useMax > 0.5 ? acc : acc / max(ws, 1e-6);`;
  return `vec4 rfPass${sfx}(${sig}vec2 uv, vec2 c, float stp, float dir, float rate, float useMax, float thr, float knee) {${body(RF_TAPS, 'float(j) * stp')}
}
vec4 rfSingle${sfx}(${sig}vec2 uv, vec2 c, float len, float dir, float rate, float useMax, float thr, float knee, float jit) {
  float stp = rfReach(len, useMax) / ${RF_SINGLE_TAPS.toFixed(1)};${body(RF_SINGLE_TAPS, 'min((float(j) + jit) * stp, rfReach(len, useMax))')}
}
`;
}

/** The Studio's passes (GLSL ES 1.00, texture2D), one string so a program that has it twice declares it once. */
export const RF_GLSL2 = rfGlsl('texture2D');
