/**
 * Line previews (lineProbe.ts): routing a line's variable to the eye preview as a temporary probe
 * (graph unchanged afterwards), its type → the Show as modes, ↑/↓ stepping, and the last good
 * copy kept while a line doesn't compile yet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear(),
  });
});

import type { GraphNode } from '../../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { ExprBlockNode, CustomFnNode } from '../../../nodes/definitions/effects';
import {
  applyProbe, customFnLocals, exprLineVariable, probeSteps, probedNode, resolveProbe, stepProbe, useLineProbe, PROBE_KEY,
} from '../lineProbe';
import { modesFor, pickPreviewOutput } from '../showAs';

function block(id = 'blk'): GraphNode {
  const inputs = [{ name: 'uv', type: 'vec2', slider: null }, { name: 't', type: 'float', slider: null }];
  return {
    id, type: 'exprNode', position: { x: 0, y: 0 },
    inputs: { uv: { type: 'vec2', label: 'uv' }, t: { type: 'float', label: 't' } },
    outputs: { result: { type: 'vec3', label: 'Result' } },
    params: {
      inputs, outputType: 'vec3',
      lines: [
        { lhs: 'vec2 q', op: '=', rhs: 'uv * 3.0' },
        { lhs: 'float h', op: '=', rhs: 'fract(dot(q, vec2(0.7, 0.3)) + t)' },
        { lhs: 'h', op: '*=', rhs: '2.0' },
        { lhs: 'vec3 col', op: '=', rhs: 'vec3(h)' },
        { lhs: 'int n', op: '=', rhs: '3' },
      ],
      result: 'col',
    },
  } as unknown as GraphNode;
}

describe('probe routing', () => {
  it('a line probe keeps the lines up to it and exposes its variable, nothing else', () => {
    const r = applyProbe(block(), { kind: 'line', index: 1 });
    if ('error' in r) throw new Error(r.error);
    expect(r.outputKey).toBe('h');
    expect(r.node.params.lines).toHaveLength(2);
    expect(r.node.params.outputs).toEqual(['h']);
    expect(Object.keys(r.node.outputs)).toEqual(['h']);
    expect(r.node.outputs.h.type).toBe('float');
    const { code, outputVars } = ExprBlockNode.generateGLSL(r.node, { uv: 'v_uv', t: 'u_time' }) as { code: string; outputVars: Record<string, string> };
    expect(outputVars.h).toBe('blk_h');
    expect(code).toContain('blk_h = h;');
    expect(code).not.toContain('vec3 col');
  });

  it('a reassigned variable is read right after that line (not at the end)', () => {
    const r = applyProbe(block(), { kind: 'line', index: 2 });
    if ('error' in r) throw new Error(r.error);
    expect(r.node.params.lines).toHaveLength(3);
    expect(exprLineVariable(block(), 2)).toEqual({ name: 'h', type: 'float' });
  });

  it('inputs and Return probe too', () => {
    const inp = applyProbe(block(), { kind: 'input', name: 'uv' });
    if ('error' in inp) throw new Error(inp.error);
    expect(inp).toMatchObject({ outputKey: 'uv' });
    expect(inp.node.params.lines).toEqual([]);
    const ret = applyProbe(block(), { kind: 'return' });
    if ('error' in ret) throw new Error(ret.error);
    expect(ret.outputKey).toBe('result');
  });

  it('the saved graph is unchanged and no undo step is added: the copy lives in the preview compile only', () => {
    const node = block('lp1');
    useNodeGraphStore.setState({ nodes: [node], previewNodeId: null });
    const before = JSON.stringify(useNodeGraphStore.getState().nodes);
    const undoBefore = (undoManager as unknown as { history: unknown[] }).history.length;
    useLineProbe.getState().set({ nodeId: 'lp1', target: { kind: 'line', index: 1 } });
    useNodeGraphStore.getState().setPreviewNodeId('lp1');
    const fs = useNodeGraphStore.getState().fragmentShader;
    // The compiled preview has the line's variable as an output (names are the compiler's own)
    const v = useNodeGraphStore.getState().nodeOutputVarMap.get('lp1')?.h;
    expect(v).toBeTruthy();
    expect(fs).toContain(`${v} = h;`);
    expect(fs).not.toContain('vec3 col');
    expect(JSON.stringify(useNodeGraphStore.getState().nodes)).toBe(before);
    expect((undoManager as unknown as { history: unknown[] }).history.length).toBe(undoBefore);
    // The runner and the Show as UI see the same copy
    expect(pickPreviewOutput(probedNode(useNodeGraphStore.getState().nodes[0]))).toEqual(['h', 'float']);
    useLineProbe.getState().set(null);
    useNodeGraphStore.getState().setPreviewNodeId(null);
    expect(JSON.stringify(useNodeGraphStore.getState().nodes)).toBe(before);
  });

  it('Custom Function: a named local is assigned to the probe right after its declaration', () => {
    const body = 'vec2 p = uv * 1.2;\nfloat l = length(p)\n  - 1.0;\nreturn vec3(l);';
    expect(customFnLocals(body).map(l => [l.name, l.type, l.line])).toEqual([['p', 'vec2', 0], ['l', 'float', 1]]);
    const node = {
      id: 'cf', type: 'customFn', position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'uv' } },
      outputs: { result: { type: 'vec3', label: 'Result' } },
      params: { label: 'Ring', inputs: [{ name: 'uv', type: 'vec2', slider: null }], outputType: 'vec3', body, outputs: [{ name: 'mask', type: 'float' }] },
    } as unknown as GraphNode;
    const r = applyProbe(node, { kind: 'local', name: 'l', line: 1 });
    if ('error' in r) throw new Error(r.error);
    expect(r.outputKey).toBe(PROBE_KEY);
    // After the statement ends (line 3 of the body), not mid-statement
    expect((r.node.params.body as string).split('\n')[3]).toBe(`${PROBE_KEY} = l;`);
    // Its own out parameter stays declared
    expect((r.node.params.outputs as Array<{ name: string }>).map(o => o.name)).toEqual(['mask', PROBE_KEY]);
    const { code } = CustomFnNode.generateGLSL(r.node, { uv: 'v_uv' }) as { code: string };
    expect(code).toContain(`cf_${PROBE_KEY} = l;`);
    expect(code).not.toMatch(/__/);
  });
});

describe('type → Show as', () => {
  it('follows the probed variable\'s type', () => {
    const typeOf = (index: number) => { const r = resolveProbe(block(), { kind: 'line', index }); return 'error' in r ? null : r.type; };
    expect(typeOf(0)).toBe('vec2');
    expect(typeOf(1)).toBe('float');
    expect(typeOf(3)).toBe('vec3');
    expect(modesFor('float').map(m => m.label)).toEqual(['Range', 'Slice', 'Contours', 'Raw']);
    expect(modesFor('vec2').map(m => m.label)).toEqual(['Grid', 'Arrows', 'Wheel', 'Raw']);
    const colour = applyProbe(block(), { kind: 'line', index: 3 });
    expect('error' in colour ? null : pickPreviewOutput(colour.node)).toEqual(['col', 'vec3']);
  });

  it('a type a picture can\'t draw says so', () => {
    expect(applyProbe(block(), { kind: 'line', index: 4 })).toEqual({ error: expect.stringContaining('int') });
  });
});

describe('stepping', () => {
  it('walks inputs, then each line, then Return, and stops at the ends', () => {
    const n = block();
    expect(probeSteps(n).map(s => s.kind)).toEqual(['input', 'input', 'line', 'line', 'line', 'line', 'line', 'return']);
    expect(stepProbe(n, { kind: 'line', index: 0 }, 1)).toEqual({ kind: 'line', index: 1 });
    expect(stepProbe(n, { kind: 'line', index: 0 }, -1)).toEqual({ kind: 'input', name: 't' });
    expect(stepProbe(n, { kind: 'return' }, 1)).toEqual({ kind: 'return' });
    expect(stepProbe(n, { kind: 'input', name: 'uv' }, -1)).toEqual({ kind: 'input', name: 'uv' });
  });
});

describe('errors', () => {
  beforeEach(() => useLineProbe.getState().set(null));

  it('an unfinished or switched-off line says so', () => {
    const n = block();
    (n.params.lines as Array<{ rhs: string; off?: boolean }>)[1].rhs = '';
    expect(applyProbe(n, { kind: 'line', index: 1 })).toEqual({ error: expect.stringContaining('isn\'t finished') });
    const off = block();
    (off.params.lines as Array<{ off?: boolean }>)[1].off = true;
    expect(applyProbe(off, { kind: 'line', index: 1 })).toEqual({ error: expect.stringContaining('switched off') });
  });

  it('while a line is broken mid-typing, the preview keeps the last copy that worked', () => {
    const good = block('eb');
    const probe = { nodeId: 'eb', target: { kind: 'line' as const, index: 1 } };
    useLineProbe.getState().set(probe);
    const goodCopy = probedNode(good, probe);
    expect(goodCopy.outputs.h).toBeDefined();
    const typing = { ...good, params: { ...good.params, lines: (good.params.lines as Array<Record<string, unknown>>).map((l, i) => (i === 1 ? { ...l, rhs: '' } : l)) } } as GraphNode;
    expect(probedNode(typing, probe)).toBe(goodCopy);
    // Another line has no good copy yet: the block itself
    const other = { nodeId: 'eb', target: { kind: 'line' as const, index: 2 } };
    const typing2 = { ...good, params: { ...good.params, lines: (good.params.lines as Array<Record<string, unknown>>).map((l, i) => (i === 2 ? { ...l, rhs: '' } : l)) } } as GraphNode;
    expect(probedNode(typing2, other)).toBe(typing2);
  });

  it('a node without a probe on it is passed through untouched', () => {
    const n = block('x');
    expect(probedNode(n, { nodeId: 'other', target: { kind: 'return' } })).toBe(n);
    expect(probedNode(n, null)).toBe(n);
  });
});
