/**
 * The split view's rail (docs/split-view.md, "Rail and full-width pages"):
 * the category → pages model, the rail's state (toggle, remember, restore
 * exactly), and pages routed into the panel.
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
  RAIL_CATEGORIES, RAIL_PAGES, RAIL_PAGE_IDS, categoryBadge, categoryOf, firstPageOf, isRailPage, pageCount, pageForTab, phonePageShown, stepIndex,
} from '../railPages';
import { DEFAULT_SPLIT, SPLIT_KEY, goToMappings, openLayerInSplit, parseSplitPrefs, railRatioFor, setAreaMeasure, showPageInSplit, shownRatio, usePlaySplit } from '../playSplit';
import { followReveals } from '../PlaySplitArea';
import { usePlayUi } from '../playUi';
import { DEFAULT_ACTIONS, findShortcut, normaliseCombo, type ShortcutMap } from '../../../hooks/useShortcuts';
import { emptyPlayRecord, type PlayRecord } from '../../../types/play';

describe('categories and pages', () => {
  it('every page is in exactly one category, the one it names', () => {
    const listed = RAIL_CATEGORIES.flatMap(c => c.pages.map(p => [c.id, p] as const));
    expect(listed.map(([, p]) => p).sort()).toEqual([...RAIL_PAGE_IDS].sort());
    for (const [cat, page] of listed) expect(categoryOf(page)).toBe(cat);
    expect(RAIL_CATEGORIES.map(c => c.id)).toEqual(['controls', 'layers', 'finish', 'engine', 'mappings']);
  });

  it('gives each category the pages the owner listed', () => {
    const pages = Object.fromEntries(RAIL_CATEGORIES.map(c => [c.id, c.pages.map(p => RAIL_PAGES[p].label)]));
    expect(pages).toEqual({
      controls: ['Controls'],
      layers: ['Layers', 'Actions', 'Signals', 'Background'],
      finish: ['Picture', 'Sound'],
      engine: ['Arrangement'],
      mappings: ['Mappings', 'MIDI file', 'Pad grid'],
    });
    for (const p of RAIL_PAGE_IDS) expect(RAIL_PAGES[p].description.length).toBeGreaterThan(10);
  });

  it('starts the rail where the tab-strip panel was', () => {
    expect(pageForTab('controls')).toBe('controls');
    expect(pageForTab('layers')).toBe('layers');
    expect(pageForTab('finish', 'sound')).toBe('finish-sound');
    expect(pageForTab('finish')).toBe('finish-picture');
    expect(pageForTab('engine')).toBe('engine-performance');
    expect(pageForTab('mappings')).toBe('mappings');
    expect(firstPageOf('mappings')).toBe('mappings');
    expect(isRailPage('pad-grid')).toBe(true);
    expect(isRailPage('notes')).toBe(false);
    expect(isRailPage('toString')).toBe(false);
  });

  it('counts what a page holds, and badges only layers and mappings', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), actions: [{ id: 'a', trigger: { on: 'key', code: 'Space' }, do: 'show', layerId: 'l', amount: 1, enabled: true }], signals: [{ id: 's', name: 'Hit' }, { id: 't', name: 'Go' }] };
    expect(pageCount('actions', play)).toBe(1);
    expect(pageCount('signals', play)).toBe(2);
    expect(pageCount('midi-file', play)).toBeUndefined();
    expect(categoryBadge('layers', play)).toBeUndefined();
    expect(categoryBadge('mappings', { ...play, mappings: [{ id: 'm', controlId: 'c', source: { kind: 'key', code: 'KeyA' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] })).toBe(1);
    expect(categoryBadge('controls', { ...play, controls: [{ id: 'c', target: 'n::k', kind: 'float', label: 'K', min: 0, max: 1 }] })).toBeUndefined();
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

  it('on a phone, shows the picked page while its tab is open', () => {
    expect(phonePageShown('layers', 'picture', 'signals')).toBe('signals');
    expect(phonePageShown('controls', 'picture', 'signals')).toBe('controls');
    expect(phonePageShown('mappings', 'picture', '')).toBe('mappings');
    expect(phonePageShown('finish', 'sound', 'finish-picture')).toBe('finish-sound');
  });

  it('a phone page opens its tab; setTab and reveals go back to the tab’s own', () => {
    const ui = usePlayUi.getState();
    ui.showPage('pad-grid');
    expect(usePlayUi.getState()).toMatchObject({ tab: 'mappings', phonePage: 'pad-grid' });
    ui.showPage('finish-sound');
    expect(usePlayUi.getState()).toMatchObject({ tab: 'finish', finishView: 'sound' });
    ui.showPage('actions');
    ui.reveal('l1');
    expect(usePlayUi.getState()).toMatchObject({ tab: 'layers', phonePage: '' });
    ui.showPage('background');
    ui.setTab('layers');
    expect(usePlayUi.getState().phonePage).toBe('');
    for (const p of RAIL_PAGE_IDS) { ui.showPage(p); expect(usePlayUi.getState().tab).toBe(categoryOf(p)); }
  });
});

describe('the rail’s state', () => {
  beforeEach(() => {
    store.clear();
    usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true });
    setAreaMeasure(null);
  });

  it('keeps the picture’s size: the panel takes the sidebar’s width', () => {
    // A 1000 px area, half each, beside a 460 px sidebar: the picture stays 500 px of 1460.
    expect(railRatioFor('right', 0.5, 1000, 460)).toBeCloseTo(960 / 1460);
    expect(railRatioFor('left', 0.3, 1000, 460)).toBeCloseTo(760 / 1460);
    // Above or below, the area only gets wider: the share stays.
    expect(railRatioFor('top', 0.4, 800, 460)).toBe(0.4);
    // Nothing to give.
    expect(railRatioFor('right', 0.5, 1000, 0)).toBe(0.5);
  });

  it('opening the rail starts on the panel’s page, measures, and leaves the sidebar’s layout alone', () => {
    usePlaySplit.setState({ tab: 'finish', ratio: 0.5, sidebar: 'full' });
    usePlayUi.setState({ finishView: 'sound' });
    setAreaMeasure(() => ({ total: 1000, sidebarPx: 460 }));
    usePlaySplit.getState().setSidebar('rail');
    const s = usePlaySplit.getState();
    expect(s.sidebar).toBe('rail');
    expect(s.railPage).toBe('finish-sound');
    expect(s.railRatio).toBeCloseTo(960 / 1460, 2);
    expect(s.ratio).toBe(0.5);
    expect(shownRatio(s)).toBeCloseTo(960 / 1460, 2);
    // Remembered.
    expect(parseSplitPrefs(store.get(SPLIT_KEY) ?? null)).toMatchObject({ sidebar: 'rail', railPage: 'finish-sound', sidebarBefore: 'full' });
  });

  it('dragging in the rail moves only the rail’s share; leaving restores the sidebar and panel exactly', () => {
    usePlaySplit.setState({ tab: 'layers', ratio: 0.42, sidebar: 'full' });
    const st = usePlaySplit.getState();
    st.setSidebar('rail');
    st.setRailRatio(0.7);
    st.setRailPage('signals');
    expect(usePlaySplit.getState().ratio).toBe(0.42);
    st.toggleRail();
    const s = usePlaySplit.getState();
    expect(s.sidebar).toBe('full');
    expect(s.ratio).toBe(0.42);
    expect(s.tab).toBe('layers');
    expect(shownRatio(s)).toBe(0.42);
    // And back into the rail from a hidden sidebar: ⌘⇧B returns to hidden.
    st.setSidebar('hidden');
    st.toggleRail();
    expect(usePlaySplit.getState().sidebar).toBe('rail');
    st.toggleRail();
    expect(usePlaySplit.getState().sidebar).toBe('hidden');
  });

  it('opening a category from the rail goes straight to its remembered page, else its first', () => {
    const st = usePlaySplit.getState();
    st.setSidebar('rail');
    st.openRailCategory('layers');
    expect(usePlaySplit.getState().railPage).toBe('layers');
    st.setRailPage('signals');
    st.openRailCategory('controls');
    expect(usePlaySplit.getState().railPage).toBe('controls');
    // Coming back to Layers: the page it was left on, not its first.
    st.openRailCategory('layers');
    expect(usePlaySplit.getState().railPage).toBe('signals');
    // Remembered across a reload.
    expect(parseSplitPrefs(store.get(SPLIT_KEY) ?? null).railPageMemory).toMatchObject({ layers: 'signals', controls: 'controls' });
  });

  it('Mappings is always reachable: ⌘⇧M opens the split (if closed) and shows it', () => {
    usePlaySplit.setState({ on: false, sidebar: 'rail', railPage: 'layers' });
    expect(goToMappings()).toBe(true);
    expect(usePlaySplit.getState()).toMatchObject({ on: true, railPage: 'mappings' });
    // From the tab-strip panel too.
    usePlaySplit.setState({ on: true, sidebar: 'full', tab: 'controls' });
    expect(goToMappings()).toBe(true);
    expect(usePlaySplit.getState().tab).toBe('mappings');
    // Unavailable (no split area on screen, e.g. a phone): nothing to do.
    usePlaySplit.setState({ available: false });
    expect(goToMappings()).toBe(false);
  });

  it('⌘⇧B with the split closed opens it with the rail out', () => {
    usePlaySplit.setState({ on: false, sidebar: 'full' });
    usePlaySplit.getState().toggleRail();
    expect(usePlaySplit.getState()).toMatchObject({ on: true, sidebar: 'rail' });
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

  it('shows a page in the rail’s panel, or the tab-strip panel’s section', () => {
    usePlaySplit.setState({ sidebar: 'rail' });
    showPageInSplit('pad-grid');
    expect(usePlaySplit.getState().railPage).toBe('pad-grid');
    usePlaySplit.setState({ sidebar: 'full', tab: 'controls' });
    showPageInSplit('finish-sound');
    expect(usePlaySplit.getState().tab).toBe('finish');
    expect(usePlayUi.getState().finishView).toBe('sound');
    expect(usePlaySplit.getState().railPage).toBe('pad-grid');
  });

  it('opens a layer’s full editor on the rail’s Layers page', () => {
    usePlaySplit.setState({ sidebar: 'rail', railPage: 'mappings', tab: 'controls' });
    expect(openLayerInSplit('l9')).toBe(true);
    expect(usePlaySplit.getState()).toMatchObject({ railPage: 'layers', tab: 'controls' });
    expect(usePlayUi.getState().selected).toBe('l9');
  });

  it('follows reveals while the rail is out (a layer clicked on the picture, a Finish effect, a control group)', () => {
    usePlaySplit.setState({ sidebar: 'rail', railPage: 'mappings' });
    const stop = followReveals();
    usePlayUi.getState().reveal('l1');
    expect(usePlaySplit.getState().railPage).toBe('layers');
    usePlayUi.getState().revealAudioFx('fx1');
    expect(usePlaySplit.getState().railPage).toBe('finish-sound');
    usePlayUi.getState().revealControlGroup('Live');
    expect(usePlaySplit.getState().railPage).toBe('controls');
    stop();
    usePlayUi.getState().reveal('l1');
    expect(usePlaySplit.getState().railPage).toBe('controls');
  });
});
