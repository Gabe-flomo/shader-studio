// @vitest-environment jsdom
/**
 * The Explain panel's build-up view: the rows render (inputs, steps, result) with pictures by
 * kind; clicking a row or ←/→ steps through them on the ▶ preview, Escape goes back to the whole
 * line; ▶ on a line opens it. And the Expression Block side (buildUpHost.ts): which names vary,
 * the step probe, the one-compile render of a line's rows, and the cost fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});

// The GPU: renderValues gives each pass a field (pass i: every texel = i + x, so rows differ)
const renders: Array<{ fs: string; passes: number; w: number; h: number }> = [];
vi.mock('../../../lib/nodePreviewRenderer', () => ({
  nodePreviewRenderer: {
    renderValues: async (fs: string, _u: unknown, w: number, h: number, passes: number) => {
      renders.push({ fs, passes, w, h });
      return {
        ms: 4,
        fields: Array.from({ length: passes }, (_, i) => {
          const d = new Float32Array(w * h * 4);
          for (let k = 0; k < w * h; k++) { d[k * 4] = i === 0 ? 0.25 : i + (k % w) / w; d[k * 4 + 1] = 0.5; d[k * 4 + 2] = 0.75; d[k * 4 + 3] = 1; }
          return d;
        }),
      };
    },
  },
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { applyProbe, stepProbe, useLineProbe } from '../../../lib/nodePreview/lineProbe';
import { compileNodePreviewGraph } from '../../../lib/compileNodePreviewShader';
import { explainLine, type BuildUpRow } from '../../../lib/glslPatterns';
import { exprBlockBuildUp, exprBlockCost, exprBlockVarying, renderExprBlockRows, rowsCopy, type BuildUpHost } from '../buildUpHost';
import { fieldPixels, fieldSummary, stripField } from '../rowPicture';
import { ExplainRow } from '../ExplainRow';
import { ExplainView } from '../ExplainView';
import { ExprBlockModal } from '../../NodeGraph/ExprBlockModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no canvas 2D and no ResizeObserver (the line preview's panel measures itself)
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

beforeEach(() => {
  renders.length = 0;
  useLineProbe.getState().set(null);
  useNodeGraphStore.setState({ nodes: graph(), activeGroupPath: [], previewNodeId: null });
});

describe('the Expression Block side', () => {
  it('names vary when wired from something that varies, or computed from one', () => {
    const v = exprBlockVarying(blockOf(), 2, graph());
    expect([...v].sort()).toEqual(['q', 'uv']); // s comes from Time; k is a slider; w = s * k
    expect(exprBlockVarying(blockOf(), 'return', graph()).has('h')).toBe(true);
    expect(exprBlockVarying(blockOf(), 0, graph()).has('q')).toBe(false); // not set yet
  });

  it('a step probe keeps the lines above and declares the step', () => {
    const r = applyProbe(blockOf(), { kind: 'expr', line: 2, code: 'sin(q.x + w)', type: 'float', step: 'B' });
    if ('error' in r) throw new Error(r.error);
    expect(r.outputKey).toBe('pv_step');
    expect(r.node.params.lines).toEqual([...(blockOf().params.lines as unknown[]).slice(0, 2), { lhs: 'float pv_step', op: '=', rhs: 'sin(q.x + w)' }]);
    // ↑ / ↓ from a step walk from its line
    expect(stepProbe(blockOf(), { kind: 'expr', line: 2, code: 'x', type: 'float', step: 'A' }, 1)).toEqual({ kind: 'return' });
    // It compiles through the eye preview like a line probe
    useLineProbe.getState().set({ nodeId: 'blk', target: { kind: 'expr', line: 2, code: 'sin(q.x + w)', type: 'float', step: 'B' } });
    useNodeGraphStore.getState().setPreviewNodeId('blk');
    expect(useNodeGraphStore.getState().fragmentShader).toContain('float pv_step = sin(q.x + w);');
    expect(useNodeGraphStore.getState().nodes).toEqual(graph()); // the saved graph is untouched
  });

  it('all the rows of a line are one compile: each a variable, picked by u_pvSel', async () => {
    const copy = rowsCopy(blockOf(), 2, [{ expr: 'q.x + w', type: 'float' }, { expr: 'sin(q.x + w)', type: 'float' }]);
    const compiled = compileNodePreviewGraph('blk', graph().map(n => (n.id === 'blk' ? copy : n)))!;
    expect(compiled.fragmentShader).toContain('float pv_s1 = sin(q.x + w);');
    const ex = explainLine('float h = sin(q.x + w) * k', { types: { q: 'vec2', w: 'float', k: 'float' } });
    if (!ex.ok) throw new Error(ex.error);
    const host = exprBlockBuildUp(blockOf(), 2);
    const { buildUpRows } = await import('../../../lib/glslPatterns');
    const rows = buildUpRows(ex, host.varies);
    const out = (await renderExprBlockRows('blk', 2, rows, 'square'))!;
    expect(renders).toHaveLength(1);
    // The result is the same expression as the last step: one draw for both
    expect(renders[0].passes).toBe(rows.length - 1);
    expect(renders[0].fs).toContain('uniform float u_pvSel;');
    expect(renders[0].fs).toMatch(/if \(u_pvSel < 0\.5\) gl_FragColor = /);
    expect([...out.keys()]).toEqual(rows.map(r => r.key));
    expect(out.get('result')).toBe(out.get(rows[rows.length - 2].key));
    // Cached: the same shader and inputs don't render again
    await renderExprBlockRows('blk', 2, rows, 'square');
    expect(renders).toHaveLength(1);
  });

  it('a heavy upstream graph is counted, so pictures fall back to strips', () => {
    expect(exprBlockCost(blockOf(), graph())).toMatchObject({ nodes: 2, heavyTypes: [], textures: 0 });
    const g = graph();
    (g[0] as { type: string }).type = 'marchLoopGroup';
    expect(exprBlockCost(g[2], g).heavyTypes).toEqual(['marchLoopGroup']);
  });

  it('pictures: grey over the range, flat fields are constants', () => {
    const f = stripField([0, 0.5, 1]);
    expect(fieldSummary(f, 'float')).toMatchObject({ range: [0, 1], flat: false });
    expect(Array.from(fieldPixels(f, 'float', [0, 1]).filter((_, i) => i % 4 === 0))).toEqual([0, 128, 255]);
    const c = fieldSummary(stripField([[0.2, 0.4, 0.6], [0.2, 0.4, 0.6]]), 'vec3');
    expect(c.flat).toBe(true);
    (c.value as number[]).forEach((x, i) => expect(x).toBeCloseTo([0.2, 0.4, 0.6][i], 5));
  });
});

describe('the view', () => {
  let root: Root;
  let el: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); });
  afterEach(() => { act(() => root.unmount()); el.remove(); vi.useRealTimers(); });

  const ex = () => {
    const r = explainLine('float h = sin(q.x + w) * k', { types: { q: 'vec2', w: 'float', k: 'float' } });
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const rowsIn = () => [...el.querySelectorAll<HTMLElement>('[data-buildup-row]')];

  function mockHost(): BuildUpHost & { shown: Array<string | null> } {
    const shown: Array<string | null> = [];
    return {
      shown,
      varies: n => n === 'q',
      pictures: {
        cost: () => ({ nodes: 2, heavyTypes: [], textures: 0 }),
        render: async (rows: BuildUpRow[]) => new Map(rows.map((r, i) => [r.key, stripField(Array.from({ length: 4 }, (_, k) => (r.varies ? i + k : 0.5)))])),
      },
      show: row => { shown.push(row?.key ?? null); },
    };
  }

  it('renders a row per input, step and the result, with no worded sentences', async () => {
    const host = mockHost();
    act(() => root.render(<ExplainView ex={ex()} buildUp={host} />));
    expect(rowsIn().map(r => r.dataset.buildupRow)).toEqual(['in:q', 'in:w', 'in:k', 'step:A', 'step:B', 'step:C', 'result']);
    expect(el.querySelector('[data-explain-sentence], [data-explain-inshort], [data-explain-steps]')).toBeNull();
    // Constants are constants; varying rows draw (a CPU strip at once, the render after the debounce)
    expect(rowsIn().find(r => r.dataset.buildupRow === 'in:w')!.dataset.picture).toBe('constant');
    expect(rowsIn().find(r => r.dataset.buildupRow === 'step:A')!.dataset.picture).toBe('render');
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(el.querySelectorAll('[data-buildup-canvas]').length).toBeGreaterThan(0);
    expect(el.querySelector('[data-buildup-row="in:w"] [data-buildup-picture="constant"]')).not.toBeNull();
    expect(el.querySelector('[data-explain-try]')).not.toBeNull(); // the sample inputs stay
  });

  it('click a row to show it, click again (or Escape) for the whole line; ← / → step', () => {
    const host = mockHost();
    act(() => root.render(<ExplainView ex={ex()} buildUp={host} />));
    const row = (k: string) => el.querySelector<HTMLElement>(`[data-buildup-row="${k}"]`)!;
    act(() => row('step:B').click());
    expect(host.shown).toEqual(['step:B']);
    expect(row('step:B').getAttribute('aria-selected')).toBe('true');
    // Its span is lit in the code
    expect(el.querySelector('[data-explain-code] mark')?.textContent).toBe('sin(q.x + w)');
    act(() => row('step:B').click());
    expect(host.shown).toEqual(['step:B', null]);
    const list = el.querySelector<HTMLElement>('[data-buildup]')!;
    const key = (k: string) => act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowLeft');
    key('ArrowRight');
    expect(host.shown.slice(2)).toEqual(['in:q', 'in:w', 'in:q', 'in:w']);
    key('Escape');
    expect(host.shown[host.shown.length - 1]).toBeNull();
    expect(el.querySelector('[aria-selected="true"]')).toBeNull();
  });

  it('an open request opens a folded row and focuses the build-up, ready to step', () => {
    const host = mockHost();
    act(() => root.render(<ExplainRow text="float h = sin(q.x + w) * k" exprStart={10} ctx={{ types: { q: 'vec2', w: 'float', k: 'float' } }} buildUp={host} />));
    expect(el.querySelector('[data-buildup]')).toBeNull(); // folded by default
    expect(el.querySelector('[data-explain-summary]')!.textContent).toBe('q, w, k → 3 steps → h');
    act(() => root.render(<ExplainRow text="float h = sin(q.x + w) * k" exprStart={10} ctx={{ types: { q: 'vec2', w: 'float', k: 'float' } }} buildUp={host} openRequest={1e9} />));
    expect(el.querySelector('[data-buildup]')).not.toBeNull();
    expect(document.activeElement).toBe(el.querySelector('[data-buildup]'));
  });

  it('▶ on a line opens its picture right under that line, and ↑ / ↓ move it with the line', () => {
    act(() => root.render(<ExprBlockModal node={blockOf()} onClose={() => {}} />));
    expect(document.querySelectorAll('[data-line-preview]')).toHaveLength(0);
    act(() => document.querySelector<HTMLButtonElement>('[data-probe=\'{"kind":"line","index":1}\']')!.click());
    const panels = document.querySelectorAll('[data-line-preview]');
    expect(panels).toHaveLength(1);
    // After line 2's ▶ and before line 3's: under the line, not at the bottom of the list
    const play2 = document.querySelector('[data-probe=\'{"kind":"line","index":1}\']')!;
    const play3 = document.querySelector('[data-probe=\'{"kind":"line","index":2}\']')!;
    expect(play2.compareDocumentPosition(panels[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panels[0].compareDocumentPosition(play3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One ↓ steps once (only one panel listens), and the panel follows to line 3
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(useLineProbe.getState().probe?.target).toEqual({ kind: 'line', index: 2 });
    const moved = document.querySelectorAll('[data-line-preview]');
    expect(moved).toHaveLength(1);
    expect(play3.compareDocumentPosition(moved[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('▶ on a line in the Expression Block opens that line’s build-up', () => {
    act(() => root.render(<ExprBlockModal node={blockOf()} onClose={() => {}} />));
    const play = document.querySelector<HTMLButtonElement>('[data-probe=\'{"kind":"line","index":2}\']')!;
    expect(play).not.toBeNull();
    expect(document.querySelectorAll('[data-buildup]')).toHaveLength(0);
    act(() => play.click());
    expect(useLineProbe.getState().probe).toEqual({ nodeId: 'blk', target: { kind: 'line', index: 2 } });
    const views = document.querySelectorAll('[data-buildup]');
    expect(views).toHaveLength(1);
    expect(views[0].querySelector('[data-buildup-row="result"]')!.textContent).toContain('h =');
    // Stepping from there shows a step on the preview
    act(() => views[0].querySelector<HTMLElement>('[data-buildup-row="step:B"]')!.click());
    expect(useLineProbe.getState().probe?.target).toMatchObject({ kind: 'expr', line: 2, code: 'sin(q.x + w)', type: 'float', step: 'B' });
    // Escape with a row selected goes back to the whole line and keeps the editor open
    act(() => { views[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(useLineProbe.getState().probe?.target).toEqual({ kind: 'line', index: 2 });
    expect(document.querySelectorAll('[data-buildup]')).toHaveLength(1);
  });
});
