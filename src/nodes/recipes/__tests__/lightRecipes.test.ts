/**
 * Light the scene (docs/light-scene.md): every rig lights a real 3D and a real 4D scene, wires
 * Stretch into its shadow and AO rays, and a second rig replaces the first instead of piling up.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../definitions';
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import { applyRecipe } from '..';
import { LIGHT_RECIPES } from '../lightRecipes';
import type { GraphNode } from '../../../types/nodeGraph';

let k = 0;
const nextId = () => `L${k++}`;
const graphOf = (key: string): GraphNode[] => resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
const loopOf = (nodes: GraphNode[]) => nodes.find(nd => nd.type === 'marchLoopGroup')!;

describe('Light the scene', () => {
  for (const key of ['sbTwistedTorus', 'fourDTesseractSlice']) {
    for (const rig of LIGHT_RECIPES) {
      it(`${rig.label} lights ${key}`, () => {
        const nodes = graphOf(key);
        const loop = loopOf(nodes);
        expect(loop, key).toBeDefined();
        const r = applyRecipe(nodes, loop.id, rig, nextId)!;
        const res = compileGraph({ nodes: r.nodes });
        expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
        expect(r.shown).toBe(true);
        const shadow = r.nodes.find(nd => nd.type === 'softShadow' && nd.params.__lightRig === loop.id);
        if (shadow) {
          expect(shadow.inputs.stretch.connection).toEqual({ nodeId: loop.id, outputKey: 'stretch' });
          expect(shadow.inputs.scene.connection).toBeDefined();
        }
      });
    }
  }

  it('a second rig replaces the first', () => {
    const nodes = graphOf('sbTwistedTorus');
    const loop = loopOf(nodes);
    const a = applyRecipe(nodes, loop.id, LIGHT_RECIPES[0], nextId)!;
    const b = applyRecipe(a.nodes, loop.id, LIGHT_RECIPES[1], nextId)!;
    const rigA = new Set(a.added);
    expect(b.nodes.some(nd => rigA.has(nd.id) && nd.type !== 'output')).toBe(false);
    expect(b.nodes.filter(nd => nd.params.__lightRig === loop.id).length).toBe(b.added.filter(id => b.nodes.find(nd => nd.id === id)?.type !== 'output').length);
    for (const nd of b.nodes) for (const i of Object.values(nd.inputs)) if (i.connection) expect(b.nodes.some(m => m.id === i.connection!.nodeId) || i.connection.nodeId.startsWith('__'), `${nd.id} wired to a removed node`).toBe(true);
    expect(compileGraph({ nodes: b.nodes }).errors).toBeUndefined();
  });
});
