/**
 * grid.ts — the 2D Scene Builder's Grid (docs/scene-builder-2d.md, "Grid"): a grid of cells, each
 * with its own shape, and ripples that travel through the cells and change them.
 *
 *   cells     columns × rows over a square span round the centre
 *   shapes    1–3 kinds, given out to cells by a rule: all the same, checker, by column, by row,
 *             every Nth, or random
 *   ripples   circular waves from the centre, the four corners, the mouse or a point (any number);
 *             the wave is the average of them, −1..1
 *   target    what the wave changes: the shape's size, its turn, a push off the cell centre, or a
 *             morph between the first two shapes
 *   colour    by shape (two colours), by the wave (the Look palette) or per cell (the palette)
 *
 * It builds as one Expression Block whose lines are the maths, step by step (each a line you can
 * read and change), giving vec3(distance, wave 0..1, shape index 0..1), then the usual colour, glow
 * and fill nodes. Pure data and text: no store.
 */
import type { Vec2, Vec3 } from './spec';

export const GRID_SHAPES = ['circle', 'box', 'ring', 'diamond', 'triangle', 'hexagon', 'cross'] as const;
export type GridShape = typeof GRID_SHAPES[number];
export const GRID_ASSIGNS = ['same', 'checker', 'columns', 'rows', 'every', 'random'] as const;
export type GridAssign = typeof GRID_ASSIGNS[number];
export const GRID_TARGETS = ['size', 'rotate', 'offset', 'morph', 'none'] as const;
export type GridTarget = typeof GRID_TARGETS[number];
export const RIPPLE_FROMS = ['centre', 'corners', 'mouse', 'point'] as const;
export type RippleFrom = typeof RIPPLE_FROMS[number];
export const GRID_COLOUR_BYS = ['shape', 'ripple', 'cell'] as const;
export type GridColourBy = typeof GRID_COLOUR_BYS[number];

export interface RippleSpec { from: RippleFrom; at: Vec2 }

export interface GridSpec {
  cols: number;
  rows: number;
  /** Half the grid's width and height, in picture units (1 reaches the top edge). */
  span: number;
  shapes: GridShape[];
  assign: GridAssign;
  /** For 'every': every Nth cell gets the second shape. */
  every: number;
  /** The shape's size as a share of its cell (1 touches the neighbours). */
  size: number;
  ripples: RippleSpec[];
  /** Waves across the grid (rings per unit). */
  freq: number;
  /** Cycles a second (0: still). */
  speed: number;
  target: GridTarget;
  /** How much the wave changes the target (0..1). */
  amount: number;
  colourBy: GridColourBy;
  colour: Vec3;
  colour2: Vec3;
  glow: boolean;
}

export const GRID_LABELS = {
  assign: { same: 'All the same', checker: 'Checker', columns: 'By column', rows: 'By row', every: 'Every Nth', random: 'Random' } as Record<GridAssign, string>,
  target: { size: 'Size', rotate: 'Turn', offset: 'Push', morph: 'Morph between shapes', none: 'Nothing (colour only)' } as Record<GridTarget, string>,
  from: { centre: 'The centre', corners: 'The four corners', mouse: 'The mouse', point: 'A point' } as Record<RippleFrom, string>,
  colourBy: { shape: 'Shape (two colours)', ripple: 'The ripple (palette)', cell: 'Each cell (palette)' } as Record<GridColourBy, string>,
};

export function defaultGrid(): GridSpec {
  return {
    cols: 12, rows: 12, span: 0.9, shapes: ['circle'], assign: 'same', every: 3, size: 0.7,
    ripples: [{ from: 'centre', at: [0, 0] }], freq: 8, speed: 0.4, target: 'size', amount: 0.5,
    colourBy: 'ripple', colour: [0.35, 0.8, 1], colour2: [1, 0.45, 0.7], glow: true,
  };
}

const f = (n: number) => { const s = (Math.round(n * 1e5) / 1e5).toString(); return s.includes('.') || s.includes('e') ? s : `${s}.0`; };
const v2 = (v: Vec2) => `vec2(${f(v[0])}, ${f(v[1])})`;

type Line = { lhs: string; op: string; rhs: string };
const L = (lhs: string, rhs: string, op = '='): Line => ({ lhs, op, rhs });

