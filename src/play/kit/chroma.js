/**
 * chroma.js — Chromatic Aberration, built like a lens does it rather than as three hard copies of the
 * picture. One implementation, shared by:
 *
 *  - the Studio's Chromatic Aberration (lens) node (nodes/definitions/chromaLens.ts);
 *  - the builders' Effects page (builders/look/effects.ts: the Chromatic aberration card builds that node);
 *  - Play's Chromatic aberration finish effect (finish.js: what the first pass reads, the same GLSL).
 *
 * See docs/chromatic-aberration.md.
 *
 * Spectral (the default): the picture is read at N taps (CA_MIN_TAPS–CA_MAX_TAPS) spread across the
 * spectrum, red to violet. Each tap's shift scales with its wavelength (red one way, violet the other,
 * green about still) and each is weighed by a spectral → RGB table whose taps add up to white, so a grey
 * picture stays grey and an edge fringes in a smooth rainbow, not in three coloured copies. A tap's
 * wavelength is jittered per pixel inside its slice of the spectrum, so the gradient is continuous (fine
 * grain, never bands).
 * Channel split: red and blue copies shifted apart, green where it is: the clean stylised look (and the
 * old Chromatic Aberration (texture) node's maths, with Blur 0).
 *
 * Geometry: Lateral (radial from a movable centre, growing toward the edges by Falloff, with an optional
 * per-colour barrel Distortion), Axial (no shift: red and violet are out of focus, a coloured halo round
 * highlights) or Directional (a prism: every pixel spread along Angle).
 *
 * Dispersion blur: each tap is read over a small disc whose radius is Blur × its shift, so the far
 * colours melt into the picture while green stays sharp.
 *
 * Pure: GLSL strings and plan numbers. Part of the layer kit (exportHtml.ts inlines it into web
 * exports), so every top-level name keeps the `ca`/`CA_` prefix.
 */

/** Looks, in their numeric order (Play keeps them as numbers). */
export const CA_MODES = ['spectral', 'split'];
/** Geometries, in their numeric order. */
export const CA_GEOMETRIES = ['lateral', 'axial', 'directional'];
/** Taps across the spectrum: the fewest, the most and the default. */
export const CA_MIN_TAPS = 3;
export const CA_MAX_TAPS = 16;
export const CA_TAPS = 12;
/**
 * Reads per tap while it blurs (Blur above 0, or Axial), for a tap whose blur is wider than half a pixel
 * (green, barely moved, is read once). Two keeps the default under a millisecond at 1080p; the per-pixel
 * jitter of where in its slice and its disc each read lands does the rest (fine grain, never copies).
 */
export const CA_SUB = 2;
/** How much Distortion bends each colour: its scale about the centre is 1 + CA_DIST × Distortion × r² × shift. */
export const CA_DIST = 0.02;

const caNum = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
/** A smooth bump: 1 at c, 0 from c ± w. */
const caBump = (t, c, w) => { const x = (t - c) / w; return x * x < 1 ? (1 - x * x) * (1 - x * x) : 0; };

/**
 * The spectrum at t (0 red, 1 violet) as linear RGB: red, through yellow, green and cyan to blue, and
 * violet (blue with a little red). Not normalised: the taps' sum is divided out (caSpectralWeights).
 */
export function caSpec(t) {
  return [caBump(t, 0, 0.42) + 0.3 * caBump(t, 1, 0.18), caBump(t, 0.45, 0.28), caBump(t, 0.8, 0.28)];
}

/** A tap's shift (−1…1 times the spread): red (t 0) one way, violet (t 1) the other. */
const caShiftOf = t => 1 - 2 * t;

/**
 * The spread: shifts are (1 − 2t) × CA_SPREAD, scaled so the weighted middle of red's taps and of
 * blue's sit exactly ±1 apart (as Channel split's copies do): an Amount moves the colours as far in
 * both looks, and a recipe saved with the old RGB split keeps its strength.
 */
export const CA_SPREAD = (() => {
  const N = 2048;
  let sr = 0, wr = 0, sb = 0, wb = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N, w = caSpec(t), s = caShiftOf(t);
    sr += s * w[0]; wr += w[0]; sb += s * w[2]; wb += w[2];
  }
  return 2 / (sr / wr - sb / wb);
})();

