/**
 * viewMath.ts — the 3D Scene Builder's viewport on the CPU (docs/scene-builder-3d.md, "The viewport"):
 * the March Camera's own maths (scene3d.ts marchCamera: orbit, target, zoom, Flatten), so a point
 * can be put on the picture and a pixel turned back into a ray; picking a shape under the pointer
 * (each shape's distance from thumbnails.ts, placed as the build places it); and what a gizmo drag
 * writes (a move in the picture's plane or along one axis, a uniform size).
 *
 * Pure: no DOM, no store. The viewport (components/sceneBuilder/SceneViewport.tsx) draws with it.
 */
import { makeSdf, type Sdf } from './thumbnails';
import { REVERSE_DEFAULTS, SHAPE_BY_KIND, allShapes, pathTo, shapeDims, type CameraSpec, type SceneItem, type SceneSpec, type ShapeSpec, type Vec3 } from './spec';

const rad = (d: number) => d * Math.PI / 180;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The camera at time `t`: where it is and which ways are forward, right and up, as March Camera works them out. */
export interface CamBasis {
  ro: Vec3; fwd: Vec3; rgt: Vec3; up: Vec3; fov: number; dist: number; flat: number;
  /** Reverse perspective: strength `a`, rays meeting `D` in front, `c` scene units per unit of g_uv at the camera. */
  rev?: { a: number; D: number; c: number };
}

export function cameraBasis(c: CameraSpec, t = 0): CamBasis {
  const ang = rad(c.angle) + t * rad(c.orbit), elev = rad(c.elev);
  const ta: Vec3 = [c.x, c.y, c.z];
  const horiz: Vec3 = [Math.sin(ang), 0, Math.cos(ang)];
  const ro = add(ta, mul(add(mul(horiz, Math.cos(elev)), [0, Math.sin(elev), 0]), c.dist));
  const fwd = norm(sub(ta, ro));
  const cup = norm(add(mul(horiz, -Math.sin(elev)), [0, Math.cos(elev), 0]));
  const rgt = norm(cross(cup, fwd));
  const up = cross(fwd, rgt);
  const fov = Math.max(c.zoom, 0.05);
  if (c.projection === 'reverse') {
    // March Camera's reverse block: origins spread over the image plane, rays aimed at a point D in front.
    const a = Math.max(0, Math.min(1, c.reverse ?? REVERSE_DEFAULTS.reverse)), D = Math.max(c.converge ?? REVERSE_DEFAULTS.converge, 0.1);
    return { ro, fwd, rgt, up, fov: c.zoom, dist: c.dist, flat: 0, rev: { a, D, c: c.dist / fov / Math.max(1 - a * c.dist / D, 0.2) } };
  }
  const flat = c.projection === 'orthographic' ? 1 : Math.max(0, Math.min(1, c.flatten));
  return { ro, fwd, rgt, up, fov: c.zoom, dist: c.dist, flat };
}

/** The picture's coordinates: g_uv, x across (−aspect … aspect), y up (−1 … 1). */
export type Uv = [number, number];

/** Scene units per unit of g_uv at depth `z` in front of the camera (Flatten blends to the orthographic scale). */
export const unitsPerUv = (b: CamBasis, z: number) => b.rev
  // Reverse: the spread shrinks with depth (O·(1 − a·z/D)), so far things cover more of the picture.
  ? b.rev.c * (1 - b.rev.a * z / b.rev.D)
  : (b.flat * b.dist + (1 - b.flat) * z) / Math.max(b.fov, 0.05);

/** Where `p` lands on the picture (and how far in front it is), or null when it is behind the camera. */
export function project(b: CamBasis, p: Vec3): { uv: Uv; z: number } | null {
  const v = sub(p, b.ro);
  const z = dot(v, b.fwd);
  if (z <= 1e-4 && b.flat < 1 && !b.rev) return null;
  const k = unitsPerUv(b, z);
  if (k <= 1e-6) return null;
  return { uv: [dot(v, b.rgt) / k, dot(v, b.up) / k], z };
}

