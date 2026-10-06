/**
 * Structural matching of a pattern (an expression with `$holes` and `#literal` holes) against
 * an expression.
 *
 * Both sides are first normalised, so that spelling doesn't matter:
 *  - constants fold: `6.28318`, `TAU`, `2.0 * PI` and `2.0*3.14159` are the same number, and
 *    numbers compare with a small tolerance (`1.0/2.2` matches `0.4545`);
 *  - `+` and `*` chains flatten and match in any order (`0.5 + sin(x)*0.5` is `sin(x)*0.5 + 0.5`);
 *  - a minus sign anywhere in a product is pulled out (`-k*d`, `-(k*d)`, `k*-d` are one shape);
 *  - `vec3(0.5)` matches `vec3(0.5, 0.5, 0.5)`; `.rgb` is `.xyz`; `texture2D` is `texture`,
 *    `iTime` is `u_time`, `iResolution` is `u_resolution`.
 * A hole used twice must bind equal sub-expressions (`smoothstep($r, $r + $w, …)`). A bare hole
 * in a `+`/`*` chain can take several operands (`$a + $b` matches `x + y + z`).
 */
import type { BinaryExpr, Expr, NumExpr } from './ast';
import { formatNumber } from './ast';
import { parseExpr } from './parse';

export const NAMED_CONSTANTS: Record<string, number> = {
  PI: Math.PI, M_PI: Math.PI, TAU: Math.PI * 2, TWO_PI: Math.PI * 2, TWOPI: Math.PI * 2, PI2: Math.PI * 2, HALF_PI: Math.PI / 2, E: Math.E,
};
const IDENT_ALIAS: Record<string, string> = { iTime: 'u_time', iResolution: 'u_resolution', iMouse: 'u_mouse', fragCoord: 'gl_FragCoord' };
const CALL_ALIAS: Record<string, string> = { texture2D: 'texture' };
const SWZ_ALIAS: Record<string, string> = { r: 'x', g: 'y', b: 'z', a: 'w', s: 'x', t: 'y', p: 'z', q: 'w' };

export type N =
  | { k: 'num'; v: number; src: Expr }
  | { k: 'hole'; name: string; lit: boolean; src: Expr }
  | { k: 'id'; name: string; src: Expr }
  | { k: 'call'; callee: string; args: N[]; src: Expr }
  | { k: 'nary'; op: '+' | '*'; items: N[]; neg: boolean; src: Expr }
  | { k: 'bin'; op: string; l: N; r: N; src: Expr }
  | { k: 'un'; op: string; a: N; src: Expr }
  | { k: 'mem'; o: N; f: string; src: Expr }
  | { k: 'idx'; o: N; i: N; src: Expr }
  | { k: 'tern'; t: N; a: N; b: N; src: Expr };

/** The value of a subtree made only of numbers, named constants and arithmetic; else undefined. */
export function constValue(e: Expr): number | undefined {
  switch (e.kind) {
    case 'num': return e.value;
    case 'ident': return NAMED_CONSTANTS[e.name];
    case 'unary': { const a = constValue(e.arg); return a === undefined ? undefined : e.op === '-' ? -a : e.op === '+' ? a : undefined; }
    case 'binary': {
      if (!['+', '-', '*', '/'].includes(e.op)) return undefined;
      const a = constValue(e.left), b = constValue(e.right);
      if (a === undefined || b === undefined) return undefined;
      return e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : b === 0 ? undefined : a / b;
    }
    case 'call': {
      if ((e.callee === 'float' || e.callee === 'int') && e.args.length === 1) return constValue(e.args[0]);
      return undefined;
    }
    default: return undefined;
  }
}

/** Normalise a tree for matching (see the module comment). */
export function normalize(e: Expr): N {
  const c = constValue(e);
  // A plain identifier like PI stays an identifier only when it isn't a known constant
  if (c !== undefined) return { k: 'num', v: c, src: e };
  switch (e.kind) {
    case 'num': return { k: 'num', v: e.value, src: e };
    case 'ident':
      if (e.name.startsWith('$')) return { k: 'hole', name: e.name.slice(1), lit: false, src: e };
      if (e.name.startsWith('#')) return { k: 'hole', name: e.name.slice(1), lit: true, src: e };
      return { k: 'id', name: IDENT_ALIAS[e.name] ?? e.name, src: e };
    case 'unary': {
      const a = normalize(e.arg);
      if (e.op === '+') return a;
      if (e.op === '-') {
        if (a.k === 'nary' && a.op === '*') return { ...a, neg: !a.neg, src: e };
        return { k: 'nary', op: '*', items: [a], neg: true, src: e };
      }
      return { k: 'un', op: e.op, a, src: e };
    }
    case 'binary': {
      if (e.op === '+' || e.op === '*') {
        const items: N[] = [];
        let neg = false;
        for (const side of [e.left, e.right]) {
          const n = normalize(side);
          if (n.k === 'nary' && n.op === e.op) { items.push(...n.items); if (e.op === '*' && n.neg) neg = !neg; }
          else items.push(n);
        }
        if (e.op === '*') {
          // Pull a literal's sign out: `-2.0 * d` is `-(2.0 * d)`
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.k === 'num' && it.v < 0) {
              const inner = it.src.kind === 'unary' && it.src.op === '-' ? it.src.arg : it.src;
              items[i] = { k: 'num', v: -it.v, src: inner };
              neg = !neg;
            }
          }
          // A single-item product is that item with a sign
          if (items.length === 1 && !neg) return items[0];
        }
        return { k: 'nary', op: e.op, items, neg, src: e };
      }
      return { k: 'bin', op: e.op, l: normalize(e.left), r: normalize(e.right), src: e };
    }
    case 'call': return { k: 'call', callee: CALL_ALIAS[e.callee] ?? e.callee, args: e.args.map(normalize), src: e };
    case 'member': return { k: 'mem', o: normalize(e.object), f: e.field.split('').map(ch => SWZ_ALIAS[ch] ?? ch).join(''), src: e };
    case 'index': return { k: 'idx', o: normalize(e.object), i: normalize(e.index), src: e };
    case 'ternary': return { k: 'tern', t: normalize(e.test), a: normalize(e.then), b: normalize(e.else), src: e };
  }
}