/** The number of taps a look reads (Channel split: three; Spectral: Samples, clamped). */
export function caTapCount(mode, samples) {
  const m = typeof mode === 'string' ? CA_MODES.indexOf(mode) : mode;
  if (m === 1) return 3;
  return Math.max(CA_MIN_TAPS, Math.min(CA_MAX_TAPS, Math.round(caNum(samples, CA_TAPS))));
}

/**
 * The taps' wavelengths, shifts and RGB weights for `n` taps (each at the middle of its slice; the
 * GLSL jitters inside the slice), the weights normalised so each channel adds up to 1: white.
 * Channel split: red +1, green 0, blue −1, one channel each.
 */
export function caSpectralWeights(n = CA_TAPS, mode = 'spectral') {
  if (mode === 'split' || mode === 1) return [{ t: 0, shift: 1, w: [1, 0, 0] }, { t: 0.5, shift: 0, w: [0, 1, 0] }, { t: 1, shift: -1, w: [0, 0, 1] }];
  const taps = [];
  const sum = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, w = caSpec(t);
    for (let c = 0; c < 3; c++) sum[c] += w[c];
    taps.push({ t, shift: caShiftOf(t) * CA_SPREAD, w });
  }
  for (const tp of taps) tp.w = tp.w.map((v, c) => (sum[c] > 0 ? v / sum[c] : 0));
  return taps;
}

/**
 * The red end's shift, in pixels, at a point `r` half picture-heights from the centre: Lateral grows
 * by Falloff (0 the same everywhere, 1 in step with the distance, 2 mostly at the edges); Directional
 * is the same everywhere; Axial doesn't shift (it defocuses).
 */
export function caShiftPx(geom, amount, r, falloff) {
  const g = typeof geom === 'string' ? CA_GEOMETRIES.indexOf(geom) : geom;
  const a = caNum(amount, 0);
  if (g === 1) return 0;
  if (g === 2) return a;
  const f = Math.max(0, caNum(falloff, 1));
  return r > 1e-5 ? a * Math.pow(r, f) : (f <= 0 ? a : 0);
}

/**
 * A tap's blur radius in pixels: Blur × how far it is shifted (the further a colour goes, the softer it
 * is), plus, for Axial, its defocus (Amount × its distance from green along the spectrum).
 */
export function caBlurPx(shiftPx, blur, axialAmount = 0, shift = 0) {
  return Math.max(0, caNum(blur, 0)) * Math.abs(shiftPx) + Math.abs(caNum(axialAmount, 0) * shift);
}

/** The most reads one pixel makes: taps × CA_SUB while it blurs (Blur above 0, or Axial), else taps. */
export function caReads(mode, samples, blur, geom) {
  const g = typeof geom === 'string' ? CA_GEOMETRIES.indexOf(geom) : geom;
  return caTapCount(mode, samples) * (caNum(blur, 0) > 0 || g === 1 ? CA_SUB : 1);
}

/**
 * The aberration on the CPU, one row of a picture, the way the GLSL does it with Lateral or Directional
 * and Blur 0 (taps at the middle of their slices): `f(x)` is the picture (an [r, g, b]) at x pixels.
 * For the tests: a grey picture stays grey, and an edge fringes.
 */
export function caRow(f, x, amount, n = CA_TAPS, mode = 'spectral') {
  const out = [0, 0, 0];
  for (const tp of caSpectralWeights(n, mode)) {
    const v = f(x + amount * tp.shift);
    for (let c = 0; c < 3; c++) out[c] += v[c] * tp.w[c];
  }
  return out;
}

const fl = n => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** Helpers that don't read a texture (any GLSL version): the spectrum and a dither. */
export const CA_BASE_GLSL = `// Chromatic Aberration (play/kit/chroma.js).
float caIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float caBump(float t, float c, float w) { float x = clamp((t - c) / w, -1.0, 1.0); x = 1.0 - x * x; return x * x; }
// The spectrum at t (0 red, 1 violet) as linear RGB; the taps' sum is divided out, so they add up to white.
vec3 caSpec(float t) {
  vec3 x = clamp((vec3(t) - vec3(0.0, 0.45, 0.8)) / vec3(0.42, 0.28, 0.28), -1.0, 1.0);
  x = 1.0 - x * x;
  return x * x + vec3(0.3 * caBump(t, 1.0, 0.18), 0.0, 0.0);
}
`;

