/**
 * legacyGlsl.ts — the Grid scene's shader code as it was before the cell lookup (one block per drawn
 * cell, every pixel testing every one), kept only for the equivalence test (gridLookup.test.ts):
 * the lookup must draw the same pictures. Do not use elsewhere.
 */
/* eslint-disable */
/**
 * glsl.ts — the Grid scene's shader code (docs/grid-builder.md, "What Build makes"). One GLSL
 * function draws the whole grid for a pixel, with the shapes' numbers coming in as arguments (the
 * sliders on the Shape and Grid scene nodes: live uniforms, no recompile), and the structure
 * written out:
 *
 *   - every placed cell is a few lines: where its shape is now (its motion), which cell that is,
 *     the pattern's wave there, the rules that apply, its distance; the nearest shape wins;
 *   - the rules are plain `if`s on those cells: in a cell, a column or a row, sharing a cell with
 *     (or near) a shape of another kind, which looks at every one of those (unrolled);
 *   - the pattern's fill puts its shape in every empty cell (a lookup of the drawn cells).
 *
 * Every function's name ends in a short hash of the code, so two grid scenes in one graph never
 * clash (identical code is the same text, which the compiler adds once).
 *
 * Coordinates inside: cell units, x right, y down (as the mini grid), a cell's centre at +0.5.
 * Shapes are measured with y up. The result is vec4(colour, distance in picture units).
 */
import { SHAPE_KINDS, cellSize, ruleProblem, shapeOf, type GShape, type GridRule, type GridSceneSpec, type MotionPath, type PatternKind } from '../spec';
import { readTextMask, textMaskGlsl, type TextMask } from '../textMask';

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

/** The wave at a cell: the pattern's function, or (a picture pattern) the picture's brightness pb at this pixel's cell, −1 … 1. */
const waveExpr = (spec: GridSceneSpec) => (spec.pattern.kind === 'picture' ? '(pb * 2.0 - 1.0)' : 'gs_wave$(P, t, pt)');

/** The pictures shown inside cells, in slot order (pic.w in the scene function). */
export function pictureSlots(spec: GridSceneSpec): string[] {
  return [...new Set(spec.shapes.filter(s => s.kind === 'picture' && s.tex).map(s => s.tex!))];
}

