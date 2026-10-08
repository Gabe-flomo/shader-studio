/**
 * libraryPrefs.ts — the node library's "Relevant only / Show all" choice and the wire being dragged
 * (so the library can offer what fits it). The choice is remembered per user in localStorage, each
 * read and write guarded.
 */
import { create } from 'zustand';

export const RELEVANT_KEY = 'playfield:library:relevantOnly';

function read(): boolean {
  try { const v = localStorage.getItem(RELEVANT_KEY); return v === null ? true : v === '1'; } catch { return true; }
}

export interface DraggedWire { nodeType: string; outType: string }

interface LibraryState {
  relevantOnly: boolean;
  setRelevantOnly: (v: boolean) => void;
  /** The output a wire is being dragged from right now, or null. */
  wire: DraggedWire | null;
  setWire: (w: DraggedWire | null) => void;
}

export const useLibraryPrefs = create<LibraryState>(set => ({
  relevantOnly: read(),
  setRelevantOnly: v => { try { localStorage.setItem(RELEVANT_KEY, v ? '1' : '0'); } catch { /* session only */ } set({ relevantOnly: v }); },
  wire: null,
  setWire: wire => set({ wire }),
}));

export function reloadLibraryPrefs() { useLibraryPrefs.setState({ relevantOnly: read() }); }
