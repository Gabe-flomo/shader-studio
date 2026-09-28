/**
 * warp.ts — the maths of projection mapping (no DOM, no GL): the homography a
 * corner pin makes, the mesh warp inside it, the triangles the output draws
 * and hit tests for editing.
 *
 * A surface point (u, v) goes: mesh (u, v) → m in the corner pin's square →
 * H·m in output space. H is the 3 × 3 homography taking the unit square to
 * the four corners; drawing each vertex at clip (X, Y, 0, W) straight from
 * H's homogeneous result lets the GPU interpolate perspective-correctly, so a
 * plain corner pin is exact with two triangles.
 */
import type { ProjMesh, ProjPoint, ProjQuad, ProjSurface } from '../types/projection';

/** Row-major 3 × 3: [a, b, c, d, e, f, g, h, i] maps (x, y, 1) to (a x + b y + c, d x + e y + f, g x + h y + i). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The homography taking the unit square's corners (0,0) (1,0) (1,1) (0,1) to q's (Heckbert's closed form). */
export function squareToQuad(q: ProjQuad): Mat3 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    // A parallelogram: affine.
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-12) return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

/** The inverse, or null when the matrix is singular (a corner pin folded flat). */
export function invert(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** (X, Y, W) = m · (x, y, 1). */
export function applyHomog(m: Mat3, x: number, y: number): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5], m[6] * x + m[7] * y + m[8]];
}

export function apply(m: Mat3, x: number, y: number): ProjPoint {
  const [X, Y, W] = applyHomog(m, x, y);
  return { x: X / W, y: Y / W };
}

/** The homography taking quad `from` to quad `to` (four point pairs). Null when `from` is degenerate. */
export function quadToQuad(from: ProjQuad, to: ProjQuad): Mat3 | null {
  const inv = invert(squareToQuad(from));
  return inv ? multiply(squareToQuad(to), inv) : null;
}

/** A corner pin the GPU can draw: convex, corners in order (no bow tie). */
export function isConvexQuad(q: ProjQuad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-12) return false;
    const s = Math.sign(z);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

// ── Mesh warp ───────────────────────────────────────────────────────────────

/** Catmull-Rom through p1..p2 (t 0..1) with neighbours p0, p3. */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Where surface point (u, v) lands in the corner pin's square. Linear:
 * bilinear inside each cell. Smooth: a Catmull-Rom surface through every
 * point, the edges extended straight (ghost points mirrored linearly) so an
 * even grid stays exactly the identity.
 */
export function meshEval(mesh: Pick<ProjMesh, 'cols' | 'rows' | 'points' | 'interp'>, u: number, v: number): ProjPoint {
  const { cols, rows, points } = mesh;
  const fx = Math.max(0, Math.min(1, u)) * (cols - 1), fy = Math.max(0, Math.min(1, v)) * (rows - 1);
  const i = Math.min(cols - 2, Math.floor(fx)), j = Math.min(rows - 2, Math.floor(fy));
  const s = fx - i, t = fy - j;
  if (mesh.interp === 'linear') {
    const p00 = points[j * cols + i], p10 = points[j * cols + i + 1], p01 = points[(j + 1) * cols + i], p11 = points[(j + 1) * cols + i + 1];
    return {
      x: (1 - t) * ((1 - s) * p00.x + s * p10.x) + t * ((1 - s) * p01.x + s * p11.x),
      y: (1 - t) * ((1 - s) * p00.y + s * p10.y) + t * ((1 - s) * p01.y + s * p11.y),
    };
  }
  // A point with ghosts past the edges: P[-1] = 2 P[0] − P[1], P[n] = 2 P[n−1] − P[n−2].
  const at = (ii: number, jj: number): ProjPoint => {
    if (ii < 0) { const a = at(0, jj), b = at(1, jj); return { x: 2 * a.x - b.x, y: 2 * a.y - b.y }; }
    if (ii > cols - 1) { const a = at(cols - 1, jj), b = at(cols - 2, jj); return { x: 2 * a.x - b.x, y: 2 * a.y - b.y }; }
    if (jj < 0) { const a = at(ii, 0), b = at(ii, 1); return { x: 2 * a.x - b.x, y: 2 * a.y - b.y }; }
    if (jj > rows - 1) { const a = at(ii, rows - 1), b = at(ii, rows - 2); return { x: 2 * a.x - b.x, y: 2 * a.y - b.y }; }
    return points[jj * cols + ii];
  };
  const col = (jj: number): ProjPoint => {
    const a = at(i - 1, jj), b = at(i, jj), c = at(i + 1, jj), d = at(i + 2, jj);
    return { x: cr(a.x, b.x, c.x, d.x, s), y: cr(a.y, b.y, c.y, d.y, s) };
  };
  const r0 = col(j - 1), r1 = col(j), r2 = col(j + 1), r3 = col(j + 2);
  return { x: cr(r0.x, r1.x, r2.x, r3.x, t), y: cr(r0.y, r1.y, r2.y, r3.y, t) };
}

