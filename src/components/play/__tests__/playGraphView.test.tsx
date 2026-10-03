// @vitest-environment jsdom
/**
 * The Rules page's Board / Graph toggle (wide only) and the Graph view: it
 * draws a box per source, rule, control and layer acted on, wires between
 * them, and a click on a box opens its detail window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RulesPage } from '../rules/RulesPage';
import { useDetail } from '../detail/detailStore';
import { defaultLayer, emptyPlayRecord, type PlayLayer, type PlayRecord } from '../../../types/play';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = (): PlayRecord => ({
  ...emptyPlayRecord(),
  layers: [{ ...defaultLayer('shape', 'l1', 'Box') } as PlayLayer],
  controls: [{ id: 'c1', target: 'layer:l1::x', kind: 'float', label: 'Box · X', min: 0, max: 1 }],
  mappings: [{ id: 'm1', controlId: 'c1', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
  signals: [{ id: 'r1', name: 'Box right', inputs: [{ kind: 'trigger', trigger: { on: 'value', value: 'ctl:c1', cmp: 'above', threshold: 0.5, hysteresis: 0, tolerance: 0 } }], do: [{ id: 'e1', do: 'hide', layerId: 'l1', amount: 1, enabled: true }] }],
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; useDetail.getState().close(); });

function mount(wide: boolean) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<RulesPage play={record()} onChange={() => {}} wide={wide} />));
  return host;
}

describe('the Graph view', () => {
  it('a wide page offers Board / Graph; Graph draws the setup and a click opens the detail window', () => {
    const el = mount(true);
    const graphBtn = [...el.querySelectorAll('[role="radio"]')].find(b => b.textContent === 'Graph') as HTMLButtonElement;
    expect(graphBtn).toBeTruthy();
    act(() => graphBtn.click());
    expect(el.querySelector('[data-play-graph]')).toBeTruthy();
    const ids = [...el.querySelectorAll('[data-graph-node]')].map(n => n.getAttribute('data-graph-node'));
    expect(ids.sort()).toEqual(['ctl:c1', 'do:l1', 'rule:r1', 'src:m1']);
    expect(el.querySelectorAll('[data-edge="value"]').length).toBe(1);
    expect(el.querySelectorAll('[data-edge="signal"]').length).toBe(2);
    act(() => (el.querySelector('[data-graph-node="rule:r1"]') as HTMLButtonElement).click());
    const d = useDetail.getState();
    expect(d.stack[d.at]).toEqual({ kind: 'signal', id: 'r1' });
  });

  it('a narrow page (a phone) has no toggle', () => {
    const el = mount(false);
    expect([...el.querySelectorAll('[role="radio"]')].some(b => b.textContent === 'Graph')).toBe(false);
  });
});
