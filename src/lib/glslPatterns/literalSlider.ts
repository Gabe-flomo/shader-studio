/**
 * "Make a slider": a number in code becomes a named float input, starting at that number.
 *
 * Shared by every editor where code can hold a slider (the Expression Block's lines and Return,
 * the Custom Function's body). Pure text in, text out; the host adds the input to its node.
 *
 *  - literalAt: the numeric literal under the caret, or the one the selection covers (a leading
 *    unary minus belongs to it: `-2.0` is one number, `x - 2.0` is not).
 *  - nameForLiteral: named from where it sits, as "Make a node from this" names its literals
 *    (generalise.ts: the edge of a smoothstep is `edge0`, a factor on space is `zoom`…), made
 *    unique against the names already in use.
 *  - literalToSlider: the replaced text, the name, the value and a range around it
 *    (rangeForValue: 0–1 for small values, else 0 to about twice; typing past the max on the
 *    slider extends it, as every slider does).
 *
 * An integer literal (`3`) sits where GLSL wants an int (a loop bound, an index), so it reads
 * `int(name)` there and the slider steps through whole numbers' worth of range.
 */
import type { Expr, GlslType } from './ast';
import { allNodes, childrenOf } from './ast';
import { parseExpr, parseLine, splitStatements } from './parse';
import { inferTypes, type TypeEnv } from './types';
import { inferRoles, type RoleEnv } from './roles';
import { literalName, uniqueName } from './generalise';
import { rangeForValue } from '../rangeMath';

export interface LiteralSpan {
  /** Where the literal starts and ends in the text (a leading `-` included). */
  start: number;
  end: number;
  value: number;
  /** As written. */
  text: string;
  /** Written without a `.` or an exponent: an int in GLSL. */
  int: boolean;
}

// A GLSL number: 1, 1.0, 1., .5, 1e3, 2.5e-2 (an f/u suffix is allowed and dropped).
const NUM = /(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFuU]?/g;

/** Is the `-` at `i` a unary minus (it starts an operand), not a subtraction? */
function unaryMinusAt(text: string, i: number): boolean {
  if (text[i] !== '-') return false;
  let k = i - 1;
  while (k >= 0 && /\s/.test(text[k])) k--;
  if (k < 0) return true;
  if (/[(,=+\-*/?:<>!&|^%[{;]/.test(text[k])) return true;
  return /\breturn$/.test(text.slice(0, k + 1));
}

/**
 * The numeric literal at the caret (`start === end`, touching the number counts) or covered by
 * the selection (the selection is the number, give or take spaces and a leading minus).
 * Null when there is none, or it's part of a name (`vec3`, `x1`) or a swizzle.
 */
export function literalAt(text: string, start: number, end = start): LiteralSpan | null {
  const lo = Math.min(start, end), hi = Math.max(start, end);
  NUM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUM.exec(text))) {
    const s = m.index, e = s + m[0].length;
    const before = text[s - 1] ?? '';
    const after = text[e] ?? '';
    // Part of an identifier (vec3, x1, u_2) or a member access (.x after a number is invalid anyway)
    if (/[A-Za-z_\d]/.test(before) || /[A-Za-z_\d.]/.test(after) || (before === '.' && /\w/.test(text[s - 2] ?? ''))) continue;
    let ls = s;
    if (before === '-' && unaryMinusAt(text, s - 1)) ls = s - 1;
    const hit = lo === hi
      ? lo >= ls && lo <= e
      : (() => {
        // The selection, trimmed of spaces, is this literal (with or without its minus)
        let a = lo, b = hi;
        while (a < b && /\s/.test(text[a])) a++;
        while (b > a && /\s/.test(text[b - 1])) b--;
        return (a === ls || a === s) && b === e;
      })();
    if (!hit) { if (s > hi) break; continue; }
    const raw = m[0].replace(/[fFuU]$/, '');
    const value = parseFloat(raw) * (ls < s ? -1 : 1);
    if (!Number.isFinite(value)) return null;
    return { start: ls, end: e, value, text: text.slice(ls, e), int: !/[.eE]/.test(raw) };
  }
  return null;
}

/** The literal's node (or its unary minus) in a parsed tree, with its parent. */
function findLiteral(root: Expr, lit: LiteralSpan): { node: Expr; parent: Expr | null } | null {
  const parents = new Map<number, Expr | null>();
  const visit = (n: Expr, p: Expr | null) => { parents.set(n.id, p); childrenOf(n).forEach(c => visit(c, n)); };
  visit(root, null);
  for (const n of allNodes(root)) {
    if (n.start !== lit.start || n.end !== lit.end) continue;
    if (n.kind === 'num' || (n.kind === 'unary' && n.op === '-' && n.arg.kind === 'num')) return { node: n, parent: parents.get(n.id) ?? null };
  }
  return null;
}

/** The expression the literal sits in: the whole text when it is one expression, else its statement. */
function exprAround(text: string, at: number): Expr | null {
  const whole = parseExpr(text);
  if (whole.ok) return whole.expr;
  for (const st of splitStatements(text)) {
    if (at < st.start || at > st.end) continue;
    const pl = parseLine(st.text, st.start);
    if (pl.ok) return pl.line.expr;
  }
  return null;
}

export interface LiteralNameContext {
  /** Types of the names in the code (the block's inputs and typed lines). */
  types?: TypeEnv;
  roles?: RoleEnv;
}

/** A name for the literal from where it sits, unique against `taken` (and GLSL's own words). */
export function nameForLiteral(text: string, lit: LiteralSpan, taken: Iterable<string>, ctx: LiteralNameContext = {}): string {
  let want = lit.int ? 'count' : 'value';
  const root = exprAround(text, lit.start);
  const found = root && findLiteral(root, lit);
  if (root && found) {
    const types: Map<number, GlslType> = inferTypes(root, ctx.types ?? {});
    const roles = inferRoles(root, types, ctx.roles ?? {});
    const named = literalName(found.node, found.parent, roles, types);
    if (named !== 'value' || !lit.int) want = named;
  }
  return uniqueName(want, new Set(taken));
}

export interface MadeSlider {
  /** The text with the literal replaced by the input (or `int(input)`). */
  text: string;
  name: string;
  value: number;
  slider: { min: number; max: number };
  /** Where the replacement sits in the new text (for the caret). */
  start: number;
  end: number;
}

/** Replace the literal with a new input named for it. `taken` are the names already in use. */
export function literalToSlider(text: string, lit: LiteralSpan, taken: Iterable<string>, ctx: LiteralNameContext = {}): MadeSlider {
  const name = nameForLiteral(text, lit, taken, ctx);
  const use = lit.int ? `int(${name})` : name;
  const r = rangeForValue(lit.value);
  return {
    text: text.slice(0, lit.start) + use + text.slice(lit.end),
    name, value: lit.value,
    slider: { min: Math.min(r.min, lit.value), max: Math.max(r.max, lit.value) },
    start: lit.start, end: lit.start + use.length,
  };
}

/** Every name a piece of code declares or reads (so a new input never shadows one). */
export function namesIn(...texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/[A-Za-z_]\w*/g)) out.add(m[0]);
  return out;
}
