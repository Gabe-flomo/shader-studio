/**
 * Inserting a node on a wire when a float is involved (wireFit.ts, nodeDrop.insertIntoWire): a
 * float output broadcasts into any vector, a genType node (Exp…) takes the wire's vector type,
 * and the search's Related group after a selected node only lists nodes that can take its outputs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear(),
  });
});

import type { GraphNode, NodeDefinition } from '../../../types/nodeGraph';
import { getNodeDefinition, getOfferedDefinitions } from '../../../nodes/definitions';
import { getActiveNodes, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { compileGraph } from '../../../compiler/graphCompiler';
import { canFollow, fitsWireInsert, genTypeFor, offerFits } from '../wireFit';
import { edgeInfoFromKey, edgeKeyOf, insertIntoWire, typeFitsWire } from '../nodeDrop';
import { passesWireFilter, rankRelated } from '../nodeSearchModel';

const S = () => useNodeGraphStore.getState();
const def = (t: string) => getNodeDefinition(t)!;
const level = () => getActiveNodes(S().nodes, S().activeGroupPath) ?? S().nodes;
const byId = (id: string) => level().find(n => n.id === id)!;
const out = (type: 'output' | 'vec4Output' = 'output'): GraphNode => ({
  id: 'out', type, position: { x: 1600, y: 0 }, inputs: { color: { type: type === 'output' ? 'vec3' : 'vec4', label: 'Color' } }, outputs: {}, params: {},
});

beforeEach(() => {
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
});

/** A wire from `from.key` into the output, and its EdgeInfo. */
function wireToOutput(fromType: string, outType: 'output' | 'vec4Output' = 'output') {
  S().replaceGraph([out(outType)]);
  const src = fromType === 'float' ? S().addNode('time', { x: 0, y: 0 })! : S().addNode('floatToVec3', { x: 0, y: 0 })!;
  const key = Object.keys(byId(src).outputs)[0];
  S().connectNodes(src, key, 'out', 'color');
  return { src, edge: edgeInfoFromKey(level(), edgeKeyOf(src, key, 'out', 'color'))! };
}

const glsl = () => {
  const r = compileGraph({ nodes: S().nodes });
  expect(r.errors ?? []).toEqual([]);
  return r.fragmentShader;
};

describe('the offering rule', () => {
  it('same type, or a float into any vector; no vec2 ↔ vec3 widening', () => {
    expect(offerFits('vec3', 'vec3')).toBe(true);
    for (const t of ['vec2', 'vec3', 'vec4']) expect(offerFits('float', t)).toBe(true);
    expect(offerFits('vec3', 'vec2')).toBe(false);
    expect(offerFits('vec2', 'vec3')).toBe(false);
    expect(offerFits('vec3', 'float')).toBe(false);
    expect(offerFits('float', 'mat2')).toBe(false);
  });

  it('genType nodes take a vector wire\'s type (vec4 only where the card offers it)', () => {
    expect(genTypeFor('exp', 'vec3')).toBe('vec3');
    expect(genTypeFor('exp', 'vec4')).toBe('vec4');
    expect(genTypeFor('exp', 'float')).toBeNull();
    expect(genTypeFor('circleSDF', 'vec3')).toBeNull();
  });
});

describe('the insert-on-wire picker', () => {
  it('lists Exp on vec3 and vec4 wires, and on a float wire into a vec3', () => {
    expect(fitsWireInsert(def('exp'), 'vec3', 'vec3')).toBe(true);
    expect(fitsWireInsert(def('exp'), 'vec4', 'vec4')).toBe(true);
    expect(fitsWireInsert(def('exp'), 'float', 'vec3')).toBe(true);
    // The palette's filters: the node takes `filterInputType` and feeds `filterOutputType`.
    expect(passesWireFilter(def('exp'), 'vec3', 'vec3')).toBe(true);
  });

  it('lists nodes that output a float on any vector wire they can take', () => {
    // Length takes the vector (genType input), gives a float: broadcast into the vec3.
    expect(fitsWireInsert(def('length'), 'vec3', 'vec3')).toBe(true);
    // Luminance: vec3 in, float out.
    expect(fitsWireInsert(def('luminance'), 'vec3', 'vec4')).toBe(true);
    const onVec3 = getOfferedDefinitions().filter(d => passesWireFilter(d, 'vec3', 'vec3')).map(d => d.type);
    expect(onVec3).toEqual(expect.arrayContaining(['exp', 'sin', 'length', 'luminance']));
  });

  it('still leaves out what cannot take the wire', () => {
    // A vec2-only input on a vec3 wire would only fit by truncating: not offered.
    expect(fitsWireInsert(def('circleSDF'), 'vec3', 'vec3')).toBe(false);
    expect(fitsWireInsert(def('output'), 'vec3', 'vec3')).toBe(false);
  });

  it('the drag-onto-wire check agrees for genType nodes', () => {
    const e = { fromNodeId: 'a', fromOutputKey: 'x', toNodeId: 'b', toInputKey: 'y', fromType: 'vec3', toType: 'vec3' };
    expect(typeFitsWire('exp', e)).toBe(true);
    expect(typeFitsWire('exp', { ...e, fromType: 'vec4', toType: 'vec4' })).toBe(true);
  });
});

