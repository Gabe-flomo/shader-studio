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
 *   - for each shape, the motion is inverted to find the home cells whose shape could be here now:
 *     exactly when every cell moves alike (lag 0), else round the middle of the path, the search
 *     widened by the path's reach; Travel and Hop solve their wrap round the grid. Each candidate
 *     cell is read in the drawing (after the draw mode: repeat, mirror, rotate) and drawn only when it
 *     holds this shape. The search is a square of cells, its radius from the shape's size, pulse, the
 *     pattern's push and grow, outline, and the motion (searchRadius);
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
import { PIC_MODES, SHAPE_KINDS, cellSize, drawOf, picModeOf, ruleProblem, shapeOf, type GShape, type GridRule, type GridSceneSpec, type MotionPath, type PatternKind, type ShapeKind } from './spec';
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

/** The rules that run, with their swaps mirrored (A swaps with B: B takes A's colour too). */
export function activeRules(spec: GridSceneSpec): GridRule[] {
  const out: GridRule[] = [];
  for (const r of spec.rules) {
    if (!r.on || ruleProblem(spec, r)) continue;
    out.push(r);
    if (r.do.kind === 'swap' && r.when.b && r.when.b !== r.when.a) out.push({ ...r, id: `${r.id}~`, when: { ...r.when, a: r.when.b, b: r.when.a } });
  }
  return out;
}

// ── The search ──────────────────────────────────────────────────────────────

/** How far a shape reaches from its centre, as a share of its radius, at its widest turn. */
const KIND_REACH: Record<ShapeKind, number> = {
  circle: 1, square: 1.21, ring: 1, diamond: 1, triangle: 1.04, hexagon: 1.04, star: 1.1, plus: 1.05, cross: 1.05, heart: 1.35, picture: 1.42,
};
/** The widest a search goes (cells either side): 13 × 13 cells. */
export const MAX_SEARCH = 6;
const isWrap = (p: MotionPath) => p === 'travel' || p === 'hop';

/** A shape's reach from its place, in cells: its size (at least 1, so a slider drag up to 1 stays drawn whole), pulse, outline, the pattern's grow and push, its rules' grow and become. */
export function shapeReach(spec: GridSceneSpec, s: GShape, fill = false): number {
  const P = spec.pattern;
  const base = (x: GShape) => KIND_REACH[x.kind] * 0.5 * Math.max(x.size, 1) + Math.max(0, x.outline) * 0.5;
  let r = KIND_REACH[s.kind] * 0.5 * Math.max(s.size, 1) * (1 + 0.5 * Math.max(0, s.pulse)) + Math.max(0, s.outline) * 0.5;
  if (!fill) {
    let grow = 1;
    for (const ru of activeRules(spec)) {
      if (ru.when.a !== s.id) continue;
      if (ru.do.kind === 'grow') grow *= Math.max(1, ru.do.amount ?? 1.5);
      if (ru.do.kind === 'become') { const to = shapeOf(spec, ru.do.shape); if (to) r = Math.max(r, base(to)); }
    }
    r *= grow;
    if (P.kind !== 'none' && P.target === 'size') r *= 1 + Math.max(0, P.amount);
  }
  if (P.kind !== 'none' && P.target === 'push') r += 0.3 * Math.max(0, P.amount);
  return r;
}

/** How far a shape's place can stray from the search's estimate, in cells: 0 when every cell moves alike (lag 0). */
export function motionSpread(s: GShape, reach: number): number {
  const m = s.motion;
  if (!m.lag) return 0;
  const x = Math.abs(m.xy[0]), y = Math.abs(m.xy[1]);
  switch (m.path) {
    case 'updown': return y;
    case 'bounce': return y / 2;
    case 'sideways': return x;
    case 'both': case 'circle': case 'eight': return Math.max(x, y);
    case 'travel': return 2 * Math.max(x, y) * Math.abs(m.lag) * (reach + 1);
    case 'hop': return Math.max(x, y) / 2 + 2 * Math.max(x, y) * Math.abs(m.lag) * (reach + 1);
    default: return 0;
  }
}

/** The search's radius in cells (the square is 2r + 1 across) for a reach in cells; glow adds a cell so halos stay. */
export const searchRadius = (reach: number, glow: boolean) => Math.max(0, Math.min(MAX_SEARCH, Math.floor(reach + 0.5 + (glow ? 1 : 0))));