/** The ray through a point of the picture. */
export function rayAt(b: CamBasis, uv: Uv): { o: Vec3; d: Vec3 } {
  const lat = add(mul(b.rgt, uv[0]), mul(b.up, uv[1]));
  if (b.rev) {
    const O = mul(lat, b.rev.c);
    return { o: add(b.ro, O), d: norm(sub(mul(b.fwd, b.rev.D), mul(O, b.rev.a))) };
  }
  const fov = Math.max(b.fov, 0.05);
  return { o: add(b.ro, mul(lat, b.flat * b.dist / fov)), d: norm(add(mul(b.fwd, fov), mul(lat, 1 - b.flat))) };
}

/** Picture coordinates to the canvas's pixels (CSS), and back. */
export function uvToPx(uv: Uv, w: number, h: number): [number, number] {
  return [(uv[0] / (w / h) * 0.5 + 0.5) * w, (0.5 - uv[1] * 0.5) * h];
}
export function pxToUv(x: number, y: number, w: number, h: number): Uv {
  return [((x / w) - 0.5) * 2 * (w / h), (0.5 - y / h) * 2];
}

// ── Where a shape is ────────────────────────────────────────────────────────

/** The Move modifiers on an item, added up (`@move(…)`). */
const movesOf = (it: SceneItem): Vec3 => it.warps.reduce<Vec3>((acc, w) => (w.kind === 'move' && Array.isArray(w.values.by) ? add(acc, w.values.by as Vec3) : acc), [0, 0, 0]);

/**
 * The world point a shape's gizmo sits on: its place (`at`) plus the Move modifiers on it and on the
 * groups round it. Other warps (turns, repeats, twists) are not followed: the gizmo is where the
 * shape would be without them.
 */
export function shapeCenter(spec: SceneSpec, sh: ShapeSpec): Vec3 {
  let c = add(sh.at, movesOf(sh));
  for (const g of pathTo(spec, sh.id)) c = add(c, movesOf(g));
  return c;
}

/** The point in the shape's own space, as its Transform (Place mode) turns it back: Z, then Y, then X. */
function toLocal(p: Vec3, center: Vec3, rot: Vec3): Vec3 {
  let [x, y, z] = sub(p, center);
  const unturn = (a: number, b: number, deg: number): [number, number] => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [c * a + s * b, -s * a + c * b];
  };
  [x, y] = unturn(x, y, rot[2]);
  [z, x] = unturn(z, x, rot[1]);
  [y, z] = unturn(y, z, rot[0]);
  return [x, y, z];
}

/** The shape's distance function at its size (a plane is endless here, not the gallery's tile). */
export function shapeSdfOf(sh: ShapeSpec): Sdf | null {
  const def = SHAPE_BY_KIND[sh.kind];
  if (!def) return null;
  if (sh.kind === 'plane') { const h = Number(sh.size.y ?? -0.75); return (_x, y) => y - h; }
  return makeSdf(def, sh.size);
}

/** The nearest shape along a ray through `uv` (its id and how far), or null. Fields and fractals are marched with shorter steps. */
export function pickShape(spec: SceneSpec, b: CamBasis, uv: Uv, maxDist = 60): { id: string; t: number } | null {
  const { o, d } = rayAt(b, uv);
  let best: { id: string; t: number } | null = null;
  for (const sh of allShapes(spec)) {
    const f = shapeSdfOf(sh);
    if (!f) continue;
    const c = shapeCenter(spec, sh);
    const step = SHAPE_BY_KIND[sh.kind]?.stepHint ?? 0.9;
    let t = 0;
    for (let i = 0; i < 160 && t < (best?.t ?? maxDist); i++) {
      const q = toLocal(add(o, mul(d, t)), c, sh.rot);
      const dist = f(q[0], q[1], q[2]);
      if (dist < 0.002 * Math.max(1, t)) { best = { id: sh.id, t }; break; }
      t += Math.max(dist * step, 0.002);
    }
  }
  return best;
}

// ── Sizes ───────────────────────────────────────────────────────────────────

/** Settings of a shape that are not lengths: angles, the 4D slice and spin, fractal constants, a field's frequency, the floor's height. */
const NOT_LENGTH = new Set(['w', 'spin', 'cx', 'cy', 'freq']);

