/**
 * blur.js — the blur and glow code every texture blur shares: Blur and Glow
 * (texture) and their hidden passes (compiler/blurPasses.ts), Neighbours
 * Average, Gaussian Blur and Bloom (u_prevFrame), and the Look stack's
 * Bloom / Halation chain (finish.js). See docs/blur-and-glow.md.
 *
 * Why it exists: a wide blur made of a few taps spread far apart (a Vogel
 * disc, a ring, a grid stretched by Radius) reads a thin bright line a few
 * times at a few fixed offsets, so the "glow" is a handful of ghost copies of
 * the line, rings and streaks. The fixes here are the textbook ones:
 *
 *  - Separable Gaussian with linear sampling (RasterGrid, "Efficient Gaussian
 *    blur with linear sampling"): one bilinear read between two texels
 *    returns their weighted sum, so a 1D kernel of 2n+1 texels costs n+1
 *    reads and every texel in reach is read (no gaps, no ghosts).
 *  - Downsample first for wide radii, with Jimenez's 13-tap filter (SIGGRAPH
 *    2014, "Next Generation Post Processing in Call of Duty: Advanced
 *    Warfare"), so a big blur runs on a small texture.
 *  - Bloom as a mip chain: 13-tap downsamples, then 9-tap tent upsamples
 *    added level by level (Jimenez 2014; Bjørge's dual filter, SIGGRAPH 2015
 *    "Bandwidth-Efficient Rendering"; LearnOpenGL "Physically Based Bloom").
 *  - When a single pass has to do (Fast, or a place hidden passes can't go),
 *    a per-pixel rotation and radial jitter from interleaved gradient noise
 *    (Jimenez 2014) so too few taps show as fine grain, not as copies.
 *
 * Pure: the GLSL is strings and the plans are numbers, so the app's compiler,
 * the Finish stack and web exports run the same code. Part of the layer kit:
 * exportHtml.ts inlines it into web exports, so every top-level name keeps
 * the `bl`/`BL_` prefix.
 */

/** σ of the Gaussian per unit of Radius: the old Vogel disc weighed exp(-2.5 r²), σ = R/√5. Radius keeps its meaning. */
export const BL_SIGMA_PER_RADIUS = 0.45;
/** Most bilinear pairs a 1D Gaussian reads per side (a σ of 16 texels is read with no gaps). */
export const BL_MAX_PAIRS = 24;
/** The σ (in texels) a Smooth blur aims for: past this it halves its texture first. */
export const BL_SIGMA_TARGET = 4;
/** Smallest texture a plan goes down to, relative to the picture. */
export const BL_MIN_SCALE = 1 / 128;
/** Most mip levels a bloom chain has. */
export const BL_MAX_LEVELS = 7;
/** Variance (in texels² of the level it writes) one 13-tap 2× downsample adds per axis: 1.5 + ¼ for the bilinear box, over 4. */
export const BL_DOWN13_VAR = (1.5 + 0.25) / 4;
/** Variance a 4-tap cubic B-spline read adds per axis, in texels² of the texture it reads. */
export const BL_BSPLINE_VAR = 1 / 3;

/** One-sided discrete Gaussian, normalised: w[0] + 2 Σ w[i>0] = 1. `half` texels each side (default ⌈3σ⌉). */
export function blGaussianWeights(sigma, half) {
  const n = half ?? Math.max(0, Math.ceil(3 * sigma));
  const w = [];
  for (let i = 0; i <= n; i++) w.push(sigma > 0 ? Math.exp(-0.5 * i * i / (sigma * sigma)) : (i === 0 ? 1 : 0));
  const sum = w.reduce((a, x, i) => a + (i ? 2 * x : x), 0);
  return w.map(x => x / sum);
}

/**
 * The linear-sampling taps of a 1D Gaussian (RasterGrid): the centre, then
 * one read per pair of texels (i, i+1), placed between them at
 * (i·wᵢ + (i+1)·wᵢ₊₁) / (wᵢ + wᵢ₊₁) so the bilinear filter returns exactly
 * wᵢ·Tᵢ + wᵢ₊₁·Tᵢ₊₁. offsets[0] = 0; each other offset is read at ±.
 * The weights sum (centre once, the others twice) to 1. The shader
 * (blGlsl's blGauss) works the same taps out per pixel.
 */
