/**
 * glsl.ts — the Grid scene's shader code (docs/grid-builder.md, "What Build makes"). One GLSL
 * function draws the whole grid for a pixel, with the shapes' numbers coming in as arguments (the
 * sliders on the Shape and Grid scene nodes: live uniforms, no recompile), and the structure
 * written out.
 *
 * The drawing is data, not code: which shape each cell holds is packed into a few numbers (`gd`,
 * eight cells a number, three bits a cell), hidden sliders on the Grid scene node, so drawing and
 * erasing change uniforms and never the shader. A pixel looks up only the cells near it:
 *
 *   - for each shape, the motion is inverted to find the home cells whose shape could be here now
 *     (gs_find…): a fixed-point iteration of home = X − (P(home) − home), exact for lag 0 and
 *     converging while lag keeps neighbours close; past that, the middle of the path widened by its
 *     range. Travel and Hop solve their wrap round the grid. Each candidate cell is read in the
 *     drawing (after the draw mode: repeat, mirror, rotate) and drawn only when it holds this shape.
 *     The search is a square of cells whose radius is worked out live from the shape's sliders (size,
 *     pulse, outline, the pattern's push and grow, the motion): loops to MAX_SEARCH that stop there,
 *     so dragging a slider never cuts a shape and never recompiles;
 *   - with "copies match the drawn cell", a copy runs as the drawn cell it copies (its lag, rules,
 *     wave and picture in the drawing's frame), then is put back where it shows;
 *   - the rules are plain `if`s on the cell being drawn: in a cell, a column or a row, sharing a cell
 *     with (or near) a shape of another kind, which searches that shape's cells the same way;
 *   - the pattern's fill puts its shape in every empty cell, searched round the pixel's cell so a
 *     big, pulsing or pushed fill shape reaches across its cell's edge;
 *   - pictures: every picture the scene uses is a sampler argument; each shape carries its own
 *     picture in its mode (in each cell, mask, matte colour, matte piece), and the picture pattern and
 *     mask read the brightness at each shape's own cell.
 *
 * Every function's name ends in a short hash of the code, so two grid scenes in one graph never
 * clash (identical code is the same text, which the compiler adds once).
 *
 * Coordinates inside: cell units, x right, y down (as the mini grid), a cell's centre at +0.5.
 * Shapes are measured with y up. The result is vec4(colour, distance in picture units); `hp` gets the
 * winning shape's home centre and piece place (picture units).
 */
import { PIC_MODES, SHAPE_KINDS, cellSize, clauseNeedsB, drawOf, picModeOf, ruleClauses, ruleProblem, shapeOf, type GShape, type GridClause, type GridDo, type GridRule, type GridSceneSpec, type MotionPath, type PatternKind, type ShapeKind } from './spec';
import { findTex } from '../builders/textures';
import { readTextMask, textMaskGlsl, type TextMask } from './textMask';

/** The pattern's text mask when it has words and a pattern to mask (else null). */
export function activeMask(spec: GridSceneSpec): TextMask | null {
  if (spec.pattern.kind === 'none') return null;
  const m = readTextMask(spec.pattern.mask);
  return m && m.text ? m : null;
}

/** A GLSL float literal. */
export const gf = (n: number) => {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 1e6) / 1e6;
  const s = String(v);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const v2 = (x: number, y: number) => `vec2(${gf(x)}, ${gf(y)})`;
const v3 = (c: readonly number[]) => `vec3(${gf(c[0])}, ${gf(c[1])}, ${gf(c[2])})`;

/** FNV-1a, base 36: a short, stable name suffix. */
export function codeHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const kindIndex = (k: string) => Math.max(0, SHAPE_KINDS.indexOf(k as typeof SHAPE_KINDS[number]));

/** The shapes' distance functions and helpers ($ is the name suffix). y up, radius s. */
const HELPERS = `float gs_dot2$(vec2 v) { return dot(v, v); }
float gs_box$(vec2 q, vec2 b) { vec2 d = abs(q) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float gs_tri$(vec2 p, float r) {
  float k = 1.7320508;
  p.x = abs(p.x) - r; p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float gs_hex$(vec2 p, float r) {
  vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p); p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float gs_star$(vec2 p, float r) {
  vec2 k1 = vec2(0.809016994375, -0.587785252292);
  vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = 0.45 * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float gs_heart$(vec2 q, float s) {
  float z = 1.9 * s;
  vec2 p = q / z + vec2(0.0, 0.5);
  p.x = abs(p.x);
  float d = (p.y + p.x > 1.0) ? sqrt(gs_dot2$(p - vec2(0.25, 0.75))) - 0.35355339
    : sqrt(min(gs_dot2$(p - vec2(0.0, 1.0)), gs_dot2$(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
  return d * z;
}
float gs_sdf$(float k, vec2 q, float s) {
  if (k < 0.5) return length(q) - s;
  if (k < 1.5) return gs_box$(q, vec2(s * 0.85));
  if (k < 2.5) return abs(length(q) - s * 0.75) - s * 0.25;
  if (k < 3.5) return (abs(q.x) + abs(q.y) - s) * 0.7071068;
  if (k < 4.5) return gs_tri$(q, s * 0.9);
  if (k < 5.5) return gs_hex$(q, s * 0.9);
  if (k < 6.5) return gs_star$(q, s * 1.1);
  if (k < 7.5) return min(gs_box$(q, vec2(s, s * 0.3)), gs_box$(q, vec2(s * 0.3, s)));
  if (k < 8.5) { vec2 r = mat2(0.7071068, 0.7071068, -0.7071068, 0.7071068) * q; return min(gs_box$(r, vec2(s, s * 0.25)), gs_box$(r, vec2(s * 0.25, s))); }
  return gs_heart$(q, s);
}
vec3 gs_hue$(vec3 c, float a) {
  vec3 k = vec3(0.57735027);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}`;

/** The offset of a motion path (cells, y up) from a = phase in radians and ph = phase in cycles. */
function pathOffset(path: MotionPath): string {
  switch (path) {
    case 'updown': return 'vec2(0.0, m.y * sin(a))';
    case 'sideways': return 'vec2(m.x * sin(a), 0.0)';
    case 'both': return 'm.xy * sin(a)';
    case 'circle': return 'vec2(m.x * cos(a), m.y * sin(a))';
    case 'eight': return 'vec2(m.x * sin(a), m.y * sin(2.0 * a))';
    case 'bounce': return 'vec2(0.0, m.y * abs(sin(a * 0.5)))';
    case 'travel': return 'm.xy * ph';
    case 'hop': return 'm.xy * floor(ph)';
    default: return 'vec2(0.0)';
  }
}

/** The pattern's wave −1 … 1 at cell position P (cell units), from pt = (amount, freq, speed, arms). */
function waveBody(kind: PatternKind, spec: GridSceneSpec): string {
  const big = gf(Math.max(spec.cols, spec.rows));
  const lines = [
    `  vec2 c = P - ${v2(spec.cols / 2, spec.rows / 2)};`,
    '  vec2 id = floor(P);',
    '  float ph = t * pt.z * 6.2831853;',
    `  float k = pt.y * 6.2831853 / ${big};`,
  ];
  switch (kind) {
    case 'ripple': lines.push('  return sin(length(c) * k - ph);'); break;
    case 'diagonal': lines.push('  return sin((c.x + c.y) * 0.7071068 * k - ph);'); break;
    case 'stripes': lines.push('  return sin(c.x * k - ph);'); break;
    case 'checker': lines.push('  return (mod(id.x + id.y, 2.0) * 2.0 - 1.0) * cos(ph * 0.5);'); break;
    case 'rings': lines.push('  return cos(floor(length(c) * pt.y * 0.25 + 0.5) * 3.1415927 - ph);'); break;
    case 'spiral': lines.push('  return sin(atan(c.y, c.x) * floor(pt.w + 0.5) + length(c) * k - ph);'); break;
    case 'random': lines.push('  return sin(fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853 + ph);'); break;
    default: lines.push('  return 0.0;');
  }
  return lines.join('\n');
}