/** The settings a uniform size scales: every length of the shape (a sphere's radius, a box's half-size, a torus's radii…). */
export function lengthKeys(kind: string): string[] {
  const def = SHAPE_BY_KIND[kind];
  if (!def || kind === 'plane') return [];
  return def.params.filter(p => !p.deg && !NOT_LENGTH.has(p.key)).map(p => p.key);
}

/** The size settings scaled by `factor` (lengths only), each kept inside its legal range (but never below its minimum). */
export function scaleSize(kind: string, size: ShapeSpec['size'], factor: number): ShapeSpec['size'] {
  const def = SHAPE_BY_KIND[kind];
  const out: ShapeSpec['size'] = structuredClone(size);
  for (const key of lengthKeys(kind)) {
    const p = def!.params.find(x => x.key === key)!;
    const v = size[key] ?? p.def;
    const fit = (n: number) => Math.round(Math.max(p.min, n * factor) * 1e4) / 1e4;
    out[key] = Array.isArray(v) ? (v as Vec3).map(fit) as Vec3 : (key === 'round' && Number(v) === 0 ? 0 : fit(Number(v)));
  }
  return out;
}

/**
 * One number for a shape's size, for the linked slider and the gizmo's ring: the largest of its
 * dimensions (a box's largest half-size, a cylinder's larger of radius and half-height), or its
 * first length. Null for a shape without lengths (the floor).
 */
export function linkedSize(sh: ShapeSpec): number | null {
  const def = SHAPE_BY_KIND[sh.kind];
  if (!def) return null;
  const dims = shapeDims(def);
  const val = (k: string) => sh.size[k] ?? def.params.find(p => p.key === k)?.def;
  if (dims) {
    const vals = dims.linked.flatMap(t => { const v = val(t.key); return Array.isArray(v) ? v : [Number(v)]; });
    return Math.max(...vals);
  }
  const k = lengthKeys(sh.kind)[0];
  if (!k) return null;
  const v = val(k);
  return Array.isArray(v) ? Math.max(...v) : Number(v);
}

/** About how far a shape reaches from its centre, for the gizmo's size ring. */
export function reachOf(sh: ShapeSpec): number {
  const def = SHAPE_BY_KIND[sh.kind];
  if (!def) return 0.5;
  const v = (k: string) => { const x = sh.size[k] ?? def.params.find(p => p.key === k)?.def; return Array.isArray(x) ? Math.hypot(...x) : Number(x ?? 0); };
  switch (sh.kind) {
    case 'torus': case 'capped-torus': return v('R') + v('r');
    case 'link': return v('len') + v('R') + v('r');
    case 'cone': case 'pyramid': return v('h') * 0.75;
    case 'capped-cone': return Math.max(v('h'), v('r1'), v('r2'));
    case 'cylinder': case 'capsule': case 'hex-prism': case 'tri-prism': return Math.hypot(v('r'), v('h'));
    case 'gyroid': case 'schwarz-p': return v('ball') || 1.1;
    case 'plane': return 0.5;
    default: return linkedSize(sh) ?? 0.5;
  }
}

// ── Drags ───────────────────────────────────────────────────────────────────

/** A drag in the picture's plane (`duv` in picture units) as a move in the world, at depth `z`. */
export function planeMove(b: CamBasis, z: number, duv: Uv): Vec3 {
  const k = unitsPerUv(b, z);
  return add(mul(b.rgt, duv[0] * k), mul(b.up, duv[1] * k));
}

/** A drag along one world axis: how far along `axis` the pointer's move `duv` goes, from `p`. */
export function axisMove(b: CamBasis, p: Vec3, axis: Vec3, duv: Uv): number {
  const a = project(b, p), e = project(b, add(p, axis));
  if (!a || !e) return 0;
  const s: Uv = [e.uv[0] - a.uv[0], e.uv[1] - a.uv[1]];
  const l2 = s[0] * s[0] + s[1] * s[1];
  // An axis pointing at the camera barely shows: no move rather than a huge one.
  if (l2 < 1e-4) return 0;
  return (duv[0] * s[0] + duv[1] * s[1]) / l2;
}

export const AXES: Record<'x' | 'y' | 'z', Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** A value rounded for the form (four places), so a drag writes tidy numbers. */
export const tidy = (v: number) => Math.round(v * 1e4) / 1e4;
