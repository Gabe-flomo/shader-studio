// @vitest-environment jsdom
/**
 * The node search (NodeSearchPalette.tsx, docs/node-browser.md "Node search"): it follows the
 * theme, opens on category tiles, drills in and back, ranks Matches before Related, shows the top
 * 8 as tiles and the rest as a list, moves by keyboard, and adds (and, from a wire, wires) the node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});

// The examples' follow counts: Circle SDF is usually followed by Palette and SDF Glow.
vi.mock('../../../structure/relevance', async orig => ({
  ...(await orig<typeof import('../../../structure/relevance')>()),
  exampleFollowCounts: () => Promise.resolve(new Map([['circleSDF', new Map([['palette', 9], ['sdfFill', 6]])]])),
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useThemeStore } from '../../../theme/themeStore';
import { THEMES } from '../../../theme/tokens';
import { getNodeDefinition } from '../../../nodes/definitions';
import { RECENT_NODES_KEY } from '../../../nodes/recentNodes';
import type { GraphNode } from '../../../types/nodeGraph';
import { NodeSearchPalette } from '../NodeSearchPalette';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const make = (id: string, type: string): GraphNode => {
  const def = getNodeDefinition(type)!;
  return {
    id, type, position: { x: 0, y: 0 }, params: { ...def.defaultParams },
    inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { ...s }])),
    outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { ...s }])),
  } as GraphNode;
};

let host: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onClose = vi.fn<() => void>();
  localStorage.clear();
  useThemeStore.setState({ mode: 'light' });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const render = (props: Partial<Parameters<typeof NodeSearchPalette>[0]> = {}) =>
  act(() => root.render(<NodeSearchPalette open onClose={onClose} {...props} />));
const panel = () => document.querySelector<HTMLElement>('[data-node-search]')!;
const input = () => document.querySelector<HTMLInputElement>('[data-node-search-input]')!;
const type = (text: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input(), text);
  input().dispatchEvent(new Event('input', { bubbles: true }));
});
const key = (k: string, extra: KeyboardEventInit = {}) => act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra })); });
const click = (el: Element | null) => act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const active = () => document.querySelector<HTMLElement>('[data-active="true"]');
const typesIn = (section: string) => [...document.querySelectorAll(`[data-section="${section}"] [data-item-kind="node"]`)].map(e => e.getAttribute('data-type'));
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

describe('theme', () => {
  it('follows the app’s light and dark setting', () => {
    render();
    expect(panel().style.background).toBe(rgb(THEMES.light.bg.panel));
    act(() => useThemeStore.setState({ mode: 'dark' }));
    expect(panel().style.background).toBe(rgb(THEMES.dark.bg.panel));
  });
});

describe('opening', () => {
  it('shows the categories as tiles, not every node', () => {
    render();
    expect(panel().getAttribute('data-view')).toBe('home');
    const tiles = [...document.querySelectorAll('[data-tile]')].map(t => t.getAttribute('data-tile'));
    expect(tiles).toContain('c:Noise');
    expect(tiles).toContain('t:builders');
    expect(document.querySelectorAll('[data-item-kind="node"]').length).toBe(0);
    expect(document.querySelector('[data-tile="c:Noise"] [data-count]')!.textContent).toMatch(/^\d+$/);
  });

  it('has Recent and Favourites tiles when there are some', () => {
    localStorage.setItem(RECENT_NODES_KEY, JSON.stringify(['palette']));
    localStorage.setItem('nodepalette_favorites', JSON.stringify(['sdfFill']));
    render();
    expect(document.querySelector('[data-tile="t:recent"]')).not.toBeNull();
    expect(document.querySelector('[data-tile="t:favorites"]')).not.toBeNull();
  });
});

describe('a category', () => {
  it('opens with a click or Enter, and Esc or Backspace goes back', () => {
    render();
    click(document.querySelector('[data-tile="c:Noise"]'));
    expect(panel().getAttribute('data-view')).toBe('row');
    expect(document.querySelector('[data-breadcrumb]')!.textContent).toMatch(/Noise/);
    expect(document.querySelectorAll('[data-item-kind="node"]').length).toBeGreaterThan(3);
    key('Backspace');
    expect(panel().getAttribute('data-view')).toBe('home');

    // Back highlights the tile you came from.
    expect(active()!.getAttribute('data-tile')).toBe('c:Noise');
    // Enter on the highlighted tile opens it; Esc goes back, and Esc again closes.
    key('Tab'); // past the shortcuts (Builders…) to the first category section
    const first = active()!.getAttribute('data-tile');
    expect(first).toMatch(/^c:/);
    key('Enter');
    expect(panel().getAttribute('data-view')).not.toBe('home');
    key('Escape');
    expect(panel().getAttribute('data-view')).toBe('home');
    expect(active()!.getAttribute('data-tile')).toBe(first);
    expect(onClose).not.toHaveBeenCalled();
    key('Escape');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('typing', () => {
  it('replaces the grid with Matches: exact first, the top 8 as tiles, the rest as a list', () => {
    render();
    type('noise');
    expect(panel().getAttribute('data-view')).toBe('search');
    expect(document.querySelectorAll('[data-tile]').length).toBe(0);
    const top = typesIn('top');
    const more = typesIn('more');
    expect(top.length).toBe(8);
    expect(more.length).toBeGreaterThan(0);
    expect(document.querySelector('[data-section="top"]')!.textContent).toMatch(/Matches/);
    expect(getNodeDefinition(top[0]!)!.label.toLowerCase().startsWith('noise')).toBe(true);
    // An exact name leads.
    type('circle sdf');
    expect(typesIn('top')[0]).toBe('circleSDF');
  });

  it('puts the exact match before fuzzy ones', () => {
    render();
    type('mix');
    const top = typesIn('top');
    expect(top[0]).toBe('mix');
  });

  it('adds Related after the matches: what usually follows the selected node', async () => {
    useNodeGraphStore.setState({ nodes: [make('c1', 'circleSDF')], selectedNodeId: 'c1', selectedNodeIds: ['c1'] });
    render();
    await flush();
    type('blur');
    const related = typesIn('related');
    expect(related).toContain('palette');
    expect(related).toContain('sdfFill');
    expect(document.querySelector('[data-section="related"]')!.textContent).toMatch(/Related/);
    expect(document.querySelector('[data-section="related"]')!.textContent).toMatch(/Usually goes with Circle SDF/);
    // Matches come first on the page.
    const sections = [...document.querySelectorAll('[data-section]')].map(s => s.getAttribute('data-section'));
    expect(sections.indexOf('top')).toBeLessThan(sections.indexOf('related'));
    // And the home screen offers a Usually next tile.
    type('');
    expect(document.querySelector('[data-tile="t:related"]')).not.toBeNull();
  });
});

describe('keyboard', () => {
  it('moves across the tile grid, Tab jumps groups, and arrows go through results in order', () => {
    render();
    const tiles = () => [...document.querySelectorAll('[data-tile]')];
    expect(active()).toBe(tiles()[0]);
    key('ArrowRight');
    expect(active()).toBe(tiles()[1]);
    key('ArrowLeft');
    key('Tab');
    const firstSection = document.querySelector('[data-section]')!;
    expect(firstSection.contains(active())).toBe(false);

    type('noise');
    const top = typesIn('top');
    expect(active()!.getAttribute('data-type')).toBe(top[0]);
    key('ArrowDown');
    expect(active()!.getAttribute('data-type')).toBe(top[1]);
    key('Tab'); // to the rest of the matches
    expect(active()!.closest('[data-section]')!.getAttribute('data-section')).toBe('more');
    key('Tab', { shiftKey: true });
    expect(active()!.closest('[data-section]')!.getAttribute('data-section')).toBe('top');
    // The highlighted node's preview shows in the side panel.
    expect(document.querySelector('[data-preview-type]')!.getAttribute('data-preview-type')).toBe(top[0]);
  });
});

describe('adding', () => {
  it('Enter adds the highlighted node, remembers it and closes', () => {
    const placed = vi.fn();
    render({ onNodePlaced: placed, spawnPosition: { x: 40, y: 60 } });
    type('circle sdf');
    key('Enter');
    const n = useNodeGraphStore.getState().nodes.find(x => x.type === 'circleSDF')!;
    expect(n).toBeTruthy();
    expect(n.position).toEqual({ x: 40, y: 60 });
    expect(placed).toHaveBeenCalledWith(n.id);
    expect(onClose).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(RECENT_NODES_KEY)!)).toEqual(['circleSDF']);
  });

  it('from a wire: only nodes that take it, and the new node is wired', () => {
    const uv = make('uv1', 'uv');
    useNodeGraphStore.setState({ nodes: [uv] });
    const outKey = Object.keys(uv.outputs)[0];
    const outType = uv.outputs[outKey].type;
    // What NodeGraph does with a node placed from a socket's "Add node…" (handleAltSocketNodePlaced).
    const onNodePlaced = (id: string) => {
      const st = useNodeGraphStore.getState();
      const node = st.nodes.find(x => x.id === id)!;
      const k = Object.entries(node.inputs).find(([, s]) => s.type === outType)?.[0] ?? Object.keys(node.inputs)[0];
      st.connectNodes('uv1', outKey, id, k);
    };
    render({ filterInputType: outType, boostFrom: 'uv', onNodePlaced });
    type('circle sdf');
    expect(typesIn('top')[0]).toBe('circleSDF');
    expect(document.querySelector('[data-wire-filter]')!.textContent).toMatch(outType);
    key('Enter');
    const c = useNodeGraphStore.getState().nodes.find(x => x.type === 'circleSDF')!;
    expect(Object.values(c.inputs).some(i => i.connection?.nodeId === 'uv1')).toBe(true);
  });
});
