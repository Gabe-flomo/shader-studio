/**
 * Types of an expression's nodes, from the names it reads (an environment) and GLSL's rules.
 * A name nobody declared is 'unknown', and so is anything computed only from unknowns where
 * the rules can't tell; the explainer then words it without claiming a type.
 */
import type { Expr, GlslType } from './ast';

/** What a host knows about the names in scope. */
export interface TypeEnv { [name: string]: GlslType | undefined }

/** Names every Playfield shader has. */
export const GLOBAL_TYPES: TypeEnv = {
  u_time: 'float', iTime: 'float', u_resolution: 'vec2', iResolution: 'vec3', u_mouse: 'vec2', iMouse: 'vec4',
  vUv: 'vec2', gl_FragCoord: 'vec4', fragCoord: 'vec2', PI: 'float', TAU: 'float', u_frame: 'float', iFrame: 'int',
};

/** Functions whose result has the (widest) type of their arguments. */
const GEN = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'inversesqrt',
  'abs', 'sign', 'floor', 'ceil', 'fract', 'round', 'trunc', 'roundEven', 'mod', 'min', 'max', 'clamp', 'mix', 'pow', 'radians', 'degrees',
  'normalize', 'reflect', 'fwidth', 'dFdx', 'dFdy']);

const FIXED: Record<string, GlslType> = {
  length: 'float', distance: 'float', dot: 'float', determinant: 'float', cross: 'vec3', texture: 'vec4', texture2D: 'vec4', textureLod: 'vec4', texelFetch: 'vec4',
  // Playfield's always-available helpers
  palette: 'vec3', rotate: 'vec2', sdBox: 'float', sdSegment: 'float', sdEllipse: 'float', opRepeat: 'vec2', opRepeatPolar: 'vec2',
  valueNoise: 'float', noiseHash1: 'float', noiseHash2: 'vec2', hash21: 'float', hash22: 'vec2',
  float: 'float', int: 'int', bool: 'bool',
  lessThan: 'unknown', greaterThan: 'unknown', any: 'bool', all: 'bool',
};

export const VEC_SIZE: Partial<Record<GlslType, number>> = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 };
export const vecOf = (n: number): GlslType => (n === 1 ? 'float' : n === 2 ? 'vec2' : n === 3 ? 'vec3' : n === 4 ? 'vec4' : 'unknown');
const isVec = (t: GlslType) => t === 'vec2' || t === 'vec3' || t === 'vec4';
const isMat = (t: GlslType) => t === 'mat2' || t === 'mat3' || t === 'mat4';
const isScalar = (t: GlslType) => t === 'float' || t === 'int';

function widest(ts: GlslType[]): GlslType {
  let best: GlslType = 'unknown';
  for (const t of ts) {
    if (t === 'unknown') continue;
    if (best === 'unknown' || (VEC_SIZE[t] ?? 0) > (VEC_SIZE[best] ?? 0)) best = t;
  }
  // An unknown argument could be the wider one: only claim a scalar when every argument is known
  if (isScalar(best) && ts.some(t => t === 'unknown')) return 'unknown';
  return best === 'int' ? 'float' : best;
}

/** The result type of `a op b`. */
export function binaryType(op: string, a: GlslType, b: GlslType): GlslType {
  if (['<', '>', '<=', '>=', '==', '!=', '&&', '||', '^^'].includes(op)) return 'bool';
  if (op === '*') {
    if (isMat(a) && isVec(b)) return b;
    if (isVec(a) && isMat(b)) return a;
    if (isMat(a) && isMat(b)) return a;
    if (isMat(a) && isScalar(b)) return a;
    if (isScalar(a) && isMat(b)) return b;
  }
  if (isVec(a)) return a;
  if (isVec(b)) return b;
  if (isMat(a) || isMat(b)) return 'unknown';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  return a === 'int' && b === 'int' ? 'int' : 'float';
}

const SWZ = /^(?:[xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})$/;

/** The type of every node, by id. */
export function inferTypes(e: Expr, env: TypeEnv = {}): Map<number, GlslType> {
  const out = new Map<number, GlslType>();
  const go = (n: Expr): GlslType => {
    let t: GlslType;
    switch (n.kind) {
      case 'num': t = n.int ? 'int' : 'float'; break;
      case 'ident': t = env[n.name] ?? GLOBAL_TYPES[n.name] ?? 'unknown'; break;
      case 'unary': { const a = go(n.arg); t = n.op === '!' ? 'bool' : a; break; }
      case 'binary': t = binaryType(n.op, go(n.left), go(n.right)); break;
      case 'ternary': { go(n.test); const a = go(n.then), b = go(n.else); t = a !== 'unknown' ? a : b; break; }
      case 'member': { const o = go(n.object); t = SWZ.test(n.field) ? vecOf(n.field.length) : o === 'unknown' ? 'unknown' : 'unknown'; break; }
      case 'index': { const o = go(n.object); go(n.index); t = isVec(o) ? 'float' : o === 'mat2' ? 'vec2' : o === 'mat3' ? 'vec3' : o === 'mat4' ? 'vec4' : 'unknown'; break; }
      case 'call': {
        const args = n.args.map(go);
        const c = n.callee;
        if (/^(vec[234]|mat[234])$/.test(c)) t = c as GlslType;
        else if (/^[ib]vec[234]$/.test(c)) t = (`vec${c[4]}`) as GlslType;
        else if (c === 'step') t = widest([args[1] ?? 'unknown', args[0] ?? 'unknown']);
        else if (c === 'smoothstep') t = widest([args[2] ?? 'unknown', args[0] ?? 'unknown', args[1] ?? 'unknown']);
        else if (c === 'refract' || c === 'faceforward') t = args[0] ?? 'unknown';
        else if (c === 'mix') t = widest([args[0] ?? 'unknown', args[1] ?? 'unknown']);
        else if (c === 'clamp') t = args[0] !== 'unknown' && args[0] !== undefined ? (args[0] === 'int' ? 'float' : args[0]) : 'unknown';
        else if (GEN.has(c)) t = widest(args);
        else t = FIXED[c] ?? env[`${c}()`] ?? 'unknown';
        break;
      }
    }
    out.set(n.id, t);
    return t;
  };
  go(e);
  return out;
}

/**
 * Types read off declarations in a block of code: `float d = …`, `vec2 p`, function
 * parameters `(vec2 uv, float r)`, uniforms. A name declared twice keeps the first type.
 */
export function typesFromCode(code: string): TypeEnv {
  const env: TypeEnv = {};
  const re = /\b(float|int|bool|vec[234]|mat[234]|sampler2D)\s+([A-Za-z_]\w*)\s*(?=[=;,)[])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) if (!(m[2] in env)) env[m[2]] = m[1] as GlslType;
  // `float a, b, c;`
  const multi = /\b(float|int|vec[234])\s+((?:[A-Za-z_]\w*\s*(?:=[^,;]*)?,\s*)+[A-Za-z_]\w*)/g;
  while ((m = multi.exec(code))) for (const part of m[2].split(',')) { const n = part.split('=')[0].trim(); if (n && !(n in env)) env[n] = m[1] as GlslType; }
  // User functions' return types, keyed `name()`
  const fns = /\b(float|vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/g;
  while ((m = fns.exec(code))) env[`${m[2]}()`] = m[1] as GlslType;
  return env;
}
