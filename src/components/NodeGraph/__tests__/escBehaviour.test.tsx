// @vitest-environment jsdom
/**
 * Esc: closes the "Next · learns from your graphs" strip (one Esc, one thing; selecting again brings
 * it back), and an Esc the app's shortcuts don't use (no group to leave) isn't swallowed, so the
 * Overlay's "Esc turns it off" works.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useShortcuts } from '../../../hooks/useShortcuts';
import { n } from '../../../store/graphBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.CSS) vi.stubGlobal('CSS', { escape: (s: string) => s });

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
const mount = (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
};
const esc = () => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => { document.body.dispatchEvent(e); });
  return e;
};

describe('the Next strip', () => {
  it('Esc closes it; selecting the card again brings it back', () => {
    const nodes = [n('uv', 'u', 0, 0)];
    useNodeGraphStore.setState({ nodes, selectedNodeId: 'u', selectedNodeIds: [] });
    const canvasRef = { current: document.createElement('div') };
    mount(createElement(SuggestionStrip, { nodes, canvasRef, pan: { x: 0, y: 0 }, zoom: 1 }));
    expect(document.querySelector('[data-suggestion-strip="u"]')).toBeTruthy();
    const e = esc();
    expect(e.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-suggestion-strip]')).toBeNull();
    act(() => { useNodeGraphStore.setState({ selectedNodeId: null }); });
    act(() => { useNodeGraphStore.setState({ selectedNodeId: 'u' }); });
    expect(document.querySelector('[data-suggestion-strip="u"]')).toBeTruthy();
  });
});

describe('an Esc no shortcut uses', () => {
  function Probe({ handler }: { handler: () => void | boolean }) {
    useShortcuts({ exitGroup: handler });
    return null;
  }

  it('isn’t swallowed when the handler declines it (nothing to leave), so Overlay can take it', () => {
    mount(createElement(Probe, { handler: () => false }));
    expect(esc().defaultPrevented).toBe(false);
  });

  it('is taken when the handler uses it', () => {
    mount(createElement(Probe, { handler: () => {} }));
    expect(esc().defaultPrevented).toBe(true);
  });
});
