// @vitest-environment jsdom
/**
 * The Agents builder's 3D viewport turns, pans and zooms Draw agents' camera (OrbitPad.tsx), as the 3D Scene
 * Builder's does; the 2D viewport has no orbit pad (its drags draw regions and move handles as before).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../../builders/windows';
import { AgentBuilder } from '../AgentBuilder';
import { CAMERA_3D } from '../../../agentRules/space3d';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect; };

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const draw = () => useNodeGraphStore.getState().nodes.find(n => n.type === 'drawAgents')!;
const fire = (el: Element, type: string, init: PointerEventInit) => act(() => { el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', ...init })); });

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

function start(kind: string, space: '2d' | '3d') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<AgentBuilder groupId={null} onClose={() => {}} />));
  mounted.push({ root, host });
  if (space === '3d') click($$('[aria-label="Start in 2D or 3D"] button').find(b => b.textContent === '3D') ?? null);
  click($(`[data-start-kind="${kind}"]`));
}

describe('3D viewport camera gestures', () => {
  it('drag turns the camera, right-drag pans it, scroll zooms, double-click resets: all Draw agents\' camera', () => {
    start('particles', '3d');
    const pad = $('[data-orbit-pad]')!;
    expect(pad).toBeTruthy();
    expect(pad.getAttribute('data-orbit-pad')).toBe(draw().id);
    const before = { ...draw().params } as Record<string, number>;

    // Drag 50 px right: Angle turns by −20°.
    fire(pad, 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    fire(pad, 'pointermove', { clientX: 150, clientY: 100 });
    fire(pad, 'pointerup', { clientX: 150, clientY: 100 });
    expect(draw().params.camAngle).toBeCloseTo(before.camAngle - 20, 3);
    expect(draw().params.camElevation).toBeCloseTo(before.camElevation, 3);

    // Right-drag: Translate X / Y / Z move.
    fire(pad, 'pointerdown', { button: 2, clientX: 100, clientY: 100 });
    fire(pad, 'pointermove', { clientX: 140, clientY: 120 });
    fire(pad, 'pointerup', { clientX: 140, clientY: 120 });
    const p = draw().params as Record<string, number>;
    expect(Math.hypot(p.camX ?? 0, p.camY ?? 0, p.camZ ?? 0)).toBeGreaterThan(0);

    // Scroll away: further.
    act(() => { pad.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true })); });
    expect(draw().params.camDist).toBeGreaterThan(before.camDist);

    // Double-click: the starting view.
    act(() => { pad.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(draw().params).toMatchObject({ camAngle: CAMERA_3D.camAngle, camElevation: CAMERA_3D.camElevation, camDist: CAMERA_3D.camDist, camX: 0, camY: 0, camZ: 0 });
  });

  it('2D has no orbit pad', () => {
    start('particles', '2d');
    expect($('[data-live-viewport]')).toBeTruthy();
    expect($('[data-orbit-pad]')).toBeNull();
  });
});
