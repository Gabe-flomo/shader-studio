// @vitest-environment jsdom
/**
 * Play audit round 1, lane A (P4, P5, P14, P16): the Controls page's header
 * and filters, mappings folded to one line by default (remembered), state
 * reset when another graph opens, the built-in signals folded at the bottom,
 * an example named after itself, the presentation notice once per graph, and
 * the control card (no min/max editor, Driven by stacked, a trace only while
 * something drives it).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  class RO { observe() {} unobserve() {} disconnect() {} }
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  vi.stubGlobal('ResizeObserver', RO);
  vi.stubGlobal('IntersectionObserver', IO);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlayPage } from '../PlayPage';
import { DEFAULT_SPLIT, usePlaySplit } from '../playSplit';
import { usePlayUi } from '../playUi';
import { resetPlayPagesForNewGraph } from '../resetOnGraphLoad';
import { boardFiltersShown, filterOfShow, FILTERS_FROM, groupControls, showOptions } from '../controlGroups';
import { BUILT_IN_FOLD_KEY, mappingFoldKey, mappingRangeText } from '../mappingGroups';
import { NOTES_FOLD_KEY } from '../NotesCard';
import { firstAskFor } from '../../shell/linkedPresentationWatcher';
import { exampleTitleOf, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { emptyPlayRecord, type PlayControl, type PlayRecord } from '../../../types/play';
import { defaultLayer } from '../../../types/playLayers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup(extra: Partial<PlayRecord> = {}): PlayRecord {
  const base = emptyPlayRecord();
  const layer = defaultLayer('shape', 'l1', 'Box');
  return {
    ...base,
    layers: [layer],
    controls: [
      { id: 'c1', target: 'layer:l1::x', kind: 'float', label: 'Box · X', min: 0, max: 1 },
      { id: 'c2', target: 'n1::speed', kind: 'float', label: 'Speed', min: 0, max: 2 },
    ],
    mappings: [
      { id: 'm1', controlId: 'c2', source: { kind: 'mouse', axis: 'x' }, outMin: 0.05, outMax: 0.7, curve: 'linear', smoothMs: 30, enabled: true },
    ],
    notes: 'What it shows. A box you can move.',
    signals: [{ id: 's1', name: 'Hit' }],
    ...extra,
  } as PlayRecord;
}

const errors: unknown[][] = [];
let spy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a); }); });
afterAll(() => spy.mockRestore());

let roots: Array<{ root: Root; el: HTMLElement }> = [];
afterEach(() => {
  for (const r of roots) { act(() => r.root.unmount()); r.el.remove(); }
  roots = [];
});
beforeEach(() => {
  errors.length = 0;
  localStorage.clear();
  usePlayUi.setState({ selected: '', folded: {} });
  useNodeGraphStore.getState().setPlay(() => setup());
});

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage: 'controls', host, wide: true });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<PlayPage />));
  roots.push({ root, el }, { root: createRoot(document.createElement('div')), el: host });
  return host;
}

describe('P4: the Controls header and filters', () => {
  it('the notes fold into the header’s ⓘ: hidden at first, opened and folded from there, remembered', () => {
    const host = mount();
    const toggle = () => host.querySelector<HTMLButtonElement>('[data-notes-toggle]')!;
    expect(toggle()).not.toBeNull();
    expect(host.textContent).not.toContain('A box you can move');
    act(() => toggle().click());
    expect(host.textContent).toContain('A box you can move');
    expect(usePlayUi.getState().folded[NOTES_FOLD_KEY]).toBe(false);
    act(() => toggle().click());
    expect(host.textContent).not.toContain('A box you can move');
    expect(errors).toEqual([]);
  });

  it('no notes, no ⓘ', () => {
    useNodeGraphStore.getState().setPlay(() => setup({ notes: undefined }));
    const host = mount();
    expect(host.querySelector('[data-notes-toggle]')).toBeNull();
  });

  it('a few controls: no search or filter row; the view toggle sits on the first group’s heading', () => {
    const host = mount();
    expect(host.querySelector('[data-board-bar]')).toBeNull();
    expect(host.querySelector('[aria-label="Search controls"]')).toBeNull();
    expect(host.querySelector('[data-board-group] [aria-label^="Flat grid"]')).not.toBeNull();
  });

  it('many controls: one row with search, one filter dropdown and the view toggle', () => {
    const controls: PlayControl[] = Array.from({ length: FILTERS_FROM }, (_, i) => ({ id: `k${i}`, target: `n${i}::v`, kind: 'float', label: `K${i}`, min: 0, max: 1 }));
    useNodeGraphStore.getState().setPlay(() => setup({ controls, mappings: [] }));
    const host = mount();
    const bar = host.querySelector('[data-board-bar]')!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector('[aria-label="Search controls"]')).not.toBeNull();
    expect(bar.querySelector('[aria-label="Show"]')).not.toBeNull();
    expect(bar.querySelector('[aria-label="Mapped"]')).toBeNull();
    expect(bar.querySelector('[aria-label="Kind"]')).toBeNull();
    expect(bar.querySelector('[aria-label^="Flat grid"]')).not.toBeNull();
  });

  it('the filter helpers: shown from FILTERS_FROM or while in use; one value per filter', () => {
    expect(boardFiltersShown(FILTERS_FROM - 1, false)).toBe(false);
    expect(boardFiltersShown(FILTERS_FROM, false)).toBe(true);
    expect(boardFiltersShown(2, true)).toBe(true);
    expect(filterOfShow('all')).toEqual({});
    expect(filterOfShow('mapped')).toEqual({ mapped: 'mapped' });
    expect(filterOfShow('kind:color')).toEqual({ kind: 'color' });
    expect(filterOfShow('group:layer:l1')).toEqual({ group: 'layer:l1' });
    const play = setup();
    const values = showOptions(play).map(o => o.value);
    expect(values).toEqual(['all', 'mapped', 'unmapped', 'group:layer:l1', 'group:graph']);
    expect(groupControls(play, filterOfShow('mapped')).flatMap(g => g.items.map(x => x.control.id))).toEqual(['c2']);
  });
});

describe('P5: mappings folded to one line', () => {
  it('a mapping starts folded with its summary; opening it is remembered', () => {
    const host = mount();
    expect(host.querySelector('[data-mapping-range]')?.textContent).toBe('0.05–0.7 · linear');
    expect(host.querySelector('[aria-label="Expand mapping"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Expand mapping"]')!.click());
    expect(usePlayUi.getState().folded[mappingFoldKey('m1')]).toBe(false);
    expect(host.querySelector('[aria-label="Collapse mapping"]')).not.toBeNull();
    expect(host.querySelector('[data-mapping-range]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('the summary text', () => {
    expect(mappingRangeText({ outMin: 0.05, outMax: 0.7, curve: 'linear' })).toBe('0.05–0.7 · linear');
    expect(mappingRangeText({ outMin: 1, outMax: -1, curve: 'custom' })).toBe('1–-1 · drawn');
  });

  it('the built-in signals sit folded at the bottom of the sources', () => {
    const host = mount();
    const builtIn = host.querySelector('[data-source-group="builtin"]')!;
    expect(builtIn).not.toBeNull();
    expect(builtIn.querySelector('[data-built-in-signal]')).toBeNull();
    const sources = host.querySelector('[data-mappings="tab"]')!;
    const sections = Array.from(sources.querySelectorAll('[data-source-group]'));
    expect(sections[sections.length - 1]).toBe(builtIn);
    act(() => builtIn.querySelector('button')!.click());
    expect(usePlayUi.getState().folded[BUILT_IN_FOLD_KEY]).toBe(false);
    expect(host.querySelector('[data-built-in-signal]')).not.toBeNull();
  });
});

describe('P14: a new graph starts fresh', () => {
  it('each rail category goes back to its primary page', () => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, railPage: 'finish-sound', railPageMemory: { engine: 'finish-sound', controls: 'midi-file' } });
    usePlayUi.setState({ finishView: 'sound', selected: 'l1', entered: 'g1' });
    resetPlayPagesForNewGraph();
    expect(usePlaySplit.getState().railPage).toBe('engine-performance');
    expect(usePlaySplit.getState().railPageMemory).toEqual({ engine: 'engine-performance' });
    const ui = usePlayUi.getState();
    expect([ui.finishView, ui.selected, ui.entered]).toEqual(['picture', '', '']);
  });

  it('an example is named after itself until something else is loaded or it is saved', () => {
    const s = { exampleTitle: { label: 'MIDI controller', epoch: 3 }, graphEpoch: 3, currentGraph: null };
    expect(exampleTitleOf(s)).toBe('MIDI controller');
    expect(exampleTitleOf({ ...s, graphEpoch: 4 })).toBeNull();
    expect(exampleTitleOf({ ...s, currentGraph: { name: 'Mine' } })).toBeNull();
    expect(exampleTitleOf({ ...s, exampleTitle: null })).toBeNull();
  });

  it('the presentation notice asks once per graph', () => {
    expect(firstAskFor({ kind: 'example', key: 'playMidi' })).toBe(true);
    expect(firstAskFor({ kind: 'example', key: 'playMidi' })).toBe(false);
    expect(firstAskFor({ kind: 'example', key: 'playControls' })).toBe(true);
    expect(firstAskFor({ kind: 'saved', name: 'playMidi' })).toBe(true);
  });
});

describe('P16: the control card', () => {
  it('details: the range is read-only text, Driven by stacks over its text', () => {
    const host = mount();
    const card = host.querySelector<HTMLElement>('[data-control-id="c1"]')!;
    act(() => card.querySelector<HTMLButtonElement>('[aria-label^="Details"]')!.click());
    const range = card.querySelector('[data-control-range]')!;
    expect(range.textContent).toContain('0 – 1');
    expect(range.querySelector('input')).toBeNull();
    const by = card.querySelector<HTMLElement>('[data-driven-by]')!;
    expect(by.style.flexDirection).toBe('column');
    expect(errors).toEqual([]);
  });
});
