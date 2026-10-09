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
import { parseLine, type ParsedLine } from './parse';

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

// ── A whole block, measured ───────────────────────────────────────────────────

/** How one input of a block is drawn: a fixed value, a range, or a random unit-length direction. */
export interface BlockInput {
  name: string;
  /** 'float', 'vec2', 'vec3', 'vec4'. */
  type: string;
  /** The value at the sample pixel. */
  value: Value;
  /** Where it runs across the picture, per component. Equal ends: it does not change. */
  range: [number, number];
  /** A direction: drawn as a random unit-length vector (a surface normal, a ray direction). */
  unit?: boolean;
  /** It does not change across the picture: always `value`. */
  fixed?: boolean;
}

export interface BlockLineNumbers {
  /** The variable the line writes (`d`; `p` for `p.xy`); undefined for `return` and bare expressions. */
  target?: string;
  /** Its value at the sample pixel (the whole variable after the line ran); null when it can't be computed here. */
  value: Value | null;
  /** Its spread across the picture, one [min, max] per component; null when unknown. */
  ranges: Array<[number, number]> | null;
}

const SWZ_ALL = 'xyzwrgbastpq';

/** Write `v` into `target` (`d`, `p.xy`, with `+=` and friends); the variable's new value, or null when it can't. */
function assign(env: EvalEnv, target: string, op: string | undefined, v: Value): Value | null {
  const [base, field] = target.split('.');
  const old = env[base];
  const combine = (a: number, b: number) => (op === '+=' ? a + b : op === '-=' ? a - b : op === '*=' ? a * b : op === '/=' ? a / b : b);
  if (!field) {
    if (!op || op === '=') { env[base] = v; return v; }
    if (old === undefined) return null;
    const next: Value = Array.isArray(old)
      ? old.map((x, i) => combine(x, Array.isArray(v) ? v[i] ?? 0 : v))
      : combine(old, Array.isArray(v) ? v[0] : v);
    env[base] = next;
    return next;
  }
  if (!Array.isArray(old)) return null;
  const next = [...old];
  const vals = Array.isArray(v) ? v : Array(field.length).fill(v);
  for (let i = 0; i < field.length; i++) {
    const k = SWZ_ALL.indexOf(field[i]) % 4;
    if (k < 0 || k >= next.length) return null;
    next[k] = combine(next[k], vals[i] ?? 0);
  }
  env[base] = next;
  return next;
}

/** Run the statements once in `env` (changed in place): each line's result, or null where the CPU can't. */
function runBlock(lines: readonly ParsedLine[], env: EvalEnv): Array<Value | null> {
  return lines.map(l => {
    const v = tryEval(l.expr, env);
    const base = l.target?.split('.')[0];
    if (v === null) { if (base) delete env[base]; return null; }
    if (!l.target) return v;
    const out = assign(env, l.target, l.op, v);
    if (out === null || !flatOf(out).every(Number.isFinite)) { if (base) delete env[base]; return null; }
    return out;
  });
}

/** A random unit-length vector of `n` components. */
function unitVec(n: number, draw: () => number): number[] {
  for (let tries = 0; tries < 100; tries++) {
    const v = Array.from({ length: n }, () => draw() * 2 - 1);
    const l = Math.hypot(...v);
    if (l > 1e-3 && l <= 1) return v.map(x => x / l);
  }
  return [0, 1, 0, 0].slice(0, n);
}

/**
 * Every line of a block measured on the CPU: once at the sample pixel (the inputs' `value`s), and many times with the
 * inputs drawn over their ranges (deterministic), each line's result carried into the lines after it. A line the
 * evaluator can't do (a texture read, a user function) has no numbers, and neither has anything built from it.
 */
export function workedBlock(statements: readonly string[], inputs: readonly BlockInput[], samples = 200): BlockLineNumbers[] {
  const parsed = statements.map(s => parseLine(s));
  const lines = parsed.flatMap(p => (p.ok ? [p.line] : []));
  const draw = rng(0x2545f491);
  const start = (pick: (i: BlockInput) => Value): EvalEnv => Object.fromEntries(inputs.map(i => [i.name, pick(i)]));
  const at = runBlock(lines, start(i => i.value));
  const spread: Array<Array<[number, number]> | null> = lines.map(() => null);
  for (let s = 0; s < samples; s++) {
    const env = start(i => {
      if (i.fixed) return i.value;
      const n = dims(i.type);
      if (i.unit && n > 1) return unitVec(n, draw);
      const one = () => i.range[0] + (i.range[1] - i.range[0]) * draw();
      return n === 1 ? one() : Array.from({ length: n }, one);
    });
    runBlock(lines, env).forEach((v, k) => {
      if (v === null) return;
      const f = flatOf(v);
      const r = spread[k] ?? (spread[k] = f.map(x => [x, x] as [number, number]));
      f.forEach((x, c) => { if (r[c]) { r[c][0] = Math.min(r[c][0], x); r[c][1] = Math.max(r[c][1], x); } });
    });
  }
  // One entry per statement (one that does not parse has no numbers)
  let k = 0;
  return parsed.map(p => {
    if (!p.ok) return { value: null, ranges: null };
    const i = k++;
    return { target: p.line.target?.split('.')[0], value: at[i], ranges: spread[i] };
  });
}
