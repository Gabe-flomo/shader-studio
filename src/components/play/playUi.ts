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
import type { RailPage } from './railPages';

export type PlayTab = 'controls' | 'layers' | 'finish' | 'engine' | 'mappings';

const FOLD_KEY = 'shader-studio:play:folded';
const PANEL_KEY = 'shader-studio:play:panel';
const GUIDES_KEY = 'shader-studio:play:guides';
const ALWAYS_EXPAND_KEY = 'shader-studio:play:alwaysExpandCards';

function loadAlwaysExpand(): boolean {
  try { return localStorage.getItem(ALWAYS_EXPAND_KEY) === '1'; } catch { return false; }
}

/**
 * Which Section titles exist for each layer/effect kind, so "Expand all" /
 * "Collapse all" (the editor header, BigEditorScaffold's strip) know every
 * key to flip without the store needing to know about editors. Plain module
 * state, not reactive: Section registers itself on mount and the buttons
 * read it only when clicked.
 */
const sectionTitles = new Map<string, Set<string>>();
export function registerSection(kind: string, title: string): void {
  let s = sectionTitles.get(kind);
  if (!s) { s = new Set(); sectionTitles.set(kind, s); }
  s.add(title);
}
export function unregisterSection(kind: string, title: string): void {
  sectionTitles.get(kind)?.delete(title);
}

function loadGuides(): boolean {
  try { return localStorage.getItem(GUIDES_KEY) !== '0'; } catch { return true; }
}

export type PanelSize = 's' | 'm' | 'l';
/** The Play panel's width for each size, in px. */
export const PANEL_WIDTHS: Record<PanelSize, number> = { s: 380, m: 460, l: 560 };

function loadPanel(): PanelSize {
  try { const v = localStorage.getItem(PANEL_KEY); return v === 's' || v === 'm' || v === 'l' ? v : 'm'; } catch { return 'm'; }
}

