/**
 * A transfer plot for an explanation: when an expression is a function of one number
 * (float → float: `1.0 - step(0.02, a)`, smoothstep, sin, fract, pow, a remap, a clamp), sample
 * it on the CPU with the explainer's own evaluator (evaluate.ts) over a range picked from its
 * literals, and mark its edges. No GPU: it is a few hundred multiplications.
 *
 *   transferPlot(explainExpression('1.0 - step(0.02, a)', { types: { a: 'float' } }))
 *   → { input: 'a', from: 0, to: 0.1, edges: [0.02], points: [[0, 1], …, [0.02, 0], …] }
 */
import { allNodes, type Expr, type GlslType } from './ast';
import { evaluate, type Value } from './evaluate';
import type { Explanation } from './explain';
import { NAMED_CONSTANTS, constValue } from './match';

export interface TransferPlot {
  /** The one name the expression reads. */
  input: string;
  inputType: GlslType;
  /** The x range sampled. */
  from: number;
  to: number;
  /** x positions where something happens (a step's edge, smoothstep's ends, clamp's limits). */
  edges: number[];
  /** [x, y], x ascending. */
  points: Array<[number, number]>;
  /** The y range drawn: the values' range (0…1 kept whole), padded a little, never flat. */
  yMin: number;
  yMax: number;
  /** The values' range before padding (the axis labels). */
  yLo: number;
  yHi: number;
}

const SAMPLES = 160;
const isScalarType = (t: GlslType) => t === 'float' || t === 'int';

/** The single name an expression reads (and its type), or null when it reads none or several. */
export function singleInput(ex: Explanation): { name: string; type: GlslType } | null {
  const names = new Map<string, GlslType>();
  for (const n of allNodes(ex.root)) {
    if (n.kind !== 'ident' || n.name in NAMED_CONSTANTS) continue;
    names.set(n.name, ex.descs.get(n.id)?.type ?? 'unknown');
  }
  if (names.size !== 1) return null;
  const [[name, type]] = [...names];
  return { name, type };
}

/** Does the expression read space (a vec2/vec3 name) or several inputs? Then a picture says more than a plot. */
export function needsPicture(ex: Explanation): boolean {
  const names = new Map<string, GlslType>();
  for (const n of allNodes(ex.root)) if (n.kind === 'ident' && !(n.name in NAMED_CONSTANTS)) names.set(n.name, ex.descs.get(n.id)?.type ?? 'unknown');
  if (names.size === 0) return false;
  return names.size > 1 || [...names.values()].some(t => t === 'vec2' || t === 'vec3' || t === 'vec4');
}

const reads = (e: Expr, name: string) => allNodes(e).some(n => n.kind === 'ident' && n.name === name);

/** Where an inner argument `g(x)` crosses `e`, when g is the input itself or a straight line of it. */
function solveFor(inner: Expr, name: string, e: number): number | undefined {
  if (inner.kind === 'ident' && inner.name === name) return e;
  try {
    const at = (x: number) => evaluate(inner, { [name]: x }) as Value;
    const g0 = at(0), g1 = at(1), g2 = at(2);
    if (typeof g0 !== 'number' || typeof g1 !== 'number' || typeof g2 !== 'number') return undefined;
    const b = g1 - g0;
    if (Math.abs(b) < 1e-12 || Math.abs(g2 - g0 - 2 * b) > 1e-9 * Math.max(1, Math.abs(g2))) return undefined;
    return (e - g0) / b;
  } catch { return undefined; }
}

