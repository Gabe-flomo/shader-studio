/**
 * User-published node types: a group subgraph is flattened into one GLSL
 * function, registered as a node type, and used by a graph like a built-in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GROUP_PORT_SENTINEL, type GraphNode, type SubgraphData } from '../../types/nodeGraph';
import type { UserNodeDefinition } from '../../types/userNode';
import { flattenSubgraphToFunction } from '../flattenSubgraph';
import { registerUserNode, resetUserNodesForTests, getUserNodeDefinition } from '../../nodes/userNodes/userNodeRegistry';
import { getNodeDefinition } from '../../nodes/definitions';
import { compileGraph } from '../graphCompiler';

/**
 *   in0 (vec2) ─▶ length ─▶ multiply(b = 3) ─▶ sin(freq, amp) ─▶ floatToVec3 ─▶ out0 (vec3)
 *                                                └────────────────────────────▶ out1 (float)
 */
function makeSubgraph(): SubgraphData {
  const nodes: GraphNode[] = [
    { id: 'n_len', type: 'length', position: { x: 0, y: 0 },
      inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: 'in0' } }, scale: { type: 'float', label: 'Scale' } },
      outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1 } },
    { id: 'n_mul', type: 'multiply', position: { x: 0, y: 0 },
      inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'n_len', outputKey: 'output' } }, b: { type: 'float', label: 'B' } },
      outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 3 } },
    { id: 'n_sin', type: 'sin', position: { x: 0, y: 0 },
      inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'n_mul', outputKey: 'result' } }, freq: { type: 'float', label: 'Freq' }, amp: { type: 'float', label: 'Amp' } },
      outputs: { output: { type: 'float', label: 'Output' } }, params: { freq: 2.5, amp: 0.75 } },
    { id: 'n_f2v', type: 'floatToVec3', position: { x: 0, y: 0 },
      inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'n_sin', outputKey: 'output' } } },
      outputs: { rgb: { type: 'vec3', label: 'Color' } }, params: {} },
  ];
  return {
    nodes,
    inputPorts: [{ key: 'in0', type: 'vec2', label: 'UV', toNodeId: 'n_len', toInputKey: 'input' }],
    outputPorts: [
      { key: 'out0', type: 'vec3', label: 'Color', fromNodeId: 'n_f2v', fromOutputKey: 'rgb' },
      { key: 'out1', type: 'float', label: 'Wave', fromNodeId: 'n_sin', fromOutputKey: 'output' },
    ],
  };
}

function flatten(overrides: Partial<Parameters<typeof flattenSubgraphToFunction>[0]> = {}) {
  return flattenSubgraphToFunction({
    subgraph: makeSubgraph(),
    fnName: 'un_test_fn',
    inputs: [{ key: 'uv', portKey: 'in0', type: 'vec2', label: 'UV' }],
    outputs: [
      { key: 'color', portKey: 'out0', type: 'vec3', label: 'Color' },
      { key: 'wave', portKey: 'out1', type: 'float', label: 'Wave' },
    ],
    params: [{ key: 'freq', label: 'Frequency', min: 0.01, max: 20, default: 2.5, sourcePath: 'n_sin::freq' }],
    ...overrides,
  });
}

describe('flattenSubgraphToFunction', () => {
  it('emits one GLSL function with ports as arguments and a surfaced param', () => {
    const r = flatten();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.functionCode).toMatch(/^vec3 un_test_fn\(vec2 in_uv, float p_freq, out float out_wave\) \{/);
    expect(r.functionCode).toMatch(/return \w+;\s*\}$/);
    expect(r.functionCode).toContain('out_wave = ');
    // the surfaced param is read through its argument…
    expect(r.functionCode).toContain('p_freq');
    // …and nothing is left as a per-instance uniform
    expect(r.functionCode).not.toMatch(/u_p_/);
    // the input port feeds the first node
    expect(r.functionCode).toContain('in_uv');
  });

  it('bakes non-surfaced params as literals', () => {
    const r = flatten();
    if (!r.ok) throw new Error(r.error);
    expect(r.functionCode).toContain('3.0');   // multiply.b
    expect(r.functionCode).toContain('0.75');  // sin.amp
  });

  it('adds g_uv as a hidden argument only when the body uses it', () => {
    // An unconnected vec2 `uv` socket auto-fills with the main()-scope g_uv,
    // which a standalone function can't see — so it has to be passed in.
    const sg = makeSubgraph();
    sg.nodes.unshift({ id: 'n_recip', type: 'uvReciprocal', position: { x: 0, y: 0 },
      inputs: { uv: { type: 'vec2', label: 'UV' } }, outputs: { result: { type: 'vec2', label: 'Result' } }, params: { mode: '0.0', k: 1 } });
    sg.nodes[1].inputs.input.connection = { nodeId: 'n_recip', outputKey: 'result' };
    sg.inputPorts = [];
    const r = flattenSubgraphToFunction({
      subgraph: sg, fnName: 'un_uses_guv', inputs: [],
      outputs: [{ key: 'color', portKey: 'out0', type: 'vec3', label: 'Color' }], params: [],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.implicitGlobals).toEqual(['g_uv']);
    expect(r.functionCode).toMatch(/^vec3 un_uses_guv\(vec2 g_uv\)/);
    // the helper the inner node needs was captured
    expect(r.helperFunctions.some(h => h.includes('vec2 uvReciprocalFn('))).toBe(true);

    const plain = flatten();
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.implicitGlobals).toEqual([]);
  });

  it('refuses unsupported nodes with a readable reason', () => {
    const sg = makeSubgraph();
    sg.nodes.push({ id: 'n_pf', type: 'prevFrame', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} });
    const r = flattenSubgraphToFunction({ subgraph: sg, fnName: 'x', inputs: [], outputs: [{ key: 'c', portKey: 'out0', type: 'vec3', label: 'C' }], params: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/previous frame/);
  });

  it('refuses when there is no output', () => {
    const r = flatten({ outputs: [] });
    expect(r.ok).toBe(false);
  });
});