function loadFolded(): Record<string, boolean> {
  try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

interface PlayUi {
  tab: PlayTab;
  setTab: (tab: PlayTab) => void;
  /** Phones: the page picked from the bottom row's sheet ('' = the tab's own; railPages.phonePageShown). */
  phonePage: RailPage | '';
  /** Phones: show a page (its tab, and the page within it). */
  showPage: (page: RailPage) => void;
  /** The selected layer's id ('' = none). */
  selected: string;
  /** Bumped when something asks for the selected layer to be shown: the list opens it and scrolls to it. */
  revealTick: number;
  select: (id: string) => void;
  /** The selected layer's mask being edited on the picture ('' = the layer itself). */
  mask: string;
  setMask: (id: string) => void;
  /** Open the Layers tab at this layer: selected, expanded and scrolled into view. */
  reveal: (id: string) => void;
  /**
   * Folded editor sections, keyed `<kind>:<section>`. An explicit override
   * (from a click, or Expand/Collapse all); a section with no entry here
   * falls back to its own default (folded unless it's the editor's primary
   * one — `Section`'s `primary` prop decides that, not this store).
   */
  folded: Record<string, boolean>;
  toggleFold: (key: string, next: boolean) => void;
  /** Open (or fold) every registered Section of a kind at once. */
  expandAllSections: (kind: string) => void;
  collapseAllSections: (kind: string) => void;
  /** "Always expand cards": the sidebar's layer cards skip the header-only collapse. */
  alwaysExpandCards: boolean;
  setAlwaysExpandCards: (on: boolean) => void;
  /** How wide the Play panel is. */
  panel: PanelSize;
  setPanel: (size: PanelSize) => void;
  /** Null markers, handles, zone outlines and field guides on the picture. */
  guides: boolean;
  toggleGuides: () => void;
  /** The Play page is showing (the picture's hand-tracking pill offers Enable only there). */
  performing: boolean;
  setPerforming: (on: boolean) => void;
  /** The layer group whose layers the Layers tab shows ('' = the whole list). */
  entered: string;
  enter: (groupId: string) => void;
  /** Soloed layer and mapping ids (empty = no solo). */
  soloLayers: ReadonlySet<string>;
  soloMappings: ReadonlySet<string>;
  toggleSolo: (kind: 'layer' | 'mapping', id: string) => void;
  /** Solo (or unsolo) several layers at once: a group's. */
  soloLayersSet: (ids: readonly string[], on: boolean) => void;
  clearSolo: () => void;
  /** The Finish effect to open and scroll to (bumped with finishTick). */
  finishFocus: string;
  finishTick: number;
  /** Open the Finish tab at this effect. */
  revealFinish: (effectId: string) => void;
  /** The Finish tab's view: the picture's effects or the sound's. */
  finishView: 'picture' | 'sound';
  setFinishView: (v: 'picture' | 'sound') => void;
  /** Open the Finish tab's Sound view at this audio effect. */
  revealAudioFx: (effectId: string) => void;
  /** The Engine tab's view: the racks as they play, or the tape (docs/arrangement.md). */
  engineView: 'performance' | 'arrangement';
  setEngineView: (v: 'performance' | 'arrangement') => void;
  /** The control group to scroll to and flash on the Controls section (bumped with controlGroupTick). */
  controlGroupFocus: string;
  controlGroupTick: number;
  /** Open the Controls section at this control group ("Audio readers · Live"). */
  revealControlGroup: (group: string) => void;
}

const NONE: ReadonlySet<string> = new Set();

/** Each page's tab (kept here as well as in railPages.ts, so this module needs nothing from it at run time). */
const PAGE_TABS: Record<RailPage, PlayTab> = {
  controls: 'controls', layers: 'layers', actions: 'layers', signals: 'layers', background: 'layers',
  'finish-picture': 'finish', 'finish-sound': 'finish', 'engine-performance': 'engine',
  mappings: 'mappings', 'midi-file': 'mappings', 'pad-grid': 'mappings',
};

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
  setTab: tab => set({ tab, phonePage: '' }),
  phonePage: '',
  showPage: page => set({
    tab: PAGE_TABS[page], phonePage: page,
    ...(page === 'finish-picture' ? { finishView: 'picture' as const } : page === 'finish-sound' ? { finishView: 'sound' as const } : {}),
  }),
  selected: '',
  revealTick: 0,
  select: id => set(get().selected === id ? { selected: id } : { selected: id, mask: '' }),
  reveal: id => set({ tab: 'layers', phonePage: '', selected: id, revealTick: get().revealTick + 1, ...(get().selected === id ? {} : { mask: '' }) }),
  finishFocus: '',
  finishTick: 0,
  revealFinish: id => set({ tab: 'finish', phonePage: '', finishView: 'picture', finishFocus: id, finishTick: get().finishTick + 1 }),
  finishView: 'picture',
  setFinishView: finishView => set({ finishView }),
  engineView: 'performance',
  setEngineView: engineView => set({ engineView }),
  revealAudioFx: id => set({ tab: 'finish', phonePage: '', finishView: 'sound', finishFocus: id, finishTick: get().finishTick + 1 }),
  controlGroupFocus: '',
  controlGroupTick: 0,
  revealControlGroup: group => set({ tab: 'controls', phonePage: '', controlGroupFocus: group, controlGroupTick: get().controlGroupTick + 1 }),
  mask: '',
  setMask: mask => set({ mask }),
  panel: loadPanel(),
  setPanel: panel => { try { localStorage.setItem(PANEL_KEY, panel); } catch { /* preference only */ } set({ panel }); },
  guides: loadGuides(),
  toggleGuides: () => {
    const guides = !get().guides;
    try { localStorage.setItem(GUIDES_KEY, guides ? '1' : '0'); } catch { /* preference only */ }
    set({ guides });
  },
  performing: false,
  setPerforming: performing => set({ performing }),
  entered: '',
  enter: entered => set({ entered }),
  soloLayers: NONE,
  soloMappings: NONE,
  toggleSolo: (kind, id) => {
    const next = new Set(kind === 'layer' ? get().soloLayers : get().soloMappings);
    if (next.has(id)) next.delete(id); else next.add(id);
    set(kind === 'layer' ? { soloLayers: next } : { soloMappings: next });
  },
  soloLayersSet: (ids, on) => {
    const next = new Set(get().soloLayers);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    set({ soloLayers: next });
  },
  clearSolo: () => set({ soloLayers: NONE, soloMappings: NONE }),
  folded: loadFolded(),
  toggleFold: (key, next) => {
    const folded = { ...get().folded, [key]: next };
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* preference only */ }
    set({ folded });
  },
  expandAllSections: kind => {
    const titles = sectionTitles.get(kind);
    if (!titles?.size) return;
    const folded = { ...get().folded };
    for (const title of titles) folded[`${kind}:${title}`] = false;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* preference only */ }
    set({ folded });
  },
  collapseAllSections: kind => {
    const titles = sectionTitles.get(kind);
    if (!titles?.size) return;
    const folded = { ...get().folded };
    for (const title of titles) folded[`${kind}:${title}`] = true;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* preference only */ }
    set({ folded });
  },
  alwaysExpandCards: loadAlwaysExpand(),
  setAlwaysExpandCards: on => {
    try { localStorage.setItem(ALWAYS_EXPAND_KEY, on ? '1' : '0'); } catch { /* preference only */ }
    set({ alwaysExpandCards: on });
  },
}));
