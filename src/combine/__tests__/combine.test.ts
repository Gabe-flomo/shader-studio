/**
 * Combine, phase 1 (docs/combine.md, docs/combine-plan.md §9): the spec ↔ build round trip; every Place in pair and
 * Replace mask (one fill for all) builds glue from ordinary nodes that compiles; the verb matrix offers only valid
 * pairs; a build is recognized and reopened, its glue rebuilt with the same ids and your edits kept; Start over takes
 * only the glue; patches on products are put back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { applyScene } from '../../sceneBuilder/apply';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { applyScene2D } from '../../sceneBuilder2d/apply';
import { parseRecipe2D } from '../../sceneBuilder2d/recipe';
import { applySplatScene } from '../../splatBuilder/apply';
import { starterSplatScene } from '../../splatBuilder/spec';
import { builtScenes, builtSceneIds, selectedBuiltScene } from '../../builders/sceneKinds';
import { applyCombine, checkCombineEdits, removeCombine } from '../apply';
import { buildCombine } from '../build';
import { combineMetaOf, findCombineBuild } from '../meta';
import { graphProducts, resolveProduct } from '../products';
import { offeredVerbs, removeLayer, resultKind, verbsFor, type CombineLayer, type CombineSpec, type ProductRef } from '../spec';
import { productKind } from '../products';
import { COMBINE_PRESETS, RINGS_RECIPE_2D, ROOM_RECIPE, SHAPES_RECIPE, presetGraph } from '../presets';

let k = 0;
const nextId = () => `t${++k}`;
const output = (): GraphNode => n('output', 'out', 2000, 0);

const ROOM = [
  'plane y=-1 name=Floor',
  'sphere r=0.45 at=(-1.1,-0.55,0.4) name=Ball',
  'box size=(0.3,0.5,0.3) round=0.03 at=(1.1,-0.5,0.2) rot=(0,25,0) name=Block',
  'camera dist=4.2 angle=10 elev=12',
].join('\n');

/** A graph with a surface-lit 3D build, a photo, a 2D build and the Output. */
function world(): { nodes: GraphNode[]; scene: string; photo: string; twoD: string } {
  let nodes: GraphNode[] = [output()];
  const r3 = applyScene(nodes, parseRecipe(ROOM).spec, { nextId, asNew: true });
  nodes = r3.nodes;
  const r2 = applyScene2D(nodes, parseRecipe2D('kaleidoscope 6 · ring r=0.3 th=0.02 color=cyan · circle r=0.08 color=gold · background night').scene, { nextId, asNew: true });
  nodes = r2.nodes;
  nodes.push(n('textureInput', 'photo', -400, 0, { fit: 'stretch' }));
  return { nodes, scene: r3.sceneId, photo: 'photo', twoD: r2.sceneId };
}

const L = (id: string, product: ProductRef, verb: CombineLayer['verb'], settings: CombineLayer['settings'] = {}, on?: string): CombineLayer => ({ id, product, verb, settings, ...(on ? { on } : {}) });

function compiles(nodes: GraphNode[]) {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  return r;
}

beforeEach(() => { k = 0; });

describe('the verb matrix', () => {
  it('offers only valid pairs, and only the verbs built so far', () => {
    expect(offeredVerbs('picture', 'picture')).toEqual(['placeIn']);
    expect(offeredVerbs('picture', 'scene3d')).toEqual(['placeIn']);
    expect(offeredVerbs('scene3d', 'picture')).toEqual(['placeIn']);
    expect(offeredVerbs('mask', 'picture')).toEqual(['replaceMask']);
    expect(offeredVerbs('picture', 'mask')).toEqual(['replaceMask']);
    expect(offeredVerbs('scene3d', 'mask')).toEqual(['replaceMask']);
    // Two 3D builds: the 3D builder's job; splats are placed in.
    expect(offeredVerbs('scene3d', 'scene3d')).toEqual([]);
    expect(offeredVerbs('scene3d', 'scene3d', { splat: true })).toEqual(['placeIn']);
    // Valid later, not offered yet (Collide with and Follow the shape came in phase 2: combinePoints.test.ts).
    expect(verbsFor('points', 'scene3d')).toContain('spawn');
    expect(offeredVerbs('points', 'scene3d')).not.toContain('spawn');
    expect(offeredVerbs('mask', 'scene3d')).toEqual([]);
    expect(offeredVerbs('picture', 'points')).toEqual([]);
  });

  it('says what each layer is to the ones above it', () => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [
      L('L1', { kind: 'node', nodeId: w.photo, output: 'color' }, 'base'),
      L('L2', { kind: 'mask', find: 'people' }, 'replaceMask'),
      L('L3', { kind: 'build', scene: '3d', id: w.scene }, 'replaceMask'),
      L('L4', { kind: 'build', scene: '3d', id: w.scene }, 'placeIn'),
    ] };
    const kindOf = (p: ProductRef) => productKind(p, w.nodes);
    expect(spec.layers.map(l => resultKind(spec, l, kindOf))).toEqual(['picture', 'mask', 'picture', 'picture']);
    // Removing a mask layer: the fill on it goes on what the mask went on.
    const less = removeLayer(spec, 'L2');
    expect(less.layers.map(l => l.id)).toEqual(['L1', 'L3', 'L4']);
  });
});

