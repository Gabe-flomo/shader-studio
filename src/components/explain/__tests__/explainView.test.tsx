// @vitest-environment jsdom
/**
 * The Expression Block's explain view (LineExplainView.tsx): the fold under a line is light (a
 * short summary and Open explain view; no per-line model button, Explain the block stays); the view
 * replaces the editor and Back returns; picking a step picks what the live picture draws; values set
 * by hand become uniforms of the picture's program, and Reset makes every name live again; the main
 * canvas is held while the view is open; the model's line explanation is offered there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});

// The GPU of the row pictures: every pass a flat field
vi.mock('../../../lib/nodePreviewRenderer', () => ({
  nodePreviewRenderer: {
    renderValues: async (_fs: string, _u: unknown, w: number, h: number, passes: number) => ({ ms: 1, fields: Array.from({ length: passes }, () => new Float32Array(w * h * 4).fill(0.5)) }),
  },
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useLineProbe } from '../../../lib/nodePreview/lineProbe';
import { buildUpRows, explainLine } from '../../../lib/glslPatterns';
import { previewHeld } from '../../../lib/previewHold';
import { EXPLAIN_MODEL } from '../../../explainModel/config';
import { useExplainModel } from '../../../explainModel/client';
import { exprBlockBuildUp } from '../buildUpHost';
import { liveProgram, liveUniformValues, rawRange } from '../liveRender';
import { LineFold } from '../LineFold';
import { overridable } from '../LineExplainView';
import { ExprBlockModal } from '../../NodeGraph/ExprBlockModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function graph(): GraphNode[] {
  const uv = { id: 'uv1', type: 'uv', position: { x: 0, y: 0 }, params: {}, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } };
  const time = { id: 'tm1', type: 'time', position: { x: 0, y: 0 }, params: {}, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } } };
  const blk = {
    id: 'blk', type: 'exprNode', position: { x: 0, y: 0 },
    inputs: { uv: { type: 'vec2', label: 'uv', connection: { nodeId: 'uv1', outputKey: 'uv' } }, s: { type: 'float', label: 's', connection: { nodeId: 'tm1', outputKey: 'time' } }, k: { type: 'float', label: 'k' } },
    outputs: { result: { type: 'vec3', label: 'Result' } },
    params: {
      inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 's', type: 'float', slider: null }, { name: 'k', type: 'float', slider: { min: 0, max: 1 } }],
      outputType: 'vec3',
      lines: [
        { lhs: 'vec2 q', op: '=', rhs: 'uv * 3.0' },
        { lhs: 'float w', op: '=', rhs: 's * k' },
        { lhs: 'float h', op: '=', rhs: 'sin(q.x + w) * k' },
      ],
      result: 'vec3(h)',
      k: 0.5,
    },
  };
  return [uv, time, blk] as unknown as GraphNode[];
}
const blockOf = () => useNodeGraphStore.getState().nodes.find(n => n.id === 'blk')!;
const lineEx = () => {
  const r = explainLine('float h = sin(q.x + w) * k', { types: { q: 'vec2', w: 'float', k: 'float' } });
  if (!r.ok) throw new Error(r.error);
  return r;
};

let root: Root;
let el: HTMLDivElement;
beforeEach(() => {
  useLineProbe.getState().set(null);
  useNodeGraphStore.setState({ nodes: graph(), activeGroupPath: [], previewNodeId: null });
  useExplainModel.setState({ enabled: false, downloaded: false, downloadedIds: [], activeId: EXPLAIN_MODEL.id, loadedId: null, busyId: null, status: 'idle', progress: null, error: null });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
const click = (s: string | Element | null) => { const e = typeof s === 'string' ? q(s) : s; expect(e).toBeTruthy(); act(() => (e as HTMLElement).click()); };
/** Open line 3's explain view from its fold (the view loads on demand). */
async function openView() {
  act(() => root.render(<ExprBlockModal node={blockOf()} onClose={() => {}} />));
  const folds = document.querySelectorAll('[data-line-fold]');
  click(folds[2].querySelector('[data-explain-toggle]'));
  click(folds[2].querySelector('[data-explain-action="open-view"]'));
  await act(async () => { await import('../LineExplainView'); await new Promise(r => setTimeout(r, 0)); });
  expect(q('[data-explain-view-page]')).not.toBeNull();
}

