/**
 * sectionFold.ts — which builder sections are open (docs/scene-builder.md, "Folding sections"),
 * shared by every builder's folding sections: the cards (sceneBuilder/controls.tsx Card), the small
 * folds (BuilderFold) and the Splat builder's groups. The app's rule: a section starts folded
 * (showing a one-line summary) unless it is its panel's primary one, and once you open or fold it
 * that choice is remembered for that section, in this browser, across reloads.
 *
 * Reads and writes never throw: a private window keeps the choices for the session only.
 */
import { create } from 'zustand';

export const SECTION_FOLD_KEY = 'playfield:builder-sections';
/** Most remembered sections: per-item cards (a layer's Place) would otherwise pile up for ever. */
export const MAX_REMEMBERED_SECTIONS = 400;

function load(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(SECTION_FOLD_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

function save(open: Record<string, boolean>) {
  try { globalThis.localStorage?.setItem(SECTION_FOLD_KEY, JSON.stringify(open)); } catch { /* kept for this session only */ }
}

interface SectionFoldState {
  /** Sections opened (true) or folded (false) by hand; a section not here follows its default. */
  open: Record<string, boolean>;
  setOpen: (id: string, open: boolean) => void;
}

export const useSectionFold = create<SectionFoldState>((set, get) => ({
  open: load(),
  setOpen: (id, v) => {
    const next = { ...get().open };
    delete next[id]; // re-insert last: the oldest choices are the first dropped
    next[id] = v;
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_SECTIONS))) delete next[k];
    set({ open: next });
    save(next);
  },
}));

/** Whether section `id` is open: what you last chose for it, else `primary` (the primary section starts open). */
export function sectionOpen(id: string, primary = false): boolean {
  return useSectionFold.getState().open[id] ?? primary;
}

/** A folding section's state: [open, setOpen], remembered per section. */
export function useSectionOpen(id: string, primary = false): [boolean, (open: boolean) => void] {
  const open = useSectionFold(s => s.open[id] ?? primary);
  const setOpen = useSectionFold(s => s.setOpen);
  return [open, (v: boolean) => setOpen(id, v)];
}
