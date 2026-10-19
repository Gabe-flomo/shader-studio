/**
 * The Play page's one navigation model (docs/split-view.md, "Rail and pages";
 * Play audit P1): the category → pages model, the rail's state (remembered),
 * and pages routed into the panel, the same page state on a phone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  return m;
});
import {
  RAIL_CATEGORIES, RAIL_CATEGORY_SHORTCUT, RAIL_PAGES, RAIL_PAGE_IDS, categoryBadge, categoryOf, currentRailPage, firstPageOf, isRailPage, mappingsCountOf, pageCount, phonePageFor, phonePagesOf, stepIndex,
} from '../railPages';
import { DEFAULT_SPLIT, SPLIT_KEY, goToMappings, goToRailCategory, openLayerInSplit, parseSplitPrefs, showPage, usePlaySplit } from '../playSplit';
import { usePlayUi } from '../playUi';
import { useInputsBoard } from '../inputs/InputsBoard';
import * as playUiModule from '../playUi';
import { DEFAULT_ACTIONS, findShortcut, normaliseCombo, type ShortcutMap } from '../../../hooks/useShortcuts';
import { emptyPlayRecord, type PlayRecord } from '../../../types/play';

describe('categories and pages', () => {
  it('every page is in exactly one category, the one it names', () => {
    const listed = RAIL_CATEGORIES.flatMap(c => c.pages.map(p => [c.id, p] as const));
    expect(listed.map(([, p]) => p).sort()).toEqual([...RAIL_PAGE_IDS].sort());
    for (const [cat, page] of listed) expect(categoryOf(page)).toBe(cat);
    // Controls and Mappings are one rail category (the owner's call, 2026-09-28): they're so closely related.
    // Rules is a category of its own (Signals until the implementation guide's phase 3; the id stays).
    // The Play audit (2026-10-18, P18): Controls, Layers, Rules, Finish, Sound — the order ⌘1–5 follow.
    expect(RAIL_CATEGORIES.map(c => c.id)).toEqual(['controls', 'layers', 'signals', 'finish', 'engine']);
  });

  it('gives each category the pages the owner listed', () => {
    const pages = Object.fromEntries(RAIL_CATEGORIES.map(c => [c.id, c.pages.map(p => RAIL_PAGES[p].label)]));
    expect(pages).toEqual({
      controls: ['Controls', 'MIDI file', 'Pad grid'],
      signals: ['Rules'],
      // The Background is the Layers list's pinned first row, not a page of its own (P13).
      layers: ['Layers'],
      finish: ['Picture'],
      engine: ['Arrangement', 'Effects'],
    });
    for (const p of RAIL_PAGE_IDS) expect(RAIL_PAGES[p].description.length).toBeGreaterThan(10);
  });

  it('has one set of pages: no tab-strip union beside the rail’s (P1); old page ids map onto today’s', () => {
    expect(playUiModule).not.toHaveProperty('tabForPage');
    expect(usePlayUi.getState()).not.toHaveProperty('tab');
    expect(usePlayUi.getState()).not.toHaveProperty('phonePage');
    expect(usePlayUi.getState()).not.toHaveProperty('panel');
    expect(firstPageOf('controls')).toBe('controls');
    expect(currentRailPage('mappings')).toBe('controls');
    expect(currentRailPage('background')).toBe('layers');
    expect(isRailPage('background')).toBe(false);
    expect(isRailPage('pad-grid')).toBe(true);
    expect(isRailPage('notes')).toBe(false);
    expect(isRailPage('toString')).toBe(false);
  });

  it('counts what a page holds, and badges only layers and controls (the controls count, not mappings’)', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), actions: [{ id: 'a', trigger: { on: 'key', code: 'Space' }, do: 'show', layerId: 'l', amount: 1, enabled: true }], signals: [{ id: 's', name: 'Hit' }, { id: 't', name: 'Go' }] };
    // Rules: each signal is one, and actions read as rules (actions sharing a trigger share one).
    expect(pageCount('signals', play)).toBe(3);
    expect(pageCount('midi-file', play)).toBeUndefined();
    expect(categoryBadge('layers', play)).toBeUndefined();
    const withMappingsOnly: PlayRecord = { ...play, mappings: [{ id: 'm', controlId: 'c', source: { kind: 'key', code: 'KeyA' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] };
    expect(categoryBadge('controls', withMappingsOnly)).toBeUndefined(); // No controls yet, so no badge — even with a mapping.
    expect(mappingsCountOf(withMappingsOnly)).toBe(1);
    expect(categoryBadge('controls', { ...play, controls: [{ id: 'c', target: 'n::k', kind: 'float', label: 'K', min: 0, max: 1 }] })).toBe(1);
  });

  it('⌘1–5 open the rail categories in the rail’s own order, matching useShortcuts.ts', () => {
    expect(RAIL_CATEGORY_SHORTCUT).toEqual({ controls: 'cmd+1', layers: 'cmd+2', signals: 'cmd+3', finish: 'cmd+4', engine: 'cmd+5' });
    // Top to bottom on the rail is ⌘1, ⌘2, … (P18).
    expect(RAIL_CATEGORIES.map(c => RAIL_CATEGORY_SHORTCUT[c.id])).toEqual(['cmd+1', 'cmd+2', 'cmd+3', 'cmd+4', 'cmd+5']);
    const map: ShortcutMap = Object.fromEntries(DEFAULT_ACTIONS.map(a => [a.id, a.defaultCombo]));
    expect(findShortcut(map, 'cmd+1')).toBe('railControls');
    expect(findShortcut(map, 'cmd+2')).toBe('railLayers');
    expect(findShortcut(map, 'cmd+3')).toBe('railSignals');
    expect(findShortcut(map, 'cmd+4')).toBe('railFinish');
    expect(findShortcut(map, 'cmd+5')).toBe('railEngine');
    for (const cat of RAIL_CATEGORIES.map(c => c.id)) {
      expect(map[`rail${cat[0].toUpperCase()}${cat.slice(1)}`]).toBe(RAIL_CATEGORY_SHORTCUT[cat]);
    }
  });

  it('goToRailCategory opens the panel (if closed, or the rail hidden) on the category’s remembered page, else its first', () => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, on: false, available: true, railPageMemory: {} });
    expect(goToRailCategory('layers')).toBe(true);
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railPage: 'layers' });
    usePlaySplit.getState().setRailPage('finish-sound');
    usePlaySplit.setState({ railHidden: true });
    expect(goToRailCategory('engine')).toBe(true);
    expect(usePlaySplit.getState()).toMatchObject({ railPage: 'finish-sound', railHidden: false, on: true });
    expect(goToRailCategory('signals')).toBe(true);
    expect(usePlaySplit.getState().railPage).toBe('signals');
    // A phone (no panel on screen): its page under the picture changes all the same.
    usePlaySplit.setState({ available: false });
    expect(goToRailCategory('engine')).toBe(false);
    expect(usePlaySplit.getState().railPage).toBe('finish-sound');
  });

  it('moves through a list with the arrows, wrapping', () => {
    expect(stepIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(stepIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(stepIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(stepIndex(1, 'Home', 3)).toBe(0);
    expect(stepIndex(1, 'End', 3)).toBe(2);
    expect(stepIndex(1, 'a', 3)).toBe(1);
    expect(stepIndex(0, 'ArrowDown', 0)).toBe(-1);
  });

  it('on a phone, shows the rail’s page, unless a phone keeps it elsewhere (the MIDI file and pad grid are in Sources)', () => {
    expect(phonePageFor('signals')).toBe('signals');
    expect(phonePageFor('finish-sound')).toBe('finish-sound');
    expect(phonePageFor('midi-file')).toBe('controls');
    expect(phonePageFor('pad-grid')).toBe('controls');
    // No Arrangement on a phone (2026-10-18): Sound is its one page.
    expect(phonePageFor('engine-performance')).toBe('finish-sound');
  });
  it('the phone’s bottom row goes straight to every page, Sound included (Play audit P20; no Arrangement on a phone)', () => {
    expect(phonePagesOf('controls')).toEqual(['controls']);
    expect(phonePagesOf('layers')).toEqual(['layers']);
    expect(phonePagesOf('signals')).toEqual(['signals']);
    expect(phonePagesOf('engine')).toEqual(['finish-sound']);
    // Desktop keeps both of Sound's pages.
    expect(RAIL_CATEGORIES.find(c => c.id === 'engine')!.pages).toEqual(['engine-performance', 'finish-sound']);
  });

  it('a phone shows the same page state as the panel (one model): showPage moves both', () => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, available: false });
    showPage('finish-sound');
    expect(usePlaySplit.getState().railPage).toBe('finish-sound');
    usePlayUi.getState().reveal('l1');
    expect(usePlaySplit.getState().railPage).toBe('layers');
  });
});

describe('the rail’s state', () => {
  beforeEach(() => {
    store.clear();
    usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true });
  });

  it('opening a category from the rail goes straight to its remembered page, else its first, opening the panel', () => {
    const st = usePlaySplit.getState();
    st.openRailCategory('layers');
    expect(usePlaySplit.getState().railPage).toBe('layers');
    st.setRailPage('finish-sound');
    st.openRailCategory('controls');
    expect(usePlaySplit.getState().railPage).toBe('controls');
    // Coming back to Sound: the page it was left on, not its first.
    usePlaySplit.getState().setOn(false);
    st.openRailCategory('engine');
    expect(usePlaySplit.getState()).toMatchObject({ railPage: 'finish-sound', on: true });
    // Remembered across a reload.
    expect(parseSplitPrefs(store.get(SPLIT_KEY) ?? null).railPageMemory).toMatchObject({ engine: 'finish-sound', controls: 'controls', layers: 'layers' });
  });

  it('Mappings is always reachable: ⌘⇧M opens the panel (if closed) on the Controls page’s Sources', () => {
    usePlaySplit.setState({ on: false, railPage: 'layers' });
    useInputsBoard.setState({ tab: 'controls' });
    expect(goToMappings()).toBe(true);
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railPage: 'controls' });
    expect(useInputsBoard.getState().tab).toBe('sources');
    // A phone: its Controls page, on Sources.
    usePlaySplit.setState({ available: false, railPage: 'signals' });
    useInputsBoard.setState({ tab: 'controls' });
    expect(goToMappings()).toBe(true);
    expect(usePlaySplit.getState().railPage).toBe('controls');
    expect(useInputsBoard.getState().tab).toBe('sources');
  });

  it('⌘⇧B hides the rail (the picture alone) and brings it back', () => {
    usePlaySplit.getState().toggleRail();
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railHidden: true });
    usePlaySplit.getState().toggleRail();
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railHidden: false });
  });

  it('is ⌘⇧B, clashing with no other default; Mappings is ⌘⇧M', () => {
    const map: ShortcutMap = Object.fromEntries(DEFAULT_ACTIONS.map(a => [a.id, a.defaultCombo]));
    expect(findShortcut(map, 'shift+cmd+b')).toBe('playRail');
    expect(findShortcut(map, 'shift+cmd+m')).toBe('gotoMappings');
    const combos = DEFAULT_ACTIONS.map(a => normaliseCombo(a.defaultCombo));
    expect(new Set(combos).size).toBe(combos.length);
  });
});

describe('pages into the panel', () => {
  beforeEach(() => {
    store.clear();
    usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true });
  });

  it('shows a page in the panel, opening it if closed or the rail is hidden', () => {
    showPage('pad-grid');
    expect(usePlaySplit.getState().railPage).toBe('pad-grid');
    usePlaySplit.setState({ on: false });
    showPage('finish-sound');
    expect(usePlaySplit.getState()).toMatchObject({ railPage: 'finish-sound', on: true });
    usePlaySplit.setState({ railHidden: true });
    showPage('signals');
    expect(usePlaySplit.getState()).toMatchObject({ railPage: 'signals', railHidden: false });
  });

  it('opens a layer’s full editor on the Layers page', () => {
    usePlaySplit.setState({ railPage: 'pad-grid', on: false });
    expect(openLayerInSplit('l9')).toBe(true);
    expect(usePlaySplit.getState()).toMatchObject({ railPage: 'layers', on: true });
    expect(usePlayUi.getState().selected).toBe('l9');
    usePlaySplit.setState({ available: false });
    expect(openLayerInSplit('l9')).toBe(false);
  });

  it('follows reveals, always (a layer clicked on the picture, a Finish effect, a control group)', () => {
    usePlaySplit.setState({ railPage: 'pad-grid', on: false });
    usePlayUi.getState().reveal('l1');
    expect(usePlaySplit.getState()).toMatchObject({ railPage: 'layers', on: true });
    usePlayUi.getState().revealAudioFx('fx1');
    expect(usePlaySplit.getState().railPage).toBe('finish-sound');
    usePlayUi.getState().revealFinish('fx2');
    expect(usePlaySplit.getState().railPage).toBe('finish-picture');
    usePlayUi.getState().revealControlGroup('Live');
    expect(usePlaySplit.getState().railPage).toBe('controls');
  });
});
