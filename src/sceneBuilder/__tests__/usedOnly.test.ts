/**
 * Build makes only what the scene uses (docs/scene-builder-3d.md, "What Build makes"): no Fog at
 * density 0, no AO or Soft Shadow when they are off, no Texture node for a picture nothing reads,
 * no dead nodes inside Materials. Turning one on later adds it; a rebuild keeps every other node's
 * id. And the camera's projection (Perspective / Orthographic / Reverse).
 */
import { describe, expect, it } from 'vitest';
import { applyScene, findBuild } from '../apply';
import { ROLE_KEY, buildSceneGraph, buildStandaloneGraph, metaOf } from '../build';
import { parseRecipe, printRecipe } from '../recipe';
import { SCENE_TEMPLATES } from '../templates';
import { describeGraph } from '../recognize';
import { cameraBasis, project, rayAt } from '../viewMath';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import type { SceneSpec } from '../spec';

const ids = () => { let i = 0; return () => `n${++i}`; };
const role = (nodes: GraphNode[], r: string) => nodes.find(n => n.params[ROLE_KEY] === r);
const compiles = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes: resolveNodeAliases(nodes, getNodeDefinition) });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  return r;
};

/** Nodes whose outputs nothing reads (inside groups too), apart from the Output and the loop's own ends. */
function unused(nodes: GraphNode[], outs = new Set<string>()): string[] {
  const read = new Set<string>();
  for (const n of nodes) for (const s of Object.values(n.inputs)) if (s.connection) read.add(s.connection.nodeId);
  const found: string[] = [];
  for (const n of nodes) {
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (sg?.nodes) found.push(...unused(sg.nodes, new Set(sg.outputPorts.map(p => p.fromNodeId))));
    // Volume Glow adds into the loop's accumulator (+=): read by the loop, not by a wire.
    if (read.has(n.id) || outs.has(n.id) || n.assignOp || /^(output|marchLoopOutput|sceneOutput)$/.test(n.type)) continue;
    found.push(`${n.type} (${String(n.params[ROLE_KEY] ?? n.id)})`);
  }
  return found;
}

