/**
 * Publishing one Expression Block or Custom Function as a node type, without
 * grouping first: the node's declared inputs become sockets (a slider input
 * keeps its slider and current value), `result` becomes the output, and a
 * Custom Function's helper block travels into the published function.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../graphCompiler';
import { registerUserNode, resetUserNodesForTests } from '../../nodes/userNodes/userNodeRegistry';
import { getNodeDefinition } from '../../nodes/definitions';
import {
  buildUserNodeDefinition, describeSource, nodeToSubgraph, type PublishSource, type PublishUserNodeSpec,
} from '../../nodes/userNodes/publishUserNode';

/** An Expression Block: uv (vec2, wired on the canvas), amp (float slider = 0.5), returns a vec3. */
function exprBlock(): GraphNode {
  return {
    id: 'ex1', type: 'exprNode', position: { x: 0, y: 0 },
    inputs: {
      uv:  { type: 'vec2',  label: 'uv', connection: { nodeId: 'someUv', outputKey: 'uv' } },
      amp: { type: 'float', label: 'amp' },
    },
    outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
    params: {
      label: 'Stripes',
      inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 'amp', type: 'float', slider: { min: 0, max: 2 } }],
      amp: 0.5,
      outputType: 'vec3',
      lines: [{ lhs: 'float s', op: '=', rhs: 'sin(uv.x * 10.0 + t) * amp' }],
      result: 'vec3(s, s * 0.5, 1.0 - s)',
      expr: 'vec3(s, s * 0.5, 1.0 - s)',
    },
  };
}

/** A Custom Function whose body calls a helper defined in its own glslFunctions block. */
function customFn(): GraphNode {
  return {
    id: 'cf1', type: 'customFn', position: { x: 0, y: 0 },
    inputs: { p: { type: 'vec2', label: 'p' }, k: { type: 'float', label: 'k' } },
    outputs: { result: { type: 'float', label: 'Result' } },
    params: {
      label: 'Ring',
      inputs: [{ name: 'p', type: 'vec2', slider: null }, { name: 'k', type: 'float', slider: { min: 0, max: 4 } }],
      k: 2,
      outputType: 'float',
      body: 'return ringHelper(p) * k;',
      glslFunctions: 'float ringHelper(vec2 q) { return abs(length(q) - 0.5); }',
    },
  };
}

/** Build the publish spec the dialog would build with every port left at its suggestion. */
function specFor(source: PublishSource, label: string): PublishUserNodeSpec {
  const ports = describeSource(source);
  if (ports.error) throw new Error(ports.error);
  return {
    label, category: 'My Nodes',
    inputs: ports.inputs.map(i => ({ portKey: i.portKey, key: i.portKey, label: i.label, type: i.type, slider: i.slider ?? null })),
    outputs: ports.outputs.map(o => ({ portKey: o.portKey, key: o.portKey, label: o.label, type: o.type })),
    params: [],
  };
}

describe('nodeToSubgraph', () => {
  it('turns every declared input into a port and Result into the output, detached from the canvas', () => {
    const sg = nodeToSubgraph(exprBlock());
    expect(sg.nodes).toHaveLength(1);
    expect(sg.inputPorts.map(p => [p.key, p.type])).toEqual([['uv', 'vec2'], ['amp', 'float']]);
    expect(sg.outputPorts).toEqual([{ key: 'result', type: 'vec3', label: 'Result', fromNodeId: 'ex1', fromOutputKey: 'result' }]);
    // the canvas wire is replaced by the port sentinel
    expect(sg.nodes[0].inputs.uv.connection?.nodeId).not.toBe('someUv');
  });

  it('offers a slider input\'s range and current value as the port\'s slider', () => {
    const ports = describeSource({ kind: 'node', node: exprBlock() });
    expect(ports.inputs.find(i => i.portKey === 'amp')?.slider).toEqual({ min: 0, max: 2, default: 0.5 });
    expect(ports.inputs.find(i => i.portKey === 'uv')?.slider).toBeUndefined();
  });
});

describe('publishing a single node', () => {
  beforeEach(() => resetUserNodesForTests());

  it('an Expression Block becomes a node with sockets and compiles when placed', async () => {
    const source: PublishSource = { kind: 'node', node: exprBlock() };
    const built = buildUserNodeDefinition(source, { ...specFor(source, 'Stripes'), existingId: 'un_stripes' });
    expect(built.ok, built.ok ? '' : built.error).toBe(true);
    if (!built.ok) return;
    expect(built.def.functionCode).toMatch(/^vec3 un_stripes\(vec2 in_uv, float in_amp\)/);
    expect(built.def.inputs.find(i => i.key === 'amp')?.slider).toMatchObject({ min: 0, max: 2, default: 0.5 });
    await registerUserNode(built.def, { persist: false });

    const def = getNodeDefinition('un_stripes')!;
    expect(def.inputs.uv.type).toBe('vec2');
    expect(def.outputs.result.type).toBe('vec3');

    const graph: GraphNode[] = [
      { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'n', type: 'un_stripes', position: { x: 0, y: 0 },
        inputs: { uv: { type: 'vec2', label: 'uv', connection: { nodeId: 'uv', outputKey: 'uv' } }, amp: { type: 'float', label: 'amp' } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { amp: 1.2 } },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'n', outputKey: 'result' } } }, outputs: {}, params: {} },
    ];
    const r = compileGraph({ nodes: graph });
    expect(r.success, r.errors?.join('\n')).toBe(true);
    expect(r.fragmentShader.match(/vec3 un_stripes\(/g)?.length).toBe(1);
    // the unwired slider input is a live uniform passed as the argument
    expect(r.fragmentShader).toMatch(/= un_stripes\(\w+, u_p_\w+_amp\)/);
  });

  it('a Custom Function carries its helper block into the published node', async () => {
    const source: PublishSource = { kind: 'node', node: customFn() };
    const built = buildUserNodeDefinition(source, { ...specFor(source, 'Ring'), existingId: 'un_ring' });
    expect(built.ok, built.ok ? '' : built.error).toBe(true);
    if (!built.ok) return;
    expect(built.def.helperFunctions.some(h => h.includes('float ringHelper('))).toBe(true);
    expect(built.def.functionCode).toContain('ringHelper(');
    await registerUserNode(built.def, { persist: false });

    const graph: GraphNode[] = [
      { id: 'n', type: 'un_ring', position: { x: 0, y: 0 },
        inputs: { p: { type: 'vec2', label: 'p' }, k: { type: 'float', label: 'k' } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { k: 2 } },
      { id: 'f2v', type: 'floatToVec3', position: { x: 0, y: 0 }, inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'n', outputKey: 'result' } } }, outputs: { rgb: { type: 'vec3', label: 'Color' } }, params: {} },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, outputs: {}, params: {} },
    ];
    const r = compileGraph({ nodes: graph });
    expect(r.success, r.errors?.join('\n')).toBe(true);
    expect(r.fragmentShader).toContain('float ringHelper(vec2 q)');
  });

  it('refuses a node with no declared inputs left but still publishes with Result only', () => {
    const node = exprBlock();
    node.params.inputs = [];
    node.inputs = {};
    const source: PublishSource = { kind: 'node', node };
    const built = buildUserNodeDefinition(source, { ...specFor(source, 'Const'), existingId: 'un_const' });
    expect(built.ok, built.ok ? '' : built.error).toBe(true);
    if (built.ok) expect(built.def.inputs).toEqual([]);
  });
});
