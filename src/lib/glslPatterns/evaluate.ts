/**
 * A tiny CPU evaluator for the expression AST: floats, vec2–vec4 and mat2, with GLSL's
 * component-wise rules and the common built-ins. It exists so the generaliser can prove that a
 * made function gives the same values as the expression it came from (see the tests), and
 * for any caller that wants a quick number without a GPU. Not a GLSL implementation: no ints,
 * no bools beyond comparisons, no textures.
 */
import type { Expr } from './ast';
import { NAMED_CONSTANTS } from './match';
import { parseExpr } from './parse';

export type Value = number | number[];
export interface EvalEnv { [name: string]: Value }

const isV = (v: Value): v is number[] => Array.isArray(v);
const map1 = (a: Value, f: (x: number) => number): Value => (isV(a) ? a.map(f) : f(a));
function map2(a: Value, b: Value, f: (x: number, y: number) => number): Value {
  if (isV(a) && isV(b)) return a.map((x, i) => f(x, b[i] ?? 0));
  if (isV(a)) return a.map(x => f(x, b as number));
  if (isV(b)) return b.map(y => f(a as number, y));
  return f(a, b);
}
function map3(a: Value, b: Value, c: Value, f: (x: number, y: number, z: number) => number): Value {
  const n = [a, b, c].find(isV)?.length;
  if (n === undefined) return f(a as number, b as number, c as number);
  const at = (v: Value, i: number) => (isV(v) ? v[i] : v);
  return Array.from({ length: n }, (_, i) => f(at(a, i), at(b, i), at(c, i)));
}
const flat = (vs: Value[]): number[] => vs.flatMap(v => (isV(v) ? v : [v]));
const len = (v: Value) => Math.sqrt(flat([v]).reduce((s, x) => s + x * x, 0));
const dot = (a: Value, b: Value) => { const x = flat([a]), y = flat([b]); return x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0); };
const fract = (x: number) => x - Math.floor(x);
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

const SWZ = 'xyzwrgbastpq';
const swzIndex = (ch: string) => SWZ.indexOf(ch) % 4;

/** mat2 values are 5-element arrays tagged with a leading NaN: [NaN, m00, m01, m10, m11] (column-major). */
const isMat2 = (v: Value): v is number[] => isV(v) && v.length === 5 && Number.isNaN(v[0]);

function call(name: string, a: Value[]): Value {
  const [x, y, z] = a;
  switch (name) {
    case 'sin': return map1(x, Math.sin); case 'cos': return map1(x, Math.cos); case 'tan': return map1(x, Math.tan);
    case 'asin': return map1(x, Math.asin); case 'acos': return map1(x, Math.acos);
    case 'atan': return a.length === 2 ? map2(x, y, Math.atan2) : map1(x, Math.atan);
    case 'exp': return map1(x, Math.exp); case 'exp2': return map1(x, v => 2 ** v); case 'log': return map1(x, Math.log); case 'log2': return map1(x, Math.log2);
    case 'sqrt': return map1(x, Math.sqrt); case 'inversesqrt': return map1(x, v => 1 / Math.sqrt(v));
    case 'abs': return map1(x, Math.abs); case 'sign': return map1(x, Math.sign); case 'floor': return map1(x, Math.floor); case 'ceil': return map1(x, Math.ceil);
    case 'fract': return map1(x, fract); case 'round': return map1(x, Math.round); case 'trunc': return map1(x, Math.trunc);
    case 'sinh': return map1(x, Math.sinh); case 'cosh': return map1(x, Math.cosh); case 'tanh': return map1(x, Math.tanh);
    case 'asinh': return map1(x, Math.asinh); case 'acosh': return map1(x, Math.acosh); case 'atanh': return map1(x, Math.atanh);
    case 'roundEven': return map1(x, v => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; });
    // Playfield's polynomial smooth minimum (shaderAssembler GLSL_SMIN)
    case 'smin': return map3(x, y, z, (p, q, k) => { const h = Math.max(k - Math.abs(p - q), 0) / k; return Math.min(p, q) - h * h * h * k / 6; });
    case 'mod': return map2(x, y, (p, q) => p - q * Math.floor(p / q));
    case 'min': return map2(x, y, Math.min); case 'max': return map2(x, y, Math.max);
    case 'clamp': return map3(x, y, z, (v, lo, hi) => Math.min(hi, Math.max(lo, v)));
    case 'mix': return map3(x, y, z, (p, q, t) => p * (1 - t) + q * t);
    case 'step': return map2(x, y, (e, v) => (v < e ? 0 : 1));
    case 'smoothstep': return map3(x, y, z, smooth);
    case 'pow': return map2(x, y, Math.pow);
    case 'radians': return map1(x, v => (v * Math.PI) / 180); case 'degrees': return map1(x, v => (v * 180) / Math.PI);
    case 'length': return len(x);
    case 'distance': return len(map2(x, y, (p, q) => p - q));
    case 'dot': return dot(x, y);
    case 'normalize': { const l = len(x); return map1(x, v => v / l); }
    case 'cross': { const p = x as number[], q = y as number[]; return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]; }
    case 'float': return flat([x])[0];
    case 'vec2': case 'vec3': case 'vec4': {
      const n = Number(name[3]);
      const f = flat(a);
      return f.length === 1 ? Array(n).fill(f[0]) : f.slice(0, n);
    }
    case 'mat2': { const f = flat(a); return [NaN, ...(f.length === 1 ? [f[0], 0, 0, f[0]] : f.slice(0, 4))]; }
    default: throw new Error(`evaluate: no rule for ${name}()`);
  }
}