/** The pictures the scene function reads, in argument order (tx0, tx1…): the shapes', the pattern's, the mask's (only those the scene has). */
export function sceneTextures(spec: GridSceneSpec): string[] {
  const have = (n: string | undefined): n is string => !!n && !!findTex(spec.textures, n);
  const out: string[] = [];
  for (const s of spec.shapes) if (have(s.tex)) out.push(s.tex);
  if (spec.pattern.kind === 'picture' && have(spec.pattern.tex)) out.push(spec.pattern.tex);
  if (spec.picMask && have(spec.picMask.tex)) out.push(spec.picMask.tex);
  return [...new Set(out)];
}

/** A picture's width ÷ height (1 when not known). */
const aspectOf = (spec: GridSceneSpec, name: string) => findTex(spec.textures, name)?.aspect ?? 1;
const texArg = (i: number) => `tx${i}`;

/** The wave at a shape's own cell: the pattern's function, or (a picture pattern) the picture's brightness there, −1 … 1. */
function waveExpr(spec: GridSceneSpec, texs: string[]): string {
  if (spec.pattern.kind !== 'picture') return 'gs_wave$(P, t, pt)';
  const i = spec.pattern.tex ? texs.indexOf(spec.pattern.tex) : -1;
  return i < 0 ? '0.0' : `(gs_lum$(${texArg(i)}, floor(P), ${gf(aspectOf(spec, spec.pattern.tex!))}) * 2.0 - 1.0)`;
}

/** What the pattern's target does to a shape's s (size), an (angle), P (place), c (colour). */
function targetLines(spec: GridSceneSpec, texs: string[], pad: string): string[] {
  if (spec.pattern.kind === 'none') return [];
  const out = [`${pad}float w = ${waveExpr(spec, texs)};`];
  // The text mask: the wave only in the cells the words cover.
  if (activeMask(spec)) out.push(`${pad}w *= gs_mask$(floor(P));`);
  switch (spec.pattern.target) {
    case 'size': out.push(`${pad}s *= max(0.0, 1.0 + pt.x * w);`); break;
    case 'turn': out.push(`${pad}an += pt.x * w * 3.1415927;`); break;
    case 'push': out.push(`${pad}P += vec2(cos(w * 3.1415927), sin(w * 3.1415927)) * pt.x * 0.3;`); break;
    case 'hue': out.push(`${pad}c = gs_hue$(c, pt.x * w * 3.1415927);`); break;
    case 'bright': out.push(`${pad}c *= max(0.0, 1.0 + pt.x * w);`); break;
  }
  return out;
}

/** The argument names of a shape's numbers: motion, look, edge, colour. */
export const shapeArgs = (id: string) => ({ m: `m${id}`, l: `l${id}`, e: `e${id}`, c: `c${id}` });

/**
 * The rules that run, with their swaps mirrored (A swaps with B: B takes A's colour too). Only a
 * swap on its one condition is mirrored: with and / or, only A's side changes. The mirror has no
 * Else (that is A's) and stays changed when the rule does.
 */
export function activeRules(spec: GridSceneSpec): GridRule[] {
  const out: GridRule[] = [];
  for (const r of spec.rules) {
    if (!r.on || ruleProblem(spec, r)) continue;
    out.push(r);
    if (r.do.kind === 'swap' && r.when.b && r.when.b !== r.when.a && !r.also?.length) out.push({ ...r, id: `${r.id}~`, when: { ...r.when, a: r.when.b, b: r.when.a }, else: null });
  }
  return out;
}

/** The rules that stay changed, in the order of their bits in the memory pass (at most 16: two channels of 8). */
export const stickyRules = (spec: GridSceneSpec): GridRule[] => activeRules(spec).filter(r => r.sticky).slice(0, 16);
/** The memory pass's size: one texel per cell (square, the grid's longer side). */
export const memorySize = (spec: Pick<GridSceneSpec, 'cols' | 'rows'>) => Math.max(spec.cols, spec.rows);
/** A sticky rule's bit: its channel (x the red, y the green) and its place value there. */
const bitOf = (i: number) => ({ ch: i < 8 ? 'x' : 'y', p: 2 ** (i % 8) });
/** The Do and Else of a rule (what it can do to a shape). */
const doesOf = (r: GridRule): GridDo[] => [r.do, ...(r.else ? [r.else] : [])];

// ── The search ──────────────────────────────────────────────────────────────

/** How far a shape reaches from its centre, as a share of its radius, at its widest turn. */
const KIND_REACH: Record<ShapeKind, number> = {
  circle: 1, square: 1.21, ring: 1, diamond: 1, triangle: 1.04, hexagon: 1.04, star: 1.1, plus: 1.05, cross: 1.05, heart: 1.35, picture: 1.42,
};
/** Glow: the distance (cells from a shape's edge) it starts fading at, and where it is gone. Below 1: the search finds every shape within a cell. */
export const GLOW_FADE: readonly [number, number] = [0.35, 0.95];
/** The widest a search goes (cells either side): 13 × 13 cells. Its loops are this long and stop early at the live radius. */
export const MAX_SEARCH = 6;
const isWrap = (p: MotionPath) => p === 'travel' || p === 'hop';

/** The numbers a shape's search reads, live: its args (glsl names) or its spec values (the CPU mirror). */
interface Nums { size: number; pulse: number; outline: number; xy: [number, number]; lag: number; amount: number }
const numsOf = (spec: GridSceneSpec, s: GShape): Nums => ({ size: s.size, pulse: s.pulse, outline: s.outline, xy: s.motion.xy, lag: s.motion.lag, amount: spec.pattern.amount });

/**
 * A shape's reach from its place in cells, from its live numbers: its size, pulse, outline, the
 * pattern's grow and push, its rules' grow and become. As GLSL (`glsl`) over the scene function's
 * arguments, so dragging a slider widens the search with it (no rebuild), and on the CPU
 * (`cpu`) for the UI and the tests. Both the same sums.
 */
