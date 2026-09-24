/**
 * User-published node types: a group subgraph is flattened into one GLSL
 * function, registered as a node type, and used by a graph like a built-in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GROUP_PORT_SENTINEL, type GraphNode, type SubgraphData } from '../../types/nodeGraph';
import type { UserNodeDefinition } from '../../types/userNode';
import { flattenSubgraphToFunction } from '../flattenSubgraph';
import { registerUserNode, resetUserNodesForTests, getUserNodeDefinition, exportUserNodes, importUserNodes, getUserNode, unregisterUserNode, getAllUserNodes } from '../../nodes/userNodes/userNodeRegistry';
import { getNodeDefinition } from '../../nodes/definitions';
import { compileGraph } from '../graphCompiler';
import { buildUserNodeDefinition } from '../../nodes/userNodes/publishUserNode';

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

  it('a live param is also a socket, so another node can drive it', async () => {
    const def = await publish();
    const nd = getNodeDefinition(def.id)!;
    expect(nd.inputs.freq).toMatchObject({ type: 'float', label: 'Frequency' });
    const graph: GraphNode[] = [
      { id: 't', type: 'time', position: { x: 0, y: 0 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'a', type: def.id, position: { x: 0, y: 0 },
        inputs: { uv: { type: 'vec2', label: 'UV' }, freq: { type: 'float', label: 'Frequency', connection: { nodeId: 't', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' }, wave: { type: 'float', label: 'Wave' } }, params: { freq: 4 } },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'a', outputKey: 'color' } } }, outputs: {}, params: {} },
    ];
    const r = compileGraph({ nodes: graph });
    expect(r.success, r.errors?.join()).toBe(true);
    // the wire wins over the slider: the call takes the Time node's variable
    expect(r.fragmentShader).toMatch(/= un_test_fn\(g_uv, \w*time\w*, /);
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

  it('exports to a self-contained JSON file and imports it back (replace on same id)', async () => {
    const def = await publish();
    const file = JSON.stringify(exportUserNodes([def.id]));
    expect(JSON.parse(file)).toMatchObject({ version: 1, nodes: [{ id: def.id, functionCode: expect.stringContaining('un_test_fn') }] });

    unregisterUserNode(def.id);
    expect(getUserNode(def.id)).toBeUndefined();

    const r = await importUserNodes(file);
    expect(r.ok).toBe(true);
    expect(r.imported).toEqual(['Test Ripple']);
    expect(getNodeDefinition(def.id)?.label).toBe('Test Ripple');

    // importing the same file again updates in place rather than duplicating
    const again = await importUserNodes(file);
    expect(again.replaced).toEqual(['Test Ripple']);
    expect(again.imported).toEqual([]);

    // a bare definition object (not wrapped in an export file) also works
    const bare = await importUserNodes(JSON.stringify({ ...def, id: 'un_other', label: 'Other' }));
    expect(bare.imported).toEqual(['Other']);

    // garbage is refused with a message
    expect((await importUserNodes('{"hello": 1}')).ok).toBe(false);
    expect((await importUserNodes('not json')).ok).toBe(false);
  });

  it('iteration count as a slider: one function variant per count, the instance picks one', async () => {
    // A loop-carrying group: sin(x) fed back into itself each pass.
    const sg: SubgraphData = {
      nodes: [
        { id: 'c', type: 'loopCarry', position: { x: 0, y: 0 },
          inputs: { next: { type: 'float', label: 'Next', connection: { nodeId: 's', outputKey: 'output' } } },
          outputs: { value: { type: 'float', label: 'Value' } }, params: { init: 0.5 } },
        { id: 's', type: 'sin', position: { x: 0, y: 0 },
          inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'c', outputKey: 'value' } }, freq: { type: 'float', label: 'Freq' }, amp: { type: 'float', label: 'Amp' } },
          outputs: { output: { type: 'float', label: 'Output' } }, params: { freq: 2, amp: 1 } },
      ],
      inputPorts: [],
      outputPorts: [{ key: 'out0', type: 'float', label: 'Value', fromNodeId: 's', fromOutputKey: 'output' }],
    };
    const built = buildUserNodeDefinition({ kind: 'subgraph', subgraph: sg, label: 'Loop', iterations: 3 }, {
      label: 'Loopy', category: 'My Nodes',
      inputs: [], outputs: [{ portKey: 'out0', key: 'value', label: 'Value', type: 'float' }], params: [],
      iterations: { key: 'passes', label: 'Passes', min: 1, max: 4, default: 3 },
      existingId: 'un_loopy',
    });
    expect(built.ok, built.ok ? '' : built.error).toBe(true);
    if (!built.ok) return;
    const def = built.def;
    expect(Object.keys(def.iterations!.functions)).toEqual(['1', '2', '3', '4']);
    expect(def.iterations!.functions['4']).toMatch(/^float un_loopy_i4\(/);
    // more passes → more unrolled code
    expect(def.iterations!.functions['4'].length).toBeGreaterThan(def.iterations!.functions['1'].length);

    await registerUserNode(def, { persist: false });
    const nd = getNodeDefinition('un_loopy')!;
    expect(nd.paramDefs?.passes).toMatchObject({ step: 1, compileTime: true, min: 1, max: 4 });

    const graph = (passes: number): GraphNode[] => [
      { id: 'a', type: 'un_loopy', position: { x: 0, y: 0 }, inputs: {}, outputs: { value: { type: 'float', label: 'Value' } }, params: { passes } },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'a', outputKey: 'value' } } }, outputs: {}, params: {} },
    ];
    const two = compileGraph({ nodes: graph(2) });
    expect(two.success, two.errors?.join()).toBe(true);
    expect(two.fragmentShader).toContain('= un_loopy_i2(');
    expect(two.fragmentShader).toContain('float un_loopy_i2(');
    expect(two.fragmentShader).not.toContain('un_loopy_i3(');   // only the chosen variant is emitted
    expect(Object.keys(two.paramUniforms).some(u => u.endsWith('_passes'))).toBe(false); // compile-time, not a uniform

    const four = compileGraph({ nodes: graph(4) });
    expect(four.fragmentShader).toContain('= un_loopy_i4(');
  });
});

// ── Code-backed nodes and image slots ────────────────────────────────────────
import { describeSource } from '../../nodes/userNodes/publishUserNode';
import { setTransientUserNode } from '../../nodes/userNodes/userNodeRegistry';

describe('code-backed user nodes', () => {
  beforeEach(() => resetUserNodesForTests());

  const CODE = `
float hash3(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// entry
vec3 glow(sampler2D img, vec2 uv, float radius, out float mask) {
    float d = length(uv) - radius;
    mask = smoothstep(0.02, 0.0, d);
    vec3 tex = texture2D(img, uv * 0.5 + 0.5).rgb;
    return tex * mask + hash3(uv) * 0.01;
}`;

  it('reads the entry signature into inputs, an image slot, the return and an out param', () => {
    const d = describeSource({ kind: 'code', code: CODE, entry: 'glow', label: 'Glow' });
    expect(d.error).toBeUndefined();
    expect(d.functions?.map(f => f.name)).toEqual(['hash3', 'glow']);
    expect(d.inputs.map(i => [i.portKey, i.type])).toEqual([['uv', 'vec2'], ['radius', 'float']]);
    expect(d.textures.map(t => t.sourceKey)).toEqual(['img']);
    expect(d.outputs.map(o => [o.portKey, o.type])).toEqual([['__return__', 'vec3'], ['mask', 'float']]);
    // the first function is the default entry when none is named
    expect(describeSource({ kind: 'code', code: CODE, label: 'x' }).entry).toBe('hash3');
  });

  it('publishes: functions renamed under the node id, canonical argument order, helper carried, textures as slots', async () => {
    const built = buildUserNodeDefinition({ kind: 'code', code: CODE, entry: 'glow', label: 'Glow' }, {
      label: 'Glow', category: 'My Nodes',
      inputs: [{ portKey: 'uv', key: 'uv', label: 'UV', type: 'vec2' }, { portKey: 'radius', key: 'radius', label: 'Radius', type: 'float', slider: { min: 0, max: 1, default: 0.4 } }],
      outputs: [{ portKey: '__return__', key: 'color', label: 'Color', type: 'vec3' }, { portKey: 'mask', key: 'mask', label: 'Mask', type: 'float' }],
      params: [],
      textures: [{ sourceKey: 'img', key: 'image', label: 'Image' }],
      existingId: 'un_glow_code',
    });
    expect(built.ok, built.ok ? '' : built.error).toBe(true);
    if (!built.ok) return;
    const def = built.def;
    expect(def.functionCode).toMatch(/^vec3 un_glow_code\(sampler2D img, vec2 uv, float radius, out float mask\) \{/);
    expect(def.functionCode).toContain('un_glow_code_h_hash3(uv)');   // helper call renamed
    expect(def.helperFunctions[0]).toMatch(/^float un_glow_code_h_hash3\(/);
    expect(def.textures).toEqual([{ key: 'image', label: 'Image', hint: undefined }]);
    expect(def.source).toEqual({ kind: 'code', code: CODE, entry: 'glow' });

    await registerUserNode(def, { persist: false });
    const nd = getNodeDefinition('un_glow_code')!;
    expect(nd.textureSlots).toEqual(['image']);
    expect(nd.paramDefs?.radius).toMatchObject({ type: 'float', min: 0, max: 1 });

    const graph: GraphNode[] = [
      { id: 'a', type: 'un_glow_code', position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'UV' }, radius: { type: 'float', label: 'Radius' } },
        outputs: { color: { type: 'vec3', label: 'Color' }, mask: { type: 'float', label: 'Mask' } }, params: { radius: 0.4 } },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'a', outputKey: 'color' } } }, outputs: {}, params: {} },
    ];
    const r = compileGraph({ nodes: graph });
    expect(r.success, r.errors?.join()).toBe(true);
    // one sampler uniform per instance slot, bound to "<id>::<slot>"
    const [texUniform, boundTo] = Object.entries(r.textureUniforms)[0];
    expect(texUniform).toMatch(/^u_tex_\w+_image$/);
    expect(boundTo).toBe('a::image');
    expect(r.fragmentShader).toContain(`uniform sampler2D ${texUniform};`);
    expect(r.fragmentShader).toMatch(new RegExp(`un_glow_code\\(${texUniform}, g_uv, u_p_\\w+_radius, \\w+\\)`));
  });

  it('refuses void entries and unsupported parameter types with a readable message', () => {
    expect(describeSource({ kind: 'code', code: 'void f(vec2 uv) { }', label: 'x' }).error).toMatch(/void/);
    expect(describeSource({ kind: 'code', code: 'float f(int n) { return 1.0; }', label: 'x' }).error).toMatch(/int/);
    expect(describeSource({ kind: 'code', code: 'nothing here', label: 'x' }).error).toMatch(/No GLSL function/);
  });

  it('a transient definition is visible to the compiler but never listed', async () => {
    const built = buildUserNodeDefinition({ kind: 'code', code: 'float one(vec2 uv) { return 1.0; }', label: 'One' }, {
      label: 'One', category: 'My Nodes', inputs: [{ portKey: 'uv', key: 'uv', label: 'UV', type: 'vec2' }],
      outputs: [{ portKey: '__return__', key: 'v', label: 'V', type: 'float' }], params: [], existingId: 'un_previewtmp',
    });
    if (!built.ok) throw new Error(built.error);
    setTransientUserNode(built.def);
    expect(getNodeDefinition('un_previewtmp')).toBeDefined();
    expect(getAllUserNodes().some(d => d.id === 'un_previewtmp')).toBe(false);
    setTransientUserNode(null);
    expect(getNodeDefinition('un_previewtmp')).toBeUndefined();
  });
});

describe('texture inputs inside a published group', () => {
  it('become sampler arguments and per-instance uniforms', async () => {
    resetUserNodesForTests();
    const sg: SubgraphData = {
      nodes: [
        { id: 'tex', type: 'textureInput', position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: 'in0' } } },
          outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' }, uv: { type: 'vec2', label: 'UV' } }, params: { fit: 'stretch', _imageAspect: 1 } },
      ],
      inputPorts: [{ key: 'in0', type: 'vec2', label: 'UV', toNodeId: 'tex', toInputKey: 'uv' }],
      outputPorts: [{ key: 'out0', type: 'vec3', label: 'Color', fromNodeId: 'tex', fromOutputKey: 'color' }],
    };
    const built = buildUserNodeDefinition({ kind: 'subgraph', subgraph: sg, label: 'Sampler' }, {
      label: 'Sampler', category: 'My Nodes',
      inputs: [{ portKey: 'in0', key: 'uv', label: 'UV', type: 'vec2' }],
      outputs: [{ portKey: 'out0', key: 'color', label: 'Color', type: 'vec3' }],
      params: [], textures: [{ sourceKey: 'tex', key: 'photo', label: 'Photo' }], existingId: 'un_sampler',
    });
    expect(built.ok, built.ok ? '' : built.error).toBe(true);
    if (!built.ok) return;
    expect(built.def.functionCode).toMatch(/^vec3 un_sampler\(sampler2D in_tex_photo, vec2 in_uv\)/);
    expect(built.def.functionCode).toContain('texture2D(in_tex_photo,');
    expect(built.def.functionCode).not.toMatch(/u_tex_/);

    // …and a group with an unassigned Texture Input is refused
    const bad = buildUserNodeDefinition({ kind: 'subgraph', subgraph: sg, label: 'Sampler' }, {
      label: 'Sampler', category: 'My Nodes', inputs: [], outputs: [{ portKey: 'out0', key: 'color', label: 'Color', type: 'vec3' }], params: [],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/image slot/);
  });
});
