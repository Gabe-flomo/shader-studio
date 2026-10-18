// @vitest-environment jsdom
/**
 * The desktop top bar: every button has an accessible name (Import / GLSL / Export / Record
 * included), and every page tab shows its name, with no hover expansion.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesktopTopNav } from '../DesktopTopNav';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<DesktopTopNav page="studio" onPageChange={() => {}} onRecord={() => {}} />));
  return host;
}

describe('DesktopTopNav', () => {
  it('every button has an accessible name', () => {
    const el = mount();
    const nameless = Array.from(el.querySelectorAll('button')).filter(b => !(b.getAttribute('aria-label') || b.textContent?.trim()));
    expect(nameless.map(b => b.outerHTML.slice(0, 80))).toEqual([]);
    for (const name of ['Import a .play file, graph or presentation file', 'Import a GLSL shader as a node', 'Export this graph as a .play file', 'Record the preview as video or a still']) {
      expect(el.querySelector(`button[aria-label="${name}"]`), name).toBeTruthy();
    }
  });

  it('every page tab shows its name, and hovering the strip changes nothing', () => {
    const el = mount();
    const tabs = Array.from(el.querySelectorAll('[role="tab"]'));
    expect(tabs.map(t => t.textContent)).toEqual(['Studio', 'Play', 'Present', 'Functions', 'Shader', 'Convert', 'Files']);
    const before = el.innerHTML;
    act(() => { el.querySelector('[role="tablist"]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(el.innerHTML).toBe(before);
  });
});
