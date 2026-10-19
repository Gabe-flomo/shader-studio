// @vitest-environment jsdom
/**
 * Play audit round 3, lane A.
 * P6: one "+ Map" picker grouped by kind (Learn, MIDI, Keys, Mouse, Audio, Hands,
 * LFO / Beat, Random, Behaviours); nothing asks for MIDI access until MIDI or
 * Learn is picked; Learn mode tints the control cards and maps the next input
 * onto the one clicked.
 * P7: a control's chip opens its mapping in Sources on desktop too; a mapping's
 * target is a chip that retargets; the card's "Mapped by" opens each driver.
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
import { useMapMode } from '../inputs/mapMode';
import { learnOnto, useLearnMode } from '../inputs/learnMode';
import { useInputsBoard } from '../inputs/InputsBoard';
import { MAP_KINDS, MAP_LEARN, mapPickAsksMidi, mapPickerSections, parseMapPick } from '../mapPicker';
import { mappingFoldKey } from '../mappingGroups';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { usePlan } from '../../../lib/plan';
import { midiEngine } from '../../../lib/midiEngine';
import { playEngine } from '../../../lib/playEngine';
import { emptyPlayRecord, type PlayRecord, type PlaySource } from '../../../types/play';
import { defaultLayer } from '../../../types/playLayers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup(): PlayRecord {
  const layer = defaultLayer('shape', 'l1', 'Box');
  return {
    ...emptyPlayRecord(),
    layers: [layer],
    controls: [
      { id: 'c1', target: 'layer:l1::x', kind: 'float', label: 'Box · X', min: 0, max: 1 },
      { id: 'c2', target: 'layer:l1::y', kind: 'float', label: 'Box · Y', min: 0, max: 2 },
    ],
    // No MIDI anywhere: the page must not ask for MIDI access.
    mappings: [{ id: 'm1', controlId: 'c2', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 2, curve: 'linear', smoothMs: 30, enabled: true }],
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
  // Never the real thing: no permission prompt in a test.
  connect = vi.spyOn(midiEngine, 'connectWebMidi').mockResolvedValue('unsupported');
});
afterEach(() => {
  for (const r of roots) { act(() => r.root.unmount()); r.el.remove(); }
  roots = [];
  connect.mockRestore();
  vi.restoreAllMocks();
});

/** The Controls rail page in the split view's panel: `wide` = two columns, else the Controls / Sources tabs. */
function mount(wide: boolean): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage: 'controls', host, wide });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<PlayPage />));
  roots.push({ root, el }, { root: createRoot(document.createElement('div')), el: host });
  return host;
}
const click = (el: Element | null | undefined) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const buttons = (root: ParentNode) => [...root.querySelectorAll('button')];
const option = (value: string) => document.querySelector(`[role="option"][data-value="${value}"]`);

describe('P6: the + Map picker (pure)', () => {
  it('groups by kind in the audit’s order, then the rest', () => {
    const sections = mapPickerSections([], false);
    expect(sections.slice(0, MAP_KINDS.length).map(s => s.heading)).toEqual([...MAP_KINDS]);
    const values = sections.flatMap(s => s.items.map(i => i.value));
    // Every kind has something; the extras (devices, face, pose) follow under their own headings.
    for (const s of sections.slice(0, MAP_KINDS.length)) expect(s.items.length).toBeGreaterThan(0);
    expect(values).toContain('type:mouse:x');
    expect(values).toContain('type:lfo');
    expect(values).toContain('type:clock');
    expect(values).toContain('random:0');
    expect(values).toContain('type:osc');
    expect(new Set(values).size).toBe(values.length);
  });

  it('only MIDI kinds and Learn ask for MIDI access', () => {
    const asks = mapPickerSections([], false).flatMap(s => s.items.map(i => i.value)).filter(mapPickAsksMidi);
    expect(asks).toContain(MAP_LEARN);
    expect(asks).toContain('type:midi:cc');
    expect(asks.every(v => v === MAP_LEARN || v === 'notes12' || v.startsWith('type:midi:') || v === 'type:pad')).toBe(true);
    expect(mapPickAsksMidi('type:mouse:x')).toBe(false);
    expect(mapPickAsksMidi('random:1')).toBe(false);
    expect(parseMapPick('type:midi:cc')).toEqual({ kind: 'type', type: 'midi:cc' });
    expect(parseMapPick('random:9')).toBeNull();
  });

  it('Free marks Pro on what it lacks, not on the mouse, keys or Learn', () => {
    const items = mapPickerSections([], true).flatMap(s => s.items);
    const by = (v: string) => items.find(i => i.value === v)!;
    expect(by('type:midi:cc').pro).toBe(true);
    expect(by('type:mouse:x').pro).toBeFalsy();
    expect(by('type:key').pro).toBeFalsy();
    expect(by(MAP_LEARN).pro).toBeFalsy();
  });
});

