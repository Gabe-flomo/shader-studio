/**
 * playSplit.ts — the Play page's one navigation model (Play audit P1): a
 * labelled rail of categories (PlayRail.tsx, railPages.ts) on the left, the
 * panel beside it showing one page of the open category, and the picture on
 * the right. Desktop and tablet draw it with PlaySplitArea.tsx; phones show
 * the same pages under the picture, picked from the same categories along the
 * bottom (PlayRailBar), so the page shown is one piece of state everywhere
 * (`railPage`).
 *
 * PlaySplitArea.tsx draws the rail, the divider and the panel's frame;
 * PlayPage renders the page into the frame's body through a portal, so each
 * page keeps its one set of state and logic.
 *
 * Three views, and nothing else (there is no second sidebar beside the panel
 * any more: its "Sidebar beside the panel" mode is gone):
 *   - the rail and the panel (`on`), the default;
 *   - the rail alone (the panel closed with its ×, ⌘⇧L or the preview's split
 *     button): clicking a category opens the panel on it;
 *   - the picture alone (`railHidden`, ⌘⇧B): the most room. ⌘⇧B again, a
 *     category shortcut (⌘1–5) or the split button bring the rail back.
 *
 * The picture is always on the right and the panel (with the rail) on its
 * left, on desktop and tablet alike: there's no setting to swap them (the
 * Play audit's user decision, 2026-10-18). The panel takes about a third of
 * the width by default (DEFAULT_SPLIT.ratio) and the divider still resizes it.
 *
 * On, ratio, the page, each category's last page and railHidden are
 * remembered on this device. Saves from before the one model (a full sidebar
 * beside the panel, a tab-strip panel) open on the rail, on the page the
 * panel showed (parseSplitPrefs).
 */
import { create } from 'zustand';
import { usePlayUi } from './playUi';
import { categoryOf, currentRailPage, firstPageOf, isRailPage, type RailCategory, type RailPage } from './railPages';
import { useInputsBoard } from './inputs/InputsBoard';
import type { TriggerSpec } from '../../types/play';

export interface SplitPrefs {
  /** The panel is open beside the rail (off: the rail alone). */
  on: boolean;
  /** The panel's share of the preview area (the rail included), 0..1. */
  ratio: number;
  /** The page the panel shows (and a phone shows under the picture). */
  railPage: RailPage;
  /** The page last shown for each category, so opening a category from the rail goes back to it (railPage stays the single source of truth for what's shown). */
  railPageMemory: Partial<Record<RailCategory, RailPage>>;
  /** The picture alone: the rail (and the panel) hidden for the most room (⌘⇧B). */
  railHidden: boolean;
}

export const SPLIT_KEY = 'shader-studio:play:split';
/** The panel's share by default: about a third, so the picture gets most of the width. */
export const DEFAULT_RATIO = 0.35;
/** The Play page opens with the rail and the panel, on Controls. */
export const DEFAULT_SPLIT: SplitPrefs = { on: true, ratio: DEFAULT_RATIO, railPage: 'controls', railPageMemory: {}, railHidden: false };
/**
 * Bumped when the saved shape changes. Saves from before 2 take the default
 * for `on` once (the rail became the default); saves from before 3 take the
 * default ratio once (measured with the panel right of the picture). Saves
 * from before 4 had a sidebar mode (`sidebar`: full, rail or hidden) and a
 * tab-strip panel (`tab`): they open on the rail, on the page the panel was
 * showing (the rail's own page, or the tab's), with the rail's ratio when it
 * was out.
 */
export const SPLIT_PREFS_VERSION = 4;
/** The rail's width, in px. */
export const RAIL_PX = 60;
/** The ratio is kept within these, whatever the pixels say. */
export const RATIO_MIN = 0.2;
export const RATIO_MAX = 0.7;
/** The smallest the picture and the panel get, in px (as long as the area has room for both). */
export const MIN_CANVAS_PX = 320;
export const MIN_PANEL_PX = 300;
/** From this width the panel lays its section out wide: a grid of cards, the layer list beside its editor. */
export const WIDE_PANEL_PX = 640;

