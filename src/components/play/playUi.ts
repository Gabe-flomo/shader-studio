/**
 * playUi.ts — Play page state that more than one panel needs: which tab is
 * open, which layer is selected (the Layers list, the picture's right-click
 * menu and links in the notes all set it), which editor sections are
 * folded (remembered per layer kind, across sessions), whether the picture
 * shows its guides, and what is soloed.
 *
 * Solo is for looking, not saving: soloed layers are the only ones drawn
 * (nulls stay, they're handles) and soloed mappings the only ones running.
 * The record itself never changes, so exports and saves are unaffected.
 */
import { create } from 'zustand';
import type { PlayRecord } from '../../types/play';

export type PlayTab = 'controls' | 'layers' | 'mappings';

const FOLD_KEY = 'shader-studio:play:folded';
const PANEL_KEY = 'shader-studio:play:panel';
const GUIDES_KEY = 'shader-studio:play:guides';

function loadGuides(): boolean {
  try { return localStorage.getItem(GUIDES_KEY) !== '0'; } catch { return true; }
}

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
  /** Null markers, handles, zone outlines and field guides on the picture. */
  guides: boolean;
  toggleGuides: () => void;
  /** Soloed layer and mapping ids (empty = no solo). */
  soloLayers: ReadonlySet<string>;
  soloMappings: ReadonlySet<string>;
  toggleSolo: (kind: 'layer' | 'mapping', id: string) => void;
  clearSolo: () => void;
}

const NONE: ReadonlySet<string> = new Set();

/** The record as it plays with solo applied (the same object when nothing is soloed). */
export function applySolo(p: PlayRecord, layers: ReadonlySet<string>, mappings: ReadonlySet<string>): PlayRecord {
  if (!layers.size && !mappings.size) return p;
  return {
    ...p,
    layers: layers.size ? p.layers.map(l => (l.kind === 'null' || layers.has(l.id) || !l.visible ? l : { ...l, visible: false })) : p.layers,
    mappings: mappings.size ? p.mappings.map(m => (mappings.has(m.id) || !m.enabled ? m : { ...m, enabled: false })) : p.mappings,
  };
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
  guides: loadGuides(),
  toggleGuides: () => {
    const guides = !get().guides;
    try { localStorage.setItem(GUIDES_KEY, guides ? '1' : '0'); } catch { /* preference only */ }
    set({ guides });
  },
  soloLayers: NONE,
  soloMappings: NONE,
  toggleSolo: (kind, id) => {
    const next = new Set(kind === 'layer' ? get().soloLayers : get().soloMappings);
    if (next.has(id)) next.delete(id); else next.add(id);
    set(kind === 'layer' ? { soloLayers: next } : { soloMappings: next });
  },
  clearSolo: () => set({ soloLayers: NONE, soloMappings: NONE }),
  folded: loadFolded(),
  toggleFold: key => {
    const folded = { ...get().folded };
    if (folded[key]) delete folded[key]; else folded[key] = true;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* preference only */ }
    set({ folded });
  },
}));
