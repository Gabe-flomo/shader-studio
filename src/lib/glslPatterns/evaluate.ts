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
    // Playfield's always-there helpers (compiler/shaderAssembler.ts BUILTIN_HELPERS_GLSL and friends)
    case 'rotate': { const v = x as number[], s = Math.sin(y as number), c = Math.cos(y as number); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; }
    case 'rot2D': { const s = Math.sin(x as number), c = Math.cos(x as number); return [NaN, c, -s, s, c]; }
    case 'noiseHash1': { const p = x as number[]; return fract(Math.sin(p[0] * 127.1 + p[1] * 311.7) * 43758.5453123); }
    case 'noiseHash2': { const p = x as number[]; return [p[0] * 127.1 + p[1] * 311.7, p[0] * 269.5 + p[1] * 183.3].map(v => -1 + 2 * fract(Math.sin(v) * 43758.5453123)); }
    case 'valueNoise': {
      const p = x as number[];
      const i = p.map(Math.floor), f = p.map(fract), u = f.map(v => v * v * (3 - 2 * v));
      const h = (dx: number, dy: number) => call('noiseHash1', [[i[0] + dx, i[1] + dy]]) as number;
      const lerp = (a0: number, a1: number, t: number) => a0 * (1 - t) + a1 * t;
      return lerp(lerp(h(0, 0), h(1, 0), u[0]), lerp(h(0, 1), h(1, 1), u[0]), u[1]);
    }
    case 'sdBox': {
      const p = x as number[], b = y as number[];
      const d = [Math.abs(p[0]) - b[0], Math.abs(p[1]) - b[1]];
      return Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0)) + Math.min(Math.max(d[0], d[1]), 0);
    }
    case 'sdSegment': {
      const p = x as number[], q = y as number[], r = z as number[];
      const pa = [p[0] - q[0], p[1] - q[1]], ba = [r[0] - q[0], r[1] - q[1]];
      const h = Math.min(1, Math.max(0, (pa[0] * ba[0] + pa[1] * ba[1]) / (ba[0] * ba[0] + ba[1] * ba[1])));
      return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h);
    }
    case 'opRepeat': { const s = y as number; return map1(x, v => { const w = v + s * 0.5; return w - s * Math.floor(w / s) - s * 0.5; }); }
    case 'opRepeatPolar': {
      const p = x as number[], an = (2 * Math.PI) / (y as number);
      let ang = Math.atan2(p[1], p[0]) + an * 0.5;
      ang = ang - an * Math.floor(ang / an) - an * 0.5;
      const l = Math.hypot(p[0], p[1]);
      return [Math.cos(ang) * l, Math.sin(ang) * l];
    }
    default: throw new Error(`evaluate: no rule for ${name}()`);
  }
}

function mul(a: Value, b: Value): Value {
  if (isMat2(a) && isV(b) && !isMat2(b)) return [a[1] * b[0] + a[3] * b[1], a[2] * b[0] + a[4] * b[1]];
  if (isV(a) && !isMat2(a) && isMat2(b)) return [a[0] * b[1] + a[1] * b[2], a[0] * b[3] + a[1] * b[4]];
  return map2(a, b, (x, y) => x * y);
}

/**
 * `evaluate`, compiled once into closures: the same results, a few times faster when one
 * expression runs over many points (the Expression Builder's dull-move filter). Throws when run
 * on anything it can't do, like `evaluate`.
 */
export function compileExpr(e: Expr): (env: EvalEnv) => Value {
  switch (e.kind) {
    case 'num': { const v = e.value; return () => v; }
    case 'ident': {
      const name = e.name, c = NAMED_CONSTANTS[name];
      return env => {
        const v = env[name];
        if (v !== undefined) return v;
        if (c !== undefined) return c;
        throw new Error(`evaluate: ${name} has no value`);
      };
    }
    case 'unary': {
      const a = compileExpr(e.arg);
      if (e.op === '-') return env => map1(a(env), x => -x);
      if (e.op === '!') return env => map1(a(env), x => (x ? 0 : 1));
      return a;
    }
    case 'binary': {
      const l = compileExpr(e.left), r = compileExpr(e.right);
      switch (e.op) {
        case '+': return env => map2(l(env), r(env), (x, y) => x + y);
        case '-': return env => map2(l(env), r(env), (x, y) => x - y);
        case '*': return env => mul(l(env), r(env));
        case '/': return env => map2(l(env), r(env), (x, y) => x / y);
        case '<': return env => Number((l(env) as number) < (r(env) as number));
        case '>': return env => Number((l(env) as number) > (r(env) as number));
        case '<=': return env => Number((l(env) as number) <= (r(env) as number));
        case '>=': return env => Number((l(env) as number) >= (r(env) as number));
        case '==': return env => Number(l(env) === r(env));
        case '!=': return env => Number(l(env) !== r(env));
        case '&&': return env => Number(!!l(env) && !!r(env));
        case '||': return env => Number(!!l(env) || !!r(env));
        default: { const op = e.op; return () => { throw new Error(`evaluate: no rule for ${op}`); }; }
      }
    }
    case 'ternary': { const t = compileExpr(e.test), a = compileExpr(e.then), b = compileExpr(e.else); return env => (t(env) ? a(env) : b(env)); }
    case 'member': {
      const o = compileExpr(e.object);
      const idx = e.field.split('').map(swzIndex);
      if (idx.length === 1) { const i = idx[0]; return env => { const v = o(env); return isV(v) ? v[i] : v; }; }
      return env => { const v = o(env); return idx.map(i => (isV(v) ? v[i] : v)); };
    }
    case 'index': { const o = compileExpr(e.object), i = compileExpr(e.index); return env => (o(env) as number[])[i(env) as number]; }
    case 'call': {
      const args = e.args.map(compileExpr), name = e.callee;
      return env => call(name, args.map(a => a(env)));
    }
  }
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