/** A tab of the old tab-strip panel (before SPLIT_PREFS_VERSION 4), as the page it showed. */
const LEGACY_TAB_PAGE: Readonly<Record<string, RailPage>> = {
  controls: 'controls', mappings: 'controls', layers: 'layers', finish: 'finish-picture', engine: 'engine-performance',
};

/** Remembered prefs from storage text; anything missing or odd falls back to the default. */
export function parseSplitPrefs(raw: string | null): SplitPrefs {
  if (!raw) return { ...DEFAULT_SPLIT };
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { ...DEFAULT_SPLIT }; }
  if (!v || typeof v !== 'object') return { ...DEFAULT_SPLIT };
  const o = v as Record<string, unknown>;
  const ver = typeof o.v === 'number' ? o.v : 1;
  const onKept = ver >= 2;
  const ratiosKept = ver >= 3;
  const oneModel = ver >= 4;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  // Before the one model, the rail had a ratio of its own; the tab-strip panel (beside a full or no sidebar) another.
  const wasRail = !oneModel && o.sidebar === 'rail';
  const savedRatio = ratiosKept ? (wasRail ? num(o.railRatio) ?? num(o.ratio) : num(o.ratio)) : null;
  const savedPage = (() => { const pg = currentRailPage(o.railPage); return isRailPage(pg) ? pg : null; })();
  const railPage = oneModel || wasRail || !onKept
    ? savedPage ?? DEFAULT_SPLIT.railPage
    : LEGACY_TAB_PAGE[typeof o.tab === 'string' ? o.tab : ''] ?? savedPage ?? DEFAULT_SPLIT.railPage;
  return {
    on: onKept && typeof o.on === 'boolean' ? o.on : DEFAULT_SPLIT.on,
    ratio: savedRatio !== null ? clampRatio(savedRatio) : DEFAULT_SPLIT.ratio,
    railPage,
    railPageMemory: parseRailPageMemory(o.railPageMemory),
    railHidden: oneModel && o.railHidden === true,
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

/** The panel's share for a pointer at `x` over an area `rect` (the panel on the left, the picture on the right). */
export function ratioAt(rect: { left: number; width: number }, x: number): number {
  const total = rect.width;
  if (total <= 0) return DEFAULT_RATIO;
  return clampRatio((x - rect.left) / total, total);
}

function loadPrefs(): SplitPrefs {
  try { return parseSplitPrefs(localStorage.getItem(SPLIT_KEY)); } catch { return { ...DEFAULT_SPLIT }; }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function savePrefs(p: SplitPrefs): void {
  try {
    localStorage.setItem(SPLIT_KEY, JSON.stringify({
      v: SPLIT_PREFS_VERSION, on: p.on, ratio: round3(p.ratio),
      railPage: p.railPage, railPageMemory: p.railPageMemory, railHidden: p.railHidden,
    }));
  } catch { /* preference only */ }
}

interface PlaySplit extends SplitPrefs {
  /** A split area is on screen (the Play page, not on a phone): the toggle and its shortcut work. */
  available: boolean;
  setAvailable: (on: boolean) => void;
  /** The panel's body, where PlayPage renders the page. */
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  /** The panel is at least WIDE_PANEL_PX across. */
  wide: boolean;
  setWide: (wide: boolean) => void;
  /** ⌘⇧L, the preview's split button: the panel open or closed (the rail stays; a hidden rail comes back). */
  toggle: () => void;
  setOn: (on: boolean) => void;
  setRatio: (ratio: number) => void;
  /** ⌘⇧B: the picture alone, or the rail (and the panel, if it was open) back. */
  toggleRail: () => void;
  /** Show a page (in the panel, or a phone's). Remembers it as that page's category's last page. */
  setRailPage: (page: RailPage) => void;
  /** A rail category was clicked: its remembered page, else its first, with the panel open. */
  openRailCategory: (cat: RailCategory) => void;
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
    toggle: () => { const s = get(); save(s.railHidden ? { on: true, railHidden: false } : { on: !s.on }); },
    setOn: on => save(on ? { on, railHidden: false } : { on }),
    setRatio: ratio => save({ ratio: clampRatio(ratio) }),
    toggleRail: () => save({ railHidden: !get().railHidden }),
    setRailPage: railPage => save({ railPage, railPageMemory: { ...get().railPageMemory, [categoryOf(railPage)]: railPage } }),
    openRailCategory: cat => { get().setRailPage(get().railPageMemory[cat] ?? firstPageOf(cat)); get().setOn(true); },
  };
});

