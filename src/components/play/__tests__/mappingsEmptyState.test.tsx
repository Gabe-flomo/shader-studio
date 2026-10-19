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
  usePlayUi.setState({ selected: '' });
});

function mountMappingsPage(play: PlayRecord): HTMLElement {
  useNodeGraphStore.getState().setPlay(() => play);
  const host = document.createElement('div');
  document.body.appendChild(host);
  usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage: 'controls', host, wide: true });
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

  it('with a control but no mappings, offers “Map an input” (the + Map picker), which asks for nothing', () => {
    const layer = defaultLayer('shape', 'l1', 'Box');
    const play: PlayRecord = {
      ...emptyPlayRecord(),
      layers: [layer],
      controls: [{ id: 'c1', target: 'layer:l1::x', kind: 'float', label: 'Box · X', min: 0, max: 1 }],
    };
    const host = mountMappingsPage(play);
    expect(host.textContent).toContain('Nothing mapped');
    expect(byText(host, 'Add control')).toBeFalsy();
    const mapInput = byText(host, 'Map an input');
    expect(mapInput).toBeTruthy();
    click(mapInput!);
    // The picker opens; nothing is made until a kind is picked (no silent MIDI CC row any more).
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    expect(useNodeGraphStore.getState().play.mappings.length).toBe(0);
    expect((useNodeGraphStore.getState().play.sources ?? []).length).toBe(0);
    expect(errors).toEqual([]);
  });

  it('Add control is one step: picking a setting adds its control, with no source picker on the way', () => {
    const layer = defaultLayer('shape', 'l1', 'Box');
    const host = mountMappingsPage({ ...emptyPlayRecord(), layers: [layer] });
    click(byText(host, 'Add control')!);
    // Unfold the layer, pick its first number.
    const folderBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.startsWith('Box'))!;
    click(folderBtn);
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(b => (b.style.paddingLeft === '40px'));
    expect(rows.length).toBeGreaterThan(0);
    click(rows.find(b => !b.textContent?.includes('button')) ?? rows[0]);
    const play = useNodeGraphStore.getState().play;
    expect(play.controls.length).toBe(1);
    expect(play.mappings.length).toBe(0);
    // No second picker ("Control only" / "Add as a control") and no third popover ("Done").
    expect(document.body.textContent).not.toContain('Add as a control');
    expect(byText(document.body, 'Done')).toBeFalsy();
    expect(errors).toEqual([]);
  });
});
