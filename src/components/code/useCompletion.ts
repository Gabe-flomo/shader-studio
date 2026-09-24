import { useCallback, useMemo, useState } from 'react';
import { matchCompletions, type Completion } from './glslReference';

type Field = HTMLTextAreaElement | HTMLInputElement;

/** The identifier being typed right before the caret, unless it follows a `.` (a swizzle). */
function wordBeforeCaret(value: string, caret: number): { word: string; start: number } | null {
  const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(value.slice(0, caret));
  if (!m) return null;
  const start = caret - m[0].length;
  if (start > 0 && value[start - 1] === '.') return null;
  return { word: m[0], start };
}

export interface CompletionState {
  open: boolean;
  items: Completion[];
  index: number;
  /** Where the typed word starts, for placing the popup. */
  anchor: number;
  word: string;
}

/**
 * Autocomplete for a code textarea or input. Call `update` after each edit (it reads the caret),
 * route keydown through `handleKey` first (true = consumed), and `close` on blur. `apply`
 * replaces the typed word and returns the new value and caret for the caller to commit.
 */
export function useCompletion(completions: readonly Completion[], onApply: (next: string, caret: number) => void) {
  const [state, setState] = useState<CompletionState>({ open: false, items: [], index: 0, anchor: 0, word: '' });

  const close = useCallback(() => setState(s => (s.open ? { ...s, open: false } : s)), []);

  /** Re-reads the caret; returns where the completed word starts when the popup is open, else null. */
  const update = useCallback((el: Field): number | null => {
    const caret = el.selectionStart ?? el.value.length;
    if (caret !== (el.selectionEnd ?? caret)) { close(); return null; }
    const w = wordBeforeCaret(el.value, caret);
    const items = w ? matchCompletions(completions, w.word) : [];
    if (!w || items.length === 0) { close(); return null; }
    setState({ open: true, items, index: 0, anchor: w.start, word: w.word });
    return w.start;
  }, [completions, close]);

  const apply = useCallback((el: Field, item: Completion) => {
    const caret = el.selectionStart ?? el.value.length;
    const w = wordBeforeCaret(el.value, caret);
    const start = w ? w.start : caret;
    const next = el.value.slice(0, start) + item.insert + el.value.slice(caret);
    const paren = item.insert.indexOf('(');
    const at = start + (paren >= 0 ? paren + 1 : item.insert.length);
    setState(s => ({ ...s, open: false }));
    onApply(next, at);
  }, [onApply]);

  /** Returns true when the key was handled by the popup. */
  const handleKey = useCallback((e: React.KeyboardEvent<Field>): boolean => {
    if (!state.open) return false;
    const n = state.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setState(s => ({ ...s, index: (s.index + 1) % n })); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setState(s => ({ ...s, index: (s.index - 1 + n) % n })); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); apply(e.currentTarget, state.items[state.index]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return true; }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) close();
    return false;
  }, [state, apply, close]);

  const select = useCallback((index: number) => setState(s => ({ ...s, index })), []);

  return useMemo(() => ({ state, update, close, apply, handleKey, select }), [state, update, close, apply, handleKey, select]);
}

/** Insert a reference snippet at the selection: wraps the selection (or, with `wrapAll`, the whole text) as its first argument. */
export function insertSnippet(value: string, selStart: number, selEnd: number, text: string, wrapAll = false): { next: string; caret: number } {
  const paren = text.indexOf('(');
  const selected = value.slice(selStart, selEnd);
  const wrap = (inner: string) => text.slice(0, paren + 1) + inner + text.slice(paren + 1);
  if (paren >= 0 && wrapAll) {
    const next = wrap(value);
    return { next, caret: next.length };
  }
  if (paren >= 0 && selected) {
    const wrapped = wrap(selected);
    return { next: value.slice(0, selStart) + wrapped + value.slice(selEnd), caret: selStart + wrapped.length };
  }
  const next = value.slice(0, selStart) + text + value.slice(selEnd);
  const empty = text.indexOf('()');
  return { next, caret: selStart + (paren >= 0 && empty >= 0 ? empty + 1 : paren >= 0 ? paren + 1 : text.length) };
}
