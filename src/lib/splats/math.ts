/**
 * math.ts — the splatting maths in plain JS (docs/splat-scene.md "How it draws"). The vertex shader (render.ts) does
 * the same per splat; the tests check these against hand-worked values.
 *
 * Kerbl et al. 2023 (3D Gaussian Splatting), after Zwicker et al. 2001 (EWA splatting):
 *  - a splat's 3D covariance is Σ = R S Sᵀ Rᵀ, R its rotation, S its scales on the diagonal;
 *  - placed in the world by a model matrix's linear part M: Σw = M Σ Mᵀ;
 *  - seen by a camera with axes right, up, forward (rows of W) and lens f (the March Camera's FOV: a ray through the
 *    picture point g_uv is normalize(g_uv.x · right + g_uv.y · up + f · forward)), the point t = W (p − eye) lands at
 *    g_uv = f · (t.x, t.y) / t.z;
 *  - the projection's Jacobian there, J = f · [[1/z, 0, −x/z²], [0, 1/z, −y/z²]], gives the screen covariance
 *    Σ2 = J W Σw Wᵀ Jᵀ, in g_uv units; times (H / 2)² in pixels, plus 0.3 px² so no splat is thinner than a pixel;
 *  - its eigenvalues λ1 ≥ λ2 and eigenvectors are the ellipse's axes; the quad reaches √(2λ) along each, and the
 *    fragment's weight is exp(−|v|²) for v in [−2, 2]² (exp(−4) at the edge: past 2.8 σ nothing shows).
 *
 * Distance (for compositing with ray-marched scenes): |p − eye|, the same as the March Loop's Distance along a
 * normalised ray.
 */

export type Vec3 = [number, number, number];
/** Row-major 3 × 3 (9 numbers). */
export type Mat3 = number[];

/** The rotation matrix of a unit quaternion (w, x, y, z), row-major. */
export function quatToMat3(w: number, x: number, y: number, z: number): Mat3 {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

export const mul3 = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
export const transpose3 = (a: Mat3): Mat3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];

/** Σ = R S Sᵀ Rᵀ as its six numbers: xx, xy, xz, yy, yz, zz. */
export function covariance3d(scale: Vec3, quat: [number, number, number, number]): [number, number, number, number, number, number] {
  const R = quatToMat3(quat[0], quat[1], quat[2], quat[3]);
  // M = R S: column k of R times scale k.
  const M = [0, 1, 2].flatMap(r => [R[r * 3] * scale[0], R[r * 3 + 1] * scale[1], R[r * 3 + 2] * scale[2]]);
  const S = mul3(M, transpose3(M));
  return [S[0], S[1], S[2], S[4], S[5], S[8]];
}

export const covToMat3 = (c: readonly number[]): Mat3 => [c[0], c[1], c[2], c[1], c[3], c[4], c[2], c[4], c[5]];

/** The camera the vertex shader rebuilds from the probe: its eye, axes, and lens per axis (f along x and y). */
export interface SplatCamera { eye: Vec3; right: Vec3; up: Vec3; forward: Vec3; fx: number; fy: number }

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: readonly number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: readonly number[]): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * The camera from the probe's four readings (as the vertex shader does): the eye; the ray at the picture's centre
 * (forward); the rays half a picture-height right (g_uv (0.5, 0)) and up (0, 0.5). A pinhole ray at (u, 0) is
 * ∝ u · right + f · forward, so right is the part across forward and f = u · (along) / (across).
 */
export function cameraFromProbe(eye: Vec3, center: Vec3, rx: Vec3, ry: Vec3): SplatCamera {
  const forward = nrm(center);
  const ax = dot(rx, forward), px = sub(rx, scl(forward, ax));
  const ay = dot(ry, forward), py = sub(ry, scl(forward, ay));
  const lx = len(px), ly = len(py);
  return {
    eye, forward,
    right: lx > 1e-9 ? scl(px, 1 / lx) : [1, 0, 0],
    up: ly > 1e-9 ? scl(py, 1 / ly) : [0, 1, 0],
    fx: lx > 1e-9 ? 0.5 * ax / lx : 1.5,
    fy: ly > 1e-9 ? 0.5 * ay / ly : 1.5,
  };
}

