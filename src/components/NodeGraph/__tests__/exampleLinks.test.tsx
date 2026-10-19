// @vitest-environment jsdom
/**
 * "Examples using …" in the node browsers (ExampleLinks.tsx, docs/node-browser.md "Examples using a
 * node"): the node search shows examples for the node(s) a search is about, a category shows the
 * examples that use its nodes, a node's preview lists "Used in", and a card opens the example the
 * normal way (asking first over unsaved changes). The phone's Browse does the same.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

vi.mock('../../../structure/relevance', async orig => ({
  ...(await orig<typeof import('../../../structure/relevance')>()),
  exampleFollowCounts: () => Promise.resolve(new Map()),
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useDialogStore } from '../../ui/dialogStore';
import { RETIRED_EXAMPLE_KEYS } from '../../../store/exampleIndex';
import { EXAMPLE_NODE_TABLE, examplesForType } from '../../../store/exampleNodeIndex';
import { nodesOfRow } from '../libraryRows';
import { NodeSearchPalette } from '../NodeSearchPalette';
import { MobileNodeBrowser } from '../MobileNodeBrowser';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let host: HTMLDivElement;
let root: Root;
const loadExampleGraph = vi.fn<(k?: string) => Promise<void>>(async () => {});
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  loadExampleGraph.mockClear();
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [], graphDirty: false, loadExampleGraph });
  useDialogStore.setState({ current: null });
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const typeInto = (input: HTMLInputElement, text: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const click = (el: Element | null) => act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const cards = (strip: string) => [...document.querySelectorAll(`[data-example-strip="${strip}"] [data-example-card]`)].map(e => e.getAttribute('data-example-card')!);
const retired = new Set(RETIRED_EXAMPLE_KEYS);

describe('the node search', () => {
  it('searching “Circle SDF” shows examples using Circle SDF, none retired', () => {
    const onClose = vi.fn();
    act(() => root.render(<NodeSearchPalette open onClose={onClose} />));
    typeInto(document.querySelector<HTMLInputElement>('[data-node-search-input]')!, 'Circle SDF');
    const strip = document.querySelector('[data-example-strip="search"]');
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain('Examples using Circle SDF');
    const keys = cards('search');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThanOrEqual(4);
    for (const k of keys) expect(EXAMPLE_NODE_TABLE.examples[k].t).toContain('circleSDF');
    expect(keys.some(k => retired.has(k))).toBe(false);
  });

  it('a vague search shows no strip', () => {
    act(() => root.render(<NodeSearchPalette open onClose={() => {}} />));
    typeInto(document.querySelector<HTMLInputElement>('[data-node-search-input]')!, 'zzqqxx');
    expect(document.querySelector('[data-example-strip="search"]')).toBeNull();
  });

  it('a category shows examples that use its nodes', () => {
    act(() => root.render(<NodeSearchPalette open onClose={() => {}} />));
    click(document.querySelector('[data-tile="c:Noise"]'));
    const keys = cards('category');
    expect(keys.length).toBeGreaterThan(0);
    const types = new Set(nodesOfRow('Noise').map(d => d.type));
    for (const k of keys) expect(EXAMPLE_NODE_TABLE.examples[k].t.some(t => types.has(t))).toBe(true);
  });

  it('clicking a card opens the example and closes the search', async () => {
    const onClose = vi.fn();
    act(() => root.render(<NodeSearchPalette open onClose={onClose} />));
    typeInto(document.querySelector<HTMLInputElement>('[data-node-search-input]')!, 'Circle SDF');
    const first = cards('search')[0];
    click(document.querySelector(`[data-example-strip="search"] [data-example-card="${first}"]`));
    await flush();
    expect(loadExampleGraph).toHaveBeenCalledWith(first);
    expect(onClose).toHaveBeenCalled();
  });

  it('asks first when the open graph has unsaved changes', async () => {
    useNodeGraphStore.setState({ graphDirty: true });
    const onClose = vi.fn();
    act(() => root.render(<NodeSearchPalette open onClose={onClose} />));
    typeInto(document.querySelector<HTMLInputElement>('[data-node-search-input]')!, 'Circle SDF');
    click(document.querySelector('[data-example-strip="search"] [data-example-card]'));
    await flush();
    const req = useDialogStore.getState().current as { kind: string; resolve: (v: boolean) => void } | null;
    expect(req?.kind).toBe('confirm');
    expect(loadExampleGraph).not.toHaveBeenCalled();
    await act(async () => { req!.resolve(false); await Promise.resolve(); });
    expect(loadExampleGraph).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the highlighted node’s preview lists “Used in”', () => {
    act(() => root.render(<NodeSearchPalette open onClose={() => {}} />));
    typeInto(document.querySelector<HTMLInputElement>('[data-node-search-input]')!, 'Circle SDF');
    const used = cards('used-in');
    expect(used).toEqual(examplesForType('circleSDF', 3).map(h => h.key));
  });
});

describe('the phone Browse', () => {
  it('search shows examples, a category shows examples, a node page shows “Used in”', () => {
    const onClose = vi.fn();
    act(() => root.render(<MobileNodeBrowser onClose={onClose} />));
    const input = host.querySelector<HTMLInputElement>('[data-browse-search] input')!;
    typeInto(input, 'Circle SDF');
    expect(cards('search').length).toBeGreaterThan(0);
    act(() => host.querySelector<HTMLButtonElement>('[data-browse-result="circleSDF"]')!.click());
    expect(cards('used-in').length).toBeGreaterThan(0);
    act(() => host.querySelector<HTMLButtonElement>('button')!.click()); // back to results
    typeInto(host.querySelector<HTMLInputElement>('[data-browse-search] input')!, '');
    click(host.querySelector('[data-browse-row="Noise"]'));
    expect(cards('category').length).toBeGreaterThan(0);
  });
});
