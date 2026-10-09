/**
 * typecheck.ts — GLSL ES 3.0's typing rules, strictly: what `inferTypes` (types.ts) guesses
 * leniently for explaining, this checks the way the GPU's compiler will.
 *
 *  - No implicit conversions: `x * 2` on a float is an error (`2` is an int), as is `pow(x, 2)`.
 *  - Arithmetic: scalar ⊕ vector, vectors of the same size, matrix × vector of matching size.
 *  - Swizzles only on vectors (GLSL ES 3.0 can't swizzle a float), within the vector's size.
 *  - Constructors by component count: `vec3(vec2, float)`; not `vec4(float, float)` (too few) or
 *    `vec2(float, float, float)` (an argument left over); one scalar fills a vector.
 *  - Built-ins and Playfield's helpers by their overloads (functions.ts): genType arguments must
 *    agree, so `step(vec3, float)` and `mix(vec2, vec3, float)` are errors, `step(float, vec3)`
 *    and `clamp(vec3, float, float)` are fine.
 *
 * Names the environment doesn't know are 'unknown', which matches anything: the check reports only
 * what is certainly wrong. Pure.
 */
import type { Expr, GlslType } from './ast';
import { functionInfo, type FnOverload } from './functions';
import { GLOBAL_TYPES, VEC_SIZE, vecOf, type TypeEnv } from './types';

export interface TypeCheck {
  ok: boolean;
  /** The expression's type ('unknown' when it can't tell). */
  type: GlslType;
  /** What is wrong, in GLSL's terms ("no overload of step(vec3, float)"). */
  errors: string[];
}

const isVec = (t: GlslType) => t === 'vec2' || t === 'vec3' || t === 'vec4';
const isMat = (t: GlslType) => t === 'mat2' || t === 'mat3' || t === 'mat4';

const matSize = (t: GlslType) => (t === 'mat2' ? 2 : t === 'mat3' ? 3 : t === 'mat4' ? 4 : 0);
/** Components a constructor argument gives. */
const comps = (t: GlslType): number => (isMat(t) ? matSize(t) ** 2 : VEC_SIZE[t] ?? 0);
const SWZ_SETS = ['xyzw', 'rgba', 'stpq'];
const GEN_FLOAT: GlslType[] = ['float', 'vec2', 'vec3', 'vec4'];
const MATS: GlslType[] = ['mat2', 'mat3', 'mat4'];

/**
 * The types a parameter type allows. Types this checker doesn't model (uint, ivecN, bvecN, other
 * samplers) allow none of the ones it does: only an argument of unknown type can match them.
 */
function allowed(p: string): GlslType[] {
  switch (p) {
    case 'genType': return GEN_FLOAT;
    case 'vec': return ['vec2', 'vec3', 'vec4'];
    case 'mat': return MATS;
    case 'genIType': case 'int': return ['int'];
    case 'genBType': case 'bool': return ['bool'];
    case 'gsampler2D': case 'sampler2D': return ['sampler2D'];
    case 'float': case 'vec2': case 'vec3': case 'vec4': case 'mat2': case 'mat3': case 'mat4': return [p];
    default: return [];
  }
}

/** Generic parameter types: every argument of one of these must be the same type. */
const GENERIC = new Set(['genType', 'genIType', 'genBType', 'vec', 'mat']);

function returnOf(ov: FnOverload, bound: Map<string, GlslType>): GlslType {
  const r = ov.returns;
  if (bound.has(r)) return bound.get(r)!;
  // ivec / bvec results aren't modelled: only their scalar forms are.
  const g = bound.get('genType');
  if (r === 'genIType') return g === undefined || g === 'float' ? 'int' : 'unknown';
  if (r === 'genBType') return g === undefined || g === 'float' ? 'bool' : 'unknown';
  if (r === 'gvec4') return 'vec4';
  const a = allowed(r);
  return a.length === 1 ? a[0] : 'unknown';
}