/** The March Camera's camera for its sliders (scene3d.ts MarchCameraNode, pinhole, no flatten): for tests and the CPU. */
export function marchCamera(o: { camDist?: number; camAngle?: number; camElevation?: number; fov?: number; target?: Vec3; time?: number; rotSpeed?: number } = {}): SplatCamera {
  const dist = o.camDist ?? 3, ang = (o.camAngle ?? 0.6) + (o.time ?? 0) * (o.rotSpeed ?? 0), elev = o.camElevation ?? 0.3, fov = o.fov ?? 1.5;
  const ta = o.target ?? [0, 0, 0];
  const horiz: Vec3 = [Math.sin(ang), 0, Math.cos(ang)];
  const eye: Vec3 = [ta[0] + dist * Math.cos(elev) * horiz[0], ta[1] + dist * Math.sin(elev), ta[2] + dist * Math.cos(elev) * horiz[2]];
  const forward = nrm(sub(ta, eye));
  const cup = nrm([-Math.sin(elev) * horiz[0], Math.cos(elev), -Math.sin(elev) * horiz[2]]);
  // right = cross(cup, forward); up = cross(forward, right)
  const right = nrm([cup[1] * forward[2] - cup[2] * forward[1], cup[2] * forward[0] - cup[0] * forward[2], cup[0] * forward[1] - cup[1] * forward[0]]);
  const up: Vec3 = [forward[1] * right[2] - forward[2] * right[1], forward[2] * right[0] - forward[0] * right[2], forward[0] * right[1] - forward[1] * right[0]];
  return { eye, right, up, forward, fx: fov, fy: fov };
}

/** The camera's ray through picture point g_uv (as the March Camera makes it). */
export function cameraRay(cam: SplatCamera, u: number, v: number): Vec3 {
  return nrm([0, 1, 2].map(k => u * cam.right[k] + v * cam.up[k] + cam.fx * cam.forward[k]) as Vec3);
}

export interface Projected {
  /** Picture point (g_uv: y −1…1, x scaled by the aspect). */
  uv: [number, number];
  /** Camera-space depth along forward. */
  z: number;
  /** Distance from the eye (the March Loop's Distance). */
  dist: number;
  /** Screen covariance in pixels: a, b, c of [[a, b], [b, c]], with the 0.3 px² low-pass. */
  cov2: [number, number, number];
  /** Ellipse axes in pixels (√(2λ) along each eigenvector), major then minor. */
  major: [number, number];
  minor: [number, number];
}

/**
 * One splat through a camera: its picture point, distance and screen ellipse (pixels of a picture `heightPx` tall).
 * `cov` is its world covariance (six numbers). Null behind the camera (z < near).
 */
export function projectSplat(center: Vec3, cov: readonly number[], cam: SplatCamera, heightPx: number, near = 0.05): Projected | null {
  const t = sub(center, cam.eye);
  const x = dot(t, cam.right), y = dot(t, cam.up), z = dot(t, cam.forward);
  if (z < near) return null;
  const k = heightPx / 2;
  // Rows of J W (pixels): J = k f [[1/z, 0, −x/z²], [0, 1/z, −y/z²]] times W (rows right, up, forward).
  const j0 = [0, 1, 2].map(i => k * cam.fx * (cam.right[i] / z - x * cam.forward[i] / (z * z)));
  const j1 = [0, 1, 2].map(i => k * cam.fy * (cam.up[i] / z - y * cam.forward[i] / (z * z)));
  const S = covToMat3(cov);
  const Sj0 = [0, 1, 2].map(r => S[r * 3] * j0[0] + S[r * 3 + 1] * j0[1] + S[r * 3 + 2] * j0[2]);
  const Sj1 = [0, 1, 2].map(r => S[r * 3] * j1[0] + S[r * 3 + 1] * j1[1] + S[r * 3 + 2] * j1[2]);
  const a = dot(j0, Sj0) + 0.3, b = dot(j0, Sj1), c = dot(j1, Sj1) + 0.3;
  const { major, minor } = ellipseAxes(a, b, c);
  return { uv: [cam.fx * x / z, cam.fy * y / z], z, dist: len(t), cov2: [a, b, c], major, minor };
}

/** The ellipse of a 2 × 2 covariance [[a, b], [b, c]]: √(2λ) along each eigenvector, capped at 1024 px. */
export function ellipseAxes(a: number, b: number, c: number): { major: [number, number]; minor: [number, number]; l1: number; l2: number } {
  const mid = 0.5 * (a + c), rad = Math.hypot(0.5 * (a - c), b);
  const l1 = mid + rad, l2 = Math.max(mid - rad, 0.1);
  let v: [number, number] = [b, l1 - a];
  const vl = Math.hypot(v[0], v[1]);
  v = vl > 1e-12 ? [v[0] / vl, v[1] / vl] : a >= c ? [1, 0] : [0, 1];
  const m1 = Math.min(Math.sqrt(2 * l1), 1024), m2 = Math.min(Math.sqrt(2 * l2), 1024);
  return { major: [v[0] * m1, v[1] * m1], minor: [v[1] * m2, -v[0] * m2], l1, l2 };
}

/** The splat's weight at a pixel offset `d` (pixels) from its centre: the fragment shader's exp(−|v|²), 0 past the quad. */
export function splatWeight(p: Projected, d: [number, number]): number {
  // v in the quad's own coordinates: d = v.x · major + v.y · minor (orthogonal axes).
  const m1 = p.major[0] * p.major[0] + p.major[1] * p.major[1], m2 = p.minor[0] * p.minor[0] + p.minor[1] * p.minor[1];
  const vx = (d[0] * p.major[0] + d[1] * p.major[1]) / m1, vy = (d[0] * p.minor[0] + d[1] * p.minor[1]) / m2;
  const q = vx * vx + vy * vy;
  return q > 4 ? 0 : Math.exp(-q);
}

