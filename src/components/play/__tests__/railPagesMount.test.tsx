// @vitest-environment jsdom
/**
 * Every page the rail offers mounts into the panel beside it (as PlayPage
 * renders it) without a console error, wide and narrow; PlayPage renders
 * nothing else there (one navigation model, Play audit P1); the phone's
 * bottom row shows the same pages; and the Background is the Layers list's
 * pinned first row (P13).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  // jsdom has neither; the panel and the board measure with them.
  class RO { observe() {} unobserve() {} disconnect() {} }
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  vi.stubGlobal('ResizeObserver', RO);
  vi.stubGlobal('IntersectionObserver', IO);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlayPage } from '../PlayPage';
import { PlayRail, RailPageTabs } from '../PlayRail';
import { driverCardFor, mappingFoldKey, sourceGroupFoldKey } from '../mappingGroups';
import { DEFAULT_SPLIT, showPage, usePlaySplit } from '../playSplit';
import { useInputsBoard } from '../inputs/InputsBoard';
import { BACKGROUND_ROW } from '../layers/BackgroundPinnedRow';
import { addBackground } from '../../../play/backgroundQueue';
import { usePlayUi } from '../playUi';
import { RAIL_PAGE_IDS, categoryDef, type RailPage } from '../railPages';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { emptyPlayRecord, type PlayRecord } from '../../../types/play';
import { defaultLayer } from '../../../types/playLayers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup(): PlayRecord {
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
      { id: 'm1', controlId: 'c2', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 2, curve: 'linear', smoothMs: 30, enabled: true },
      { id: 'm2', controlId: 'c1', source: { kind: 'key', code: 'Space' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 30, enabled: false },
    ],
    actions: [{ id: 'a1', trigger: { on: 'key', code: 'KeyN' }, do: 'show', layerId: 'l1', amount: 1, enabled: true }],
    signals: [{ id: 's1', name: 'Hit' }],
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
  useNodeGraphStore.getState().setPlay(() => setup());
  usePlayUi.setState({ selected: '', folded: {} });
  useInputsBoard.setState({ tab: 'controls' });
  usePlaySplit.setState({ ...DEFAULT_SPLIT });
});

function mountPage(page: RailPage, wide: boolean): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage: page, host, wide });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<PlayPage />));
  roots.push({ root, el }, { root: createRoot(document.createElement('div')), el: host });
  return host;
}

describe('the rail’s full-width pages', () => {
  for (const page of RAIL_PAGE_IDS) {
    for (const wide of [true, false]) {
      it(`${page} mounts ${wide ? 'wide' : 'narrow'} without a console error`, () => {
        const host = mountPage(page, wide);
        expect(host.querySelector(`[data-big-page="${page}"]`)).not.toBeNull();
        expect(errors).toEqual([]);
      });
    }
  }

  it('Inputs full width is the board: the controls beside the sources', () => {
    const host = mountPage('controls', true);
    expect(host.querySelector('[data-inputs-board="columns"]')).not.toBeNull();
    expect(host.querySelector('[data-column="controls"] [data-controls-board=""]')).not.toBeNull();
    expect(host.querySelector('[data-column="sources"] [data-mappings="tab"]')).not.toBeNull();
    // The MIDI file and the pad grid have pages of their own.
    expect(host.textContent).not.toContain('Set up a pad grid');
  });

  it('Inputs narrow is two tabs, Controls first', () => {
    const host = mountPage('controls', false);
    expect(host.querySelector('[data-inputs-board="tabs"]')).not.toBeNull();
    expect(host.querySelector('[data-controls-board=""]')).not.toBeNull();
  });

  it('Controls full width is the board: grouped cards, a trace slot only on what a mapping drives', () => {
    const host = mountPage('controls', true);
    expect(host.querySelector('[data-controls-board=""]')).not.toBeNull();
    expect(host.querySelector('[data-board-group="layer:l1"]')).not.toBeNull();
    expect(host.querySelector('[data-board-group="graph"]')).not.toBeNull();
    // Speed is driven (the mouse); Box · X's only mapping is off, so its flat line isn't drawn.
    const slots = host.querySelectorAll('[data-trace-slot]');
    expect(slots.length).toBe(1);
    expect(slots[0].getAttribute('data-trace-key')).toBe('c2');
  });

  it('PlayPage renders only the page in the panel (and what floats): no sidebar, no tab strip, no S/M/L', () => {
    mountPage('layers', true);
    expect(document.querySelector('[aria-label="Play section"]')).toBeNull();
    expect(document.querySelector('[aria-label="Panel width"]')).toBeNull();
    expect(document.querySelector('[aria-label="Panel section"]')).toBeNull();
  });

  it('the rail is always there, Mappings included, and a click goes straight to a page — no drawer', () => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage: 'controls' });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push({ root, el });
    act(() => root.render(<PlayRail />));
    const cats = el.querySelectorAll('[data-rail-category]');
    expect(Array.from(cats).map(c => c.getAttribute('data-rail-category'))).toEqual(['controls', 'layers', 'signals', 'finish', 'engine']);
    // Each icon carries its name under it (P18).
    expect(Array.from(cats).map(c => c.querySelector('[data-rail-label]')?.textContent)).toEqual(['Controls', 'Layers', 'Rules', 'Finish', 'Sound']);
    act(() => (el.querySelector('[data-rail-category="layers"]') as HTMLButtonElement).click());
    expect(usePlaySplit.getState().railPage).toBe('layers');
    expect(el.querySelector('[data-popover]')).toBeNull();
    expect(document.querySelector('[data-popover]')).toBeNull();
  });

  it('the panel header’s tab strip lists a category’s pages, switches on click, and the page is remembered per category', () => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage: 'engine-performance' });
    const sound = categoryDef('engine');
    expect(sound.pages.length).toBeGreaterThan(1);
    expect(categoryDef('controls').pages.length).toBe(3); // Inputs, the MIDI file and the pad grid: a strip.
    expect(categoryDef('signals').pages.length).toBe(1); // Rules stays a plain page, not a strip.
    expect(categoryDef('layers').pages.length).toBe(1); // The Background is the list's pinned row, not a page (P13).
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push({ root, el });
    const render = () => root.render(<RailPageTabs def={sound} current={usePlaySplit.getState().railPage} play={setup()} onPick={p => usePlaySplit.getState().setRailPage(p)} />);
    act(render);
    const tabs = el.querySelectorAll('[data-rail-tab]');
    expect(Array.from(tabs).map(t => t.getAttribute('data-rail-tab'))).toEqual(['engine-performance', 'finish-sound']);
    act(() => { (el.querySelector('[data-rail-tab="finish-sound"]') as HTMLButtonElement).click(); render(); });
    expect(usePlaySplit.getState().railPage).toBe('finish-sound');
    expect(el.querySelector('[data-rail-tab="finish-sound"]')?.getAttribute('aria-selected')).toBe('true');
    // Leaving Sound and coming back returns to Effects, not the category's first page.
    usePlaySplit.getState().openRailCategory('controls');
    usePlaySplit.getState().openRailCategory('engine');
    expect(usePlaySplit.getState().railPage).toBe('finish-sound');
  });
});

describe('the phone’s pages', () => {
  it('shows the rail’s page under the picture, with the bottom row', () => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, available: false, host: null });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push({ root, el });
    act(() => root.render(<PlayPage compact />));
    expect(el.querySelector('[data-play-railbar]')).not.toBeNull();
    expect(el.querySelectorAll('[data-rail-category]').length).toBe(5);
    expect(el.querySelector('[data-phone-page="controls"]')).not.toBeNull();
    act(() => showPage('signals'));
    expect(el.querySelector('[data-phone-page="signals"]')).not.toBeNull();
    act(() => showPage('layers'));
    expect(el.querySelector('[data-phone-page="layers"]')).not.toBeNull();
    // A desktop-only page (the pad grid) shows the phone's Controls page, where Sources has it.
    act(() => showPage('pad-grid'));
    expect(el.querySelector('[data-phone-page="controls"]')).not.toBeNull();
    expect(errors).toEqual([]);
  });
});

describe('the phone’s Controls and Layers (Play audit P20)', () => {
  const mountPhone = (): HTMLElement => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, available: false, host: null });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push({ root, el });
    act(() => root.render(<PlayPage compact />));
    return el;
  };
  const click = (el: Element | null | undefined) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const button = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);

  it('the header holds only “+ Control” and ⋯, 44px; no canvas or background rows over the controls', () => {
    const el = mountPhone();
    const add = button(el, 'Add control')!;
    expect(add.textContent).toContain('Control');
    expect(add.style.height).toBe('44px');
    const more = button(el, 'More: notes, and the setup')!;
    expect(more.style.width).toBe('44px');
    expect(more.style.height).toBe('44px');
    expect([...el.querySelectorAll('button')].some(b => /Suggest controls/.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))).toBe(false);
    expect(el.querySelector('[data-phone-canvas-row]')).toBeNull();
    expect(el.textContent).not.toContain('Layers only');
    expect(errors).toEqual([]);
  });

  it('a Controls / Sources switch shows the sources, MIDI file and pad grid included', () => {
    const el = mountPhone();
    expect(el.querySelector('[data-phone-inputs]')).not.toBeNull();
    expect(el.querySelector('[data-mappings]')).toBeNull();
    click([...el.querySelectorAll('[data-phone-inputs] button')].find(b => b.textContent?.startsWith('Sources')));
    expect(useInputsBoard.getState().tab).toBe('sources');
    expect(el.querySelector('[data-mappings]')).not.toBeNull();
    expect(el.textContent).toContain('Play a MIDI file');
    // The bottom row still lights Controls.
    expect(el.querySelector('[data-rail-category="controls"]')?.getAttribute('aria-current')).toBe('page');
    expect(errors).toEqual([]);
  });

  it('a control’s chip opens its mapping in Sources, unfolded', () => {
    const el = mountPhone();
    click(el.querySelector('[data-control-id="c2"] [data-driven-chip]'));
    const ui = usePlayUi.getState();
    expect(useInputsBoard.getState().tab).toBe('sources');
    const d = driverCardFor(useNodeGraphStore.getState().play, 'c2')!;
    expect(d).toMatchObject({ kind: 'mapping', id: 'm1' });
    expect(ui.folded[mappingFoldKey('m1')]).toBe(false);
    expect(ui.folded[sourceGroupFoldKey(d.group)]).toBe(false);
    expect(el.querySelector('[data-mapping-id="m1"]')).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it('Layers in the bottom row goes straight to Layers, with only the picture’s size at its top and the Background pinned first', () => {
    const el = mountPhone();
    click(el.querySelector('[data-rail-category="layers"]'));
    expect(usePlaySplit.getState().railPage).toBe('layers');
    expect(document.querySelector('[role="menu"][aria-label="Layers pages"]')).toBeNull();
    // No Canvas row (shapes, resolution, fps, full screen, guides): the size, Free or 1:1, only (2026-10-18).
    expect(el.querySelector('[data-canvas-row]')).toBeNull();
    expect(el.querySelector('[aria-label^="Preview resolution"]')).toBeNull();
    expect(el.querySelector('[data-phone-size-row]')).not.toBeNull();
    expect([...el.querySelectorAll('[data-phone-size-row] [role="radio"], [data-phone-size-row] button')].map(b => b.textContent)).toEqual(['Free', '1:1']);
    // The same model as desktop: the Background is the list's pinned row, not a bar of its own.
    expect(el.querySelector('[data-background-pinned] [data-background-row]')).not.toBeNull();
    expect(el.querySelector('[data-background-settings]')).toBeNull();
    click(el.querySelector('[data-background-row]'));
    expect(el.querySelector('[data-background-settings]')).not.toBeNull();
    expect(errors).toEqual([]);
  });
});

describe('the Background, pinned on top of the Layers list (Play audit P13)', () => {
  it('without a Background layer: a pinned row first; picking it opens its settings beside the list', () => {
    const host = mountPage('layers', true);
    const list = host.querySelector('[data-layer-list]')!;
    const pinned = list.querySelector('[data-background-pinned]')!;
    expect(pinned).not.toBeNull();
    // First in the list, before any layer.
    const firstLayer = list.querySelector('[data-layer-id]');
    expect(pinned.compareDocumentPosition(firstLayer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pinned.textContent).toContain('The shader');
    // The first layer is picked on its own (P12); picking the Background opens its settings instead.
    expect(host.querySelector('[data-background-editor]')).toBeNull();
    act(() => (pinned.querySelector('[data-background-row]') as HTMLButtonElement).click());
    expect(usePlayUi.getState().selected).toBe(BACKGROUND_ROW);
    expect(host.querySelector('[data-background-editor] [data-background-settings]')).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it('with a Background layer: that layer is the pinned row, listed once', () => {
    useNodeGraphStore.getState().setPlay(p => addBackground(p, [], 'bg1').play);
    const host = mountPage('layers', true);
    const list = host.querySelector('[data-layer-list]')!;
    expect(list.querySelector('[data-background-pinned] [data-layer-id="bg1"]')).not.toBeNull();
    expect(list.querySelectorAll('[data-layer-id="bg1"]').length).toBe(1);
    expect(list.querySelector('[data-background-row]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('there is no Background page, nor a Background bar above the list', () => {
    expect(RAIL_PAGE_IDS).not.toContain('background' as RailPage);
    const host = mountPage('layers', false);
    expect(host.querySelectorAll('[data-background-row], [data-background-pinned]').length).toBeGreaterThan(0);
    // Only the pinned row says Background before the first layer: no separate bar.
    expect(host.querySelectorAll('[data-background-pinned]').length).toBe(1);
  });
});