/** The x values where the expression's thresholds sit. */
export function edgesOf(root: Expr, name: string): number[] {
  const out: number[] = [];
  const add = (inner: Expr, edge: Expr) => {
    const v = constValue(edge);
    if (v === undefined || !reads(inner, name) || reads(edge, name)) return;
    const x = solveFor(inner, name, v);
    if (x !== undefined && Number.isFinite(x)) out.push(x);
  };
  for (const n of allNodes(root)) {
    if (n.kind === 'call') {
      const [a, b, c] = n.args;
      switch (n.callee) {
        case 'step': if (a && b) add(b, a); break;
        case 'smoothstep': if (a && b && c) { add(c, a); add(c, b); } break;
        case 'clamp': if (a && b && c) { add(a, b); add(a, c); } break;
        case 'min': case 'max': if (a && b) { add(a, b); add(b, a); } break;
      }
    } else if (n.kind === 'binary' && ['<', '>', '<=', '>='].includes(n.op)) {
      add(n.left, n.right); add(n.right, n.left);
    }
  }
  const uniq: number[] = [];
  for (const x of out.sort((p, q) => p - q)) if (!uniq.some(u => Math.abs(u - x) < 1e-9)) uniq.push(x);
  return uniq;
}

/** The x range: around the edges when there are some, else by what the expression does. */
export function plotRange(root: Expr, edges: number[]): [number, number] {
  if (edges.length) {
    const lo = edges[0], hi = edges[edges.length - 1];
    const w = Math.max(hi - lo, Math.abs(lo), Math.abs(hi), 1e-3);
    // One edge: from 0 (when it is positive) to a few edge-widths past it, so 0.02 plots over 0…0.1
    const from = lo > 0.25 * w ? 0 : lo - 0.5 * w;
    const to = edges.length === 1 && hi > 0 ? hi + 4 * w : hi + 0.5 * w;
    return [from, to];
  }
  const calls = new Set(allNodes(root).flatMap(n => (n.kind === 'call' ? [n.callee] : [])));
  if (calls.has('sin') || calls.has('cos')) return [0, 2 * Math.PI];
  if (calls.has('fract') || calls.has('mod') || calls.has('floor') || calls.has('ceil')) return [0, 3];
  if (calls.has('abs') || calls.has('sign')) return [-1, 1];
  // A −1…1 → 0…1 remap reads over its input's range
  if (allNodes(root).some(n => n.kind === 'binary' && n.op === '+' && (constValue(n.right) === 0.5 || constValue(n.left) === 0.5))) return [-1, 1];
  return [0, 1];
}

/** The plot, or null when the expression is not a function of one number. */
export function transferPlot(ex: Explanation): TransferPlot | null {
  const inp = singleInput(ex);
  if (!inp) return null;
  if (!(isScalarType(inp.type) || inp.type === 'unknown')) return null;
  if (!(isScalarType(ex.type) || ex.type === 'unknown' || ex.type === 'bool')) return null;
  const f = (x: number): number | null => {
    try { const v = evaluate(ex.root, { [inp.name]: x }); return typeof v === 'number' && Number.isFinite(v) ? v : null; } catch { return null; }
  };
  const edges = edgesOf(ex.root, inp.name);
  const [from, to] = plotRange(ex.root, edges);
  if (!(to > from)) return null;
  const xs: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) xs.push(from + ((to - from) * i) / SAMPLES);
  // Both sides of every edge, so a hard step draws as a clean vertical
  const eps = (to - from) * 1e-6;
  for (const e of edges) if (e > from && e < to) xs.push(e - eps, e);
  xs.sort((a, b) => a - b);
  const points: Array<[number, number]> = [];
  for (const x of xs) { const y = f(x); if (y !== null) points.push([x, y]); }
  if (points.length < SAMPLES / 2) return null;
  let yMin = Math.min(...points.map(p => p[1])), yMax = Math.max(...points.map(p => p[1]));
  // Keep 0 and 1 in view for 0…1 values; never a flat range
  if (yMin >= 0 && yMax <= 1) { yMin = 0; yMax = 1; }
  if (yMax - yMin < 1e-9) { yMin -= 0.5; yMax += 0.5; }
  const pad = (yMax - yMin) * 0.08;
  return { input: inp.name, inputType: inp.type, from, to, edges: edges.filter(e => e >= from && e <= to), points, yMin: yMin - pad, yMax: yMax + pad, yLo: yMin, yHi: yMax };
}
