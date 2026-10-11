// @vitest-environment jsdom
/**
 * The explain view opens for typical lines without throwing (the crash reported from the Lines editor):
 * dot, fract, `1.0 - dot(p, p)` and `fract(dot(p, vec2(11.0)))`, with p a block input or the scratch p.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});
vi.mock('../../../lib/nodePreviewRenderer', () => ({
  nodePreviewRenderer: {
    renderValues: async (_fs: string, _u: unknown, w: number, h: number, passes: number) => ({ ms: 1, fields: Array.from({ length: passes }, () => new Float32Array(w * h * 4).fill(0.5)) }),
  },
}));
// A switch to make the live picture's program throw, as a failure deep in the view would
const boom = vi.hoisted(() => ({ on: false }));
vi.mock('../liveRender', async orig => {
  const real = await orig<typeof import('../liveRender')>();
  return { ...real, liveProgram: (...a: Parameters<typeof real.liveProgram>) => { if (boom.on) throw new Error('boom'); return real.liveProgram(...a); } };
});

import * as THREE from 'three';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { ExprBlockModal } from '../../NodeGraph/ExprBlockModal';
import { uniformsOf } from '../buildUpHost';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const LINES = [
  { lhs: 'float a', op: '=', rhs: 'dot(p, p)' },
  { lhs: 'float b', op: '=', rhs: 'fract(p.x * 4.0)' },
  { lhs: 'float z', op: '=', rhs: '1.0 - dot(p, p)' },
  { lhs: 'float h', op: '=', rhs: 'fract(dot(p, vec2(11.0)))' },
];

function graph(pInput: boolean): GraphNode[] {
  const uv = { id: 'uv1', type: 'uv', position: { x: 0, y: 0 }, params: {}, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } };
  const blk = {
    id: 'blk', type: 'exprNode', position: { x: 0, y: 0 },
    inputs: pInput ? { p: { type: 'vec2', label: 'p', connection: { nodeId: 'uv1', outputKey: 'uv' } } } : {},
    outputs: { result: { type: 'float', label: 'Result' } },
    params: {
      inputs: pInput ? [{ name: 'p', type: 'vec2', slider: null }] : [],
      outputType: 'float',
      lines: LINES,
      result: 'z * h',
    },
  };
  return [uv, blk] as unknown as GraphNode[];
}

let root: Root;
let el: HTMLDivElement;
let errors: unknown[];
beforeEach(() => {
  errors = [];
  boom.on = false;
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el, { onUncaughtError: e => { errors.push(e); }, onCaughtError: e => { errors.push(e); } });
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const q = (s: string) => document.querySelector<HTMLElement>(s);

describe.each([['p wired as an input', true], ['the scratch p', false]])('the explain view opens for typical lines (%s)', (_name, pInput) => {
  it.each([0, 1, 2, 3, 'return'] as const)('line %s', async at => {
    useNodeGraphStore.setState({ nodes: graph(pInput as boolean), activeGroupPath: [], previewNodeId: null });
    const node = useNodeGraphStore.getState().nodes.find(n => n.id === 'blk')!;
    act(() => root.render(<ExprBlockModal node={node} onClose={() => {}} />));
    const folds = document.querySelectorAll('[data-line-fold]');
    const fold = folds[at === 'return' ? folds.length - 1 : at];
    act(() => (fold.querySelector('[data-explain-toggle]') as HTMLElement).click());
    act(() => (fold.querySelector('[data-explain-action="open-view"]') as HTMLElement).click());
    await act(async () => { await import('../LineExplainView'); await new Promise(r => setTimeout(r, 0)); });
    expect(errors).toEqual([]);
    expect(q('[data-explain-view-page]')).not.toBeNull();
    // Step through every row and open Try values: none of it throws
    for (const row of document.querySelectorAll<HTMLElement>('[data-buildup-row]')) act(() => row.click());
    act(() => q('[data-explain-try-toggle]')!.click());
    for (const sw of document.querySelectorAll<HTMLElement>('[data-override] [role="switch"]')) act(() => sw.click());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(errors).toEqual([]);
    expect(q('[data-explain-view-page]')).not.toBeNull();
  });
});

async function openLine(at: number) {
  useNodeGraphStore.setState({ nodes: graph(true), activeGroupPath: [], previewNodeId: null });
  const node = useNodeGraphStore.getState().nodes.find(n => n.id === 'blk')!;
  act(() => root.render(<ExprBlockModal node={node} onClose={() => {}} />));
  const fold = document.querySelectorAll('[data-line-fold]')[at];
  act(() => (fold.querySelector('[data-explain-toggle]') as HTMLElement).click());
  act(() => (fold.querySelector('[data-explain-action="open-view"]') as HTMLElement).click());
  await act(async () => { await import('../LineExplainView'); await new Promise(r => setTimeout(r, 0)); });
}

describe('the explain view', () => {
  it('names the line’s pattern once, over its sentence: its step has no chip repeating it', async () => {
    await openLine(2); // z = 1.0 - dot(p, p): flipping a mask
    expect(q('[data-explain-pattern]')!.textContent).toBe('Flipping a mask');
    const view = q('[data-explain-view-page]')!;
    expect(view.textContent).not.toContain('Invert (1 − x)');
    expect(view.textContent).toContain('Squared length'); // an inner step's own pattern stays
  });

  it('a failure inside the view stays in the view: a message and Back, the app still standing', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    boom.on = true;
    await openLine(2);
    quiet.mockRestore();
    expect(errors.filter(e => !String(e).includes('boom'))).toEqual([]); // only the expected one, caught
    expect(q('[data-explain-view-failed]')!.textContent).toContain('boom');
    boom.on = false;
    act(() => q('[data-explain-view-failed] [data-explain-action="back"]')!.click());
    expect(q('[data-explain-view-failed]')).toBeNull();
    expect(document.querySelectorAll('[data-line-fold]')).toHaveLength(5);
  });
});

describe('the live picture’s uniforms', () => {
  it('vec2…vec4 become vectors; any other array (a float[N], a matrix) stays an array, as three.js takes it', () => {
    const u = uniformsOf({ a: 1, b: [1, 2], c: [1, 2, 3], d: [1, 2, 3, 4], e: [1, 2, 3, 4, 5, 6], f: [0.5] });
    expect(u.a.value).toBe(1);
    expect(u.b.value).toBeInstanceOf(THREE.Vector2);
    expect(u.c.value).toBeInstanceOf(THREE.Vector3);
    expect(u.d.value).toBeInstanceOf(THREE.Vector4);
    expect(u.e.value).toEqual([1, 2, 3, 4, 5, 6]);
    expect(u.f.value).toEqual([0.5]);
  });
});
