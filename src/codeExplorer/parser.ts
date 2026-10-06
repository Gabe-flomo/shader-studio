/**
 * parser.ts — Tier A's expression and statement parser (docs/code-explorer-plan.md §4.1).
 *
 * A small Pratt parser builds an expression tree for each statement, and a
 * statement walker finds declarations, assignments, returns and the headers
 * of if / for / while, with the function each sits in. It is tolerant: it
 * reads fragments (an Expression Block's lines, an input expression) as well
 * as whole files, and on anything it doesn't understand it skips to the next
 * `;` and carries on. It never throws.
 *
 * It does not resolve types or scopes; that is Tier B (shaderfrog), which
 * phase 1 doesn't need.
 */
import { tokenize, numValue, type Tok } from './tokenizer';
import type { ParseMode } from './types';

export type Expr =
  | { k: 'num'; raw: string; v: number; s: number; e: number }
  /** A literal placeholder (`#`) or any-expression hole (`…`), only in shape mode. */
  | { k: 'hole'; raw: string; s: number; e: number }
  | { k: 'id'; name: string; s: number; e: number }
  | { k: 'call'; name: string; args: Expr[]; s: number; e: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; s: number; e: number }
  | { k: 'un'; op: string; a: Expr; s: number; e: number }
  | { k: 'post'; op: string; a: Expr; s: number; e: number }
  | { k: 'mem'; o: Expr; f: string; s: number; e: number }
  | { k: 'idx'; o: Expr; i: Expr; s: number; e: number }
  | { k: 'tern'; c: Expr; a: Expr; b: Expr; s: number; e: number }
  | { k: 'assign'; op: string; l: Expr; r: Expr; s: number; e: number }
  | { k: 'err'; s: number; e: number };

export type StmtKind = 'decl' | 'assign' | 'return' | 'expr' | 'if' | 'for' | 'while' | 'switch';

export interface Stmt {
  kind: StmtKind;
  /** For declarations: the declared type ('float', 'vec3'). */
  declType?: string;
  /** For assignments: the operator ('=', '+='). */
  op?: string;
  /** Names written: declared names, or the root name of an assignment's target. */
  targets: string[];
  /** The expressions in it to look for calls in (initialiser, right-hand side, condition…). */
  exprs: Expr[];
  /** The assignment's target expression. */
  lhs?: Expr;
  s: number;
  e: number;
  /** The function it sits in ('' at top level or in a fragment). */
  fn: string;
}

export interface ParsedSource { stmts: Stmt[]; fns: Array<{ name: string; s: number; e: number }> }

const BIN: Record<string, number> = {
  '||': 3, '^^': 4, '&&': 5, '|': 6, '^': 7, '&': 8, '==': 9, '!=': 9,
  '<': 10, '>': 10, '<=': 10, '>=': 10, '<<': 11, '>>': 11, '+': 12, '-': 12, '*': 13, '/': 13, '%': 13,
};
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const PREC_ASSIGN = 1, PREC_TERN = 2, PREC_UNARY = 14, PREC_POSTFIX = 15;

export const TYPE_NAMES = /^(void|bool|int|uint|float|double|[biud]?vec[234]|d?mat[234](?:x[234])?|[iu]?sampler(?:2D|3D|Cube|2DArray|2DShadow|CubeShadow|2DArrayShadow)|samplerExternalOES)$/;
const QUALIFIERS = new Set(['const', 'highp', 'mediump', 'lowp', 'in', 'out', 'inout', 'uniform', 'varying', 'attribute', 'flat', 'smooth', 'noperspective', 'centroid', 'invariant', 'precise', 'buffer', 'shared']);
const GLOBAL_ONLY = new Set(['uniform', 'varying', 'attribute', 'in', 'out', 'buffer', 'shared']);
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'discard', 'switch', 'case', 'default', 'struct', 'precision', 'true', 'false']);

export function isTypeName(name: string, structs?: ReadonlySet<string>): boolean {
  return TYPE_NAMES.test(name) || !!structs?.has(name);
}

class Parser {
  i = 0;
  readonly t: Tok[];
  constructor(t: Tok[]) { this.t = t; }
  peek(o = 0): Tok | undefined { return this.t[this.i + o]; }
  is(v: string, o = 0): boolean { const x = this.t[this.i + o]; return !!x && x.k === 'op' && x.v === v; }
  end(): number { return this.t[this.i - 1]?.e ?? 0; }

