/** Bake's graph surgery (docs/bake.md): what gets tucked, the replace, and Unbake restoring the exact graph. */
import { describe, expect, it } from 'vitest';
import { n } from '../../../store/graphBuilder';
import { compileGraph } from '../../../compiler/graphCompiler';
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import type { GraphNode } from '../../../types/nodeGraph';
import { BakedNode } from '../../../nodes/definitions/baked';
import { applyBake, bakeableOutput, bakeRenderGraph, bakedVideoIds, frozenInputs, pictureTarget, rebakeNodes, stashOf, tuckSet, unbake } from '../graphOps';
import { DEFAULT_BAKE } from '../plan';
import { IdGenerator } from '../../../store/managers/IdGenerator';

/**
 * time ─┬─> A (makeVec3) ─> S (splitVec3) ─x─> M.r
 *       │                                 └y─> M.g
 *       └──────────────────────────────────────> M.b ;  M ─> out
 * Baking S (its X): S and A go (A feeds only S), Time stays (M reads it too).
 */
function graph(): GraphNode[] {
  return [
    n('time', 't', 0, 0),
    n('makeVec3', 'A', 200, 0, {}, { r: ['t', 'time'] }),
    n('uv', 'uv', 0, 200),
    n('splitVec3', 'S', 400, 0, {}, { v: ['A', 'rgb'] }),
    n('makeVec3', 'M', 600, 0, {}, { r: ['S', 'x'], g: ['S', 'y'], b: ['t', 'time'] }),
    n('output', 'out', 800, 0, {}, { color: ['M', 'rgb'] }),
  ];
}

const bakedShell = (id = 'baked_1'): GraphNode => ({
  id, type: 'baked', position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'UV' } }, outputs: { ...BakedNode.outputs },
  params: { videoId: 'vid_test', fileName: 'Baked S.webm', bakeInfo: { source: 'S', fps: 30, duration: 2, start: 0, loop: 'seamless', width: 64, height: 64, alpha: false, bytes: 1000, frozen: [], bakedAt: 0, codec: 'vp9' } },
});

describe('tuckSet', () => {
  it('takes the node and what only it needs, never a node something else reads', () => {
    expect([...tuckSet(graph(), 'S')].sort()).toEqual(['A', 'S']);
    expect([...tuckSet(graph(), 'M')].sort()).toEqual(['A', 'M', 'S', 't']);
  });
  it('a node dropped for having another reader strands nothing above it', () => {
    // B feeds S (tucked) and out-of-set Z: B stays, and so does C above it.
    const g = [
      n('time', 'C', 0, 0),
      n('makeVec3', 'B', 0, 0, {}, { r: ['C', 'time'] }),
      n('splitVec3', 'S', 0, 0, {}, { v: ['B', 'rgb'] }),
      n('floatToVec3', 'Z', 0, 0, {}, { input: ['C', 'time'] }),
      n('splitVec3', 'Y', 0, 0, {}, { v: ['B', 'rgb'] }),
      n('output', 'o', 0, 0, {}, { color: ['Z', 'rgb'] }),
    ];
    expect([...tuckSet(g, 'S')]).toEqual(['S']);
  });
});