/** The lines that measure one shape at `q` with size `s` into `name`. */
function shapeLines(kind: GridShape, name: string): Line[] {
  switch (kind) {
    case 'circle': return [L(`float ${name}`, 'length(q) - s')];
    case 'box': return [L(`vec2 ${name}b`, 'abs(q) - vec2(s)'), L(`float ${name}`, `length(max(${name}b, 0.0)) + min(max(${name}b.x, ${name}b.y), 0.0)`)];
    case 'ring': return [L(`float ${name}`, 'abs(length(q) - s * 0.8) - s * 0.2')];
    case 'diamond': return [L(`float ${name}`, '(abs(q.x) + abs(q.y) - s) * 0.7071')];
    case 'cross': return [
      L(`vec2 ${name}a`, 'abs(q) - vec2(s, s * 0.3)'), L(`vec2 ${name}c`, 'abs(q) - vec2(s * 0.3, s)'),
      L(`float ${name}`, `min(length(max(${name}a, 0.0)) + min(max(${name}a.x, ${name}a.y), 0.0), length(max(${name}c, 0.0)) + min(max(${name}c.x, ${name}c.y), 0.0))`),
    ];
    case 'triangle': return [
      L(`vec2 ${name}p`, 'vec2(abs(q.x) - s, q.y + s / 1.7320508)'),
      L(`${name}p`, `(${name}p.x + 1.7320508 * ${name}p.y > 0.0) ? vec2(${name}p.x - 1.7320508 * ${name}p.y, -1.7320508 * ${name}p.x - ${name}p.y) / 2.0 : ${name}p`),
      L(`${name}p.x`, `clamp(${name}p.x, -2.0 * s, 0.0)`, '-='),
      L(`float ${name}`, `-length(${name}p) * sign(${name}p.y)`),
    ];
    case 'hexagon': return [
      L(`vec2 ${name}p`, 'abs(q)'),
      L(`${name}p`, `2.0 * min(dot(vec2(-0.8660254, 0.5), ${name}p), 0.0) * vec2(-0.8660254, 0.5)`, '-='),
      L(`${name}p`, `vec2(clamp(${name}p.x, -0.5773503 * s, 0.5773503 * s), s)`, '-='),
      L(`float ${name}`, `length(${name}p) * sign(${name}p.y)`),
    ];
  }
}

/** Which shape a cell gets, 0..n−1, from its id. */
function assignExpr(g: GridSpec, n: number): string {
  if (n <= 1) return '0.0';
  switch (g.assign) {
    case 'same': return '0.0';
    case 'checker': return `mod(id.x + id.y, ${f(n)})`;
    case 'columns': return `mod(id.x, ${f(n)})`;
    case 'rows': return `mod(id.y, ${f(n)})`;
    case 'every': return `1.0 - step(0.5, mod(id.x + id.y * ${f(g.cols)}, ${f(Math.max(2, Math.round(g.every)))}))`;
    case 'random': return `floor(fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453) * ${f(n)})`;
  }
}

