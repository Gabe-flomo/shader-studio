/**
 * Pass node phase 7 (docs/pass-node-plan.md): texture ports through plain
 * groups and a Pass inside a plain group, Repeat N times, and Texture Input /
 * Video as a texture source without a copy Pass. Pass-free graphs are covered
 * by goldenShaders.test.ts (unchanged); here the new paths, and that the old
 * ones stay as they were when nothing new is wired.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { n, group, port } from '../../store/graphBuilder';
import { GP_FROM_MARK, gpBindings } from '../../play/kit/gpuParticles.js';
import { findUnsupportedNode } from '../flattenSubgraph';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

const declared = (fs: string) => new Set((fs.match(/^uniform \w+ (\w+);/gm) ?? []).map(l => l.split(' ')[2].replace(';', '')));

/** A blur group: Pass (½) of what comes in → Blur (texture) → out. `id` makes each copy's ids its own. */
function blurGroup(id: string, from: [string, string], extra: Partial<Parameters<typeof group>[3]> = {}, params: Record<string, unknown> = {}): GraphNode {
  const inner = [
    n('pass', `${id}_pass`, 0, 0, { scale: '0.5' }, { color: port('c') }),
    n('blurTexture', `${id}_blur`, 0, 0, { radius: 12 }, { texture: [`${id}_pass`, 'texture'] }),
  ];
  const g = group(id, 0, 0, {
    label: 'Blur', iterations: 1,
    inputs: [{ key: 'c', type: 'vec3', label: 'Color', from }],
    outputs: [{ key: 'o', type: 'vec3', label: 'Blurred', from: [`${id}_blur`, 'color'] }],
    nodes: inner, ...extra,
  });
  return { ...g, params: { ...g.params, ...params } };
}

function picture(): GraphNode[] {
  return [
    n('uv', 'node_1', 0, 0),
    n('circleSDF', 'node_2', 0, 0, { radius: 0.4 }, { position: ['node_1', 'uv'] }),
    n('floatToVec3', 'node_3', 0, 0, {}, { input: ['node_2', 'distance'] }),
  ];
}

