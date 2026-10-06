/**
 * Which function is at a caret or a click (the function card, docs/expression-explainer.md):
 *
 *   functionAt('float e = smoothstep(0.3, 0.35, d);', 14)
 *   → { name: 'smoothstep', start: 10, end: 20, open: 20, close: 35, args: ['0.3', '0.35', 'd'], … }
 *
 * A function name is an identifier followed (after optional spaces) by `(`, outside comments,
 * not a member (`s.foo(`) and not a preprocessor line. A caret counts when it sits in the name
 * or right after it. With `enclosing`, a caret anywhere inside a call's parentheses finds the
 * innermost call around it (the keyboard shortcut in editors: the caret is usually in the
 * arguments while typing).
 *
 * Also: the functions a piece of source declares (`float foo(vec2 p, float r) {`), with the
 * comment lines just above as their doc, so a card can show a user function's signature.
 */
import type { FnOverload, FnParam } from './functions';

export interface FunctionHit {
  name: string;
  /** The name's span. */
  start: number;
  end: number;
  /** The `(` and the matching `)` (or the text's end when it isn't closed). */
  open: number;
  close: number;
  /** Each argument's source, trimmed, and where it starts. */
  args: string[];
  argStarts: number[];
  /** `type name(` at the start of a statement: a declaration, not a call. */
  declaration: boolean;
}

export interface FunctionAtOptions {
  /** A caret inside the parentheses finds the innermost call around it. */
  enclosing?: boolean;
}

/** Spans of comments in the text, so names inside them are skipped. */
export function commentSpans(code: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < code.length) {
    if (code[i] === '/' && code[i + 1] === '/') { const e = code.indexOf('\n', i); const end = e < 0 ? code.length : e; out.push([i, end]); i = end; continue; }
    if (code[i] === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); const end = e < 0 ? code.length : e + 2; out.push([i, end]); i = end; continue; }
    i++;
  }
  return out;
}

const inSpans = (spans: Array<[number, number]>, at: number) => spans.some(([s, e]) => at >= s && at < e);
const isWord = (c: string | undefined) => !!c && /\w/.test(c);
const TYPE_WORDS = /^(?:void|float|int|uint|bool|[biud]?vec[234]|mat[234](?:x[234])?|sampler\w*)$/;
const NOT_FUNCTIONS = new Set(['if', 'for', 'while', 'switch', 'return', 'do', 'else', 'layout', 'sizeof']);

/** The call (or declaration) whose name spans [start, end), or null when no `(` follows it. */
function hitAt(code: string, start: number, end: number, comments: Array<[number, number]>): FunctionHit | null {
  const name = code.slice(start, end);
  if (!/^[A-Za-z_]\w*$/.test(name) || NOT_FUNCTIONS.has(name)) return null;
  if (inSpans(comments, start)) return null;
  // A member call (`s.foo(`) is not GLSL's
  let b = start - 1;
  while (b >= 0 && (code[b] === ' ' || code[b] === '\t')) b--;
  if (code[b] === '.') return null;
  // A preprocessor line (`#define foo(x) …`)
  const lineStart = code.lastIndexOf('\n', start - 1) + 1;
  if (/^\s*#/.test(code.slice(lineStart, start))) return null;
  let p = end;
  while (p < code.length && (code[p] === ' ' || code[p] === '\t')) p++;
  if (code[p] !== '(') return null;
  const open = p;
  const args: string[] = [];
  const argStarts: number[] = [];
  let depth = 0, from = open + 1, close = code.length;
  for (let i = open; i < code.length; i++) {
    if (inSpans(comments, i)) continue;
    const c = code[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      depth--;
      if (depth === 0) { close = i; break; }
    } else if (c === ',' && depth === 1) {
      pushArg(code, from, i, args, argStarts);
      from = i + 1;
    }
  }
  pushArg(code, from, close, args, argStarts);
  if (args.length === 1 && args[0] === '') { args.length = 0; argStarts.length = 0; }
  // `float foo(` with a type word before it, at a statement start: a declaration
  const before = code.slice(Math.max(0, start - 80), start);
  const decl = /(?:^|[;{}\n])\s*(?:(?:highp|mediump|lowp|const)\s+)*(\w+)\s+$/.exec(before);
  const declaration = !!decl && TYPE_WORDS.test(decl[1]);
  return { name, start, end, open, close, args, argStarts, declaration };
}

function pushArg(code: string, from: number, to: number, args: string[], argStarts: number[]) {
  const raw = code.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  args.push(raw.trim());
  argStarts.push(from + lead);
}

/** The identifier around `pos` (a caret between two characters counts for the word on its left too). */
function wordAround(code: string, pos: number): [number, number] | null {
  let s = pos, e = pos;
  if (!isWord(code[pos]) && isWord(code[pos - 1])) { s = pos - 1; e = pos - 1; }
  if (!isWord(code[s])) return null;
  while (s > 0 && isWord(code[s - 1])) s--;
  while (e < code.length && isWord(code[e])) e++;
  if (/^\d/.test(code[s])) return null;
  return [s, e];
}

/** The function name at `pos` (a click's or a caret's offset), or with `enclosing` the innermost call around it. */
export function functionAt(code: string, pos: number, opts: FunctionAtOptions = {}): FunctionHit | null {
  if (pos < 0 || pos > code.length) return null;
  const comments = commentSpans(code);
  if (inSpans(comments, pos) && pos > 0 && inSpans(comments, pos - 1)) return null;
  const w = wordAround(code, pos);
  if (w) {
    const hit = hitAt(code, w[0], w[1], comments);
    if (hit) return hit;
  }
  if (!opts.enclosing) return null;
  // Walk back to the innermost unclosed `(` before pos that is a call
  let depth = 0;
  for (let i = pos - 1; i >= 0; i--) {
    if (inSpans(comments, i)) continue;
    const c = code[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth > 0) { depth--; continue; }
      let e = i;
      while (e > 0 && (code[e - 1] === ' ' || code[e - 1] === '\t')) e--;
      let s = e;
      while (s > 0 && isWord(code[s - 1])) s--;
      if (s < e) {
        const hit = hitAt(code, s, e, comments);
        if (hit && hit.close >= pos) return hit;
      }
    } else if (c === ';' || c === '{' || c === '}') return null;
  }
  return null;
}