function reachSums(spec: GridSceneSpec, s: GShape, fill: boolean) {
  const P = spec.pattern;
  const kf = (x: GShape) => KIND_REACH[x.kind];
  const does = fill ? [] : activeRules(spec).filter(r => r.when.a === s.id).flatMap(doesOf);
  const grow = does.filter(d => d.kind === 'grow').reduce((g, d) => g * Math.max(1, d.amount ?? 1.5), 1);
  const become = does.filter(d => d.kind === 'become').map(d => shapeOf(spec, d.shape)).filter((x): x is GShape => !!x);
  const sizeGrow = !fill && P.kind !== 'none' && P.target === 'size';
  const push = P.kind !== 'none' && P.target === 'push';
  const glsl = () => {
    const a = shapeArgs(s.id);
    let r = `(${gf(kf(s) * 0.5)} * abs(${a.l}.x) * (1.0 + 0.5 * max(${a.l}.w, 0.0)) + max(${a.e}, 0.0) * 0.5)`;
    for (const to of become) { const b = shapeArgs(to.id); r = `max(${r}, ${gf(kf(to) * 0.5)} * abs(${b.l}.x) + max(${b.e}, 0.0) * 0.5)`; }
    if (grow !== 1) r = `${r} * ${gf(grow)}`;
    if (sizeGrow) r = `${r} * (1.0 + max(pt.x, 0.0))`;
    if (push) r = `${r} + 0.3 * max(pt.x, 0.0)`;
    return r;
  };
  const cpu = (n: (x: GShape) => Nums) => {
    const v = n(s);
    let r = kf(s) * 0.5 * Math.abs(v.size) * (1 + 0.5 * Math.max(v.pulse, 0)) + Math.max(v.outline, 0) * 0.5;
    for (const to of become) { const b = n(to); r = Math.max(r, kf(to) * 0.5 * Math.abs(b.size) + Math.max(b.outline, 0) * 0.5); }
    r *= grow;
    if (sizeGrow) r *= 1 + Math.max(v.amount, 0);
    if (push) r += 0.3 * Math.max(v.amount, 0);
    return r;
  };
  return { glsl, cpu };
}

/** A shape's reach in cells at its spec's values (the CPU mirror of the shader's live sum). */
export const shapeReach = (spec: GridSceneSpec, s: GShape, fill = false) => reachSums(spec, s, fill).cpu(x => numsOf(spec, x));

/**
 * A path's half-range (how far it strays from the middle of its path, A) and fastest rate (cells a
 * cycle, D): with lag, neighbouring cells are lag of a cycle apart, so their places differ by at most
 * 2 · D · lag a cell (L, the inverse's contraction).
 */
function pathRates(path: MotionPath, m: string): { A: string; D: string; mid: string } {
  const ax = `abs(${m}.x)`, ay = `abs(${m}.y)`, mx = `max(${ax}, ${ay})`;
  switch (path) {
    case 'updown': return { A: ay, D: `6.2831853 * ${ay}`, mid: 'vec2(0.0)' };
    case 'sideways': return { A: ax, D: `6.2831853 * ${ax}`, mid: 'vec2(0.0)' };
    case 'both': case 'circle': return { A: mx, D: `6.2831853 * ${mx}`, mid: 'vec2(0.0)' };
    case 'eight': return { A: mx, D: `max(6.2831853 * ${ax}, 12.5663706 * ${ay})`, mid: 'vec2(0.0)' };
    case 'bounce': return { A: `0.5 * ${ay}`, D: `3.1415927 * ${ay}`, mid: `vec2(0.0, -0.5 * ${m}.y)` };
    default: return { A: '0.0', D: '0.0', mid: 'vec2(0.0)' };
  }
}

/** The same on the CPU, for a shape at its spec's values. */
function pathRatesCpu(path: MotionPath, xy: [number, number]): { A: number; D: number } {
  const x = Math.abs(xy[0]), y = Math.abs(xy[1]), m = Math.max(x, y), T = Math.PI * 2;
  switch (path) {
    case 'updown': return { A: y, D: T * y };
    case 'sideways': return { A: x, D: T * x };
    case 'both': case 'circle': return { A: m, D: T * m };
    case 'eight': return { A: m, D: Math.max(T * x, 2 * T * y) };
    case 'bounce': return { A: y / 2, D: Math.PI * y };
    default: return { A: 0, D: 0 };
  }
}

/** The fixed-point inverse is used while its contraction L is below this (above it shapes overtake each other: the path's range bounds the search). */
const MAX_CONTRACTION = 0.8;

/**
 * The search radius (cells either side, before the cap) a shape's search uses at its spec's values,
 * as the shader works it out live: for the UI's warning and the tests. Glow adds a cell to the reach
 * (every shape within a cell of the point is found, so the glow can fade out by then: GLOW_FADE).
 */
export function searchRadiusAt(spec: GridSceneSpec, s: GShape, fill = false): number {
  const glow = spec.look.glow ? 1 : 0;
  const rch = shapeReach(spec, s, fill) + glow;
  if (fill) return Math.floor(rch + 0.5);
  const m = s.motion;
  const lag = Math.abs(m.lag) < 1e-6 ? 0 : Math.abs(m.lag);
  const big = Math.max(Math.abs(m.xy[0]), Math.abs(m.xy[1]));
  let R: number;
  if (isWrap(m.path)) {
    const source = copiesMatch(spec) && lag > 0;
    R = rch + (source ? big * lag * (spec.cols + spec.rows) / 2 + (m.path === 'hop' ? big : 0) : 2 * big * lag * (rch + 1) + (m.path === 'hop' && lag ? big / 2 : 0));
  } else {
    const { A, D } = pathRatesCpu(m.path, m.xy);
    const L = copiesMatch(spec) ? (lag ? Infinity : 0) : 2 * lag * D;
    const Ri = L < MAX_CONTRACTION ? rch / (1 - L) : Infinity;
    R = Math.min(Ri, rch + A);
  }
  return Math.floor(R + 0.5);
}

/** Would a shape's search be cut by the cap at its spec's values (the builder says so)? */
export const searchCapped = (spec: GridSceneSpec, s: GShape) => searchRadiusAt(spec, s) > MAX_SEARCH;

/** Copies take the drawn cell's lag, rules and pictures (draw option "Copies match the drawn cell"). */
const copiesMatch = (spec: GridSceneSpec) => drawOf(spec).mode !== 'here' && drawOf(spec).copies === 'source';

/**
 * The lines that loop `h` over the home cells of shape `s` whose shape could be within `rch` (a
 * GLSL float, cells) of point X now. The radius is worked out live (gs_find…): the loops run to
 * MAX_SEARCH and stop at it. The body runs once per candidate (it reads the drawing itself).
 */
function searchLoop(spec: GridSceneSpec, s: GShape, X: string, rch: string, glow: boolean, m: string, body: string[], pad: string): string[] {
  const dims = v2(spec.cols, spec.rows);
  const M = MAX_SEARCH;
  const inner = (p: string) => [
    `${p}for (int j = 0; j <= ${2 * M}; j++) {`,
    `${p}  if (float(j) > 2.0 * R) break;`,
    `${p}  for (int i = 0; i <= ${2 * M}; i++) {`,
    `${p}    if (float(i) > 2.0 * R) break;`,
    `${p}    vec2 h = hc + vec2(float(i), float(j)) - R;`,
    ...(isWrap(s.motion.path) ? [`${p}    h = h - ${dims} * floor(h / ${dims});`] : []),
    ...body.map(l => `${p}    ${l}`),
    `${p}  }`,
    `${p}}`,
  ];
  const cap = (r: string) => `min(${gf(M)}, floor(${r} + 0.5))`;
  // With glow the search reaches a cell further (inside the motion's inverse, so lag widens it too):
  // every shape within a cell of X is found, and the glow fades out by then (GLOW_FADE).
  if (glow) rch = `(${rch} + 1.0)`;
  if (!isWrap(s.motion.path)) {
    return [`${pad}{`, `${pad}  float R;`, `${pad}  vec2 hc = gs_find${s.id}$(${X}, t, ${m}, ${rch}, R);`, `${pad}  R = ${cap('R')};`, ...inner(`${pad}  `), `${pad}}`];
  }
  // Travel / Hop: each way round the wrap (only the first when every cell moves alike).
  return [
    `${pad}{`,
    `${pad}  float R = ${cap(`gs_spread${s.id}$(${m}, ${rch})`)};`,
    `${pad}  for (int kj = -1; kj <= 1; kj++) {`,
    `${pad}    for (int ki = -1; ki <= 1; ki++) {`,
    `${pad}      if (abs(${m}.w) < 1.0e-6 && (ki != 0 || kj != 0)) continue;`,
    `${pad}      vec2 hw = gs_home${s.id}$(${X}, t, ${m}, vec2(float(ki), float(kj)));`,
    `${pad}      if (hw.x < -R - 1.0 || hw.y < -R - 1.0 || hw.x > ${gf(spec.cols)} + R || hw.y > ${gf(spec.rows)} + R) continue;`,
    `${pad}      vec2 hc = floor(hw + 0.5);`,
    ...inner(`${pad}      `),
    `${pad}    }`,
    `${pad}  }`,
    `${pad}}`,
  ];
}

