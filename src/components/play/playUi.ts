/**
 * playUi.ts — Play page state that more than one panel needs: which tab is
 * open, which layer is selected (the Layers list, the picture's right-click
 * menu and links in the notes all set it), and which editor sections are
 * folded (remembered per layer kind, across sessions).
 */
import { create } from 'zustand';

export type PlayTab = 'controls' | 'layers' | 'mappings';

const FOLD_KEY = 'shader-studio:play:folded';
const PANEL_KEY = 'shader-studio:play:panel';

export type PanelSize = 's' | 'm' | 'l';
/** The Play panel's width for each size, in px. */
export const PANEL_WIDTHS: Record<PanelSize, number> = { s: 380, m: 460, l: 560 };

function loadPanel(): PanelSize {
  try { const v = localStorage.getItem(PANEL_KEY); return v === 's' || v === 'm' || v === 'l' ? v : 'm'; } catch { return 'm'; }
}

function loadFolded(): Record<string, true> {
  try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

interface PlayUi {
  tab: PlayTab;
  setTab: (tab: PlayTab) => void;
  /** The selected layer's id ('' = none). */
  selected: string;
  /** Bumped when something asks for the selected layer to be shown: the list opens it and scrolls to it. */
  revealTick: number;
  select: (id: string) => void;
  /** Open the Layers tab at this layer: selected, expanded and scrolled into view. */
  reveal: (id: string) => void;
  /** Folded editor sections, keyed `<kind>:<section>`. */
  folded: Record<string, true>;
  toggleFold: (key: string) => void;
  /** How wide the Play panel is. */
  panel: PanelSize;
  setPanel: (size: PanelSize) => void;
}

export const usePlayUi = create<PlayUi>((set, get) => ({
  tab: 'controls',
  setTab: tab => set({ tab }),
  selected: '',
  revealTick: 0,
  select: id => set({ selected: id }),
  reveal: id => set({ tab: 'layers', selected: id, revealTick: get().revealTick + 1 }),
  panel: loadPanel(),
  setPanel: panel => { try { localStorage.setItem(PANEL_KEY, panel); } catch { /* preference only */ } set({ panel }); },
  folded: loadFolded(),
  toggleFold: key => {
    const folded = { ...get().folded };
    if (folded[key]) delete folded[key]; else folded[key] = true;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* preference only */ }
    set({ folded });
  },
}));
