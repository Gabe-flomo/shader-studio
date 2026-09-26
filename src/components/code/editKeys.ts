/**
 * Editing niceties shared by every code field: the GLSL editor, the
 * expression fields and the one-line inputs.
 *
 * - Double-click selects the whole token under the caret: an identifier, or a
 *   number with its decimals and exponent (`0.005`, `1e-3`), where the
 *   browser's word selection stops at the dot.
 * - Typing an opening bracket or quote over a selection wraps it instead of
 *   replacing it, and keeps the inside selected, so `x` → `(x)` and a second
 *   press nests; `sin` can then be typed at the left edge.
 */
export const BRACKET_PAIRS: Record<string, [string, string]> = { '(': ['(', ')'], '[': ['[', ']'], '{': ['{', '}'], '"': ['"', '"'], "'": ["'", "'"] };

import type React from 'react';

type Field = HTMLTextAreaElement | HTMLInputElement;

/** The [start, end) of the token at `pos`, or null when there is none. */
export function tokenRangeAt(text: string, pos: number): [number, number] | null {
  const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);
  const isNum = (c: string | undefined) => !!c && /[0-9.]/.test(c);
  const at = isWord(text[pos]) || text[pos] === '.' ? pos : pos > 0 ? pos - 1 : pos;
  if (!isWord(text[at]) && text[at] !== '.') return null;
  // An identifier: the word run around `at` starts with a letter or underscore.
  let a = at; while (a > 0 && isWord(text[a - 1])) a--;
  if (/[A-Za-z_]/.test(text[a] ?? '')) { let b = at; while (b < text.length && isWord(text[b])) b++; return [a, Math.max(b, a + 1)]; }
  // Otherwise a number: digits and dots, plus an exponent.
  a = at; while (a > 0 && isNum(text[a - 1])) a--;
  let b = at; while (b < text.length && isNum(text[b])) b++;
  if (/[eE]/.test(text[b] ?? '') && /[-+0-9]/.test(text[b + 1] ?? '')) { b += 2; while (b < text.length && /[0-9]/.test(text[b])) b++; }
  if (!/[0-9]/.test(text.slice(a, b))) return null; // a lone member dot
  return [a, b];
}

/** onDoubleClick handler: select the token under the caret. */
export function selectTokenOnDoubleClick(e: { currentTarget: Field; preventDefault: () => void }): void {
  const el = e.currentTarget;
  const r = tokenRangeAt(el.value, el.selectionStart ?? 0);
  if (!r) return;
  e.preventDefault();
  el.setSelectionRange(r[0], r[1]);
}

/**
 * If the key is an opening bracket or quote and there is a selection, wrap it
 * and return the new text with the inner range to select; otherwise null.
 */
export function wrapSelection(key: string, text: string, start: number, end: number): { text: string; start: number; end: number } | null {
  if (!(key in BRACKET_PAIRS) || start === end) return null;
  const [open, close] = BRACKET_PAIRS[key];
  return { text: text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end), start: start + 1, end: end + 1 };
}

/** onKeyDown for a plain input/textarea holding code: wrap a selection in the typed bracket, else nothing. */
export function wrapOnKeyDown(setValue: (next: string) => void) {
  return (e: React.KeyboardEvent<Field>): void => {
    const el = e.currentTarget;
    const w = wrapSelection(e.key, el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
    if (!w) return;
    e.preventDefault();
    setValue(w.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(w.start, w.end); });
  };
}
