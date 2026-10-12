// @vitest-environment jsdom
/**
 * The Shapes tab keeps Picture in pieces (and shows an older scene's grid, read-only); the Combine
 * tab joins a layer with the next one by any of the seven combines.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CombineTab, ShapesTab } from '../SceneBuilder2DModal';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { emptyScene, newShape } from '../../../sceneBuilder2d/spec';
import { templateScene } from '../../../sceneBuilder2d/templates';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
function mount(el: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  mounted.push({ root, host });
  return host;
}

describe('the Shapes tab', () => {
  it('has Picture in pieces, and it still edits the scene\'s pieces', () => {
    useSceneBuilder2D.getState().openWith(templateScene('pieces'));
    const host = mount(<ShapesTab />);
    expect(host.textContent).toContain('Picture in pieces');
    expect(host.textContent).toContain('Pieces across');
    expect(useSceneBuilder2D.getState().scene.pieces?.count).toBe(36);
  });

  it('shows an older scene\'s grid with the note to use the Grid builder', () => {
    useSceneBuilder2D.getState().openWith(templateScene('rippleGrid'));
    const host = mount(<ShapesTab />);
    expect(host.querySelector('[data-older-grid]')?.textContent).toContain('This scene has a grid: edit it in the Grid builder');
    expect(host.textContent).toContain('Open the Grid builder');
  });
});

describe('the Combine tab', () => {
  it('joins the selected layer with the next by a smooth union, colours blended', () => {
    const s = emptyScene();
    s.layers.push(newShape('circle', 's1'), newShape('circle', 's2', { at: [0.3, 0] }));
    useSceneBuilder2D.getState().openWith(s);
    useSceneBuilder2D.getState().select('s1');
    const host = mount(<CombineTab />);
    const btn = host.querySelector('[aria-label="Join with the next layer"] [data-combine-op="smooth-union"]') as HTMLButtonElement;
    expect(btn.title).toMatch(/Melts the shapes together/);
    act(() => btn.click());
    const g = useSceneBuilder2D.getState().scene.layers[0];
    expect(useSceneBuilder2D.getState().scene.layers).toHaveLength(1);
    expect(g.type === 'group' && g.op === 'union' && g.k > 0 && g.mix && g.children.length === 2).toBe(true);
    expect(host.querySelectorAll('[aria-label="Combine operator"] button')).toHaveLength(7);
  });
});