describe('inserting on a wire', () => {
  it('Exp on a vec3 wire becomes a vec3 Exp: exp per channel, and it compiles', () => {
    const { src, edge } = wireToOutput('vec3');
    const id = S().addNode('exp', { x: 300, y: 0 })!;
    expect(insertIntoWire(id, edge)).toBe(true);
    const e = byId(id);
    expect(e.params.outputType).toBe('vec3');
    expect(e.inputs.input.type).toBe('vec3');
    expect(e.outputs.output.type).toBe('vec3');
    expect(e.inputs.input.connection?.nodeId).toBe(src);
    expect(byId('out').inputs.color.connection).toMatchObject({ nodeId: id, outputKey: 'output' });
    expect(glsl()).toMatch(/vec3 \w+ = exp\(/);
  });

  it('Exp on a float wire into a vec3 stays float and broadcasts: vec3(x)', () => {
    const { edge } = wireToOutput('float');
    const id = S().addNode('exp', { x: 300, y: 0 })!;
    expect(insertIntoWire(id, edge)).toBe(true);
    expect(byId(id).outputs.output.type).toBe('float');
    const fs = glsl();
    expect(fs).toMatch(/float (\w+) = exp\(/);
    const v = fs.match(/float (\w+) = exp\(/)![1];
    expect(fs).toContain(`vec3(${v})`);
  });

  it('Exp on a vec4 wire is a vec4 Exp', () => {
    S().replaceGraph([out('vec4Output')]);
    const c = S().addNode('constant', { x: 0, y: 0 }, { outputType: 'vec4' })!;
    S().changeNodeVectorType(c, 'value', 'value', 'vec4');
    S().connectNodes(c, 'value', 'out', 'color');
    const edge = edgeInfoFromKey(level(), edgeKeyOf(c, 'value', 'out', 'color'))!;
    expect(edge.fromType).toBe('vec4');
    const id = S().addNode('exp', { x: 300, y: 0 })!;
    expect(insertIntoWire(id, edge)).toBe(true);
    expect(byId(id).outputs.output.type).toBe('vec4');
    expect(glsl()).toMatch(/vec4 \w+ = exp\(/);
  });

  it('a node that cannot take the wire leaves it alone', () => {
    const { src, edge } = wireToOutput('vec3');
    const id = S().addNode('time', { x: 300, y: 0 })!; // no input to take it
    expect(insertIntoWire(id, edge)).toBe(false);
    expect(byId('out').inputs.color.connection?.nodeId).toBe(src);
  });
});

describe('float output into a vector input (an ordinary wire)', () => {
  it('float → vec4 connects and compiles as vec4(x)', () => {
    const { src } = wireToOutput('float', 'vec4Output');
    expect(byId('out').inputs.color.connection?.nodeId).toBe(src);
    expect(glsl()).toMatch(/gl_FragColor = vec4\(\w+\)/);
  });
});

describe('Related after a selected node', () => {
  const fake = (type: string, inputs: Record<string, string>): NodeDefinition =>
    ({ type, label: type, category: 'Math', inputs: Object.fromEntries(Object.entries(inputs).map(([k, t]) => [k, { type: t, label: k }])), outputs: {}, generateGLSL: () => ({ code: '', outputVars: {} }) }) as unknown as NodeDefinition;

  it('only lists nodes that can take one of its outputs', () => {
    expect(canFollow(def('exp'), ['vec3'])).toBe(true); // genType
    expect(canFollow(fake('takesVec3', { c: 'vec3' }), ['float'])).toBe(true); // broadcast
    expect(canFollow(fake('takesVec2', { p: 'vec2' }), ['vec3'])).toBe(false); // no truncate
    expect(canFollow(fake('takesTex', { t: 'sampler2D' }), ['vec3', 'float'])).toBe(false);
    expect(canFollow(def('exprNode'), ['mat2'])).toBe(true);
    // A wireable slider's socket while hidden doesn't count (or every colour slider would fit a vec3 wire).
    const hidden = { ...fake('hiddenColour', { amt: 'float', tint: 'vec3' }), socketsOnDemand: { tint: ['tint'] } } as NodeDefinition;
    expect(canFollow(hidden, ['vec3'])).toBe(false);
    expect(fitsWireInsert({ ...hidden, outputs: { o: { type: 'vec3', label: 'O' } } } as NodeDefinition, 'vec3', 'vec3')).toBe(false);

    const defs = [fake('takesVec3', { c: 'vec3' }), fake('takesVec2', { p: 'vec2' }), fake('takesTex', { t: 'sampler2D' })];
    const ctx = { fromType: 'light', fromLabel: 'Light', affinity: () => 0.5, recents: [] as string[] };
    expect(rankRelated(defs, ctx).map(r => r.def.type).sort()).toEqual(['takesTex', 'takesVec2', 'takesVec3']);
    expect(rankRelated(defs, { ...ctx, outTypes: ['vec3'] }).map(r => r.def.type)).toEqual(['takesVec3']);
  });
});
