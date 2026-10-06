/**
 * fold.ts — whether the node browser's Builders section is folded (components/builders/
 * BuildersSection.tsx): shared by every node browser on the page and kept in this browser.
 */
import { create } from 'zustand';

const FOLD_KEY = 'nodeBrowser.buildersFolded';

const readFolded = (): boolean => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } };

export const useBuildersFold = create<{ folded: boolean; toggle: () => void }>(set => ({
  folded: readFolded(),
  toggle: () => set(s => {
    const folded = !s.folded;
    try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0'); } catch { /* private window: per session only */ }
    return { folded };
  }),
}));

