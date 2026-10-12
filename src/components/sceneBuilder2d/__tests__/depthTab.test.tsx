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
import { useDepthView } from '../../../builders/depthPreview';

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
    // (The Preview card's Heat map and Side by side are the only switches: they are about the preview.)
    expect([...host.querySelectorAll('[role="switch"], input[type="checkbox"]')].filter(e => !e.closest('[data-depth-view-switch]'))).toEqual([]);
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

  it('the Preview switch: Result | Picture | Depth | Shaped depth, plus the effects that are on; it drives the preview and resets on leaving', () => {
    const s = emptyScene();
    s.depth = newDepthPic('photo', { size: { on: true, far: 0.3, near: 2 } });
    act(() => useSceneBuilder2D.getState().replace(s));
    const host = mount();
    const sw = host.querySelector('[data-depth-view-switch]')!;
    expect(sw).toBeTruthy();
    const labels = [...sw.querySelectorAll('[role="radiogroup"] [role="radio"], [role="radiogroup"] button')].map(b => b.textContent);
    expect(labels).toEqual(['Result', 'Picture', 'Depth', 'Shaped depth', 'Size']);
    const pick = (label: string) => act(() => { ([...sw.querySelectorAll<HTMLElement>('[role="radiogroup"] [role="radio"], [role="radiogroup"] button')].find(b => b.textContent === label))!.click(); });
    pick('Shaped depth');
    expect(useDepthView.getState().view).toBe('shaped');
    // Side by side: a tile per view.
    act(() => { useDepthView.getState().setStrip(true); });
    expect([...host.querySelectorAll('[data-depth-tile]')].map(t => t.getAttribute('data-depth-tile'))).toEqual(['result', 'picture', 'depth', 'shaped', 'size']);
    act(() => { (host.querySelector('[data-depth-tile="depth"]') as HTMLElement).click(); });
    expect(useDepthView.getState().view).toBe('depth');
    // An effect switched off while its view shows: back to the result.
    pick('Size');
    act(() => useSceneBuilder2D.getState().edit(d => { d.depth!.size.on = false; }));
    expect(useDepthView.getState().view).toBe('result');
    pick('Depth');
    // Leaving the tab: the preview shows the result again.
    act(() => { for (const m of mounted.splice(0)) { m.root.unmount(); m.host.remove(); } });
    expect(useDepthView.getState().view).toBe('result');
    act(() => { useDepthView.getState().setStrip(false); });
  });
});
