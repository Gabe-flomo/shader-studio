/**
 * shared.ts — what the miner and the generated moves both need: the move identity (an anonymous
 * shape of a template), hole names, the helper functions every Playfield shader has, and families.
 */
import { allNodes, BUILTIN_FUNCTION_NAMES, explainTree, parseExpr, type Expr, type GlslType, type Role, type TypeEnv } from '../lib/glslPatterns';
import { normalize, type N } from '../lib/glslPatterns/match';
import { rangeForValue } from '../lib/rangeMath';
import { hashText } from '../codeExplorer/extract';
import type { MoveFamily } from './moves';

/** The subject's name while mining (never a real GLSL name); templates call it `x`. */
export const SUBJ = '__s';

/**
 * Return types of the helpers every Playfield shader has (compiler/shaderAssembler.ts
 * ALWAYS_HELPERS_GLSL; a test keeps this in step), as inferTypes reads user functions: `name()`.
 */
export const HELPER_TYPES: Record<string, GlslType> = {
  noiseHash2: 'vec2', noiseHash1: 'float', valueNoise: 'float', rotate: 'vec2', rot2D: 'mat2', smin: 'float',
  sdBox: 'float', sdSegment: 'float', sdEllipse: 'float', opRepeat: 'vec2', opRepeatPolar: 'vec2',
};
export const HELPER_ENV: TypeEnv = Object.fromEntries(Object.entries(HELPER_TYPES).map(([k, v]) => [`${k}()`, v]));

const BUILTINS = new Set([...BUILTIN_FUNCTION_NAMES, 'texture', 'texture2D', 'textureLod']);
const CTOR = /^(vec[234]|mat[234]|float|int|bool|[ib]vec[234])$/;

/** A call a move may make: a GLSL built-in, a constructor or an always-there helper (not one the source redefines). */
export function callOk(callee: string, userFns?: ReadonlySet<string>): boolean {
  if (userFns?.has(callee)) return false;
  return BUILTINS.has(callee) || CTOR.test(callee) || callee in HELPER_TYPES;
}

