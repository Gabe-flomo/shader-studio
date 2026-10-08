/**
 * functions.ts — GLSL functions as building blocks in the 2D Scene Builder (docs/scene-builder-2d.md,
 * "Functions"): a function that bends space, `vec2 f(vec2 p[, float t])`, as a space transform, and a
 * function that measures a shape, `float f(vec2 p[, float t])`, as a shape. Each builds as a Custom
 * Function node carrying the function (and any helpers it calls) and calling it.
 *
 * Where they come from: a small built-in set, and any function of the right shape found in the
 * examples, your saved GLSL and your Custom Function presets (`findFunctions`). Pure.
 */
import { declaredFunctions } from '../lib/glslPatterns';

export type FnRole = 'space' | 'shape';

export interface FnRef {
  name: string;
  /** Every function it needs, the called one last. */
  code: string;
  /** Takes time as a second argument. */
  timed: boolean;
  /** Where it came from: "built in", "example: Neon Tube", "GLSL: my shader". */
  from: string;
}

export interface FnEntry extends FnRef { role: FnRole; blurb?: string }

const BUILT_IN: Array<{ role: FnRole; blurb: string; code: string }> = [
  { role: 'space', blurb: 'Twists the middle round more than the edges.',
    code: 'vec2 twirl(vec2 p, float t) {\n    float a = 2.5 * exp(-2.0 * dot(p, p));\n    float c = cos(a), s = sin(a);\n    return mat2(c, s, -s, c) * p;\n}' },
  { role: 'space', blurb: 'Squares the point as a complex number: angles double, shapes copy twice round.',
    code: 'vec2 complexSquare(vec2 p, float t) {\n    return vec2(p.x * p.x - p.y * p.y, 2.0 * p.x * p.y) * 1.5;\n}' },
  { role: 'space', blurb: 'Turns space inside out through a circle: near the middle becomes far.',
    code: 'vec2 circleInvert(vec2 p, float t) {\n    return p / max(dot(p, p), 0.0001) * 0.25;\n}' },
  { role: 'space', blurb: 'Wobbles space with sines that drift over time.',
    code: 'vec2 sineWarp(vec2 p, float t) {\n    return p + 0.08 * sin(p.yx * 7.0 + t);\n}' },
  { role: 'space', blurb: 'Shifts every other row half a step, like bricks (use with Tile).',
    code: 'vec2 brickOffset(vec2 p, float t) {\n    p.x += step(1.0, mod(floor(p.y * 4.0), 2.0)) * 0.125;\n    return p;\n}' },
  { role: 'space', blurb: 'Breathes: space swells and shrinks in rings moving out.',
    code: 'vec2 breathe(vec2 p, float t) {\n    return p * (1.0 + 0.15 * sin(t * 1.5 + length(p) * 4.0));\n}' },
  { role: 'shape', blurb: 'A six-petal flower.',
    code: 'float flower(vec2 p, float t) {\n    float a = atan(p.y, p.x);\n    return length(p) - (0.32 + 0.08 * cos(a * 6.0));\n}' },
  { role: 'shape', blurb: 'A spiral line winding out from the middle.',
    code: 'float spiralLine(vec2 p, float t) {\n    float k = fract(atan(p.y, p.x) / 6.2831853 + length(p) * 4.0) - 0.5;\n    return abs(k) * 0.25 - 0.03;\n}' },
  { role: 'shape', blurb: 'A rounded square between a circle and a box (a superellipse).',
    code: 'float superellipse(vec2 p, float t) {\n    vec2 q = abs(p) / vec2(0.4, 0.3);\n    return (pow(pow(q.x, 4.0) + pow(q.y, 4.0), 0.25) - 1.0) * 0.3;\n}' },
  { role: 'shape', blurb: 'A blob whose edge wobbles over time.',
    code: 'float wobblyBlob(vec2 p, float t) {\n    float a = atan(p.y, p.x);\n    return length(p) - 0.35 - 0.04 * sin(a * 5.0 + t * 2.0) - 0.03 * sin(a * 3.0 - t);\n}' },
  { role: 'shape', blurb: 'Two circles that melt together as they pass.',
    code: 'float twoBlobs(vec2 p, float t) {\n    float a = length(p - vec2(0.18 * sin(t), 0.0)) - 0.2;\n    float b = length(p + vec2(0.18 * sin(t), 0.0)) - 0.2;\n    float h = max(0.15 - abs(a - b), 0.0) / 0.15;\n    return min(a, b) - h * h * 0.0375;\n}' },
];

