// @vitest-environment jsdom
/**
 * Toolbars that fit (docs/toolbars.md): FitToolbar folds the lowest-priority items into its "⋯" as the
 * room shrinks, so every action stays reachable at any width. jsdom has no layout, so widths are
 * mocked: an item is as wide as its controls and text say (`fakeWidth`), the bar as wide as the test
 * says. At each width, every action of the preview header, the Code page's toolbar, the canvas
 * toolbar and the Functions bar must be on the bar or in the "⋯", and what's on the bar must fit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ro = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  // ResizeObservers are kept so a test can "resize" the bar and fire them.
  const observers = new Set<{ cb: (entries: unknown[]) => void }>();
  class FakeRO { cb: (entries: unknown[]) => void; constructor(cb: (entries: unknown[]) => void) { this.cb = cb; observers.add(this); } observe() {} unobserve() {} disconnect() { observers.delete(this); } }
  vi.stubGlobal('ResizeObserver', FakeRO);
  return { fire: () => { for (const o of [...observers]) o.cb([]); } };
});

// The Code page's preview and its canvas need WebGL: not here.
vi.mock('../../shell/PageCanvas', () => ({ PageCanvas: () => null }));
vi.mock('../../ShaderCanvas', () => ({ default: () => null }));

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fitItems } from '../fitLayout';
import { FitToolbar, type FitToolbarItem } from '../FitToolbar';
import { PreviewHeader, previewToolItems } from '../../shell/PreviewChrome';
import { CanvasToolbar } from '../../shell/CanvasToolbar';
import { useViewport } from '../../../lib/viewport';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Mocked layout ──────────────────────────────────────────────────────────
let barWidth = 1000;
/** An item's width: 28px per control, 6.5px per character of its own text (labels like "Finish"). */
function fakeWidth(el: Element): number {
  const controls = el.querySelectorAll('button, input, select').length;
  const text = [...el.querySelectorAll('button, span')].filter(e => e.children.length === 0).map(e => e.textContent ?? '').join('').length;
  return controls * 28 + text * 6.5;
}
const realRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const w = this.hasAttribute('data-fit-key') || this.hasAttribute('data-fit-more') ? fakeWidth(this) : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 26, width: w, height: 26, toJSON() {} } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-fit-toolbar') ? barWidth : this.hasAttribute('data-fit-bounds') ? barWidth + 26 : 0; },
  });
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = '';
});