/**
 * The lines that loop `h` over the home cells of shape `s` whose shape could be within reach of
 * point X (cell units) now, radius R. The body runs once per candidate (it reads the drawing itself).
 */
function searchLoop(spec: GridSceneSpec, s: GShape, X: string, R: number, m: string, body: string[], pad: string): string[] {
  const dims = v2(spec.cols, spec.rows);
  const inner = (centre: string, p: string) => [
    `${p}for (int j = -${R}; j <= ${R}; j++) {`,
    `${p}  for (int i = -${R}; i <= ${R}; i++) {`,
    `${p}    vec2 h = ${centre} + vec2(float(i), float(j));`,
    ...(isWrap(s.motion.path) ? [`${p}    h = h - ${dims} * floor(h / ${dims});`] : []),
    ...body.map(l => `${p}    ${l}`),
    `${p}  }`,
    `${p}}`,
  ];
  if (!isWrap(s.motion.path)) return [`${pad}{`, `${pad}  vec2 hc = gs_home${s.id}$(${X}, t, ${m});`, ...inner('hc', `${pad}  `), `${pad}}`];
  // Travel / Hop: each way round the wrap (only the first when every cell moves alike).
  return [
    `${pad}for (int kj = -1; kj <= 1; kj++) {`,
    `${pad}  for (int ki = -1; ki <= 1; ki++) {`,
    `${pad}    if (abs(${m}.w) < 1.0e-6 && (ki != 0 || kj != 0)) continue;`,
    `${pad}    vec2 hw = gs_home${s.id}$(${X}, t, ${m}, vec2(float(ki), float(kj)));`,
    `${pad}    if (hw.x < ${gf(-R - 1)} || hw.y < ${gf(-R - 1)} || hw.x > ${gf(spec.cols + R)} || hw.y > ${gf(spec.rows + R)}) continue;`,
    `${pad}    vec2 hc = floor(hw + 0.5);`,
    ...inner('hc', `${pad}    `),
    `${pad}  }`,
    `${pad}}`,
  ];
}

/** A shape's motion and its inverse: where a home cell's shape is now, and the home cell a shape at X comes from. */
function motionFns(spec: GridSceneSpec, s: GShape): string[] {
  const wrap = isWrap(s.motion.path);
  const dims = v2(spec.cols, spec.rows);
  const out = [[
    `vec2 gs_move${s.id}$(vec2 home, float t, vec4 m) {`,
    '  float ph = t * m.z + m.w * (home.x + home.y);',
    '  float a = ph * 6.2831853;',
    `  vec2 o = ${pathOffset(s.motion.path)};`,
    '  vec2 P = home + 0.5 + vec2(o.x, -o.y);',
    ...(wrap ? [`  P = fract(P / ${dims}) * ${dims};`] : []),
    '  return P;',
    '}',
  ].join('\n')];
  if (!wrap) {
    // Every cell alike (lag 0): exactly the cell; else the middle of the path (the search's spread covers the rest).
    const mid = s.motion.path === 'bounce' ? 'vec2(0.0, -0.5 * m.y)' : 'vec2(0.0)';
    out.push([
      `vec2 gs_home${s.id}$(vec2 X, float t, vec4 m) {`,
      `  vec2 o = abs(m.w) < 1.0e-6 ? gs_move${s.id}$(vec2(0.0), t, vec4(m.xyz, 0.0)) - 0.5 : ${mid};`,
      '  return floor(X - o);',
      '}',
    ].join('\n'));
  } else {
    // P = home + 0.5 + a (T + lag (home.x + home.y)) round the grid: solved for home on wrap k (a continuous estimate).
    out.push([
      `vec2 gs_home${s.id}$(vec2 X, float t, vec4 m, vec2 k) {`,
      `  vec2 dims = ${dims};`,
      '  vec2 a = vec2(m.x, -m.y);',
      s.motion.path === 'hop' ? '  float T = abs(m.w) < 1.0e-6 ? floor(t * m.z) : t * m.z - 0.5;' : '  float T = t * m.z;',
      '  vec2 v = a * m.w;',
      '  float den = 1.0 + v.x + v.y;',
      '  den = abs(den) < 0.05 ? (den < 0.0 ? -0.05 : 0.05) : den;',
      '  vec2 w = X - 0.5 - a * T;',
      '  vec2 h0 = w - v * ((w.x + w.y) / den);',
      '  vec2 wk = w + (k - floor(h0 / dims)) * dims;',
      '  return wk - v * ((wk.x + wk.y) / den);',
      '}',
    ].join('\n'));
  }
  return out;
}

