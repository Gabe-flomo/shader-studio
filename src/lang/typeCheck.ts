/**
 * typeCheck.ts — refusing type-invalid combinations up front, with a fix where there is one
 * (docs/suggestions.md, "Type checks"). Shared by the Do… bar, the builders, Make a node and the
 * recipe parser.
 *
 * Whether a wire is allowed is the node graph's own rule: lib/typesCompatible.ts (float → vecN
 * broadcasts, vec2 → vec3 pads, vec3 → vec4 adds alpha, vec3 → vec2 truncates). This only adds the
 * words: why it's refused, and the usual ways round it ("use its brightness (Luminance)", "take
 * .x", "its length").
 *
 * inferType reads a one-line GLSL expression (the Grid Rules custom update, an Expression Block
 * line) well enough to say what type it makes: numbers and named inputs, vecN(…) constructors,
 * swizzles, the arithmetic operators (a float broadcasts), and the built-ins.
 */
import { typesCompatible } from '../lib/typesCompatible';

export type GlslType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'texture' | string;

export interface TypeFix {
  id: 'luminance' | 'take-x' | 'length' | 'take-xy' | 'take-rgb' | 'alpha' | 'sample';
  /** Plain words: "use its brightness (Luminance)". */
  label: string;
  /** The value rewritten so it fits (`luminance(v)`, `(v).x`…), for an expression. */
  rewrite?: (expr: string) => string;
}

export type WireCheck = { ok: true } | { ok: false; message: string; fixes: TypeFix[] };

const WORDS: Record<string, string> = {
  float: 'a number (float)', vec2: 'two numbers (vec2)', vec3: 'three numbers (vec3)', vec4: 'four numbers (vec4)', texture: 'a texture',
  scene3d: 'a 3D scene', agents: 'agents', deposit: 'a deposit',
};
export const typeWords = (t: string) => WORDS[t] ?? t;

/** The ways round feeding `from` into `to`, best first. */
export function fixesFor(from: GlslType, to: GlslType, opts: { colour?: boolean } = {}): TypeFix[] {
  const fixes: TypeFix[] = [];
  if (to === 'float') {
    if (from === 'vec3' || from === 'vec4') {
      if (opts.colour !== false) fixes.push({ id: 'luminance', label: 'use its brightness (Luminance)', rewrite: e => `dot((${e}).rgb, vec3(0.2126, 0.7152, 0.0722))` });
      fixes.push({ id: 'take-x', label: 'take .x (its first number)', rewrite: e => `(${e}).x` });
      if (from === 'vec4') fixes.push({ id: 'alpha', label: 'take .a (its alpha)', rewrite: e => `(${e}).a` });
      if (opts.colour === false) fixes.push({ id: 'length', label: 'its length', rewrite: e => `length(${e})` });
    } else if (from === 'vec2') {
      fixes.push({ id: 'take-x', label: 'take .x', rewrite: e => `(${e}).x` });
      fixes.push({ id: 'length', label: 'its length (distance from the centre)', rewrite: e => `length(${e})` });
    } else if (from === 'texture') fixes.push({ id: 'sample', label: 'sample it first (Sample (texture)), then use its brightness' });
  } else if (to === 'vec2' && from === 'vec4') fixes.push({ id: 'take-xy', label: 'take .xy', rewrite: e => `(${e}).xy` });
  else if (to === 'vec3' && from === 'vec4') fixes.push({ id: 'take-rgb', label: 'take .rgb', rewrite: e => `(${e}).rgb` });
  else if ((to === 'vec3' || to === 'vec4' || to === 'float') && from === 'texture') fixes.push({ id: 'sample', label: 'sample it (Sample (texture))' });
  return fixes;
}

/** Can a `from` value feed a `to` socket? The graph's own rule, with words and fixes when it can't. */
export function checkWire(from: GlslType, to: GlslType, names: { from?: string; to?: string; colour?: boolean } = {}): WireCheck {
  if (typesCompatible(from, to)) return { ok: true };
  const fixes = fixesFor(from, to, { colour: names.colour });
  const a = names.from ? `${names.from} is ${typeWords(from)}` : `This is ${typeWords(from)}`;
  const b = names.to ? `${names.to} takes ${typeWords(to)}` : `it needs ${typeWords(to)}`;
  return { ok: false, message: `Can't wire that: ${a}, ${b}.${fixes.length ? ` Fix: ${fixes.map(f => f.label).join(', or ')}.` : ''}`, fixes };
}

// ── Inferring an expression's type ──────────────────────────────────────────────