const nameOf = (code: string) => /\b(?:vec2|float)\s+([A-Za-z_]\w*)\s*\(/.exec(code)?.[1] ?? 'f';

export const BUILT_IN_FUNCTIONS: FnEntry[] = BUILT_IN.map(b => ({ name: nameOf(b.code), code: b.code, timed: true, from: 'built in', role: b.role, blurb: b.blurb }));
export const builtInFunction = (name: string): FnEntry | undefined => BUILT_IN_FUNCTIONS.find(f => f.name.toLowerCase() === name.toLowerCase());

/** The text of the function declared at `start` in `source` (its braces balanced), or null. */
function bodyAt(source: string, start: number): string | null {
  const open = source.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

/**
 * Functions in `sources` that fit: `vec2 f(vec2)` / `vec2 f(vec2, float)` bend space, `float f(vec2)` /
 * `float f(vec2, float)` measure a shape. Each carries the functions it calls from the same source.
 */
export function findFunctions(sources: ReadonlyArray<{ label: string; code: string }>): FnEntry[] {
  const out: FnEntry[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    let decls;
    try { decls = declaredFunctions(src.code); } catch { continue; }
    const texts = new Map<string, string>();
    for (const d of decls) { const t = bodyAt(src.code, d.start); if (t) texts.set(d.name, t); }
    for (const d of decls) {
      const ps = d.overload.params.map(p => p.type);
      const ret = d.overload.returns;
      const fits = ps[0] === 'vec2' && (ps.length === 1 || (ps.length === 2 && ps[1] === 'float')) && (ret === 'vec2' || ret === 'float');
      if (!fits || d.name === 'main' || d.name === 'mainImage') continue;
      const self = texts.get(d.name);
      if (!self) continue;
      // The helpers it calls, transitively, from the same source; in the order they were written.
      const need = new Set<string>([d.name]);
      const queue = [self];
      while (queue.length) {
        const text = queue.pop()!;
        for (const [n, t] of texts) if (!need.has(n) && new RegExp(`\\b${n}\\s*\\(`).test(text)) { need.add(n); queue.push(t); }
      }
      const code = decls.filter(x => need.has(x.name) && texts.get(x.name)).map(x => texts.get(x.name)!).join('\n\n');
      const key = `${d.name}|${code.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: d.name, code, timed: ps.length === 2, from: src.label, role: ret === 'vec2' ? 'space' : 'shape', blurb: d.doc });
    }
  }
  return out;
}

/** The Custom Function node's body: call it. */
export const callBody = (f: FnRef) => `return ${f.name}(p${f.timed ? ', t' : ''});`;

const ident = (s: string) => (s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1').replace(/^_+|_+$/g, '') || 'fn');

/**
 * Custom Function nodes that already are such a function: one vec2 input (and maybe a float time input),
 * a vec2 or float result. Each becomes `ret name(vec2 p[, float t]) { body }`, its helpers in front.
 */
export function functionsFromGraphs(graphs: ReadonlyArray<{ label: string; nodes: unknown }>): FnEntry[] {
  const out: FnEntry[] = [];
  const walk = (nodes: unknown, label: string) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes as Array<{ type?: string; params?: Record<string, unknown> }>) {
      const p = n.params ?? {};
      if (n.type === 'customFn') {
        const ins = (Array.isArray(p.inputs) ? p.inputs : []) as Array<{ name: string; type: string }>;
        const ret = String(p.outputType ?? 'float');
        const v2 = ins.filter(i => i.type === 'vec2');
        const fl = ins.filter(i => i.type === 'float');
        const body = String(p.body ?? '').trim();
        if (v2.length === 1 && fl.length <= 1 && ins.length === v2.length + fl.length && (ret === 'vec2' || ret === 'float') && body && body !== '0.0') {
          const name = ident(String(p.label ?? 'customFn')).replace(/^custom_?function$/i, 'customFn');
          let b = body.replace(new RegExp(`\\b${v2[0].name}\\b`, 'g'), 'p');
          if (fl[0]) b = b.replace(new RegExp(`\\b${fl[0].name}\\b`, 'g'), 't');
          const stmts = /\breturn\b/.test(b) ? b : `return ${b.replace(/;\s*$/, '')};`;
          const helpers = typeof p.glslFunctions === 'string' ? p.glslFunctions.trim() : '';
          const code = `${helpers ? `${helpers}\n\n` : ''}${ret} ${name}(vec2 p${fl[0] ? ', float t' : ''}) {\n    ${stmts.replace(/\n/g, '\n    ')}\n}`;
          out.push({ name, code, timed: !!fl[0], from: label, role: ret === 'vec2' ? 'space' : 'shape', blurb: typeof p.__comment === 'string' ? p.__comment.split('\n')[0].slice(0, 120) : undefined });
        }
      }
      if (n.type === 'exprNode') {
        const f = exprAsFunction(p, label);
        if (f) out.push(f);
      }
      const sub = p.subgraph as { nodes?: unknown } | undefined;
      if (sub?.nodes) walk(sub.nodes, label);
    }
  };
  for (const g of graphs) walk(g.nodes, g.label);
  const seen = new Set<string>();
  return out.filter(f => { const k = f.code; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * An Expression Block that is a function of one point: a single vec2 input, float inputs that are
 * sliders (their values are written in) or one that is time, and a vec2 or float result.
 */
function exprAsFunction(p: Record<string, unknown>, from: string): FnEntry | null {
  const ins = (Array.isArray(p.inputs) ? p.inputs : []) as Array<{ name: string; type: string; slider?: unknown }>;
  const ret = String(p.outputType ?? 'float');
  if (ret !== 'vec2' && ret !== 'float') return null;
  const v2 = ins.filter(i => i.type === 'vec2');
  if (v2.length !== 1 || v2[0].slider) return null;
  const fixed = ins.filter(i => i.type === 'float' && i.slider && typeof p[i.name] === 'number');
  const free = ins.filter(i => i.type === 'float' && !(i.slider && typeof p[i.name] === 'number'));
  if (free.length > 1 || ins.length !== 1 + fixed.length + free.length) return null;
  const lines = (Array.isArray(p.lines) ? p.lines : []) as Array<{ lhs?: string; op?: string; rhs?: string; off?: boolean }>;
  const result = String(p.result ?? '').trim();
  if (!result) return null;
  const sub = (text: string) => {
    let t = text.replace(new RegExp(`\\b${v2[0].name}\\b`, 'g'), 'p');
    if (free[0]) t = t.replace(new RegExp(`\\b${free[0].name}\\b`, 'g'), 't');
    for (const f of fixed) t = t.replace(new RegExp(`\\b${f.name}\\b`, 'g'), `(${String(p[f.name])})`);
    return t;
  };
  const stmts = lines.filter(l => l.lhs && l.rhs && !l.off).map(l => `${sub(String(l.lhs))} ${l.op || '='} ${sub(String(l.rhs))};`);
  // A single-letter or reused name for p would clash with a line declaring it: skip those.
  if (stmts.some(st => /^\s*(?:float|vec[234]|int)\s+(p|t)\b/.test(st))) return null;
  const name = ident(String(p.label ?? 'expression')).replace(/^expression_?block$/i, 'expression');
  const code = `${ret} ${name}(vec2 p${free[0] ? ', float t' : ''}) {\n${stmts.map(st => `    ${st}\n`).join('')}    return ${sub(result)};\n}`;
  const note = typeof p.__comment === 'string' ? p.__comment.split('\n')[0].slice(0, 120) : undefined;
  return { name, code, timed: !!free[0], from, role: ret === 'vec2' ? 'space' : 'shape', blurb: note };
}
