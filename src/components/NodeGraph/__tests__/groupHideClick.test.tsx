// @vitest-environment jsdom
/**
 * ⌘-click (Ctrl-click off a Mac) on a group card's slider hides it from the card (node.params.hiddenParams,
 * as the Group Param Picker writes), and the toast's "Show it again" brings it back. A plain click doesn't.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useToastStore } from '../../ui/toastStore';
import { NodeComponent } from '../NodeComponent';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// A 2D context that accepts any drawing call (the card's little diagrams draw into it).
HTMLCanvasElement.prototype.getContext = (function (this: HTMLCanvasElement, kind: string) {
  if (kind !== '2d') return null;
  const base: Record<string, unknown> = { font: '', measureText: (t: string) => ({ width: t.length * 6 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }) };
  return new Proxy(base, { get: (o, k: string) => (k in o ? o[k] : () => {}), set: (o, k: string, v) => { o[k] = v; return true; } });
}) as unknown as HTMLCanvasElement['getContext'];
if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

let root: Root | null = null;
let host: HTMLElement | null = null;
const st = () => useNodeGraphStore.getState();
const noop = () => {};
const show = (id: string) => {
  const node = st().nodes.find(n => n.id === id)!;
  act(() => { root!.render(<NodeComponent node={node} onStartConnection={noop} onEndConnection={noop} />); });
};
const hidden = (id: string) => (st().nodes.find(n => n.id === id)!.params.hiddenParams as string[] | undefined) ?? [];
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  st().replaceGraph([]);
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

describe('hiding a group slider with a click', () => {
  it('⌘/Ctrl-click hides it; a plain click does not; the toast shows it again', () => {
    const inner = st().addNode('add', { x: 0, y: 0 })!;
    const g = st().groupNodes([inner], 'G')!;
    expect(g).toBeTruthy();
    show(g);
    const row = () => host!.querySelector<HTMLElement>('[data-param-key*="::"]');
    expect(row()).toBeTruthy();
    const key = row()!.getAttribute('data-param-key')!;

    act(() => { row()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(hidden(g)).toEqual([]);

    act(() => { row()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, metaKey: mac, ctrlKey: !mac })); });
    expect(hidden(g)).toEqual([key]);
    show(g);
    expect(host!.querySelector(`[data-param-key="${key}"]`)).toBeNull();

    const t = useToastStore.getState().toasts.at(-1)!;
    expect(t.action?.label).toBe('Show it again');
    act(() => t.action!.onClick());
    expect(hidden(g)).toEqual([]);
  });
});