export const VALUE_TYPES: ReadonlySet<GlslType> = new Set(['float', 'vec2', 'vec3', 'vec4']);
export const HOLE_TYPES: ReadonlySet<GlslType> = new Set(['float', 'int', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3']);

const NUM_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'k', 'm', 'n'];
const VAR_NAMES = ['u', 'v', 'w', 'r', 's', 'q', 'z'];
export const numHoleName = (i: number) => `#${NUM_NAMES[i % NUM_NAMES.length]}${i >= NUM_NAMES.length ? Math.floor(i / NUM_NAMES.length) + 1 : ''}`;
export const varHoleName = (i: number, time: number | null) =>
  time !== null ? `$t${time ? time + 1 : ''}` : `$${VAR_NAMES[i % VAR_NAMES.length]}${i >= VAR_NAMES.length ? Math.floor(i / VAR_NAMES.length) + 1 : ''}`;

/**
 * An anonymous, order-free shape: numbers (and number holes) are `#`, other names (and name holes)
 * `$type`, the subject `x`; `+` / `*` chains sorted. Equal for templates that are the same move.
 */
export function anonKey(n: N, typeOf: (name: string) => GlslType): string {
  switch (n.k) {
    case 'num': return '#';
    case 'hole': return n.lit ? '#' : `$${typeOf(`$${n.name}`)}`;
    case 'id': return n.name === SUBJ || n.name === 'x' ? 'x' : `$${typeOf(n.name)}`;
    case 'call': return `${n.callee}(${n.args.map(a => anonKey(a, typeOf)).join(',')})`;
    case 'nary': return `${n.neg ? '-' : ''}${n.op}[${n.items.map(a => anonKey(a, typeOf)).sort().join(',')}]`;
    case 'bin': return `(${anonKey(n.l, typeOf)}${n.op}${anonKey(n.r, typeOf)})`;
    case 'un': return `${n.op}${anonKey(n.a, typeOf)}`;
    case 'mem': return `${anonKey(n.o, typeOf)}.${n.f}`;
    case 'idx': return `${anonKey(n.o, typeOf)}[${n.i.k === 'num' ? n.i.v : anonKey(n.i, typeOf)}]`;
    case 'tern': return `(${anonKey(n.t, typeOf)}?${anonKey(n.a, typeOf)}:${anonKey(n.b, typeOf)})`;
  }
}

/** A template's identity: input type, role and anonymous shape. */
export function templateKey(template: string, inType: GlslType, role: Role, env: TypeEnv): string | null {
  const r = parseExpr(template);
  if (!r.ok) return null;
  return `${inType}|${role}|${anonKey(normalize(r.expr), name => env[name] ?? 'unknown')}`;
}

/** Does the subject appear outside a trig call as well as inside one (`x + a * sin(x.yx…)`)? */
function warps(e: Expr): boolean {
  let inside = false, outside = false;
  const go = (n: Expr, inTrig: boolean) => {
    if (n.kind === 'ident' && n.name === 'x') { if (inTrig) inside = true; else outside = true; return; }
    const trig = inTrig || (n.kind === 'call' && /^(sin|cos|tan)$/.test(n.callee));
    switch (n.kind) {
      case 'call': n.args.forEach(a => go(a, trig)); break;
      case 'binary': go(n.left, trig); go(n.right, trig); break;
      case 'unary': go(n.arg, trig); break;
      case 'member': go(n.object, trig); break;
      case 'index': go(n.object, trig); go(n.index, trig); break;
      case 'ternary': go(n.test, trig); go(n.then, trig); go(n.else, trig); break;
    }
  };
  go(e, false);
  return inside && outside;
}

/** The family a template belongs to, by the operations in it. */
export function familyOf(e: Expr, sig: { in: GlslType; out: GlslType; role: Role; outRole: Role }): MoveFamily {
  const nodes = allNodes(e);
  const calls = new Set(nodes.filter((n): n is Extract<Expr, { kind: 'call' }> => n.kind === 'call').map(n => n.callee));
  const has = (...c: string[]) => c.some(x => calls.has(x));
  if (has('rotate', 'rot2D') || (calls.has('mat2') && has('cos', 'sin'))) return 'rotate';
  if (calls.has('atan') && has('length')) return 'polar';
  if (sig.outRole === 'colour' && sig.role !== 'colour' && (has('cos', 'sin') || calls.has('mix'))) return 'colour';
  if (has('fract', 'mod', 'opRepeat', 'opRepeatPolar')) return 'repeat';
  if (has('floor', 'ceil', 'round', 'trunc')) return 'cell';
  if (has('noiseHash1', 'noiseHash2', 'valueNoise')) return 'noise';
  if (has('texture', 'texture2D', 'textureLod')) return 'sample';
  if (has('sin', 'cos', 'tan')) return warps(e) ? 'warp' : 'wave';
  if (has('abs')) return 'fold';
  if (has('length', 'distance', 'sdBox', 'sdSegment', 'sdEllipse', 'smin')) return 'distance';
  if (has('smoothstep', 'step')) return 'mask';
  if (calls.has('mix')) return 'blend';
  if (has('min', 'max', 'clamp', 'sign')) return 'clamp';
  if (has('pow', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'inversesqrt', 'tanh')) return 'curve';
  if (has('dot', 'cross', 'reflect')) return 'project';
  if (calls.has('normalize')) return 'normalize';
  if (has('atan', 'acos', 'asin')) return 'angle';
  if (nodes.every(n => n.kind === 'ident' || n.kind === 'member')) return 'swizzle';
  if ([...calls].some(c => /^(vec[234])$/.test(c))) return 'build';
  const ops = new Set(nodes.filter((n): n is Extract<Expr, { kind: 'binary' }> => n.kind === 'binary').map(n => n.op));
  if (ops.has('*') || ops.has('/')) {
    // x * x.y, x.x * x.y: the subject times itself across dimensions
    const xs = nodes.filter(n => n.kind === 'ident' && n.name === 'x').length;
    return xs > 1 ? 'product' : 'scale';
  }
  if (ops.has('+') || ops.has('-') || nodes.some(n => n.kind === 'unary')) return 'offset';
  return 'other';
}

const idiomCache = new Map<string, string | undefined>();
/** The glslPatterns idiom a template is, if its root is one. */
export function idiomOf(template: string, env: TypeEnv): string | undefined {
  if (idiomCache.has(template)) return idiomCache.get(template);
  let out: string | undefined;
  try {
    const r = parseExpr(template);
    if (r.ok) {
      const ex = explainTree(r.expr, template, { types: env });
      out = ex.idioms.find(h => h.node.id === r.expr.id)?.idiom.id ?? ex.idioms[0]?.idiom.id;
    }
  } catch { out = undefined; }
  idiomCache.set(template, out);
  return out;
}

export const moveId = (key: string) => `${hashText(key)}${hashText(`~${key}`).slice(0, 4)}`;


export function varDefault(type: GlslType, role: Role): string {
  if (role === 'time' && (type === 'float' || type === 'int')) return 'u_time';
  switch (type) {
    case 'int': return '1';
    case 'vec2': return 'vec2(0.5)';
    case 'vec3': return 'vec3(0.5)';
    case 'vec4': return 'vec4(0.5)';
    case 'mat2': return 'mat2(1.0)';
    case 'mat3': return 'mat3(1.0)';
    default: return '0.5';
  }
}

/** A slider range around the values seen. */
export function holeRange(min: number, max: number, def: number): { min: number; max: number } {
  if (!(max > min)) { const r = rangeForValue(def); return { min: r.min, max: r.max }; }
  const lo = rangeForValue(min), hi = rangeForValue(max);
  return { min: Math.min(lo.min, min), max: Math.max(hi.max, max) };
}

