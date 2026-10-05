/**
 * Ray-march banding fixes shared by March Loop Group and GI Lit March Group.
 *
 * Jitter: every pixel's ray starts a little way along, by a different amount,
 * so the steps of neighbouring rays don't line up into contour rings. The old
 * jitter (kept for graphs saved with it) hashed the ray direction with a sine
 * hash; new loops use interleaved gradient noise (Jimenez 2014), a screen-space
 * pattern that spreads its values evenly over every small block of pixels, so
 * the leftover noise is fine-grained and reads as smooth after the dither.
 *
 * Which one a loop gets is `jitterNoise`: 'even' (new loops) or anything else /
 * missing (saved graphs, which compile byte for byte as before).
 *
 * Per distance: a `perDistance` accumulator in a volumetric loop body is
 * weighted by the length of the step the ray takes from this point (see
 * stepWeightGlsl), so its sum follows the length of ray covered instead of
 * the number of steps.
 */

/** Interleaved gradient noise: 0..1, evenly spread over any small block of pixels. */
export const MARCH_IGN_GLSL = `float marchIGN(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}`;

/** The same function in JS (for tests). */
export function marchIGN(x: number, y: number): number {
  const fract = (v: number) => v - Math.floor(v);
  return fract(52.9829189 * fract(x * 0.06711056 + y * 0.00583715));
}

/** The golden-ratio frame offset Jimenez uses to animate IGN over time (64 frames, then it repeats). */
export const IGN_FRAME_OFFSET = 5.588238;

export interface MarchJitterOpts {
  slug: string;
  /** The loop's own params (raw, not uniform-patched): jitterNoise, animateJitter. */
  params: Record<string, unknown>;
  /** The jitter amount as GLSL (literal or uniform). */
  jitter: string;
  ro: string;
  rd: string;
  maxDist: string;
  maxSteps: number;
  volumetric: boolean;
  passthrough: string;
  addFunction: (fn: string) => void;
}

/** True for loops made since the even jitter (and Per distance) came in. */
export function usesEvenJitter(params: Record<string, unknown>): boolean {
  return params.jitterNoise === 'even';
}

/** The declaration of `<slug>_t`, the ray's start distance, with the loop's jitter. */
export function marchJitterDecl(o: MarchJitterOpts): string {
  const { slug, jitter } = o;
  if (!usesEvenJitter(o.params)) {
    // The old jitter, unchanged (saved graphs compile byte for byte as before).
    return jitter !== '0.0'
      ? `    float ${slug}_jh = fract(sin(dot(${o.ro}.xy + ${o.rd}.xy, vec2(127.1, 311.7))) * 43758.5453);\n`
      + `    float ${slug}_t   = 0.001 + ${jitter} * ${slug}_jh * (${o.maxDist} / float(${o.maxSteps}));\n`
      : `    float ${slug}_t   = 0.001;\n`;
  }
  if (jitter === '0.0') return `    float ${slug}_t   = 0.001;\n`;
  o.addFunction(MARCH_IGN_GLSL);
  const px = o.params.animateJitter === true
    ? `gl_FragCoord.xy + ${IGN_FRAME_OFFSET} * mod(floor(u_time * 60.0), 64.0)`
    : 'gl_FragCoord.xy';
  // One step's width: inside a volume the ray moves by Passthrough, so that is the spacing
  // to spread; a surface march (or Passthrough 0) uses the average step, as the old jitter did.
  const width = o.volumetric
    ? `(${o.passthrough} > 0.0 ? ${o.passthrough} : ${o.maxDist} / float(${o.maxSteps}))`
    : `(${o.maxDist} / float(${o.maxSteps}))`;
  return `    float ${slug}_jh = marchIGN(${px});\n`
    + `    float ${slug}_t   = 0.001 + ${jitter} * ${slug}_jh * ${width};\n`;
}

/**
 * The input key the compiler fills, for a `perDistance` node in a volumetric
 * loop body, with the loop's Passthrough (its shortest step).
 */
export const MARCH_STEP_REF_KEY = '__marchPassthrough';

/**
 * The ray length one step's worth of glow stands for, with Per distance on:
 * the default Passthrough. A loop at Passthrough 0.1 glows as bright inside a
 * shape as it did counting steps, and changing Passthrough changes how finely
 * the glow is sampled, not how bright it is.
 */
export const GLOW_UNIT_LENGTH = 0.1;

/**
 * GLSL for the Per distance weight of a sample whose scene distance is `d`:
 * the step the ray takes from here, max(d, Passthrough), in units of
 * GLOW_UNIT_LENGTH, so the sum follows the length of ray covered instead of
 * the number of steps.
 *
 * The weight stops growing once the sample is more than 1 / falloff from the
 * surface. Out there the glow is under half its peak and, sampled once per
 * long SDF step, its 1/d tail times the step length is about the same for
 * every step: weighting those steps in full would mostly brighten the whole
 * background. Capped, the glow near the shapes is integrated along the ray
 * and the far field keeps roughly its old brightness.
 */
export function stepWeightGlsl(d: string, passthrough: string, falloff: string): string {
  const r = `max(${passthrough}, 0.001)`;
  return `(clamp(${d}, ${r}, ${r} + 1.0 / max(${falloff}, 0.001)) * ${(1 / GLOW_UNIT_LENGTH).toFixed(1)})`;
}

/** The same weight in JS (for tests). */
export function stepWeight(d: number, passthrough: number, falloff: number): number {
  const r = Math.max(passthrough, 0.001);
  return Math.min(Math.max(d, r), r + 1 / Math.max(falloff, 0.001)) / GLOW_UNIT_LENGTH;
}
