// @vitest-environment jsdom
/**
 * One suggestion surface (docs/glossary.md, "Next"): the Next strip under the selected card opens
 * its list the first time, folds to a small chip once a move is used, opens again from the chip,
 * and Esc closes it either way. The library's "Fits here" no longer follows the selection: it shows
 * only while a wire is dragged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

vi.mock('../../../suggestions', async orig => {
  const real = await orig<typeof import('../../../suggestions')>();
  return {
    ...real,
    suggestionsFor: () => [{ key: 'uv', side: 'out', move: { id: 'm', label: 'Tile it', why: 'because' }, args: {}, why: 'because', score: 1 }],
  };
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SuggestionStrip } from '../SuggestionStrip';
import { useFitsHere } from '../useLibraryRelevance';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { setSuggestionsOpen, suggestionsOpen } from '../../../suggestions/settings';
import { n } from '../../../store/graphBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.CSS) vi.stubGlobal('CSS', { escape: (s: string) => s });

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
beforeEach(() => { localStorage.clear(); setSuggestionsOpen(true); });
const mount = (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
};
const strip = () => document.querySelector<HTMLElement>('[data-suggestion-strip="u"]');

function showStrip() {
  const nodes = [n('uv', 'u', 0, 0)];
  useNodeGraphStore.setState({ nodes, selectedNodeId: 'u', selectedNodeIds: [] });
  const canvasRef = { current: document.createElement('div') };
  mount(createElement(SuggestionStrip, { nodes, canvasRef, pan: { x: 0, y: 0 }, zoom: 1 }));
}

describe('the Next strip', () => {
  it('opens its list the first time, and folds to a chip once a move is used', () => {
    const apply = vi.fn();
    useNodeGraphStore.setState({ applySuggestion: apply } as never);
    showStrip();
    expect(strip()?.hasAttribute('data-folded')).toBe(false);
    act(() => { strip()!.querySelector<HTMLButtonElement>('[data-move="m"]')!.click(); });
    expect(apply).toHaveBeenCalled();
    expect(suggestionsOpen()).toBe(false);
    expect(localStorage.getItem('playfield:suggestions:open')).toBe('folded');
    expect(strip()?.hasAttribute('data-folded')).toBe(true);
    expect(strip()?.textContent).toContain('Next');
  });

  it('the chip opens the list; folding by hand folds it again', () => {
    setSuggestionsOpen(false);
    showStrip();
    act(() => { strip()!.querySelector('button')!.click(); });
    expect(strip()?.hasAttribute('data-folded')).toBe(false);
    act(() => { strip()!.querySelector<HTMLButtonElement>('button[aria-label^="Fold"]')!.click(); });
    expect(strip()?.hasAttribute('data-folded')).toBe(true);
  });

  it('Esc closes the folded chip too', () => {
    setSuggestionsOpen(false);
    showStrip();
    expect(strip()).toBeTruthy();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(strip()).toBeNull();
  });
});

describe('Fits here', () => {
  it('ignores the selection: nothing without a wire being dragged', () => {
    useNodeGraphStore.setState({ nodes: [n('uv', 'u', 0, 0)], selectedNodeId: 'u', selectedNodeIds: [], activeGroupPath: [] });
    let got: ReturnType<typeof useFitsHere> | null = null;
    function Probe() { got = useFitsHere(true, new Set()); return null; }
    mount(createElement(Probe));
    expect(got).toEqual({ defs: [], from: null });
  });
});
