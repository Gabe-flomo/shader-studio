/**
 * playSplit.ts — the Play page's split view (desktop and tablet): the picture
 * shares the preview area with a big panel that shows one of the sidebar's
 * sections (Controls, Layers, Finish, the Audio engine or Mappings) with room to breathe.
 *
 * PlaySplitArea.tsx draws the divider and the panel's frame; PlayPage renders
 * the chosen section into the frame's body through a portal, so the section
 * keeps its one set of state and logic. The sidebar leaves out whatever the
 * big panel shows (sidebarView below), and can be hidden altogether.
 *
 * The sidebar has three states beside the panel (`sidebar`): full, collapsed
 * into an icon rail (PlayRail.tsx; the panel then shows one page of a
 * category full width: railPages.ts), or hidden (the picture and the panel
 * only). The rail keeps its own page and divider position, so leaving it
 * puts the sidebar and the panel back exactly as they were.
 *
 * On, side, ratio, tab, the sidebar state and the rail's page are remembered
 * on this device. Phones keep their own picture-over-panel split
 * (shell/PhoneSplit.tsx).
 */
import { create } from 'zustand';
import { usePlayUi, type PlayTab } from './playUi';
import { categoryOf, isRailPage, pageForTab, type RailPage } from './railPages';

export type SplitSide = 'left' | 'right' | 'top' | 'bottom';
/** The sidebar beside the big panel: all of it, a rail of icons, or nothing. */
export type SidebarMode = 'full' | 'rail' | 'hidden';

export interface SplitPrefs {
  on: boolean;
  /** Where the panel sits, next to the picture. */
  side: SplitSide;
  /** The panel's share of the preview area, 0..1. */
  ratio: number;
  tab: PlayTab;
  /** The left sidebar while split: full, a rail of icons (full-width pages), or hidden. */
  sidebar: SidebarMode;
  /** What the sidebar was before the rail (⌘⇧B goes back to it). */
  sidebarBefore: 'full' | 'hidden';
  /** The page the panel shows in rail mode. */
  railPage: RailPage;
  /** The panel's share in rail mode (null: worked out when the rail opens, so the picture keeps its size). */
  railRatio: number | null;
}

export const SPLIT_KEY = 'shader-studio:play:split';
export const DEFAULT_SPLIT: SplitPrefs = { on: false, side: 'right', ratio: 0.5, tab: 'controls', sidebar: 'full', sidebarBefore: 'full', railPage: 'controls', railRatio: null };
/** The rail's width, in px. */
export const RAIL_PX = 60;
/** The ratio is kept within these, whatever the pixels say. */
export const RATIO_MIN = 0.2;
export const RATIO_MAX = 0.8;
/** The smallest the picture and the panel get, in px (as long as the area has room for both). */
export const MIN_CANVAS_PX = 220;
export const MIN_PANEL_PX = 300;
/** From this width the panel lays its section out wide: a grid of cards, the layer list beside its editor. */
export const WIDE_PANEL_PX = 640;

const SIDES: readonly SplitSide[] = ['left', 'right', 'top', 'bottom'];
const SIDEBARS: readonly SidebarMode[] = ['full', 'rail', 'hidden'];
const TABS: readonly PlayTab[] = ['controls', 'layers', 'finish', 'engine', 'mappings'];

/** Remembered prefs from storage text; anything missing or odd falls back to the default. */
export function parseSplitPrefs(raw: string | null): SplitPrefs {
  if (!raw) return { ...DEFAULT_SPLIT };
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { ...DEFAULT_SPLIT }; }
  if (!v || typeof v !== 'object') return { ...DEFAULT_SPLIT };
  const o = v as Record<string, unknown>;
  return {
    on: typeof o.on === 'boolean' ? o.on : DEFAULT_SPLIT.on,
    side: SIDES.includes(o.side as SplitSide) ? o.side as SplitSide : DEFAULT_SPLIT.side,
    ratio: typeof o.ratio === 'number' && Number.isFinite(o.ratio) ? clampRatio(o.ratio) : DEFAULT_SPLIT.ratio,
    tab: TABS.includes(o.tab as PlayTab) ? o.tab as PlayTab : DEFAULT_SPLIT.tab,
    // `sidebarHidden` is how the hidden sidebar was saved before the rail.
    sidebar: SIDEBARS.includes(o.sidebar as SidebarMode) ? o.sidebar as SidebarMode : o.sidebarHidden === true ? 'hidden' : DEFAULT_SPLIT.sidebar,
    sidebarBefore: o.sidebarBefore === 'hidden' ? 'hidden' : 'full',
    railPage: isRailPage(o.railPage) ? o.railPage : DEFAULT_SPLIT.railPage,
    railRatio: typeof o.railRatio === 'number' && Number.isFinite(o.railRatio) ? clampRatio(o.railRatio) : null,
  };
}

