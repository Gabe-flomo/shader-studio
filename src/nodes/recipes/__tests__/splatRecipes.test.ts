/**
 * A splat scan in a ray-marched scene (nodes/recipes/splatRecipes.ts): "Add a splat scan" on a March Loop card, and
 * "Add to scene" on a Splat Scene card, wire the loop's camera, distance and hit, and show the composite.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../../compiler/graphCompiler';
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import { getNodeDefinition, resolveNodeAliases } from '../../definitions';
import { applyRecipe, SPLAT_SCENE_SET, STARTER_RECIPES, wireSplatIntoScene } from '..';
import { estimateNodeHeight } from '../../../store/graphLayout';
import { n } from '../../../store/graphBuilder';
import type { GraphNode } from '../../../types/nodeGraph';

let k = 0;
const nextId = () => `s${k++}`;

function start(gi = false) {
  let nodes = resolveNodeAliases(EXAMPLE_GRAPHS.shapesAndGround3D.nodes, getNodeDefinition).map(x => ({ ...x }));
  if (gi) nodes = nodes.map(x => (x.type === 'marchLoopGroup' ? { ...x, type: 'giLitMarchGroup' } : x));
  const loop = nodes.find(x => x.type === (gi ? 'giLitMarchGroup' : 'marchLoopGroup'))!;
  const cam = nodes.find(x => x.type === 'marchCamera')!;
  return { nodes, loop, cam };
}

const conn = (nd: GraphNode, key: string) => nd.inputs[key]?.connection;

describe('Add a splat scan (March Loop card)', () => {
  const [recipe] = STARTER_RECIPES[SPLAT_SCENE_SET];

  it.each([false, true])('wires the camera, the scene by distance, and the Output (GI Lit: %s)', gi => {
    const { nodes, loop, cam } = start(gi);
    const r = applyRecipe(nodes, loop.id, recipe, nextId, estimateNodeHeight)!;
    const scan = r.nodes.find(x => x.type === 'splatScene')!;
    expect(conn(scan, 'ro')).toEqual({ nodeId: cam.id, outputKey: 'ro' });
    expect(conn(scan, 'rd')).toEqual({ nodeId: cam.id, outputKey: 'rd' });
    expect(conn(scan, 'scene')).toEqual({ nodeId: loop.id, outputKey: 'color' });
    expect(conn(scan, 'dist')).toEqual({ nodeId: loop.id, outputKey: 'dist' });
    expect(conn(scan, 'hit')).toEqual({ nodeId: loop.id, outputKey: 'hit' });
    expect(r.nodes.find(x => x.type === 'output')!.inputs.color.connection).toEqual({ nodeId: scan.id, outputKey: 'color' });
    expect(typeof scan.params.__comment).toBe('string');
    const res = compileGraph({ nodes: r.nodes });
    expect(res.errors).toBeUndefined();
    expect(res.splats).toHaveLength(1);
  });

  it('picked again, it replaces its scan instead of stacking another', () => {
    const { nodes, loop } = start();
    const once = applyRecipe(nodes, loop.id, recipe, nextId, estimateNodeHeight)!;
    const twice = applyRecipe(once.nodes, loop.id, recipe, nextId, estimateNodeHeight)!;
    expect(twice.nodes.filter(x => x.type === 'splatScene')).toHaveLength(1);
    expect(compileGraph({ nodes: twice.nodes }).errors).toBeUndefined();
  });
});

describe('Add to scene (Splat Scene card)', () => {
  it('wires a loose scan into the March Loop and puts it on the Output', () => {
    const { nodes, loop, cam } = start();
    const scan = n('splatScene', 'scan', 0, 900);
    const out = wireSplatIntoScene([...nodes, scan], 'scan', nextId)!;
    const s = out.find(x => x.id === 'scan')!;
    expect(conn(s, 'ro')).toEqual({ nodeId: cam.id, outputKey: 'ro' });
    expect(conn(s, 'scene')).toEqual({ nodeId: loop.id, outputKey: 'color' });
    expect(conn(s, 'dist')).toEqual({ nodeId: loop.id, outputKey: 'dist' });
    expect(out.find(x => x.type === 'output')!.inputs.color.connection).toEqual({ nodeId: 'scan', outputKey: 'color' });
    expect(compileGraph({ nodes: out }).errors).toBeUndefined();
  });

  it('composites over what the Output showed (lighting after the loop), not the bare loop', () => {
    const { nodes, loop } = start();
    const tone = n('toneMap', 'tone', 0, 0, {}, { color: [loop.id, 'color'] });
    const withTone = nodes.map(x => (x.type === 'output' ? { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: 'tone', outputKey: Object.keys(tone.outputs)[0] } } } } : x));
    const out = wireSplatIntoScene([...withTone, tone, n('splatScene', 'scan', 0, 900)], 'scan', nextId)!;
    expect(conn(out.find(x => x.id === 'scan')!, 'scene')!.nodeId).toBe('tone');
  });

  it('adds an Output when there is none; null without a March Loop', () => {
    const { nodes } = start();
    const noOut = nodes.filter(x => x.type !== 'output');
    const out = wireSplatIntoScene([...noOut, n('splatScene', 'scan', 0, 900)], 'scan', nextId)!;
    expect(out.filter(x => x.type === 'output')).toHaveLength(1);
    expect(wireSplatIntoScene([n('splatScene', 'scan', 0, 0)], 'scan', nextId)).toBeNull();
  });
});
