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
import type { PlayRecord, TriggerSpec } from '../../types/play';
import type { RailPage } from './railPages';

export type PlayTab = 'controls' | 'layers' | 'finish' | 'engine' | 'mappings';

const FOLD_KEY = 'shader-studio:play:folded';
const PANEL_KEY = 'shader-studio:play:panel';
const GUIDES_KEY = 'shader-studio:play:guides';
const ALWAYS_EXPAND_KEY = 'shader-studio:play:alwaysExpandCards';
const LAYERS_SPLIT_KEY = 'shader-studio:play:layersSplitRatio';

/** The Layers page's list ↔ editor divider (LayersPanel's `split` mode): the list's share of the width, 0..1. */
export const LAYERS_SPLIT_DEFAULT_RATIO = 0.38;
/** Neither column collapses below these, in px (as long as the page has room for both). */
export const LAYERS_SPLIT_MIN_LIST_PX = 220;
export const LAYERS_SPLIT_MIN_EDITOR_PX = 360;
const LAYERS_SPLIT_RATIO_MIN = 0.2;
const LAYERS_SPLIT_RATIO_MAX = 0.7;

/**
 * The list's share of the Layers page's width, kept between the ratio bounds
 * and, when the page's width `total` (px) is known, so the list and the
 * editor keep their minimum widths. A page too small for both is left to the
 * caller (it stacks instead of splitting), so this only clamps for a `total`
 * that actually fits both minimums.
 */
export function clampLayersSplitRatio(ratio: number, total?: number, minList = LAYERS_SPLIT_MIN_LIST_PX, minEditor = LAYERS_SPLIT_MIN_EDITOR_PX): number {
  let lo = LAYERS_SPLIT_RATIO_MIN, hi = LAYERS_SPLIT_RATIO_MAX;
  if (total && total > 0) {
    if (minList + minEditor > total) return 0.5;
    lo = Math.max(lo, minList / total);
    hi = Math.min(hi, 1 - minEditor / total);
    if (lo > hi) return 0.5;
  }
  const r = Number.isFinite(ratio) ? ratio : LAYERS_SPLIT_DEFAULT_RATIO;
  return Math.max(lo, Math.min(hi, r));
}

function loadLayersSplitRatio(): number {
  try {
    const v = Number(localStorage.getItem(LAYERS_SPLIT_KEY));
    return Number.isFinite(v) && v > 0 ? clampLayersSplitRatio(v) : LAYERS_SPLIT_DEFAULT_RATIO;
  } catch { return LAYERS_SPLIT_DEFAULT_RATIO; }
}

const SHOW_ALL_KEY = 'shader-studio:play:sectionsShowAll';
const TABS_KEY = 'shader-studio:play:sectionTabs';
/** How many remembered tabs to keep (one per layer, mostly): the oldest go first. */
const TABS_KEEP = 300;

function loadShowAll(): boolean {
  try { return localStorage.getItem(SHOW_ALL_KEY) === '1'; } catch { return false; }
}
function loadTabs(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

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

/** A device block's fold key in a rack's chain (Task: collapsible devices in a rack), kept in `folded` alongside the layer editors' sections. */
export function deviceFoldKey(rackId: string, deviceKey: string): string { return `aeDevice:${rackId}:${deviceKey}`; }

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
  /** What the Rules page should show selected next (a signal or an action, by id), bumped each time something asks. */
  signalFocus: { id: string; tick: number };
  focusSignal: (id: string) => void;
  /** Quick rule asked for from elsewhere ("Rule from this", a layer's + Rule): its When or its Do's layer, filled in; bumped each time. */
  quickRule: { pending: boolean; when?: TriggerSpec; layerId?: string };
  askQuickRule: (pre: { when?: TriggerSpec; layerId?: string }) => void;
  /** The Rules page took the request (it opens Quick rule once). */
  takeQuickRule: () => void;
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
  /** Fold (or unfold) several keys at once ("Collapse all / Expand all" on a rack's device chain). */
  toggleFoldMany: (keys: readonly string[], next: boolean) => void;
  /**
   * Layer editors show one Section at a time, as tabs (docs/editor-layout.md).
   * "Show all" stacks them instead (the folded-by-default layout, with Expand
   * all / Collapse all). One global choice, remembered.
   */
  sectionsShowAll: boolean;
  setSectionsShowAll: (on: boolean) => void;
  /**
   * The open tab of each tabbed editor, keyed by its scope (`layer:<id>` for
   * a layer, the kind for a one-off editor like Finish → Grade); the value is
   * the Section's tab key (its `id`, or its title). No entry = the primary.
   */
  sectionTabs: Record<string, string>;
  setSectionTab: (scope: string, key: string) => void;
  /** A section something asked to show (bumped with sectionFocusTick): its tab opens, or in Show all it unfolds and scrolls into view. */
  sectionFocus: { scope: string; key: string };
  sectionFocusTick: number;
  /** Open the Layers tab at this layer, on this section's tab (`key`: the Section's `id`, or its title). */
  revealSection: (layerId: string, key: string) => void;
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
  /** The control group to scroll to and flash on the Controls section (bumped with controlGroupTick). */
  controlGroupFocus: string;
  controlGroupTick: number;
  /** Open the Controls section at this control group ("Audio readers · Live"). */
  revealControlGroup: (group: string) => void;
  /** The Layers page's list ↔ editor divider (LayersPanel's `split` mode): the list's share, 0..1, remembered. */
  layersSplitRatio: number;
  setLayersSplitRatio: (ratio: number) => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Each page's tab-strip section (kept here rather than railPages.ts: it's
 * about the sidebar's own tabs, not the rail's icon grouping — Mappings
 * shares the Controls rail icon but keeps its own tab here, so this needs
 * nothing from railPages.ts at run time beyond the RailPage type).
 */
