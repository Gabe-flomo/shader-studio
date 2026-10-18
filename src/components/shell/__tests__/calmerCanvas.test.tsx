// @vitest-environment jsdom
/**
 * A calmer canvas (UX audit §3.4): the canvas toolbar keeps the view controls and puts the rarely
 * used whole-graph actions in one "Graph ⋯" menu, with every action still there; the Play panel's
 * seven layout radios are one Layout menu; node card footers show on hover (CSS in index.css).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { graphMenuItems, type GraphMenuActions } from '../canvasGraphMenu';
import { CanvasToolbar } from '../CanvasToolbar';
import { playLayoutItems, SIDE_OPTIONS, SIDEBAR_OPTIONS } from '../../play/playLayoutMenu';
import type { MenuItem } from '../../ui/Menu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

const labels = (items: MenuItem[]) => items.flatMap(i => (i !== 'separator' && !('heading' in i) ? [i.label] : []));
const all = (over: Partial<GraphMenuActions> = {}): GraphMenuActions => ({
  readOnly: false, topLevel: true, multiProgram: true, showPasses: false, showOutline: false,
  onToggleOutline: vi.fn(), onTogglePasses: vi.fn(), onBake: vi.fn(), onRandomize: vi.fn(), onRandomizeOptions: vi.fn(),
  onOptimize: vi.fn(), onClear: vi.fn(), onClearMinimal: vi.fn(), ...over,
});

describe('Graph ⋯ menu', () => {
  it('holds every action that left the toolbar, each wired to its handler', () => {
    const a = all();
    const items = graphMenuItems(a);
    expect(labels(items)).toEqual(['Outline', 'Show passes', 'Randomise settings', 'Randomise options…', 'Optimise graph…', 'Bake the picture…', 'Reset to the starter graph', 'Clear to UV and Output']);
    const handlers = [a.onToggleOutline, a.onTogglePasses, a.onRandomize, a.onRandomizeOptions, a.onOptimize, a.onBake, a.onClear, a.onClearMinimal];
    items.filter((i): i is Extract<MenuItem, { onSelect: () => void }> => i !== 'separator' && !('heading' in i)).forEach((i, k) => {
      i.onSelect();
      expect(handlers[k]).toHaveBeenCalledTimes(1);
    });
  });

  it('a locked canvas keeps only what changes nothing; Bake only at the top level; passes only with several programs', () => {
    expect(labels(graphMenuItems(all({ readOnly: true })))).toEqual(['Outline', 'Show passes']);
    expect(labels(graphMenuItems(all({ topLevel: false })))).not.toContain('Bake the picture…');
    expect(labels(graphMenuItems(all({ multiProgram: false })))).not.toContain('Show passes');
    expect(labels(graphMenuItems(all({ showOutline: true, showPasses: true })))).toContain('Hide the outline');
  });

  it('the toolbar has view controls and one Graph button, and opening it lists the actions', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <CanvasToolbar nodes={[]} topLevel zoom={1} onZoom={() => {}} onResetZoom={() => {}} onFit={() => {}} onAutoLayout={() => {}}
        showMinimap={false} onToggleMinimap={() => {}} showOutline={false} onToggleOutline={() => {}} onClear={() => {}} onClearMinimal={() => {}}
        onOptimize={() => {}} onBake={() => {}} />,
    ));
    const names = Array.from(host.querySelectorAll('button')).map(b => b.getAttribute('aria-label') ?? b.textContent ?? '');
    // Moved into the menu: no toolbar button for them any more.
    for (const gone of ['Bake the picture', 'Optimise graph', 'Randomise settings', 'Reset to the starter graph', 'Outline: list every node']) {
      expect(names.some(n => n.startsWith(gone)), gone).toBe(false);
    }
    for (const kept of ['Zoom out', 'Zoom in', 'Show minimap']) expect(names.some(n => n.startsWith(kept)), kept).toBe(true);
    const graph = host.querySelector<HTMLButtonElement>('button[aria-label^="Graph"]')!;
    expect(graph).toBeTruthy();
    act(() => { graph.click(); });
    const menu = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')).map(b => b.textContent ?? '');
    for (const want of ['Outline', 'Randomise settings', 'Optimise graph…', 'Bake the picture…', 'Reset to the starter graph']) {
      expect(menu.some(t => t.includes(want)), want).toBe(true);
    }
  });
});

describe('Play Layout menu', () => {
  it('offers the four sides and three sidebar modes, marks the current ones, and sets them', () => {
    const setSide = vi.fn(), setSidebar = vi.fn();
    const items = playLayoutItems('right', 'rail', setSide, setSidebar, '#00f');
    expect(labels(items)).toEqual([...SIDE_OPTIONS.map(o => o.label), ...SIDEBAR_OPTIONS.map(o => o.label)]);
    const rows = items.filter((i): i is Extract<MenuItem, { onSelect: () => void }> => i !== 'separator' && !('heading' in i));
    expect(rows.filter(r => r.iconColor === '#00f').map(r => r.label)).toEqual(['Panel right of the picture', 'Fold the sidebar into icons']);
    rows[2].onSelect();
    expect(setSide).toHaveBeenCalledWith('top');
    rows[6].onSelect();
    expect(setSidebar).toHaveBeenCalledWith('hidden');
  });
});

describe('node card footers', () => {
  it('show on hover, selection, focus or touch; a button that is on always shows', () => {
    const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');
    expect(css).toMatch(/@media \(hover: hover\)[\s\S]*\[data-card-footer\]:not\(\[data-reveal\]\) > \* \{ opacity: 0/);
    expect(css).toContain('[data-node-id]:hover [data-card-footer] > *');
    expect(css).toContain('aria-pressed="true"');
    const card = readFileSync(resolve(__dirname, '../../NodeGraph/NodeComponent.tsx'), 'utf8');
    expect(card).toContain("data-reveal={isSelected || isTouchDevice ? '' : undefined}");
  });
});
