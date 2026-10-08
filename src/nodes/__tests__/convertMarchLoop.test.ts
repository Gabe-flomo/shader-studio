/**
 * March Loop ⇄ GI Lit (nodes/convertMarchLoop.ts): same id, body, settings and wires; a Light the
 * scene rig comes out going to GI Lit and the Output shows the GI picture; GI-only wires come off going back.
 */
import { describe, expect, it, vi } from 'vitest';
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { applyRecipe } from '../recipes';
import { LIGHT_RECIPES } from '../recipes/lightRecipes';
import { convertMarchLoop } from '../convertMarchLoop';

const graph = (key: string) => resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
let k = 0;
const nextId = () => `c${k++}`;

describe('convert a March Loop', () => {
  it.each(['sbTwistedTorus', 'repeatSceneBubbles', 'fourDTesseractSlice'])('%s: to GI Lit and back, compiling each way', key => {
    const nodes = graph(key);
    const loop = nodes.find(nd => nd.type === 'marchLoopGroup')!;
    const gi = convertMarchLoop(nodes, loop.id, 'giLitMarchGroup')!;
    const g = gi.nodes.find(nd => nd.id === loop.id)!;
    expect(g.type).toBe('giLitMarchGroup');
    expect(g.params.subgraph).toEqual(loop.params.subgraph);
    expect(g.params.maxSteps).toBe(loop.params.maxSteps);
    for (const key2 of ['ro', 'rd', 'scene']) expect(g.inputs[key2].connection).toEqual(loop.inputs[key2].connection);
    expect(compileGraph({ nodes: gi.nodes }).errors).toBeUndefined();
    const back = convertMarchLoop(gi.nodes, loop.id, 'marchLoopGroup')!;
    expect(back.nodes.find(nd => nd.id === loop.id)!.type).toBe('marchLoopGroup');
    expect(compileGraph({ nodes: back.nodes }).errors).toBeUndefined();
  });

  it('to GI Lit takes out a Light the scene rig and shows the GI picture', () => {
    const nodes = graph('sbTwistedTorus');
    const loop = nodes.find(nd => nd.type === 'marchLoopGroup')!;
    const lit = applyRecipe(nodes, loop.id, LIGHT_RECIPES[0], nextId)!;
    const r = convertMarchLoop(lit.nodes, loop.id, 'giLitMarchGroup')!;
    expect(r.removedRig).toBeGreaterThan(5);
    expect(r.nodes.some(nd => nd.params.__lightRig)).toBe(false);
    expect(r.nodes.find(nd => nd.type === 'output')!.inputs.color.connection).toEqual({ nodeId: loop.id, outputKey: 'color' });
    expect(compileGraph({ nodes: r.nodes }).errors).toBeUndefined();
  });

  it('back to a plain loop cuts wires from GI-only outputs', () => {
    const nodes = graph('sbTwistedTorus');
    const loop = nodes.find(nd => nd.type === 'marchLoopGroup')!;
    const gi = convertMarchLoop(nodes, loop.id, 'giLitMarchGroup')!.nodes;
    const out = gi.find(nd => nd.type === 'output')!;
    const wired = gi.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: loop.id, outputKey: 'gi' } } } } : nd));
    const r = convertMarchLoop(wired, loop.id, 'marchLoopGroup')!;
    expect(r.dropped).toBe(1);
  });
});
