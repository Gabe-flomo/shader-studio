// @vitest-environment jsdom
/**
 * The phone's Browse and the desktop node list use the same category names and the same grouping
 * (libraryRows.ts): "2D Shapes" on both, in the same sections, never the raw "2D Primitives".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CATEGORY_SECTIONS, libraryLayout, rowLabel } from '../libraryRows';
import { MobileNodeBrowser } from '../MobileNodeBrowser';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

describe('one category model on desktop and phone', () => {
  it('the layout is the desktop sections, in order, with the desktop names', () => {
    const layout = libraryLayout(new Set());
    const desktop = CATEGORY_SECTIONS.map(s => s.label);
    expect(layout.map(s => s.label)).toEqual(desktop.filter(l => layout.some(s => s.label === l)));
    for (const sec of layout) {
      const want = CATEGORY_SECTIONS.find(s => s.label === sec.label)!.categories.map(rowLabel);
      for (const r of sec.rows) expect(want).toContain(r.label);
    }
    const names = layout.flatMap(s => s.rows.map(r => r.label));
    expect(names).toContain('2D Shapes');
    expect(names).not.toContain('2D Primitives');
  });

  it('the phone Browse lists those sections and names', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<MobileNodeBrowser onClose={() => {}} />));
    const sections = Array.from(host.querySelectorAll('[data-browse-section]')).map(e => e.getAttribute('data-browse-section'));
    expect(sections).toEqual(libraryLayout(new Set()).map(s => s.label));
    const rows = Array.from(host.querySelectorAll('[data-browse-row]')).map(b => b.textContent ?? '');
    expect(rows.some(t => t.startsWith('2D Shapes'))).toBe(true);
    expect(rows.some(t => t.startsWith('2D Primitives'))).toBe(false);
  });

  it('the phone Browse searches nodes: matches replace the categories, a result opens its page', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<MobileNodeBrowser onClose={() => {}} />));
    const input = host.querySelector<HTMLInputElement>('[data-browse-search] input')!;
    const type = (v: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    type('circle');
    expect(host.querySelector('[data-browse-section]')).toBeNull();
    const results = Array.from(host.querySelectorAll('[data-browse-result]')).map(b => b.getAttribute('data-browse-result'));
    expect(results).toContain('circleSDF');
    type('zzqqxx');
    expect(host.textContent).toContain('No nodes match');
    type('circle');
    act(() => host!.querySelector<HTMLButtonElement>('[data-browse-result="circleSDF"]')!.click());
    expect(host.textContent).toContain('Back to results');
    expect(host.textContent).toContain('Add disconnected');
  });
});
