/**
 * diagram.ts — the geometry of the Agent Builder's viewport diagrams (docs/agent-builder.md): one
 * walker shown up close in a lens over the live picture, facing up, with its three feelers
 * (figure 2.4 of the field guide: Distance ahead, at +Angle on the left and −Angle on the right),
 * the turn arc, the wobble fan, the step length, and the edges. Pure: the SVG draws these.
 */
export type DiagramSection = 'born' | 'senses' | 'turning' | 'moving' | 'trail' | 'forces' | 'life' | 'look' | 'neighbours' | 'steering' | 'orbit' | 'memory';

/** What is drawn: the selected section, the setting under the pointer or being dragged, and the card it belongs to (`gravity#0`). */
export interface DiagramFocus { section: DiagramSection; setting?: string; card?: string }

export interface Pt { x: number; y: number }

/** Sections drawn on one walker up close in the lens (the rest draw on the whole picture). */
export const usesLens = (f: DiagramFocus) => f.section === 'senses' || f.section === 'turning' || f.section === 'trail' || (f.section === 'moving' && f.setting !== 'edges');

export interface Lens {
  /** Centre and radius (CSS pixels, in the viewport). */
  cx: number; cy: number; r: number;
  /** Lens pixels per picture unit. */
  scale: number;
  /** Where the walker stands (a little below the centre, facing up so its feelers fill the lens). */
  walker: Pt;
}

/**
 * The lens in a viewport of `w` × `h`, magnified so a feeler `ref` long is half the lens radius.
 * `ref` should stay put while a slider moves (the section's value when it was picked), so the
 * feelers visibly grow and shrink with the slider.
 */
export function lensFor(w: number, h: number, ref: number, left = 0): Lens {
  // `left`: the viewport's free area starts there (right of the legend).
  const fw = Math.max(w - left, w * 0.5);
  const r = Math.max(60, Math.min(fw, h) * 0.34);
  const cx = w - fw / 2, cy = h / 2;
  const scale = (r * 0.5) / Math.max(ref, 1e-4);
  return { cx, cy, r, scale, walker: { x: cx, y: cy + r * 0.42 } };
}

const DEG = Math.PI / 180;

/** A point `len` pixels from `from`, `deg` degrees left of straight up (negative: right). */
export const along = (from: Pt, len: number, deg: number): Pt => ({ x: from.x - Math.sin(deg * DEG) * len, y: from.y - Math.cos(deg * DEG) * len });

/** The three feelers: left (+angle), centre and right (−angle), `distance` ahead. */
export function feelers(lens: Lens, distance: number, angle: number): { left: Pt; centre: Pt; right: Pt; length: number } {
  const length = distance * lens.scale;
  return { left: along(lens.walker, length, angle), centre: along(lens.walker, length, 0), right: along(lens.walker, length, -angle), length };
}