function mul(a: Value, b: Value): Value {
  if (isMat2(a) && isV(b) && !isMat2(b)) return [a[1] * b[0] + a[3] * b[1], a[2] * b[0] + a[4] * b[1]];
  if (isV(a) && !isMat2(a) && isMat2(b)) return [a[0] * b[1] + a[1] * b[2], a[0] * b[3] + a[1] * b[4]];
  return map2(a, b, (x, y) => x * y);
}

/** Evaluate an expression with the given names bound. Throws on anything it can't do. */
export function evaluate(e: Expr, env: EvalEnv): Value {
  switch (e.kind) {
    case 'num': return e.value;
    case 'ident': {
      if (e.name in env) return env[e.name];
      if (e.name in NAMED_CONSTANTS) return NAMED_CONSTANTS[e.name];
      throw new Error(`evaluate: ${e.name} has no value`);
    }
    case 'unary': { const v = evaluate(e.arg, env); return e.op === '-' ? map1(v, x => -x) : e.op === '!' ? map1(v, x => (x ? 0 : 1)) : v; }
    case 'binary': {
      const a = evaluate(e.left, env), b = evaluate(e.right, env);
      switch (e.op) {
        case '+': return map2(a, b, (x, y) => x + y);
        case '-': return map2(a, b, (x, y) => x - y);
        case '*': return mul(a, b);
        case '/': return map2(a, b, (x, y) => x / y);
        case '<': return Number((a as number) < (b as number)); case '>': return Number((a as number) > (b as number));
        case '<=': return Number((a as number) <= (b as number)); case '>=': return Number((a as number) >= (b as number));
        case '==': return Number(a === b); case '!=': return Number(a !== b);
        case '&&': return Number(!!a && !!b); case '||': return Number(!!a || !!b);
        default: throw new Error(`evaluate: no rule for ${e.op}`);
      }
    }
    case 'ternary': return evaluate(e.test, env) ? evaluate(e.then, env) : evaluate(e.else, env);
    case 'member': {
      const o = evaluate(e.object, env);
      const comps = e.field.split('').map(ch => (isV(o) ? o[swzIndex(ch)] : o));
      return comps.length === 1 ? comps[0] : comps;
    }
    case 'index': { const o = evaluate(e.object, env) as number[]; return o[evaluate(e.index, env) as number]; }
    case 'call': return call(e.callee, e.args.map(a => evaluate(a, env)));
  }
}

/**
 * Evaluate a one-statement function (`float f(vec2 p, float r) { return …; }`) on arguments,
 * in parameter order. Enough for the functions the generaliser writes.
 */
export function evaluateFunction(code: string, args: Value[], extra: EvalEnv = {}): Value {
  const m = /^\s*\w+\s+\w+\s*\(([^)]*)\)\s*\{\s*return\s+([\s\S]*?);\s*\}\s*$/.exec(code);
  if (!m) throw new Error('evaluateFunction: expected `type name(params) { return …; }`');
  const names = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s+/).pop()!);
  const r = parseExpr(m[2]);
  if (!r.ok) throw new Error(r.error);
  const env: EvalEnv = { ...extra };
  names.forEach((n, i) => { env[n] = args[i]; });
  return evaluate(r.expr, env);
}
