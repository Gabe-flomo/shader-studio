// @vitest-environment jsdom
/**
 * Every full-width page the rail offers mounts into the split view's big
 * panel (as PlayPage renders it) without a console error, wide and narrow;
 * and the phone's bottom row shows each page of its own.
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
import { DEFAULT_SPLIT, usePlaySplit } from '../playSplit';
import { usePlayUi } from '../playUi';
import { RAIL_PAGE_IDS, type RailPage } from '../railPages';
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
  usePlayUi.setState({ tab: 'controls', phonePage: '', selected: '' });
});

function mountPage(page: RailPage, wide: boolean): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, sidebar: 'rail', railPage: page, host, wide });
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

  it('Mappings full width is the grouped workspace, with the first mapping’s editor', () => {
    const host = mountPage('mappings', true);
    expect(host.querySelector('[data-mappings-workspace]')).not.toBeNull();
    expect(host.querySelector('[data-mapping-group="keys"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-mapping-row]').length).toBe(2);
    expect(host.querySelector('[data-mapping-editor="m1"]')).not.toBeNull();
    // The MIDI file and the pad grid have pages of their own.
    expect(host.textContent).not.toContain('Set up a pad grid');
  });

  it('Controls full width is the board: grouped cards with a trace slot each', () => {
    const host = mountPage('controls', true);
    expect(host.querySelector('[data-controls-board=""]')).not.toBeNull();
    expect(host.querySelector('[data-board-group="layer:l1"]')).not.toBeNull();
    expect(host.querySelector('[data-board-group="graph"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-trace-slot]').length).toBe(2);
  });

  it('the sidebar stays out while the rail is out', () => {
    mountPage('layers', true);
    // PlayPage renders only the portal (and what floats): no tab strip of its own.
    expect(document.querySelector('[aria-label="Play section"]')).toBeNull();
  });
});

describe('the phone’s pages', () => {
  it('a page of its own replaces the tab’s section, and the bottom row is there', () => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, available: false, host: null });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push({ root, el });
    act(() => root.render(<PlayPage compact />));
    expect(el.querySelector('[data-play-railbar]')).not.toBeNull();
    expect(el.querySelectorAll('[data-rail-category]').length).toBe(5);
    act(() => usePlayUi.getState().showPage('signals'));
    expect(el.querySelector('[data-phone-page="signals"]')).not.toBeNull();
    act(() => usePlayUi.getState().showPage('layers'));
    expect(el.querySelector('[data-phone-page]')).toBeNull();
    expect(errors).toEqual([]);
  });
});
