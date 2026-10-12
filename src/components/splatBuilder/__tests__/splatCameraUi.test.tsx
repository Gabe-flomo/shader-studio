// @vitest-environment jsdom
/**
 * The Splat builder's Camera section (docs/camera-projections.md): the March Camera's Perspective, Normal by default,
 * Reverse showing its strength and Converge at.
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
import { useSplatBuilder } from '../../../splatBuilder/store';
import { starterSplatScene } from '../../../splatBuilder/spec';
import { CameraSection } from '../panels';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
const $ = (sel: string) => document.body.querySelector(sel);
const text = () => document.body.textContent ?? '';

describe('Splat builder: Camera → Perspective', () => {
  it('Normal by default; Reverse shows its two sliders; Orthographic and back to Normal', () => {
    useSplatBuilder.setState({ spec: starterSplatScene() });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<CameraSection />));
    mounted.push({ root, host });
    expect($('[data-splat-projection]')?.getAttribute('data-splat-projection')).toBe('normal');
    expect(text()).not.toMatch(/Converge at/);
    act(() => { useSplatBuilder.getState().edit(d => { d.camera.projection = 'reverse'; }); });
    expect($('[data-splat-projection]')?.getAttribute('data-splat-projection')).toBe('reverse');
    expect(text()).toMatch(/Reverse strength/);
    expect(text()).toMatch(/Converge at/);
    const ortho = [...document.querySelectorAll('[data-splat-projection] button')].find(b => b.textContent === 'Orthographic') as HTMLElement;
    act(() => { ortho.click(); });
    expect(useSplatBuilder.getState().spec.camera.projection).toBe('orthographic');
    expect(text()).not.toMatch(/Converge at/);
    const normal = [...document.querySelectorAll('[data-splat-projection] button')].find(b => b.textContent === 'Normal') as HTMLElement;
    act(() => { normal.click(); });
    expect(useSplatBuilder.getState().spec.camera.projection).toBeUndefined();
  });
});
