/**
 * Bracket matching for the code fields: which `(` `[` `{` pairs with which
 * `)` `]` `}`, and which have no partner. Comments are skipped, as the
 * compiler skips them. Used to highlight the pair at the caret and to mark
 * every unmatched bracket, so a missing `)` shows where it is missing.
 */
const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

export interface BracketScan {
  /** Index of a bracket → index of its partner (both directions). */
  pairs: Map<number, number>;
  /** Brackets with no partner, or whose partner is the wrong kind. */
  unmatched: number[];
}

export function scanBrackets(text: string): BracketScan {
  const pairs = new Map<number, number>();
  const unmatched: number[] = [];
  const stack: Array<{ i: number; c: string }> = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    if (OPEN[c]) { stack.push({ i, c }); continue; }
    if (CLOSE[c]) {
      const top = stack[stack.length - 1];
      if (top && top.c === CLOSE[c]) { stack.pop(); pairs.set(top.i, i); pairs.set(i, top.i); }
      else {
        // The wrong kind: if the right opener is further down the stack, the ones above it are unclosed.
        const k = stack.map(s => s.c).lastIndexOf(CLOSE[c]);
        if (k >= 0) { for (let j = stack.length - 1; j > k; j--) unmatched.push(stack[j].i); const o = stack[k]; stack.length = k; pairs.set(o.i, i); pairs.set(i, o.i); }
        else unmatched.push(i);
      }
    }
  }
  for (const s of stack) unmatched.push(s.i);
  unmatched.sort((a, b) => a - b);
  return { pairs, unmatched };
}

/** The bracket the caret is on: the one just before it, else the one under it; -1 when neither. */
export function bracketAtCaret(text: string, caret: number): number {
  const isB = (c: string | undefined) => !!c && (c in OPEN || c in CLOSE);
  if (caret > 0 && isB(text[caret - 1])) return caret - 1;
  if (isB(text[caret])) return caret;
  return -1;
}

export function lineCol(text: string, index: number): { line: number; col: number } {
  let line = 0, last = -1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') { line++; last = i; }
  return { line, col: index - last - 1 };
}

const widthCache = new Map<string, number>();
/** The width of one character in a monospace font (cached per font string). */
export function monoCharWidth(font: string, fallback: number): number {
  let w = widthCache.get(font);
  if (w === undefined) {
    try { const ctx = document.createElement('canvas').getContext('2d'); if (ctx) { ctx.font = font; w = ctx.measureText('M').width; } } catch { /* no canvas: fall back */ }
    if (!w) w = fallback;
    widthCache.set(font, w);
  }
  return w;
}