describe('the fold under a line', () => {
  it('folded: what it reads → its steps → what it sets; open: a short summary and Open explain view', () => {
    const opened: number[] = [];
    act(() => root.render(<LineFold text="float g = smoothstep(0.0, 0.1, d)" ctx={{ types: { d: 'float' } }} onOpenView={() => opened.push(1)} />));
    expect(q('[data-explain-summary]')!.textContent).toBe('d → 1 step → g');
    expect(q('[data-line-fold-body]')).toBeNull();
    click('[data-explain-toggle]');
    const lead = q('[data-line-fold-lead]')!.textContent!;
    expect(lead.length).toBeGreaterThan(5);
    expect(lead.length).toBeLessThan(200); // a sentence, not the working
    expect(q('[data-buildup]')).toBeNull();
    expect(q('[data-explain-more]')).toBeNull(); // no model here
    click('[data-explain-action="open-view"]');
    expect(opened).toEqual([1]);
  });

  it('the editor has no per-line model button; Explain the block is still there; ▶ keeps the picture under the line and opens its fold', () => {
    act(() => root.render(<ExprBlockModal node={blockOf()} onClose={() => {}} />));
    const explains = [...document.querySelectorAll('[data-explain-action="explain"]')].map(b => b.textContent);
    expect(explains).toEqual(['Explain the block']);
    expect(document.querySelectorAll('[data-line-fold]')).toHaveLength(4); // three lines and Return
    click('[data-probe=\'{"kind":"line","index":2}\']');
    expect(document.querySelectorAll('[data-line-preview]')).toHaveLength(1);
    const fold = document.querySelectorAll('[data-line-fold]')[2];
    expect(fold.querySelector('[data-explain-action="open-view"]')).not.toBeNull();
  });
});

describe('the explain view', () => {
  it('replaces the editor, holds the main canvas, and Back returns to the lines', async () => {
    expect(previewHeld()).toBe(false);
    await openView();
    expect(q('[data-explain-where]')!.textContent).toBe('Line 3 of 3');
    expect(q('[data-explain-code]')!.textContent).toBe('float h = sin(q.x + w) * k');
    expect(q('[aria-label="Line 1 expression"]')).toBeNull(); // the editor's lines are gone
    expect(previewHeld()).toBe(true);
    // ‹ › walk the lines: Return is next, line 2 before
    click('[data-explain-nav="next"]');
    expect(q('[data-explain-where]')!.textContent).toBe('Return');
    click('[data-explain-nav="prev"]');
    click('[data-explain-nav="prev"]');
    expect(q('[data-explain-where]')!.textContent).toBe('Line 2 of 3');
    expect(previewHeld()).toBe(true);
    click('[data-explain-action="back"]');
    expect(q('[data-explain-view-page]')).toBeNull();
    expect(q('[aria-label="Line 1 expression"]')).not.toBeNull();
    expect(previewHeld()).toBe(false);
  });

  it('closing the editor while it is open lets the main canvas go', async () => {
    await openView();
    expect(previewHeld()).toBe(true);
    act(() => root.render(<div />));
    expect(previewHeld()).toBe(false);
  });

  it('picking a step picks what the picture draws; the model is offered here', async () => {
    await openView();
    const live = () => q('[data-explain-live]')!;
    expect(live().dataset.liveRow).toBe('result');
    const ex = lineEx();
    const rows = buildUpRows(ex, exprBlockBuildUp(blockOf(), 2).varies);
    const prog = liveProgram(blockOf(), useNodeGraphStore.getState().nodes, 2, rows, [])!;
    click('[data-buildup-row="step:B"]');
    expect(live().dataset.liveRow).toBe('step:B');
    expect(live().dataset.liveSel).toBe(String(prog.slots.get('step:B')));
    // ← / → step the list; Escape goes back to the whole line
    const list = q('[data-buildup]')!;
    act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(live().dataset.liveRow).toBe('step:C');
    act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(live().dataset.liveRow).toBe('result');
    expect(q('[data-explain-view-page]')).not.toBeNull(); // the first Escape only cleared the step
    // The model's explanation of this line
    expect(q('[data-explain-view-page] [data-explain-action="explain"]')!.textContent).toBe('Explain with the model');
    click('[data-explain-view-page] [data-explain-action="explain"]');
    expect(q('[data-explain-offer]')).not.toBeNull(); // no model: the download offer
  });

  it('values set by hand: off Live, then Reset makes every name live again', async () => {
    await openView();
    click('[data-explain-try-toggle]');
    const row = (n: string) => q(`[data-override="${n}"]`)!;
    expect(['q', 'w', 'k'].every(n => row(n).hasAttribute('data-override-live'))).toBe(true);
    expect(q('[data-explain-action="reset-overrides"]')).toBeNull();
    // An earlier line's variable can be set by hand like an input
    click(row('w').querySelector('[role="switch"], input[type="checkbox"], button'));
    expect(row('w').hasAttribute('data-override-live')).toBe(false);
    expect(q('[data-explain-try-summary]')!.textContent).toBe('1 set by hand, 2 live');
    click('[data-explain-action="reset-overrides"]');
    expect(row('w').hasAttribute('data-override-live')).toBe(true);
    expect(q('[data-explain-try-summary]')!.textContent).toBe('3 names, all live');
  });
});