describe('a Pass inside a plain group', () => {
  it('compiles: the group is opened for the cut, its Pass draws, its output reads the blur', () => {
    const nodes = [...picture(), blurGroup('g1', ['node_3', 'rgb']), n('output', 'node_9', 0, 0, {}, { color: ['g1', 'o'] })];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.passes).toHaveLength(1);
    const [p] = r.passes!;
    expect(p).toMatchObject({ nodeId: 'g1_pass', scale: 0.5, live: true });
    // The pass program draws what flows into the group; the picture blurs its texture.
    expect(p.nodeIds).toEqual(expect.arrayContaining(['node_1', 'node_2', 'node_3']));
    expect(r.fragmentShader).toContain(`uniform sampler2D u_pass_${p.slug};`);
    expect(r.fragmentShader).toMatch(new RegExp(`texture2D\\(u_pass_${p.slug},`));
    // The group's card reads its output from the node behind it; Show passes counts it in the picture.
    expect(r.nodeOutputVars.get('g1')?.o).toBe(r.nodeOutputVars.get('g1_blur')?.color);
    expect(r.finalNodeIds).toContain('g1');
    // The inner Blur keeps its id, so its slider binding is the one the group view edits.
    expect(r.paramBindings['g1_blur::radius']).toBeTruthy();
  });

  it('two copies of the group are two passes', () => {
    const nodes = [
      ...picture(),
      blurGroup('g1', ['node_3', 'rgb']),
      blurGroup('g2', ['g1', 'o']),
      n('output', 'node_9', 0, 0, {}, { color: ['g2', 'o'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.map(p => p.nodeId)).toEqual(['g1_pass', 'g2_pass']);
    expect(new Set(r.passes!.map(p => p.slug)).size).toBe(2);
    // The second group's pass draws the first group's blur of the first pass.
    expect(r.passes![1].reads).toEqual([r.passes![0].slug]);
  });

  it('copies with the same inner ids still get passes of their own', () => {
    const a = blurGroup('g1', ['node_3', 'rgb']);
    const b = blurGroup('g1', ['g1', 'o']);
    b.id = 'g2';
    const nodes = [...picture(), a, b, n('output', 'node_9', 0, 0, {}, { color: ['g2', 'o'] })];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.map(p => p.nodeId)).toEqual(['g1_pass', 'g2__g1_pass']);
  });

  it('applies the group\'s overrides and wired param sockets to its nodes', () => {
    const g = blurGroup('g1', ['node_3', 'rgb'], {}, { 'g1_blur::radius': 30 });
    g.inputs.ps_g1_blur_radius = { type: 'float', label: 'Radius', connection: { nodeId: 'node_2', outputKey: 'distance' } };
    const nodes = [...picture(), g, n('output', 'node_9', 0, 0, {}, { color: ['g1', 'o'] })];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    // The wire drives the radius (no slider uniform for it), read in the picture where the blur runs.
    expect(r.paramBindings['g1_blur::radius']).toBeUndefined();
    expect(r.fragmentShader).toMatch(/\* circ_\w+ \*/);
    const g2 = blurGroup('g1', ['node_3', 'rgb'], {}, { 'g1_blur::radius': 30 });
    const r2 = compileGraph({ nodes: [...picture(), g2, n('output', 'node_9', 0, 0, {}, { color: ['g1', 'o'] })] });
    expect(r2.paramUniforms[r2.paramBindings['g1_blur::radius']]).toBe(30);
  });

  it('explains why a Pass can\'t go in an iterated, sealed or 3D group', () => {
    const iter = blurGroup('g1', ['node_3', 'rgb']);
    iter.params.iterations = 4;
    const r1 = compileGraph({ nodes: [...picture(), iter, n('output', 'node_9', 0, 0, {}, { color: ['g1', 'o'] })] });
    expect(r1.success).toBe(false);
    expect(r1.errors![0]).toMatch(/^Node g1: .*Iterations above 1.*Repeat/);

    const sealed = { ...blurGroup('g1', ['node_3', 'rgb']), sealed: true };
    const r2 = compileGraph({ nodes: [...picture(), sealed, n('output', 'node_9', 0, 0, {}, { color: ['g1', 'o'] })] });
    expect(r2.errors![0]).toMatch(/^Node g1: .*sealed/);

    const scene = { ...blurGroup('g1', ['node_3', 'rgb']), type: 'sceneGroup' };
    const r3 = compileGraph({ nodes: [...picture(), scene, n('output', 'node_9', 0, 0, {}, { color: ['node_3', 'rgb'] })] });
    expect(r3.errors![0]).toMatch(/^Node g1: a Pass can't go inside a 3D group/);
  });

  it('a group can\'t be published with a Pass, a texture port or a sampling node in it', () => {
    const g = blurGroup('g1', ['node_3', 'rgb']);
    const hit = findUnsupportedNode(g.params.subgraph as SubgraphData);
    expect(hit?.node.id).toBe('g1_pass');
    expect(hit?.reason).toMatch(/picture of its own/);
    const sampler = { nodes: [n('blurTexture', 'b', 0, 0, {}, { texture: port('t') })], inputPorts: [], outputPorts: [] } as SubgraphData;
    expect(findUnsupportedNode(sampler)?.reason).toMatch(/texture/);
  });
});

describe('texture ports through a plain group', () => {
  /** Pass A (outside) → a group whose texture input feeds Edges inside; its texture output passes the texture on. */
  function throughGroup(): GraphNode[] {
    const inner = [
      n('edgesTexture', 'gi_edges', 0, 0, { strength: 3 }, { texture: port('tex') }),
      n('floatToVec3', 'gi_grey', 0, 0, {}, { input: ['gi_edges', 'edges'] }),
    ];
    const g = group('gt', 0, 0, {
      label: 'Outline', iterations: 1,
      inputs: [{ key: 'tex', type: 'texture', label: 'Image', from: ['passA', 'texture'] }],
      outputs: [{ key: 'lines', type: 'vec3', label: 'Lines', from: ['gi_grey', 'rgb'] }],
      nodes: inner,
    });
    return [
      ...picture(),
      n('pass', 'passA', 0, 0, {}, { color: ['node_3', 'rgb'] }),
      g,
      n('output', 'node_9', 0, 0, {}, { color: ['gt', 'lines'] }),
    ];
  }

  it('a texture enters a group through an input: the sampler reaches the node inside', () => {
    const r = compileGraph({ nodes: throughGroup() });
    expect(r.errors).toBeUndefined();
    const slug = r.passes![0].slug;
    // Edges inside the group reads Pass A's texture with its `_px` (picture pixels).
    expect(r.fragmentShader).toContain(`texture2D(u_pass_${slug}, `);
    expect(r.fragmentShader).toContain(`u_pass_${slug}_px`);
    expect(r.passes![0].live).toBe(true);
  });

  it('a texture leaves a group through an output', () => {
    // A Pass inside a group, its Texture out through an output port, blurred outside.
    const inner = [n('pass', 'gq_pass', 0, 0, {}, { color: port('c') })];
    const g = group('gq', 0, 0, {
      label: 'Hold', iterations: 1,
      inputs: [{ key: 'c', type: 'vec3', label: 'Color', from: ['node_3', 'rgb'] }],
      outputs: [{ key: 'tex', type: 'texture', label: 'Texture', from: ['gq_pass', 'texture'] }],
      nodes: inner,
    });
    const nodes = [
      ...picture(), g,
      n('blurTexture', 'blur', 0, 0, { radius: 6 }, { texture: ['gq', 'tex'] }),
      n('output', 'node_9', 0, 0, {}, { color: ['blur', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const held = r.passes!.find(p => p.nodeId === 'gq_pass')!;
    expect(held.live).toBe(true);
    expect(r.fragmentShader).toContain(`texture2D(u_pass_${held.slug}, `);

    // No Pass at all: a Texture Input inside a group, its Texture out through a port, into Edges outside.
    const inner2 = [n('textureInput', 'gt_img', 0, 0)];
    const g2 = group('gt', 0, 0, {
      label: 'Picture', iterations: 1, inputs: [],
      outputs: [{ key: 'tex', type: 'texture', label: 'Texture', from: ['gt_img', 'texture'] }],
      nodes: inner2,
    });
    const r2 = compileGraph({ nodes: [g2, n('edgesTexture', 'edges', 0, 0, {}, { texture: ['gt', 'tex'] }), n('floatToVec3', 'k', 0, 0, {}, { input: ['edges', 'edges'] }), n('output', 'out', 0, 0, {}, { color: ['k', 'rgb'] })] });
    expect(r2.errors).toBeUndefined();
    const sampler = Object.keys(r2.textureUniforms)[0];
    expect(r2.fragmentShader).toContain(`#define ${sampler}_px`);
    expect(r2.fragmentShader).toContain(`texture2D(${sampler}, `);
  });

  it('a group with a texture port compiles exactly as before when no texture crosses it', () => {
    const inner = [n('addColor', 'ga_add', 0, 0, { scale: 0.5 }, { a: port('c'), b: port('c') })];
    const make = (texturePort: boolean) => {
      const g = group('ga', 0, 0, {
        label: 'Add', iterations: 1,
        inputs: [{ key: 'c', type: 'vec3', label: 'C', from: ['node_3', 'rgb'] }],
        outputs: [{ key: 'o', type: 'vec3', label: 'O', from: ['ga_add', 'result'] }],
        nodes: inner,
      });
      if (texturePort) {
        g.inputs.tex = { type: 'texture', label: 'Image' };
        (g.params.subgraph as SubgraphData).inputPorts.push({ key: 'tex', type: 'texture', label: 'Image', toNodeId: '', toInputKey: '' });
      }
      return [...picture(), g, n('output', 'node_9', 0, 0, {}, { color: ['ga', 'o'] })];
    };
    const a = compileGraph({ nodes: make(false) }), b = compileGraph({ nodes: make(true) });
    expect(b.success).toBe(true);
    expect(b.fragmentShader).toBe(a.fragmentShader);
  });
});

describe('Repeat N times', () => {
  function jfaLike(repeat: number): GraphNode[] {
    return [
      ...picture(),
      n('sampleTexture', 'node_10', 0, 0, { offsetX: 1 }, { texture: ['node_4', 'previous'] }),
      n('addColor', 'node_11', 0, 0, {}, { a: ['node_3', 'rgb'], b: ['node_10', 'color'], scale: ['node_4', 'step'] }),
      n('pass', 'node_4', 0, 0, { repeat }, { color: ['node_11', 'result'] }),
      n('output', 'node_9', 0, 0, {}, { color: ['node_4', 'color'] }),
    ];
  }

  it('a repeated pass carries Repeat and reads its step from a uniform', () => {
    const r = compileGraph({ nodes: jfaLike(8) });
    expect(r.errors).toBeUndefined();
    const [p] = r.passes!;
    expect(p.repeat).toBe(8);
    expect(p.previous).toBe(true);
    expect(declared(p.fragmentShader).has(`u_passiter_${p.slug}`)).toBe(true);
    expect(p.fragmentShader).toContain(`u_passiter_${p.slug}.x`);
    // The step isn't a texture read: the pass doesn't read itself.
    expect(p.reads).toEqual([]);
  });

  it('Repeat 1 compiles as a Pass always has: no repeat, no step uniform', () => {
    const r = compileGraph({ nodes: jfaLike(1) });
    const [p] = r.passes!;
    expect(p).not.toHaveProperty('repeat');
    expect(p.fragmentShader).not.toContain('u_passiter_');
    expect(r.fragmentShader).not.toContain('u_passiter_');
    // Unwired Step on a pass without Repeat: the program is the one an old Pass (no repeat param) gives.
    const old = jfaLike(1).map(x => (x.id === 'node_4' ? { ...x, params: Object.fromEntries(Object.entries(x.params).filter(([k]) => k !== 'repeat')) } : x));
    const r0 = compileGraph({ nodes: old });
    expect(r0.passes![0].fragmentShader).toBe(p.fragmentShader);
    expect(r0.fragmentShader).toBe(r.fragmentShader);
  });

  it('Repeat is clamped to 1–64 and Steps is a number', () => {
    const r = compileGraph({ nodes: jfaLike(500) });
    expect(r.passes![0].repeat).toBe(64);
    const steps = compileGraph({ nodes: [...jfaLike(5).filter(x => x.type !== 'output'), n('floatToVec3', 'k', 0, 0, {}, { input: ['node_4', 'steps'] }), n('output', 'node_9', 0, 0, {}, { color: ['k', 'rgb'] })] });
    expect(steps.errors).toBeUndefined();
    expect(steps.fragmentShader).toContain('vec3(5.0)');
  });
});

describe('Texture Input and Video as a texture source', () => {
  it('Edges straight from a Texture Input: one program, the `_px` defined from the picture', () => {
    const nodes = [
      n('textureInput', 'img', 0, 0),
      n('edgesTexture', 'edges', 0, 0, {}, { texture: ['img', 'texture'] }),
      n('floatToVec3', 'grey', 0, 0, {}, { input: ['edges', 'edges'] }),
      n('output', 'out', 0, 0, {}, { color: ['grey', 'rgb'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes).toBeUndefined();
    const sampler = Object.keys(r.textureUniforms)[0];
    expect(sampler).toMatch(/^u_tex_/);
    expect(r.fragmentShader).toContain(`#define ${sampler}_px (vec2(1.0) / u_resolution)`);
    expect(r.fragmentShader).toContain(`texture2D(${sampler}, `);
  });

  it('unwired, a Texture Input compiles as it always has (no `_px`)', () => {
    const nodes = [n('textureInput', 'img', 0, 0), n('output', 'out', 0, 0, {}, { color: ['img', 'color'] })];
    const r = compileGraph({ nodes });
    expect(r.fragmentShader).not.toContain('_px');
    // And an old node (saved without the Texture output) gives the same shader.
    const old = nodes.map(x => (x.id === 'img' ? { ...x, outputs: Object.fromEntries(Object.entries(x.outputs).filter(([k]) => k !== 'texture')) } : x));
    expect(compileGraph({ nodes: old }).fragmentShader).toBe(r.fragmentShader);
  });

  it('inside a ½ Pass, one picture pixel is twice the pass\'s own', () => {
    const nodes = [
      n('videoInput', 'vid', 0, 0),
      n('blurTexture', 'blur', 0, 0, {}, { texture: ['vid', 'texture'] }),
      n('pass', 'p', 0, 0, { scale: '0.5' }, { color: ['blur', 'color'] }),
      n('output', 'out', 0, 0, {}, { color: ['p', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const sampler = Object.keys(r.videoUniforms)[0];
    expect(r.passes![0].fragmentShader).toContain(`#define ${sampler}_px (vec2(0.5) / u_resolution)`);
  });

  it('Particles\' Emit from takes a Texture Input directly', () => {
    const nodes = [
      n('textureInput', 'img', 0, 0),
      n('gpuParticles', 'parts', 0, 0, {}, { emitFrom: ['img', 'texture'] }),
      n('output', 'out', 0, 0, {}, { color: ['parts', 'particles'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const sampler = Object.keys(r.textureUniforms)[0];
    expect(r.fragmentShader).toContain(GP_FROM_MARK);
    expect(gpBindings(r.fragmentShader)[0].from).toBe(sampler);
  });

  it('old nodes gain the new outputs on load (the card shows them), nothing else', () => {
    const def = getNodeDefinition('textureInput')!;
    const old = n('textureInput', 'img', 0, 0);
    delete old.outputs.texture;
    expect(def.syncSockets!(old).outputs.texture?.type).toBe('texture');
    const pass = n('pass', 'p', 0, 0);
    delete pass.outputs.step; delete pass.outputs.steps;
    expect(Object.keys(getNodeDefinition('pass')!.syncSockets!(pass).outputs)).toEqual(['color', 'alpha', 'texture', 'previous', 'step', 'steps']);
  });
});

describe('the phase 7 examples (Passes 7 to 9)', () => {
  const compileExample = (k: string) => compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition) });

  it('Passes 7 · Jump-flood distance field: one ½ Pass, nearest, repeated 10 times', () => {
    const r = compileExample('passJumpFlood');
    expect(r.errors).toBeUndefined();
    expect(r.passes).toHaveLength(1);
    expect(r.passes![0]).toMatchObject({ scale: 0.5, filter: 'nearest', format: 'half', repeat: 10, previous: true, live: true });
    expect(r.passes![0].fragmentShader).toContain(`u_passiter_${r.passes![0].slug}.x`);
  });

  it('Passes 8 · Edges straight from a picture: one program, no Pass, the picture loaded with it', () => {
    const r = compileExample('passEdgesFromPicture');
    expect(r.errors).toBeUndefined();
    expect(r.passes).toBeUndefined();
    expect(r.fragmentShader).toMatch(/#define u_tex_\w+_px/);
    expect(Object.keys(EXAMPLE_GRAPHS.passEdgesFromPicture.images ?? {})).toEqual(['epImage']);
  });

  it('Passes 9 · A reusable blur group: two plain groups, a Pass each', () => {
    const r = compileExample('passBlurGroup');
    expect(r.errors).toBeUndefined();
    expect(r.passes!.map(p => [p.nodeId, p.scale])).toEqual([['bgTightPass', 0.5], ['bgWidePass', 0.125]]);
    expect(r.nodeOutputVars.get('bgTight')?.o).toBeTruthy();
    expect(r.nodeOutputVars.get('bgWide')?.o).toBeTruthy();
  });
});