/**
 * The panel's share once the sidebar folds into the rail, so the picture keeps
 * its size and the panel takes the sidebar's width: `ratio` of an area
 * `total` px across, beside a sidebar `sidebarPx` wide. Above or below the
 * picture the area only gets wider, so the share stays.
 */
export function railRatioFor(side: SplitSide, ratio: number, total: number, sidebarPx: number): number {
  const horizontal = side === 'left' || side === 'right';
  if (!horizontal || total <= 0 || sidebarPx <= 0) return clampRatio(ratio);
  const panel = ratio * total;
  return clampRatio((panel + sidebarPx) / (total + sidebarPx), total + sidebarPx);
}

/**
 * The panel's share, kept between RATIO_MIN and RATIO_MAX and, when the area's
 * size `total` (px) is known, so the picture and the panel keep their minimum
 * sizes. An area too small for both splits evenly.
 */
export function clampRatio(ratio: number, total?: number, minCanvas = MIN_CANVAS_PX, minPanel = MIN_PANEL_PX): number {
  let lo = RATIO_MIN, hi = RATIO_MAX;
  if (total && total > 0) {
    if (minCanvas + minPanel > total) return 0.5;
    lo = Math.max(lo, minPanel / total);
    hi = Math.min(hi, 1 - minCanvas / total);
    if (lo > hi) return 0.5;
  }
  const r = Number.isFinite(ratio) ? ratio : 0.5;
  return Math.max(lo, Math.min(hi, r));
}

/** The panel's share for a pointer at (x, y) over an area `rect`, with the panel on `side`. */
export function ratioAt(side: SplitSide, rect: { left: number; top: number; width: number; height: number }, x: number, y: number): number {
  const horizontal = side === 'left' || side === 'right';
  const total = horizontal ? rect.width : rect.height;
  if (total <= 0) return 0.5;
  const along = horizontal ? x - rect.left : y - rect.top;
  const r = side === 'left' || side === 'top' ? along / total : 1 - along / total;
  return clampRatio(r, total);
}

/** The sections the sidebar can show (Mappings is its drawer on desktop). */
export type SideTab = 'controls' | 'layers' | 'finish' | 'engine';
const SIDE_TABS: readonly SideTab[] = ['controls', 'layers', 'finish', 'engine'];

/**
 * What the sidebar shows beside a big panel on `big` (null: not split): the
 * section in view, the sections its switcher offers, and whether the Mappings
 * drawer sits underneath. It never shows what the big panel shows, and the
 * tab the person picked (`tab`) is left as it was, so closing the split
 * brings it back.
 */
export function sidebarView(tab: PlayTab, big: PlayTab | null): { tab: SideTab; tabs: SideTab[]; drawer: boolean } {
  const tabs = SIDE_TABS.filter(t => t !== big);
  const own: SideTab = tab === 'layers' || tab === 'finish' || tab === 'engine' ? tab : 'controls';
  return { tab: tabs.includes(own) ? own : tabs[0], tabs, drawer: big !== 'mappings' };
}