describe('the live program', () => {
  it('every row is one program, picked by u_pvSel; overrides are uniforms assigned before the rows', () => {
    const rows = buildUpRows(lineEx(), exprBlockBuildUp(blockOf(), 2).varies);
    const nodes = useNodeGraphStore.getState().nodes;
    const plain = liveProgram(blockOf(), nodes, 2, rows, [])!;
    expect(plain.fs).toContain('uniform float u_pvSel;');
    expect(plain.fs).toMatch(/if \(u_pvSel < 0\.5\) pv_v = /);
    expect(plain.slots.get('result')).toBe(plain.slots.get('step:C')); // the same expression, one slot
    expect(plain.fs).not.toContain('u_xo0');
    // w (line 2's variable) set by hand: overwritten after the lines above, before the rows
    const set = liveProgram(blockOf(), nodes, 2, rows, [{ name: 'w', type: 'float' }, { name: 'q', type: 'vec2' }])!;
    expect(set.overrideUniforms).toEqual({ q: 'u_xo0', w: 'u_xo1' });
    expect(set.fs).toContain('uniform vec2 u_xo0;');
    expect(set.fs).toContain('uniform float u_xo1;');
    const body = set.fs.slice(set.fs.indexOf('void main'));
    expect(body.indexOf('w = s * k;')).toBeLessThan(body.indexOf('w = u_xo1;'));
    expect(body.indexOf('w = u_xo1;')).toBeLessThan(body.indexOf('pv_s0 ='));
    expect(set.key).not.toBe(plain.key);
    // A value change is a uniform, not a new program
    const vals = liveUniformValues(set, { w: 0.25, q: [1, 2] });
    expect(vals.u_xo1).toBe(0.25);
    expect(vals.u_xo0).toEqual([1, 2]);
    expect(liveUniformValues(set, {}).u_xo1).toBeUndefined();
    // The saved graph is untouched
    expect(useNodeGraphStore.getState().nodes).toEqual(graph());
  });

  it('names that can be set: the block’s inputs, the variables above, t and p', () => {
    expect([...overridable(blockOf(), 2)].sort()).toEqual(['k', 'p', 'q', 's', 't', 'uv', 'w']);
    expect(overridable(blockOf(), 0).has('q')).toBe(false);
  });

  it('the range of a read-back skips what isn’t finite', () => {
    const d = new Float32Array([0.25, 9, 9, 1, NaN, 0, 0, 1, -0.5, 0, 0, 1]);
    expect(rawRange(d, 1)).toEqual([-0.5, 0.25]);
    expect(rawRange(new Float32Array([NaN, NaN, 0, 1]), 1)).toBeNull();
  });
});
