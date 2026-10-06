/**
 * A small GLSL expression parser (Pratt), for the explainer and the pattern library.
 *
 * Why not @shaderfrog/glsl-parser (which the converter uses)? It parses whole translation
 * units and wants every name declared; the explainer gets fragments: one Expression Block
 * line, a selection on the GLSL page, a pattern with `$holes`. This parser takes any
 * expression, keeps exact spans for highlighting, and never throws: a fragment it can't read
 * gives `{ ok: false, error }`.
 *
 * Pattern syntax (only in patterns): `$name` is a hole that matches any sub-expression,
 * `#name` a hole that only matches a number (a literal, or a constant like `2.0 * PI`).
 */
import type { BinaryOp, Expr, UnaryOp } from './ast';

type Tok = { t: 'num' | 'id' | 'op' | 'eof'; v: string; s: number; e: number };

const OPS = ['<<=', '>>=', '&&', '||', '^^', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/=', '++', '--',
  '+', '-', '*', '/', '%', '(', ')', ',', '.', '?', ':', '<', '>', '!', '[', ']', '=', ';', '{', '}'];

function tokenize(src: string, offset: number): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    const num = /^(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFuU]?/.exec(src.slice(i));
    if (num && /[\d.]/.test(c) && !(c === '.' && !/\d/.test(src[i + 1] ?? ''))) {
      out.push({ t: 'num', v: num[0], s: offset + i, e: offset + i + num[0].length });
      i += num[0].length;
      continue;
    }
    const id = /^[$#]?[A-Za-z_]\w*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0], s: offset + i, e: offset + i + id[0].length }); i += id[0].length; continue; }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) return `Unexpected “${c}”`;
    out.push({ t: 'op', v: op, s: offset + i, e: offset + i + op.length });
    i += op.length;
  }
  out.push({ t: 'eof', v: '', s: offset + src.length, e: offset + src.length });
  return out;
}

const BIN: Record<string, number> = {
  '||': 1, '^^': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7,
};

export type ParseResult = { ok: true; expr: Expr } | { ok: false; error: string };

class Parser {
  private i = 0;
  private nextId: number;
  private toks: Tok[];
  constructor(toks: Tok[], idBase: number) { this.toks = toks; this.nextId = idBase; }
  peek() { return this.toks[this.i]; }
  take() { return this.toks[this.i++]; }
  is(v: string) { const t = this.peek(); return t.t === 'op' && t.v === v; }
  expect(v: string) { if (!this.is(v)) throw new Error(`Expected “${v}”${this.peek().t === 'eof' ? ' at the end' : ` before “${this.peek().v}”`}`); return this.take(); }
  id() { return this.nextId++; }

