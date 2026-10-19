// @vitest-environment jsdom
/**
 * A calmer canvas (docs/page-canvas.md): the canvas toolbar in its old order (node count, frame time |
 * zoom | Fit, Auto layout, Maximize graph | Outline, Randomise), with no Do… bar, suggestions or Graph
 * menu; everything else that was on it is in the canvas's right-click menu
 * (canvasGraphMenu.ts), with every action still there; Randomise has one place, its button, whose
 * right-click menu holds the settings and the options. The Play panel's seven layout radios are one
 * Layout menu; node card footers show on hover (CSS in index.css).
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

const randomize = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../surprise/surpriseActions', async orig => ({
  ...(await orig<typeof import('../../surprise/surpriseActions')>()),
  randomizeGraphAction: randomize,
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasMenuItems, randomiseMenuItems, type CanvasMenuActions, type CanvasMenuItem, type CanvasMenuRow } from '../canvasGraphMenu';
import { CanvasToolbar } from '../CanvasToolbar';
import { useGraphMaximize } from '../graphLayout';
import { useViewport } from '../../../lib/viewport';
import { playLayoutItems, SIDEBAR_OPTIONS, sidebarIcon } from '../../play/playLayoutMenu';
import type { MenuItem } from '../../ui/Menu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ''; });

const labels = (items: MenuItem[]) => items.flatMap(i => (i !== 'separator' && !('heading' in i) ? [i.label] : []));
const rows = (items: CanvasMenuItem[]) => items.filter((i): i is CanvasMenuRow => i !== 'separator' && !('heading' in i));
const all = (over: Partial<CanvasMenuActions> = {}): CanvasMenuActions => ({
  readOnly: false, topLevel: true, multiProgram: true, showPasses: false, showMinimap: true, onToggleMinimap: vi.fn(),
  showNext: true, onToggleNext: vi.fn(), zoom: 0.75, onResetZoom: vi.fn(), onFit: vi.fn(), onAutoLayout: vi.fn(),
  onTogglePasses: vi.fn(), onOptimize: vi.fn(), onBake: vi.fn(), onClear: vi.fn(), onClearMinimal: vi.fn(), ...over,
});

const render = (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};

describe('canvas toolbar', () => {
  it('the old order: status | zoom | Fit, Auto layout, Maximize | Outline, Randomise; no clutter', () => {
    useViewport.setState({ breakpoint: 'desktop-lg' });
    const fit = vi.fn(), layout = vi.fn(), zoomTo = vi.fn();
    const h = render(<CanvasToolbar showOutline={false} onToggleOutline={() => {}} zoom={1} onZoom={zoomTo} onResetZoom={() => {}} onFit={fit} onAutoLayout={layout} />);
    const bar = h.querySelector('[data-canvas-toolbar]')!;
    const status = bar.querySelector('[data-graph-status]')!;
    expect(status).toBeTruthy();
    expect(bar.firstElementChild!.contains(status) || bar.firstElementChild === status).toBe(true);
    const buttons = Array.from(bar.querySelectorAll('button')).filter(b => !b.closest('[data-graph-status]'));
    const names = buttons.map(b => b.getAttribute('aria-label') || b.textContent || '');
    expect(names).toEqual([
      'Zoom out', '100%', 'Zoom in', 'Fit', 'Auto layout',
      expect.stringMatching(/^Maximize the graph/),
      expect.stringMatching(/^Outline/),
      expect.stringMatching(/^Randomise settings/),
    ]);
    // No Do… bar, suggestions, minimap, flow strip or Graph menu.
    for (const gone of ['Do', 'Next', 'Suggest', 'minimap', 'Show minimap', 'Flow strip', 'Graph']) {
      expect(names.some(n => n.startsWith(gone)), gone).toBe(false);
    }
    act(() => buttons[3].click()); act(() => buttons[4].click()); act(() => buttons[2].click());
    expect(fit).toHaveBeenCalledOnce(); expect(layout).toHaveBeenCalledOnce(); expect(zoomTo).toHaveBeenCalledWith(1.2);
  });

  it('a locked canvas keeps the view tools and the Outline; Maximize is desktop only', () => {
    useViewport.setState({ breakpoint: 'desktop-lg' });
    const h = render(<CanvasToolbar readOnly showOutline onToggleOutline={() => {}} onFit={() => {}} onAutoLayout={() => {}} />);
    expect(Array.from(h.querySelectorAll('button')).filter(b => !b.closest('[data-graph-status]')).map(b => b.getAttribute('aria-label') || b.textContent)).toEqual(['Fit', 'Hide the outline']);
    act(() => root!.unmount()); host!.remove();
    useViewport.setState({ breakpoint: 'tablet' });
    const t = render(<CanvasToolbar onToggleOutline={() => {}} />);
    expect(t.querySelector('[data-maximize-graph]')).toBeNull();
    useViewport.setState({ breakpoint: 'desktop-lg' });
  });

  it('Maximize toggles the remembered maximize; Outline calls its handler', () => {
    useViewport.setState({ breakpoint: 'desktop-lg' });
    useGraphMaximize.getState().set(false);
    const outline = vi.fn();
    const h = render(<CanvasToolbar onToggleOutline={outline} />);
    act(() => { h.querySelector<HTMLButtonElement>('[data-maximize-graph]')!.click(); });
    expect(useGraphMaximize.getState().on).toBe(true);
    act(() => { h.querySelector<HTMLButtonElement>('[data-outline-toggle]')!.click(); });
    expect(outline).toHaveBeenCalledTimes(1);
    useGraphMaximize.getState().set(false);
  });
});

describe('Randomise button', () => {
  it('a click randomises the settings (one action), with no menu', () => {
    randomize.mockClear();
    const h = render(<CanvasToolbar onToggleOutline={() => {}} />);
    act(() => { h.querySelector<HTMLButtonElement>('[data-randomize]')!.click(); });
    expect(randomize).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('a right-click opens its menu: Randomise settings and Randomise options…', () => {
    randomize.mockClear();
    const h = render(<CanvasToolbar onToggleOutline={() => {}} />);
    const dice = h.querySelector<HTMLButtonElement>('[data-randomize]')!;
    act(() => { dice.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 40 })); });
    const items = () => Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')).map(b => b as HTMLElement);
    expect(items().map(b => b.textContent ?? '').filter(t => t.startsWith('Randomise'))).toEqual([
      expect.stringContaining('Randomise settings'), expect.stringContaining('Randomise options…'),
    ]);
    // Options… opens the options (strength, locks, groups, focus, seed).
    act(() => { items().find(b => (b.textContent ?? '').includes('Randomise options…'))!.click(); });
    expect(document.querySelector('[role="dialog"][aria-label="Randomise options"]')).toBeTruthy();
    expect(randomize).not.toHaveBeenCalled();
  });

  it('the menu’s rows are wired: settings randomises, options opens the options', () => {
    const r = vi.fn(), o = vi.fn();
    const items = randomiseMenuItems({ summary: 'strength 50%', onRandomize: r, onOptions: o });
    expect(labels(items)).toEqual(['Randomise settings', 'Randomise options…']);
    items.forEach(i => { if (i !== 'separator' && !('heading' in i)) i.onSelect(); });
    expect(r).toHaveBeenCalledTimes(1);
    expect(o).toHaveBeenCalledTimes(1);
  });
});

describe('canvas right-click menu', () => {
  it('holds every action that left the toolbar and the Graph menu, each wired to its handler', () => {
    const a = all();
    const items = canvasMenuItems(a);
    expect(rows(items).map(r => r.label)).toEqual([
      'Fit all nodes in view', 'Zoom to 100%', 'Auto layout', 'Hide the minimap', 'Hide Next suggestions', 'Show passes',
      'Optimise graph…', 'Bake the picture…', 'Reset to the starter graph', 'Clear to UV and Output',
    ]);
    expect(rows(items).find(r => r.id === 'zoom')!.shortcut).toBe('75%');
    expect(rows(items).find(r => r.id === 'fit')!.shortcut).toBe('F');
    const handlers = [a.onFit, a.onResetZoom, a.onAutoLayout, a.onToggleMinimap, a.onToggleNext, a.onTogglePasses, a.onOptimize, a.onBake, a.onClear, a.onClearMinimal];
    rows(items).forEach((r, k) => {
      r.onSelect();
      expect(handlers[k], r.label).toHaveBeenCalledTimes(1);
    });
    // Randomise lives on its button only.
    expect(rows(items).some(r => /random/i.test(r.label))).toBe(false);
  });

  it('a locked canvas keeps only the view; Bake only at the top level; passes only with several programs; no minimap on touch', () => {
    expect(rows(canvasMenuItems(all({ readOnly: true }))).map(r => r.id)).toEqual(['fit', 'zoom', 'minimap', 'passes']);
    expect(rows(canvasMenuItems(all({ topLevel: false }))).map(r => r.id)).not.toContain('bake');
    expect(rows(canvasMenuItems(all({ multiProgram: false }))).map(r => r.id)).not.toContain('passes');
    expect(rows(canvasMenuItems(all({ onToggleMinimap: undefined }))).map(r => r.id)).not.toContain('minimap');
    const off = rows(canvasMenuItems(all({ showMinimap: false, showNext: false, showPasses: true }))).map(r => r.label);
    expect(off).toEqual(expect.arrayContaining(['Show the minimap', 'Show Next suggestions', 'Hide passes']));
  });

  it('the graph renders these rows on the empty canvas’s right-click (NodeGraph.tsx)', () => {
    const src = readFileSync(resolve(__dirname, '../../NodeGraph/NodeGraph.tsx'), 'utf8');
    expect(src).toContain('canvasMenuItems({');
    expect(src).toContain('data-ctx-canvas={r.id}');
    // The toolbar gets the zoom, Fit and Auto layout handlers.
    expect(src).toMatch(/onFit=\{\(\) => handleFitView\(\)\} onAutoLayout=\{\(\) => autoLayout\(\)\}/);
  });
});

describe('Play Layout menu', () => {
  it('offers only the three sidebar modes (the picture is always right of the panel), marks the current one, and sets it', () => {
    const setSidebar = vi.fn();
    const items = playLayoutItems('rail', setSidebar, '#00f');
    expect(labels(items)).toEqual(SIDEBAR_OPTIONS.map(o => o.label));
    // No row moves the panel to another side of the picture.
    expect(labels(items).some(l => /right of the picture|above the picture|below the picture|left of the picture/i.test(l))).toBe(false);
    const rows = items.filter((i): i is Extract<MenuItem, { onSelect: () => void }> => i !== 'separator' && !('heading' in i));
    expect(rows.filter(r => r.iconColor === '#00f').map(r => r.label)).toEqual(['Fold the sidebar into icons']);
    rows[2].onSelect();
    expect(setSidebar).toHaveBeenCalledWith('hidden');
    expect(sidebarIcon('hidden')).toBe('sidebarOff');
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