  expr(min = 0): Expr {
    let left = this.prefix();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.k === 'op') {
        if (t.v === '(' && PREC_POSTFIX > min) {
          // A call on something that isn't a plain name: `.length()`, `(f)(x)`.
          const name = left.k === 'mem' ? `.${left.f}` : '?';
          this.i++;
          const args = this.args(')');
          left = { k: 'call', name, args, s: left.s, e: this.end() };
          continue;
        }
        if (t.v === '[' && PREC_POSTFIX > min) {
          this.i++;
          const index = this.is(']') ? { k: 'err' as const, s: t.e, e: t.e } : this.expr(0);
          if (this.is(']')) this.i++;
          left = { k: 'idx', o: left, i: index, s: left.s, e: this.end() };
          continue;
        }
        if (t.v === '.' && PREC_POSTFIX > min) {
          const f = this.peek(1);
          if (f?.k !== 'id') break;
          this.i += 2;
          left = { k: 'mem', o: left, f: f.v, s: left.s, e: f.e };
          continue;
        }
        if ((t.v === '++' || t.v === '--') && PREC_POSTFIX > min) {
          this.i++;
          left = { k: 'post', op: t.v, a: left, s: left.s, e: t.e };
          continue;
        }
        if (t.v === '?' && PREC_TERN > min) {
          this.i++;
          const a = this.expr(0);
          if (this.is(':')) this.i++;
          const b = this.expr(PREC_TERN - 1);
          left = { k: 'tern', c: left, a, b, s: left.s, e: b.e };
          continue;
        }
        if (ASSIGN.has(t.v) && PREC_ASSIGN > min) {
          this.i++;
          const r = this.expr(PREC_ASSIGN - 1);
          left = { k: 'assign', op: t.v, l: left, r, s: left.s, e: r.e };
          continue;
        }
        const p = BIN[t.v];
        if (p !== undefined && p > min) {
          this.i++;
          const r = this.expr(p);
          left = { k: 'bin', op: t.v, l: left, r, s: left.s, e: r.e };
          continue;
        }
      }
      break;
    }
    return left;
  }

  /** Comma-separated expressions up to `close` (consumed). */
  args(close: string): Expr[] {
    const out: Expr[] = [];
    if (this.is(close)) { this.i++; return out; }
    for (;;) {
      const before = this.i;
      out.push(this.expr(0));
      if (this.is(',')) { this.i++; continue; }
      if (this.is(close)) { this.i++; break; }
      // Junk inside the brackets: skip to the closing one, keeping what was read.
      if (this.i === before) this.i++;
      this.skipTo(close);
      break;
    }
    return out;
  }

  /** Skip to just past `close` at this nesting level (or to a `;` / `}` that ends the statement). */
  skipTo(close: string): void {
    let depth = 0;
    while (this.i < this.t.length) {
      const t = this.t[this.i];
      if (t.k === 'op') {
        if (t.v === '(' || t.v === '[') depth++;
        else if ((t.v === ')' || t.v === ']') && depth > 0) depth--;
        else if (t.v === close && depth === 0) { this.i++; return; }
        else if ((t.v === ';' || t.v === '{' || t.v === '}') && depth === 0) return;
      }
      this.i++;
    }
  }

  prefix(): Expr {
    const t = this.peek();
    if (!t) return { k: 'err', s: this.end(), e: this.end() };
    if (t.k === 'num') { this.i++; return { k: 'num', raw: t.v, v: numValue(t.v), s: t.s, e: t.e }; }
    if (t.k === 'hole') { this.i++; return { k: 'hole', raw: t.v, s: t.s, e: t.e }; }
    if (t.k === 'id') {
      this.i++;
      // An array constructor `float[3](…)` / `vec2[](…)`: the brackets are part of the name.
      if (this.is('[') && (this.is(']', 1) || (this.peek(1)?.k === 'num' && this.is(']', 2))) && this.is('(', this.is(']', 1) ? 2 : 3)) {
        this.i += this.is(']', 1) ? 2 : 3;
      }
      if (this.is('(')) {
        this.i++;
        const args = this.args(')');
        return { k: 'call', name: t.v, args, s: t.s, e: this.end() };
      }
      return { k: 'id', name: t.v, s: t.s, e: t.e };
    }
    if (t.v === '(') {
      this.i++;
      const inner = this.expr(0);
      // A comma expression in brackets: keep the last value.
      let last = inner;
      while (this.is(',')) { this.i++; last = this.expr(0); }
      if (this.is(')')) this.i++;
      return last === inner ? inner : last;
    }
    if (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~' || t.v === '++' || t.v === '--') {
      this.i++;
      const a = this.expr(PREC_UNARY - 1);
      return { k: 'un', op: t.v, a, s: t.s, e: a.e };
    }
    // Not the start of an expression: leave it for the statement walker.
    return { k: 'err', s: t.s, e: t.s };
  }
}