const ruleFn = (r: GridRule) => `gs_r${r.id.replace(/\W/g, '_')}$`;

/** The condition of a rule for the cell being drawn (C its cell, P its place, h its home), or null when it can't apply. */
function condition(r: GridRule, cellArgs: string): string | null {
  const w = r.when;
  switch (w.kind) {
    case 'cell': return `max(abs(C.x - ${gf(w.x ?? 0)}), abs(C.y - ${gf(w.y ?? 0)})) < 0.5`;
    case 'column': return `abs(C.x - ${gf(w.x ?? 0)}) < 0.5`;
    case 'row': return `abs(C.y - ${gf(w.y ?? 0)}) < 0.5`;
    case 'sameCell':
    case 'near': return `${ruleFn(r)}(P, C, h, t, ${shapeArgs(w.b!).m}, gd${cellArgs}) > 0.5`;
  }
}

function effect(spec: GridSceneSpec, r: GridRule, pics: boolean, slotOf: (s: GShape) => number): string {
  const d = r.do;
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
  /** The search radius per shape id (cells either side). */
  radius: Record<string, number>;
  /** The fill's search radius. */
  fillRadius: number;
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

/** gs_cell: the shape slot (1–6, 0 none) cell h shows, through the draw mode (spec.ts sourceCell). */
function cellFn(spec: GridSceneSpec, n: number, repeat: boolean): string {
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
  return [
    `float gs_cell$(float gd[${n}], vec2 h${repeat ? ', vec4 rp, float rs' : ''}) {`,
    `  if (${outside}) return 0.0;`,
    ...map,
    ...(map.length ? [`  if (${outside}) return 0.0;`] : []),
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

/** The whole program for a spec. */
export function gridProgram(spec: GridSceneSpec): GridProgram {
  const shapes = spec.shapes;
  const look = spec.look;
  const { data, placed } = packDrawing(spec);
  const n = data.length;
  const repeat = drawOf(spec).mode === 'repeat';
  const cellArgs = repeat ? ', rp, rs' : '';
  const rules = activeRules(spec);
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
    ...texs.map((_, i) => `sampler2D ${texArg(i)}`), ...(pm ? ['float pcut'] : []), ...(screen ? ['vec2 suv'] : []), 'inout vec4 hp',
  ];
  const args = [
    ...shapes.flatMap(s => { const a = shapeArgs(s.id); return [a.m, a.l, a.e, a.c]; }),
    'gd', ...(repeat ? ['rp', 'rs'] : []), ...texs.map((_, i) => texArg(i)), ...(pm ? ['pcut'] : []), ...(screen ? ['suv'] : []), 'hp',
  ];
  // A picture cell is a square (k 10): only then does the shape function know it, so other scenes keep their shapes' code.
  const fns: string[] = [shapes.some(s => s.kind === 'picture') ? HELPERS.replace('  return gs_heart$(q, s);\n}', '  if (k < 9.5) return gs_heart$(q, s);\n  return gs_box$(q, vec2(s));\n}') : HELPERS];
  fns.push(cellFn(spec, n, repeat));
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
    const reach = shapeReach(spec, s);
    radius[s.id] = searchRadius(reach + motionSpread(s, reach), look.glow);
    fns.push(...motionFns(spec, s));
  }
  if (spec.pattern.kind !== 'none' && spec.pattern.kind !== 'picture') fns.push(`float gs_wave$(vec2 P, float t, vec4 pt) {\n${waveBody(spec.pattern.kind, spec)}\n}`);
  const mask = activeMask(spec);
  if (mask) fns.push(textMaskGlsl(mask, spec.cols, spec.rows));
  // The rules with a partner: does a cell of the partner's shape share this cell (or come near)?
  for (const r of rules) {
    if (r.when.kind !== 'sameCell' && r.when.kind !== 'near') continue;
    const b = shapeOf(spec, r.when.b)!;
    const near = r.when.kind === 'near';
    const dist = Math.max(0.05, r.when.dist ?? 1);
    const reach = near ? dist : 0.5;
    const R = searchRadius(reach + motionSpread(b, reach), false);
    const body = [
      `if (abs(gs_cell$(gd, h${cellArgs}) - ${gf(shapes.indexOf(b) + 1)}) > 0.5) continue;`,
      ...(b.id === r.when.a ? ['if (h == self) continue;'] : []),
      `vec2 PB = gs_move${b.id}$(h, t, mB);`,
      near ? `if (distance(P, PB) <= ${gf(dist)}) return 1.0;` : 'if (max(abs(floor(PB).x - C.x), abs(floor(PB).y - C.y)) < 0.5) return 1.0;',
    ];
    fns.push([
      `float ${ruleFn(r)}(vec2 P, vec2 C, vec2 self, float t, vec4 mB, float gd[${n}]${repeat ? ', vec4 rp, float rs' : ''}) {`,
      ...searchLoop(spec, b, near ? 'P' : 'C + 0.5', R, 'mB', body, '  '),
      '  return 0.0;',
      '}',
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
      `vec2 P = gs_move${sh.id}$(h, t, ${a.m});`,
      'vec2 C = floor(P);',
      `float k = ${gf(kindIndex(sh.kind))}; float s = ${a.l}.x * 0.5; vec3 c = ${a.c}; float e = ${a.e} * 0.5; float vis = 1.0;`,
      ...picLines(sh),
      'float s0 = s;',
      `float an = ${a.l}.y + t * ${a.l}.z * 6.2831853;`,
      `s *= 1.0 + ${a.l}.w * 0.5 * sin((t * ${pulseRate(sh)} + ${a.m}.w * (h.x + h.y)) * 6.2831853);`,
      ...pmLine('C'),
      ...targetLines(spec, texs, ''),
    ];
    for (const r of rules) {
      if (r.when.a !== sh.id) continue;
      const cond = condition(r, cellArgs);
      if (cond) body.push(`if (${cond}) { ${effect(spec, r, shapePics, slotOf)} } // ${r.id}`);
    }
    body.push(
      'vec2 q = cp - P; q.y = -q.y;',
      'q = mat2(cos(an), -sin(an), sin(an), cos(an)) * q;',
      'float d = gs_sdf$(k, q, s);',
      'if (e > 0.0) d = abs(d) - e;',
      'if (vis > 0.5 && d < best) {',
      ...win('h', `${a.l}.y`),
      '}',
    );
    const side = 2 * radius[sh.id] + 1;
    L.push(`  // shape ${sh.id} (${sh.kind}): the drawn cells whose shape could be here now, ${side} × ${side} round the cell this point's would come from`);
    L.push(...searchLoop(spec, sh, 'cp', radius[sh.id], a.m, body, '  '));
  });
  let fillRadius = 0;
  if (fill) {
    const a = shapeArgs(fill.id);
    fillRadius = searchRadius(shapeReach(spec, fill, true), look.glow);
    const fb = [
      'vec2 id = floor(cp) + vec2(float(i), float(j));',
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
    const side = 2 * fillRadius + 1;
    L.push(`  // the pattern fills the empty cells with shape ${fill.id}: this point's cell and the ones round it (${side} × ${side}), so a big shape reaches over its cell's edge`);
    L.push(`  for (int j = -${fillRadius}; j <= ${fillRadius}; j++) {`);
    L.push(`    for (int i = -${fillRadius}; i <= ${fillRadius}; i++) {`);
    L.push(...fb.map(l => `      ${l}`));
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
  L.push('  hp = vec4(gs_uv$(hp.xy), gs_uv$(hp.zw));');
  L.push(`  return vec4(col, best * ${cs});`);
  L.push('}');
  fns.push(L.join('\n'));
  const code = fns.join('\n');
  const h = `_${codeHash(code)}`;
  return {
    functions: code.split('$').join(h), name: `gs_scene${h}`, args, placed, data,
    textures: texs, shapePics, screen, maskCut: !!pm, repeat, radius, fillRadius,
  };
}