/** A shape's motion and its inverse: where a home cell's shape is now, and the home cells a shape at X can come from. */
function motionFns(spec: GridSceneSpec, s: GShape): string[] {
  const wrap = isWrap(s.motion.path);
  const dims = v2(spec.cols, spec.rows);
  const source = copiesMatch(spec);
  // `ls`: the cell whose lag it runs on (its own, or with "copies match", the drawn cell it copies).
  const out = [[
    `vec2 gs_move${s.id}$(vec2 home, float ls, float t, vec4 m) {`,
    '  float ph = t * m.z + m.w * ls;',
    '  float a = ph * 6.2831853;',
    `  vec2 o = ${pathOffset(s.motion.path)};`,
    '  vec2 P = home + 0.5 + vec2(o.x, -o.y);',
    ...(wrap ? [`  P = fract(P / ${dims}) * ${dims};`] : []),
    '  return P;',
    '}',
  ].join('\n')];
  if (!wrap) {
    const { A, D, mid } = pathRates(s.motion.path, 'm');
    out.push([
      '// The home cell a shape at X comes from: the fixed point h = X − (P(h) − h), the place a cell\'s motion',
      '// puts it at, iterated while lag keeps neighbours close (L < 1); else the middle of the path, widened',
      '// by its range. R: how far round the centre to look (cells, before the glow\'s cell and the cap).',
      `vec2 gs_find${s.id}$(vec2 X, float t, vec4 m, float rch, out float R) {`,
      `  float L = ${source ? 'abs(m.w) < 1.0e-6 ? 0.0 : 1.0e9' : `2.0 * abs(m.w) * ${D}`};`,
      `  vec2 h = X - gs_move${s.id}$(vec2(0.0), 0.0, t, m);`,
      '  float dl = 0.0;',
      '  for (int n = 0; n < 8; n++) {',
      `    if (L >= ${gf(MAX_CONTRACTION)}) break;`,
      `    vec2 hn = X - (gs_move${s.id}$(h, h.x + h.y, t, m) - h);`,
      '    dl = max(abs(hn.x - h.x), abs(hn.y - h.y));',
      '    h = hn;',
      '    if (dl < 1.0e-3) break;',
      '  }',
      `  float Ri = L < ${gf(MAX_CONTRACTION)} ? (rch + L * dl) / (1.0 - L) : 1.0e9;`,
      `  float Rb = rch + ${A};`,
      '  if (Ri <= Rb) { R = Ri; return floor(h + 0.5); }',
      '  R = Rb;',
      `  return floor(X - ${mid});`,
      '}',
    ].join('\n'));
  } else {
    const big = 'max(abs(m.x), abs(m.y))';
    const S = gf((spec.cols + spec.rows) / 2);
    // P = home + 0.5 + a (T + lag (home.x + home.y)) round the grid: solved for home on wrap k (a continuous estimate).
    // With "copies match", a copy's lag comes from the cell it copies: the middle of those is used, the rest is spread.
    out.push([
      `vec2 gs_home${s.id}$(vec2 X, float t, vec4 m, vec2 k) {`,
      `  vec2 dims = ${dims};`,
      '  vec2 a = vec2(m.x, -m.y);',
      ...(source ? [`  float T = t * m.z + m.w * ${S};`, '  vec2 v = vec2(0.0);'] : [
        s.motion.path === 'hop' ? '  float T = abs(m.w) < 1.0e-6 ? floor(t * m.z) : t * m.z - 0.5;' : '  float T = t * m.z;',
        '  vec2 v = a * m.w;',
      ]),
      ...(source && s.motion.path === 'hop' ? ['  T = abs(m.w) < 1.0e-6 ? floor(T) : T - 0.5;'] : []),
      '  float den = 1.0 + v.x + v.y;',
      '  den = abs(den) < 0.05 ? (den < 0.0 ? -0.05 : 0.05) : den;',
      '  vec2 w = X - 0.5 - a * T;',
      '  vec2 h0 = w - v * ((w.x + w.y) / den);',
      // Wrap n (whole grids) moves the home by M n = dims n − v (dims · n) / den: the lag couples x and y, so a
      // wrap in one moves the other too. n is solved so the home lands mid-grid (M⁻¹, det = dims.x dims.y / den),
      // then k steps to the copies round it. (Rounding h0 / dims alone was off by v · dims · n / den cells, which
      // grows with time: shapes went missing in bands, cut by a seam.)
      '  vec2 c0 = vec2(dims.x - v.x * dims.x / den, -v.y * dims.x / den);',
      '  vec2 c1 = vec2(-v.x * dims.y / den, dims.y - v.y * dims.y / den);',
      '  vec2 g = 0.5 * dims - h0;',
      '  float det = c0.x * c1.y - c1.x * c0.y;',
      '  vec2 nr = vec2(c1.y * g.x - c1.x * g.y, c0.x * g.y - c0.y * g.x) / det;',
      '  vec2 n = floor(nr + 0.5) + k;',
      '  return h0 + c0 * n.x + c1 * n.y;',
      '}',
      `float gs_spread${s.id}$(vec4 m, float rch) {`,
      '  float lag = abs(m.w) < 1.0e-6 ? 0.0 : abs(m.w);',
      source
        ? `  return rch + ${big} * lag * ${S}${s.motion.path === 'hop' ? ` + (lag > 0.0 ? ${big} : 0.0)` : ''};`
        : `  return rch + 2.0 * ${big} * lag * (rch + 1.0)${s.motion.path === 'hop' ? ` + (lag > 0.0 ? 0.5 * ${big} : 0.0)` : ''};`,
      '}',
    ].join('\n'));
  }
  return out;
}

// A rule's id may end in ~ (a swap's mirror): never two underscores in a row (reserved in GLSL), so no _ before the suffix.
const ruleKey = (r: GridRule) => r.id.replace(/[^A-Za-z0-9]/g, 'm');
/** A rule's partner search for its condition k (shares a cell with, is near). */
const ruleFn = (r: GridRule, k: number) => `gs_r${ruleKey(r)}c${k}$`;
/** A rule's whole condition (its clauses joined by and / or), 1 or 0. */
const condFn = (r: GridRule) => `gs_c${ruleKey(r)}$`;
/** The shapes a rule's conditions meet (their motion is an argument of its condition function). */
const partnersOf = (r: GridRule): string[] => [...new Set(ruleClauses(r).filter(c => clauseNeedsB(c.when)).map(c => c.when.b!))];