describe('Place in', () => {
  it.each([
    ['a picture on a picture (Normal)', { blend: 'normal' }],
    ['a picture on a picture (Screen)', { blend: 'screen' }],
  ])('%s', (_label, settings) => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '2d', id: w.twoD }, 'base'), L('L2', { kind: 'node', nodeId: w.photo, output: 'color' }, 'placeIn', settings)] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(r.build.glue.map(g => g.type)).toEqual([settings.blend === 'normal' ? 'mix' : 'blendModes']);
    compiles(r.nodes);
  });

  it.each(['card', 'surroundings', 'depth'] as const)('a picture in a 3D scene (%s)', how => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '3d', id: w.scene }, 'base'), L('L2', { kind: 'node', nodeId: w.photo, output: 'color' }, 'placeIn', { how3d: how })] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    const types = r.build.glue.map(g => g.type);
    if (how === 'card') expect(types).toEqual(['sceneGroup', 'marchLoopGroup', 'pictureCard', 'compare', 'multiply', 'select']);
    if (how === 'surroundings') expect(types).toEqual(['pictureEnvironment', 'select']);
    if (how === 'depth') expect(types).toEqual(['depth', 'depthComposite']);
    // The card reads the scene's own camera: no camera of its own.
    if (how === 'card') {
      const loop = r.build.glue.find(g => g.type === 'marchLoopGroup')!;
      const cam = findCam(r.nodes, w.scene);
      expect(loop.inputs.ro.connection).toEqual({ nodeId: cam, outputKey: 'ro' });
    }
    compiles(r.nodes);
    // Every glue node has a note.
    for (const g of r.build.glue) expect(String(g.params.__comment ?? '').length).toBeGreaterThan(20);
  });

  it.each(['over', 'depth'] as const)('a 3D scene on a picture (%s)', how => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'node', nodeId: w.photo, output: 'color' }, 'base'), L('L2', { kind: 'build', scene: '3d', id: w.scene }, 'placeIn', { howPic: how })] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(r.build.glue.map(g => g.type)).toEqual(how === 'over' ? ['multiply', 'select'] : ['depth', 'depthComposite']);
    compiles(r.nodes);
  });

  it('a procedural picture in 3D gets a Pass for its texture (one pass, on the layer)', () => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '3d', id: w.scene }, 'base'), L('L2', { kind: 'build', scene: '2d', id: w.twoD }, 'placeIn', { how3d: 'surroundings' })] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.glue.map(g => g.type)).toEqual(['pass', 'pictureEnvironment', 'select']);
    expect(r.build.layers.L2.passes).toBe(1);
    compiles(r.nodes);
  });

  it('splats in a 3D scene: the Splat Scene sees through the scene\'s camera (patched), laid over by its alpha', () => {
    const w = world();
    const rs = applySplatScene(w.nodes, starterSplatScene(), { nextId });
    const nodes = rs.nodes;
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '3d', id: w.scene }, 'base'), L('L2', { kind: 'build', scene: 'splat', id: rs.scanId }, 'placeIn')] };
    const before = nodes.find(x => x.id === rs.scanId)!.inputs.ro.connection;
    const r = applyCombine(nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    const scan = r.nodes.find(x => x.id === rs.scanId)!;
    expect(scan.inputs.ro.connection).toEqual({ nodeId: findCam(r.nodes, w.scene), outputKey: 'ro' });
    expect(scan.inputs.scene?.connection).toBeUndefined();
    // Taking the build away puts the splat's own camera back.
    const gone = removeCombine(r.nodes, r.anchorId!);
    expect(gone.find(x => x.id === rs.scanId)!.inputs.ro.connection).toEqual(before);
  });
});

