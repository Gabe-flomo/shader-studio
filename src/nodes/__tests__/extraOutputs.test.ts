/**
 * More than one output: a Custom Function's extra outputs (assigned by name
 * in the body, like GLSL `out` parameters) and an Expression Block's exposed
 * locals are sockets other cards read; the store rebuilds them and drops
 * wires into outputs that went away.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
// The store reads localStorage while its module loads, so the stub has to exist before the import.
vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });

describe('extra outputs', () => {
  it('a Custom Function assigns its extra outputs by name and each is a socket', () => {
    const fn = node('f', 'customFn', { uv: { type: 'vec2', label: 'uv', connection: { nodeId: 'uv', outputKey: 'uv' } } },
      { result: { type: 'float', label: 'Result' }, depth: { type: 'float', label: 'depth' }, n: { type: 'vec3', label: 'n' } },
      { inputs: [{ name: 'uv', type: 'vec2', slider: null }], outputType: 'float', outputs: [{ name: 'depth', type: 'float' }, { name: 'n', type: 'vec3' }], body: 'float d = length(uv);\ndepth = d * 2.0;\nn = vec3(uv, d);\nreturn d;' });
    const graph = [
      node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
      fn,
      node('add', 'add', { a: { type: 'float', label: 'A', connection: { nodeId: 'f', outputKey: 'result' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'f', outputKey: 'depth' } } }, { result: { type: 'float', label: 'Result' } }, { outputType: 'float' }),
      node('mul', 'multiply', { a: { type: 'vec3', label: 'A', connection: { nodeId: 'f', outputKey: 'n' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'add', outputKey: 'result' } } }, { result: { type: 'vec3', label: 'Result' } }, { outputType: 'vec3' }),
      node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul', outputKey: 'result' } } }, {}),
    ];
    const c = compileGraph({ nodes: graph });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
    expect(c.fragmentShader).toMatch(/float (\w+)_depth = 0\.0;/);
    expect(c.fragmentShader).toMatch(/vec3 (\w+)_n = vec3\(0\.0\);/);
    expect(c.fragmentShader).toMatch(/(\w+)_depth = d \* 2\.0;/);
    expect(c.fragmentShader).toMatch(/(\w+)_result \+ (\w+)_depth/);
  });

  it('an Expression Block exposes an input or a typed line variable as an output', () => {
    const block = node('b', 'exprNode', { p: { type: 'vec2', label: 'p', connection: { nodeId: 'uv', outputKey: 'uv' } } },
      { result: { type: 'vec3', label: 'Result' }, d: { type: 'float', label: 'd' }, p: { type: 'vec2', label: 'p' } },
      { inputs: [{ name: 'p', type: 'vec2', slider: null }], outputType: 'vec3', lines: [{ lhs: 'p', op: '*=', rhs: '2.0' }, { lhs: 'float d', op: '=', rhs: 'length(p)' }], result: 'vec3(d)', outputs: ['d', 'p'] });
    const graph = [
      node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
      block,
      node('f2v', 'floatToVec3', { input: { type: 'float', label: 'Float', connection: { nodeId: 'b', outputKey: 'd' } } }, { rgb: { type: 'vec3', label: 'Color' } }),
      node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, {}),
    ];
    const c = compileGraph({ nodes: graph });
    expect(c.errors ?? []).toEqual([]);
    expect(c.fragmentShader).toMatch(/float (\w+)_d;/);
    expect(c.fragmentShader).toMatch(/vec2 (\w+)_p;/);
    expect(c.fragmentShader).toMatch(/(\w+)_d = d;/);
    expect(c.fragmentShader).toMatch(/(\w+)_p = p;/);
  });

  it('the store rebuilds the sockets and drops a wire into an output that went away', () => {
    const s = useNodeGraphStore.getState();
    s.setNodesRewritten([
      node('f', 'customFn', {}, { result: { type: 'float', label: 'Result' }, depth: { type: 'float', label: 'depth' } }, { inputs: [], outputType: 'float', outputs: [{ name: 'depth', type: 'float' }], body: 'return 1.0;' }),
      node('r', 'floatToVec3', { input: { type: 'float', label: 'Float', connection: { nodeId: 'f', outputKey: 'depth' } } }, { rgb: { type: 'vec3', label: 'Color' } }),
    ]);
    s.updateNodeSockets('f', [], 'float', [{ name: 'depth', type: 'float' }, { name: 'n', type: 'vec3' }]);
    let f = useNodeGraphStore.getState().nodes.find(n => n.id === 'f')!;
    expect(Object.keys(f.outputs)).toEqual(['result', 'depth', 'n']);
    expect(f.outputs.n.type).toBe('vec3');
    expect(useNodeGraphStore.getState().nodes.find(n => n.id === 'r')!.inputs.input.connection).toEqual({ nodeId: 'f', outputKey: 'depth' });
    s.updateNodeSockets('f', [], 'float', []);
    f = useNodeGraphStore.getState().nodes.find(n => n.id === 'f')!;
    expect(Object.keys(f.outputs)).toEqual(['result']);
    expect(useNodeGraphStore.getState().nodes.find(n => n.id === 'r')!.inputs.input.connection).toBeUndefined();
  });
});