/** One condition for the cell being drawn (C its cell, P its place, hs its home). */
function clauseExpr(r: GridRule, k: number, w: GridClause, cellArgs: string): string {
  switch (w.kind) {
    case 'cell': return `max(abs(C.x - ${gf(w.x ?? 0)}), abs(C.y - ${gf(w.y ?? 0)})) < 0.5`;
    case 'column': return `abs(C.x - ${gf(w.x ?? 0)}) < 0.5`;
    case 'row': return `abs(C.y - ${gf(w.y ?? 0)}) < 0.5`;
    case 'sameCell':
    case 'near': return `${ruleFn(r, k)}(P, C, hs, t, ${shapeArgs(w.b!).m}, gd${cellArgs}) > 0.5`;
  }
}

/** The call of a rule's condition function, from where P, C, hs, t, the shapes' motions and gd are (the scene, the memory pass). */
const condCall = (r: GridRule, cellArgs: string) => `${condFn(r)}(P, C, hs, t${partnersOf(r).map(id => `, ${shapeArgs(id).m}`).join('')}, gd${cellArgs})`;

function effect(spec: GridSceneSpec, r: GridRule, d: GridDo, pics: boolean, slotOf: (s: GShape) => number): string {
  switch (d.kind) {
    case 'become': {
      const to = shapeOf(spec, d.shape)!;
      const a = shapeArgs(to.id);
      return `k = ${gf(kindIndex(to.kind))}; s = ${a.l}.x * 0.5; c = ${a.c}; e = ${a.e} * 0.5;${pics ? ` pm = ${gf(PIC_MODES.indexOf(picModeOf(to)))}; ps = ${gf(slotOf(to))};` : ''}`;
    }
    case 'colour': return `c = ${v3(d.color ?? [1, 1, 1])};`;
    case 'swap': return `c = ${shapeArgs(r.when.b!).c};`;
    case 'grow': return `s *= ${gf(d.amount ?? 1.5)};`;
    case 'hide': return 'vis = 0.0;';
    case 'spin': return `an += t * ${gf(d.amount ?? 1)} * 6.2831853;`;
  }
}

export interface GridProgram {
  /** Every function, the name suffix in place. */
  functions: string;
  /** The scene function's name. */
  name: string;
  /** Its arguments after (uv, t, pt): per shape m, l, e, c; gd; then rp, rs (repeat); the pictures; pcut; suv; hp. */
  args: string[];
  /** How many drawn cells hold a shape the scene has (inside the grid). */
  placed: number;
  /** The drawing, packed: `gd`'s numbers, row by row, eight cells a number (shape slot 1–6, 0 empty, three bits each). */
  data: number[];
  /** The pictures read, in argument order (tx0…). */
  textures: string[];
  /** Some shape carries a picture: the function paints it over the winner's colour. */
  shapePics: boolean;
  /** A shape in Mask mode: the function reads `suv`, the point on the screen before the warps. */
  screen: boolean;
  /** A picture mask: the function reads `pcut`. */
  maskCut: boolean;
  /** Draw mode Repeat: the function reads rp (period, offset) and rs (shift). */
  repeat: boolean;
  /** The search radius per shape id at the spec's values (cells either side; the shader works it out live, capped at MAX_SEARCH). */
  radius: Record<string, number>;
  /** The fill's, the same way. */
  fillRadius: number;
  /**
   * Rules that stay changed: the memory pass (docs/grid-builder.md "Rules that stay changed"). The
   * scene function then reads `lt` (the pass's texture, one texel per cell holding its bits) and the
   * pass's Expression Block calls `latchName` with `latchArgs` over `latchFunctions`. Null without one.
   */
  memory: { size: number; rules: string[]; latchFunctions: string; latchName: string; latchArgs: string[] } | null;
}

/** The drawing packed for `gd` (see GridProgram.data). */
export function packDrawing(spec: GridSceneSpec): { data: number[]; placed: number } {
  const per = Math.ceil(spec.cols / 8);
  const data = new Array<number>(per * spec.rows).fill(0);
  const seen = new Set<string>();
  let placed = 0;
  for (const c of spec.cells) {
    const i = spec.shapes.findIndex(s => s.id === c.s);
    if (i < 0 || c.x < 0 || c.y < 0 || c.x >= spec.cols || c.y >= spec.rows || seen.has(`${c.x},${c.y}`)) continue;
    seen.add(`${c.x},${c.y}`);
    placed++;
    data[c.y * per + Math.floor(c.x / 8)] += (i + 1) * 8 ** (c.x % 8);
  }
  return { data, placed };
}

/** gs_src: the cell of the drawing cell h shows, through the draw mode (spec.ts sourceCell), or (−1, −1); gs_cell: its shape slot (1–6, 0 none). */
function cellFns(spec: GridSceneSpec, n: number, repeat: boolean): string {
  const d = drawOf(spec);
  const C = gf(spec.cols), R = gf(spec.rows);
  const map: string[] = [];
  switch (d.mode) {
    case 'repeat': map.push(
      '  vec2 per = max(floor(rp.xy + 0.5), vec2(1.0));',
      '  vec2 o = floor(rp.zw + 0.5);',
      '  vec2 r = h - o;',
      '  r.x -= floor(rs + 0.5) * floor(r.y / per.y);',
      '  h = o + r - per * floor(r / per);',
    ); break;
    case 'mirrorX': map.push(`  h.x = min(h.x, ${gf(spec.cols - 1)} - h.x);`); break;
    case 'mirrorY': map.push(`  h.y = min(h.y, ${gf(spec.rows - 1)} - h.y);`); break;
    case 'mirrorXY': map.push(`  h = min(h, ${v2(spec.cols - 1, spec.rows - 1)} - h);`); break;
    case 'rotate4': map.push(
      `  vec2 cc = ${v2((spec.cols - 1) / 2, (spec.rows - 1) / 2)};`,
      '  vec2 dd = h - cc;',
      '  for (int k = 0; k < 4; k++) {',
      '    if ((dd.x < 0.0 && dd.y <= 0.0) || (dd.x == 0.0 && dd.y == 0.0)) break;',
      '    dd = vec2(dd.y, -dd.x);',
      '  }',
      '  h = floor(cc + dd + 0.5);',
    ); break;
    default: break;
  }
  const outside = `h.x < 0.0 || h.y < 0.0 || h.x >= ${C} || h.y >= ${R}`;
  const rpArgs = repeat ? ', vec4 rp, float rs' : '';
  return [
    `vec2 gs_src$(vec2 h${rpArgs}) {`,
    `  if (${outside}) return vec2(-1.0);`,
    ...map,
    ...(map.length ? [`  if (${outside}) return vec2(-1.0);`] : []),
    '  return h;',
    '}',
    `float gs_cell$(float gd[${n}], vec2 h${rpArgs}) {`,
    `  h = gs_src$(h${repeat ? ', rp, rs' : ''});`,
    '  if (h.x < 0.0) return 0.0;',
    '  float cx = floor(h.x / 8.0);',
    `  float v = gd[int(h.y * ${gf(Math.ceil(spec.cols / 8))} + cx)];`,
    '  float k = h.x - cx * 8.0;',
    '  for (int n = 0; n < 7; n++) {',
    '    if (float(n) >= k) break;',
    '    v = floor(v * 0.125);',
    '  }',
    '  return v - 8.0 * floor(v * 0.125);',
    '}',
  ].join('\n');
}

/**
 * The memory pass's functions (docs/grid-builder.md "Rules that stay changed"): for the drawn cell
 * h (one texel a cell), the bits of the sticky rules whose conditions hold now (gs_fire), OR-ed
 * with the bits it had (gs_latch). Its shape's place is worked out as the scene does (its motion,
 * "copies match"), and each rule's condition is the same function the scene calls. A reset (above
 * 0.5) or the clock going back (a restart) forgets everything. Result: (bits 0–7, bits 8–15) ÷ 255
 * and the time.
 */
