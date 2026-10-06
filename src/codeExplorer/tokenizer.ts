/**
 * tokenizer.ts — Tier A's tolerant GLSL tokenizer (docs/code-explorer-plan.md §4.1).
 *
 * Comments are blanked first with discover.ts's `blankComments`, so offsets
 * still point into the original text. Preprocessor lines are skipped. Nothing
 * throws: an unknown character becomes a one-character operator token, and
 * the parser decides what to make of it.
 *
 * In `shape` mode (reading an L1 shape back for anti-unification), `#` is a
 * literal placeholder and `…` a hole instead of the start of a directive.
 */
import { blankComments } from '../glsl/discover';

export type TokKind = 'id' | 'num' | 'op' | 'hole';
export interface Tok { k: TokKind; v: string; s: number; e: number }

const OPS3 = ['<<=', '>>='];
const OPS2 = ['++', '--', '<=', '>=', '==', '!=', '&&', '||', '^^', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'];

const isIdStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdChar = (c: string) => isIdStart(c) || isDigit(c);

export function tokenize(src: string, opts: { shape?: boolean } = {}): Tok[] {
  const s = opts.shape ? src : blankComments(src);
  const out: Tok[] = [];
  let i = 0;
  let lineStart = true;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { lineStart = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    if (c === '#' && !opts.shape && lineStart) {
      // A directive: skip to the end of the line (and its continuations).
      while (i < s.length && s[i] !== '\n') { if (s[i] === '\\' && s[i + 1] === '\n') i++; i++; }
      continue;
    }
    lineStart = false;
    if (opts.shape && (c === '#' || c === '…')) { out.push({ k: 'hole', v: c, s: i, e: i + 1 }); i++; continue; }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < s.length && isIdChar(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j), s: i, e: j });
      i = j; continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1] ?? ''))) {
      let j = i;
      if (c === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) {
        j = i + 2;
        while (j < s.length && /[0-9a-fA-F]/.test(s[j])) j++;
      } else {
        while (j < s.length && isDigit(s[j])) j++;
        if (s[j] === '.') { j++; while (j < s.length && isDigit(s[j])) j++; }
        if ((s[j] === 'e' || s[j] === 'E') && (isDigit(s[j + 1] ?? '') || ((s[j + 1] === '+' || s[j + 1] === '-') && isDigit(s[j + 2] ?? '')))) {
          j += 2;
          while (j < s.length && isDigit(s[j])) j++;
        }
      }
      if (s[j] === 'f' || s[j] === 'F' || s[j] === 'u' || s[j] === 'U') j++;
      out.push({ k: 'num', v: s.slice(i, j), s: i, e: j });
      i = j; continue;
    }
    const three = s.slice(i, i + 3), two = s.slice(i, i + 2);
    if (OPS3.includes(three)) { out.push({ k: 'op', v: three, s: i, e: i + 3 }); i += 3; continue; }
    if (OPS2.includes(two)) { out.push({ k: 'op', v: two, s: i, e: i + 2 }); i += 2; continue; }
    out.push({ k: 'op', v: c, s: i, e: i + 1 });
    i++;
  }
  return out;
}

/** The value of a numeric literal token ("1.", "2.5e-3", "0xff", "3u"). */
export function numValue(raw: string): number {
  const t = raw.replace(/[fFuU]$/, '');
  if (/^0[xX]/.test(t)) return parseInt(t, 16);
  const v = Number(t.endsWith('.') ? `${t}0` : t);
  return Number.isFinite(v) ? v : 0;
}

/** Line starts of a text, for offset → (line, column). */
export function lineStarts(s: string): number[] {
  const out = [0];
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') out.push(i + 1);
  return out;
}

/** 0-based line index of an offset (binary search over `lineStarts`). */
export function lineIndexAt(starts: readonly number[], at: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid; else hi = mid - 1;
  }
  return lo;
}