  expr(minPrec = 0): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && t.v === '?' && minPrec <= 0) {
        this.take();
        const then = this.expr(0);
        this.expect(':');
        const els = this.expr(0);
        left = { kind: 'ternary', test: left, then, else: els, id: this.id(), start: left.start, end: els.end };
        continue;
      }
      const pr = t.t === 'op' ? BIN[t.v] : undefined;
      if (pr === undefined || pr < minPrec) break;
      this.take();
      const right = this.expr(pr + 1);
      left = { kind: 'binary', op: t.v as BinaryOp, left, right, id: this.id(), start: left.start, end: right.end };
    }
    return left;
  }

  unary(): Expr {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) {
      this.take();
      const arg = this.unary();
      return { kind: 'unary', op: t.v as UnaryOp, arg, id: this.id(), start: t.s, end: arg.end };
    }
    return this.postfix(this.primary());
  }

  primary(): Expr {
    const t = this.take();
    if (t.t === 'num') {
      const raw = t.v.replace(/[fFuU]$/, '');
      return { kind: 'num', value: parseFloat(raw), raw, int: !/[.eE]/.test(raw), id: this.id(), start: t.s, end: t.e };
    }
    if (t.t === 'id') {
      if (this.is('(')) {
        this.take();
        const args: Expr[] = [];
        if (!this.is(')')) {
          for (;;) {
            args.push(this.expr(0));
            if (this.is(',')) { this.take(); continue; }
            break;
          }
        }
        const close = this.expect(')');
        return { kind: 'call', callee: t.v, args, id: this.id(), start: t.s, end: close.e };
      }
      return { kind: 'ident', name: t.v, id: this.id(), start: t.s, end: t.e };
    }
    if (t.t === 'op' && t.v === '(') {
      const inner = this.expr(0);
      const close = this.expect(')');
      // The parentheses belong to the span, so highlighting `(a + b)` covers them.
      inner.start = t.s;
      inner.end = close.e;
      return inner;
    }
    throw new Error(t.t === 'eof' ? 'The expression ends too soon' : `Unexpected “${t.v}”`);
  }

  postfix(e: Expr): Expr {
    for (;;) {
      if (this.is('.')) {
        this.take();
        const f = this.take();
        if (f.t !== 'id') throw new Error('Expected a field after “.”');
        e = { kind: 'member', object: e, field: f.v, id: this.id(), start: e.start, end: f.e };
      } else if (this.is('[')) {
        this.take();
        const index = this.expr(0);
        const close = this.expect(']');
        e = { kind: 'index', object: e, index, id: this.id(), start: e.start, end: close.e };
      } else return e;
    }
  }
}

let idCounter = 1;

/**
 * Parse one expression. `offset` shifts every span (the expression starts at that position
 * in a longer text). Ids are unique across all parses in this session.
 */
export function parseExpr(src: string, offset = 0): ParseResult {
  const toks = tokenize(src, offset);
  if (typeof toks === 'string') return { ok: false, error: toks };
  if (toks.length === 1) return { ok: false, error: 'Nothing to explain' };
  const p = new Parser(toks, idCounter);
  try {
    const expr = p.expr(0);
    if (p.peek().t !== 'eof') throw new Error(`Unexpected “${p.peek().v}”`);
    idCounter += 100000;
    return { ok: true, expr };
  } catch (err) {
    idCounter += 100000;
    return { ok: false, error: (err as Error).message };
  }
}

const DECL_TYPES = /^(?:(?:const|highp|mediump|lowp|in|out|inout)\s+)*(float|int|bool|uint|vec[234]|ivec[234]|bvec[234]|mat[234])\s+/;

/** One line of code, split into what it assigns and the expression it computes. */
export interface ParsedLine {
  /** `float d = …` → 'float'. */
  declType?: string;
  /** The variable written (`d`, `p.xy`), or undefined for a bare expression or `return`. */
  target?: string;
  /** `=`, `+=`, `-=`, `*=`, `/=`. */
  op?: string;
  isReturn: boolean;
  expr: Expr;
  /** Where the expression starts in the line's text. */
  exprStart: number;
  exprEnd: number;
}

/**
 * Parse `float d = length(p) - r;`, `p *= 2.0`, `return col;` or a bare expression. Spans are
 * relative to `text` plus `offset`.
 */
export function parseLine(text: string, offset = 0): { ok: true; line: ParsedLine } | { ok: false; error: string } {
  let s = text;
  let at = 0;
  const lead = /^\s*/.exec(s)![0].length;
  at += lead;
  let rest = s.slice(at);
  // Trailing `;` and spaces
  const trail = /;?\s*$/.exec(rest)!;
  rest = rest.slice(0, rest.length - trail[0].length);
  s = rest;
  let isReturn = false;
  const ret = /^return\b\s*/.exec(s);
  if (ret) { isReturn = true; at += ret[0].length; s = s.slice(ret[0].length); }
  let declType: string | undefined;
  let target: string | undefined;
  let op: string | undefined;
  if (!isReturn) {
    const decl = DECL_TYPES.exec(s);
    if (decl) { declType = decl[1]; at += decl[0].length; s = s.slice(decl[0].length); }
    const asg = /^([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z]+|\s*\[[^\]]*\])*)\s*(\+=|-=|\*=|\/=|=)(?!=)\s*/.exec(s);
    if (asg) { target = asg[1].replace(/\s+/g, ''); op = asg[2]; at += asg[0].length; s = s.slice(asg[0].length); }
    else if (declType) {
      // `float d;` declares without a value
      return { ok: false, error: 'Nothing is computed on this line' };
    }
  }
  const r = parseExpr(s, offset + at);
  if (!r.ok) return r;
  return { ok: true, line: { declType, target, op, isReturn, expr: r.expr, exprStart: offset + at, exprEnd: offset + at + s.length } };
}