// ── The model transform (the node's Position / Rotation / Scale) ─────────────

/**
 * The node's placement as a column-major 4 × 4 (WebGL's order): T · R · S · F, where R turns by Rotation X, then Y,
 * then Z (degrees, the Transform node's order: docs/transform-node.md), S is the uniform Scale, and F turns a scan
 * upside down (y and z flipped: "right, down, forward" scans the right way up) when `flip` is on. With a `pivot` (a
 * point in the scan's own coordinates, its middle for a Splat Scene that turns about it), the scan turns and scales
 * about that point and Position is where it lands: T · R · S · F · (p − pivot).
 */
export function modelMatrix(o: { position?: Vec3; rotation?: Vec3; scale?: number; flip?: boolean; pivot?: Vec3 }): number[] {
  const [px, py, pz] = o.position ?? [0, 0, 0];
  const [rx, ry, rz] = (o.rotation ?? [0, 0, 0]).map(d => (d * Math.PI) / 180);
  const s = o.scale ?? 1;
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const Rx: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz: Mat3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  // X first, then Y, then Z: R = Rz · Ry · Rx.
  let L = mul3(Rz, mul3(Ry, Rx));
  if (o.flip) L = mul3(L, [1, 0, 0, 0, -1, 0, 0, 0, -1]);
  L = L.map(v => v * s);
  const [qx, qy, qz] = o.pivot ?? [0, 0, 0];
  const tx = px - (L[0] * qx + L[1] * qy + L[2] * qz), ty = py - (L[3] * qx + L[4] * qy + L[5] * qz), tz = pz - (L[6] * qx + L[7] * qy + L[8] * qz);
  return [L[0], L[3], L[6], 0, L[1], L[4], L[7], 0, L[2], L[5], L[8], 0, tx, ty, tz, 1];
}

/**
 * The splat shader's cull (shaders.ts): a splat is skipped only when its whole quad (the centre ± its ellipse's reach,
 * the quad spanning ±2 along major and minor, in pixels) lies off the picture. Culling by the centre alone (it used
 * to skip any centre past 1.3 × the picture's half-size) cut big splats off at the edges of a turning scan.
 * `ndc` is the centre in −1…1, `major` / `minor` the ellipse's axes in pixels, `view` the picture's size in pixels.
 */
export function splatOffscreen(ndc: readonly [number, number], major: readonly [number, number], minor: readonly [number, number], view: readonly [number, number]): boolean {
  const ex = 4 * (Math.abs(major[0]) + Math.abs(minor[0])) / view[0];
  const ey = 4 * (Math.abs(major[1]) + Math.abs(minor[1])) / view[1];
  return Math.abs(ndc[0]) - ex > 1 || Math.abs(ndc[1]) - ey > 1;
}

/** A point through a column-major 4 × 4. */
export const applyModel = (m: readonly number[], p: readonly number[]): Vec3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/** Σw = M Σ Mᵀ for the model's linear part (six numbers in, six out). */
export function transformCov(m: readonly number[], cov: readonly number[]): number[] {
  const M: Mat3 = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const S = mul3(mul3(M, covToMat3(cov)), transpose3(M));
  return [S[0], S[1], S[2], S[4], S[5], S[8]];
}

/**
 * The sort's direction in the scan's own space: a splat's depth along the camera's forward is
 * dot(M p + T − eye, forward) = dot(p, Mᵀ forward) + const, so the worker sorts by dot(p, Mᵀ forward).
 */
export function sortAxis(m: readonly number[], forward: readonly number[]): Vec3 {
  return [
    m[0] * forward[0] + m[1] * forward[1] + m[2] * forward[2],
    m[4] * forward[0] + m[5] * forward[1] + m[6] * forward[2],
    m[8] * forward[0] + m[9] * forward[1] + m[10] * forward[2],
  ];
}

/**
 * Where the eye is in the scan's own space (for sorting by distance from it rather than along forward, which is what a
 * wide lens wants): M⁻¹ (eye − T).
 */
export function eyeInModel(m: readonly number[], eye: readonly number[]): Vec3 {
  const M: Mat3 = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const inv = invert3(M);
  const d = [eye[0] - m[12], eye[1] - m[13], eye[2] - m[14]];
  return [0, 1, 2].map(r => inv[r * 3] * d[0] + inv[r * 3 + 1] * d[1] + inv[r * 3 + 2] * d[2]) as Vec3;
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-20) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const r = 1 / det;
  return [A * r, -(b * i - c * h) * r, (b * f - c * e) * r, B * r, (a * i - c * g) * r, -(a * f - c * d) * r, C * r, -(a * h - b * g) * r, (a * e - b * d) * r];
}