/**
 * The read's GLSL for texture function `T` ('texture2D' for the Studio's GLSL ES 1.00, 'texture' for
 * the Finish stack's 3.00). With `read` (a function of a vec2 expression) it reads through that and
 * takes no sampler: caReadR.
 *
 * caRead(s, uv, c, texel, aspect, mode, geom, amount, samples, blur, falloff, angle, distortion, jit):
 *   uv, c      the pixel and the centre, 0–1 texture coordinates
 *   texel      one pixel, in texture coordinates (Amount is in these pixels)
 *   aspect     width / height
 *   mode       0 Spectral, 1 Channel split;  geom 0 Lateral, 1 Axial, 2 Directional
 *   angle      Directional's direction, radians;  jit a per-pixel 0–1 (caIGN)
 * Returns the colour (each channel divided by its weights: white in, white out) and alpha.
 */
export function caGlsl(T = 'texture2D', read) {
  const sig = read ? '' : 'sampler2D s, ';
  const sfx = read ? 'R' : '';
  const rd = read || (q => `${T}(s, ${q})`);
  return `vec4 caRead${sfx}(${sig}vec2 uv, vec2 c, vec2 texel, float aspect, float mode, float geom, float amount, float samples, float blur, float falloff, float angle, float distortion, float jit) {
  vec2 dA = (uv - c) * vec2(aspect, 1.0);
  float dl = length(dA);
  float r = dl * 2.0;
  vec2 dir = vec2(0.0);
  float mag = 0.0;
  if (geom > 1.5) { dir = vec2(cos(angle), sin(angle)); mag = amount; }
  else if (geom < 0.5) { dir = dl > 1e-6 ? dA / dl : vec2(0.0); mag = r > 1e-5 ? amount * pow(r, max(falloff, 0.0)) : (falloff <= 0.0 ? amount : 0.0); }
  float axial = geom > 0.5 && geom < 1.5 ? 1.0 : 0.0;
  float n = mode > 0.5 ? 3.0 : clamp(floor(samples + 0.5), ${fl(CA_MIN_TAPS)}, ${fl(CA_MAX_TAPS)});
  float S = (blur > 0.0 || axial > 0.5) ? ${fl(CA_SUB)} : 1.0;
  // Distortion: each colour scaled about the centre by 1 + this × its shift.
  float bend = distortion * ${fl(CA_DIST)} * r * r;
  vec2 d0 = uv - c;
  vec2 rot = vec2(cos(jit * 6.28318), sin(jit * 6.28318));
  const mat2 GOLD = mat2(-0.73736, 0.67549, -0.67549, -0.73736);
  vec4 acc = vec4(0.0);
  vec4 ws = vec4(0.0);
  for (int i = 0; i < ${CA_MAX_TAPS}; i++) {
    if (float(i) >= n) break;
    // A tap that barely blurs (green, or near the centre) is read once.
    float shc = mode > 0.5 ? 1.0 - float(i) : (1.0 - 2.0 * (float(i) + 0.5) / n) * ${CA_SPREAD.toFixed(6)};
    float Si = max(blur, 0.0) * abs(mag * shc) + axial * abs(amount * shc) > 0.5 ? S : 1.0;
    for (int k = 0; k < ${CA_SUB}; k++) {
      if (float(k) >= Si) break;
      float sh;
      vec3 w;
      if (mode > 0.5) {
        sh = shc;
        w = i == 0 ? vec3(1.0, 0.0, 0.0) : (i == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
      } else {
        // This tap's wavelength, jittered inside its slice of the spectrum (and stratified across its reads).
        float t = (float(i) + (float(k) + jit) / Si) / n;
        sh = (1.0 - 2.0 * t) * ${CA_SPREAD.toFixed(6)};
        w = caSpec(t);
      }
      vec2 off = dir * (mag * sh);
      if (Si > 1.0) {
        // Dispersion blur: a disc of Blur × the shift (and Axial's defocus), turned per pixel (golden-angle steps).
        rot = GOLD * rot;
        off += rot * ((max(blur, 0.0) * abs(mag * sh) + axial * abs(amount * sh)) * sqrt((float(k) + 0.5) / Si));
      }
      vec4 v = ${rd('c + d0 * (1.0 + bend * sh) + off * texel')};
      acc += vec4(v.rgb * w, v.a * (w.r + w.g + w.b));
      ws += vec4(w, w.r + w.g + w.b);
    }
  }
  return acc / max(ws, vec4(1e-5));
}
`;
}

/** The Studio's read (GLSL ES 1.00, texture2D), one string so a program that has it twice declares it once. */
export const CA_GLSL2 = caGlsl('texture2D');
