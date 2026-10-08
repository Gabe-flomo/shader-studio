/**
 * worked.ts — worked examples for a line's steps: real numbers instead of words.
 *
 * Every name the line reads gets a sample value (a sensible default by its name and type, which the
 * reader can change) and a typical range. Each step is then evaluated on the CPU (evaluate.ts):
 *
 *   - at the sample: "angle = 0.5 → this step gives 1.0";
 *   - across the range: every input drawn many times over its range (deterministic), giving the
 *     step's spread, "−6.28…6.28", the numbers it takes across the picture.
 *
 * Pure. A step the evaluator can't do (a texture read, a user function) just has no number.
 */
import type { Expr } from './ast';
import { allNodes } from './ast';
import { evaluate, type EvalEnv, type Value } from './evaluate';
import { NAMED_CONSTANTS } from './match';
import type { Explanation, LineExplanation } from './explain';

export interface WorkedVar {
  name: string;
  /** 'float', 'vec2', 'vec3' or 'vec4' (what the sample is). */
  type: string;
  /** The sample value. */
  value: Value;
  /** Where it typically runs, per component. */
  range: [number, number];
  /** Why that range: "time in seconds", "pixel position", "a 0..1 value". */
  why: string;
}

export interface WorkedStep {
  label: string;
  /** The step's value at the sample; null when it can't be computed here. */
  value: Value | null;
  /** Its spread over the inputs' ranges (all components together); null when unknown. */
  range: [number, number] | null;
}

const BUILTIN_TIME = /^(t|time|u_time|iTime|uTime)$/;
const SPACE_NAMES = /^(uv|g_uv|p|pos|position|st|coord|q|xy|fragCoord|vUv)$/;
const COLOUR_NAMES = /^(col|color|colour|rgb|c|tint|base)$/i;
const DIST_NAMES = /^(d|dist|distance|sd|sdf|r|radius|len)$/;

const dims = (type: string) => (type === 'vec2' ? 2 : type === 'vec3' ? 3 : type === 'vec4' ? 4 : 1);

/** A name's type, from the explanation (its leaf's Desc), else from how it's read (`p.xy`, `c.rgb`). */
function typeOf(ex: Explanation, name: string): string {
  for (const n of allNodes(ex.root)) {
    if (n.kind === 'ident' && n.name === name) {
      const t = ex.descs.get(n.id)?.type;
      if (t && /^(float|vec[234])$/.test(t)) return t;
    }
  }
  let widest = 1;
  for (const n of allNodes(ex.root)) {
    if (n.kind === 'member' && n.object.kind === 'ident' && n.object.name === name) {
      for (const ch of n.field) widest = Math.max(widest, 'xyzwrgbastpq'.indexOf(ch) % 4 + 1);
    }
  }
  return widest > 1 ? `vec${Math.max(2, widest)}` : SPACE_NAMES.test(name) ? 'vec2' : COLOUR_NAMES.test(name) ? 'vec3' : 'float';
}

function knownRange(ex: Explanation, name: string): [number, number] | undefined {
  for (const n of allNodes(ex.root)) if (n.kind === 'ident' && n.name === name) { const r = ex.descs.get(n.id)?.range; if (r) return r; }
  return undefined;
}

/** The names the line reads (not functions, not named constants like PI), in reading order. */
export function freeNames(ex: Explanation): string[] {
  const out: string[] = [];
  for (const n of allNodes(ex.root)) {
    if (n.kind !== 'ident' || n.name in NAMED_CONSTANTS || out.includes(n.name)) continue;
    out.push(n.name);
  }
  return out;
}

/** Default sample values and ranges for the names a line reads. */
export function workedVars(ex: Explanation | LineExplanation): WorkedVar[] {
  return freeNames(ex).map(name => {
    const type = typeOf(ex, name);
    const n = dims(type);
    const known = knownRange(ex, name);
    let value: number[]; let range: [number, number]; let why: string;
    if (BUILTIN_TIME.test(name)) { value = [2]; range = [0, 10]; why = 'time in seconds'; }
    else if (n >= 2 && SPACE_NAMES.test(name)) { value = [0.3, 0.2, 0, 0]; range = known ?? [-1, 1]; why = 'a position on the picture'; }
    else if (n >= 3 && COLOUR_NAMES.test(name)) { value = [0.8, 0.45, 0.25, 1]; range = known ?? [0, 1]; why = 'a colour'; }
    else if (DIST_NAMES.test(name)) { value = [0.1]; range = known ?? [-0.5, 1]; why = 'a distance'; }
    else if (known) { value = [+(known[0] + (known[1] - known[0]) * 0.5).toFixed(3)]; range = known; why = 'its known range'; }
    else { value = [0.5, 0.25, 0.75, 1]; range = [0, 1]; why = 'a 0..1 value'; }
    const v: Value = n === 1 ? value[0] : Array.from({ length: n }, (_, i) => value[i] ?? value[0]);
    return { name, type, value: v, range, why };
  });
}

/** A fixed pseudo-random sequence, so the ranges don't change on every render. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

const flatOf = (v: Value): number[] => (Array.isArray(v) ? v.filter(x => !Number.isNaN(x)) : [v]);

function tryEval(node: Expr, env: EvalEnv): Value | null {
  try {
    const v = evaluate(node, env);
    return flatOf(v).every(Number.isFinite) ? v : null;
  } catch { return null; }
}

/** Each step's value at the sample and its spread across the inputs' ranges. */
export function workedSteps(ex: Explanation | LineExplanation, vars: readonly WorkedVar[], samples = 160): WorkedStep[] {
  const env: EvalEnv = Object.fromEntries(vars.map(v => [v.name, v.value]));
  const draw = rng(0x9e3779b1);
  const envs: EvalEnv[] = Array.from({ length: samples }, () => Object.fromEntries(vars.map(v => {
    const pick = () => v.range[0] + (v.range[1] - v.range[0]) * draw();
    const n = dims(v.type);
    return [v.name, n === 1 ? pick() : Array.from({ length: n }, pick)];
  })));
  return ex.steps.map(s => {
    const value = tryEval(s.node, env);
    let lo = Infinity, hi = -Infinity;
    for (const e of envs) {
      const r = tryEval(s.node, e);
      if (r === null) continue;
      for (const x of flatOf(r)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    return { label: s.label, value, range: Number.isFinite(lo) ? [lo, hi] : null };
  });
}

/** A value for reading: 0.5, (0.3, 0.2), with at most 3 significant decimals. */
export function showValue(v: Value): string {
  const one = (x: number) => {
    if (!Number.isFinite(x)) return String(x);
    const a = Math.abs(x);
    const r = a >= 100 ? Math.round(x) : a >= 1 ? +x.toFixed(2) : +x.toFixed(3);
    return String(Object.is(r, -0) ? 0 : r);
  };
  const f = flatOf(v);
  return f.length === 1 ? one(f[0]) : `(${f.map(one).join(', ')})`;
}