/** Parse one expression (a fragment, or an L1 shape with `shape: true`). */
export function parseExpression(text: string, opts: { shape?: boolean } = {}): Expr {
  const p = new Parser(tokenize(text, opts));
  return p.expr(0);
}

/** The name an assignment target writes: `col` for `col.rgb`, `a` for `a[i].x`. */
export function rootName(e: Expr): string | undefined {
  if (e.k === 'id') return e.name;
  if (e.k === 'mem' || e.k === 'idx') return rootName(e.o);
  return undefined;
}

/** Statements (and functions) of a source. */
export function parseSource(text: string, mode: ParseMode): ParsedSource {
  const toks = tokenize(text);
  const p = new Parser(toks);
  const stmts: Stmt[] = [];
  const fns: ParsedSource['fns'] = [];
  const structs = new Set<string>();

  if (mode === 'expr') {
    if (toks.length) {
      const e = p.expr(0);
      stmts.push({ kind: 'expr', targets: [], exprs: [e], s: toks[0].s, e: e.e, fn: '' });
    }
    return { stmts, fns };
  }

  let depth = 0;
  // The function being read, and the brace depth its body sits at.
  let fn: { name: string; depth: number; s: number } | null = mode === 'body' ? { name: '', depth: 0, s: 0 } : null;

  const isDeclStart = (at: number): boolean => {
    let j = at;
    while (toks[j]?.k === 'id' && QUALIFIERS.has(toks[j].v)) j++;
    const ty = toks[j], nm = toks[j + 1];
    if (ty?.k !== 'id' || KEYWORDS.has(ty.v)) return false;
    if (nm?.k === 'id' && !KEYWORDS.has(nm.v)) return isTypeName(ty.v, structs) || !QUALIFIERS.has(nm.v);
    // `float[3] a = …`
    return isTypeName(ty.v, structs) && nm?.v === '[';
  };

  /** Declarators after the type: `a = 1.0, b[2], c = f(x)` up to `;`. */
  const declarators = (declType: string, start: number, fnName: string, emit: boolean) => {
    for (;;) {
      const nm = p.peek();
      if (nm?.k !== 'id') break;
      p.i++;
      if (p.is('[')) { p.i++; if (!p.is(']')) p.expr(0); if (p.is(']')) p.i++; }
      if (p.is('=')) {
        p.i++;
        const init = p.expr(0);
        if (emit) stmts.push({ kind: 'decl', declType, targets: [nm.v], exprs: [init], s: start, e: init.e, fn: fnName });
      }
      if (p.is(',')) { p.i++; continue; }
      break;
    }
  };

  /** One declaration starting at `p.i`: qualifiers, type, declarators. */
  const declaration = (fnName: string, emit: boolean) => {
    const start = p.peek()!.s;
    let globalOnly = false;
    while (p.peek()?.k === 'id' && QUALIFIERS.has(p.peek()!.v)) { if (GLOBAL_ONLY.has(p.peek()!.v)) globalOnly = true; p.i++; }
    const ty = p.peek()!;
    p.i++;
    if (p.is('[')) { p.i++; while (p.i < toks.length && !p.is(']')) p.i++; p.i++; }
    declarators(ty.v, start, fnName, emit && !globalOnly);
  };

  const finish = (before: number) => {
    // Resync: whatever is left of the statement, up to its `;`.
    if (p.is(';')) { p.i++; return; }
    if (p.i === before) p.i++;
    p.skipTo(';');
  };

  while (p.i < toks.length) {
    const t = toks[p.i];
    const before = p.i;
    if (t.k === 'op' && t.v === '{') { depth++; p.i++; continue; }
    if (t.k === 'op' && t.v === '}') {
      depth--; p.i++;
      if (fn && mode === 'file' && depth < fn.depth) { fns.push({ name: fn.name, s: fn.s, e: t.e }); fn = null; }
      if (mode === 'body' && depth < 0) depth = 0;
      continue;
    }
    if (t.k === 'op' && t.v === ';') { p.i++; continue; }

    if (!fn) {
      // ── Top level of a file ──
      if (t.v === 'precision') { p.skipTo(';'); continue; }
      if (t.v === 'struct') {
        p.i++;
        if (p.peek()?.k === 'id') { structs.add(p.peek()!.v); p.i++; }
        if (p.is('{')) { let d = 0; while (p.i < toks.length) { if (p.is('{')) d++; else if (p.is('}') && --d === 0) { p.i++; break; } p.i++; } }
        p.skipTo(';');
        continue;
      }
      // A function definition or prototype: [qualifiers] type name ( … ) { or ;
      let j = p.i;
      while (toks[j]?.k === 'id' && QUALIFIERS.has(toks[j].v)) j++;
      if (toks[j]?.k === 'id' && toks[j + 1]?.k === 'id' && toks[j + 2]?.v === '(') {
        const name = toks[j + 1].v;
        p.i = j + 3;
        p.skipTo(')');
        if (p.is('{')) { p.i++; depth++; fn = { name, depth, s: t.s }; }
        else p.skipTo(';');
        continue;
      }
      if (isDeclStart(p.i)) { declaration('', true); finish(before); continue; }
      // Anything else at the top level (a stray expression): read it as a statement.
      const e = p.expr(0);
      if (e.k !== 'err') stmts.push(exprStmt(e, ''));
      finish(before);
      continue;
    }

    // ── Inside a function body ──
    const fnName = fn.name;
    if (t.k === 'id') {
      switch (t.v) {
        case 'if': case 'while': case 'switch': {
          p.i++;
          if (p.is('(')) {
            p.i++;
            const c = p.expr(0);
            if (p.is(')')) p.i++; else p.skipTo(')');
            stmts.push({ kind: t.v as StmtKind, targets: [], exprs: [c], s: t.s, e: c.e, fn: fnName });
          }
          continue;
        }
        case 'for': {
          p.i++;
          if (!p.is('(')) continue;
          p.i++;
          // init
          if (isDeclStart(p.i)) declaration(fnName, true);
          else if (!p.is(';')) { const e = p.expr(0); if (e.k !== 'err') stmts.push(exprStmt(e, fnName)); }
          if (p.is(';')) p.i++;
          const exprs: Expr[] = [];
          if (!p.is(';')) exprs.push(p.expr(0));
          if (p.is(';')) p.i++;
          while (!p.is(')') && p.i < toks.length) { const b = p.i; exprs.push(p.expr(0)); if (p.is(',')) p.i++; else if (p.i === b) break; }
          if (p.is(')')) p.i++; else p.skipTo(')');
          stmts.push({ kind: 'for', targets: [], exprs: exprs.filter(e => e.k !== 'err'), s: t.s, e: p.end(), fn: fnName });
          continue;
        }
        case 'else': case 'do': p.i++; continue;
        case 'return': {
          p.i++;
          if (p.is(';')) { p.i++; continue; }
          const e = p.expr(0);
          stmts.push({ kind: 'return', targets: [], exprs: [e], s: t.s, e: e.e, fn: fnName });
          finish(before);
          continue;
        }
        case 'break': case 'continue': case 'discard': p.skipTo(';'); continue;
        case 'case': case 'default': while (p.i < toks.length && !p.is(':')) p.i++; p.i++; continue;
      }
      if (isDeclStart(p.i)) { declaration(fnName, true); finish(before); continue; }
    }
    const e = p.expr(0);
    if (e.k !== 'err') stmts.push(exprStmt(e, fnName));
    // Comma-separated expression statements.
    while (p.is(',')) { p.i++; const more = p.expr(0); if (more.k !== 'err') stmts.push(exprStmt(more, fnName)); }
    finish(before);
  }
  if (fn && mode === 'file') fns.push({ name: fn.name, s: fn.s, e: text.length });
  return { stmts, fns };
}

function exprStmt(e: Expr, fn: string): Stmt {
  if (e.k === 'assign') {
    const name = rootName(e.l);
    return { kind: 'assign', op: e.op, targets: name ? [name] : [], exprs: [e.r], lhs: e.l, s: e.s, e: e.e, fn };
  }
  return { kind: 'expr', targets: [], exprs: [e], s: e.s, e: e.e, fn };
}
