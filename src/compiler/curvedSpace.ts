/**
 * Curved-space marching shared by March Loop Group and GI Lit March Group (docs/curved-space.md).
 *
 * A loop with no `curvature` param compiles exactly as before: `ro + t * rd`, the old step and the old end.
 * With the param (a live uniform), the ray's position is read off a geodesic of constant curvature k:
 * `ro + rd * sin(√k·t)/√k` (sphere) or `sinh` (hyperbolic), t being true distance along the geodesic.
 * k within ±1e-4 of 0 is the plain straight ray.
 */

export const CURVED_RAY_GLSL = `vec3 curvedRayPos(vec3 ro, vec3 rd, float t, float k) {
    if (abs(k) < 1e-4) return ro + t * rd;
    float a = sqrt(abs(k));
    float phi = a * t;
    float s = k > 0.0 ? sin(phi) : sinh(min(phi, 30.0));
    return ro + rd * (s / a);
}`;

export const CURVED_STEP_GLSL = `float curvedStep(float t, float k) {
    if (k >= 0.0) return 1.0;
    return 1.0 / cosh(min(sqrt(-k) * t, 30.0));
}`;

export const CURVED_END_GLSL = `float curvedEnd(float k, float maxDist) {
    if (k >= -1e-8) return maxDist;
    float a = sqrt(-k);
    float x = a * maxDist;
    return min(maxDist, log(x + sqrt(x * x + 1.0)) / a);
}`;

export interface CurvedMarch {
  /** Declarations to put before the loop ('' when the loop has no curvature). */
  decl: string;
  /** The ray's position at distance `t`. */
  at: (t: string) => string;
  /** Appended to the step: ` * curvedStep(t, k)` or ''. */
  stepFactor: (t: string) => string;
  /** The distance at which the loop gives up. */
  end: string;
}

/** `curvature` is the loop's (uniform-patched) param, or undefined for an ordinary loop. */
export function curvedMarch(slug: string, curvature: unknown, ro: string, rd: string, maxDist: string, addFunction: (fn: string) => void): CurvedMarch {
  if (curvature === undefined || curvature === null) {
    return { decl: '', at: t => `${ro} + ${t} * ${rd}`, stepFactor: () => '', end: maxDist };
  }
  addFunction(CURVED_RAY_GLSL); addFunction(CURVED_STEP_GLSL); addFunction(CURVED_END_GLSL);
  const k = typeof curvature === 'string' ? curvature : Number.isInteger(Number(curvature)) ? `${Number(curvature)}.0` : String(Number(curvature));
  return {
    decl: `    float ${slug}_k = ${k};\n    float ${slug}_tEnd = curvedEnd(${slug}_k, ${maxDist});\n`,
    at: t => `curvedRayPos(${ro}, ${rd}, ${t}, ${slug}_k)`,
    stepFactor: t => ` * curvedStep(${t}, ${slug}_k)`,
    end: `${slug}_tEnd`,
  };
}
