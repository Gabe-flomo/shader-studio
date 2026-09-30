/** The Play split view's prefs and layout (playSplit.ts): parsed safely, clamped, remembered, and the sidebar never doubles the panel. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  return m;
});
import { DEFAULT_SPLIT, MIN_CANVAS_PX, MIN_PANEL_PX, RATIO_MAX, RATIO_MIN, SPLIT_KEY, clampRatio, parseSplitPrefs, ratioAt, sidebarView, usePlaySplit } from '../playSplit';
import { DEFAULT_ACTIONS, findShortcut, normaliseCombo, type ShortcutMap } from '../../../hooks/useShortcuts';

describe('split prefs', () => {
  it('fall back to the defaults for nothing, junk or odd values', () => {
    expect(parseSplitPrefs(null)).toEqual(DEFAULT_SPLIT);
    expect(parseSplitPrefs('not json')).toEqual(DEFAULT_SPLIT);
    expect(parseSplitPrefs('42')).toEqual(DEFAULT_SPLIT);
    expect(parseSplitPrefs(JSON.stringify({ on: 'yes', side: 'diagonal', ratio: 'half', tab: 'notes', sidebarHidden: 1 }))).toEqual(DEFAULT_SPLIT);
  });

  it('keep what was saved, with the ratio in range', () => {
    expect(parseSplitPrefs(JSON.stringify({ v: 2, on: true, side: 'bottom', ratio: 0.35, tab: 'layers', sidebar: 'rail', sidebarBefore: 'hidden', railPage: 'finish-sound', railRatio: 0.6 })))
      .toEqual({ on: true, side: 'bottom', ratio: 0.35, tab: 'layers', sidebar: 'rail', sidebarBefore: 'hidden', railPage: 'finish-sound', railRatio: 0.6, railPageMemory: {} });
    // Only entries naming a real page under the category they claim survive.
    expect(parseSplitPrefs(JSON.stringify({ v: 2, railPageMemory: { layers: 'background', finish: 'layers', mappings: 'nope' } })).railPageMemory).toEqual({ layers: 'background' });
    // Signals left Layers for a category of its own (2026-09-30), taking the old Actions page with it.
    expect(parseSplitPrefs(JSON.stringify({ v: 2, railPageMemory: { layers: 'signals' } })).railPageMemory).toEqual({ signals: 'signals' });
    expect(parseSplitPrefs(JSON.stringify({ v: 2, railPage: 'actions' })).railPage).toBe('signals');
    // A save from before Controls and Mappings merged (2026-09-28) still has a `mappings` key: its pages now live under `controls`.
    expect(parseSplitPrefs(JSON.stringify({ v: 2, railPageMemory: { mappings: 'midi-file', layers: 'actions' } })).railPageMemory).toEqual({ controls: 'midi-file', signals: 'signals' });
    // A current save keeps a hidden sidebar (and the pre-rail `sidebarHidden` spelling).
    expect(parseSplitPrefs(JSON.stringify({ v: 2, on: true, sidebarHidden: true })).sidebar).toBe('hidden');
    expect(parseSplitPrefs(JSON.stringify({ v: 2, on: false, sidebar: 'full' })).on).toBe(false);
    // Saved before the rail became the default: opens split with the rail, keeps the rest.
    expect(parseSplitPrefs(JSON.stringify({ on: false, side: 'bottom', sidebar: 'hidden', railPage: 'mappings' }))).toMatchObject({ on: true, sidebar: 'rail', side: 'bottom', railPage: 'mappings' });
    expect(parseSplitPrefs(JSON.stringify({ v: 2, sidebar: 'drawer', railPage: 'nope', railRatio: 'x' }))).toMatchObject({ sidebar: 'rail', railPage: 'controls', railRatio: null });
    expect(parseSplitPrefs(JSON.stringify({ ratio: 0.99 })).ratio).toBe(RATIO_MAX);
    expect(parseSplitPrefs(JSON.stringify({ ratio: -3 })).ratio).toBe(RATIO_MIN);
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

  it('follows the pointer from whichever side the panel is on', () => {
    const rect = { left: 100, top: 50, width: 1000, height: 800 };
    expect(ratioAt('right', rect, 700, 0)).toBeCloseTo(0.4);
    expect(ratioAt('left', rect, 700, 0)).toBeCloseTo(0.6);
    expect(ratioAt('top', rect, 0, 50 + 320)).toBeCloseTo(0.4);
    expect(ratioAt('bottom', rect, 0, 50 + 320)).toBeCloseTo(0.6);
    // Past the edge: clamped.
    expect(ratioAt('right', rect, 5000, 0)).toBeCloseTo(MIN_PANEL_PX / 1000);
  });
});

describe('sidebar beside the big panel', () => {
  it('is unchanged without a split', () => {
    expect(sidebarView('controls', null)).toEqual({ tab: 'controls', tabs: ['controls', 'layers', 'finish', 'engine'], drawer: true });
    expect(sidebarView('layers', null)).toEqual({ tab: 'layers', tabs: ['controls', 'layers', 'finish', 'engine'], drawer: true });
    expect(sidebarView('finish', null)).toEqual({ tab: 'finish', tabs: ['controls', 'layers', 'finish', 'engine'], drawer: true });
    // Desktop has no Mappings tab (it's the drawer): Controls shows.
    expect(sidebarView('mappings', null).tab).toBe('controls');
  });

  it('never shows what the panel shows', () => {
    expect(sidebarView('controls', 'controls')).toEqual({ tab: 'layers', tabs: ['layers', 'finish', 'engine'], drawer: true });
    expect(sidebarView('layers', 'layers')).toEqual({ tab: 'controls', tabs: ['controls', 'finish', 'engine'], drawer: true });
    expect(sidebarView('finish', 'finish')).toEqual({ tab: 'controls', tabs: ['controls', 'layers', 'engine'], drawer: true });
    expect(sidebarView('finish', 'layers')).toEqual({ tab: 'finish', tabs: ['controls', 'finish', 'engine'], drawer: true });
    expect(sidebarView('engine', 'engine')).toEqual({ tab: 'controls', tabs: ['controls', 'layers', 'finish'], drawer: true });
    expect(sidebarView('engine', null).tab).toBe('engine');
    expect(sidebarView('layers', 'mappings')).toEqual({ tab: 'layers', tabs: ['controls', 'layers', 'finish', 'engine'], drawer: false });
  });
});

describe('split store', () => {
  beforeEach(() => store.clear());

  it('remembers on, side, ratio, tab and the hidden sidebar', () => {
    const s = usePlaySplit.getState();
    s.setOn(true); s.setSide('left'); s.setRatio(0.3333); s.setTab('mappings'); s.setSidebar('hidden');
    expect(parseSplitPrefs(store.get(SPLIT_KEY) ?? null)).toMatchObject({ on: true, side: 'left', ratio: 0.333, tab: 'mappings', sidebar: 'hidden' });
    s.toggle();
    expect(usePlaySplit.getState().on).toBe(false);
    expect(parseSplitPrefs(store.get(SPLIT_KEY) ?? null).on).toBe(false);
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