describe('Build makes only what is used', () => {
  it('no Fog, AO or Soft Shadow when they are off', () => {
    const g = buildSceneGraph(parseRecipe('sphere · fog 0 · ao off · shadows off').spec);
    for (const t of ['volumetricFog', 'sdfAo', 'softShadow']) expect(g.nodes.some(n => n.type === t), t).toBe(false);
    const on = buildSceneGraph(parseRecipe('sphere · fog 0.3 · ao 0.05 · shadows 16').spec);
    for (const t of ['volumetricFog', 'sdfAo', 'softShadow']) expect(on.nodes.some(n => n.type === t), t).toBe(true);
  });

  it('every mode and every template: no node whose output nothing reads', () => {
    const recipes = [
      'sphere · fog 0 · ao off · shadows off', 'gi · sphere · box at=(1,0,0) color=red', 'volumetric · sphere', 'glass · sphere · box at=(1,0,0)',
      'sphere color=red · box at=(1,0,0) color=blue shine=0.5 · torus at=(-1,0,0) color=green',
      'texture pond · box size=0.5 texture=pond @repeat(2)',
      'texture pond · texture moss · sphere texture=pond · box at=(1,0,0) texture=moss map=planar · plane y=-1',
      ...SCENE_TEMPLATES.map(t => t.recipe),
    ];
    for (const r of recipes) {
      const g = buildStandaloneGraph(parseRecipe(r).spec);
      expect(unused(g.nodes), r).toEqual([]);
      compiles(g.nodes);
    }
  });

  it('a picture nothing reads gets no Texture node (the spec keeps it, for the picker)', () => {
    const spec = parseRecipe('texture picture · texture img · box size=0.5 texture=img @repeat(2)').spec;
    const g = buildStandaloneGraph(spec);
    expect(g.nodes.filter(n => n.type === 'textureInput').map(n => n.id)).toEqual(['tex_img']);
    const res = applyScene([], spec, { nextId: ids() });
    expect(res.nodes.filter(n => n.type === 'textureInput')).toHaveLength(1);
    expect(res.spec.textures?.map(s => s.name)).toEqual(['picture', 'img']);
    expect(res.spec.textures?.find(s => s.name === 'img')?.node).toBeTruthy();
    expect(res.spec.textures?.find(s => s.name === 'picture')?.node).toBeUndefined();
    compiles(res.nodes);
  });

  it('turning fog, AO and shadows on adds them, off removes them; every other node keeps its id', () => {
    const next = ids();
    const spec = parseRecipe('sphere · box at=(1,0,0) color=red · fog 0 · ao off · shadows off').spec;
    let graph = applyScene([], spec, { nextId: next }).nodes;
    const sceneId = graph.find(n => n.type === 'sceneGroup')!.id;
    const idsBefore = new Map(graph.filter(n => n.params[ROLE_KEY]).map(n => [n.params[ROLE_KEY] as string, n.id]));
    for (const r of ['fog', 'ao', 'shadow']) expect(role(graph, r), r).toBeUndefined();

    const on: SceneSpec = structuredClone(spec);
    on.look.fog = 0.3; on.look.ao = 0.05; on.look.shadows = 16;
    graph = applyScene(graph, on, { nextId: next, sceneId }).nodes;
    for (const r of ['fog', 'ao', 'shadow']) expect(role(graph, r), r).toBeTruthy();
    for (const [r, id] of idsBefore) expect(role(graph, r)?.id, r).toBe(id);
    compiles(graph);
    const fogId = role(graph, 'fog')!.id;

    const off: SceneSpec = structuredClone(on);
    off.look.ao = 0; off.look.shadows = 0;
    graph = applyScene(graph, off, { nextId: next, sceneId }).nodes;
    expect(role(graph, 'ao')).toBeUndefined();
    expect(role(graph, 'shadow')).toBeUndefined();
    expect(role(graph, 'fog')?.id).toBe(fogId);
    for (const [r, id] of idsBefore) expect(role(graph, r)?.id, r).toBe(id);
    expect(graph.find(n => n.type === 'output')!.inputs.color.connection?.nodeId).toBe(role(graph, 'tone')!.id);
    compiles(graph);
  });

  it('a scene built before this (a dead "nearest so far" in Materials, an unread picture node) reopens and rebuilds', () => {
    const next = ids();
    const spec = parseRecipe('texture picture · texture img · sphere color=red texture=img · box at=(1,0,0) color=blue').spec;
    let graph = applyScene([], spec, { nextId: next }).nodes;
    const sceneId = graph.find(n => n.type === 'sceneGroup')!.id;
    // As an older build made it: the last shape's union inside Materials, and an empty Texture for the unread picture.
    graph = graph.map(n => {
      if (n.params[ROLE_KEY] !== 'materials') return n;
      const sg = structuredClone(n.params.subgraph as SubgraphData);
      const last = sg.nodes[sg.nodes.length - 1];
      sg.nodes.push({ id: 'old_near', type: 'sdfUnion', position: { x: 0, y: 0 }, inputs: { a: { type: 'float', label: 'A', connection: { nodeId: last.id, outputKey: Object.keys(last.outputs)[0] } } }, outputs: { dist: { type: 'float', label: 'Dist' } }, params: { k: 0, [ROLE_KEY]: 'mat:s2:s2:near' } });
      return { ...n, params: { ...n.params, subgraph: sg } };
    });
    graph.push({ id: 'old_tex', type: 'textureInput', position: { x: 0, y: 0 }, inputs: {}, outputs: { texture: { type: 'sampler2D' as never, label: 'Texture' } }, params: {} });
    compiles(graph);
    // Reopens as built: the spec on its Scene Group, both pictures listed.
    const meta = metaOf(findBuild(graph, sceneId)!.scene)!;
    expect(printRecipe(meta.spec)).toBe(printRecipe(spec).replace('texture img', `texture img node=${meta.spec.textures![1].node}`));
    // Rebuilds without the dead node, same scene, compiling.
    const res = applyScene(graph, meta.spec, { nextId: next, sceneId });
    const mat = role(res.nodes, 'materials')!;
    expect((mat.params.subgraph as SubgraphData).nodes.some(n => n.id === 'old_near')).toBe(false);
    expect(res.nodes.filter(n => n.type === 'sceneGroup')).toHaveLength(1);
    compiles(res.nodes);
  });
});

