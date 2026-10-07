/**
 * lex.ts — the one lexer for Playfield text (docs/playfield-language-plan.md §8.1, D1).
 *
 * It started as the Scene Builder recipe's tokenizer (numbers with units, hex, strings, `@`,
 * brackets, comments, the indented continuation) and gained what the other dialects need:
 * arrows (`→`, `->`), relative assignment (`*= /= += -=`), arithmetic operators (with spaces
 * round them, since `-` is part of words like `smooth-union`), comparisons (`> < >= <=`), ranges
 * (`34..45`), time, rate and percent units (`0.5s`, `200ms`, `1/s`, `60%`), counts (`6x`),
 * fractions (`1/2`), `{raw GLSL}`, a colon (`species Ants:`), a dot for sockets (`glow.tint`),
 * an ordinal (`circle#2`) and grid cells (`.../.1./...`, `11/00`).
 *
 * Every token keeps `at` and `end`, so errors, highlighting and type-ahead share positions. A
 * line break is a `sep` with the next line's indent, so block dialects (species, patterns) can
 * see which lines belong to a header.
 */

export type Unit = 'deg' | 'rad' | 's' | 'ms' | '%' | 'x' | '/s' | '%/s';

export type Tok =
  /** `·`, `•`, `|`, `;` or a line break (`nl`: with the indent of the line that follows). */
  | { t: 'sep'; nl: boolean; indent: number; at: number; end: number }
  | { t: 'num'; v: number; unit: Unit | null; text: string; at: number; end: number }
  | { t: 'word'; v: string; at: number; end: number }
  | { t: 'str'; v: string; at: number; end: number }
  | { t: 'hex'; v: [number, number, number]; text: string; at: number; end: number }
  | { t: 'code'; v: string; at: number; end: number }
  /** `circle#2`, `circle#last`: an ordinal straight after a word. */
  | { t: 'ord'; v: number; at: number; end: number }
  /** Grid cells: 3×3 (`.../.1./...`) or 2×2 (`11/00`) rows split by `/`. */
  | { t: 'cells'; v: string[]; at: number; end: number }
  | { t: 'range'; lo: number; hi: number; at: number; end: number }
  | { t: '(' | ')' | ',' | '=' | '@' | '.' | ':' | 'arrow'; at: number; end: number }
  | { t: 'op'; v: '+' | '-' | '*' | '/'; at: number; end: number }
  | { t: 'opeq'; v: '+=' | '-=' | '*=' | '/='; at: number; end: number }
  | { t: 'cmp'; v: '>' | '<' | '>=' | '<='; at: number; end: number }
  | { t: 'comment'; v: string; at: number; end: number }
  | { t: 'eof'; at: number; end: number };

export interface LexError { message: string; at: number; end: number }

export interface LexResult { toks: Tok[]; errors: LexError[] }