/** A canonical string of a normalised tree: equal for trees that match each other exactly. */
export function canonicalKey(n: N): string {
  switch (n.k) {
    case 'num': return formatNumber(Math.round(n.v * 1e5) / 1e5);
    case 'hole': return `${n.lit ? '#' : '$'}${n.name}`;
    case 'id': return n.name;
    case 'call': return `${n.callee}(${n.args.map(canonicalKey).join(',')})`;
    case 'nary': return `${n.neg ? '-' : ''}${n.op}[${n.items.map(canonicalKey).sort().join(',')}]`;
    case 'bin': return `(${canonicalKey(n.l)}${n.op}${canonicalKey(n.r)})`;
    case 'un': return `${n.op}${canonicalKey(n.a)}`;
    case 'mem': return `${canonicalKey(n.o)}.${n.f}`;
    case 'idx': return `${canonicalKey(n.o)}[${canonicalKey(n.i)}]`;
    case 'tern': return `(${canonicalKey(n.t)}?${canonicalKey(n.a)}:${canonicalKey(n.b)})`;
  }
}

export const closeEnough = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 2e-4);

/** What a hole matched. `expr` is a real node of the target (or a synthetic chain for an absorbed run). */
export interface Binding { expr: Expr; value?: number; key: string }
export type Bindings = Record<string, Binding>;

let synthId = -1;
function synthChain(op: '+' | '*', items: N[]): Expr {
  let e = items[0].src;
  for (let i = 1; i < items.length; i++) {
    const r = items[i].src;
    e = { kind: 'binary', op, left: e, right: r, id: synthId--, start: Math.min(e.start, r.start), end: Math.max(e.end, r.end) } as BinaryExpr;
  }
  return e;
}

function bindHole(p: Extract<N, { k: 'hole' }>, t: N, b: Bindings): boolean {
  if (p.lit && t.k !== 'num') return false;
  const key = canonicalKey(t);
  const prev = b[p.name];
  if (prev) return prev.key === key || (prev.value !== undefined && t.k === 'num' && closeEnough(t.v, prev.value));
  b[p.name] = { expr: t.src, key, ...(t.k === 'num' ? { value: t.v } : {}) };
  return true;
}

/** `vec3(c)` against `vec3(a, b, c)`: the single argument splats. */
function splat(p: Extract<N, { k: 'call' }>, t: Extract<N, { k: 'call' }>): [N[], N[]] | null {
  if (!/^vec[234]$/.test(p.callee) || p.args.length === t.args.length) return null;
  const n = Number(p.callee[3]);
  if (p.args.length === 1 && t.args.length === n) return [Array(n).fill(p.args[0]), t.args];
  if (t.args.length === 1 && p.args.length === n && t.args[0].k === 'num') return [p.args, Array(n).fill(t.args[0])];
  return null;
}

function m(p: N, t: N, b: Bindings): boolean {
  if (p.k === 'hole') return bindHole(p, t, b);
  switch (p.k) {
    case 'num': return t.k === 'num' && closeEnough(t.v, p.v);
    case 'id': return t.k === 'id' && t.name === p.name;
    case 'call': {
      if (t.k !== 'call' || t.callee !== p.callee) return false;
      const sp = splat(p, t);
      const [pa, ta] = sp ?? [p.args, t.args];
      if (pa.length !== ta.length) return false;
      return seq(pa, ta, b);
    }
    case 'bin':
      if (t.k === 'num' && p.op === '-') return foldedSum(p.l, p.r, t, b, -1);
      return t.k === 'bin' && t.op === p.op && seq([p.l, p.r], [t.l, t.r], b);
    case 'un': return t.k === 'un' && t.op === p.op && m(p.a, t.a, b);
    case 'mem': return t.k === 'mem' && t.f === p.f && m(p.o, t.o, b);
    case 'idx': return t.k === 'idx' && seq([p.o, p.i], [t.o, t.i], b);
    case 'tern': return t.k === 'tern' && seq([p.t, p.a, p.b], [t.t, t.a, t.b], b);
    case 'nary': {
      if (p.op === '*' && p.neg && p.items.length === 1 && t.k === 'num') {
        // `-#k` against a negative number
        return t.v < 0 ? m(p.items[0], { k: 'num', v: -t.v, src: t.src }, b) : false;
      }
      if (t.k === 'num' && p.op === '+' && !p.neg && p.items.length === 2) return foldedSum(p.items[0], p.items[1], t, b, 1);
      if (t.k !== 'nary' || t.op !== p.op || t.neg !== p.neg) return false;
      return nary(p.items, t.items, b, p.op);
    }
  }
}

