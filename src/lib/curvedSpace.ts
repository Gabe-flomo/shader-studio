/**
 * curvedSpace.ts — the maths of curved viewing (docs/curved-space.md), on the CPU.
 *
 * It mirrors what the shader does so the tests can check it:
 *
 *  - Space curvature: a ray leaves the camera along a geodesic of a space of constant curvature k
 *    (S³ for k > 0, H³ for k < 0). Position in 4D: Q(t) = cos(φ)·q + sin(φ)·V (sphere) or
 *    cosh(φ)·q + sinh(φ)·V (hyperboloid), φ = √|k|·t, q the camera, V the unit direction.
 *    The scene is read through the "embedding chart": the spatial part of Q, divided by √|k|.
 *    Seen from the camera that is `ro + rd · sin(φ)/√k` (sphere) or `ro + rd · sinh(φ)/√|k|`.
 *
 *  - Reverse perspective: rays start spread across the image plane and head for a point `dist` in
 *    front of the camera, so lateral offset shrinks with depth and objects farther away look bigger.
 */

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

const EPS_K = 1e-4;

/** One geodesic step in the 4D embedding. k > 0: unit 4-vectors on S³. k < 0: points on the hyperboloid −w² + x² + y² + z² = −1. */
export function geodesic4(q: Vec4, v: Vec4, t: number, k: number): Vec4 {
  if (Math.abs(k) < EPS_K) return [q[0] + t * v[0], q[1] + t * v[1], q[2] + t * v[2], q[3] + t * v[3]];
  const a = Math.sqrt(Math.abs(k));
  const phi = a * t;
  const c = k > 0 ? Math.cos(phi) : Math.cosh(phi);
  const s = k > 0 ? Math.sin(phi) : Math.sinh(phi);
  return [c * q[0] + s * v[0], c * q[1] + s * v[1], c * q[2] + s * v[2], c * q[3] + s * v[3]];
}

/** The 4D camera point and its direction: q = (1, 0, 0, 0) (w first), V = (0, rd). */
export function cameraFrame4(rd: Vec3): { q: Vec4; v: Vec4 } {
  return { q: [1, 0, 0, 0], v: [0, rd[0], rd[1], rd[2]] };
}

/** Length of a 4D point: Euclidean for the sphere, the Minkowski form (w² − x² − y² − z²) for the hyperboloid (1 for both on their surface). */
export function norm4(q: Vec4, k: number): number {
  const sp = q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  return k >= 0 ? Math.sqrt(q[0] * q[0] + sp) : Math.sqrt(Math.max(q[0] * q[0] - sp, 0));
}

/** The scene point at distance t along the ray: what the march loop evaluates the scene at. Mirrors `curvedRayPos` in the shader. */
export function curvedRayPos(ro: Vec3, rd: Vec3, t: number, k: number): Vec3 {
  if (Math.abs(k) < EPS_K) return [ro[0] + t * rd[0], ro[1] + t * rd[1], ro[2] + t * rd[2]];
  const a = Math.sqrt(Math.abs(k));
  const phi = a * t;
  const s = (k > 0 ? Math.sin(phi) : Math.sinh(Math.min(phi, 30))) / a;
  return [ro[0] + s * rd[0], ro[1] + s * rd[1], ro[2] + s * rd[2]];
}

/** The same point read from the 4D geodesic (spatial part of Q over √|k|): must equal curvedRayPos. */
export function curvedRayPosVia4D(ro: Vec3, rd: Vec3, t: number, k: number): Vec3 {
  const { q, v } = cameraFrame4(rd);
  const Q = geodesic4(q, v, t, k);
  const a = Math.sqrt(Math.abs(k));
  return [ro[0] + Q[1] / a, ro[1] + Q[2] / a, ro[2] + Q[3] / a];
}

/** How far along the ray (true distance) the antipode of the camera is: π/√k. */
export function antipodeDistance(k: number): number {
  return k > 0 ? Math.PI / Math.sqrt(k) : Infinity;
}

/** The march step per unit of scene distance (mirrors `curvedStep`): 1/cosh for hyperbolic space, 1 otherwise. */
export function curvedStepFactor(t: number, k: number): number {
  if (k >= 0) return 1;
  return 1 / Math.cosh(Math.min(Math.sqrt(-k) * t, 30));
}

/** The ray distance at which the scene distance reaches `maxDist` (mirrors `curvedEnd`). */
export function curvedEnd(k: number, maxDist: number): number {
  if (k >= -1e-8) return maxDist;
  const a = Math.sqrt(-k);
  return Math.min(maxDist, Math.asinh(a * maxDist) / a);
}

/**
 * Reverse perspective: origin and direction of the ray through image point (u, v).
 * The camera looks along `fwd`, with `right` and `up` completing the frame; `camDist` is the distance to the
 * look-at target (the plane that keeps its size), `fov` the lens, `dist` where the rays converge (at strength 1).
 * Lateral offset at depth z is O·(1 − strength·z/dist); it is 0 at z = dist/strength.
 */
export function reverseRay(
  ro0: Vec3, fwd: Vec3, right: Vec3, up: Vec3,
  u: number, v: number, camDist: number, fov: number, dist: number, strength: number,
): { ro: Vec3; rd: Vec3 } {
  const a = Math.min(Math.max(strength, 0), 1);
  const D = Math.max(dist, 0.1);
  const den = Math.max(1 - a * camDist / D, 0.2);
  const s = camDist / Math.max(fov, 0.05) / den;
  const lat: Vec3 = [u * right[0] + v * up[0], u * right[1] + v * up[1], u * right[2] + v * up[2]];
  const ro: Vec3 = [ro0[0] + s * lat[0], ro0[1] + s * lat[1], ro0[2] + s * lat[2]];
  const d: Vec3 = [D * fwd[0] - a * s * lat[0], D * fwd[1] - a * s * lat[1], D * fwd[2] - a * s * lat[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  return { ro, rd: [d[0] / len, d[1] / len, d[2] / len] };
}
