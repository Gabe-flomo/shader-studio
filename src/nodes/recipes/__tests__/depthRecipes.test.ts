/**
 * "Add a picture with depth" on a March Loop / GI Lit card (nodes/recipes/depthRecipes.ts): each choice compiles,
 * is wired to the loop and the Output where the loop fed it, notes every node, turns the camera when asked, links
 * the light to the scene's first object, and replaces itself when picked again. Plus the Depth node's metric
 * Distance with an experimental metric model.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: () => null, get length() { return mem.size; }, clear: () => mem.clear(),
  };
});

import { compileGraph } from '../../../compiler/graphCompiler';
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import { getNodeDefinition, resolveNodeAliases } from '../../definitions';
import { applyRecipe, FACE_CAMERA_OPTION, PICTURE_DEPTH_SET, pictureSource, STARTER_RECIPES } from '..';
import { estimateNodeHeight } from '../../../store/graphLayout';
import { n } from '../../../store/graphBuilder';
import { setDepthExperimental } from '../../../depthModel/experimental';
import type { GraphNode } from '../../../types/nodeGraph';

const H = (nd: GraphNode) => estimateNodeHeight(nd);
let k = 0;
const nextId = () => `d${k++}`;

/** The 3D example (camera, scene, loop → Output), with the loop as GI Lit when asked. */
function start(gi = false): { nodes: GraphNode[]; loop: GraphNode; cam: GraphNode; scene: string } {
  let nodes = resolveNodeAliases(EXAMPLE_GRAPHS.shapesAndGround3D.nodes, getNodeDefinition).map(x => ({ ...x }));
  if (gi) nodes = nodes.map(x => (x.type === 'marchLoopGroup' ? { ...x, type: 'giLitMarchGroup' } : x));
  const loop = nodes.find(x => x.type === (gi ? 'giLitMarchGroup' : 'marchLoopGroup'))!;
  const cam = nodes.find(x => x.type === 'marchCamera')!;
  return { nodes, loop, cam, scene: loop.inputs.scene!.connection!.nodeId };
}

const recipes = STARTER_RECIPES[PICTURE_DEPTH_SET];