const VEC = /^(vec[234])$/;
const SAME_AS_ARG = new Set('sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep normalize radians degrees reflect'.split(' '));
const TO_FLOAT = new Set(['length', 'distance', 'dot', 'float']);
const width = (t: string) => (t === 'float' ? 1 : t === 'vec2' ? 2 : t === 'vec3' ? 3 : t === 'vec4' ? 4 : 0);
const ofWidth = (n: number): GlslType => (n === 1 ? 'float' : `vec${n}`);

export type Inferred = { type: GlslType } | { error: string };

/** The type a one-line expression makes, given its names' types (unknown names are floats). */
export function inferType(expr: string, names: Record<string, GlslType> = {}): Inferred {
  const toks = expr.match(/\d*\.\d+(?:e[-+]?\d+)?|\d+\.?\d*(?:e[-+]?\d+)?|[A-Za-z_]\w*|[()+\-*/,.?:<>=!&|]/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const fail = (m: string): never => { throw new Error(m); };
  const combine = (a: GlslType, b: GlslType, op: string): GlslType => {
    if (a === b || b === 'float') return a;
    if (a === 'float') return b;
    return fail(`${op} mixes ${typeWords(a)} with ${typeWords(b)}`);
  };
  const primary = (): GlslType => {
    const t = toks[i++];
    if (t === undefined) return fail('the expression ends too soon');
    if (t === '(') { const v = ternary(); if (toks[i++] !== ')') fail('a ( is never closed'); return post(v); }
    if (t === '-' || t === '+' || t === '!') return primary();
    if (/^[\d.]/.test(t)) return post('float');
    if (peek() === '(') {
      i++;
      const args: GlslType[] = [];
      if (peek() !== ')') { args.push(ternary()); while (peek() === ',') { i++; args.push(ternary()); } }
      if (toks[i++] !== ')') fail(`${t}( is never closed`);
      if (VEC.test(t)) {
        const total = args.reduce((s, a) => s + width(a), 0);
        if (args.length > 1 && total !== width(t) && !(total > width(t) && width(args[args.length - 1]) > 1)) fail(`${t}(…) gets ${total} numbers`);
        return post(t);
      }
      if (TO_FLOAT.has(t)) return post('float');
      if (t === 'cross') return post('vec3');
      if (SAME_AS_ARG.has(t)) return post(args.reduce((a, b) => (width(b) > width(a) ? b : a), 'float' as GlslType));
      return post('float');
    }
    return post(names[t] ?? 'float');
  };
  const post = (t: GlslType): GlslType => {
    while (peek() === '.') {
      i++;
      const sw = toks[i++] ?? '';
      if (!/^[xyzwrgba]{1,4}$/.test(sw)) fail(`.${sw} isn't a swizzle`);
      if (t === 'float') fail(`.${sw} on a number: it has no parts`);
      t = ofWidth(sw.length);
    }
    return t;
  };
  const term = (): GlslType => { let a = primary(); while (peek() === '*' || peek() === '/') { const op = toks[i++]; a = combine(a, primary(), op); } return a; };
  const sum = (): GlslType => { let a = term(); while (peek() === '+' || peek() === '-') { const op = toks[i++]; a = combine(a, term(), op); } return a; };
  const compare = (): GlslType => {
    let a = sum();
    while (peek() && /^[<>=!&|]$/.test(peek()!)) { while (/^[<>=!&|]$/.test(peek() ?? '')) i++; sum(); a = 'float'; }
    return a;
  };
  const ternary = (): GlslType => {
    const c = compare();
    if (peek() !== '?') return c;
    i++;
    const a = ternary();
    if (toks[i++] !== ':') fail('a ? without its :');
    const b = ternary();
    return combine(a, b, '?:');
  };
  try {
    const t = ternary();
    if (i < toks.length) fail(`unexpected “${toks[i]}”`);
    return { type: t };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Refuse an expression that doesn't make `want`, with the fix (null: it is fine, or unreadable). */
export function checkExprType(expr: string, want: GlslType, names: Record<string, GlslType> = {}, what = 'The update'): { message: string; fixes: TypeFix[] } | null {
  const r = inferType(expr, names);
  if ('error' in r) return null;
  if (r.type === want || typesCompatible(r.type, want)) return null;
  const fixes = fixesFor(r.type, want, { colour: false });
  const fix = fixes.find(f => f.rewrite);
  return {
    message: `${what} is ${typeWords(want)}, but this makes ${typeWords(r.type)}.${fixes.length ? ` Fix: ${fixes.map(f => f.label).join(', or ')}${fix?.rewrite ? `: ${fix.rewrite(expr.trim())}` : ''}.` : ''}`,
    fixes,
  };
}
