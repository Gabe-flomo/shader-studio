/**
 * antiUnify.ts — L3, the pattern merged with holes (docs/code-explorer-plan.md §4.3).
 *
 * Anti-unification gives the most specific generalisation of two trees: what
 * they share is kept, where they differ becomes a `?` hole (Plotkin/Reynolds;
 * Bulychev & Minea use it for clone detection). L1 shapes that share an L2
 * shape and differ in at most `k` places merge into one L3 pattern:
 *
 *   smoothstep(#, #, length(_a - vec2(#, #)))  ┐
 *   smoothstep(#, #, length(_a - _b))          ┴→ smoothstep(#, #, length(_a - ?))
 *
 * Holes are untyped in phase 1 (typed holes need Tier B).
 */
import { parseExpression, type Expr } from './parser';

const HOLE = '?';

function sameHead(a: Expr, b: Expr): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'num': return (a.v < 0) === ((b as typeof a).v < 0);
    case 'hole': return a.raw === (b as typeof a).raw;
    case 'id': return a.name === (b as typeof a).name;
    case 'call': return a.name === (b as typeof a).name && a.args.length === (b as typeof a).args.length;
    case 'bin': case 'un': case 'post': case 'assign': return a.op === (b as typeof a).op;
    case 'mem': return a.f === (b as typeof a).f;
    default: return true;
  }
}

const hole = (at: Expr): Expr => ({ k: 'hole', raw: HOLE, s: at.s, e: at.e });
const isHole = (e: Expr) => e.k === 'hole' && e.raw === HOLE;

/** The most specific generalisation of two shape trees. */
export function generalise(a: Expr, b: Expr): Expr {
  if (isHole(a)) return a;
  if (isHole(b)) return b;
  if (!sameHead(a, b)) return hole(a);
  switch (a.k) {
    case 'call': return { ...a, args: a.args.map((x, i) => generalise(x, (b as typeof a).args[i])) };
    case 'bin': return { ...a, l: generalise(a.l, (b as typeof a).l), r: generalise(a.r, (b as typeof a).r) };
    case 'un': case 'post': return { ...a, a: generalise(a.a, (b as typeof a).a) };
    case 'mem': return { ...a, o: generalise(a.o, (b as typeof a).o) };
    case 'idx': return { ...a, o: generalise(a.o, (b as typeof a).o), i: generalise(a.i, (b as typeof a).i) };
    case 'tern': return { ...a, c: generalise(a.c, (b as typeof a).c), a: generalise(a.a, (b as typeof a).a), b: generalise(a.b, (b as typeof a).b) };
    case 'assign': return { ...a, l: generalise(a.l, (b as typeof a).l), r: generalise(a.r, (b as typeof a).r) };
    default: return a;
  }
}

export function countHoles(e: Expr): number {
  switch (e.k) {
    case 'hole': return e.raw === HOLE ? 1 : 0;
    case 'call': return e.args.reduce((n, x) => n + countHoles(x), 0);
    case 'bin': case 'assign': return countHoles(e.l) + countHoles(e.r);
    case 'un': case 'post': return countHoles(e.a);
    case 'mem': return countHoles(e.o);
    case 'idx': return countHoles(e.o) + countHoles(e.i);
    case 'tern': return countHoles(e.c) + countHoles(e.a) + countHoles(e.b);
    default: return 0;
  }
}

/** Nodes in a tree (a hole counts one). */
export function treeSize(e: Expr): number {
  switch (e.k) {
    case 'call': return 1 + e.args.reduce((n, x) => n + treeSize(x), 0);
    case 'bin': case 'assign': return 1 + treeSize(e.l) + treeSize(e.r);
    case 'un': case 'post': return 1 + treeSize(e.a);
    case 'mem': return 1 + treeSize(e.o);
    case 'idx': return 1 + treeSize(e.o) + treeSize(e.i);
    case 'tern': return 1 + treeSize(e.c) + treeSize(e.a) + treeSize(e.b);
    default: return 1;
  }
}

