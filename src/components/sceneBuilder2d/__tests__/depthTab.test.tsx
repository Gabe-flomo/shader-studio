// @vitest-environment jsdom
/**
 * The Depth tab's sections use the builders' shared mute (⊘) like every other card: Size by depth and
 * Space by depth are each a card whose ⊘ switches them on and off, keeping their settings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DepthTab } from '../DepthTab';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { emptyScene } from '../../../sceneBuilder2d/spec';
import { newDepthPic } from '../../../sceneBuilder2d/depth';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<DepthTab />));
  mounted.push({ root, host });
  return host;
}

describe('the Depth tab', () => {
  it('Size and Space by depth are switched by the shared mute toggle, not switches of their own', () => {
    const s = emptyScene();
    s.depth = newDepthPic('photo', { size: { on: true, far: 0.3, near: 2 } });
    act(() => useSceneBuilder2D.getState().replace(s));
    const host = mount();
    expect(host.querySelector('[role="switch"], input[type="checkbox"]')).toBeNull();
    const toggles = [...host.querySelectorAll<HTMLElement>('[data-mute-toggle]')];
    expect(toggles.length).toBe(2);
    const [size, space] = toggles;
    expect(size.getAttribute('aria-pressed')).toBe('false'); // size is on
    expect(space.getAttribute('aria-pressed')).toBe('true'); // space is off
    act(() => { size.click(); });
    const d = useSceneBuilder2D.getState().scene.depth!;
    expect(d.size).toEqual({ on: false, far: 0.3, near: 2 }); // switched off, settings kept
    act(() => { space.click(); });
    expect(useSceneBuilder2D.getState().scene.depth!.space.on).toBe(true);
  });
});