/** Every function name in the text, in order (for tests and for marking tokens). */
export function functionsIn(code: string): FunctionHit[] {
  const comments = commentSpans(code);
  const out: FunctionHit[] = [];
  const re = /[A-Za-z_]\w*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const hit = hitAt(code, m.index, m.index + m[0].length, comments);
    if (hit) out.push(hit);
  }
  return out;
}

// ── Functions the source declares ─────────────────────────────────────────────

export interface DeclaredFunction {
  name: string;
  overload: FnOverload;
  /** The `//` or `/* … *\/` comment just above it, without the markers. */
  doc?: string;
  /** Where the declaration starts. */
  start: number;
}

const DECL_RE = /(?:^|[;}\n])[ \t]*(?:(?:highp|mediump|lowp)[ \t]+)?([A-Za-z_]\w*)[ \t]+([A-Za-z_]\w*)[ \t]*\(([^()]*)\)\s*\{/g;

function parseParams(src: string): FnParam[] | null {
  const t = src.trim();
  if (!t || t === 'void') return [];
  const out: FnParam[] = [];
  for (const part of t.split(',')) {
    const w = part.trim().split(/\s+/).filter(x => !/^(?:in|const|highp|mediump|lowp)$/.test(x));
    const q = w[0] === 'out' || w[0] === 'inout' ? (w.shift() as 'out' | 'inout') : undefined;
    if (w.length < 1 || !/^[A-Za-z_]\w*$/.test(w[0])) return null;
    out.push({ type: w[0], name: (w[1] ?? '').replace(/\[.*$/, ''), ...(q ? { q } : {}) });
  }
  return out;
}

/** The functions declared in `source` (all overloads, in order). */
export function declaredFunctions(source: string): DeclaredFunction[] {
  const out: DeclaredFunction[] = [];
  const comments = commentSpans(source);
  DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL_RE.exec(source))) {
    const [, ret, name, ps] = m;
    if (!TYPE_WORDS.test(ret) && !/^[A-Z]/.test(ret)) continue; // a struct return type starts with a capital, by habit
    if (NOT_FUNCTIONS.has(name)) continue;
    const start = m.index + m[0].indexOf(ret);
    if (inSpans(comments, start)) continue;
    const params = parseParams(ps);
    if (!params) continue;
    out.push({ name, overload: { returns: ret, params }, doc: docAbove(source, start), start });
    DECL_RE.lastIndex = m.index + m[0].length - 1;
  }
  return out;
}

/** The comment lines right above `at` (no blank line between), joined. */
function docAbove(source: string, at: number): string | undefined {
  const lines = source.slice(0, at).split('\n');
  lines.pop(); // the declaration's own line, up to it
  const doc: string[] = [];
  while (lines.length) {
    const l = lines[lines.length - 1].trim();
    if (l.startsWith('//')) { doc.unshift(l.replace(/^\/\/+\s?/, '')); lines.pop(); continue; }
    if (l.endsWith('*/')) {
      const block: string[] = [];
      while (lines.length) {
        const b = lines.pop()!.trim();
        block.unshift(b.replace(/^\/\*+\s?/, '').replace(/\s?\*+\/$/, '').replace(/^\*\s?/, ''));
        if (b.startsWith('/*')) break;
      }
      doc.unshift(...block.filter(Boolean));
      continue;
    }
    break;
  }
  const text = doc.join(' ').trim();
  return text || undefined;
}
