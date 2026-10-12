// @vitest-environment jsdom
/**
 * Quick controls in the 2D Scene Builder (sceneBuilder2d/quick.ts, docs/scene-builder-2d.md "Quick controls"):
 * a builder slider pinned from its row becomes a mini slider under the preview that sets the same value, a Play
 * control on the built param after Build (queued before), reorderable and removable; Open in Play builds and opens
 * Play on its Controls page.
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
import { ShapesTab } from '../SceneBuilder2DModal';
import { QUICK_PIN_API, QuickControls } from '../QuickControls';
import { QuickPinContext } from '../../builders/quickPinContext';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { emptyScene, newShape, type Scene2D } from '../../../sceneBuilder2d/spec';
import { buildFromBuilder2D } from '../../../sceneBuilder2d/actions';
import { find2dBuild } from '../../../sceneBuilder2d/apply';
import { findTarget, movePin, pinValue, removePin, setPinValue, type QuickPin } from '../../../sceneBuilder2d/quick';
import { probeEdit } from '../../../sceneBuilder2d/store';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { usePlaySplit } from '../../play/playSplit';
const paramTarget = (nodeId: string, key: string) => `${nodeId}::${key}`;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<QuickPinContext.Provider value={QUICK_PIN_API}><ShapesTab /><QuickControls /></QuickPinContext.Provider>));
  mounted.push({ root, host });
  return host;
}
const click = (el: Element | null | undefined) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };

function scene(): Scene2D {
  const s = emptyScene();
  s.layers.push(newShape('circle', 's1'), newShape('ring', 's2', { at: [0.4, 0.1] }));
  return s;
}

beforeEach(() => {
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useNodeGraphStore.getState().setPlay(p => ({ ...p, controls: [] }));
  useSceneBuilder2D.getState().openWith(scene());
  useSceneBuilder2D.getState().select('s1');
});

describe('Quick controls: the value a slider sets', () => {
  it('found by trying the slider\'s change on a copy: the path, and a straight line when it stores a scaled number', () => {
    const sb = useSceneBuilder2D.getState();
    const s = sb.scene;
    const t = findTarget(s, v => probeEdit(() => sb.edit(d => { d.layers[1].at = [v, d.layers[1].at[1]]; })), { min: -2, max: 2 })!;
    expect(t).toEqual({ path: ['layers', { id: 's2' }, 'at', 0], scale: 1, offset: 0 });
    // Nothing changed in the real scene.
    expect(useSceneBuilder2D.getState().scene).toBe(s);
    const scaled = findTarget(s, v => probeEdit(() => sb.edit(d => { d.layers[0].scale = v / 2 + 1; })), { min: 0, max: 4 })!;
    expect(scaled).toMatchObject({ path: ['layers', { id: 's1' }, 'scale'], scale: 0.5, offset: 1 });
    const pin: QuickPin = { id: 'x', label: 'x', path: scaled.path, scale: scaled.scale, offset: scaled.offset, min: 0, max: 4 };
    const d = structuredClone(s);
    setPinValue(d, pin, 3);
    expect(d.layers[0].scale).toBe(2.5);
    expect(pinValue(d, pin)).toBe(3);
    // A slider that sets two numbers can't be one.
    expect(findTarget(s, v => probeEdit(() => sb.edit(d2 => { d2.layers[0].scale = v; d2.layers[0].rot = v; })), { min: 0, max: 4 })).toBeNull();
  });

  it('reorders and removes', () => {
    const a = { id: 'a' } as QuickPin, b = { id: 'b' } as QuickPin, c = { id: 'c' } as QuickPin;
    expect(movePin([a, b, c], 'c', -1).map(p => p.id)).toEqual(['a', 'c', 'b']);
    expect(movePin([a, b, c], 'a', -1).map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(removePin([a, b, c], 'b').map(p => p.id)).toEqual(['a', 'c']);
  });
});

describe('Quick controls in the 2D Scene Builder', () => {
  it('pin Position X → a mini slider that sets it live → a Play control on the Transform after Build', () => {
    const host = mount();
    // The Place card (folded by default): open it.
    if (!host.querySelector('[aria-label="Add Position X to quick controls"]')) click(host.querySelector('[data-sb-card="it2-s1-place"] > div'));
    click(host.querySelector('[aria-label="Add Position X to quick controls"]'));
    const q = useSceneBuilder2D.getState().scene.quick!;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ label: 'Circle · Position X', path: ['layers', { id: 's1' }, 'at', 0], play: { role: 's1:place', keys: ['x'] } });
    // Not built yet: queued.
    expect(host.querySelector('[data-quick-status]')?.getAttribute('data-quick-status')).toBe('queued');
    expect(useNodeGraphStore.getState().play.controls).toHaveLength(0);
    // The mini slider sets the scene's value.
    act(() => useSceneBuilder2D.getState().edit(d => { setPinValue(d, q[0], 0.7); }));
    expect(useSceneBuilder2D.getState().scene.layers[0].at[0]).toBe(0.7);
    act(() => useSceneBuilder2D.getState().edit(d => { d.layers[0].at = [0, 0]; }));
    // Build: the circle at rest still gets its Transform (its place is pinned), and the pin is a Play control on it.
    act(() => { expect(buildFromBuilder2D()).toBe(true); });
    const st = useNodeGraphStore.getState();
    const built = find2dBuild(st.nodes, useSceneBuilder2D.getState().targetSceneId!)!;
    const tr = built.byRole.get('s1:place')!;
    expect(tr.type).toBe('transform');
    expect(st.play.controls.map(c => c.target)).toContain(paramTarget(tr.id, 'x'));
    expect(host.querySelector('[data-quick-status]')?.getAttribute('data-quick-status')).toBe('play');
  });

  it('reorder and remove in the list; Open in Play builds, attaches and opens Play on Controls', async () => {
    const host = mount();
    if (!host.querySelector('[aria-label="Add Position X to quick controls"]')) click(host.querySelector('[data-sb-card="it2-s1-place"] > div'));
    click(host.querySelector('[aria-label="Add Position X to quick controls"]'));
    click(host.querySelector('[aria-label="Add Position Y to quick controls"]'));
    click(host.querySelector('[aria-label="Add Rotate to quick controls"]'));
    const ids = () => [...host.querySelectorAll('[data-quick-control]')].map(e => (e.getAttribute('data-quick-control') ?? '').split('/').pop());
    expect(ids()).toEqual(['0', '1', 'rot']);
    click(host.querySelectorAll('[data-quick-up]')[2]);
    expect(ids()).toEqual(['0', 'rot', '1']);
    click(host.querySelectorAll('[data-quick-remove]')[0]);
    expect(ids()).toEqual(['rot', '1']);
    const asked = useNodeGraphStore.getState().playOpenRequest;
    usePlaySplit.getState().setRailPage('layers');
    await act(async () => { (host.querySelector('[data-quick-open-play]') as HTMLElement).click(); await new Promise(r => setTimeout(r, 0)); });
    const st = useNodeGraphStore.getState();
    expect(st.playOpenRequest).toBe(asked + 1);
    expect(usePlaySplit.getState().railPage).toBe('controls');
    const tr = find2dBuild(st.nodes, useSceneBuilder2D.getState().targetSceneId!)!.byRole.get('s1:place')!;
    expect(st.play.controls.map(c => c.target)).toEqual(expect.arrayContaining([paramTarget(tr.id, 'rotate'), paramTarget(tr.id, 'y')]));
  });
});
