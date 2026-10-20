/**
 * The pass account (compiler/passBudget.ts): its count is the count the compile builds, node type by
 * node type; hidden passes apart; the over-limit error itemised from it; the library notes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { MAX_HIDDEN_PASSES, MAX_PASSES, budgetLevel, budgetSummary, nodePassNote, overBudgetMessage, passBudget } from '../passBudget';
import { n, group } from '../../store/graphBuilder';
import { makeShaderTexture } from '../../nodes/shaderTextureStarters';
import { retypeDataTexture } from '../../nodes/definitions/dataTexture';
import { retypeRenderTargets } from '../../nodes/definitions/renderTargets';
import { rulesTemplateNodes } from '../../agentRules/templates';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

const out = (from: [string, string]) => n('output', 'out', 0, 0, {}, { color: from });
const picture = () => [n('uv', 'uvn', 0, 0), n('swizzle', 'rgb', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['uvn', 'uv'] })];

/** Graphs with each kind of node that opens into passes, and the cost the account should give it. */
const CASES: Array<[string, () => GraphNode[], Record<string, number>]> = [
  ['Pass', () => [...picture(), n('pass', 'p', 0, 0, {}, { color: ['rgb', 'output'] }), out(['p', 'color'])], { p: 1 }],
  ['Shader Texture', () => {
    let i = 0;
    return [{ ...makeShaderTexture(() => `st${++i}`, { x: 0, y: 0 }, { starter: 'noise' }), id: 'tex' }, out(['tex', 'color'])];
  }, { tex: 1 }],
  ['Feedback (texture)', () => [...picture(), n('pass', 'src', 0, 0, {}, { color: ['rgb', 'output'] }), n('textureFeedback', 'fb', 0, 0, {}, { texture: ['src', 'texture'] }), out(['fb', 'color'])], { src: 1, fb: 1 }],
  ['Data Texture', () => [
    n('uv', 'uvn', 0, 0), retypeDataTexture(n('dataTexture', 'dt', 0, 0, {}, { in0: ['uvn', 'uv'] })),
    n('swizzle', 'use', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['dt', 'out0'] }), out(['use', 'output']),
  ], { dt: 1 }],
  ['Render Targets', () => [
    ...picture(), retypeRenderTargets(n('renderTargets', 'rt', 0, 0, {}, { in1: ['rgb', 'output'] })),
    retypeDataTexture(n('readChannels', 'show', 0, 0, { channels: 'rgb' }, { texture: ['rt', 'texture1'] })), out(['show', 'value']),
  ], { rt: 1 }],
  ['Grid Rules', () => [n('gridRules', 'g', 0, 0, { label: 'G' }), out(['g', 'color'])], { g: 1 }],
  ['Grid Rules with its Texture wired', () => [n('gridRules', 'g', 0, 0, { label: 'G' }), n('glowTexture', 'gl', 0, 0, { method: 'fast' }, { texture: ['g', 'texture'] }), out(['gl', 'color'])], { g: 2 }],
  ['Curve Trace Beam', () => [n('time', 'tm', 0, 0), n('curveTrace', 'c', 0, 0, { draw: 'beam' }), out(['c', 'color'])], { c: 1 }],
  ['Optical Flow', () => [n('textureInput', 'img', 0, 0), n('opticalFlow', 'of', 0, 0, {}, { texture: ['img', 'texture'] }), out(['of', 'color'])], { of: 2 }],
  ['Memory nodes (shared)', () => [
    n('lfo', 'lfo', 0, 0), n('lag', 'm1', 0, 0, {}, { input: ['lfo', 'value'] }), n('lag', 'm2', 0, 0, {}, { input: ['m1', 'value'] }), n('spring', 'm3', 0, 0, {}, { input: ['m2', 'value'] }),
    n('floatToVec3', 'f', 0, 0, {}, { input: ['m3', 'value'] }), out(['f', 'rgb']),
  ], { m1: 1 }],
  ['Value at point (shared)', () => [
    n('uv', 'uv', 0, 0), n('circleSDF', 'circ', 0, 0, {}, { position: ['uv', 'uv'] }),
    n('probe', 'p1', 0, 0, {}, { value: ['circ', 'distance'] }), n('probe', 'p2', 0, 0, { pointX: 0.5 }, { value: ['circ', 'distance'] }),
    n('add', 'add', 0, 0, {}, { a: ['p1', 'value'], b: ['p2', 'value'] }), n('floatToVec3', 'f', 0, 0, {}, { input: ['add', 'result'] }), out(['f', 'rgb']),
  ], { p1: 1 }],
  ['March Camera Smooth lens', () => resolveNodeAliases(structuredClone(EXAMPLE_GRAPHS.dofOrbitOrbs.nodes), getNodeDefinition)
    .map(x => (x.type === 'marchCamera' ? { ...x, params: { ...x.params, lens: 'smooth' } } : x)), { __cam: 1 }],
  ['Agents Sprite from a picture', () => {
    const nodes = rulesTemplateNodes('particles', 'rp', 0, 0);
    const draw = nodes.find(x => x.type === 'drawAgents')!;
    draw.inputs.sprite = { type: 'texture', label: 'Sprite', connection: { nodeId: 'photo', outputKey: 'texture' } };
    return [...nodes, n('textureInput', 'photo', 0, 0)];
  }, { __draw: 1 }],
  ['Pass inside a plain group', () => [
    ...picture(),
    group('grp', 0, 0, { label: 'G', iterations: 1, inputs: [], outputs: [{ key: 'o', type: 'vec3', label: 'O', from: ['inner', 'color'] }], nodes: [n('colorPicker', 'c', 0, 0), n('pass', 'inner', 0, 0, {}, { color: ['c', 'rgb'] })] }),
    out(['grp', 'o']),
  ], { inner: 1 }],
];