const PREC: Record<string, number> = { '||': 3, '^^': 4, '&&': 5, '|': 6, '^': 7, '&': 8, '==': 9, '!=': 9, '<': 10, '>': 10, '<=': 10, '>=': 10, '<<': 11, '>>': 11, '+': 12, '-': 12, '*': 13, '/': 13, '%': 13 };
const precOf = (e: Expr) => (e.k === 'bin' ? PREC[e.op] ?? 12 : e.k === 'tern' ? 2 : e.k === 'assign' ? 1 : e.k === 'un' || (e.k === 'num' && e.v < 0) ? 14 : 16);

/** Print a shape tree as written (names as they are: they are already L1 names). */
export function printShape(e: Expr): string {
  const w = (x: Expr, min: number, right = false) => { const p = precOf(x); const s = printShape(x); return p < min || (right && p === min) ? `(${s})` : s; };
  switch (e.k) {
    case 'num': return e.v < 0 ? '-#' : '#';
    case 'hole': return e.raw;
    case 'id': return e.name;
    case 'call': return `${e.name}(${e.args.map(printShape).join(', ')})`;
    case 'bin': { const p = precOf(e); return `${w(e.l, p)} ${e.op} ${w(e.r, p, true)}`; }
    case 'un': return `${e.op}${w(e.a, 14)}`;
    case 'post': return `${w(e.a, 15)}${e.op}`;
    case 'mem': return `${w(e.o, 16)}.${e.f}`;
    case 'idx': return `${w(e.o, 16)}[${printShape(e.i)}]`;
    case 'tern': return `${w(e.c, 3)} ? ${printShape(e.a)} : ${w(e.b, 2)}`;
    case 'assign': return `${printShape(e.l)} ${e.op} ${printShape(e.r)}`;
    case 'err': return '?';
  }
}

/** Read an L1 shape back as a tree (`#` literals, `-#` negative literals). */
export function parseShape(l1: string): Expr {
  const e = parseExpression(l1, { shape: true });
  const fix = (x: Expr): Expr => {
    switch (x.k) {
      case 'hole': return x.raw === '#' ? { k: 'num', raw: '#', v: 1, s: x.s, e: x.e } : x;
      case 'un': { const a = fix(x.a); return x.op === '-' && a.k === 'num' ? { ...a, v: -1, raw: '-#' } : { ...x, a }; }
      case 'call': return { ...x, args: x.args.map(fix) };
      case 'bin': return { ...x, l: fix(x.l), r: fix(x.r) };
      case 'post': return { ...x, a: fix(x.a) };
      case 'mem': return { ...x, o: fix(x.o) };
      case 'idx': return { ...x, o: fix(x.o), i: fix(x.i) };
      case 'tern': return { ...x, c: fix(x.c), a: fix(x.a), b: fix(x.b) };
      case 'assign': return { ...x, l: fix(x.l), r: fix(x.r) };
      default: return x;
    }
  };
  return fix(e);
}

export interface MergedPattern {
  /** The L3 pattern: the variants' shared shape with `?` where they differ. */
  l3: string;
  holes: number;
  count: number;
  /** The L1 variants it merges, most used first. */
  variants: string[];
}

/**
 * Merge L1 variants (with their counts) into L3 patterns: greedily, most used
 * first, each joining the first pattern it generalises with in at most `k` holes.
 */
export function mergeVariants(variants: ReadonlyArray<{ l1: string; count: number }>, k = 2): MergedPattern[] {
  const groups: Array<{ tree: Expr; size: number; count: number; variants: string[] }> = [];
  for (const v of [...variants].sort((a, b) => b.count - a.count || a.l1.localeCompare(b.l1))) {
    const tree = parseShape(v.l1);
    let joined = false;
    for (const g of groups) {
      const merged = generalise(g.tree, tree);
      const h = countHoles(merged);
      // Few holes, and most of each variant kept (a hole swallowing a whole call is too loose).
      if (h <= k && !isHole(merged) && treeSize(merged) >= 0.7 * Math.min(treeSize(tree), g.size)) { g.tree = merged; g.count += v.count; g.variants.push(v.l1); joined = true; break; }
    }
    if (!joined) groups.push({ tree, size: treeSize(tree), count: v.count, variants: [v.l1] });
  }
  return groups
    .map(g => ({ l3: printShape(g.tree), holes: countHoles(g.tree), count: g.count, variants: g.variants }))
    .sort((a, b) => b.count - a.count);
}
