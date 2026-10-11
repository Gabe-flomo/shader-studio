// @vitest-environment jsdom
/**
 * Entering and leaving a scope (a group, a Shader Texture, a Pass, an Agents group) frames the view on
 * that scope's cards, and the minimap draws the open scope's cards, not the top level's
 * (docs/texture-builder.md, "Inside").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

const minimapNodes: Array<string[]> = [];
vi.mock('../Minimap', () => ({
  Minimap: (p: { nodes: Array<{ id: string }> }) => { minimapNodes.push(p.nodes.map(n => n.id)); return null; },
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { NodeGraph } from '../NodeGraph';
import { getView } from '../socketRegistry';
import { frameNodes, scopeChange } from '../scopeView';
import { makeShaderTexture } from '../../../nodes/shaderTextureStarters';
import { n } from '../../../store/graphBuilder';
import type { GraphNode, SubgraphData } from '../../../types/nodeGraph';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
// jsdom has touch handlers, so the graph would take it for a touch screen and leave the minimap out.
for (let o: object | null = window; o && 'ontouchstart' in o; o = Object.getPrototypeOf(o)) delete (o as Record<string, unknown>).ontouchstart;

const at = (id: string, x: number, y: number) => ({ id, position: { x, y } }) as GraphNode;

describe('frameNodes', () => {
  it('centres the cards in the canvas and stops at the zoom cap', () => {
    const v = frameNodes([at('a', 1000, 2000), at('b', 1400, 2000)], 1200, 800, { minZoom: 0.1, maxZoom: 1 })!;
    expect(v.zoom).toBe(1);
    // The middle of the cards (1000..1760 × 2000..2200) lands in the middle of the canvas.
    expect(1380 * v.zoom + v.pan.x).toBeCloseTo(600);
    expect(2100 * v.zoom + v.pan.y).toBeCloseTo(400);
  });
  it('uses measured sizes and leaves the right inset free', () => {
    const v = frameNodes([at('a', 0, 0)], 1000, 600, { minZoom: 0.1, maxZoom: 1, insetRight: 200, sizeOf: () => ({ w: 400, h: 900 }) })!;
    expect(v.zoom).toBeCloseTo(600 / 1020);
    expect(200 * v.zoom + v.pan.x).toBeCloseTo(400); // centred in the 800 px left of the inset
    expect(450 * v.zoom + v.pan.y).toBeCloseTo(300);
  });
  it('nothing to frame: null', () => {
    expect(frameNodes([], 800, 600, { minZoom: 0.1, maxZoom: 1 })).toBeNull();
  });
});

describe('scopeChange', () => {
  const saved = new Map([['', { pan: { x: 5, y: 6 }, zoom: 0.5 }]]);
  it('entering frames; leaving goes back to the outer view, or frames when there is none', () => {
    expect(scopeChange([], ['g'], saved)).toEqual({ frame: true });
    expect(scopeChange(['g'], [], saved)).toEqual({ restore: { pan: { x: 5, y: 6 }, zoom: 0.5 } });
    expect(scopeChange(['g', 'h'], ['g'], saved)).toEqual({ frame: true });
    expect(scopeChange(['g'], ['g'], saved)).toBeNull();
  });
});

describe('NodeGraph: entering and leaving', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  const st = () => useNodeGraphStore.getState();
  const sizes = { clientWidth: 1200, clientHeight: 800 };

  beforeEach(() => {
    for (const [k, v] of Object.entries(sizes)) Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    minimapNodes.length = 0;
    useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [], previewNodeId: null });
    // A Shader Texture far away from the top-level cards, whose inside sits near (0, 0).
    const tex = { ...makeShaderTexture((() => { let i = 0; return () => `in${++i}`; })(), { x: 5000, y: 4000 }, { starter: 'circles' }), id: 'tex' };
    st().replaceGraph([tex, n('output', 'out', 5400, 4000, {}, { color: ['tex', 'color'] })]);
  });
  afterEach(() => {
    act(() => root?.unmount()); host?.remove(); root = null; host = null;
    for (const k of Object.keys(sizes)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  });

  /** The world point at the middle of the canvas (ignoring the Shader Texture panel's inset). */
  const centre = (inset = 0) => { const { pan, zoom } = getView(); return { x: ((1200 - inset) / 2 - pan.x) / zoom, y: (400 - pan.y) / zoom }; };
  const box = (nodes: GraphNode[]) => {
    const xs = nodes.map(q => q.position.x), ys = nodes.map(q => q.position.y);
    return { x: (Math.min(...xs) + Math.max(...xs) + 360) / 2, y: (Math.min(...ys) + Math.max(...ys) + 200) / 2 };
  };

  it('frames the inside on entry, restores the outer view on exit, and the minimap follows the scope', () => {
    act(() => { root!.render(<NodeGraph />); });
    act(() => { st()._setViewCallback?.({ x: -4800, y: -3700 }, 0.8); });
    const outer = getView();
    expect(minimapNodes.at(-1)).toEqual(['tex', 'out']);

    act(() => { st().enterGroup('tex'); });
    const inside = (st().nodes.find(q => q.id === 'tex')!.params.subgraph as SubgraphData).nodes;
    const c = centre(244), b = box(inside);
    expect(c.x).toBeCloseTo(b.x, 0);
    expect(c.y).toBeCloseTo(b.y, 0);
    expect(minimapNodes.at(-1)).toEqual(inside.map(q => q.id));

    act(() => { st().exitGroup(); });
    expect(getView()).toEqual(outer);
    expect(minimapNodes.at(-1)).toEqual(['tex', 'out']);
  });

  it('a plain group: framed on entry; the breadcrumb (exitToDepth) and Esc-style exitToRoot restore', () => {
    st().replaceGraph([
      n('uv', 'u', 9000, 9000), n('output', 'out', 9400, 9000, {}, { color: ['u', 'uv'] }),
    ]);
    act(() => { root!.render(<NodeGraph />); });
    act(() => { st().groupNodes(['u']); });
    const g = st().nodes.find(q => q.type === 'group')!;
    act(() => { st()._setViewCallback?.({ x: 10, y: 20 }, 0.7); });
    act(() => { st().enterGroup(g.id); });
    const inside = (st().nodes.find(q => q.id === g.id)!.params.subgraph as SubgraphData).nodes;
    expect(centre().x).toBeCloseTo(box(inside).x, 0);
    expect(minimapNodes.at(-1)).toEqual(inside.map(q => q.id));
    act(() => { st().exitToDepth(0); });
    expect(getView()).toEqual({ pan: { x: 10, y: 20 }, zoom: 0.7 });
    act(() => { st().enterGroup(g.id); });
    act(() => { st().exitToRoot(); });
    expect(getView()).toEqual({ pan: { x: 10, y: 20 }, zoom: 0.7 });
  });
});