export function blLinearTaps(sigma, half) {
  const w = blGaussianWeights(sigma, half);
  const offsets = [0], weights = [w[0]];
  for (let i = 1; i < w.length; i += 2) {
    const a = w[i], b = i + 1 < w.length ? w[i + 1] : 0;
    const W = a + b;
    if (W <= 0) continue;
    offsets.push((i * a + (i + 1) * b) / W);
    weights.push(W);
  }
  return { offsets, weights };
}

/** A texture's size for a picture of w × h at `scale`, at least 1 × 1 (as passPlan's ppSize). */
export function blSize(w, h, scale) {
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

/**
 * A Smooth (separable Gaussian) blur's plan for a Radius (picture pixels) read
 * from a texture at `srcScale` of the picture: how many 2× downsamples first,
 * the scale the two 1D passes run at, and the variance the downsamples (and
 * the final cubic read when it is smaller than the picture) already add, so
 * the passes blur by what's left.
 */
export function blSmoothPlan(radius, srcScale = 1) {
  const sigma = Math.max(0, Number(radius) || 0) * BL_SIGMA_PER_RADIUS;
  let scale = srcScale > 0 ? srcScale : 1;
  let downs = 0;
  while (sigma * scale > BL_SIGMA_TARGET && scale / 2 >= BL_MIN_SCALE && downs < 4) { scale /= 2; downs++; }
  // Variance of the downsamples in texels of the working scale: each adds BL_DOWN13_VAR in its own
  // output's texels, and a level's texels are half the size of the next one down's.
  let v = 0;
  for (let i = 0; i < downs; i++) v = v / 4 + BL_DOWN13_VAR;
  const cubic = scale < 1;
  return { sigma, downs, scale, variance: v + (cubic ? BL_BSPLINE_VAR : 0), cubic };
}

/**
 * A bloom chain's plan: `levels` 2× downsamples from a texture at `srcScale`
 * (level k at srcScale / 2^k), then levels − 1 tent upsamples back to level 1.
 * Radius sets how many levels the glow reaches; the chain keeps one more than
 * that so Radius can grow live (a uniform) before it runs out.
 */
export function blBloomPlan(radius, srcScale = 1) {
  const s = srcScale > 0 ? srcScale : 1;
  const reach = blBloomReach(radius, s);
  let levels = Math.max(2, Math.min(BL_MAX_LEVELS, Math.ceil(reach) + 2));
  while (levels > 2 && s / 2 ** levels < BL_MIN_SCALE) levels--;
  const scales = [];
  for (let k = 1; k <= levels; k++) scales.push(s / 2 ** k);
  return { levels, scales, passes: 2 * levels - 1 };
}

/** How many levels a bloom of Radius reaches, as a number (log2 of Radius in level-1 texels). */
export function blBloomReach(radius, srcScale = 1) {
  return Math.log2(Math.max(1, Number(radius) || 0) * srcScale / 2);
}

/** Level k's weight (1-based) for a Radius: the levels inside its reach count fully, the next fades in. Level 1 always counts. */
export function blBloomWeight(radius, srcScale, k) {
  if (k <= 1) return 1;
  return Math.max(0, Math.min(1, blBloomReach(radius, srcScale) - k + 2));
}

/** The pixel sizes of a chain's textures for a picture of w × h (tests and the docs' table). */
export function blChainSizes(w, h, scales) {
  return scales.map(s => blSize(w, h, s));
}

const LUMA = 'vec3(0.299, 0.587, 0.114)';

/**
 * The shared GLSL functions. `T` is the texture read: 'texture2D' for the
 * graph (GLSL ES 1.00 style), 'texture' for GLSL ES 3.00 (the Finish pass).
 * Every offset argument is in the texture's 0–1 coordinates.
 */
export function blGlsl(T = 'texture2D') {
  return `
float blIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 blKeep(vec3 c, float thr, float knee) { return c * smoothstep(thr, thr + max(knee, 1e-4), dot(c, ${LUMA})); }
vec4 blKeep4(vec4 c, float thr, float knee) { return vec4(blKeep(c.rgb, thr, knee), c.a); }
vec4 blGauss(sampler2D s, vec2 uv, vec2 texel, float sigma) {
  vec4 acc = ${T}(s, uv);
  if (sigma < 0.2) return acc;
  float k = -0.5 / (sigma * sigma);
  float reach = ceil(3.0 * sigma);
  float stride = max(1.0, ceil(reach / ${(2 * BL_MAX_PAIRS).toFixed(1)}));
  float wsum = 1.0;
  for (int j = 0; j < ${BL_MAX_PAIRS}; j++) {
    float i = (2.0 * float(j) + 1.0) * stride;
    if (i > reach) break;
    float i2 = i + stride;
    float w1 = exp(k * i * i), w2 = exp(k * i2 * i2);
    float W = w1 + w2;
    float o = (i * w1 + i2 * w2) / W;
    acc += (${T}(s, uv + texel * o) + ${T}(s, uv - texel * o)) * (W * stride);
    wsum += 2.0 * W * stride;
  }
  return acc / wsum;
}
vec4 blGaussKeep(sampler2D s, vec2 uv, vec2 texel, float sigma, float thr, float knee) {
  vec4 acc = blKeep4(${T}(s, uv), thr, knee);
  if (sigma < 0.2) return acc;
  float k = -0.5 / (sigma * sigma);
  float reach = ceil(3.0 * sigma);
  float stride = max(1.0, ceil(reach / ${(2 * BL_MAX_PAIRS).toFixed(1)}));
  float wsum = 1.0;
  for (int j = 0; j < ${BL_MAX_PAIRS}; j++) {
    float i = (2.0 * float(j) + 1.0) * stride;
    if (i > reach) break;
    float i2 = i + stride;
    float w1 = exp(k * i * i), w2 = exp(k * i2 * i2);
    float W = w1 + w2;
    float o = (i * w1 + i2 * w2) / W;
    acc += (blKeep4(${T}(s, uv + texel * o), thr, knee) + blKeep4(${T}(s, uv - texel * o), thr, knee)) * (W * stride);
    wsum += 2.0 * W * stride;
  }
  return acc / wsum;
}
vec4 blDown13(sampler2D s, vec2 uv, vec2 t) {
  vec4 a = ${T}(s, uv + t * vec2(-2.0, 2.0)), b = ${T}(s, uv + t * vec2(0.0, 2.0)), c = ${T}(s, uv + t * vec2(2.0, 2.0));
  vec4 d = ${T}(s, uv + t * vec2(-2.0, 0.0)), e = ${T}(s, uv), f = ${T}(s, uv + t * vec2(2.0, 0.0));
  vec4 g = ${T}(s, uv + t * vec2(-2.0, -2.0)), h = ${T}(s, uv + t * vec2(0.0, -2.0)), i = ${T}(s, uv + t * vec2(2.0, -2.0));
  vec4 j = ${T}(s, uv + t * vec2(-1.0, 1.0)), k = ${T}(s, uv + t * vec2(1.0, 1.0));
  vec4 l = ${T}(s, uv + t * vec2(-1.0, -1.0)), m = ${T}(s, uv + t * vec2(1.0, -1.0));
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}
float blKarisW(vec4 c) { return 1.0 / (1.0 + dot(c.rgb, ${LUMA})); }
vec4 blDown13Keep(sampler2D s, vec2 uv, vec2 t, float thr, float knee) {
  vec4 a = blKeep4(${T}(s, uv + t * vec2(-2.0, 2.0)), thr, knee), b = blKeep4(${T}(s, uv + t * vec2(0.0, 2.0)), thr, knee), c = blKeep4(${T}(s, uv + t * vec2(2.0, 2.0)), thr, knee);
  vec4 d = blKeep4(${T}(s, uv + t * vec2(-2.0, 0.0)), thr, knee), e = blKeep4(${T}(s, uv), thr, knee), f = blKeep4(${T}(s, uv + t * vec2(2.0, 0.0)), thr, knee);
  vec4 g = blKeep4(${T}(s, uv + t * vec2(-2.0, -2.0)), thr, knee), h = blKeep4(${T}(s, uv + t * vec2(0.0, -2.0)), thr, knee), i = blKeep4(${T}(s, uv + t * vec2(2.0, -2.0)), thr, knee);
  vec4 j = blKeep4(${T}(s, uv + t * vec2(-1.0, 1.0)), thr, knee), k = blKeep4(${T}(s, uv + t * vec2(1.0, 1.0)), thr, knee);
  vec4 l = blKeep4(${T}(s, uv + t * vec2(-1.0, -1.0)), thr, knee), m = blKeep4(${T}(s, uv + t * vec2(1.0, -1.0)), thr, knee);
  // Karis average (Jimenez 2014): each of the five 2×2 boxes weighed by 1 / (1 + luma), so one blazing texel can't flicker.
  vec4 b0 = (j + k + l + m) * 0.25, b1 = (a + b + d + e) * 0.25, b2 = (b + c + e + f) * 0.25, b3 = (d + e + g + h) * 0.25, b4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * blKarisW(b0), w1 = 0.125 * blKarisW(b1), w2 = 0.125 * blKarisW(b2), w3 = 0.125 * blKarisW(b3), w4 = 0.125 * blKarisW(b4);
  return (b0 * w0 + b1 * w1 + b2 * w2 + b3 * w3 + b4 * w4) / (w0 + w1 + w2 + w3 + w4);
}
vec4 blTent(sampler2D s, vec2 uv, vec2 t) {
  vec4 r = ${T}(s, uv) * 4.0;
  r += (${T}(s, uv + vec2(t.x, 0.0)) + ${T}(s, uv - vec2(t.x, 0.0)) + ${T}(s, uv + vec2(0.0, t.y)) + ${T}(s, uv - vec2(0.0, t.y))) * 2.0;
  r += ${T}(s, uv + t) + ${T}(s, uv - t) + ${T}(s, uv + vec2(t.x, -t.y)) + ${T}(s, uv + vec2(-t.x, t.y));
  return r / 16.0;
}
vec4 blCubic(sampler2D s, vec2 uv, vec2 size) {
  vec2 p = uv * size - 0.5;
  vec2 f = fract(p);
  p -= f;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 s0 = w0 + w1, s1 = w2 + w3;
  vec2 q0 = (p - 0.5 + w1 / s0) / size, q1 = (p + 1.5 + w3 / s1) / size;
  return (${T}(s, vec2(q0.x, q0.y)) * s0.x + ${T}(s, vec2(q1.x, q0.y)) * s1.x) * s0.y
       + (${T}(s, vec2(q0.x, q1.y)) * s0.x + ${T}(s, vec2(q1.x, q1.y)) * s1.x) * s1.y;
}
vec4 blDisc(sampler2D s, vec2 uv, vec2 px, float radius, float n, vec2 frag) {
  float sigma = max(radius, 1e-4) * ${BL_SIGMA_PER_RADIUS.toFixed(2)};
  float k = -0.5 / (sigma * sigma);
  float rot = blIGN(frag) * 6.2831853;
  float jit = blIGN(frag + vec2(37.0, 17.0));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= n) break;
    float r = sqrt((float(i) + jit) / n) * radius * 1.3;
    float a = float(i) * 2.39996323 + rot;
    float w = exp(k * r * r);
    acc += ${T}(s, uv + vec2(cos(a), sin(a)) * r * px) * w;
    wsum += w;
  }
  return acc / max(wsum, 1e-5);
}
vec4 blDiscKeep(sampler2D s, vec2 uv, vec2 px, float radius, float n, vec2 frag, float thr, float knee) {
  float sigma = max(radius, 1e-4) * ${BL_SIGMA_PER_RADIUS.toFixed(2)};
  float k = -0.5 / (sigma * sigma);
  float rot = blIGN(frag) * 6.2831853;
  float jit = blIGN(frag + vec2(37.0, 17.0));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= n) break;
    float r = sqrt((float(i) + jit) / n) * radius * 1.3;
    float a = float(i) * 2.39996323 + rot;
    float w = exp(k * r * r);
    acc += blKeep4(${T}(s, uv + vec2(cos(a), sin(a)) * r * px), thr, knee) * w;
    wsum += w;
  }
  return acc / max(wsum, 1e-5);
}
`;
}

/** The bloom chain's level weights in GLSL: blBloomW(radius, srcScale, k), as blBloomWeight. */
export const BL_BLOOM_W_GLSL = `
float blBloomW(float radius, float srcScale, float k) {
  if (k <= 1.0) return 1.0;
  return clamp(log2(max(radius, 1.0) * srcScale / 2.0) - k + 2.0, 0.0, 1.0);
}
float blBloomSum(float radius, float srcScale, float levels) {
  float s = 0.0;
  for (int k = 1; k <= ${BL_MAX_LEVELS}; k++) { if (float(k) > levels) break; s += blBloomW(radius, srcScale, float(k)); }
  return s;
}`;

/** blGlsl for the graph (GLSL ES 1.00 style): one string, so a program with several blur nodes declares it once. */
export const BL_GLSL2 = blGlsl('texture2D');