const PAGE_TABS: Record<RailPage, PlayTab> = {
  controls: 'controls', layers: 'layers', signals: 'layers', background: 'layers',
  'finish-picture': 'finish', 'finish-sound': 'finish', 'engine-performance': 'engine',
  'midi-file': 'mappings', 'pad-grid': 'mappings',
};
/** The tab-strip section a rail page belongs to (independent of the rail's own category grouping). */
export function tabForPage(page: RailPage): PlayTab { return PAGE_TABS[page]; }

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
  signalFocus: { id: '', tick: 0 },
  focusSignal: id => set({ signalFocus: { id, tick: get().signalFocus.tick + 1 } }),
  quickRule: { pending: false },
  askQuickRule: pre => set({ quickRule: { ...pre, pending: true } }),
  takeQuickRule: () => set({ quickRule: { pending: false } }),
  select: id => set(get().selected === id ? { selected: id } : { selected: id, mask: '' }),
  reveal: id => set({ tab: 'layers', phonePage: '', selected: id, revealTick: get().revealTick + 1, ...(get().selected === id ? {} : { mask: '' }) }),
  finishFocus: '',
  finishTick: 0,
  revealFinish: id => set({ tab: 'finish', phonePage: '', finishView: 'picture', finishFocus: id, finishTick: get().finishTick + 1 }),
  finishView: 'picture',
  setFinishView: finishView => set({ finishView }),
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
  toggleFoldMany: (keys, next) => {
    if (!keys.length) return;
    const folded = { ...get().folded };
    for (const k of keys) folded[k] = next;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* preference only */ }
    set({ folded });
  },
  sectionsShowAll: loadShowAll(),
  setSectionsShowAll: on => {
    try { localStorage.setItem(SHOW_ALL_KEY, on ? '1' : '0'); } catch { /* preference only */ }
    set({ sectionsShowAll: on });
  },
  sectionTabs: loadTabs(),
  setSectionTab: (scope, key) => {
    if (get().sectionTabs[scope] === key) return;
    const next = { ...get().sectionTabs };
    delete next[scope];
    next[scope] = key;
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - TABS_KEEP))) delete next[k];
    try { localStorage.setItem(TABS_KEY, JSON.stringify(next)); } catch { /* preference only */ }
    set({ sectionTabs: next });
  },
  sectionFocus: { scope: '', key: '' },
  sectionFocusTick: 0,
  revealSection: (layerId, key) => {
    const scope = `layer:${layerId}`;
    get().setSectionTab(scope, key);
    set({ sectionFocus: { scope, key }, sectionFocusTick: get().sectionFocusTick + 1 });
    get().reveal(layerId);
  },
  alwaysExpandCards: loadAlwaysExpand(),
  setAlwaysExpandCards: on => {
    try { localStorage.setItem(ALWAYS_EXPAND_KEY, on ? '1' : '0'); } catch { /* preference only */ }
    set({ alwaysExpandCards: on });
  },
  layersSplitRatio: loadLayersSplitRatio(),
  setLayersSplitRatio: ratio => {
    const clamped = clampLayersSplitRatio(ratio);
    try { localStorage.setItem(LAYERS_SPLIT_KEY, String(Math.round(clamped * 1000) / 1000)); } catch { /* preference only */ }
    set({ layersSplitRatio: clamped });
  },
}));