/** The Expression Block's lines and result. Inputs: uv, t, (mouse), and sliders size, amount, freq, speed. */
export function gridProgram(g: GridSpec): { lines: Line[]; result: string; usesMouse: boolean } {
  const cols = Math.max(1, Math.round(g.cols)), rows = Math.max(1, Math.round(g.rows));
  const span = g.span;
  const shapes = (g.shapes.length ? g.shapes : ['circle' as GridShape]).slice(0, 3);
  const n = g.target === 'morph' ? Math.max(2, shapes.length) : shapes.length;
  if (g.target === 'morph' && shapes.length < 2) shapes.push(shapes[0] === 'box' ? 'circle' : 'box');
  const lines: Line[] = [
    L('vec2 cs', `vec2(${f(2 * span / cols)}, ${f(2 * span / rows)})`),
    L('vec2 id', `floor((uv + vec2(${f(span)})) / cs)`),
    L('float inGrid', `step(0.0, id.x) * step(0.0, id.y) * step(id.x, ${f(cols - 1)}) * step(id.y, ${f(rows - 1)})`),
    L('vec2 cc', `(id + 0.5) * cs - vec2(${f(span)})`),
    L('vec2 q', 'uv - cc'),
  ];
  const ripples = g.ripples.length ? g.ripples : [{ from: 'centre' as RippleFrom, at: [0, 0] as Vec2 }];
  lines.push(L('float w', '0.0'));
  let usesMouse = false;
  for (const r of ripples) {
    let dist: string;
    if (r.from === 'corners') {
      const c = f(span);
      dist = `min(min(length(cc - vec2(-${c}, -${c})), length(cc - vec2(${c}, -${c}))), min(length(cc - vec2(-${c}, ${c})), length(cc - vec2(${c}, ${c}))))`;
    } else if (r.from === 'mouse') { usesMouse = true; dist = 'length(cc - mouse)'; }
    else if (r.from === 'point') dist = `length(cc - ${v2(r.at)})`;
    else dist = 'length(cc)';
    lines.push(L('w', `sin(${dist} * freq - t * speed * 6.2831853)`, '+='));
  }
  if (ripples.length > 1) lines.push(L('w', f(ripples.length), '/='));
  lines.push(L('float m', 'min(cs.x, cs.y) * 0.5 * size'));
  lines.push(L('float s', g.target === 'size' ? 'm * clamp(1.0 + amount * w, 0.05, 2.0)' : 'm'));
  if (g.target === 'rotate') {
    lines.push(L('float an', 'amount * w * 3.1415927'));
    lines.push(L('q', 'mat2(cos(an), sin(an), -sin(an), cos(an)) * q'));
  }
  if (g.target === 'offset') lines.push(L('q', 'vec2(cos(w * 3.1415927), sin(w * 3.1415927)) * amount * m * 0.6', '-='));
  lines.push(L('float k', assignExpr(g, n)));
  shapes.forEach((kind, i) => lines.push(...shapeLines(kind, `d${i}`)));
  let d = 'd0';
  if (g.target === 'morph') d = 'mix(d0, d1, w * 0.5 + 0.5)';
  else if (shapes.length === 2) d = 'mix(d0, d1, step(0.5, k))';
  else if (shapes.length === 3) d = 'mix(mix(d0, d1, step(0.5, k)), d2, step(1.5, k))';
  lines.push(L('float d', `mix(1.0, ${d}, inGrid)`));
  const kNorm = n > 1 ? `k / ${f(n - 1)}` : '0.0';
  return { lines, result: `vec3(d, w * 0.5 + 0.5, ${g.colourBy === 'cell' ? 'fract(sin(dot(id, vec2(7.13, 3.71))) * 917.3)' : kNorm})`, usesMouse };
}

// ── Recipe ──────────────────────────────────────────────────────────────────

/** `grid 12 shape=circle shape=box assign=checker size=0.7 ripple=centre ripple=corners freq=8 speed=0.4 target=size amount=0.5 by=ripple color=cyan color2=pink` */
export function printGrid(g: GridSpec, colourText: (c: Vec3) => string): string {
  const D = defaultGrid();
  const parts = [g.cols === g.rows ? `grid ${g.cols}` : `grid ${g.cols} ${g.rows}`];
  const r = (n: number) => String(Math.round(n * 1e4) / 1e4);
  if (g.span !== D.span) parts.push(`span=${r(g.span)}`);
  if (g.shapes.join(',') !== D.shapes.join(',')) parts.push(...g.shapes.map(x => `shape=${x}`));
  if (g.assign !== D.assign) parts.push(`assign=${g.assign}`);
  if (g.assign === 'every' && g.every !== D.every) parts.push(`every=${g.every}`);
  if (g.size !== D.size) parts.push(`size=${r(g.size)}`);
  const rip = g.ripples.map(x => (x.from === 'point' ? `(${r(x.at[0])},${r(x.at[1])})` : x.from));
  if (rip.join() !== 'centre') parts.push(...rip.map(x => `ripple=${x}`));
  if (g.freq !== D.freq) parts.push(`freq=${r(g.freq)}`);
  if (g.speed !== D.speed) parts.push(`speed=${r(g.speed)}`);
  if (g.target !== D.target) parts.push(`target=${g.target}`);
  if (g.amount !== D.amount) parts.push(`amount=${r(g.amount)}`);
  if (g.colourBy !== D.colourBy) parts.push(`by=${g.colourBy}`);
  if (g.colour.join() !== D.colour.join()) parts.push(`color=${colourText(g.colour)}`);
  if (g.colour2.join() !== D.colour2.join()) parts.push(`color2=${colourText(g.colour2)}`);
  if (!g.glow) parts.push('glow=off');
  return parts.join(' ');
}