/** An SVG arc path round `c` at radius `r` from `a0` to `a1` degrees (left of up is positive). */
export function arcPath(c: Pt, r: number, a0: number, a1: number): string {
  const p0 = along(c, r, a0), p1 = along(c, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  // Increasing angle turns left (counter-clockwise on screen): sweep flag 0.
  const sweep = a1 > a0 ? 0 : 1;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** A wedge (pie slice) from `c`: the wobble's fan of ±deg. */
export function wedgePath(c: Pt, r: number, deg: number): string {
  const d = Math.min(Math.max(deg, 0), 179);
  const p0 = along(c, r, d), p1 = along(c, r, -d);
  return `M ${c.x} ${c.y} L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z`;
}

/** Positions of the last `n` steps behind the walker (one step = speed ÷ 60 picture units). */
export function stepsBehind(lens: Lens, speed: number, n = 5): Pt[] {
  const step = (speed / 60) * lens.scale;
  return Array.from({ length: n }, (_, i) => ({ x: lens.walker.x, y: lens.walker.y + step * (i + 1) }));
}

/** How many steps it takes to reach its feelers (the field guide's 9 : 1 for slime). */
export const stepsToFeelers = (distance: number, speed: number) => (speed > 0 ? distance / (speed / 60) : Infinity);

/** Keep the lens' magnification while the value stays within this share of the reference; else re-fit. */
export function keepRef(ref: number, value: number, lo = 0.25, hi = 2.6): number {
  if (!(ref > 0)) return Math.max(value, 1e-4);
  const k = value / ref;
  return k < lo || k > hi ? Math.max(value, 1e-4) : ref;
}

/** A picture point (x across ±aspect, y up ±1) on the shown image rect. */
export function picToView(rect: { x: number; y: number; w: number; h: number }, p: Pt): Pt {
  const aspect = rect.w / Math.max(rect.h, 1);
  return { x: rect.x + (p.x / aspect * 0.5 + 0.5) * rect.w, y: rect.y + (0.5 - p.y * 0.5) * rect.h };
}

/** Image rect for a `sw` × `sh` picture shown "contain" in a `w` × `h` box. */
export function containRect(w: number, h: number, sw: number, sh: number): { x: number; y: number; w: number; h: number } {
  if (!(sw > 0 && sh > 0)) return { x: 0, y: 0, w, h };
  const k = Math.min(w / sw, h / sh);
  return { x: (w - sw * k) / 2, y: (h - sh * k) / 2, w: sw * k, h: sh * k };
}

// ── Neighbours, flocking, forces, orbits (phase 2) ───────────────────────────

/** A lens with the walker in its middle, magnified so the view radius `radius` is 0.42 of the lens. */
export function ringLens(w: number, h: number, radius: number, left = 0): Lens {
  const fw = Math.max(w - left, w * 0.5);
  const r = Math.max(60, Math.min(fw, h) * 0.36);
  const cx = w - fw / 2, cy = h / 2;
  return { cx, cy, r, scale: (r * 0.42) / Math.max(radius, 1e-4), walker: { x: cx, y: cy } };
}

/** A small repeatable random (the diagrams' made-up neighbours). */
function rand32(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface NeighbourDot { x: number; y: number; heading: number; d: number; inReach: boolean; counted: boolean; index: number }

/**
 * The made-up neighbours round the walker in the Neighbours lens: positions in units of the view
 * radius (up to 1.8 out), headings near the flock's (up), in index order. Those inside the ring
 * are in reach; the first `max` of those (index order, as the grid reads them) are counted. There
 * are always a few more in reach than `max` while max is under 60, so the cut shows.
 */
export function neighbourDots(max: number, seed = 7): NeighbourDot[] {
  const r = rand32(seed);
  const inside = Math.min(64, Math.max(14, Math.round(Math.max(max, 1) * 1.35)));
  const total = Math.round(inside * 1.8 * 1.8);
  const out: NeighbourDot[] = [];
  let k = 0;
  for (let i = 0; i < total * 4 && out.length < total; i++) {
    const a = r() * Math.PI * 2, d = 1.8 * Math.sqrt(r());
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    // Keep them apart a little, and off the walker itself.
    if (d < 0.18 || out.some(o => Math.hypot(o.x - x, o.y - y) < 0.16)) continue;
    out.push({ x, y, heading: (r() - 0.5) * 70, d, inReach: d <= 1, counted: false, index: k++ });
  }
  let c = 0;
  for (const o of out) if (o.inReach && c < max) { o.counted = true; c++; }
  return out;
}

/** The pieces of Reynolds' three rules on the counted neighbours (units of the view radius; y up). */
export function flockForces(dots: readonly NeighbourDot[], tooClose = 0.45) {
  const counted = dots.filter(d => d.counted);
  const n = Math.max(counted.length, 1);
  const centre = { x: counted.reduce((s, d) => s + d.x, 0) / n, y: counted.reduce((s, d) => s + d.y, 0) / n };
  const heading = counted.reduce((s, d) => s + d.heading, 0) / n;
  const close = counted.filter(d => d.d < tooClose);
  const push = close.reduce((s, d) => ({ x: s.x - d.x / (d.d * d.d), y: s.y - d.y / (d.d * d.d) }), { x: 0, y: 0 });
  return { centre, heading, close, push };
}

/** A point `len` along `deg` (0 right, 90 up, as the forces' Angle) from `from`, on screen (y down). */
export const toward = (from: Pt, len: number, deg: number): Pt => ({ x: from.x + Math.cos(deg * DEG) * len, y: from.y - Math.sin(deg * DEG) * len });

/** An arrow's head (two barbs) at `to`, coming from `from`. */
export function arrowHead(from: Pt, to: Pt, size = 8): string {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const l = { x: to.x - Math.cos(a - 0.45) * size, y: to.y - Math.sin(a - 0.45) * size };
  const r = { x: to.x - Math.cos(a + 0.45) * size, y: to.y - Math.sin(a + 0.45) * size };
  return `M ${l.x.toFixed(1)} ${l.y.toFixed(1)} L ${to.x.toFixed(1)} ${to.y.toFixed(1)} L ${r.x.toFixed(1)} ${r.y.toFixed(1)}`;
}

/** A force's arrow length on screen: grows with strength, never past `cap` px. */
export const forceLength = (strength: number, cap = 120) => Math.min(cap, 18 + Math.abs(strength) * 70);

/**
 * The curl flow at a picture point (a stream function's curl, so it never bunches particles up):
 * the same field the presets' dots follow (dotSim.ts). Size: bigger is busier; `t` the clock × Evolve.
 */
export function curlAt(x: number, y: number, size: number, t = 0): [number, number] {
  const f = 2.2 * size;
  const dpdy = -1.7 * f * Math.sin(x * f * 1.3 + t) * Math.sin(y * f * 1.7 - t * 0.7);
  const dpdx = 1.3 * f * Math.cos(x * f * 1.3 + t) * Math.cos(y * f * 1.7 - t * 0.7);
  return [dpdy / f, -dpdx / f];
}

/** A grid of curl-flow arrows over the picture rect: start, end (screen) and how strong (0–1). */
export function curlArrows(rect: { x: number; y: number; w: number; h: number }, size: number, cols = 14): Array<{ from: Pt; to: Pt; k: number }> {
  const aspect = rect.w / Math.max(rect.h, 1);
  const rows = Math.max(3, Math.round(cols / aspect));
  const cell = rect.w / cols;
  const out: Array<{ from: Pt; to: Pt; k: number }> = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px = rect.x + (i + 0.5) * cell, py = rect.y + (j + 0.5) * (rect.h / rows);
    const x = ((px - rect.x) / rect.w - 0.5) * 2 * aspect, y = (0.5 - (py - rect.y) / rect.h) * 2;
    const [vx, vy] = curlAt(x, y, size);
    const m = Math.hypot(vx, vy);
    const len = cell * 0.42 * Math.min(1, m / 1.2 + 0.25);
    const ux = m > 1e-6 ? vx / m : 0, uy = m > 1e-6 ? vy / m : 0;
    out.push({ from: { x: px - ux * len, y: py + uy * len }, to: { x: px + ux * len, y: py - uy * len }, k: Math.min(1, m / 1.5) });
  }
  return out;
}

/** Where an orbit is on the picture: its centre (the point, the middle, or the middle for the mouse) and radius in px. */
export function orbitOnPicture(rect: { x: number; y: number; w: number; h: number }, o: { target: 'point' | 'centre' | 'mouse'; x?: number; y?: number; distance: number }) {
  const c = picToView(rect, o.target === 'point' ? { x: o.x ?? 0, y: o.y ?? 0 } : { x: 0, y: 0 });
  return { c, r: Math.max(2, o.distance * rect.h / 2) };
}

/** Arrowheads round a circle, `n` of them, going counter-clockwise (or clockwise) as seen. */
export function orbitArrows(c: Pt, r: number, cw: boolean, n = 6): Array<{ at: Pt; head: string }> {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const at = { x: c.x + Math.cos(a) * r, y: c.y - Math.sin(a) * r };
    const s = cw ? -1 : 1;
    const back = { x: at.x + Math.sin(a) * 10 * s, y: at.y + Math.cos(a) * 10 * s };
    return { at, head: arrowHead(back, at, 9) };
  });
}

