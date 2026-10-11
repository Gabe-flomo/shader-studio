// @vitest-environment jsdom
/**
 * An Expression Block card's faces (Code → Preview → Note) flip only with the pager: a sideways
 * trackpad scroll or a swipe over the card is the canvas being panned, so it passes through to it
 * and leaves the face as it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../../store/useNodeGraphStore';
import { CodeCard } from '../CodeCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const block = {
  id: 'blk', type: 'exprNode', position: { x: 0, y: 0 },
  inputs: { p: { type: 'vec2', label: 'p' } }, outputs: { result: { type: 'float', label: 'Result' } },
  params: {
    inputs: [{ name: 'p', type: 'vec2', slider: null }], outputType: 'float',
    lines: [{ lhs: 'float z', op: '=', rhs: '1.0 - dot(p, p)' }], result: 'z',
    __comment: 'A soft disc.',
  },
} as unknown as GraphNode;

let root: Root;
let el: HTMLDivElement;
let canvasWheels = 0;
const onCanvasWheel = () => { canvasWheels++; };
beforeEach(() => {
  canvasWheels = 0;
  useNodeGraphStore.setState({ nodes: [block], activeGroupPath: [] });
  el = document.createElement('div');
  el.addEventListener('wheel', onCanvasWheel); // the canvas under the card
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root.render(<CodeCard node={block} />));
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const card = () => document.querySelector<HTMLElement>('[data-code-card]')!;
const pageName = () => document.querySelector('[data-card-page-name]')!.textContent;
const wheel = (deltaX: number, deltaY = 0) => act(() => { card().dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true })); });
const touch = (type: string, x: number, y: number) => act(() => {
  const t = { identifier: 1, target: card(), clientX: x, clientY: y } as unknown as Touch;
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: Touch[]; changedTouches: Touch[] };
  ev.touches = type === 'touchend' ? [] : [t];
  ev.changedTouches = [t];
  card().dispatchEvent(ev);
});

describe('the code card’s faces', () => {
  it('a sideways trackpad scroll over the card pans the canvas and keeps the face', () => {
    const before = pageName();
    for (let i = 0; i < 12; i++) wheel(i % 2 ? 40 : 60);
    for (let i = 0; i < 12; i++) wheel(-60);
    expect(pageName()).toBe(before);
    expect(canvasWheels).toBe(24); // every event reached the canvas
  });

  it('a sideways swipe on a touch screen keeps the face', () => {
    const before = pageName();
    touch('touchstart', 200, 100);
    touch('touchmove', 80, 102);
    touch('touchend', 60, 102);
    expect(pageName()).toBe(before);
  });

  it('the pager’s arrows and dots switch it', () => {
    const before = pageName();
    act(() => document.querySelector<HTMLElement>('[aria-label="Next page"]')!.click());
    expect(pageName()).not.toBe(before);
    act(() => document.querySelector<HTMLElement>('[aria-label="Previous page"]')!.click());
    expect(pageName()).toBe(before);
    const dots = document.querySelectorAll<HTMLElement>('[data-card-page-dot]');
    expect(dots.length).toBeGreaterThan(1);
    act(() => dots[dots.length - 1].click());
    expect(pageName()).not.toBe(before);
  });
});
