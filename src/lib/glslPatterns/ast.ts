/**
 * The expression AST the explainer, the pattern matcher and the generaliser share.
 *
 * Small on purpose: one GLSL *expression* (or the right-hand side of one line), not a
 * translation unit. Every node knows its span in the text it was parsed from (`start`
 * inclusive, `end` exclusive, parentheses included) so a UI can highlight it, and carries
 * an `id` unique within one parse.
 */

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '<' | '>' | '<=' | '>=' | '==' | '!=' | '&&' | '||' | '^^';
export type UnaryOp = '-' | '+' | '!';

interface Base { id: number; start: number; end: number }

export interface NumExpr extends Base { kind: 'num'; value: number; raw: string; int: boolean }
export interface IdentExpr extends Base { kind: 'ident'; name: string }
export interface CallExpr extends Base { kind: 'call'; callee: string; args: Expr[] }
export interface BinaryExpr extends Base { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
export interface UnaryExpr extends Base { kind: 'unary'; op: UnaryOp; arg: Expr }
export interface MemberExpr extends Base { kind: 'member'; object: Expr; field: string }
export interface IndexExpr extends Base { kind: 'index'; object: Expr; index: Expr }
export interface TernaryExpr extends Base { kind: 'ternary'; test: Expr; then: Expr; else: Expr }

export type Expr = NumExpr | IdentExpr | CallExpr | BinaryExpr | UnaryExpr | MemberExpr | IndexExpr | TernaryExpr;

export type GlslType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'mat2' | 'mat3' | 'mat4' | 'sampler2D' | 'unknown';

/** The direct children of a node, in source order. */
export function childrenOf(e: Expr): Expr[] {
  switch (e.kind) {
    case 'call': return e.args;
    case 'binary': return [e.left, e.right];
    case 'unary': return [e.arg];
    case 'member': return [e.object];
    case 'index': return [e.object, e.index];
    case 'ternary': return [e.test, e.then, e.else];
    default: return [];
  }
}

/** Every node of the tree, parents before children (pre-order). */
export function walk(e: Expr, visit: (n: Expr, parent: Expr | null) => void, parent: Expr | null = null): void {
  visit(e, parent);
  for (const c of childrenOf(e)) walk(c, visit, e);
}

export function allNodes(e: Expr): Expr[] {
  const out: Expr[] = [];
  walk(e, n => { out.push(n); });
  return out;
}

const PREC: Record<string, number> = {
  '||': 1, '^^': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7,
};

/** A number as GLSL source: always a float literal unless it was an int (`3` → `3.0`). */
export function formatNumber(v: number, int = false): string {
  if (int && Number.isInteger(v)) return String(v);
  if (!Number.isFinite(v)) return '0.0';
  let s = String(parseFloat(v.toPrecision(10)));
  if (!/[.e]/.test(s)) s += '.0';
  return s;
}

/**
 * Print a tree as GLSL, with only the parentheses precedence needs.
 * `subst` replaces whole subtrees (by node id) with text, which the generaliser uses to
 * turn a literal or a sub-expression into an input's name.
 */
export function printExpr(e: Expr, subst?: ReadonlyMap<number, string>): string {
  const p = (n: Expr, min: number): string => {
    const s = subst?.get(n.id);
    if (s !== undefined) return min === 0 || isAtom(s) ? s : `(${s})`;
    switch (n.kind) {
      case 'num': return n.raw;
      case 'ident': return n.name;
      case 'call': return `${n.callee}(${n.args.map(a => p(a, 0)).join(', ')})`;
      case 'member': return `${p(n.object, 9)}.${n.field}`;
      case 'index': return `${p(n.object, 9)}[${p(n.index, 0)}]`;
      case 'unary': { const t = `${n.op}${p(n.arg, 8)}`; return min > 8 ? `(${t})` : t; }
      case 'ternary': { const t = `${p(n.test, 1)} ? ${p(n.then, 0)} : ${p(n.else, 0)}`; return min > 0 ? `(${t})` : t; }
      case 'binary': {
        const pr = PREC[n.op];
        // Left-associative: the right operand needs parentheses at equal precedence.
        const t = `${p(n.left, pr)} ${n.op} ${p(n.right, pr + 1)}`;
        return min > pr ? `(${t})` : t;
      }
    }
  };
  return p(e, 0);
}

/**
 * Text that needs no parentheses wherever it goes: a name, a number, a call or a swizzle of
 * one (`vec3(0.5)`, `$p`, `uv.x`, `f(a, b).xy`). Anything with an operator outside brackets isn't.
 */
function isAtom(s: string): boolean {
  const t = s.trim();
  if (!/^[$#\w]/.test(t)) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && !/[\w.$#]/.test(c)) return false;
  }
  return depth === 0;
}

/** The node's own text in the source it came from. */
export function sourceOf(e: Expr, src: string): string {
  return src.slice(e.start, e.end);
}