function loadPrefs(): SplitPrefs {
  try { return parseSplitPrefs(localStorage.getItem(SPLIT_KEY)); } catch { return { ...DEFAULT_SPLIT }; }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function savePrefs(p: SplitPrefs): void {
  try {
    localStorage.setItem(SPLIT_KEY, JSON.stringify({
      on: p.on, side: p.side, ratio: round3(p.ratio), tab: p.tab,
      sidebar: p.sidebar, sidebarBefore: p.sidebarBefore, railPage: p.railPage, railRatio: p.railRatio === null ? null : round3(p.railRatio),
    }));
  } catch { /* preference only */ }
}

/** Measures the split area and the sidebar beside it (PlaySplitArea registers it while on screen). */
type AreaMeasure = () => { total: number; sidebarPx: number } | null;
let measureArea: AreaMeasure | null = null;
export function setAreaMeasure(fn: AreaMeasure | null): void { measureArea = fn; }

interface PlaySplit extends SplitPrefs {
  /** A split area is on screen (the Play page, not on a phone): the toggle and its shortcut work. */
  available: boolean;
  setAvailable: (on: boolean) => void;
  /** The panel's body, where PlayPage renders the section. */
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  /** The panel is at least WIDE_PANEL_PX across. */
  wide: boolean;
  setWide: (wide: boolean) => void;
  toggle: () => void;
  setOn: (on: boolean) => void;
  setSide: (side: SplitSide) => void;
  setRatio: (ratio: number) => void;
  setTab: (tab: PlayTab) => void;
  /** Full sidebar, rail or hidden. Opening the rail starts it on the panel's page and keeps the picture's size. */
  setSidebar: (mode: SidebarMode) => void;
  /** ⌘⇧B: into the rail, or back to what the sidebar was (turning the split on if it's off). */
  toggleRail: () => void;
  /** Show a page in the panel (rail mode). */
  setRailPage: (page: RailPage) => void;
  setRailRatio: (ratio: number) => void;
}

export const usePlaySplit = create<PlaySplit>((set, get) => {
  const save = (patch: Partial<SplitPrefs>) => { set(patch); savePrefs(get()); };
  return {
    ...loadPrefs(),
    available: false,
    setAvailable: available => set({ available }),
    host: null,
    setHost: host => set({ host }),
    wide: false,
    setWide: wide => { if (get().wide !== wide) set({ wide }); },
    toggle: () => save({ on: !get().on }),
    setOn: on => save({ on }),
    setSide: side => save({ side }),
    setRatio: ratio => save({ ratio: clampRatio(ratio) }),
    setTab: tab => save({ tab }),
    setSidebar: mode => {
      const s = get();
      if (mode === s.sidebar) return;
      if (mode !== 'rail') { save({ sidebar: mode }); return; }
      // Into the rail: the page the panel was on, and the sidebar's width to the panel.
      const m = measureArea?.();
      save({
        sidebar: 'rail',
        sidebarBefore: s.sidebar === 'hidden' ? 'hidden' : 'full',
        railPage: pageForTab(s.tab, usePlayUi.getState().finishView),
        railRatio: m ? railRatioFor(s.side, clampRatio(s.ratio, m.total), m.total, m.sidebarPx) : s.ratio,
      });
    },
    toggleRail: () => {
      const s = get();
      if (!s.on) { save({ on: true }); if (s.sidebar === 'rail') return; }
      get().setSidebar(s.sidebar === 'rail' ? s.sidebarBefore : 'rail');
    },
    setRailPage: railPage => save({ railPage }),
    setRailRatio: ratio => save({ railRatio: clampRatio(ratio) }),
  };
});

/** The rail is what's beside the panel (split on, on screen). */
export const railActive = (s: Pick<PlaySplit, 'on' | 'available' | 'sidebar'>): boolean => s.on && s.available && s.sidebar === 'rail';

/** The panel's share as shown: the rail's own while the rail is out. */
export const shownRatio = (s: Pick<SplitPrefs, 'sidebar' | 'ratio' | 'railRatio'>): number => (s.sidebar === 'rail' && s.railRatio !== null ? s.railRatio : s.ratio);

/** The section the big panel shows, or null when there's no big panel on screen. */
export const useBigTab = (): PlayTab | null => usePlaySplit(s => (s.on && s.available && s.host ? (s.sidebar === 'rail' ? categoryOf(s.railPage) : s.tab) : null));

/** The full-width page the panel shows in rail mode, or null (no rail, or no panel on screen). */
export const useBigPage = (): RailPage | null => usePlaySplit(s => (s.on && s.available && s.host && s.sidebar === 'rail' ? s.railPage : null));

/**
 * Show a page wherever the split shows pages: the rail's panel when the rail
 * is out, else the tab-strip panel's section (a Finish page sets its view).
 */
export function showPageInSplit(page: RailPage): void {
  const split = usePlaySplit.getState();
  if (split.sidebar === 'rail') { split.setRailPage(page); return; }
  if (page === 'finish-picture' || page === 'finish-sound') usePlayUi.getState().setFinishView(page === 'finish-sound' ? 'sound' : 'picture');
  split.setTab(categoryOf(page));
}

/**
 * Open a layer's full editor in the split view's big panel: the split on, its
 * panel on Layers, the layer selected (a big editor like the drum pads' only
 * shows in full there; the sidebar keeps a summary). False when there's no
 * split view on screen (phones), for the caller to show it another way.
 */
export function openLayerInSplit(layerId: string): boolean {
  const split = usePlaySplit.getState();
  if (!split.available) return false;
  if (split.sidebar === 'rail') split.setRailPage('layers');
  else split.setTab('layers');
  if (!split.on) split.setOn(true);
  usePlayUi.getState().select(layerId);
  return true;
}