/** What the pattern's target does to a shape's s (size), an (angle), P (place), c (colour). */
function targetLines(spec: GridSceneSpec, pad: string): string[] {
  if (spec.pattern.kind === 'none') return [];
  const out = [`${pad}float w = ${waveExpr(spec)};`];
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

/** The condition of a rule for an instance at cell C (and position P), or null when it can't apply. */
function condition(r: GridRule, selfIndex: number, insts: Inst[]): string | null {
  const w = r.when;
  const near = (j: number) => w.kind === 'near'
    ? `step(distance(P, P${j}), ${gf(Math.max(0.05, w.dist ?? 1))})`
    : `step(max(abs(floor(P${j}).x - C.x), abs(floor(P${j}).y - C.y)), 0.5)`;
  switch (w.kind) {
    case 'cell': return `max(abs(C.x - ${gf(w.x ?? 0)}), abs(C.y - ${gf(w.y ?? 0)})) < 0.5`;
    case 'column': return `abs(C.x - ${gf(w.x ?? 0)}) < 0.5`;
    case 'row': return `abs(C.y - ${gf(w.y ?? 0)}) < 0.5`;
    case 'sameCell':
    case 'near': {
      const partners = insts.filter((x, j) => x.shape.id === w.b && j !== selfIndex);
      if (!partners.length) return null;
      return `(${partners.map(x => near(x.index)).join(' + ')}) > 0.5`;
    }
  }
}

function effect(spec: GridSceneSpec, r: GridRule): string {
  const d = r.do;
  switch (d.kind) {
    case 'become': {
      const to = shapeOf(spec, d.shape)!;
      const a = shapeArgs(to.id);
      return `k = ${gf(kindIndex(to.kind))}; s = ${a.l}.x * 0.5; c = ${a.c}; e = ${a.e} * 0.5;`;
    }
    case 'colour': return `c = ${v3(d.color ?? [1, 1, 1])};`;
    case 'swap': return `c = ${shapeArgs(r.when.b!).c};`;
    case 'grow': return `s *= ${gf(d.amount ?? 1.5)};`;
    case 'hide': return 'vis = 0.0;';
    case 'spin': return `an += t * ${gf(d.amount ?? 1)} * 6.2831853;`;
  }
}

interface Inst { index: number; x: number; y: number; shape: GShape }

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

export interface GridProgram {
  /** Every function, the name suffix in place. */
  functions: string;
  /** The scene function's name. */
  name: string;
  /** Its arguments after (uv, t, pt): per shape m, l, e, c. */
  args: string[];
  /** How many placed cells it draws. */
  placed: number;
  /** Picture cells: the function writes the winning cell's picture place into `pic` (inout): xy the place 0–1, z 1 for a picture, w its slot. */
  picture: boolean;
  /** A picture pattern: the function reads `pb`, the picture's brightness at this pixel's cell. */
  patternPic: boolean;
  /** The pictures in cells, in slot order. */
  slots: string[];
}

/** The whole program for a spec. */
export function gridProgram(spec: GridSceneSpec): GridProgram {
  const shapes = spec.shapes;
  const insts: Inst[] = [];
  for (const c of spec.cells) {
    const sh = shapeOf(spec, c.s);
    if (sh && c.x < spec.cols && c.y < spec.rows) insts.push({ index: insts.length, x: c.x, y: c.y, shape: sh });
  }
  const rules = activeRules(spec);
  const slots = pictureSlots(spec);
  const picture = shapes.some(s => s.kind === 'picture');
  const patternPic = spec.pattern.kind === 'picture';
  const params = ['vec2 uv', 'float t', 'vec4 pt', ...shapes.flatMap(s => { const a = shapeArgs(s.id); return [`vec4 ${a.m}`, `vec4 ${a.l}`, `float ${a.e}`, `vec3 ${a.c}`]; }),
    ...(patternPic ? ['float pb'] : []), ...(picture ? ['inout vec4 pic'] : [])];
  const args = [...shapes.flatMap(s => { const a = shapeArgs(s.id); return [a.m, a.l, a.e, a.c]; }), ...(patternPic ? ['pb'] : []), ...(picture ? ['pic'] : [])];
  // A picture cell is a square (k 10): only then does the shape function know it, so older scenes keep their code.
  const fns: string[] = [picture ? HELPERS.replace('  return gs_heart$(q, s);\n}', '  if (k < 9.5) return gs_heart$(q, s);\n  return gs_box$(q, vec2(s));\n}') : HELPERS];
  /** The winner's picture place, for a picture cell (slot −1: none). */
  const won = (sh: GShape) => (picture ? ` pic = vec4(q / (2.0 * max(s, 1e-4)) + 0.5, step(9.5, k), ${gf(sh.kind === 'picture' && sh.tex ? slots.indexOf(sh.tex) : -1)});` : '');
  // Each shape's motion.
  for (const s of shapes) {
    const wrap = s.motion.path === 'travel' || s.motion.path === 'hop';
    fns.push([
      `vec2 gs_move${s.id}$(vec2 home, float t, vec4 m) {`,
      '  float ph = t * m.z + m.w * (home.x + home.y);',
      '  float a = ph * 6.2831853;',
      `  vec2 o = ${pathOffset(s.motion.path)};`,
      '  vec2 P = home + 0.5 + vec2(o.x, -o.y);',
      ...(wrap ? [`  P = fract(P / ${v2(spec.cols, spec.rows)}) * ${v2(spec.cols, spec.rows)};`] : []),
      '  return P;',
      '}',
    ].join('\n'));
  }
  if (spec.pattern.kind !== 'none' && !patternPic) fns.push(`float gs_wave$(vec2 P, float t, vec4 pt) {\n${waveBody(spec.pattern.kind, spec)}\n}`);
  const mask = activeMask(spec);
  if (mask) fns.push(textMaskGlsl(mask, spec.cols, spec.rows));
  const fill = spec.pattern.kind !== 'none' ? shapeOf(spec, spec.pattern.fill) : undefined;
  if (fill) {
    // Is a cell one you drew on? Grouped by row.
    const rows = new Map<number, number[]>();
    for (const i of insts) rows.set(i.y, [...(rows.get(i.y) ?? []), i.x]);
    const body = [...rows.entries()].sort((a, b) => a[0] - b[0])
      .map(([y, xs]) => `  if (abs(id.y - ${gf(y)}) < 0.5 && (${xs.sort((a, b) => a - b).map(x => `abs(id.x - ${gf(x)}) < 0.5`).join(' || ')})) return 1.0;`);
    fns.push(`float gs_drawn$(vec2 id) {\n${body.join('\n')}${body.length ? '\n' : ''}  return 0.0;\n}`);
  }

  const L: string[] = [];
  L.push(`vec4 gs_scene$(${params.join(', ')}) {`);
  L.push(`  vec2 cp = vec2(uv.x / ${gf(cellSize(spec))} + ${gf(spec.cols / 2)}, ${gf(spec.rows / 2)} - uv.y / ${gf(cellSize(spec))});`);
  L.push('  float best = 1.0e5;');
  L.push('  vec3 col = vec3(0.0);');
  // Where each placed shape is now.
  for (const i of insts) L.push(`  vec2 P${i.index} = gs_move${i.shape.id}$(${v2(i.x, i.y)}, t, ${shapeArgs(i.shape.id).m});`);
  const pulseRate = (s: GShape) => (s.motion.path === 'still' ? '1.0' : `${shapeArgs(s.id).m}.z`);
  for (const i of insts) {
    const a = shapeArgs(i.shape.id);
    L.push(`  { // cell (${i.x}, ${i.y}): shape ${i.shape.id}`);
    L.push(`    vec2 P = P${i.index};`);
    L.push('    vec2 C = floor(P);');
    L.push(`    float k = ${gf(kindIndex(i.shape.kind))}; float s = ${a.l}.x * 0.5; vec3 c = ${a.c}; float e = ${a.e} * 0.5; float vis = 1.0;`);
    L.push(`    float an = ${a.l}.y + t * ${a.l}.z * 6.2831853;`);
    L.push(`    s *= 1.0 + ${a.l}.w * 0.5 * sin((t * ${pulseRate(i.shape)} + ${a.m}.w * ${gf(i.x + i.y)}) * 6.2831853);`);
    L.push(...targetLines(spec, '    '));
    for (const r of rules) {
      if (r.when.a !== i.shape.id) continue;
      const cond = condition(r, i.index, insts);
      if (cond) L.push(`    if (${cond}) { ${effect(spec, r)} } // ${r.id}`);
    }
    L.push('    vec2 q = cp - P; q.y = -q.y;');
    L.push('    q = mat2(cos(an), -sin(an), sin(an), cos(an)) * q;');
    L.push('    float d = gs_sdf$(k, q, s);');
    L.push('    if (e > 0.0) d = abs(d) - e;');
    L.push(`    if (vis > 0.5 && d < best) { best = d; col = c;${won(i.shape)} }`);
    L.push('  }');
  }
  if (fill) {
    const a = shapeArgs(fill.id);
    L.push(`  { // the pattern fills the empty cells with shape ${fill.id}`);
    L.push('    vec2 id = floor(cp);');
    L.push(`    if (id.x >= 0.0 && id.y >= 0.0 && id.x < ${gf(spec.cols)} && id.y < ${gf(spec.rows)} && gs_drawn$(id) < 0.5${mask ? ' && gs_mask$(id) > 0.5' : ''}) {`);
    L.push('      vec2 P = id + 0.5;');
    L.push(`      float k = ${gf(kindIndex(fill.kind))}; float s = ${a.l}.x * 0.5; vec3 c = ${a.c}; float e = ${a.e} * 0.5;`);
    L.push(`      float an = ${a.l}.y + t * ${a.l}.z * 6.2831853;`);
    L.push(`      s *= 1.0 + ${a.l}.w * 0.5 * sin((t + ${a.m}.w * (id.x + id.y)) * 6.2831853);`);
    if (spec.pattern.target === 'size') {
      L.push(`      float w = ${waveExpr(spec)};`);
      L.push('      s *= mix(1.0, 0.5 + 0.5 * w, clamp(pt.x, 0.0, 1.0));');
    } else L.push(...targetLines(spec, '      '));
    L.push('      vec2 q = cp - P; q.y = -q.y;');
    L.push('      q = mat2(cos(an), -sin(an), sin(an), cos(an)) * q;');
    L.push('      float d = gs_sdf$(k, q, s);');
    L.push('      if (e > 0.0) d = abs(d) - e;');
    L.push(`      if (s > 0.002 && d < best) { best = d; col = c;${won(fill)} }`);
    L.push('    }');
    L.push('  }');
  }
  L.push(`  return vec4(col, best * ${gf(cellSize(spec))});`);
  L.push('}');
  fns.push(L.join('\n'));
  const code = fns.join('\n');
  const h = `_${codeHash(code)}`;
  return { functions: code.split('$').join(h), name: `gs_scene${h}`, args, placed: insts.length, picture, patternPic, slots };
}