describe('applyBake / unbake', () => {
  it('replaces the node, wires the chosen output, keeps the rest for Unbake', () => {
    const before = graph();
    const { nodes, stash } = applyBake(before, 'S', 'x', bakedShell(), DEFAULT_BAKE);
    expect(nodes.map(x => x.id)).toEqual(['t', 'uv', 'baked_1', 'M', 'out']);
    const M = nodes.find(x => x.id === 'M')!;
    expect(M.inputs.r.connection).toEqual({ nodeId: 'baked_1', outputKey: 'value' }); // a float bakes as a value
    expect(M.inputs.g.connection).toBeUndefined(); // only one output is baked: Y waits unwired
    expect(M.inputs.b.connection).toEqual({ nodeId: 't', outputKey: 'time' });
    expect(stash.nodes.map(x => x.id)).toEqual(['A', 'S']);
    expect(stash.indices).toEqual([1, 3]);
    expect(stash.wires).toEqual([{ nodeId: 'M', inputKey: 'r', outputKey: 'x' }, { nodeId: 'M', inputKey: 'g', outputKey: 'y', dropped: true }]);
    expect(nodes.find(x => x.id === 'baked_1')!.position).toEqual({ x: 400, y: 0 });
    // The baked graph compiles, reading the video, and the tucked nodes aren't in it.
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    expect(Object.keys(r.videoUniforms)).toHaveLength(1);
    expect(Object.values(r.videoUniforms)).toEqual(['baked_1']);
    expect(r.fragmentShader).toMatch(/uniform sampler2D u_vid_bake_\w+;/);
    expect(r.fragmentShader).toMatch(/uniform vec2 u_vid_bake_\w+_px;/);
  });

  it('round trip: Unbake gives back exactly the graph, in order, with every wire', () => {
    const before = graph();
    const { nodes } = applyBake(before, 'S', 'x', bakedShell(), DEFAULT_BAKE);
    let i = 0;
    const back = unbake(JSON.parse(JSON.stringify(nodes)), 'baked_1', () => `fresh_${i++}`);
    expect(back).toEqual(before);
    expect(compileGraph({ nodes: back }).fragmentShader).toBe(compileGraph({ nodes: before }).fragmentShader);
  });

  it('bake the picture, then Unbake: every bundled example comes back exactly, and the baked one compiles', () => {
    let tried = 0;
    for (const [key, ex] of Object.entries(EXAMPLE_GRAPHS)) {
      const before = ex.nodes as GraphNode[] | undefined;
      if (!Array.isArray(before)) continue;
      const pic = pictureTarget(before);
      const target = pic && before.find(x => x.id === pic.nodeId);
      if (!pic || !target || !bakeableOutput(target, pic.outputKey)) continue;
      const snapshot = JSON.parse(JSON.stringify(before));
      const { nodes } = applyBake(before, pic.nodeId, pic.outputKey, bakedShell('__baked_test__'), DEFAULT_BAKE);
      const out = nodes.find(x => x.type === 'output' || x.type === 'vec4Output')!;
      expect(out.inputs.color.connection?.nodeId, key).toBe('__baked_test__');
      if (tried < 25) expect(compileGraph({ nodes }).success, key).toBe(true);
      expect(unbake(nodes, '__baked_test__', () => 'x'), key).toEqual(snapshot);
      tried++;
    }
    expect(tried).toBeGreaterThan(50);
  });

  it('wires made from the Baked node after baking map back by kind; new nodes keep theirs', () => {
    const { nodes } = applyBake(graph(), 'S', 'x', bakedShell(), DEFAULT_BAKE);
    const extra = n('floatToVec3', 'E', 0, 0, {}, { input: ['baked_1', 'value'] });
    const back = unbake([...nodes, extra], 'baked_1', () => 'x');
    expect(back.find(x => x.id === 'E')!.inputs.input.connection).toEqual({ nodeId: 'S', outputKey: 'x' });
    expect(back.find(x => x.id === 'M')!.inputs.g.connection).toEqual({ nodeId: 'S', outputKey: 'y' });
  });

  it('a tucked id taken since (a reload handed it out) comes back under a fresh one, wires and all', () => {
    const { nodes } = applyBake(graph(), 'S', 'x', bakedShell(), DEFAULT_BAKE);
    const squatter = n('time', 'A', 0, 0);
    let i = 0;
    const back = unbake([...nodes, squatter], 'baked_1', () => `fresh_${i++}`);
    const ids = back.map(x => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const S = back.find(x => x.id === 'S')!;
    expect(S.inputs.v.connection).toEqual({ nodeId: 'fresh_0', outputKey: 'rgb' });
    expect(compileGraph({ nodes: back }).success).toBe(true);
  });

  it('the id generator steps past tucked ids after a load', () => {
    const { nodes } = applyBake([n('time', 'node_40', 0, 0), n('floatToVec3', 'node_41', 0, 0, {}, { input: ['node_40', 'time'] }), n('output', 'node_2', 0, 0, {}, { color: ['node_41', 'rgb'] })], 'node_41', 'rgb', bakedShell('node_3'), DEFAULT_BAKE);
    const g = new IdGenerator();
    g.syncFromGraph(nodes);
    expect(g.next()).toBe('node_42');
  });

  it('refuses what can’t be baked', () => {
    expect(() => applyBake(graph(), 'out', 'color', bakedShell(), DEFAULT_BAKE)).toThrow();
    expect(() => applyBake(graph(), 'uv', 'uv', bakedShell(), DEFAULT_BAKE)).toThrow();
  });
});

describe('render graphs', () => {
  it('a float bakes as grey, a colour as is, a colour with its Alpha as RGBA', () => {
    const g = bakeRenderGraph(graph(), 'S', 'x', false);
    expect(g.map(x => x.id)).toEqual(['t', 'A', 'S', '__bake_grey__', '__bake_out__']);
    expect(compileGraph({ nodes: g }).success).toBe(true);
    const c = bakeRenderGraph(graph(), 'M', 'rgb', false);
    expect(c.at(-1)!.type).toBe('output');
    const withAlpha = [n('textureInput', 'T', 0, 0), n('output', 'o', 0, 0, {}, { color: ['T', 'color'] })];
    const a = bakeRenderGraph(withAlpha, 'T', 'color', true);
    expect(a.at(-1)!.type).toBe('vec4Output');
    expect(compileGraph({ nodes: a }).success).toBe(true);
  });

  it('re-bake renders from the tucked nodes and the live ones they read', () => {
    const { nodes } = applyBake(graph(), 'S', 'x', bakedShell(), DEFAULT_BAKE);
    const { nodes: all, targetId } = rebakeNodes(nodes, 'baked_1', () => 'x');
    const g = bakeRenderGraph(all, targetId, 'x', false);
    expect(g.map(x => x.id).sort()).toEqual(['A', 'S', '__bake_grey__', '__bake_out__', 't']);
    expect(compileGraph({ nodes: g }).fragmentShader).toBe(compileGraph({ nodes: bakeRenderGraph(graph(), 'S', 'x', false) }).fragmentShader);
  });

  it('a bake of a bake keeps the inner video counted as used', () => {
    const first = applyBake(graph(), 'S', 'x', bakedShell(), DEFAULT_BAKE).nodes;
    const second = applyBake(first, 'M', 'rgb', { ...bakedShell('baked_2'), params: { ...bakedShell('baked_2').params, videoId: 'vid_outer' } }, DEFAULT_BAKE).nodes;
    expect(bakedVideoIds(second).sort()).toEqual(['vid_outer', 'vid_test']);
    expect(stashOf(second.find(x => x.id === 'baked_2'))!.nodes.map(x => x.id).sort()).toEqual(['M', 'baked_1', 't']);
  });
});

describe('frozenInputs', () => {
  it('names the mouse, sound, MIDI and Play controls the frozen nodes read', () => {
    const r = { fragmentShader: 'uniform vec2 u_mouse;\nvoid main() { vec2 m = u_mouse; }', audioUniforms: { u_audio_a_0: 'a' }, liveUniforms: { u_midi_m_note: 'm::note' }, videoUniforms: {} };
    expect(frozenInputs(r, ['n1'], ['mouse'], '{"controls":[{"target":"n1::scale"}]}')).toEqual(['the mouse', 'sound', 'MIDI', 'Play controls']);
    expect(frozenInputs({ fragmentShader: 'uniform vec2 u_mouse;\nvoid main(){}', audioUniforms: {}, liveUniforms: {}, videoUniforms: {} }, ['n2'], ['noise'], '{}')).toEqual([]);
  });
});
