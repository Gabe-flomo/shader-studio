// @vitest-environment jsdom
/**
 * Every shape's settings in the Shapes section take a drag, a key and a typed number (docs/scene-builder-3d.md,
 * "The sections"): its sizes (a cone's Angle ° and Height…), Position, Rotation and Shine.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useSceneBuilder } from '../../../sceneBuilder/store';
import { parseRecipe } from '../../../sceneBuilder/recipe';
import { SHAPES, type ShapeSpec } from '../../../sceneBuilder/spec';
import { SceneBuilderModal } from '../SceneBuilderModal';
import { TRACK_MIN } from '../../builders/BuilderSlider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } useSceneBuilder.getState().close(); });
const sb = () => useSceneBuilder.getState();
const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} });
const shape = () => sb().spec.root.children[0] as ShapeSpec;
const inspector = () => document.body.querySelector('[data-inspector="shapes"]') as HTMLElement;
const sliders = () => Array.from(inspector().querySelectorAll('[role="slider"]')) as HTMLElement[];
const slider = (label: string) => sliders().find(s => s.getAttribute('aria-label') === label) as HTMLElement;

function key(el: HTMLElement, k: string) {
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
}
function typeInto(el: HTMLElement, text: string) {
  // The number chip beside the track: focus, set, Enter.
  const input = el.parentElement!.querySelector('input') as HTMLInputElement;
  expect(input).toBeTruthy();
  act(() => { input.focus(); });
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  act(() => { input.blur(); });
}
function drag(el: HTMLElement, dx: number) {
  el.setPointerCapture = () => {};
  const ev = (type: string, x: number) => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    return e;
  };
  act(() => { el.dispatchEvent(ev('pointerdown', 100)); });
  for (let i = 1; i <= 4; i++) act(() => { el.dispatchEvent(ev('pointermove', 100 + (dx * i) / 4)); });
  act(() => { el.dispatchEvent(ev('pointerup', 100 + dx)); });
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [output()] });
});

describe('shape settings take input', () => {
  it('a cone\'s Angle ° and Height: a key, a typed number and a drag each change the scene', () => {
    sb().openWith(parseRecipe('cone').spec, { tab: 'shapes' });
    act(() => sb().select(shape().id));
    mount(<SceneBuilderModal />);
    const angle0 = Number(shape().size.angle ?? 22.92);
    key(slider('Angle'), 'ArrowRight');
    expect(Number(shape().size.angle)).toBeGreaterThan(angle0);
    typeInto(slider('Angle'), '40');
    expect(Number(shape().size.angle)).toBeCloseTo(40, 5);
    drag(slider('Height'), -80); // the ruler moves under the needle: dragging left raises it
    expect(Number(shape().size.h)).toBeGreaterThan(1);
    typeInto(slider('Height'), '2.5');
    expect(Number(shape().size.h)).toBeCloseTo(2.5, 5);
  });

  it('every track keeps room beside its number: X / Y / Z one axis a line, a least track width', () => {
    // The report: Position / Rotation as three columns left each track 0 px wide (the number chip
    // took the column), and a narrow panel did the same to Angle ° and Height.
    sb().openWith(parseRecipe('cone').spec, { tab: 'shapes' });
    act(() => sb().select(shape().id));
    mount(<SceneBuilderModal />);
    for (const s of sliders()) expect(s.style.minWidth, s.getAttribute('aria-label')!).toBe(`${TRACK_MIN}px`);
    const rows = inspector().querySelectorAll('[data-vec3-row]');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect((r as HTMLElement).style.flexDirection).toBe('column');
  });

  it('every shape kind: each slider in its settings moves its value', () => {
    for (const def of SHAPES) {
      sb().openWith(parseRecipe(def.kind).spec, { tab: 'shapes' });
      act(() => sb().select(shape().id));
      mount(<SceneBuilderModal />);
      const all = sliders();
      expect(all.length, def.kind).toBeGreaterThan(4);
      for (const s of all) {
        if (s.getAttribute('aria-disabled')) throw new Error(`${def.kind}: ${s.getAttribute('aria-label')} is disabled`);
        const label = s.getAttribute('aria-label')!;
        const before = JSON.stringify(shape());
        key(slider(label) ?? s, 'ArrowRight');
        const after = JSON.stringify(shape());
        if (before === after) key(slider(label) ?? s, 'ArrowLeft');
        expect(JSON.stringify(shape()) !== before, `${def.kind}: ${label}`).toBe(true);
      }
      for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
      sb().close();
    }
  });
});