function memoryFns(spec: GridSceneSpec, sticky: GridRule[], n: number, repeat: boolean, source: boolean, cellArgs: string, ruleFns: string[]): { code: string; args: string[] } {
  const shapes = spec.shapes;
  const rpDecl = repeat ? ', vec4 rp, float rs' : '';
  const mDecl = shapes.map(s => `, vec4 ${shapeArgs(s.id).m}`).join('');
  const mArgs = shapes.map(s => `, ${shapeArgs(s.id).m}`).join('');
  const fire: string[] = [
    `vec2 gs_fire$(vec2 h, float t${mDecl}, float gd[${n}]${rpDecl}) {`,
    '  vec2 b = vec2(0.0);',
    `  float sl = gs_cell$(gd, h${cellArgs});`,
  ];
  shapes.forEach((sh, si) => {
    const mine = sticky.filter(r => r.when.a === sh.id);
    if (!mine.length) return;
    const m = shapeArgs(sh.id).m;
    fire.push(
      `  if (abs(sl - ${gf(si + 1)}) < 0.5) {`,
      source ? `    vec2 hs = gs_src$(h${cellArgs}); vec2 P = gs_move${sh.id}$(h, hs.x + hs.y, t, ${m}) - (h - hs);` : `    vec2 hs = h; vec2 P = gs_move${sh.id}$(h, h.x + h.y, t, ${m});`,
      '    vec2 C = floor(P);',
      ...mine.map(r => { const { ch, p } = bitOf(sticky.indexOf(r)); return `    if (${condCall(r, cellArgs)} > 0.5) b.${ch} += ${gf(p)}; // ${r.id}`; }),
      '  }',
    );
  });
  fire.push('  return b;', '}');
  const latch = [
    `vec3 gs_latch$(vec2 h, float t, vec4 pv, float reset${mDecl}, float gd[${n}]${rpDecl}) {`,
    '  vec2 held = floor(pv.rg * 255.0 + 0.5);',
    '  if (reset > 0.5 || t < pv.b - max(1.0, 0.002 * pv.b)) held = vec2(0.0);',
    `  vec2 f = gs_fire$(h, t${mArgs}, gd${cellArgs});`,
    '  vec2 o = vec2(0.0);',
    '  float p = 1.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    o += max(mod(floor(held / p), 2.0), mod(floor(f / p), 2.0)) * p;',
    '    p *= 2.0;',
    '  }',
    '  return vec3(o / 255.0, t);',
    '}',
  ];
  // What the conditions need: the drawing, the shapes' motions, the partner searches, the conditions.
  const code = [cellFns(spec, n, repeat), ...shapes.flatMap(s => motionFns(spec, s)), ...ruleFns, fire.join('\n'), latch.join('\n')].join('\n');
  return { code, args: ['h', 't', 'pv', 'reset', ...shapes.map(s => shapeArgs(s.id).m), 'gd', ...(repeat ? ['rp', 'rs'] : [])] };
}

/**
 * The whole program for a spec. `brute` (tests only) looks at every cell of the grid for every
 * shape instead of searching: the reference the search is checked against.
 */