describe('P6: + Map on the page', () => {
  it('one Map button replaces Learn, Add and + Source; opening it and picking the mouse asks for no MIDI', () => {
    const host = mount(true);
    const sources = host.querySelector('[data-column="sources"]')!;
    const labels = buttons(sources).map(b => b.textContent?.trim());
    expect(labels).toContain('Map');
    expect(labels).not.toContain('Add');
    expect(labels).not.toContain('Learn');
    expect(labels).not.toContain('Source');
    click(sources.querySelector('[data-map-button]'));
    // The picker's headings, in order.
    const heads = [...document.querySelectorAll('[role="listbox"] [data-heading]')].map(h => h.textContent?.trim().toLowerCase());
    expect(heads.slice(0, MAP_KINDS.length)).toEqual(MAP_KINDS.map(k => k.toLowerCase()));
    click(option('type:mouse:x'));
    const play = useNodeGraphStore.getState().play;
    expect(play.sources?.map(s => s.source)).toEqual([{ kind: 'mouse', axis: 'x' }]);
    expect(play.mappings.length).toBe(1); // nothing silently mapped
    expect(useMapMode.getState().sourceId).toBe(play.sources![0].id);
    expect(connect).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('picking a MIDI kind connects MIDI (and the CC waits for the first knob)', () => {
    const host = mount(true);
    click(host.querySelector('[data-column="sources"] [data-map-button]'));
    click(option('type:midi:cc'));
    expect(connect).toHaveBeenCalled();
    const src = useNodeGraphStore.getState().play.sources![0].source;
    expect(src).toMatchObject({ kind: 'midi', signal: 'cc' });
    expect((src as { cc?: number }).cc).toBeUndefined();
    expect(errors).toEqual([]);
  });
});

describe('P6: Learn mode', () => {
  it('tints every control card, maps the next input onto the one clicked, replaces it on the next, and Esc stops', () => {
    let heard: ((s: PlaySource) => void) | null = null;
    vi.spyOn(playEngine, 'startLearn').mockImplementation(cb => { heard = cb; return () => {}; });
    const host = mount(true);
    click(host.querySelector('[data-column="sources"] [data-map-button]'));
    expect(connect).not.toHaveBeenCalled();
    click(option(MAP_LEARN));
    expect(useLearnMode.getState().on).toBe(true);
    expect(connect).toHaveBeenCalled(); // Learn may listen to MIDI: the user asked for it
    const targets = host.querySelectorAll('[data-learn-target]');
    expect([...targets].map(t => t.getAttribute('data-learn-target')).sort()).toEqual(['c1', 'c2']);
    expect(host.querySelector('[data-learn-mode]')?.textContent).toContain('click a control');
    // Nothing listens until a control is picked.
    expect(heard).toBeNull();
    click(host.querySelector('[data-learn-target="c1"]'));
    expect(host.querySelector('[data-learn-target="c1"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(heard).not.toBeNull();
    act(() => heard!({ kind: 'key', code: 'KeyA' }));
    let play = useNodeGraphStore.getState().play;
    const made = play.mappings.find(m => m.controlId === 'c1')!;
    expect(made).toMatchObject({ source: { kind: 'key', code: 'KeyA' }, outMin: 0, outMax: 1 });
    // A second input replaces the first rather than adding a row.
    act(() => heard!({ kind: 'key', code: 'KeyB' }));
    play = useNodeGraphStore.getState().play;
    expect(play.mappings.filter(m => m.controlId === 'c1')).toHaveLength(1);
    expect(play.mappings.find(m => m.controlId === 'c1')!.source).toEqual({ kind: 'key', code: 'KeyB' });
    expect(host.querySelector('[data-learn-target="c1"]')?.textContent).toContain('Key B');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })); });
    expect(useLearnMode.getState().on).toBe(false);
    expect(host.querySelector('[data-learn-target]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('the narrow board shows the controls while learning', () => {
    useInputsBoard.setState({ tab: 'sources' });
    const host = mount(false);
    expect(host.querySelector('[data-learn-target]')).toBeNull();
    act(() => useLearnMode.getState().start());
    expect(host.querySelectorAll('[data-learn-target]').length).toBe(2);
    expect(errors).toEqual([]);
  });

  it('learnOnto: a new mapping across the control’s range; the same source changes nothing', () => {
    const p = setup();
    const a = learnOnto(p, 'c1', null, { kind: 'key', code: 'KeyA' }, 'mx');
    expect(a.mappingId).toBe('mx');
    expect(a.play.mappings.at(-1)).toMatchObject({ id: 'mx', controlId: 'c1', outMin: 0, outMax: 1, enabled: true });
    expect(learnOnto(a.play, 'c1', 'mx', { kind: 'key', code: 'KeyA' }, 'my').play).toBe(a.play);
    expect(learnOnto(p, 'gone', null, { kind: 'key', code: 'KeyA' }, 'mz').play).toBe(p);
  });
});

describe('P7: controls ↔ sources', () => {
  it('on desktop (narrow board) the chip opens Sources at its mapping, unfolded', () => {
    const host = mount(false);
    expect(host.querySelector('[data-mapping-id="m1"]')).toBeNull();
    click(host.querySelector('[data-control-id="c2"] [data-driven-chip]'));
    expect(useInputsBoard.getState().tab).toBe('sources');
    expect(usePlayUi.getState().folded[mappingFoldKey('m1')]).toBe(false);
    expect(host.querySelector('[data-mapping-id="m1"]')).not.toBeNull();
    // Opened, not the one-line summary: its target chip shows.
    expect(host.querySelector('[data-mapping-id="m1"] [data-target-chip]')).not.toBeNull();
    expect(document.querySelector('[data-detail-window]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('an open mapping has no CONTROL drop-down; its target chip retargets', () => {
    usePlayUi.getState().toggleFold(mappingFoldKey('m1'), false);
    const host = mount(true);
    const row = host.querySelector('[data-mapping-id="m1"]')!;
    expect(row.querySelector('[aria-label="Control"]')).toBeNull();
    const chip = row.querySelector('[data-target-chip]')!;
    expect(chip.textContent).toContain('Box · Y');
    click(chip);
    const other = [...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent?.trim() === 'Box · X');
    click(other);
    const m = useNodeGraphStore.getState().play.mappings.find(x => x.id === 'm1')!;
    expect(m.controlId).toBe('c1');
    expect([m.outMin, m.outMax]).toEqual([0, 1]);
    expect(errors).toEqual([]);
  });

  it('the card’s details list what maps it; each opens in Sources', () => {
    const host = mount(false);
    const card = host.querySelector<HTMLElement>('[data-control-id="c2"]')!;
    act(() => card.querySelector<HTMLButtonElement>('[aria-label^="Details"]')!.click());
    expect(card.querySelector('[data-driven-by]')?.textContent).toContain('Mapped by');
    click(card.querySelector('[data-mapped-by="m1"]'));
    expect(useInputsBoard.getState().tab).toBe('sources');
    expect(host.querySelector('[data-mapping-id="m1"]')).not.toBeNull();
    expect(errors).toEqual([]);
  });
});