/** Brightness by age (Fade with age) and when it dies: points of the curve over `span` seconds. */
export function lifeCurve(fade: number | null, span: number, n = 48): Array<{ t: number; v: number }> {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * span;
    return { t, v: fade && fade > 0 ? Math.max(0, 1 - t / fade) : 1 };
  });
}

/**
 * A 3D Emit's ball or shell through the 3D camera (`project`: a picture point and its depth, as
 * agentPlan.js agProject3): the silhouette's centre and radius, the equator and one meridian as
 * screen polylines (the far halves dashed by the caller from `back`).
 */
export function sphereOnPicture(project: (p: [number, number, number]) => { x: number; y: number; depth: number }, toView: (p: Pt) => Pt, c: [number, number, number], r: number, n = 48) {
  const ctr = project(c);
  const centre = toView({ x: ctr.x, y: ctr.y });
  // The silhouette: the largest projected offset round the centre (good to a few % for small spheres).
  let rad = 0;
  const ring = (f: (a: number) => [number, number, number]) => Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const p = project(f(a));
    const v = toView({ x: p.x, y: p.y });
    rad = Math.max(rad, Math.hypot(v.x - centre.x, v.y - centre.y));
    return { ...v, back: p.depth > ctr.depth };
  });
  const equator = ring(a => [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]);
  const meridian = ring(a => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]]);
  const side = ring(a => [c[0], c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r]);
  return { centre, radius: rad, equator, meridian, side, visible: ctr.depth > 0 };
}