export function gridProgram(spec: GridSceneSpec, opts: { brute?: boolean } = {}): GridProgram {
  const shapes = spec.shapes;
  const look = spec.look;
  const { data, placed } = packDrawing(spec);
  const n = data.length;
  const repeat = drawOf(spec).mode === 'repeat';
  const source = copiesMatch(spec);
  const cellArgs = repeat ? ', rp, rs' : '';
  const rules = activeRules(spec);
  const sticky = stickyRules(spec);
  const texs = sceneTextures(spec);
  const slotOf = (s: GShape) => (s.tex ? texs.indexOf(s.tex) : -1);
  const shapePics = shapes.some(s => slotOf(s) >= 0 || s.kind === 'picture');
  const screen = shapes.some(s => slotOf(s) >= 0 && picModeOf(s) === 'mask');
  const pm = spec.picMask && texs.includes(spec.picMask.tex) ? spec.picMask : null;
  const cs = gf(cellSize(spec));
  const params = [
    'vec2 uv', 'float t', 'vec4 pt',
    ...shapes.flatMap(s => { const a = shapeArgs(s.id); return [`vec4 ${a.m}`, `vec4 ${a.l}`, `float ${a.e}`, `vec3 ${a.c}`]; }),
    `float gd[${n}]`, ...(repeat ? ['vec4 rp', 'float rs'] : []),
    ...texs.map((_, i) => `sampler2D ${texArg(i)}`), ...(sticky.length ? ['sampler2D lt'] : []), ...(pm ? ['float pcut'] : []), ...(screen ? ['vec2 suv'] : []), 'inout vec4 hp',
  ];
  const args = [
    ...shapes.flatMap(s => { const a = shapeArgs(s.id); return [a.m, a.l, a.e, a.c]; }),
    'gd', ...(repeat ? ['rp', 'rs'] : []), ...texs.map((_, i) => texArg(i)), ...(sticky.length ? ['lt'] : []), ...(pm ? ['pcut'] : []), ...(screen ? ['suv'] : []), 'hp',
  ];
  // A picture cell is a square (k 10): only then does the shape function know it, so other scenes keep their shapes' code.
  const fns: string[] = [shapes.some(s => s.kind === 'picture') ? HELPERS.replace('  return gs_heart$(q, s);\n}', '  if (k < 9.5) return gs_heart$(q, s);\n  return gs_box$(q, vec2(s));\n}') : HELPERS];
  fns.push(cellFns(spec, n, repeat));
  fns.push(`vec2 gs_uv$(vec2 g) { return vec2((g.x - ${gf(spec.cols / 2)}) * ${cs}, (${gf(spec.rows / 2)} - g.y) * ${cs}); }`);
  if (texs.length) {
    const b = gf(spec.cols / spec.rows);
    fns.push([
      '// A place on the grid (cells) → the picture over the whole grid (Fill, keeping its shape).',
      'vec2 gs_gst$(vec2 g, float a) {',
      `  vec2 u = vec2(g.x / ${gf(spec.cols)} * 2.0 - 1.0, 1.0 - g.y / ${gf(spec.rows)} * 2.0);`,
      `  u = a > ${b} ? vec2(u.x * ${b} / a, u.y) : vec2(u.x, u.y * a / ${b});`,
      '  return u * 0.5 + 0.5;',
      '}',
      '// A place in a shape\'s square (0–1) → the picture filling it (Fill, keeping its shape).',
      'vec2 gs_sst$(vec2 g, float a) {',
      '  vec2 u = g * 2.0 - 1.0;',
      '  u = a > 1.0 ? vec2(u.x / a, u.y) : vec2(u.x, u.y * a);',
      '  return u * 0.5 + 0.5;',
      '}',
      'vec4 gs_tex$(sampler2D tx, vec2 st) { return texture2D(tx, st); }',
      '// A picture\'s brightness (times its alpha) at the centre of a cell.',
      'float gs_lum$(sampler2D tx, vec2 cell, float a) {',
      '  vec4 c = textureLod(tx, gs_gst$(cell + 0.5, a), 0.0);',
      '  return dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a;',
      '}',
    ].join('\n'));
  }
  const pmLine = (C: string) => (pm ? [`vis *= ${pm.invert ? '1.0 - ' : ''}step(pcut, gs_lum$(${texArg(texs.indexOf(pm.tex))}, ${C}, ${gf(aspectOf(spec, pm.tex))}));`] : []);
  const radius: Record<string, number> = {};
  for (const s of shapes) {
    radius[s.id] = Math.min(MAX_SEARCH, searchRadiusAt(spec, s));
    fns.push(...motionFns(spec, s));
  }
  if (spec.pattern.kind !== 'none' && spec.pattern.kind !== 'picture') fns.push(`float gs_wave$(vec2 P, float t, vec4 pt) {\n${waveBody(spec.pattern.kind, spec)}\n}`);
  const mask = activeMask(spec);
  if (mask) fns.push(textMaskGlsl(mask, spec.cols, spec.rows));
  /** Every cell of the grid round its middle (the brute force the tests check the search against). */
  const bruteLoop = (body: string[], pad: string) => {
    const R = Math.ceil(Math.max(spec.cols, spec.rows) / 2) + 1;
    return [
      `${pad}for (int j = -${R}; j <= ${R}; j++) {`,
      `${pad}  for (int i = -${R}; i <= ${R}; i++) {`,
      `${pad}    vec2 h = ${v2(Math.floor(spec.cols / 2), Math.floor(spec.rows / 2))} + vec2(float(i), float(j));`,
      `${pad}    if (h.x < 0.0 || h.y < 0.0 || h.x >= ${gf(spec.cols)} || h.y >= ${gf(spec.rows)}) continue;`,
      ...body.map(l => `${pad}    ${l}`),
      `${pad}  }`,
      `${pad}}`,
    ];
  };
  const search = (s: GShape, X: string, rch: string, glow: boolean, m: string, body: string[], pad: string) =>
    (opts.brute ? bruteLoop(body, pad) : searchLoop(spec, s, X, rch, glow, m, body, pad));
  // The rules' conditions with a partner: does a cell of the partner's shape share this cell (or come near)?
  // Then each rule's whole condition, its clauses joined by and / or (left to right), as one function the
  // scene and the memory pass both call.
  const ruleFns: string[] = [];
  const rpDecl = repeat ? ', vec4 rp, float rs' : '';
  for (const r of rules) {
    const clauses = ruleClauses(r);
    clauses.forEach((c, k) => {
      if (!clauseNeedsB(c.when)) return;
      const b = shapeOf(spec, c.when.b)!;
      const near = c.when.kind === 'near';
      const dist = Math.max(0.05, c.when.dist ?? 1);
      const body = [
        `if (abs(gs_cell$(gd, h${cellArgs}) - ${gf(shapes.indexOf(b) + 1)}) > 0.5) continue;`,
        // "Copies match": the rule is checked in the drawing's frame, so the partner is one of the drawn cells.
        ...(source ? [`if (gs_src$(h${cellArgs}) != h) continue;`] : []),
        ...(b.id === r.when.a ? ['if (h == self) continue;'] : []),
        `vec2 PB = gs_move${b.id}$(h, h.x + h.y, t, mB);`,
        near ? `if (distance(P, PB) <= ${gf(dist)}) return 1.0;` : 'if (max(abs(floor(PB).x - C.x), abs(floor(PB).y - C.y)) < 0.5) return 1.0;',
      ];
      ruleFns.push([
        `float ${ruleFn(r, k)}(vec2 P, vec2 C, vec2 self, float t, vec4 mB, float gd[${n}]${rpDecl}) {`,
        ...search(b, near ? 'P' : 'C + 0.5', gf(near ? dist : 0.5), false, 'mB', body, '  '),
        '  return 0.0;',
        '}',
      ].join('\n'));
    });
    ruleFns.push([
      `// rule ${r.id}: ${clauses.map((c, k) => `${k ? `${c.join} ` : ''}${c.when.kind}`).join(' ')}`,
      `float ${condFn(r)}(vec2 P, vec2 C, vec2 hs, float t${partnersOf(r).map(id => `, vec4 ${shapeArgs(id).m}`).join('')}, float gd[${n}]${rpDecl}) {`,
      ...clauses.map((c, k) => (k === 0 ? `  bool c = ${clauseExpr(r, k, c.when, cellArgs)};` : `  c = c ${c.join === 'or' ? '||' : '&&'} (${clauseExpr(r, k, c.when, cellArgs)});`)),
      '  return c ? 1.0 : 0.0;',
      '}',
    ].join('\n'));
  }
  fns.push(...ruleFns);
  if (sticky.length) {
    fns.push([
      '// The rules that stay changed: their bits for cell h, kept by the memory pass (one texel a cell: r bits 0–7, g bits 8–15, ÷ 255).',
      `vec2 gs_held$(sampler2D lt, vec2 h) { return floor(textureLod(lt, (h + 0.5) / ${gf(memorySize(spec))}, 0.0).rg * 255.0 + 0.5); }`,
    ].join('\n'));
  }
  const fill = spec.pattern.kind !== 'none' ? shapeOf(spec, spec.pattern.fill) : undefined;

  const picLines = (s: GShape) => (shapePics ? [`float pm = ${gf(PIC_MODES.indexOf(picModeOf(s)))}; float ps = ${gf(slotOf(s))};`] : []);
  /** The winner: its colour, its home and piece place (hp), and where its picture is read (pw). */
  const win = (home: string, an0: string) => [
    '  best = d; col = c;',
    `  vec2 qq = mat2(cos(${an0}), sin(${an0}), -sin(${an0}), cos(${an0})) * q * (s0 / max(s, 1.0e-4));`,
    `  hp = vec4(${home} + 0.5, ${home} + 0.5 + vec2(qq.x, -qq.y));`,
    ...(shapePics ? ['  pw = vec4(pm < 0.5 ? q / (2.0 * max(s, 1.0e-4)) + 0.5 : pm < 1.5 ? sp : pm < 2.5 ? hp.xy : hp.zw, step(0.5, pm), ps);'] : []),
  ];

  const L: string[] = [];
  L.push(`vec4 gs_scene$(${params.join(', ')}) {`);
  L.push(`  vec2 cp = vec2(uv.x / ${cs} + ${gf(spec.cols / 2)}, ${gf(spec.rows / 2)} - uv.y / ${cs});`);
  L.push('  float best = 1.0e5;');
  L.push('  vec3 col = vec3(0.0);');
  L.push('  hp = vec4(cp, cp);');
  if (shapePics) {
    L.push('  vec4 pw = vec4(0.0, 0.0, 0.0, -1.0);');
    L.push(screen ? `  vec2 sp = vec2(suv.x / ${cs} + ${gf(spec.cols / 2)}, ${gf(spec.rows / 2)} - suv.y / ${cs});` : '  vec2 sp = cp;');
  }
  const pulseRate = (s: GShape) => (s.motion.path === 'still' ? '1.0' : `${shapeArgs(s.id).m}.z`);
  shapes.forEach((sh, si) => {
    const a = shapeArgs(sh.id);
    const body: string[] = [
      `if (abs(gs_cell$(gd, h${cellArgs}) - ${gf(si + 1)}) > 0.5) continue;`,
      // hs: the cell it runs as (its own; with "copies match", the drawn cell it copies). Its lag, pulse,
      // rules, wave and picture are worked out there (P moved into the drawing's frame), then put back at h.
      source ? `vec2 hs = gs_src$(h${cellArgs}); vec2 dP = h - hs;` : 'vec2 hs = h;',
      `vec2 P = gs_move${sh.id}$(h, hs.x + hs.y, t, ${a.m});`,
      ...(source ? ['P -= dP;'] : []),
      'vec2 C = floor(P);',
      `float k = ${gf(kindIndex(sh.kind))}; float s = ${a.l}.x * 0.5; vec3 c = ${a.c}; float e = ${a.e} * 0.5; float vis = 1.0;`,
      ...picLines(sh),
      'float s0 = s;',
      `float an = ${a.l}.y + t * ${a.l}.z * 6.2831853;`,
      `s *= 1.0 + ${a.l}.w * 0.5 * sin((t * ${pulseRate(sh)} + ${a.m}.w * (hs.x + hs.y)) * 6.2831853);`,
      ...pmLine('C'),
    ];
    // The rules' conditions, from where the shape is (before the pattern's push): the same sums as the memory pass.
    const mine = rules.filter(r => r.when.a === sh.id);
    if (mine.some(r => sticky.includes(r))) body.push('vec2 hb = gs_held$(lt, h);');
    for (const r of mine) {
      const i = sticky.indexOf(r);
      const cond = i >= 0 ? `max(${condCall(r, cellArgs)}, mod(floor(hb.${bitOf(i).ch} / ${gf(bitOf(i).p)}), 2.0))` : condCall(r, cellArgs);
      body.push(`float f${ruleKey(r)} = ${cond};${i >= 0 ? ' // stays changed: or once it has held for this cell' : ''}`);
    }
    body.push(...targetLines(spec, texs, ''));
    for (const r of mine) {
      body.push(`if (f${ruleKey(r)} > 0.5) { ${effect(spec, r, r.do, shapePics, slotOf)} }${r.else ? ` else { ${effect(spec, r, r.else, shapePics, slotOf)} }` : ''} // ${r.id}`);
    }
    body.push(
      ...(source ? ['P += dP;'] : []),
      'vec2 q = cp - P; q.y = -q.y;',
      'q = mat2(cos(an), -sin(an), sin(an), cos(an)) * q;',
      'float d = gs_sdf$(k, q, s);',
      'if (e > 0.0) d = abs(d) - e;',
      'if (vis > 0.5 && d < best) {',
      ...win('hs', `${a.l}.y`),
      '}',
    );
    L.push(`  // shape ${sh.id} (${sh.kind}): the drawn cells whose shape could be here now, round the cell this point's would come from (the radius from its live size, pulse, motion and lag)`);
    L.push(...search(sh, 'cp', reachSums(spec, sh, false).glsl(), look.glow, a.m, body, '  '));
  });
  let fillRadius = 0;
  if (fill) {
    const a = shapeArgs(fill.id);
    fillRadius = Math.min(MAX_SEARCH, searchRadiusAt(spec, fill, true));
    const fb = [
      'vec2 id = floor(cp) + vec2(float(i), float(j)) - R;',
      `if (id.x < 0.0 || id.y < 0.0 || id.x >= ${gf(spec.cols)} || id.y >= ${gf(spec.rows)}) continue;`,
      `if (gs_cell$(gd, id${cellArgs}) > 0.5) continue;`,
      ...(mask ? ['if (gs_mask$(id) < 0.5) continue;'] : []),
      'vec2 P = id + 0.5;',
      `float k = ${gf(kindIndex(fill.kind))}; float s = ${a.l}.x * 0.5; vec3 c = ${a.c}; float e = ${a.e} * 0.5; float vis = 1.0;`,
      ...picLines(fill),
      'float s0 = s;',
      `float an = ${a.l}.y + t * ${a.l}.z * 6.2831853;`,
      `s *= 1.0 + ${a.l}.w * 0.5 * sin((t + ${a.m}.w * (id.x + id.y)) * 6.2831853);`,
      ...pmLine('id'),
    ];
    if (spec.pattern.target === 'size') fb.push(`float w = ${waveExpr(spec, texs)};`, 's *= mix(1.0, 0.5 + 0.5 * w, clamp(pt.x, 0.0, 1.0));');
    else fb.push(...targetLines(spec, texs, ''));
    fb.push(
      'vec2 q = cp - P; q.y = -q.y;',
      'q = mat2(cos(an), -sin(an), sin(an), cos(an)) * q;',
      'float d = gs_sdf$(k, q, s);',
      'if (e > 0.0) d = abs(d) - e;',
      'if (vis > 0.5 && s > 0.002 && d < best) {',
      ...win('id', `${a.l}.y`),
      '}',
    );
    L.push(`  // the pattern fills the empty cells with shape ${fill.id}: this point's cell and the ones round it (as far as its live size reaches), so a big shape reaches over its cell's edge`);
    L.push('  {');
    L.push(`    float R = min(${gf(MAX_SEARCH)}, floor(${reachSums(spec, fill, true).glsl()} + ${look.glow ? '1.5' : '0.5'}));`);
    L.push(`    for (int j = 0; j <= ${2 * MAX_SEARCH}; j++) {`);
    L.push('      if (float(j) > 2.0 * R) break;');
    L.push(`      for (int i = 0; i <= ${2 * MAX_SEARCH}; i++) {`);
    L.push('        if (float(i) > 2.0 * R) break;');
    L.push(...fb.map(l => `        ${l}`));
    L.push('      }');
    L.push('    }');
    L.push('  }');
  }
  if (shapePics) {
    // The winner's picture: each picture a shape carries is read once (outside any branch), the winner's kept.
    const used = [...new Set(shapes.map(slotOf).filter(i => i >= 0))];
    if (used.length) {
      L.push('  vec4 tc = vec4(0.0);');
      for (const i of used) {
        const a = gf(aspectOf(spec, texs[i]));
        L.push(`  vec4 t${i} = gs_tex$(${texArg(i)}, pw.z < 0.5 ? gs_sst$(pw.xy, ${a}) : gs_gst$(pw.xy, ${a}));`);
        L.push(`  if (abs(pw.w - ${gf(i)}) < 0.5) tc = t${i};`);
      }
      L.push('  if (pw.w > -0.5) col = mix(col, tc.rgb, clamp(tc.a, 0.0, 1.0));');
    }
  }
  // The glow reads the distance: past GLOW_FADE[0] it is stretched to "far" by GLOW_FADE[1] cells, where the
  // search is still sure to have found every shape (it reaches a cell further with glow), so the glow
  // never steps where neighbouring pixels search different cells.
  if (look.glow) L.push(`  if (best > ${gf(GLOW_FADE[0])}) best = best >= ${gf(GLOW_FADE[1])} ? 1.0e5 : best / max(1.0 - smoothstep(${gf(GLOW_FADE[0])}, ${gf(GLOW_FADE[1])}, best), 1.0e-5);`);
  L.push('  hp = vec4(gs_uv$(hp.xy), gs_uv$(hp.zw));');
  L.push(`  return vec4(col, best * ${cs});`);
  L.push('}');
  fns.push(L.join('\n'));
  const latch = sticky.length ? memoryFns(spec, sticky, n, repeat, source, cellArgs, ruleFns) : null;
  const code = fns.join('\n');
  // One suffix for the scene and its memory pass (the pass shares the scene's motion and condition functions).
  const h = `_${codeHash(code + (latch?.code ?? ''))}`;
  const named = (x: string) => x.split('$').join(h);
  return {
    functions: named(code), name: `gs_scene${h}`, args, placed, data,
    textures: texs, shapePics, screen, maskCut: !!pm, repeat, radius, fillRadius,
    memory: latch ? { size: memorySize(spec), rules: sticky.map(r => r.id), latchFunctions: named(latch.code), latchName: `gs_latch${h}`, latchArgs: latch.args } : null,
  };
}