/** The page the panel shows, or null when there's no panel on screen (closed, the rail hidden, or not on Play). */
export const useBigPage = (): RailPage | null => usePlaySplit(s => (s.on && !s.railHidden && s.available && s.host ? s.railPage : null));

/**
 * Show a page wherever pages show: the panel (opened if it's closed or the
 * rail is hidden), or a phone's page under the picture.
 */
export function showPage(page: RailPage): void {
  const split = usePlaySplit.getState();
  split.setRailPage(page);
  if (split.available && (!split.on || split.railHidden)) split.setOn(true);
}

/**
 * The Sources side of the Controls page, wherever pages show: the Controls
 * page, with its narrow board (or a phone's switch) on Sources. ⌘⇧M; also for
 * reaching it from anywhere else on the Play page ("Show" on a toast).
 */
export function goToMappings(): boolean {
  showPage('controls');
  useInputsBoard.getState().setTab('sources');
  return true;
}

/** Open the Rules page on Quick rule, with its When (or its Do's layer) filled in. */
export function startRule(pre: { when?: TriggerSpec; layerId?: string } = {}): void {
  usePlayUi.getState().askQuickRule(pre);
  showPage('signals');
}

/**
 * Show the Rules page with one signal or reaction selected (a signal just
 * made from a slider's +, say).
 */
export function goToSignal(id: string): void {
  usePlayUi.getState().focusSignal(id);
  showPage('signals');
}

/**
 * Open a rail category on the page it was last left on (else its first) —
 * the keyboard's own way in (⌘1–5 or ⌃1–5: App.tsx), same as clicking its
 * rail icon. True when a panel shows it (false on phones, where the page
 * under the picture changes all the same).
 */
export function goToRailCategory(cat: RailCategory): boolean {
  showPage(usePlaySplit.getState().railPageMemory[cat] ?? firstPageOf(cat));
  return usePlaySplit.getState().available;
}

/**
 * Open a layer's full editor in the panel: the panel open on Layers, the
 * layer selected (a big editor like the drum pads' only shows in full
 * there). False when there's no panel on screen (phones), for the caller to
 * show it another way.
 */
export function openLayerInSplit(layerId: string): boolean {
  const split = usePlaySplit.getState();
  if (!split.available) return false;
  showPage('layers');
  usePlayUi.getState().select(layerId);
  return true;
}

/**
 * Follow what asks for a place (playUi's reveals): a layer revealed (clicked
 * on the picture, a note's link, a control's source), a Finish or sound
 * effect, a control group. The page moves there (and the panel opens).
 * Started once, below; returns the unsubscribe (for tests).
 */
export function followReveals(): () => void {
  let prev = usePlayUi.getState();
  return usePlayUi.subscribe(ui => {
    const was = prev;
    prev = ui;
    if (ui.revealTick !== was.revealTick) showPage('layers');
    else if (ui.finishTick !== was.finishTick) showPage(ui.finishView === 'sound' ? 'finish-sound' : 'finish-picture');
    else if (ui.controlGroupTick !== was.controlGroupTick) showPage('controls');
  });
}
followReveals();
