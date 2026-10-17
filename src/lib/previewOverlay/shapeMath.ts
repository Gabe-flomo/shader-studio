/**
 * The preview Overlay's Shape and Distance maths. Shape: an SDF's distance read over the picture
 * (the same coarse texels as the space, row 0 at the bottom) gives its d = 0 boundary (marching
 * squares), the bounding box of d ≤ 0 in the chosen space, the centre and, for a circle-like shape,
 * the radius. Known primitives (Circle, Box, Shape SDF…) label their own params instead. Distance:
 * two points' values in the space and the length between them, or one point from the origin with
 * its angle. Every value is the space's own (a warped space gives warped values: that's the point).
 */
import type { GraphNode } from '../../types/nodeGraph';
import { isoSegments, locateValue, padComponent, sampleBilinear, type Field2 } from './overlayMath';
import { refKey, type SocketRef } from './overlayStore';

/** One number per texel, row-major from the bottom row (an SDF's distance). */
export interface Field1 { data: Float32Array; w: number; h: number }

/** The scalar field at a screen point (u, v in 0…1), bilinear, extrapolated past the texel centres. */
export function sampleScalar(f: Field1, u: number, v: number): number {
  const fx = u * f.w - 0.5, fy = v * f.h - 0.5;
  const i0 = f.w > 1 ? Math.max(0, Math.min(f.w - 2, Math.floor(fx))) : 0;
  const j0 = f.h > 1 ? Math.max(0, Math.min(f.h - 2, Math.floor(fy))) : 0;
  const i1 = Math.min(f.w - 1, i0 + 1), j1 = Math.min(f.h - 1, j0 + 1);
  const tx = f.w > 1 ? fx - i0 : 0, ty = f.h > 1 ? fy - j0 : 0;
  const a = f.data[j0 * f.w + i0], b = f.data[j0 * f.w + i1], d = f.data[j1 * f.w + i0], e = f.data[j1 * f.w + i1];
  return (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
}

/** The d = 0 iso-line as flat screen segments [u0, v0, u1, v1, …]. */
export function boundarySegments(sdf: Field1): number[] {
  const data = new Float32Array(sdf.w * sdf.h * 2);
  for (let k = 0; k < sdf.w * sdf.h; k++) data[k * 2] = sdf.data[k];
  return isoSegments(padComponent({ data, w: sdf.w, h: sdf.h }, 0), 0);
}

export interface Box { minX: number; maxX: number; minY: number; maxY: number }

export interface ShapeStats {
  /** The boundary on screen. */
  segs: number[];
  /** The bounding box of d ≤ 0 in the space; null when nothing is inside in view. */
  box: Box | null;
  /** The shape runs off the picture (the box is only what's in view). */
  clipped: boolean;
  /** The box's centre in the space. */
  centre: [number, number] | null;
  /** The inscribed radius: the deepest inside distance (−min d), corrected to the centre for a circle. */
  inscribed: number;
  /** The boundary keeps one distance from the centre (within 8 %), and the box is square. */
  circleLike: boolean;
}

/**
 * Boundary, box, centre and radius estimate of the SDF `sdf` measured in `space`. The box spans
 * the boundary's points (interpolated, so finer than a texel) and every inside texel (a shape cut
 * by the frame still has a box).
 */
export function shapeStats(space: Field2, sdf: Field1): ShapeStats {
  const segs = boundarySegments(sdf);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < segs.length; k += 2) {
    const u = segs[k], v = segs[k + 1];
    const p = sampleBilinear(space, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
    pts.push(p); add(p[0], p[1]);
  }
  let clipped = false, minD = Infinity, minK = -1, inside = 0;
  for (let j = 0; j < sdf.h; j++) for (let i = 0; i < sdf.w; i++) {
    const k = j * sdf.w + i, d = sdf.data[k];
    if (!Number.isFinite(d)) continue;
    if (d < minD) { minD = d; minK = k; }
    if (d > 0) continue;
    inside++;
    add(space.data[k * 2], space.data[k * 2 + 1]);
    if (i === 0 || j === 0 || i === sdf.w - 1 || j === sdf.h - 1) clipped = true;
  }
  if (!inside && !pts.length) return { segs, box: null, clipped: false, centre: null, inscribed: 0, circleLike: false };
  const box = { minX, maxX, minY, maxY };
  const centre: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const bw = maxX - minX, bh = maxY - minY;
  let circleLike = false;
  if (!clipped && pts.length >= 8 && bw > 0 && bh > 0 && Math.abs(bw - bh) / Math.max(bw, bh) < 0.08) {
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (const p of pts) { const r = Math.hypot(p[0] - centre[0], p[1] - centre[1]); lo = Math.min(lo, r); hi = Math.max(hi, r); sum += r; }
    circleLike = (hi - lo) / (sum / pts.length) < 0.08;
  }
  let inscribed = minD < 0 ? -minD : 0;
  // A circle's d is −r at its centre and rises by the distance from it: the deepest texel misses
  // the centre by up to half a cell, so add that miss back.
  if (circleLike && minK >= 0) inscribed += Math.hypot(space.data[minK * 2] - centre[0], space.data[minK * 2 + 1] - centre[1]);
  return { segs, box, clipped, centre, inscribed, circleLike };
}

/**
 * A space rectangle's outline on screen: each edge sampled at `n` points and located in the field
 * (curved in a warped space). Points that can't be found split the edge.
 */
export function rectOutline(space: Field2, b: Box, n = 12): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  const edges: Array<[[number, number], [number, number]]> = [
    [[b.minX, b.minY], [b.maxX, b.minY]], [[b.maxX, b.minY], [b.maxX, b.maxY]],
    [[b.maxX, b.maxY], [b.minX, b.maxY]], [[b.minX, b.maxY], [b.minX, b.minY]],
  ];
  for (const [a, c] of edges) {
    let run: Array<[number, number]> = [];
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const loc = locateValue(space, [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]);
      if (loc.found) run.push([loc.u, loc.v]);
      else { if (run.length > 1) out.push(run); run = []; }
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}

// ── Known primitives ────────────────────────────────────────────────────────

/** A primitive's own numbers, each only when its socket isn't wired (else the overlay estimates). */
export interface PrimitiveInfo {
  name: string;
  centre?: [number, number];
  radius?: number;
  /** What the radius is ("r", "outer r"). */
  radiusLabel?: string;
  /** Half width / half height (a box). */
  half?: [number, number];
}

const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const wired = (n: GraphNode, k: string) => !!n.inputs?.[k]?.connection;

/** Position input of the 2D SDF nodes: the space a shape lives in. */
export const SDF_POSITION_INPUT: Record<string, string> = {
  circleSDF: 'position', boxSDF: 'position', ringSDF: 'position',
  shapeSDF: 'p', simpleSDF: 'p', sdEllipse: 'p', sdSegment: 'p',
};

/** The space feeding an SDF node's position input: a ref, null for plain UV (unwired), undefined when unknown. */
export function sdfInputSpace(n: GraphNode): SocketRef | null | undefined {
  const key = SDF_POSITION_INPUT[n.type] ?? (n.inputs?.position?.type === 'vec2' ? 'position' : n.inputs?.p?.type === 'vec2' ? 'p' : n.inputs?.uv?.type === 'vec2' ? 'uv' : null);
  if (!key || !n.inputs?.[key]) return undefined;
  const c = n.inputs[key].connection;
  return c ? { nodeId: c.nodeId, outputKey: c.outputKey } : null;
}

/**
 * The known primitives' params (Circle / Box / Ring SDF, Simple SDF, Shape SDF's circle, boxes,
 * ellipse and stars). Null for anything else.
 */
export function primitiveInfo(n: GraphNode): PrimitiveInfo | null {
  const P = n.params ?? {};
  const centreOf = (): [number, number] | undefined => (wired(n, 'offset') ? undefined : [num(P.posX, 0), num(P.posY, 0)]);
  switch (n.type) {
    case 'circleSDF': case 'ringSDF':
      return { name: n.type === 'circleSDF' ? 'Circle' : 'Ring', centre: centreOf(), radius: wired(n, 'radius') ? undefined : num(P.radius, 0.3), radiusLabel: 'r' };
    case 'boxSDF':
      return { name: 'Box', centre: centreOf(), half: wired(n, 'dimensions') ? undefined : [num(P.width, 0.5), num(P.height, 0.5)] };
    case 'simpleSDF': {
      const shape = String(P.shape ?? 'circle');
      if (shape === 'box') return { name: 'Box', centre: [0, 0], half: wired(n, 'b') ? undefined : [num(P.wx, 0.3), num(P.wy, 0.3)] };
      return { name: shape === 'ring' ? 'Ring' : 'Circle', centre: [0, 0], radius: wired(n, 'r') ? undefined : num(P.r, 0.3), radiusLabel: 'r' };
    }
    case 'shapeSDF': {
      const shape = String(P.shape ?? 'circle');
      const half = wired(n, 'b') ? undefined : [num(P.rx, 0.3), num(P.ry, 0.3)] as [number, number];
      const r = wired(n, 'r') ? undefined : num(P.r, 0.3);
      if (shape === 'circle') return { name: 'Circle', centre: [0, 0], radius: r, radiusLabel: 'r' };
      if (shape === 'box' || shape === 'roundedBox' || shape === 'chamferBox') return { name: shape === 'box' ? 'Box' : shape === 'roundedBox' ? 'Rounded Box' : 'Chamfer Box', centre: [0, 0], half };
      if (shape === 'ellipse') return { name: 'Ellipse', centre: [0, 0], half };
      if (shape === 'star5' || shape === 'starN') return { name: 'Star', centre: [0, 0], radius: r, radiusLabel: 'outer r' };
      if (shape === 'hexagon' || shape === 'pentagon' || shape === 'octagon') return { name: shape[0].toUpperCase() + shape.slice(1), centre: [0, 0], radius: r, radiusLabel: 'r' };
      return { name: 'Shape', centre: [0, 0] };
    }
    default: return null;
  }
}

/** The primitive's params apply only when the overlay measures in the space the SDF is fed. */
export function primitiveFor(n: GraphNode | undefined, space: SocketRef | null): PrimitiveInfo | null {
  if (!n) return null;
  const s = sdfInputSpace(n);
  if (s === undefined || refKey(s) !== refKey(space)) return null;
  return primitiveInfo(n);
}

/** The exact box of a known circle / box primitive (centre and size both known), else null. */
export function primitiveBox(p: PrimitiveInfo | null): Box | null {
  if (!p?.centre) return null;
  const [cx, cy] = p.centre;
  if (p.half) return { minX: cx - p.half[0], maxX: cx + p.half[0], minY: cy - p.half[1], maxY: cy + p.half[1] };
  if (p.radius !== undefined && p.radiusLabel === 'r' && (p.name === 'Circle' || p.name === 'Ring')) return { minX: cx - p.radius, maxX: cx + p.radius, minY: cy - p.radius, maxY: cy + p.radius };
  return null;
}

// ── Distance ────────────────────────────────────────────────────────────────

/** Two points' values in a space and the length between them there. */
export function measurePair(f: Field2, a: [number, number], b: [number, number]): { pa: [number, number]; pb: [number, number]; dist: number } {
  const pa = sampleBilinear(f, a[0], a[1]), pb = sampleBilinear(f, b[0], b[1]);
  return { pa, pb, dist: Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) };
}

/** A space value's distance from the origin and angle (degrees, 0 = +x, counter-clockwise, 0…360). */
export function fromOrigin(p: [number, number]): { dist: number; angle: number } {
  let a = (Math.atan2(p[1], p[0]) * 180) / Math.PI;
  if (a < 0) a += 360;
  if (a >= 360) a -= 360;
  return { dist: Math.hypot(p[0], p[1]), angle: a };
}