/**
 * `$r + $w` (sign 1) or `$r - $w` (sign −1) against a plain number, once `$r` is bound to a
 * number: `smoothstep(0.3, 0.35, …)` is `smoothstep(r, r + w, …)` with w = 0.05. The other
 * hole binds a made-up number (its span is the literal's).
 */
function foldedSum(l: N, r: N, t: Extract<N, { k: 'num' }>, b: Bindings, sign: 1 | -1): boolean {
  const known = (x: N) => (x.k === 'hole' ? b[x.name]?.value : x.k === 'num' ? x.v : undefined);
  const free = (x: N) => x.k === 'hole' && !b[x.name];
  const lv = known(l), rv = known(r);
  if (lv !== undefined && free(r)) {
    const v = parseFloat((sign * (t.v - lv)).toPrecision(10));
    return bindHole(r as Extract<N, { k: 'hole' }>, { k: 'num', v, src: numNode(v, t.src) }, b);
  }
  if (rv !== undefined && free(l) && sign === 1) {
    const v = parseFloat((t.v - rv).toPrecision(10));
    return bindHole(l as Extract<N, { k: 'hole' }>, { k: 'num', v, src: numNode(v, t.src) }, b);
  }
  if (lv !== undefined && rv !== undefined) return closeEnough(t.v, lv + sign * rv);
  return false;
}

/** Match in order, all or nothing (bindings roll back on failure). */
function seq(ps: N[], ts: N[], b: Bindings): boolean {
  const snap = { ...b };
  // Bare holes first, so `smoothstep($r + $w, $r, …)` knows r before it reads `$r + $w`
  const order = ps.map((_, i) => i).sort((x, y) => Number(ps[y].k === 'hole') - Number(ps[x].k === 'hole'));
  for (const i of order) if (!m(ps[i], ts[i], b)) { restore(b, snap); return false; }
  return true;
}

function restore(b: Bindings, snap: Bindings) {
  for (const k of Object.keys(b)) if (!(k in snap)) delete b[k];
  Object.assign(b, snap);
}

/** Match a `+`/`*` chain in any order; one bare `$hole` may take the leftover operands. */
function nary(ps: N[], ts: N[], b: Bindings, op: '+' | '*'): boolean {
  if (ts.length > 8 || ps.length > ts.length) return false;
  const absorbAt = ps.length < ts.length ? ps.findIndex(x => x.k === 'hole' && !x.lit) : -1;
  if (ps.length < ts.length && absorbAt < 0) return false;
  const order = absorbAt >= 0 ? [...ps.slice(0, absorbAt), ...ps.slice(absorbAt + 1)] : ps;
  const used = new Array(ts.length).fill(false);
  const go = (i: number): boolean => {
    if (i === order.length) {
      const rest = ts.filter((_, j) => !used[j]);
      if (absorbAt < 0) return rest.length === 0;
      const hole = ps[absorbAt] as Extract<N, { k: 'hole' }>;
      if (rest.length === 1) return bindHole(hole, rest[0], b);
      const chain: N = { k: 'nary', op, items: rest, neg: false, src: synthChain(op, rest) };
      return bindHole(hole, chain, b);
    }
    for (let j = 0; j < ts.length; j++) {
      if (used[j]) continue;
      const snap = { ...b };
      used[j] = true;
      if (m(order[i], ts[j], b) && go(i + 1)) return true;
      used[j] = false;
      restore(b, snap);
    }
    return false;
  };
  return go(0);
}

/** Match a normalised pattern against a normalised target. */
export function matchNormalized(pattern: N, target: N): Bindings | null {
  const b: Bindings = {};
  return m(pattern, target, b) ? b : null;
}

const patternCache = new Map<string, N>();

/** A pattern's normalised tree, parsed once. Throws on a pattern that doesn't parse (a library bug). */
export function compilePattern(src: string): N {
  const hit = patternCache.get(src);
  if (hit) return hit;
  const r = parseExpr(src);
  if (!r.ok) throw new Error(`Pattern “${src}” doesn't parse: ${r.error}`);
  const n = normalize(r.expr);
  patternCache.set(src, n);
  return n;
}

/** Match a pattern string against an expression. */
export function matchPattern(pattern: string, target: Expr): Bindings | null {
  return matchNormalized(compilePattern(pattern), normalize(target));
}

/** A number literal node, for building synthetic trees. */
export function numNode(v: number, at: Expr): NumExpr {
  return { kind: 'num', value: v, raw: formatNumber(v), int: false, id: synthId--, start: at.start, end: at.end };
}
