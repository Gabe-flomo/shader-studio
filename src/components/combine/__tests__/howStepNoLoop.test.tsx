// @vitest-environment jsdom
/**
 * The verb step of "+ Add a layer" (CombineWindow's HowStep) stays put while the graph changes under it. It used to
 * read targetInfo's object straight from the graph store: a new object each read, which the store took as a change
 * every time, and the window crashed with React #185 (maximum update depth) — coming back from a builder did it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CombineWindow } from '../CombineWindow';
import { useCombine } from '../../../combine/store';
import { presetGraph } from '../../../combine/presets';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { n } from '../../../store/graphBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; useCombine.getState().close(); });

describe('Combine: the verb step', () => {
  it('renders, and survives the graph changing under it', () => {
    let k = 0;
    const made = presetGraph('dustSettles', [n('output', 'out', 2000, 0)], () => `h${++k}`)
      ?? presetGraph('photoInRoom', [n('output', 'out', 2000, 0)], () => `h${++k}`);
    expect(made).toBeTruthy();
    const { nodes, spec } = made!;
    useNodeGraphStore.setState({ nodes });
    const base = spec.layers[0], top = spec.layers[spec.layers.length - 1];
    useCombine.getState().openWith(spec, { picker: { on: base.id, product: top.product } });
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<CombineWindow />));
    // The graph changes (a compile, a builder's Done): the step must re-render once, not forever.
    act(() => useNodeGraphStore.setState({ nodes: [...useNodeGraphStore.getState().nodes] }));
    act(() => useNodeGraphStore.setState({ nodes: [...useNodeGraphStore.getState().nodes, n('time', 'extra', 0, 0)] }));
    spy.mockRestore();
    expect(errors.map(String).join('\n')).not.toMatch(/Maximum update depth|getSnapshot should be cached|#185/);
    expect(document.body.textContent ?? "").toMatch(/Add a layer|How/i);
  });
});