/** Surface point (u, v) → output space (mesh, then the corner pin). */
export function surfacePoint(s: Pick<ProjSurface, 'corners' | 'mesh'>, u: number, v: number, H = squareToQuad(s.corners)): ProjPoint {
  const m = s.mesh.on ? meshEval(s.mesh, u, v) : { x: u, y: v };
  return apply(H, m.x, m.y);
}

// ── Triangles for the GPU ───────────────────────────────────────────────────

export interface SurfaceGeometry {
  /** Per vertex: clip x, clip y, clip w (homogeneous, perspective-correct), then surface u, v. */
  vertices: Float32Array;
  indices: Uint16Array;
}

/** Subdivisions per mesh cell: enough that a smooth mesh looks smooth on a big screen. */
export const MESH_SUBDIV = 12;

/**
 * A surface as triangles. A plain corner pin: one quad (exact, the GPU's
 * perspective division does the rest). A mesh: each cell cut into
 * MESH_SUBDIV² quads, each still perspective-correct under the corner pin.
 */
export function surfaceGeometry(s: Pick<ProjSurface, 'corners' | 'mesh'>): SurfaceGeometry {
  let H = squareToQuad(s.corners);
  // H is defined up to scale: keep W positive inside the square so nothing is clipped away.
  if (applyHomog(H, 0.5, 0.5)[2] < 0) H = H.map(v => -v) as Mat3;
  const nx = s.mesh.on ? (s.mesh.cols - 1) * MESH_SUBDIV : 1;
  const ny = s.mesh.on ? (s.mesh.rows - 1) * MESH_SUBDIV : 1;
  const vertices = new Float32Array((nx + 1) * (ny + 1) * 5);
  let k = 0;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny;
      const m = s.mesh.on ? meshEval(s.mesh, u, v) : { x: u, y: v };
      const [X, Y, W] = applyHomog(H, m.x, m.y);
      // Output space (0..1, y down) → clip space, kept homogeneous: ndc = (2X/W − 1, 1 − 2Y/W).
      vertices[k++] = 2 * X - W;
      vertices[k++] = W - 2 * Y;
      vertices[k++] = W;
      vertices[k++] = u;
      vertices[k++] = v;
    }
  }
  const indices = new Uint16Array(nx * ny * 6);
  k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = d;
      indices[k++] = a; indices[k++] = d; indices[k++] = c;
    }
  }
  return { vertices, indices };
}

// ── Edge blend (the same curve as the shader, for tests and the editor) ─────

/**
 * How much of the picture stays at distance `d` (0..1 of the surface) from an
 * edge feathered over `width`: an S-shaped ramp (`curve` 1 straight, 2 the
 * usual S), corrected for the projector's `gamma` so two overlapping ramps
 * add up to even light.
 */
export function blendRamp(d: number, width: number, curve: number, gamma: number): number {
  if (width <= 0) return 1;
  const x = Math.max(0, Math.min(1, d / width));
  const s = x < 0.5 ? 0.5 * Math.pow(2 * x, curve) : 1 - 0.5 * Math.pow(2 * (1 - x), curve);
  return Math.pow(s, 1 / gamma);
}

// ── Hit tests ───────────────────────────────────────────────────────────────

export function pointInPolygon(pts: readonly ProjPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Output point → where it is inside the surface's corner pin square (the inverse of the pin), or null. */
export function outputToSquare(corners: ProjQuad, x: number, y: number): ProjPoint | null {
  const inv = invert(squareToQuad(corners));
  return inv ? apply(inv, x, y) : null;
}