let root: Root | null = null;
let host: HTMLElement | null = null;
function render(el: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
function resize(width: number) {
  barWidth = width;
  act(() => ro.fire());
  act(() => ro.fire());
}

/** Every item's name, as the bar shows it (aria-label or text) and as the "⋯" lists it (its label). */
function reachable(bar: Element): { onBar: string[]; inMenu: string[]; used: number } {
  const spans = [...bar.querySelectorAll('[data-fit-key]')];
  const onBar = spans.map(s => s.getAttribute('data-fit-key')!);
  const used = spans.reduce((sum, s) => sum + fakeWidth(s), 0) + (bar.querySelector('[data-fit-more]') ? fakeWidth(bar.querySelector('[data-fit-more]')!) : 0);
  const more = bar.querySelector<HTMLButtonElement>('[data-fit-more] button');
  let inMenu: string[] = [];
  if (more) {
    act(() => more.click());
    inMenu = [...document.querySelectorAll('[data-fit-menu] [data-fit-row]')].map(r => r.getAttribute('data-fit-row')!);
    act(() => more.click());
  }
  return { onBar, inMenu, used };
}

const WIDTHS = [1400, 900, 600, 420, 320, 280, 200, 120];

function expectAllReachable(bar: Element, keys: string[], label: string) {
  for (const w of WIDTHS) {
    resize(w);
    const { onBar, inMenu, used } = reachable(bar);
    for (const k of keys) expect(onBar.includes(k) || inMenu.includes(k), `${label} @${w}: ${k}`).toBe(true);
    // The narrow widths really fold (the mocked widths are doing their job).
    if (w <= 200) expect(inMenu.length, `${label} @${w}`).toBeGreaterThan(0);
    // Nothing on the bar twice, nothing both on the bar and in the menu.
    expect(new Set([...onBar, ...inMenu]).size, `${label} @${w}`).toBe(onBar.length + inMenu.length);
    // What's on the bar fits, unless only the pinned items (and the "⋯") are left: then the bar scrolls.
    const pinnedOnly = onBar.every(k => ['label', 'save', 'preview', 'fn', 'fullscreen'].includes(k) || k.startsWith('sep'));
    if (!pinnedOnly) expect(used, `${label} @${w}: ${onBar.join(',')}`).toBeLessThanOrEqual(w + 1);
  }
}

describe('fitItems', () => {
  const items = [
    { key: 'a', width: 100, priority: 10 },
    { key: 'b', width: 100, priority: 90 },
    { key: 'c', width: 100, priority: 50 },
  ];
  it('nothing folds when everything fits', () => {
    expect(fitItems(items, 300, 28).folded.size).toBe(0);
    expect(fitItems(items, 300, 28).more).toBe(false);
  });
  it('the lowest priority folds first, and the "⋯" takes room', () => {
    expect([...fitItems(items, 299, 28).folded]).toEqual(['a']);
    // 200 for b + c doesn't leave 28 for the "⋯": c folds too.
    expect([...fitItems(items, 210, 28).folded].sort()).toEqual(['a', 'c']);
    expect([...fitItems(items, 50, 28).folded].sort()).toEqual(['a', 'b', 'c']);
  });
  it('pinned items never fold; always-in-menu items never show; noMenu items are only dropped', () => {
    const r = fitItems([{ key: 'p', width: 500, priority: 0, pinned: true }, { key: 'm', width: 10, priority: 99, alwaysMenu: true }, { key: 'l', width: 40, priority: 1, noMenu: true }], 100, 28);
    expect(r.folded.has('p')).toBe(false);
    expect(r.folded.has('m')).toBe(true);
    expect(r.folded.has('l')).toBe(true);
    expect(r.more).toBe(true);
    expect(fitItems([{ key: 'l', width: 40, priority: 1, noMenu: true }, { key: 'x', width: 40, priority: 5, pinned: true }], 50, 28).more).toBe(false);
  });
  it('a tie keeps the earlier item', () => {
    expect([...fitItems([{ key: 'first', width: 100, priority: 50 }, { key: 'second', width: 100, priority: 50 }], 150, 28).folded]).toEqual(['second']);
  });
});

describe('FitToolbar', () => {
  it('folds into the "⋯" as the bar narrows and back out as it widens; a menu row runs its action', () => {
    const ran = vi.fn();
    const items: FitToolbarItem[] = [
      { key: 'one', label: 'One', icon: 'copy', onSelect: ran, priority: 90 },
      { key: 'two', label: 'Two', icon: 'trash', onSelect: () => {}, priority: 10 },
      { key: 'rare', label: 'Rarely used', icon: 'reset', onSelect: () => {}, menu: 'always' },
    ];
    const h = render(<FitToolbar ariaLabel="Test" items={items} />);
    const bar = h.querySelector('[data-fit-toolbar]')!;
    resize(500);
    expect(reachable(bar)).toMatchObject({ onBar: ['one', 'two'], inMenu: ['rare'] });
    resize(60);
    expect(reachable(bar)).toMatchObject({ onBar: ['one'], inMenu: ['two', 'rare'] });
    resize(500);
    expect(reachable(bar).onBar).toEqual(['one', 'two']);
    resize(60);
    act(() => bar.querySelector<HTMLButtonElement>('[data-fit-more] button')!.click());
    expect(document.querySelector('[data-fit-menu]')?.getAttribute('role')).toBe('menu');
    act(() => (document.querySelector('[data-fit-row="two"]') as HTMLButtonElement).click());
    act(() => bar.querySelector<HTMLButtonElement>('[data-fit-more] button')!.click());
    act(() => (document.querySelector('[data-fit-row="one"]') as HTMLButtonElement | null)?.click());
    expect(ran).not.toHaveBeenCalled(); // "one" is on the bar, not in the menu
    act(() => bar.querySelector<HTMLButtonElement>('[data-fit-key="one"] button')!.click());
    expect(ran).toHaveBeenCalledTimes(1);
  });
});

describe('every action stays reachable at narrow widths', () => {
  it('the preview header (Studio): shape, resolution, frame rate, overlay, full screen, histogram, float', () => {
    const items: FitToolbarItem[] = [
      ...previewToolItems(),
      { key: 'histogram', label: 'Brightness histogram', icon: 'wave', onSelect: () => {}, priority: 20 },
      { key: 'float', label: 'Float the preview', icon: 'popout', onSelect: () => {}, priority: 30 },
    ];
    const h = render(<PreviewHeader items={items} />);
    const bar = h.querySelector('[data-fit-toolbar]')!;
    expect(bar.getAttribute('aria-label')).toBe('Preview tools');
    expectAllReachable(bar, ['aspect', 'quality', 'fps', 'overlay', 'fullscreen', 'histogram', 'float'], 'preview header');
    // The shape is one dropdown, not eight frames.
    resize(1400);
    expect(bar.querySelectorAll('[data-fit-key="aspect"] button').length).toBe(1);
    expect(bar.querySelector('[data-aspect-menu]')).not.toBeNull();
  });

  it('the Code page’s Shader toolbar: Save, Explain, Tidy, Copy, Convert, Discover, Code Explorer, panels, and the file actions in the "⋯"', async () => {
    useViewport.setState({ phone: false, breakpoint: 'desktop-lg' });
    const { GLSLPage } = await import('../../GLSLPage');
    const h = render(<GLSLPage onConvert={() => {}} />);
    const bar = h.querySelector('[data-glsl-toolbar] [data-fit-toolbar]')!;
    expect(bar.getAttribute('aria-label')).toBe('Shader tools');
    expectAllReachable(bar, ['save', 'explain', 'tidy', 'copy', 'convert', 'discover', 'explorer', 'stepByStep', 'fullCanvas', 'fromGraph', 'download', 'blank', 'clear'], 'shader toolbar');
    // Plain words in the "⋯", grouped (docs/glossary.md: "Generated code" is the graph's own GLSL).
    resize(320);
    act(() => bar.querySelector<HTMLButtonElement>('[data-fit-more] button')!.click());
    const menu = document.querySelector('[data-fit-menu]')!;
    expect(menu.textContent).toContain('Open the graph’s generated code');
    expect(menu.textContent).toContain('Download saved shaders…');
    expect([...menu.querySelectorAll('div')].map(d => d.textContent).filter(t => ['Edit', 'Tools', 'View', 'File'].includes(t ?? ''))).toEqual(expect.arrayContaining(['Tools', 'File']));
  });

  it('the Functions tab’s bar: the function, the view range, Save group, Sessions, Save to Expression Block', async () => {
    const { Toolbar } = await import('../../FunctionBuilder/Toolbar');
    const h = render(<Toolbar />);
    const bar = h.querySelector('[data-fit-toolbar]')!;
    expect(bar.getAttribute('aria-label')).toBe('Function tools');
    expectAllReachable(bar, ['fn', 'range', 'saveGroup', 'sessions', 'save'], 'functions bar');
  });

  it('the canvas toolbar: stats, zoom, Fit, Auto layout, Outline, Randomise, Clear', () => {
    useViewport.setState({ breakpoint: 'tablet' });
    // The pill is only as wide as its content; the toolbar measures the canvas (data-fit-bounds here).
    const h = render(<div data-fit-bounds=""><CanvasToolbar onToggleOutline={() => {}} zoom={1} onZoom={() => {}} onResetZoom={() => {}} onFit={() => {}} onAutoLayout={() => {}} /></div>);
    const bar = h.querySelector('[data-fit-toolbar]')!;
    expect(bar.getAttribute('aria-label')).toBe('Graph tools');
    expectAllReachable(bar, ['stats', 'zoom', 'fit', 'autoLayout', 'outline', 'randomise', 'clear'], 'canvas toolbar');
  });

  it('the canvas toolbar\'s Passes chip: stays long, and folded its ⋯ entry opens the same account', async () => {
    const { useNodeGraphStore } = await import('../../../store/useNodeGraphStore');
    const { n } = await import('../../../store/graphBuilder');
    useViewport.setState({ breakpoint: 'tablet' });
    useNodeGraphStore.getState().replaceGraph([
      n('uv', 'uvn', 0, 0), n('swizzle', 'rgb', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['uvn', 'uv'] }),
      n('pass', 'p', 0, 0, {}, { color: ['rgb', 'output'] }), n('output', 'out', 0, 0, {}, { color: ['p', 'color'] }),
    ]);
    const h = render(<div data-fit-bounds=""><CanvasToolbar onToggleOutline={() => {}} zoom={1} onZoom={() => {}} onResetZoom={() => {}} onFit={() => {}} onAutoLayout={() => {}} /></div>);
    const bar = h.querySelector('[data-fit-toolbar]')!;
    expectAllReachable(bar, ['stats', 'passes', 'zoom', 'fit'], 'canvas toolbar with passes');
    // Folds after the stats (lower priority) but before Fit.
    resize(420);
    let { onBar } = reachable(bar);
    expect(onBar.includes('passes') || !onBar.includes('stats')).toBe(true);
    resize(40);
    ({ onBar } = reachable(bar));
    expect(onBar).not.toContain('passes');
    act(() => bar.querySelector<HTMLButtonElement>('[data-fit-more] button')!.click());
    const row = document.querySelector('[data-fit-menu] [data-fit-row="passes"]')!;
    act(() => row.querySelector<HTMLButtonElement>('[data-pass-budget] button')!.click());
    expect(document.querySelector('[data-pass-budget-panel] [data-pass-budget-headline]')!.textContent).toBe('1 of 8 used · 7 left');
  });
});