describe('the camera\'s projection', () => {
  it('reads and prints: camera orthographic, camera reverse reverse=… converge=…, perspective by default', () => {
    expect(parseRecipe('sphere').spec.camera.projection).toBeUndefined();
    const o = parseRecipe('sphere · camera orthographic dist=5');
    expect(o.errors).toEqual([]);
    expect(o.spec.camera.projection).toBe('orthographic');
    expect(o.spec.camera.dist).toBe(5);
    expect(printRecipe(o.spec)).toContain('camera orthographic dist=5');
    const r = parseRecipe('sphere · camera projection=reverse reverse=0.6 converge=5');
    expect(r.errors).toEqual([]);
    expect(r.spec.camera).toMatchObject({ projection: 'reverse', reverse: 0.6, converge: 5 });
    expect(parseRecipe(printRecipe(r.spec)).spec.camera).toEqual(r.spec.camera);
    expect(parseRecipe('sphere · camera ortho').spec.camera.projection).toBe('orthographic');
    expect(parseRecipe('sphere · camera reverse · camera perspective').spec.camera.projection).toBeUndefined();
    expect(parseRecipe('sphere · camera sideways').errors[0]?.message).toMatch(/perspective, orthographic, reverse/);
  });

  it('builds March Camera\'s Perspective, compiles, and Describe reads it back', () => {
    const plain = buildSceneGraph(parseRecipe('sphere').spec);
    expect(role(plain.nodes, 'camera')!.params.projection).toBeUndefined();
    for (const [recipe, want] of [
      ['sphere · camera orthographic', { projection: 'orthographic' }],
      ['sphere · camera reverse reverse=0.7 converge=6', { projection: 'reverse', reverseStrength: 0.7, reverseDist: 6 }],
    ] as const) {
      const spec = parseRecipe(recipe).spec;
      const g = buildStandaloneGraph(spec);
      const cam = role(g.nodes, 'camera')!;
      expect(cam.params).toMatchObject(want);
      expect(String(cam.params.__comment)).toMatch(spec.camera.projection === 'reverse' ? /reverse perspective/ : /orthographic/);
      const r = compiles(g.nodes);
      expect(r.fragmentShader).toMatch(spec.camera.projection === 'reverse' ? /_rO\b/ : /_or\s+= clamp\(1\.0/);
      const back = describeGraph(g.nodes)!;
      expect(back.spec.camera.projection).toBe(spec.camera.projection);
      if (spec.camera.projection === 'reverse') expect(back.spec.camera).toMatchObject({ reverse: 0.7, converge: 6 });
    }
  });

  it('the viewport follows it: a point projects and its ray goes back through it', () => {
    for (const recipe of ['sphere · camera orthographic', 'sphere · camera reverse converge=6', 'sphere · camera flatten=0.4', 'sphere']) {
      const b = cameraBasis(parseRecipe(recipe).spec.camera);
      const p: [number, number, number] = [0.3, 0.2, -0.1];
      const pr = project(b, p)!;
      expect(pr, recipe).toBeTruthy();
      const ray = rayAt(b, pr.uv);
      // The point is on the ray: the distance from it to the line is ~0.
      const v = [p[0] - ray.o[0], p[1] - ray.o[1], p[2] - ray.o[2]];
      const t = v[0] * ray.d[0] + v[1] * ray.d[1] + v[2] * ray.d[2];
      const miss = Math.hypot(v[0] - t * ray.d[0], v[1] - t * ray.d[1], v[2] - t * ray.d[2]);
      expect(miss, recipe).toBeLessThan(1e-6);
    }
    // Reverse: farther things look bigger (a step across covers less of the picture far away).
    const rev = cameraBasis(parseRecipe('sphere · camera reverse converge=6').spec.camera);
    const near = project(rev, [0.1, 0, 0])!, far = project(rev, [0.1, 0, -2])!;
    const per = cameraBasis(parseRecipe('sphere').spec.camera);
    expect(Math.abs(far.uv[0] - project(rev, [0, 0, -2])!.uv[0])).toBeGreaterThan(Math.abs(near.uv[0] - project(rev, [0, 0, 0])!.uv[0]) * 0.99);
    expect(project(per, [0, 0, -2])).toBeTruthy();
  });
});
