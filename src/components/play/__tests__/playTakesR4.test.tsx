// @vitest-environment jsdom
/**
 * Play audit round 4, lane B.
 * P8: three recordings with one name each (Record video, Record performance
 * (take), Arm track); the takes' home is Sound → Arrangement → Takes, with
 * watch / rename / delete / export, and "From the tape" moved there from the
 * transport.
 * P10: the MIDI file and the pad grid are source kinds in "+ Map", edited as
 * cards in the Sources column; Controls has no sub-tabs; saved setups show
 * theirs there.
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
vi.mock('../../ui/dialogStore', async orig => ({ ...(await orig<typeof import('../../ui/dialogStore')>()), askText: vi.fn(async () => 'Encore') }));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlayPage } from '../PlayPage';
import { DEFAULT_SPLIT, parseSplitPrefs, usePlaySplit } from '../playSplit';
import { usePlayUi } from '../playUi';
import { useInputsBoard } from '../inputs/InputsBoard';
import { useMapMode } from '../inputs/mapMode';
import { useLearnMode } from '../inputs/learnMode';
import { MAP_MIDI_FILE, MAP_PAD_GRID, fileKindItems, mapPickAsksMidi, mapPickerSections, parseMapPick } from '../mapPicker';
import { MIDI_FILE_FOLD, PAD_GRID_FOLD, midiFileSummary, padGridSummary } from '../inputs/FileSources';
import { TAKES_FOLD, takesSummary } from '../TakesSection';
import { categoryDef, currentRailPage, isRailPage } from '../railPages';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useTakes } from '../../../lib/takes';
import { usePlan } from '../../../lib/plan';
import { midiEngine } from '../../../lib/midiEngine';
import { emptyPlayRecord, type PlayRecord, type PlayTake } from '../../../types/play';
import { DEFAULT_PAD_GRID } from '../../../types/playMidi';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const take = (id: string, name: string, length: number): PlayTake => ({ id, name, from: 0, length, tracks: [], events: [] });

function setup(extra: Partial<PlayRecord> = {}): PlayRecord {
  return {
    ...emptyPlayRecord(),
    controls: [{ id: 'c1', target: 'n1::radius', kind: 'float', label: 'Radius', min: 0, max: 1 }],
    ...extra,
  } as PlayRecord;
}

const errors: unknown[][] = [];
let errSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a); }); });
afterAll(() => errSpy.mockRestore());

let connect: ReturnType<typeof vi.spyOn>;
let roots: Array<{ root: Root; el: HTMLElement }> = [];
beforeEach(() => {
  errors.length = 0;
  usePlan.setState({ session: { status: 'signed-in', user: '', plan: 'pro', source: 'open' } });
  useNodeGraphStore.getState().setPlay(() => setup());
  usePlayUi.setState({ selected: '', folded: {} });
  useInputsBoard.setState({ tab: 'controls' });
  useMapMode.getState().stop();
  useLearnMode.getState().stop();
  connect = vi.spyOn(midiEngine, 'connectWebMidi').mockResolvedValue('unsupported');
});
afterEach(() => {
  for (const r of roots) { act(() => r.root.unmount()); r.el.remove(); }
  roots = [];
  connect.mockRestore();
  vi.restoreAllMocks();
});

function mount(railPage: 'controls' | 'engine-performance'): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage, host, wide: true });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<PlayPage />));
  roots.push({ root, el }, { root: createRoot(document.createElement('div')), el: host });
  return host;
}
const click = (el: Element | null | undefined) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const option = (value: string) => document.querySelector(`[role="option"][data-value="${value}"]`);
const byLabel = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);

describe('P10: the MIDI file and the pad grid in "+ Map" (pure)', () => {
  it('are kinds under MIDI; parse, MIDI access and Pro as they should', () => {
    const midi = mapPickerSections([], false).find(s => s.heading === 'MIDI')!;
    const values = midi.items.map(i => i.value);
    expect(values).toContain(MAP_MIDI_FILE);
    expect(values).toContain(MAP_PAD_GRID);
    expect(parseMapPick(MAP_MIDI_FILE)).toEqual({ kind: 'midiFile' });
    expect(parseMapPick(MAP_PAD_GRID)).toEqual({ kind: 'padGrid' });
    // A MIDI file plays inside the app: no MIDI access. The pad grid listens to a controller.
    expect(mapPickAsksMidi(MAP_MIDI_FILE)).toBe(false);
    expect(mapPickAsksMidi(MAP_PAD_GRID)).toBe(true);
    const free = mapPickerSections([], true, [], { midiFileLocked: true }).flatMap(s => s.items);
    expect(free.find(i => i.value === MAP_MIDI_FILE)?.pro).toBe(true);
    expect(free.find(i => i.value === MAP_PAD_GRID)?.pro).toBe(true);
  });

  it('say when the setup already has one (one of each), and picking it opens it', () => {
    const [file, grid] = fileKindItems({ midiFile: 'Song', padGrid: true }, false);
    expect(file.label).toBe('MIDI file');
    expect(file.description).toContain('Song');
    expect(grid.description).toContain('open');
    expect(fileKindItems({}, false).map(i => i.label)).toEqual(['MIDI file…', 'Pad grid']);
  });

  it('fold to one line', () => {
    expect(midiFileSummary({ name: 'Song', loop: true, offset: 0 }, 75)).toBe('Song · 1:15 · loops');
    expect(padGridSummary({ ...DEFAULT_PAD_GRID })).toBe('8×8 pads → 8×8 cells · Hold');
  });
});

describe('P10: no MIDI file / Pad grid sub-tabs; saved pages open Controls', () => {
  it('Controls has one page, and old page ids migrate', () => {
    expect(categoryDef('controls').pages).toEqual(['controls']);
    expect(isRailPage('midi-file')).toBe(false);
    expect(currentRailPage('pad-grid')).toBe('controls');
    expect(parseSplitPrefs(JSON.stringify({ v: 4, railPage: 'pad-grid' })).railPage).toBe('controls');
  });
});

describe('P10: in the Sources column', () => {
  it('a saved setup’s MIDI file and pad grid show as folded source cards (no empty state)', () => {
    useNodeGraphStore.getState().setPlay(() => setup({ midiFile: { name: 'Song', data: '', loop: true, offset: 0 }, padGrid: { ...DEFAULT_PAD_GRID } }));
    const host = mount('controls');
    const sources = host.querySelector('[data-column="sources"]')!;
    const file = sources.querySelector('[data-file-source="midi-file"]')!;
    const grid = sources.querySelector('[data-file-source="pad-grid"]')!;
    expect(file.hasAttribute('data-folded')).toBe(true);
    expect(file.textContent).toContain('Song');
    expect(grid.textContent).toContain('8×8 pads → 8×8 cells');
    expect(sources.textContent).not.toContain('Nothing mapped');
    // The old always-there buttons are gone.
    expect(sources.textContent).not.toContain('Play a MIDI file');
    expect(sources.textContent).not.toContain('Set up a pad grid');
    // Opening one is remembered.
    click(grid.querySelector('button[aria-expanded]'));
    expect(usePlayUi.getState().folded[PAD_GRID_FOLD]).toBe(false);
    expect(host.querySelector('[data-testid="pad-grid-card"]')).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it('+ Map → Pad grid adds it once and opens its card; + Map → MIDI file… opens the file picker', () => {
    const host = mount('controls');
    const sources = () => host.querySelector('[data-column="sources"]')!;
    expect(sources().querySelector('[data-file-source]')).toBeNull();
    click(sources().querySelector('[data-map-button]'));
    click(option(MAP_PAD_GRID));
    expect(useNodeGraphStore.getState().play.padGrid).toEqual(DEFAULT_PAD_GRID);
    expect(usePlayUi.getState().folded[PAD_GRID_FOLD]).toBe(false);
    expect(host.querySelector('[data-testid="pad-grid-card"]')).not.toBeNull();
    // Again: still one grid, the same settings.
    act(() => useNodeGraphStore.getState().setPlay(p => ({ ...p, padGrid: { ...p.padGrid!, cols: 4 } })));
    click(sources().querySelector('[data-map-button]'));
    click(option(MAP_PAD_GRID));
    expect(useNodeGraphStore.getState().play.padGrid?.cols).toBe(4);
    // The MIDI file: the hidden file input is clicked, and its card will open when it loads.
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    click(sources().querySelector('[data-map-button]'));
    click(option(MAP_MIDI_FILE));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(usePlayUi.getState().folded[MIDI_FILE_FOLD]).toBe(false);
    expect(errors).toEqual([]);
  });
});

describe('P8: three recordings, one name each', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
  it('Record’s tabs are Record video and Record performance (take); Stage says the same; the transport records armed tracks', () => {
    const modal = src('../../ExportModal.tsx');
    expect(modal).toContain("label: 'Record video'");
    expect(modal).toContain("'Record performance (take)'");
    expect(modal).not.toContain('Start performance');
    const stage = src('../Stage.tsx');
    expect(stage).toContain("'Record video'");
    expect(stage).toContain("'Record performance (take)'");
    const arr = src('../engine/ArrangementPanel.tsx');
    expect(arr).toContain('Arm track');
    expect(arr).not.toContain('Make a take');
  });
});

describe('P8: the takes’ home under Sound → Arrangement', () => {
  it('folds to a summary, lists the takes with watch / rename / delete / export, and has no Make-a-take in the transport', async () => {
    useNodeGraphStore.getState().setPlay(() => setup({ takes: [take('t1', 'Take 1', 8), take('t2', 'Take 2', 12)] }));
    const host = mount('engine-performance');
    const section = host.querySelector('[data-takes-section]')!;
    expect(section).not.toBeNull();
    expect(section.hasAttribute('data-folded')).toBe(true);
    expect(section.textContent).toContain(takesSummary([{ name: 'Take 1', length: 8 }, { name: 'Take 2', length: 12 }]));
    expect(host.querySelector('[role="toolbar"][aria-label="Transport"]')?.querySelector('[aria-label^="Make a take"]') ?? null).toBeNull();
    click(section.querySelector('button[aria-expanded]'));
    expect(usePlayUi.getState().folded[TAKES_FOLD]).toBe(false);
    const items = () => [...host.querySelectorAll('[data-takes-section] [role="listitem"]')];
    expect(items().map(i => i.textContent)).toEqual([expect.stringContaining('Take 2'), expect.stringContaining('Take 1')]);

    // Watch it back.
    const replay = vi.spyOn(useTakes.getState(), 'replay').mockImplementation(() => {});
    click(byLabel(items()[1], 'Watch it back'));
    expect(replay).toHaveBeenCalledWith('t1');

    // Export video…: Record opens set to render this take.
    const opened = vi.fn();
    window.addEventListener('open-record', opened);
    click(byLabel(items()[0], 'Export video…'));
    expect(useTakes.getState().pending).toBe('t2');
    expect(opened).toHaveBeenCalled();
    window.removeEventListener('open-record', opened);
    useTakes.setState({ pending: null });

    // Rename.
    await act(async () => { (byLabel(items()[0], 'Rename') as HTMLElement).click(); await Promise.resolve(); });
    expect(useNodeGraphStore.getState().play.takes?.map(t => t.name)).toEqual(['Take 1', 'Encore']);

    // Delete.
    click(byLabel(items()[1], 'Delete this take'));
    expect(useNodeGraphStore.getState().play.takes?.map(t => t.id)).toEqual(['t2']);
    expect(errors).toEqual([]);
  });

  it('with no takes it says where they come from', () => {
    usePlayUi.setState({ folded: { [TAKES_FOLD]: false } });
    const host = mount('engine-performance');
    expect(host.querySelector('[data-takes-section]')?.textContent).toContain('Record performance (take)');
    expect(errors).toEqual([]);
  });
});