const counted = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  return (r.passes ?? []).filter(p => !p.hidden).length;
};

describe('Pass budget: the same count the compile builds', () => {
  for (const [name, build, expected] of CASES) {
    it(name, () => {
      const nodes = build();
      const b = passBudget(nodes);
      expect(b.error).toBeUndefined();
      expect(b.used).toBe(counted(nodes));
      for (const [id, cost] of Object.entries(expected)) {
        // `__cam` / `__draw`: the node of that type (its id comes from the example / template).
        const want = id === '__cam' ? nodes.find(x => x.type === 'marchCamera')!.id : id === '__draw' ? nodes.find(x => x.type === 'drawAgents')!.id : id;
        const item = b.items.find(i => i.nodeId === want);
        expect(item, `${name}: ${want}`).toBeDefined();
        expect(item!.cost).toBe(cost);
      }
    });
  }

  it('attributes the passes to the right kinds', () => {
    const flow = passBudget(CASES.find(c => c[0] === 'Optical Flow')![1]());
    expect(flow.items).toHaveLength(1);
    expect(flow.items[0]).toMatchObject({ nodeId: 'of', kind: 'Optical Flow', cost: 2 });
    const mem = passBudget(CASES.find(c => c[0] === 'Memory nodes (shared)')![1]());
    expect(mem.items).toEqual([expect.objectContaining({ kind: 'Memory nodes', cost: 1, shared: { count: 3, nodeIds: ['m1', 'm2', 'm3'] } })]);
    const probes = passBudget(CASES.find(c => c[0] === 'Value at point (shared)')![1]());
    expect(probes.items[0].shared?.count).toBe(2);
    const inGroup = passBudget(CASES.find(c => c[0] === 'Pass inside a plain group')![1]());
    expect(inGroup.items[0]).toMatchObject({ nodeId: 'inner', topId: 'grp' });
  });

  it('a graph without passes uses none', () => {
    expect(passBudget([...picture(), out(['rgb', 'output'])]).used).toBe(0);
    expect(passBudget([]).used).toBe(0);
  });

  it('is memoised by the node list', () => {
    const nodes = CASES[0][1]();
    expect(passBudget(nodes)).toBe(passBudget(nodes));
  });
});

