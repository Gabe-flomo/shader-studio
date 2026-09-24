import { create } from 'zustand';

/**
 * Which sub-sections of node cards are folded (e.g. a Palette's Offset / Amplitude / Frequency /
 * Phase). UI-only and per session: kept outside the card so it survives the card being unmounted
 * (viewport culling), and outside the graph so folding never triggers a recompile.
 */
export const useFoldState = create<{ folded: Record<string, true>; toggle: (id: string) => void }>(set => ({
  folded: {},
  toggle: id => set(s => {
    const next = { ...s.folded };
    if (next[id]) delete next[id]; else next[id] = true;
    return { folded: next };
  }),
}));
