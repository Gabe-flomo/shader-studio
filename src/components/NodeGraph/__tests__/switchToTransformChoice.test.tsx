// @vitest-environment jsdom
/**
 * Switch to Transform's choice (SwitchToTransformButton.tsx, docs/transform-node.md): a switch that is
 * the same picture up to float rounding asks first (the pill opens a note with Switch / Keep), and
 * Switch all lists the exact and the rounding ones apart, so the inexact ones can be left out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { getNodeDefinition } from '../../../nodes/definitions';
import { previewSwitchAll } from '../../../nodes/toTransform';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { SwitchAllDialog, SwitchToTransformButton } from '../SwitchToTransformButton';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const node = (id: string, type: string, params: Record<string, unknown>, wired: string): GraphNode => {
  const def = getNodeDefinition(type)!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { ...s, ...(k === wired ? { connection: { nodeId: 'uv', outputKey: 'uv' } } : {}) }]));
  return { id, type, position: { x: 0, y: 0 }, params: { ...def.defaultParams, ...params }, inputs, outputs: { ...def.outputs } } as GraphNode;
};
const uv: GraphNode = { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, params: {}, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useNodeGraphStore.setState({
    nodes: [uv, node('r2', 'rotate2d', { angle: 1.1 }, 'input'), node('pl', 'place2D', { x: 0.2 }, 'uv')],
    activeGroupPath: [],
  });
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const types = () => useNodeGraphStore.getState().nodes.map(n => n.type);
const click = (el: Element | null) => act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text) ?? null;

describe('the pill on a card that switches with a rounding difference', () => {
  it('says so, and Keep leaves it; Switch switches', () => {
    const r2 = useNodeGraphStore.getState().nodes[1];
    act(() => root.render(<SwitchToTransformButton node={r2} />));
    const pill = host.querySelector('[data-switch-to-transform]')!;
    expect(pill.getAttribute('data-switch-to-transform')).toBe('inexact');
    expect(pill.getAttribute('title')).toMatch(/tiny rounding amount/);
    click(pill);
    expect(document.querySelector('[data-switch-to-transform-note]')?.textContent).toMatch(/Output may differ by a tiny rounding amount/);
    click(button('Keep'));
    expect(document.querySelector('[data-switch-to-transform-note]')).toBeNull();
    expect(types()).toEqual(['uv', 'rotate2d', 'place2D']);
    click(pill);
    click(button('Switch'));
    expect(types()).toEqual(['uv', 'transform', 'place2D']);
  });

  it('an exact one switches straight away', () => {
    const pl = useNodeGraphStore.getState().nodes[2];
    act(() => root.render(<SwitchToTransformButton node={pl} />));
    const pill = host.querySelector('[data-switch-to-transform]')!;
    expect(pill.getAttribute('data-switch-to-transform')).toBe('on');
    click(pill);
    expect(types()).toEqual(['uv', 'rotate2d', 'transform']);
  });
});

describe('Switch all with some switches off by rounding', () => {
  it('lists the two groups; turning the rounding group off switches only the exact ones', () => {
    const st = useNodeGraphStore.getState();
    const preview = previewSwitchAll(st.nodes, st.play);
    const onClose = vi.fn();
    act(() => root.render(<SwitchAllDialog preview={preview} onClose={onClose} />));
    expect(document.querySelector('[data-testid="switch-all-exact"]')?.textContent).toMatch(/Exact \(1\)/);
    expect(document.querySelector('[data-testid="switch-all-inexact"]')?.textContent).toMatch(/Tiny rounding difference \(1\)/);
    expect(button('Switch 2')).not.toBeNull();
    click(document.querySelector('[data-testid="switch-all-inexact"] [role="switch"]'));
    click(button('Switch 1'));
    expect(onClose).toHaveBeenCalled();
    expect(types()).toEqual(['uv', 'rotate2d', 'transform']);
  });

  it('a node unticked on its own is left', () => {
    const st = useNodeGraphStore.getState();
    act(() => root.render(<SwitchAllDialog preview={previewSwitchAll(st.nodes, st.play)} onClose={() => {}} />));
    click(document.querySelector('[data-testid="switch-all-exact"] input[type="checkbox"]'));
    click(button('Switch 1'));
    expect(types()).toEqual(['uv', 'transform', 'place2D']);
  });
});
