// @vitest-environment jsdom
/**
 * The pass account on the graph (shell/PassBudget.tsx): the chip's colours at the thresholds, its
 * popover rows (jump to the node), the hidden-passes line, the toolbar item, the library note.
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

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PassBudgetChip, passItemCost, passItemName } from '../PassBudget';
import { CanvasToolbar } from '../CanvasToolbar';
import { PassCostNote } from '../../NodeGraph/PassCostNote';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useViewport } from '../../../lib/viewport';
import { n } from '../../../store/graphBuilder';
import { passBudget } from '../../../compiler/passBudget';
import type { GraphNode } from '../../../types/nodeGraph';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ''; });
const render = (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};

/** `count` Pass nodes in a chain, plus whatever else, on to the Output. */
function passes(count: number, extra: GraphNode[] = []): GraphNode[] {
  const nodes: GraphNode[] = [n('uv', 'uvn', 0, 0), n('swizzle', 'rgb', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['uvn', 'uv'] })];
  let from: [string, string] = ['rgb', 'output'];
  for (let i = 0; i < count; i++) { nodes.push(n('pass', `p${i}`, 0, 0, i === 0 ? { label: 'Feedback blur' } : {}, { color: from })); from = [`p${i}`, 'color']; }
  return [...nodes, ...extra, n('output', 'out', 0, 0, {}, { color: from })];
}

const chip = (h: HTMLElement) => h.querySelector<HTMLElement>('[data-pass-budget]');

describe('Pass budget chip', () => {
  it('hidden while no pass is used; shows used/max once one is', () => {
    useNodeGraphStore.getState().replaceGraph(passes(0));
    expect(chip(render(<PassBudgetChip />))).toBeNull();
    act(() => useNodeGraphStore.getState().replaceGraph(passes(3)));
    expect(chip(host!)!.textContent).toBe('Passes 3/8');
  });

  it('colours: plain, amber with one left (and at the limit), red over', () => {
    for (const [count, level] of [[6, 'ok'], [7, 'warn'], [8, 'warn'], [9, 'over']] as const) {
      act(() => useNodeGraphStore.getState().replaceGraph(passes(count)));
      if (!host) render(<PassBudgetChip />);
      expect(chip(host!)!.getAttribute('data-pass-budget'), String(count)).toBe(level);
    }
  });

  it('the popover: a row per node (jumps to it), shared rows, the hidden passes line, why', () => {
    const extra = [
      n('textureInput', 'img', 0, 0), n('opticalFlow', 'of', 0, 0, {}, { texture: ['img', 'texture'] }),
      n('lfo', 'lfo', 0, 0), n('lag', 'm1', 0, 0, {}, { input: ['lfo', 'value'] }), n('lag', 'm2', 0, 0, {}, { input: ['m1', 'value'] }),
      n('blurTexture', 'bl', 0, 0, { radius: 4 }, { texture: ['p0', 'texture'] }),
    ];
    useNodeGraphStore.getState().replaceGraph(passes(1, extra));
    const h = render(<PassBudgetChip />);
    act(() => chip(h)!.querySelector('button')!.click());
    const panel = document.querySelector('[data-pass-budget-panel]')!;
    const rows = [...panel.querySelectorAll<HTMLElement>('[data-pass-row]')].map(r => r.textContent);
    expect(rows).toEqual(['Pass · Feedback blur1', 'Optical Flow2', 'Memory nodes (2)1 shared']);
    expect(panel.querySelector('[data-pass-budget-headline]')!.textContent).toBe('4 of 8 used · 4 left');
    expect(panel.querySelector('[data-pass-budget-hidden]')!.textContent).toMatch(/^Blur and Glow use their own hidden passes: [1-9]\d* of 48 \(they don't count\)\.$/);
    expect(panel.textContent).toContain('a shader can only read so many textures');
    act(() => panel.querySelector<HTMLElement>('[data-pass-row="of"]')!.click());
    expect(useNodeGraphStore.getState().selectedNodeId).toBe('of');
    expect(useNodeGraphStore.getState().focusRequest?.nodeId).toBe('of');
  });

  it('row words', () => {
    const b = passBudget(passes(2));
    expect(b.items.map(passItemName)).toEqual(['Pass · Feedback blur', 'Pass']);
    expect(b.items.map(passItemCost)).toEqual(['1', '1']);
  });

  it('sits in the canvas toolbar beside the node count', () => {
    useViewport.setState({ breakpoint: 'desktop-lg' });
    useNodeGraphStore.getState().replaceGraph(passes(2));
    const h = render(<CanvasToolbar onFit={() => {}} />);
    expect(chip(h)!.textContent).toBe('Passes 2/8');
  });
});

describe('Library note', () => {
  it('says what a node costs, and nothing for one that costs none', () => {
    expect(render(<PassCostNote type="opticalFlow" />).textContent).toBe('Uses 2 passes (of 8)');
    act(() => root!.render(<PassCostNote type="circleSDF" />));
    expect(host!.textContent).toBe('');
  });
});
