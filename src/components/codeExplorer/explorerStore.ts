/**
 * explorerStore.ts — opening the Code Explorer from anywhere ("How is this
 * used?"). App mounts the dialog (lazily) while `open` is set. Kept free of
 * the explorer's code so editors can import it cheaply.
 */
import { create } from 'zustand';

export interface ExplorerRequest { open: boolean; query: string; n: number }

export const useCodeExplorer = create<ExplorerRequest>(() => ({ open: false, query: '', n: 0 }));

/** Open the Explorer on a function name or some words (or on its home page). */
export function openCodeExplorer(query = ''): void {
  useCodeExplorer.setState(s => ({ open: true, query, n: s.n + 1 }));
}

export function closeCodeExplorer(): void { useCodeExplorer.setState({ open: false }); }

/** The identifier at the caret (or the selection) of a focused input or textarea, if any. */
export function wordAtCaret(el: Element | null): string {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return '';
  const v = el.value;
  const a = el.selectionStart ?? 0, b = el.selectionEnd ?? a;
  if (b > a) { const sel = v.slice(a, b).trim(); if (/^[A-Za-z_]\w*$/.test(sel)) return sel; }
  let s = a, e = a;
  while (s > 0 && /\w/.test(v[s - 1])) s--;
  while (e < v.length && /\w/.test(v[e])) e++;
  const w = v.slice(s, e);
  return /^[A-Za-z_]\w*$/.test(w) ? w : '';
}
