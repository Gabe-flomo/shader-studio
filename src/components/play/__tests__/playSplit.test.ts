/** The Play page's one navigation model's prefs (playSplit.ts): parsed safely, clamped, remembered, and older saves (a full sidebar, a tab-strip panel) migrated onto the rail. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  return m;
});
import { DEFAULT_RATIO, DEFAULT_SPLIT, MIN_CANVAS_PX, MIN_PANEL_PX, RATIO_MAX, RATIO_MIN, SPLIT_KEY, SPLIT_PREFS_VERSION, clampRatio, parseSplitPrefs, ratioAt, usePlaySplit } from '../playSplit';
import { DEFAULT_ACTIONS, findShortcut, normaliseCombo, type ShortcutMap } from '../../../hooks/useShortcuts';

describe('split prefs', () => {
  it('fall back to the defaults for nothing, junk or odd values', () => {
    expect(parseSplitPrefs(null)).toEqual(DEFAULT_SPLIT);
    expect(parseSplitPrefs('not json')).toEqual(DEFAULT_SPLIT);
    expect(parseSplitPrefs('42')).toEqual(DEFAULT_SPLIT);
    expect(parseSplitPrefs(JSON.stringify({ on: 'yes', side: 'diagonal', ratio: 'half', tab: 'notes', sidebarHidden: 1 }))).toEqual(DEFAULT_SPLIT);
  });

  it('keep what was saved, with the ratio in range', () => {
    expect(parseSplitPrefs(JSON.stringify({ v: 4, on: false, ratio: 0.45, railPage: 'finish-sound', railHidden: true, railPageMemory: { engine: 'finish-sound' } })))
      .toEqual({ on: false, ratio: 0.45, railPage: 'finish-sound', railHidden: true, railPageMemory: { engine: 'finish-sound' } });
    // Only entries naming a real page under the category they claim survive.
    expect(parseSplitPrefs(JSON.stringify({ v: 4, railPageMemory: { finish: 'layers', mappings: 'nope', engine: 'finish-sound' } })).railPageMemory).toEqual({ engine: 'finish-sound' });
    // Signals left Layers for a category of its own (2026-09-30), taking the old Actions page with it.
    expect(parseSplitPrefs(JSON.stringify({ v: 4, railPageMemory: { layers: 'signals' } })).railPageMemory).toEqual({ signals: 'signals' });
    expect(parseSplitPrefs(JSON.stringify({ v: 4, railPage: 'actions' })).railPage).toBe('signals');
    // A save from before Controls and Mappings merged (2026-09-28) still has a `mappings` key: its pages now live under `controls`.
    expect(parseSplitPrefs(JSON.stringify({ v: 4, railPageMemory: { mappings: 'midi-file', layers: 'actions' } })).railPageMemory).toEqual({ controls: 'midi-file', signals: 'signals' });
    // The Background page is the Layers list's pinned row now (P13): a save on it opens Layers.
    expect(parseSplitPrefs(JSON.stringify({ v: 4, railPage: 'background', railPageMemory: { layers: 'background' } }))).toMatchObject({ railPage: 'layers', railPageMemory: { layers: 'layers' } });
    expect(parseSplitPrefs(JSON.stringify({ v: 4, railPage: 'nope' })).railPage).toBe('controls');
    expect(parseSplitPrefs(JSON.stringify({ v: 4, ratio: 0.99 })).ratio).toBe(RATIO_MAX);
    expect(parseSplitPrefs(JSON.stringify({ v: 4, ratio: -3 })).ratio).toBe(RATIO_MIN);
  });

  it('give the panel about a third by default, so the picture gets most of the width', () => {
    expect(DEFAULT_RATIO).toBeCloseTo(0.35);
    expect(DEFAULT_SPLIT.ratio).toBe(DEFAULT_RATIO);
    // Resizable within sensible bounds, and the default sits inside them.
    expect(RATIO_MIN).toBeLessThan(DEFAULT_RATIO);
    expect(RATIO_MAX).toBeLessThanOrEqual(0.7);
    expect(clampRatio(DEFAULT_RATIO, 1440)).toBeCloseTo(0.35);
  });

  it('have one model: no sidebar mode, no tab strip, no side, no second ratio', () => {
    expect(SPLIT_PREFS_VERSION).toBe(4);
    const p = parseSplitPrefs(JSON.stringify({ v: 3, on: true, side: 'top', sidebar: 'full', sidebarBefore: 'hidden', tab: 'layers', ratio: 0.4, railRatio: 0.6 }));
    expect(Object.keys(p).sort()).toEqual(['on', 'railHidden', 'railPage', 'railPageMemory', 'ratio']);
    expect(Object.keys(DEFAULT_SPLIT).sort()).toEqual(['on', 'railHidden', 'railPage', 'railPageMemory', 'ratio']);
  });

  it('migrate the full sidebar (and the hidden one) onto the rail, on the page the panel was showing', () => {
    // "Sidebar beside the panel" with the panel on Layers: the rail, on Layers, the panel's ratio.
    expect(parseSplitPrefs(JSON.stringify({ v: 3, on: true, sidebar: 'full', tab: 'layers', ratio: 0.42, railPage: 'signals', railRatio: 0.6 })))
      .toEqual({ on: true, ratio: 0.42, railPage: 'layers', railPageMemory: {}, railHidden: false });
    // No sidebar beside a tab-strip panel on Sound: the rail too (not hidden: the rail is the panel's own navigation).
    expect(parseSplitPrefs(JSON.stringify({ v: 3, on: true, sidebar: 'hidden', tab: 'engine', ratio: 0.5 }))).toMatchObject({ railPage: 'engine-performance', railHidden: false, ratio: 0.5 });
    // The tab strip's Finish and Sources tabs.
    expect(parseSplitPrefs(JSON.stringify({ v: 3, sidebar: 'full', tab: 'finish' })).railPage).toBe('finish-picture');
    expect(parseSplitPrefs(JSON.stringify({ v: 3, sidebar: 'full', tab: 'mappings' })).railPage).toBe('controls');
    // The full sidebar with the panel closed: the rail alone, as it is now with the panel closed.
    expect(parseSplitPrefs(JSON.stringify({ v: 3, on: false, sidebar: 'full', tab: 'controls' }))).toMatchObject({ on: false, railHidden: false });
  });

  it('keep the rail’s page and its own ratio for a save that was already on the rail', () => {
    expect(parseSplitPrefs(JSON.stringify({ v: 3, on: true, sidebar: 'rail', tab: 'layers', ratio: 0.3, railPage: 'finish-sound', railRatio: 0.55, railPageMemory: { engine: 'finish-sound' } })))
      .toEqual({ on: true, ratio: 0.55, railPage: 'finish-sound', railPageMemory: { engine: 'finish-sound' }, railHidden: false });
    // No rail ratio of its own yet: the panel's.
    expect(parseSplitPrefs(JSON.stringify({ v: 3, sidebar: 'rail', ratio: 0.3, railRatio: null })).ratio).toBe(0.3);
  });

  it('migrate a save from before the picture moved right to the default ratio, and older ones onto the rail', () => {
    // v2: panel on the right at half and half.
    const old = parseSplitPrefs(JSON.stringify({ v: 2, on: false, side: 'right', ratio: 0.5, tab: 'finish', sidebar: 'hidden', railPage: 'layers', railRatio: 0.62 }));
    expect(old).toMatchObject({ on: false, ratio: DEFAULT_RATIO, railPage: 'finish-picture' });
    expect(old).not.toHaveProperty('side');
    // Older still (no version): the default ratio, open, on the rail's saved page.
    expect(parseSplitPrefs(JSON.stringify({ side: 'top', ratio: 0.7, railRatio: 0.3, on: false, railPage: 'mappings' }))).toMatchObject({ ratio: DEFAULT_RATIO, on: true, railPage: 'controls' });
  });

  it('save as the current version without a side', () => {
    store.clear();
    usePlaySplit.getState().setRatio(0.4);
    const saved = JSON.parse(store.get(SPLIT_KEY) ?? '{}');
    expect(saved.v).toBe(SPLIT_PREFS_VERSION);
    expect(saved).not.toHaveProperty('side');
    expect(parseSplitPrefs(store.get(SPLIT_KEY) ?? null).ratio).toBe(0.4);
  });
});

describe('split ratio', () => {
  it('stays between the bounds', () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0)).toBe(RATIO_MIN);
    expect(clampRatio(1)).toBe(RATIO_MAX);
    expect(clampRatio(NaN)).toBe(0.5);
  });

  it('leaves the picture and the panel their minimum sizes', () => {
    const total = 1000;
    expect(clampRatio(0.2, total)).toBeCloseTo(MIN_PANEL_PX / total);
    expect(clampRatio(0.8, total)).toBeCloseTo(Math.min(RATIO_MAX, 1 - MIN_CANVAS_PX / total));
    // Too small for both: half and half.
    expect(clampRatio(0.3, MIN_CANVAS_PX + MIN_PANEL_PX - 1)).toBe(0.5);
  });

  it('follows the pointer with the panel on the left of the picture', () => {
    const rect = { left: 100, width: 1000 };
    expect(ratioAt(rect, 450)).toBeCloseTo(0.35);
    expect(ratioAt(rect, 700)).toBeCloseTo(0.6);
    // Past either edge: clamped, so the panel and the picture keep their minimums.
    expect(ratioAt(rect, -5000)).toBeCloseTo(MIN_PANEL_PX / 1000);
    expect(ratioAt(rect, 5000)).toBeCloseTo(Math.min(RATIO_MAX, 1 - MIN_CANVAS_PX / 1000));
  });
});

describe('split store', () => {
  beforeEach(() => { store.clear(); usePlaySplit.setState({ ...DEFAULT_SPLIT }); });

  it('remembers on, ratio, the page and the hidden rail', () => {
    const s = usePlaySplit.getState();
    s.setOn(true); s.setRatio(0.3333); s.setRailPage('signals'); s.toggleRail();
    expect(parseSplitPrefs(store.get(SPLIT_KEY) ?? null)).toMatchObject({ on: true, ratio: 0.333, railPage: 'signals', railHidden: true, railPageMemory: { signals: 'signals' } });
    for (const gone of ['setSide', 'setSidebar', 'setTab', 'setRailRatio', 'sidebar', 'tab', 'railRatio']) expect(usePlaySplit.getState()).not.toHaveProperty(gone);
  });

  it('closes the panel to the rail alone, and the hidden rail (⌘⇧B) comes back with the split button or a category', () => {
    const s = usePlaySplit.getState();
    s.toggle();
    expect(usePlaySplit.getState()).toMatchObject({ on: false, railHidden: false });
    s.toggle();
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railHidden: false });
    s.toggleRail();
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railHidden: true });
    // The split button (⌘⇧L) brings the rail and the panel back.
    usePlaySplit.getState().toggle();
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railHidden: false });
    // ⌘⇧B twice: back as it was.
    usePlaySplit.getState().toggleRail(); usePlaySplit.getState().toggleRail();
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railHidden: false });
    // A category opens the panel, the rail with it.
    usePlaySplit.getState().setOn(false); usePlaySplit.getState().toggleRail();
    usePlaySplit.getState().openRailCategory('layers');
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railHidden: false, railPage: 'layers' });
    expect(parseSplitPrefs(store.get(SPLIT_KEY) ?? null)).toMatchObject({ on: true, railHidden: false, railPage: 'layers' });
  });
});

describe('split shortcut', () => {
  it('is ⌘⇧L and clashes with no other default', () => {
    const map: ShortcutMap = Object.fromEntries(DEFAULT_ACTIONS.map(a => [a.id, a.defaultCombo]));
    expect(findShortcut(map, 'shift+cmd+l')).toBe('playSplit');
    const combos = DEFAULT_ACTIONS.map(a => normaliseCombo(a.defaultCombo));
    expect(new Set(combos).size).toBe(combos.length);
  });
});