describe('user node registry + compile', () => {
  beforeEach(() => resetUserNodesForTests());

  async function publish(): Promise<UserNodeDefinition> {
    const r = flatten();
    if (!r.ok) throw new Error(r.error);
    const def: UserNodeDefinition = {
      id: 'un_test_ripple',
      label: 'Test Ripple',
      category: 'My Nodes',
      inputs: [{ key: 'uv', type: 'vec2', label: 'UV' }],
      outputs: [{ key: 'color', type: 'vec3', label: 'Color' }, { key: 'wave', type: 'float', label: 'Wave' }],
      params: [{ key: 'freq', label: 'Frequency', min: 0.01, max: 20, default: 2.5 }],
      fnName: 'un_test_fn',
      functionCode: r.functionCode,
      helperFunctions: r.helperFunctions,
      implicitGlobals: r.implicitGlobals,
      version: 1,
      savedAt: 0,
    };
    await registerUserNode(def, { persist: false });
    return def;
  }

  it('is visible through getNodeDefinition with sockets and a live param', async () => {
    await publish();
    const def = getNodeDefinition('un_test_ripple');
    expect(def).toBeDefined();
    expect(def!.inputs.uv.type).toBe('vec2');
    expect(def!.outputs.color.type).toBe('vec3');
    expect(def!.outputs.wave.type).toBe('float');
    expect(def!.paramDefs?.freq.type).toBe('float');
    expect(def!.defaultParams?.freq).toBe(2.5);
    expect(getUserNodeDefinition('nope')).toBeUndefined();
  });

  it('compiles a graph using the node: one call, param as a live uniform, function emitted once', async () => {
    const def = await publish();
    const inst = (id: string, x: number): GraphNode => ({
      id, type: def.id, position: { x, y: 0 },
      inputs: { uv: { type: 'vec2', label: 'UV' } },
      outputs: { color: { type: 'vec3', label: 'Color' }, wave: { type: 'float', label: 'Wave' } },
      params: { freq: 4 },
    });
    const graph: GraphNode[] = [
      inst('a', 0),
      inst('b', 100),
      { id: 'mix', type: 'mixVec3', position: { x: 200, y: 0 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'a', outputKey: 'color' } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'b', outputKey: 'color' } },
          t: { type: 'float', label: 'T', connection: { nodeId: 'a', outputKey: 'wave' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out', type: 'output', position: { x: 300, y: 0 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mix', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ];
    const r = compileGraph({ nodes: graph });
    expect(r.success, r.errors?.join('\n')).toBe(true);
    const fs = r.fragmentShader;
    // function defined exactly once, called twice
    expect(fs.match(/vec3 un_test_fn\(/g)?.length).toBe(1);
    expect(fs.match(/= un_test_fn\(/g)?.length).toBe(2);
    // each instance's Frequency is a real uniform
    const freqUniforms = Object.keys(r.paramUniforms).filter(u => u.endsWith('_freq'));
    expect(freqUniforms.length).toBe(2);
    for (const u of freqUniforms) expect(fs).toMatch(new RegExp(`= un_test_fn\\([^;]*\\b${u}\\b`));
    // unconnected uv input falls back to the graph UV
    expect(fs).toMatch(/un_test_fn\(g_uv, /);
  });
});