describe('Replace mask with (one fill for all)', () => {
  function stack(w: ReturnType<typeof world>, fill: ProductRef, settings: CombineLayer['settings'] = {}): CombineSpec {
    return { v: 1, layers: [
      L('L1', { kind: 'node', nodeId: w.photo, output: 'color' }, 'base'),
      L('L2', { kind: 'mask', find: 'objects', classes: 'cat' }, 'replaceMask'),
      L('L3', fill, 'replaceMask', settings),
    ] };
  }

  it('a 2D build on every blob, through Blob Space\'s Fill field: Segment → Blob Track → Blob Space → Select', () => {
    const w = world();
    const r = applyCombine(w.nodes, stack(w, { kind: 'build', scene: '2d', id: w.twoD }), { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(r.build.glue.map(g => g.type)).toEqual(['segment', 'mix', 'select', 'blobTrack', 'blobSpace', 'multiply', 'select']);
    const space = r.build.glue.find(g => g.type === 'blobSpace')!;
    expect(space.inputs.fill.connection).toBeTruthy();
    expect(space.inputs.fillTexture?.connection).toBeUndefined();
    const res = compiles(r.nodes);
    // The fill chain became a field function, called inside Blob Space only where a blob is.
    expect(res.fragmentShader).toMatch(/fieldfn_/);
    expect(r.build.layers.L3.passes).toBe(0);
  });

  it('a photo fill reads its texture; the whole frame needs no blobs', () => {
    const w = world();
    w.nodes.push(n('textureInput', 'photo2', -400, 300, { fit: 'stretch' }));
    const r = applyCombine(w.nodes, stack(w, { kind: 'node', nodeId: 'photo2', output: 'color' }), { nextId });
    expect(r.build.glue.find(g => g.type === 'blobSpace')!.inputs.fillTexture.connection).toEqual({ nodeId: 'photo2', outputKey: 'texture' });
    compiles(r.nodes);
    const frame = applyCombine(w.nodes, stack(w, { kind: 'node', nodeId: 'photo2', output: 'color' }, { stick: 'frame' }), { nextId });
    expect(frame.build.glue.map(g => g.type)).toEqual(['segment', 'mix', 'select', 'multiply', 'select']);
    compiles(frame.nodes);
  });

  it('a 3D fill renders inside each blob: its camera\'s UV is Blob Space\'s Local UV (a patch, put back after)', () => {
    const w = world();
    const r = applyCombine(w.nodes, stack(w, { kind: 'build', scene: '3d', id: w.scene }), { nextId });
    expect(r.build.warnings).toEqual([]);
    const space = r.build.glue.find(g => g.type === 'blobSpace')!;
    const cam = r.nodes.find(x => x.id === findCam(r.nodes, w.scene))!;
    expect(cam.inputs.uv.connection).toEqual({ nodeId: space.id, outputKey: 'localUv' });
    compiles(r.nodes);
    expect(removeCombine(r.nodes, r.anchorId!).find(x => x.id === cam.id)!.inputs.uv.connection).toBeUndefined();
  });

  it('per blob with no fills yet draws the picture and says so (phase 3: combinePerBlob.test.ts)', () => {
    const w = world();
    const spec = stack(w, { kind: 'build', scene: '2d', id: w.twoD });
    spec.layers[2].fills = { mode: 'perBlob', by: 'order', blobs: [] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings.join(' ')).toMatch(/nothing to draw yet/);
    compiles(r.nodes);
  });
});

describe('recognize, reopen, rebuild', () => {
  function built() {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '3d', id: w.scene }, 'base'), L('L2', { kind: 'node', nodeId: w.photo, output: 'color' }, 'placeIn', { how3d: 'card' })] };
    return { w, spec, r: applyCombine(w.nodes, spec, { nextId }) };
  }

  it('keeps the spec on the top glue node, which feeds the Output', () => {
    const { spec, r } = built();
    const anchor = r.nodes.find(x => x.id === r.anchorId)!;
    expect(combineMetaOf(anchor)?.spec).toEqual(spec);
    expect(r.nodes.find(x => x.type === 'output')!.inputs.color.connection?.nodeId).toBe(anchor.id);
  });

  it('is listed by the Scene builder (first), found from any glue node, and Start over takes only the glue', () => {
    const { w, r } = built();
    const list = builtScenes(r.nodes);
    expect(list[0]).toMatchObject({ kind: 'combine', id: r.anchorId, detail: '2 layers · Place in' });
    const glue = findCombineBuild(r.nodes, r.anchorId!)!;
    const someGlue = [...glue.byRole.values()].find(x => x.id !== r.anchorId)!;
    expect(selectedBuiltScene(r.nodes, [someGlue.id])?.kind).toBe('combine');
    const ids = builtSceneIds(r.nodes, { kind: 'combine', id: r.anchorId! });
    expect([...ids].sort()).toEqual([...glue.byRole.values()].map(x => x.id).sort());
    expect(ids.has(w.scene)).toBe(false);
    // The products are still offered as products; the glue is not.
    expect(graphProducts(r.nodes).map(p => p.kind).sort()).toEqual(['picture', 'picture', 'scene3d']);
  });

  it('rebuilds with the same ids, keeps your settings on the glue, and Rebuild it drops them', () => {
    const { spec, r } = built();
    const ids = r.build.glue.map(g => g.id).sort();
    // Change the card's Compare by hand.
    const cmp = r.build.glue.find(g => g.type === 'compare')!;
    const edited = r.nodes.map(x => (x.id === cmp.id ? { ...x, params: { ...x.params, smoothing: 0.25 } } : x));
    expect(checkCombineEdits(edited, r.anchorId!).params).toEqual(['Compare · Smoothing']);
    const again = applyCombine(edited, { ...spec, layers: spec.layers.map(l => (l.id === 'L2' ? { ...l, settings: { ...l.settings, size: 2 } } : l)) }, { nextId, anchorId: r.anchorId });
    expect(again.build.glue.map(g => g.id).sort()).toEqual(ids);
    expect(again.nodes.find(x => x.id === cmp.id)!.params.smoothing).toBe(0.25);
    expect(again.kept).toEqual(['Compare · Smoothing']);
    expect(again.nodes.filter(x => x.type === 'pictureCard').every(c => c.params.size === 2)).toBe(true);
    const restored = applyCombine(edited, spec, { nextId, anchorId: r.anchorId, restore: true });
    expect(restored.nodes.find(x => x.id === cmp.id)!.params.smoothing).toBe(0);
  });

  it('isolates a layer: the Output shows the stack up to it', () => {
    const { w, spec, r } = built();
    const iso = applyCombine(r.nodes, spec, { nextId, anchorId: r.anchorId, isolate: 'L1' });
    expect(iso.nodes.find(x => x.type === 'output')!.inputs.color.connection).toEqual(resolveProduct({ kind: 'build', scene: '3d', id: w.scene }, iso.nodes).colour);
  });

  it('a missing product leaves its layer unbuilt, and the rest still builds', () => {
    const { w, spec } = built();
    const bad: CombineSpec = { ...spec, layers: [...spec.layers, L('L3', { kind: 'node', nodeId: 'gone', output: 'color' }, 'placeIn')] };
    const b = buildCombine(bad, w.nodes);
    expect(b.layers.L3.problem).toMatch(/Product missing/);
    expect(b.layers.L2.glue.length).toBeGreaterThan(0);
    expect(b.result).toEqual(b.layers.L2.out!.colour);
  });
});

describe('the presets', () => {
  it('their recipes read cleanly', () => {
    for (const r of [ROOM_RECIPE, SHAPES_RECIPE]) expect(parseRecipe(r).errors).toEqual([]);
    expect(parseRecipe2D(RINGS_RECIPE_2D).errors).toEqual([]);
  });

  it.each(COMBINE_PRESETS.map(p => p.key))('%s builds its products and a stack that compiles', key => {
    const made = presetGraph(key, [output()], nextId)!;
    expect(made.made.length).toBeGreaterThan(0);
    const r = applyCombine(made.nodes, made.spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(r.anchorId).toBeTruthy();
    compiles(r.nodes);
  });
});

/** The March Camera of a 3D build. */
function findCam(nodes: GraphNode[], scene: string): string {
  return resolveProduct({ kind: 'build', scene: '3d', id: scene }, nodes).cam!;
}