/** Does the line starting at `at` go on with the clause above: indented, or starting with a closing bracket? */
export function continuesClause(src: string, at: number): boolean {
  const m = /^([ \t]*)(\S?)/.exec(src.slice(at));
  return !!m && (m[1].length > 0 || m[2] === ')') && m[2] !== '';
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const NUM_RE = /^[-+−]?(\d+(?:\.\d+)?(?!\.\.)\.?|\.\d+)(e[-+]?\d+)?/i;
const CELL_ROW = '[.*=0-9]';

/**
 * Tokens of `src`. `comments`: keep `//` comments as tokens (the highlighter wants them; the
 * parser doesn't).
 */
export function lex(src: string, opts: { comments?: boolean } = {}): LexResult {
  const out: Tok[] = [];
  const errors: LexError[] = [];
  let i = 0;
  let depth = 0;
  const prev = () => out[out.length - 1];
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      if (opts.comments) out.push({ t: 'comment', v: src.slice(i + 2, j), at: i, end: j });
      i = j;
      continue;
    }
    // Inside brackets, a new line that is indented (or closes the bracket) goes on with the clause:
    // the pretty form puts each item of a combine on its own line.
    if (c === '\n' && depth > 0 && continuesClause(src, i + 1)) { i++; continue; }
    if (c === '\n') {
      const ind = /^[ \t]*/.exec(src.slice(i + 1))![0];
      out.push({ t: 'sep', nl: true, indent: ind.replace(/\t/g, '  ').length, at: i, end: i + 1 });
      depth = 0; i++; continue;
    }
    if (c === '·' || c === '•' || c === '|' || c === ';') { out.push({ t: 'sep', nl: false, indent: 0, at: i, end: i + 1 }); depth = 0; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '→') { out.push({ t: 'arrow', at: i, end: i + 1 }); i++; continue; }
    if (c === '-' && src[i + 1] === '>') { out.push({ t: 'arrow', at: i, end: i + 2 }); i += 2; continue; }
    if ('+-*/'.includes(c) && src[i + 1] === '=') { out.push({ t: 'opeq', v: `${c}=` as '+=', at: i, end: i + 2 }); i += 2; continue; }
    if (c === '>' || c === '<') {
      const eq = src[i + 1] === '=';
      out.push({ t: 'cmp', v: (eq ? `${c}=` : c) as '>', at: i, end: i + (eq ? 2 : 1) });
      i += eq ? 2 : 1;
      continue;
    }
    if (c === '≥' || c === '≤') { out.push({ t: 'cmp', v: c === '≥' ? '>=' : '<=', at: i, end: i + 1 }); i++; continue; }
    if (c === '{') {
      let d = 0, j = i;
      for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
      if (j >= src.length) errors.push({ message: 'This { is never closed.', at: i, end: src.length });
      out.push({ t: 'code', v: src.slice(i + 1, Math.min(j, src.length)).trim(), at: i, end: Math.min(src.length, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === '\'' || c === '“' || c === '‘') {
      const close = c === '“' ? '”' : c === '‘' ? '’' : c;
      const j = src.indexOf(close, i + 1);
      const end = j < 0 ? src.length : j;
      if (j < 0) errors.push({ message: 'This quote is never closed.', at: i, end });
      out.push({ t: 'str', v: src.slice(i + 1, end), at: i, end: Math.min(src.length, end + 1) });
      i = end + 1;
      continue;
    }
    if (c === '#') {
      // An ordinal straight after a word: circle#2, circle#last.
      const p = prev();
      if (p && p.t === 'word' && p.end === i) {
        const m = /^#(\d+|last)\b/i.exec(rest);
        if (m) { out.push({ t: 'ord', v: m[1].toLowerCase() === 'last' ? -1 : Number(m[1]), at: i, end: i + m[0].length }); i += m[0].length; continue; }
      }
      const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/.exec(rest);
      if (m) {
        const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
        out.push({ t: 'hex', v: [0, 2, 4].map(k => round(parseInt(h.slice(k, k + 2), 16) / 255)) as [number, number, number], text: m[0], at: i, end: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    // Grid cells: rows of 2 or 3 cells split by '/', all the same length (.../.1./..., 11/00, 1./0.).
    const cm = new RegExp(`^(${CELL_ROW}{2,3})(?:/(${CELL_ROW}{2,3})){1,2}(?![\\w.*=/])`).exec(rest);
    if (cm && (/[.*=]/.test(c) || /^\d/.test(c))) {
      const rows = cm[0].split('/');
      const allNums = rows.every(r => /^\d+$/.test(r));
      if (rows.every(r => r.length === rows[0].length) && rows.length === rows[0].length && !(allNums && rows.length === 2 && rows[0].length === 3)) {
        out.push({ t: 'cells', v: rows, at: i, end: i + cm[0].length });
        i += cm[0].length;
        continue;
      }
    }
    // A range: 34..45, 0.2..2
    const rm = /^(-?\d*\.?\d+)\.\.(-?\d*\.?\d+)/.exec(rest);
    if (rm && /[\d.-]/.test(c)) {
      out.push({ t: 'range', lo: parseFloat(rm[1]), hi: parseFloat(rm[2]), at: i, end: i + rm[0].length });
      i += rm[0].length;
      continue;
    }
    const startsNumber = /[\d.]/.test(c) && /\d/.test(c === '.' ? src[i + 1] ?? '' : c);
    const signed = (c === '-' || c === '+' || c === '−') && /[\d.]/.test(src[i + 1] ?? '') && !(prev() && (prev()!.t === 'num' || prev()!.t === 'word' || prev()!.t === ')') && src[i - 1] !== ' ' && src[i - 1] !== '(' && src[i - 1] !== '=' && src[i - 1] !== ',');
    // "a - 2" with spaces both sides is subtraction.
    const spacedOp = (c === '-' || c === '+') && src[i + 1] === ' ';
    if ((startsNumber || signed) && !spacedOp) {
      const nm = NUM_RE.exec(rest);
      if (nm) {
        let j = i + nm[0].length;
        let v = parseFloat(nm[0].replace('−', '-'));
        let unit: Unit | null = null;
        // A fraction: 1/2 (not 1/s).
        const fr = /^\/(\d+)(?![\w.])/.exec(src.slice(j));
        if (fr && /^\d+$/.test(nm[0])) { v = v / Number(fr[1]); j += fr[0].length; }
        const um = /^[ \t]*(?:(deg|rad)\b|(°))|^(ms|s|%\/s|%|x|\/s)(?![A-Za-z0-9_])/i.exec(src.slice(j));
        if (um) {
          const u = (um[1] ?? um[2] ?? um[3]).trim().toLowerCase();
          unit = u === '°' || u === 'deg' ? 'deg' : (u as Unit);
          j += um[0].length;
        }
        out.push({ t: 'num', v, unit, text: src.slice(i, j), at: i, end: j });
        i = j;
        continue;
      }
    }
    if ('(),=@:'.includes(c)) {
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      out.push({ t: c as '(', at: i, end: i + 1 }); i++; continue;
    }
    if (c === '.') { out.push({ t: '.', at: i, end: i + 1 }); i++; continue; }
    if ('+-*/×÷'.includes(c)) {
      const v = c === '×' ? '*' : c === '÷' ? '/' : c;
      out.push({ t: 'op', v: v as '+', at: i, end: i + 1 }); i++; continue;
    }
    const wm = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(rest);
    if (wm) {
      out.push({ t: 'word', v: wm[0], at: i, end: i + wm[0].length });
      i += wm[0].length;
      continue;
    }
    errors.push({ message: `“${c}” isn't part of the language.`, at: i, end: i + 1 });
    i++;
  }
  out.push({ t: 'eof', at: src.length, end: src.length });
  return { toks: out, errors };
}

/** Line and column (1-based) of an offset. */
export function lineCol(src: string, at: number): { line: number; col: number } {
  const before = src.slice(0, at);
  return { line: before.split('\n').length, col: at - before.lastIndexOf('\n') };
}