/**
 * What to explain for a selection in a code editor: the selection itself (trimmed, without a
 * trailing `;`), or with only a caret, the statement it sits in. Null when there is nothing.
 */
export function pickExplainSpan(code: string, sel: { start: number; end: number }): { start: number; end: number } | null {
  if (sel.end > sel.start) {
    let s = sel.start, e = sel.end;
    while (s < e && /\s/.test(code[s])) s++;
    while (e > s && /[\s;]/.test(code[e - 1])) e--;
    return e > s ? { start: s, end: e } : null;
  }
  const st = splitStatements(code).find(x => x.start <= sel.start && sel.start <= x.end + 1);
  return st ? { start: st.start, end: st.end } : null;
}

/** A statement found in a block of code: its text and where it sits. */
export interface Statement { text: string; start: number; end: number; /** 1-based line of its start. */ line: number }

/**
 * Split a function body (or a whole shader) into simple statements, at top-level `;`. The
 * heads of `if (…)`, `for (…)`, `while (…)` and braces are skipped, so `if (d < 0.0) col = a;`
 * yields `col = a`. Comments are blanked, keeping offsets.
 */
export function splitStatements(code: string): Statement[] {
  // Blank comments, keeping every offset
  let src = code.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
  // Preprocessor lines aren't statements
  src = src.replace(/^[ \t]*#[^\n]*/gm, m => ' '.repeat(m.length));
  const out: Statement[] = [];
  let depth = 0;
  let begin = 0;
  const push = (end: number) => {
    let s = begin;
    let text = src.slice(s, end);
    // Strip control heads and braces at the front
    for (;;) {
      const m = /^\s*(?:[{}]|else\b|(?:if|for|while)\s*\()/.exec(text);
      if (!m) break;
      if (m[0].trim().endsWith('(')) {
        // Skip to the matching ')'
        let d = 1, k = m[0].length;
        while (k < text.length && d > 0) { if (text[k] === '(') d++; else if (text[k] === ')') d--; k++; }
        s += k; text = text.slice(k);
      } else { s += m[0].length; text = text.slice(m[0].length); }
    }
    const lead = /^\s*/.exec(text)![0].length;
    s += lead;
    text = text.slice(lead).replace(/\s+$/, '');
    if (text && !/^(?:void|float|vec[234]|mat[234]|int|bool)\s+\w+\s*\([^)]*\)\s*$/.test(text)) {
      out.push({ text, start: s, end: s + text.length, line: code.slice(0, s).split('\n').length });
    }
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (c === ';' || c === '{' || c === '}')) {
      if (c === ';') { push(i); begin = i + 1; }
      else {
        // A function header or block opener before '{': drop it, keep going
        const head = src.slice(begin, i);
        if (/\)\s*$/.test(head) && /^\s*(?:[\w\s]+\([^;]*\))\s*$/.test(head) && !/=/.test(head)) { begin = i + 1; continue; }
        if (/^\s*(?:else)?\s*$/.test(head)) { begin = i + 1; continue; }
        push(i); begin = i + 1;
      }
    }
  }
  push(src.length);
  return out;
}
