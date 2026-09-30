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
import { tabForPage, usePlayUi, type PlayTab } from './playUi';
import { categoryOf, currentRailPage, firstPageOf, isRailPage, pageForTab, type RailCategory, type RailPage } from './railPages';

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
  /** The page last shown for each category, so opening a category from the rail goes back to it (railPage stays the single source of truth for what's shown). */
  railPageMemory: Partial<Record<RailCategory, RailPage>>;
}

export const SPLIT_KEY = 'shader-studio:play:split';
/** The Play page opens split, with the sidebar folded into the icon rail (the owner's preferred view). */
export const DEFAULT_SPLIT: SplitPrefs = { on: true, side: 'right', ratio: 0.5, tab: 'controls', sidebar: 'rail', sidebarBefore: 'full', railPage: 'controls', railRatio: null, railPageMemory: {} };
/** Bumped when the default view changes; older saves take the new default for `on` and `sidebar` once. */
export const SPLIT_PREFS_VERSION = 2;
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
  // A save from before the rail became the default keeps its side, ratio and page but opens the new way.
  const current = o.v === SPLIT_PREFS_VERSION;
  return {
    on: current && typeof o.on === 'boolean' ? o.on : DEFAULT_SPLIT.on,
    side: SIDES.includes(o.side as SplitSide) ? o.side as SplitSide : DEFAULT_SPLIT.side,
    ratio: typeof o.ratio === 'number' && Number.isFinite(o.ratio) ? clampRatio(o.ratio) : DEFAULT_SPLIT.ratio,
    tab: TABS.includes(o.tab as PlayTab) ? o.tab as PlayTab : DEFAULT_SPLIT.tab,
    // `sidebarHidden` is how the hidden sidebar was saved before the rail.
    sidebar: !current ? DEFAULT_SPLIT.sidebar : SIDEBARS.includes(o.sidebar as SidebarMode) ? o.sidebar as SidebarMode : o.sidebarHidden === true ? 'hidden' : DEFAULT_SPLIT.sidebar,
    sidebarBefore: o.sidebarBefore === 'hidden' ? 'hidden' : 'full',
    railPage: (() => { const pg = currentRailPage(o.railPage); return isRailPage(pg) ? pg : DEFAULT_SPLIT.railPage; })(),
    railRatio: typeof o.railRatio === 'number' && Number.isFinite(o.railRatio) ? clampRatio(o.railRatio) : null,
    railPageMemory: parseRailPageMemory(o.railPageMemory),
  };
}

/**
 * Only keep entries that name a real page under the category they claim — or
 * under a since-removed category's new home (`LEGACY_CATEGORY`: a save from
 * before Controls and Mappings merged (2026-09-28) still has a `mappings` key,
 * whose pages now live under `controls`).
 */
const LEGACY_CATEGORY: Readonly<Record<string, RailCategory>> = { mappings: 'controls' };
/** Pages that moved to a category of their own: Signals (with Actions folded in) left Layers on 2026-09-30. */
const MOVED_FROM: Readonly<Partial<Record<RailPage, string>>> = { signals: 'layers' };
function parseRailPageMemory(v: unknown): Partial<Record<RailCategory, RailPage>> {
  if (!v || typeof v !== 'object') return {};
  const out: Partial<Record<RailCategory, RailPage>> = {};
  for (const [cat, saved] of Object.entries(v as Record<string, unknown>)) {
    const page = currentRailPage(saved);
    if (!isRailPage(page)) continue;
    const real = categoryOf(page);
    if (real === cat || LEGACY_CATEGORY[cat] === real || MOVED_FROM[page] === cat) out[real] = page;
  }
  return out;
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
      v: SPLIT_PREFS_VERSION, on: p.on, side: p.side, ratio: round3(p.ratio), tab: p.tab,
      sidebar: p.sidebar, sidebarBefore: p.sidebarBefore, railPage: p.railPage, railRatio: p.railRatio === null ? null : round3(p.railRatio),
      railPageMemory: p.railPageMemory,
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
  /** Show a page in the panel (rail mode). Remembers it as that page's category's last page. */
  setRailPage: (page: RailPage) => void;
  /** A rail category was clicked: its remembered page, else its first. */
  openRailCategory: (cat: RailCategory) => void;
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
    setRailPage: railPage => save({ railPage, railPageMemory: { ...get().railPageMemory, [categoryOf(railPage)]: railPage } }),
    openRailCategory: cat => get().setRailPage(get().railPageMemory[cat] ?? firstPageOf(cat)),
    setRailRatio: ratio => save({ railRatio: clampRatio(ratio) }),
  };
});

/** The rail is what's beside the panel (split on, on screen). */
export const railActive = (s: Pick<PlaySplit, 'on' | 'available' | 'sidebar'>): boolean => s.on && s.available && s.sidebar === 'rail';

/** The panel's share as shown: the rail's own while the rail is out. */
export const shownRatio = (s: Pick<SplitPrefs, 'sidebar' | 'ratio' | 'railRatio'>): number => (s.sidebar === 'rail' && s.railRatio !== null ? s.railRatio : s.ratio);

/** A rail category as the tab-strip section it sits under (Signals has no tab of its own: it rides with Layers there). */
const tabOfCategory = (c: RailCategory): PlayTab => (c === 'signals' ? 'layers' : c);

/** The section the big panel shows, or null when there's no big panel on screen. */
export const useBigTab = (): PlayTab | null => usePlaySplit(s => (s.on && s.available && s.host ? (s.sidebar === 'rail' ? tabOfCategory(categoryOf(s.railPage)) : s.tab) : null));

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
  // The tab-strip's own section for this page, not the rail's icon grouping: Mappings is its
  // own tab there even though it shares the Controls rail icon (railPages.ts, tabForPage).
  split.setTab(tabForPage(page));
}

/**
 * Mappings, wherever the split shows pages: opens the split if it's closed,
 * then its Mappings page (the rail's own, or the tab-strip's). ⌘⇧M and the
 * rail's own Mappings icon are both always there, so this is never the only
 * way in — it's for reaching it from anywhere else on the Play page. False
 * when there's no split view on screen (phones; the bottom row's Mappings
 * icon covers it there).
 */
export function goToMappings(): boolean {
  const split = usePlaySplit.getState();
  if (!split.available) return false;
  if (!split.on) split.setOn(true);
  showPageInSplit('mappings');
  return true;
}

/**
 * Show the Signals page with one signal or reaction selected (a signal just
 * made from a slider's +, say): in the split view when there is one, else as
 * the phone's page.
 */
export function goToSignal(id: string): void {
  usePlayUi.getState().focusSignal(id);
  const split = usePlaySplit.getState();
  if (!split.available) { usePlayUi.getState().showPage('signals'); return; }
  if (!split.on) split.setOn(true);
  showPageInSplit('signals');
}

/**
 * Open a rail category, wherever the split shows pages, on the page it was
 * last left on (else its first) — the keyboard's own way in (⌘1–4 or ⌃1–4:
 * App.tsx), same as clicking its rail icon. False when there's no split view
 * on screen (phones; the bottom row's icons cover it there).
 */
export function goToRailCategory(cat: RailCategory): boolean {
  const split = usePlaySplit.getState();
  if (!split.available) return false;
  if (!split.on) split.setOn(true);
  showPageInSplit(usePlaySplit.getState().railPageMemory[cat] ?? firstPageOf(cat));
  return true;
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
