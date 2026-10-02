// @vitest-environment jsdom
/**
 * The Mappings page's empty state ("Nothing mapped") offers a primary action:
 * Add control (the mini mapper's target picker, picking a source in the same
 * flow) when there's no control yet, or Add mapping once at least one exists.
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
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { emptyPlayRecord, type PlayRecord } from '../../../types/play';
import { defaultLayer } from '../../../types/playLayers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  usePlayUi.setState({ tab: 'controls', phonePage: '', selected: '' });
});

function mountMappingsPage(play: PlayRecord): HTMLElement {
  useNodeGraphStore.getState().setPlay(() => play);
  const host = document.createElement('div');
  document.body.appendChild(host);
  usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, sidebar: 'rail', railPage: 'controls', host, wide: true });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<PlayPage />));
  roots.push({ root, el }, { root: createRoot(document.createElement('div')), el: host });
  // The sources column of the Inputs board.
  return host.querySelector('[data-column="sources"]') as HTMLElement;
}

const byText = (root: ParentNode, text: string) => Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
function click(el: Element) { act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }

describe('Mappings page: empty state actions', () => {
  it('with no controls, offers Add control (the mini mapper target picker)', () => {
    const layer = defaultLayer('shape', 'l1', 'Box');
    const play: PlayRecord = { ...emptyPlayRecord(), layers: [layer] };
    const host = mountMappingsPage(play);
    expect(host.textContent).toContain('Nothing mapped');
    const addControl = byText(host, 'Add control');
    expect(addControl).toBeTruthy();
    expect(byText(host, 'Add mapping')).toBeFalsy();
    // Opens the target picker (candidates from the layer's numbers).
    click(addControl!);
    expect(document.body.textContent).toContain('From layers');
    expect(errors).toEqual([]);
  });

  it('with a control but no mappings, offers Add mapping', () => {
    const layer = defaultLayer('shape', 'l1', 'Box');
    const play: PlayRecord = {
      ...emptyPlayRecord(),
      layers: [layer],
      controls: [{ id: 'c1', target: 'layer:l1::x', kind: 'float', label: 'Box · X', min: 0, max: 1 }],
    };
    const host = mountMappingsPage(play);
    expect(host.textContent).toContain('Nothing mapped');
    expect(byText(host, 'Add control')).toBeFalsy();
    const addMapping = byText(host, 'Add mapping');
    expect(addMapping).toBeTruthy();
    click(addMapping!);
    expect(useNodeGraphStore.getState().play.mappings.length).toBe(1);
    expect(errors).toEqual([]);
  });
});
