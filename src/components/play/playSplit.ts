/**
 * playSplit.ts — the Play page's split view (desktop and tablet): the picture
 * shares the preview area with a big panel that shows one of the sidebar's
 * sections (Controls, Layers, Finish or Mappings) with room to breathe.
 *
 * PlaySplitArea.tsx draws the divider and the panel's frame; PlayPage renders
 * the chosen section into the frame's body through a portal, so the section
 * keeps its one set of state and logic. The sidebar leaves out whatever the
 * big panel shows (sidebarView below), and can be hidden altogether.
 *
 * On, side, ratio, tab and the hidden sidebar are remembered on this device.
 * Phones keep their own picture-over-panel split (shell/PhoneSplit.tsx).
 */
import { create } from 'zustand';
import type { PlayTab } from './playUi';

export type SplitSide = 'left' | 'right' | 'top' | 'bottom';

export interface SplitPrefs {
  on: boolean;
  /** Where the panel sits, next to the picture. */
  side: SplitSide;
  /** The panel's share of the preview area, 0..1. */
  ratio: number;
  tab: PlayTab;
  /** The left sidebar is hidden while split (more room for both). */
  sidebarHidden: boolean;
}

export const SPLIT_KEY = 'shader-studio:play:split';
export const DEFAULT_SPLIT: SplitPrefs = { on: false, side: 'right', ratio: 0.5, tab: 'controls', sidebarHidden: false };
/** The ratio is kept within these, whatever the pixels say. */
export const RATIO_MIN = 0.2;
export const RATIO_MAX = 0.8;
/** The smallest the picture and the panel get, in px (as long as the area has room for both). */
export const MIN_CANVAS_PX = 220;
export const MIN_PANEL_PX = 300;
/** From this width the panel lays its section out wide: a grid of cards, the layer list beside its editor. */
export const WIDE_PANEL_PX = 640;

const SIDES: readonly SplitSide[] = ['left', 'right', 'top', 'bottom'];
const TABS: readonly PlayTab[] = ['controls', 'layers', 'finish', 'mappings'];

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
    sidebarHidden: typeof o.sidebarHidden === 'boolean' ? o.sidebarHidden : DEFAULT_SPLIT.sidebarHidden,
  };
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
export type SideTab = 'controls' | 'layers' | 'finish';
const SIDE_TABS: readonly SideTab[] = ['controls', 'layers', 'finish'];

/**
 * What the sidebar shows beside a big panel on `big` (null: not split): the
 * section in view, the sections its switcher offers, and whether the Mappings
 * drawer sits underneath. It never shows what the big panel shows, and the
 * tab the person picked (`tab`) is left as it was, so closing the split
 * brings it back.
 */
export function sidebarView(tab: PlayTab, big: PlayTab | null): { tab: SideTab; tabs: SideTab[]; drawer: boolean } {
  const tabs = SIDE_TABS.filter(t => t !== big);
  const own: SideTab = tab === 'layers' || tab === 'finish' ? tab : 'controls';
  return { tab: tabs.includes(own) ? own : tabs[0], tabs, drawer: big !== 'mappings' };
}

function loadPrefs(): SplitPrefs {
  try { return parseSplitPrefs(localStorage.getItem(SPLIT_KEY)); } catch { return { ...DEFAULT_SPLIT }; }
}

function savePrefs(p: SplitPrefs): void {
  try { localStorage.setItem(SPLIT_KEY, JSON.stringify({ on: p.on, side: p.side, ratio: Math.round(p.ratio * 1000) / 1000, tab: p.tab, sidebarHidden: p.sidebarHidden })); } catch { /* preference only */ }
}

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
  setSidebarHidden: (hidden: boolean) => void;
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
    setSidebarHidden: sidebarHidden => save({ sidebarHidden }),
  };
});

/** The section the big panel shows, or null when there's no big panel on screen. */
export const useBigTab = (): PlayTab | null => usePlaySplit(s => (s.on && s.available && s.host ? s.tab : null));
