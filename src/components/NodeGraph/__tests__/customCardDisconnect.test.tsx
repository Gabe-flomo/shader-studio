// @vitest-environment jsdom
/**
 * A custom card's input sockets behave as every card's (NodeComponent inSocketUp / inSocketTouch): a click on a wired
 * socket takes the wire off, as one undo step; a tap does the same on a touch screen. The Texture card's UV used to
 * only finish a wire, so a wired UV couldn't be taken off from the card ("unable to disconnect UV from Texture").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { NodeComponent } from '../NodeComponent';
import type { GraphNode } from '../../../types/nodeGraph';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

let root: Root | null = null;
let host: HTMLElement | null = null;
const st = () => useNodeGraphStore.getState();
const noop = () => {};
const tex = () => st().nodes.find(n => n.id === 't')!;

function graph(): GraphNode[] {
  return [
    { id: 'u', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
    {
      id: 't', type: 'textureInput', position: { x: 300, y: 0 },
      inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'u', outputKey: 'uv' } } },
      outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } }, params: {},
    },
    { id: 'out', type: 'output', position: { x: 900, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} },
  ];
}
function show(onEnd = noop, onTap = noop) {
  act(() => { root!.render(<NodeComponent node={tex()} onStartConnection={noop} onEndConnection={onEnd} onTapInputSocket={onTap} />); });
}
const socket = () => host!.querySelector('[data-texture-uv-socket]')!;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  st().replaceGraph(graph());
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

describe('Texture card: UV socket', () => {
  it('a click on the wired UV takes the wire off; one undo puts it back', () => {
    show();
    expect(tex().inputs.uv.connection).toBeTruthy();
    act(() => { socket().dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); });
    expect(tex().inputs.uv.connection).toBeUndefined();
    act(() => st().undo());
    expect(tex().inputs.uv.connection).toEqual({ nodeId: 'u', outputKey: 'uv' });
  });

  it('a tap on the wired UV takes it off too; on an open UV a click finishes a wire being dragged', () => {
    show();
    act(() => { socket().dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true })); });
    expect(tex().inputs.uv.connection).toBeUndefined();
    const onEnd = vi.fn();
    show(onEnd);
    act(() => { socket().dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); });
    expect(onEnd).toHaveBeenCalledWith('t', 'uv');
  });

  it('a right-click on the socket does not take the wire off', () => {
    show();
    act(() => { socket().dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2 })); });
    expect(tex().inputs.uv.connection).toBeTruthy();
  });
});