describe('Add a picture with depth', () => {
  it('offers three choices', () => {
    expect(recipes.map(r => r.id)).toEqual(['depth-composite', 'depth-lit', 'depth-reflect']);
  });

  for (const gi of [false, true]) {
    for (const recipe of recipes) {
      it(`${gi ? 'GI Lit' : 'March Loop'} · ${recipe.label}: compiles, wired to the loop and the Output, every node noted`, () => {
        const s = start(gi);
        const shownBefore = s.nodes.find(x => x.type === 'output')!.inputs.color.connection!;
        const r = applyRecipe(s.nodes, s.loop.id, recipe, nextId, H, { [FACE_CAMERA_OPTION]: false })!;
        expect(r).not.toBeNull();
        const res = compileGraph({ nodes: r.nodes });
        expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
        const byId = new Map(r.nodes.map(x => [x.id, x]));
        const added = r.added.map(id => byId.get(id)!);
        for (const nd of added) expect(String(nd.params.__comment ?? '').trim(), nd.type).not.toBe('');
        const pic = added.find(x => x.type === 'textureInput')!;
        const depth = added.find(x => x.type === 'depth')!;
        const comp = added.find(x => x.type === 'depthComposite')!;
        expect(String(pic.params.__comment)).toMatch(/drop an image/i);
        expect(depth.inputs.texture.connection).toEqual({ nodeId: pic.id, outputKey: 'texture' });
        expect(comp.inputs.picture.connection).toEqual({ nodeId: pic.id, outputKey: 'color' });
        expect(comp.inputs.nearness.connection).toEqual({ nodeId: depth.id, outputKey: 'depth' });
        expect(comp.inputs.dist.connection).toEqual({ nodeId: s.loop.id, outputKey: 'dist' });
        expect(comp.inputs.hit.connection).toEqual({ nodeId: s.loop.id, outputKey: 'hit' });
        // The scene the composite takes is what the Output showed (the loop's colour here), or the reflections on it
        if (recipe.id !== 'depth-reflect') expect(comp.inputs.scene.connection).toEqual(shownBefore);
        const out = r.nodes.find(x => x.type === 'output')!.inputs.color.connection!;
        const light = added.find(x => x.type === 'depthLight');
        if (recipe.id === 'depth-composite') { expect(out).toEqual({ nodeId: comp.id, outputKey: 'color' }); expect(light).toBeUndefined(); return; }
        expect(out).toEqual({ nodeId: light!.id, outputKey: 'color' });
        expect(light!.inputs.glow.connection).toEqual({ nodeId: s.scene, outputKey: 'scene' });
        expect(light!.inputs.occluders.connection).toEqual({ nodeId: s.scene, outputKey: 'scene' });
        expect(light!.inputs.ro.connection).toEqual({ nodeId: s.cam.id, outputKey: 'ro' });
        expect(light!.inputs.rd.connection).toEqual({ nodeId: s.cam.id, outputKey: 'rd' });
        // Linked to the scene's first object: the Scene Group gained its output
        const link = light!.params.link as { scene: string; object: string };
        expect(link.scene).toBe(s.scene);
        expect(light!.inputs.lightPos.connection).toEqual({ nodeId: s.scene, outputKey: `at_${link.object}` });
        expect(byId.get(s.scene)!.outputs[`at_${link.object}`]).toBeDefined();
        if (recipe.id === 'depth-reflect') {
          const env = added.find(x => x.type === 'pictureEnvironment')!;
          expect(env.inputs.picture.connection).toEqual({ nodeId: pic.id, outputKey: 'texture' });
          expect(env.inputs.forward.connection).toEqual({ nodeId: s.cam.id, outputKey: 'forward' });
          expect(res.fragmentShader).toMatch(/pictureEnvUv\(/);
        }
      });
    }
  }

  it('turns the camera to face the picture only when asked', () => {
    const s = start();
    s.cam.params = { ...s.cam.params, camAngle: 0.6, camElevation: 0.3, rotSpeed: 0.2 };
    const no = applyRecipe(s.nodes, s.loop.id, recipes[0], nextId, H, { [FACE_CAMERA_OPTION]: false })!;
    expect(no.nodes.find(x => x.id === s.cam.id)!.params).toMatchObject({ camAngle: 0.6, camElevation: 0.3, rotSpeed: 0.2 });
    const yes = applyRecipe(s.nodes, s.loop.id, recipes[0], nextId, H, { [FACE_CAMERA_OPTION]: true })!;
    expect(yes.nodes.find(x => x.id === s.cam.id)!.params).toMatchObject({ camAngle: 0, camElevation: 0, rotSpeed: 0 });
  });

  it('picked again, it replaces the last one instead of piling up', () => {
    const s = start();
    const a = applyRecipe(s.nodes, s.loop.id, recipes[1], nextId, H)!;
    const b = applyRecipe(a.nodes, s.loop.id, recipes[0], nextId, H)!;
    expect(b.nodes.filter(x => x.type === 'depth')).toHaveLength(1);
    expect(b.nodes.filter(x => x.type === 'depthLight')).toHaveLength(0);
    expect(compileGraph({ nodes: b.nodes }).errors).toBeUndefined();
  });

  it('makes its picture through one helper (the unified Texture node can take its place)', () => {
    const p = pictureSource('x', 0, 0);
    expect(p.type).toBe('textureInput');
    expect(p.outputs.texture).toBeDefined();
    expect(p.outputs.color).toBeDefined();
  });
});

describe('a metric model\'s Distance', () => {
  afterEach(() => setDepthExperimental(false));
  const gen = (model: string) => getNodeDefinition('depth')!.generateGLSL(n('depth', 'd', 0, 0, { model }), { texture: 'u_tex_t' });

  it('reads the distance in metres (green) with Depth Pro or ZoeDepth while experimental models are on', () => {
    setDepthExperimental(true);
    const g = gen('depth-pro');
    expect(g.code).toMatch(/float d_dist = texture2D\(u_tex_d, d_st\)\.g;/);
    expect(g.outputVars.distance).toBe('d_dist');
    expect(gen('zoedepth-nyu-kitti').outputVars.distance).toBe('d_dist');
  });

  it('is 0 with a relative model, or with the setting off (no extra code)', () => {
    setDepthExperimental(true);
    expect(gen('depth-anything-v3-small').outputVars.distance).toBe('0.0');
    setDepthExperimental(false);
    const g = gen('depth-pro');
    expect(g.outputVars.distance).toBe('0.0');
    expect(g.code).not.toMatch(/_dist/);
  });
});
