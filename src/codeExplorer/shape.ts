/**
 * shape.ts — the normalisation ladder (docs/code-explorer-plan.md §4.3).
 *
 *   L1 exact shape     literals → #; local names → _a, _b… in order of first
 *                      use (a repeated name keeps its letter); calls, swizzles,
 *                      types and the Studio's built-in names kept.
 *   L2 argument shape  as L1, but every name → _ and the inside of nested
 *                      calls → …
 *
 * `1.`, `1.0` and `1.000` are the same literal; a sign is kept (`-#`), and
 * constant arithmetic (`6.2831853 / 4.0`) folds to one literal. Operands are
 * not reordered (`a * b` ≠ `b * a`), as the plan says for v1.
 *
 * L3 (merged with holes) is in antiUnify.ts.
 */
import { STUDIO_UNIFORMS, } from '../glsl/discover';
import { SHADERTOY_RENAMES } from '../glsl/dialects';
import type { Expr } from './parser';

/**
 * Names kept as themselves in L1: the Studio's uniforms and varyings, and
 * Shadertoy's, read as their Studio names (dialects.ts's renames), so an
 * imported shader shapes like a native one.
 */
const BUILTIN_NAMES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const n of STUDIO_UNIFORMS) m.set(n, n);
  m.set('vUv', 'vUv');
  m.set('true', 'true');
  m.set('false', 'false');
  for (const [re, to] of SHADERTOY_RENAMES) {
    const from = /^\\b(\w+)\\b$/.exec(re.source)?.[1];
    if (from && /^\w+$/.test(to)) m.set(from, to);
  }
  m.set('iResolution', 'u_resolution');
  m.set('iMouse', 'u_mouse');
  m.set('fragCoord', 'gl_FragCoord');
  m.set('fragColor', 'gl_FragColor');
  return m;
})();

export const builtinName = (name: string): string | undefined => BUILTIN_NAMES.get(name);

const PREC: Record<string, number> = {
  '||': 3, '^^': 4, '&&': 5, '|': 6, '^': 7, '&': 8, '==': 9, '!=': 9,
  '<': 10, '>': 10, '<=': 10, '>=': 10, '<<': 11, '>>': 11, '+': 12, '-': 12, '*': 13, '/': 13, '%': 13,
};
const precOf = (e: Expr): number => {
  switch (e.k) {
    case 'assign': return 1;
    case 'tern': return 2;
    case 'bin': return PREC[e.op] ?? 12;
    case 'un': return 14;
    case 'num': return e.v < 0 ? 14 : 16;
    default: return 16;
  }
};

/** Fold constant arithmetic and signs into literals. Returns the same node when nothing folds. */
export function fold(e: Expr): Expr {
  switch (e.k) {
    case 'un': {
      const a = fold(e.a);
      if (a.k === 'num' && (e.op === '-' || e.op === '+')) return { k: 'num', raw: e.op === '-' ? `-${a.raw}` : a.raw, v: e.op === '-' ? -a.v : a.v, s: e.s, e: e.e };
      return a === e.a ? e : { ...e, a };
    }
    case 'bin': {
      const l = fold(e.l), r = fold(e.r);
      if (l.k === 'num' && r.k === 'num' && '+-*/'.includes(e.op) && e.op.length === 1) {
        const v = e.op === '+' ? l.v + r.v : e.op === '-' ? l.v - r.v : e.op === '*' ? l.v * r.v : r.v === 0 ? 0 : l.v / r.v;
        return { k: 'num', raw: String(v), v, s: e.s, e: e.e };
      }
      return l === e.l && r === e.r ? e : { ...e, l, r };
    }
    case 'call': {
      const args = e.args.map(fold);
      return args.every((a, i) => a === e.args[i]) ? e : { ...e, args };
    }
    case 'mem': { const o = fold(e.o); return o === e.o ? e : { ...e, o }; }
    case 'idx': { const o = fold(e.o), i = fold(e.i); return o === e.o && i === e.i ? e : { ...e, o, i }; }
    case 'tern': { const c = fold(e.c), a = fold(e.a), b = fold(e.b); return c === e.c && a === e.a && b === e.b ? e : { ...e, c, a, b }; }
    case 'post': { const a = fold(e.a); return a === e.a ? e : { ...e, a }; }
    case 'assign': { const l = fold(e.l), r = fold(e.r); return l === e.l && r === e.r ? e : { ...e, l, r }; }
    default: return e;
  }
}

/** `_a`, `_b`, … `_z`, `_aa`, `_ab`… */
export function localName(n: number): string {
  let s = '';
  let x = n;
  do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return `_${s}`;
}

interface PrintOpts {
  /** 'l1': rename locals in order; 'l2': every name → _ and nested calls → name(…). */
  level: 'l1' | 'l2';
}

function printer(opts: PrintOpts) {
  const names = new Map<string, string>();
  const nameOf = (n: string): string => {
    if (opts.level === 'l2') return '_';
    const b = BUILTIN_NAMES.get(n);
    if (b) return b;
    let v = names.get(n);
    if (!v) { v = localName(names.size); names.set(n, v); }
    return v;
  };
  const wrap = (e: Expr, s: string, min: number, right = false) => {
    const p = precOf(e);
    return p < min || (right && p === min) ? `(${s})` : s;
  };
  const go = (e: Expr, depth: number): string => {
    switch (e.k) {
      case 'num': return e.v < 0 || e.raw.startsWith('-') ? '-#' : '#';
      case 'hole': return e.raw;
      case 'id': return nameOf(e.name);
      case 'call':
        if (opts.level === 'l2' && depth > 0) return `${e.name}(…)`;
        return `${e.name}(${e.args.map(a => go(a, depth + 1)).join(', ')})`;
      case 'bin': {
        const p = precOf(e);
        return `${wrap(e.l, go(e.l, depth + 1), p)} ${e.op} ${wrap(e.r, go(e.r, depth + 1), p, true)}`;
      }
      case 'un': return `${e.op}${wrap(e.a, go(e.a, depth + 1), 14)}`;
      case 'post': return `${wrap(e.a, go(e.a, depth + 1), 15)}${e.op}`;
      case 'mem': return `${wrap(e.o, go(e.o, depth + 1), 16)}.${e.f}`;
      case 'idx': return `${wrap(e.o, go(e.o, depth + 1), 16)}[${go(e.i, depth + 1)}]`;
      case 'tern': return `${wrap(e.c, go(e.c, depth + 1), 3)} ? ${go(e.a, depth + 1)} : ${wrap(e.b, go(e.b, depth + 1), 2)}`;
      case 'assign': return `${go(e.l, depth + 1)} ${e.op} ${go(e.r, depth + 1)}`;
      case 'err': return '?';
    }
  };
  return (e: Expr) => go(e, 0);
}

/** L1 and L2 of an expression (normally a call site). */
export function shapes(e: Expr): { l1: string; l2: string } {
  const f = fold(e);
  return { l1: printer({ level: 'l1' })(f), l2: printer({ level: 'l2' })(f) };
}

export const shapeL1 = (e: Expr): string => printer({ level: 'l1' })(fold(e));
export const shapeL2 = (e: Expr): string => printer({ level: 'l2' })(fold(e));