/** Does `ov` take these argument types? (unknown arguments match anything) */
function matchOverload(ov: FnOverload, args: GlslType[]): { ok: boolean; ret: GlslType } {
  if (ov.params.length !== args.length) return { ok: false, ret: 'unknown' };
  const bound = new Map<string, GlslType>();
  for (let i = 0; i < args.length; i++) {
    const p = ov.params[i].type, a = args[i];
    const al = allowed(p);
    if (a === 'unknown') continue;
    if (!al.includes(a)) return { ok: false, ret: 'unknown' };
    if (GENERIC.has(p)) {
      const b = bound.get(p);
      if (b && b !== a) return { ok: false, ret: 'unknown' };
      bound.set(p, a);
    }
  }
  return { ok: true, ret: returnOf(ov, bound) };
}

/** Strictly type-check an expression with the given names (GLSL ES 3.0 rules). */
export function checkTypes(e: Expr, env: TypeEnv = {}): TypeCheck {
  const errors: string[] = [];
  const err = (m: string): GlslType => { errors.push(m); return 'unknown'; };

  const arith = (op: string, a: GlslType, b: GlslType): GlslType => {
    if (a === 'unknown' || b === 'unknown') {
      // One side known: a vector or matrix still decides (scalar ⊕ vector is the vector).
      const k = a === 'unknown' ? b : a;
      return isVec(k) || isMat(k) ? (op === '*' && isMat(k) ? 'unknown' : k) : 'unknown';
    }
    if (a === 'bool' || b === 'bool' || a === 'sampler2D' || b === 'sampler2D') return err(`can't use ${op} on ${a} and ${b}`);
    if (a === 'int' && b === 'int') return 'int';
    if (a === 'int' || b === 'int') return err(`${a} ${op} ${b}: GLSL ES doesn't convert int to float (write 2.0, not 2)`);
    if (op === '%') return err(`% is for ints, not ${a}`);
    if (a === 'float') return b;
    if (b === 'float') return a;
    if (isVec(a) && isVec(b)) return a === b ? a : err(`${a} ${op} ${b}: the sizes differ`);
    if (isMat(a) && isMat(b)) return a === b ? a : err(`${a} ${op} ${b}: the sizes differ`);
    if (op === '*' && isMat(a) && isVec(b)) return matSize(a) === VEC_SIZE[b] ? b : err(`${a} * ${b}: the sizes differ`);
    if (op === '*' && isVec(a) && isMat(b)) return matSize(b) === VEC_SIZE[a] ? a : err(`${a} * ${b}: the sizes differ`);
    return err(`can't use ${op} on ${a} and ${b}`);
  };

  const ctor = (c: string, args: GlslType[]): GlslType => {
    const out = (/^[ib]vec/.test(c) ? 'unknown' : c) as GlslType;
    if (!args.length) return err(`${c}() needs arguments`);
    if (args.some(a => a === 'sampler2D')) return err(`${c}() can't take a sampler`);
    if (c === 'float' || c === 'int' || c === 'bool') {
      if (args.length !== 1) return err(`${c}() takes one argument, not ${args.length}`);
      return c as GlslType;
    }
    if (args.some(a => a === 'unknown')) return out;
    const need = /^mat/.test(c) ? Number(c[3]) ** 2 : Number(c[c.length - 1]);
    if (args.length === 1) {
      const a = args[0];
      if (a === 'float' || a === 'int' || a === 'bool') return out;
      if (/^mat/.test(c)) return isMat(a) ? out : err(`${c}(${a}): a matrix is built from a number, a matrix, or ${need} components`);
      return comps(a) >= need ? out : err(`${c}(${a}): ${comps(a)} components, ${need} needed`);
    }
    if (/^mat/.test(c) && args.some(isMat)) return err(`${c}(${args.join(', ')}): a matrix argument must be the only one`);
    const total = args.reduce((s, a) => s + comps(a), 0);
    const beforeLast = total - comps(args[args.length - 1]);
    if (total < need) return err(`${c}(${args.join(', ')}): ${total} components, ${need} needed`);
    if (beforeLast >= need) return err(`${c}(${args.join(', ')}): too many arguments (${total} components, ${need} needed)`);
    return out;
  };

  const call = (c: string, args: GlslType[]): GlslType => {
    if (/^(float|int|bool|[ib]?vec[234]|mat[234])$/.test(c)) return ctor(c, args);
    const user = env[`${c}()`];
    const info = functionInfo(c);
    if (!info || info.kind === 'constructor') return user ?? 'unknown';
    // Built-ins and Playfield's always-there helpers (which code may not redefine) by their overloads.
    const hits = info.overloads.map(ov => matchOverload(ov, args)).filter(m => m.ok);
    if (!hits.length) return err(`no overload of ${c}(${args.join(', ')})`);
    const rets = new Set(hits.map(h => h.ret));
    return rets.size === 1 ? hits[0].ret : 'unknown';
  };

  const go = (n: Expr): GlslType => {
    switch (n.kind) {
      case 'num': return n.int ? 'int' : 'float';
      case 'ident': return env[n.name] ?? GLOBAL_TYPES[n.name] ?? (n.name === 'true' || n.name === 'false' ? 'bool' : 'unknown');
      case 'unary': {
        const a = go(n.arg);
        if (a === 'unknown') return n.op === '!' ? 'bool' : 'unknown';
        if (n.op === '!') return a === 'bool' ? 'bool' : err(`!${a}: ! is for bools`);
        return a === 'bool' || a === 'sampler2D' ? err(`${n.op}${a}`) : a;
      }
      case 'binary': {
        const a = go(n.left), b = go(n.right);
        const op = n.op;
        if (op === '&&' || op === '||' || op === '^^') {
          if ((a !== 'unknown' && a !== 'bool') || (b !== 'unknown' && b !== 'bool')) return err(`${a} ${op} ${b}: needs bools`);
          return 'bool';
        }
        if (op === '<' || op === '>' || op === '<=' || op === '>=') {
          if (a !== 'unknown' && a !== 'float' && a !== 'int') return err(`${a} ${op} ${b}: compares numbers only (lessThan() for vectors)`);
          if (b !== 'unknown' && b !== 'float' && b !== 'int') return err(`${a} ${op} ${b}: compares numbers only (lessThan() for vectors)`);
          if (a !== 'unknown' && b !== 'unknown' && a !== b) return err(`${a} ${op} ${b}: GLSL ES doesn't convert int to float`);
          return 'bool';
        }
        if (op === '==' || op === '!=') {
          if (a !== 'unknown' && b !== 'unknown' && a !== b) return err(`${a} ${op} ${b}: different types`);
          return 'bool';
        }
        return arith(op, a, b);
      }
      case 'ternary': {
        const t = go(n.test), a = go(n.then), b = go(n.else);
        if (t !== 'unknown' && t !== 'bool') err(`the condition is a ${t}, not a bool`);
        if (a !== 'unknown' && b !== 'unknown' && a !== b) return err(`? ${a} : ${b}: both sides must be the same type`);
        return a !== 'unknown' ? a : b;
      }
      case 'member': {
        const o = go(n.object);
        const f = n.field;
        const set = SWZ_SETS.find(s => [...f].every(ch => s.includes(ch)));
        if (!set || f.length > 4) return o === 'unknown' ? 'unknown' : err(`.${f} isn't a swizzle`);
        if (o === 'unknown') return vecOf(f.length);
        if (!isVec(o)) return err(`.${f} on a ${o}: only vectors have components in GLSL ES`);
        const size = VEC_SIZE[o]!;
        if ([...f].some(ch => set.indexOf(ch) >= size)) return err(`.${f} on a ${o}: it has only ${size} components`);
        return vecOf(f.length);
      }
      case 'index': {
        const o = go(n.object), i = go(n.index);
        if (i !== 'unknown' && i !== 'int') err(`[${i}]: an index must be an int`);
        if (o === 'unknown') return 'unknown';
        if (isVec(o)) return 'float';
        if (isMat(o)) return vecOf(matSize(o));
        return err(`can't index a ${o}`);
      }
      case 'call': return call(n.callee, n.args.map(go));
    }
  };
  const type = go(e);
  return { ok: errors.length === 0, type, errors };
}
