// @vitest-environment jsdom
/**
 * Play audit P12 (Layers) and P17 (Finish): the split view picks the first
 * layer itself, a hidden layer dims only its name and icon, the Layers-node
 * switch is in the layer's ⋯ menu in plain words, kinds have their own icons;
 * Finish's Grade has no Look picker of its own (Looks are Finish presets, in
 * Presets), and Add effect is a button like the other + buttons.
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
import { LayersPanel } from '../LayersPanel';
import { PictureFinish } from '../finish/FinishPanel';
import { usePlayUi } from '../playUi';
import { BUILTIN_LAYERS } from '../layers/addLayerCatalog';
import { RAIL_CATEGORIES } from '../railPages';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { defaultLayer, emptyPlayRecord, type PlayLayer, type PlayRecord } from '../../../types/play';
import { newFinishEffect } from '../../../types/playFinish';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } usePlayUi.setState({ selected: '' }); });

const layers = (): PlayRecord => ({
  ...emptyPlayRecord(),
  layers: [
    { ...defaultLayer('null', 'n1', 'Cursor'), visible: false } as PlayLayer,
    defaultLayer('text', 't1', 'Words') as PlayLayer,
  ],
});

describe('Layers (Play audit P12)', () => {
  it('the split view selects the first layer in the list when none is picked', () => {
    usePlayUi.setState({ selected: '' });
    const el = mount(<LayersPanel play={layers()} touch={false} split big exposedTargets={new Set()} onChange={() => {}} onExpose={() => {}} />);
    expect(usePlayUi.getState().selected).not.toBe('');
    expect(el.textContent).not.toContain('Pick a layer in the list');
  });

  it('a hidden layer dims its icon and name, not its card; the Layers-node switch is in ⋯ in plain words', () => {
    usePlayUi.setState({ selected: 't1' });
    const el = mount(<LayersPanel play={layers()} touch={false} exposedTargets={new Set()} onChange={() => {}} onExpose={() => {}} />);
    const card = el.querySelector('[data-layer-id="n1"]') as HTMLElement;
    expect(card.style.opacity).toBe('');
    expect(el.textContent).not.toContain('Seen by the Layers node');
    const text = el.querySelector('[data-layer-id="t1"]') as HTMLElement;
    const more = [...text.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.startsWith('More'))!;
    act(() => more.click());
    expect(document.body.textContent).toContain('Shader effects see it');
  });

  it('every kind has its own icon: no drag handle, no play button, no icon used twice', () => {
    const plain = BUILTIN_LAYERS.filter(b => !b.variant);
    const icons = plain.map(b => b.icon);
    expect(icons).not.toContain('grip');
    expect(icons).not.toContain('play');
    expect(new Set(icons).size).toBe(icons.length);
    expect(RAIL_CATEGORIES.find(c => c.id === 'finish')?.icon).toBe('finish');
  });
});

describe('Finish (Play audit P17)', () => {
  const withGrade = (): PlayRecord => ({ ...emptyPlayRecord(), finish: { on: true, effects: [newFinishEffect('grade', 'g1')] } });

  it('the Grade has no Look picker; Presets holds the looks and Save the Grade as a look', () => {
    useNodeGraphStore.setState({ play: withGrade() });
    usePlayUi.getState().toggleFold('finish:g1', false);
    const el = mount(<PictureFinish play={withGrade()} onChange={() => {}} touch={false} wide />);
    expect(el.querySelector('[aria-label="Look"]')).toBeNull();
    expect(el.textContent).toContain('Looks (Teal & orange');
    const presets = [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Presets')!;
    act(() => presets.click());
    const menu = document.body.textContent ?? '';
    expect(menu).toContain('Save the Grade as a look…');
    expect(menu).toContain('Starting stacks');
    expect(menu).toContain('Teal & orange');
  });

  it('Add effect is a button like Add layer, opening the effect list', () => {
    const el = mount(<PictureFinish play={withGrade()} onChange={() => {}} touch={false} wide />);
    expect(el.querySelector('[role="combobox"][aria-label="Add an effect"]')).toBeNull();
    const add = [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Add effect')!;
    expect(add).toBeTruthy();
    act(() => add.click());
    expect(document.querySelector('[placeholder="Search effects and nodes"]')).toBeTruthy();
  });
});