describe('Pass budget: hidden passes apart', () => {
  it('Blur and Glow hidden passes are reported separately and never count', () => {
    const nodes = [...picture(), n('pass', 'p', 0, 0, {}, { color: ['rgb', 'output'] }), n('blurTexture', 'b', 0, 0, { radius: 4 }, { texture: ['p', 'texture'] }), out(['b', 'color'])];
    const b = passBudget(nodes);
    const r = compileGraph({ nodes });
    expect(b.used).toBe(1);
    expect(b.hidden.max).toBe(MAX_HIDDEN_PASSES);
    expect(b.hidden.used).toBe(r.passes!.filter(p => p.hidden).length);
    expect(b.hidden.used).toBeGreaterThan(0);
    expect(b.hidden.items[0]).toMatchObject({ nodeId: 'b' });
  });
});

describe('Pass budget: levels, summary and the over-limit error', () => {
  it('levels: amber with one pass (or none) left, red over', () => {
    expect(budgetLevel(1)).toBe('ok');
    expect(budgetLevel(MAX_PASSES - 2)).toBe('ok');
    expect(budgetLevel(MAX_PASSES - 1)).toBe('warn');
    expect(budgetLevel(MAX_PASSES)).toBe('warn');
    expect(budgetLevel(MAX_PASSES + 1)).toBe('over');
  });

  it('the compile error lists everything that counts', () => {
    const nodes: GraphNode[] = [...picture(), n('textureInput', 'img', 0, 0), n('lfo', 'lfo', 0, 0)];
    let from: [string, string] = ['rgb', 'output'];
    for (let i = 0; i < 5; i++) { nodes.push(n('pass', `p${i}`, 0, 0, {}, { color: from })); from = [`p${i}`, 'color']; }
    nodes.push(n('opticalFlow', 'of', 0, 0, {}, { texture: ['img', 'texture'] }));
    nodes.push(n('textureFeedback', 'fb1', 0, 0, {}, { texture: ['p4', 'texture'] }), n('textureFeedback', 'fb2', 0, 0, {}, { texture: ['fb1', 'texture'] }));
    nodes.push(n('lag', 'm1', 0, 0, {}, { input: ['lfo', 'value'] }));
    nodes.push(n('addColor', 'mix', 0, 0, {}, { a: ['fb2', 'color'], b: ['of', 'color'] }), out(['mix', 'result']));
    const b = passBudget(nodes);
    expect(b.used).toBe(10);
    expect(budgetSummary(b.items)).toEqual(['Pass ×5', 'Optical Flow ×1 (2 passes)', 'Feedback (texture) ×2', 'Memory nodes (1, shared by 1)']);
    const r = compileGraph({ nodes });
    expect(r.success).toBe(false);
    expect(r.errors![0]).toBe(overBudgetMessage(b));
    expect(r.errors![0]).toMatch(/^This graph needs 10 of 8 passes: Pass ×5, Optical Flow ×1 \(2 passes\), Feedback \(texture\) ×2, Memory nodes \(1, shared by 1\)\. Remove some/);
  });
});

describe('Pass budget: library notes', () => {
  it('notes come from the same expansion', () => {
    expect(nodePassNote('pass')).toBe(`Uses 1 pass (of ${MAX_PASSES})`);
    expect(nodePassNote('opticalFlow')).toBe(`Uses 2 passes (of ${MAX_PASSES})`);
    expect(nodePassNote('textureFeedback')).toBe(`Uses 1 pass (of ${MAX_PASSES})`);
    expect(nodePassNote('lag')).toMatch(/^Shares 1 pass/);
    expect(nodePassNote('gridRules')).toMatch(/2 when its Texture is wired/);
    expect(nodePassNote('blurTexture')).toBeNull();
    expect(nodePassNote('circleSDF')).toBeNull();
  });
});
