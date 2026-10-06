/**
 * The 3D Scene Builder (docs/scene-builder.md): the recipe language both ways,
 * spec → graph, graph → spec (exact for builder graphs, partial for hand-made
 * ones), templates and examples compiling, and rebuilds that keep edits.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { SCENE_BUILDER_EXAMPLE_KEYS } from '../../store/sceneBuilderExamples';
import { parseRecipe, printRecipe } from '../recipe';
import { buildSceneGraph, buildStandaloneGraph, ROLE_KEY } from '../build';
import { collapseGroups, describeGraph } from '../recognize';
import { applyScene, checkEdits } from '../apply';
import { addGroup, addShape, isWithin, moveItem } from '../edit';
import { SCENE_TEMPLATES, templateSpec } from '../templates';
import { allShapes, autoStepScale, canonicalSpec, starterSpec, type SceneSpec } from '../spec';

const TASK_RECIPE = 'volumetric · smooth-union(sphere r=1, cone h=2 rot=(30,0,0)) k=0.3 · twist 0.5 · polar-repeat 6 · camera dist=4 orbit=0.2 · fog 0.3';

const inner = (n: GraphNode | undefined): GraphNode[] => ((n?.params.subgraph as SubgraphData | undefined)?.nodes ?? []);
const every = (nodes: GraphNode[]): GraphNode[] => nodes.flatMap(n => [n, ...every(inner(n))]);
const byRole = (nodes: GraphNode[], role: string) => every(nodes).find(n => n.params[ROLE_KEY] === role);
const src = (nodes: GraphNode[], n: GraphNode | undefined, key: string) => {
  const c = n?.inputs[key]?.connection;
  return c ? every(nodes).find(x => x.id === c.nodeId) : undefined;
};
const same = (a: SceneSpec, b: SceneSpec) => expect(canonicalSpec({ ...b, root: collapseGroups(structuredClone(b.root)) })).toEqual(canonicalSpec({ ...a, root: collapseGroups(structuredClone(a.root)) }));

describe('recipe text', () => {
  const recipes = [TASK_RECIPE, ...SCENE_TEMPLATES.map(t => t.recipe),
    'surface · box size=(0.3,1,0.3) round=0.05 color=#ff8844 @twist(2) @displace(0.03 freq=12) · mirror xz · sun dir=(0.2,1,0.3) · shadows off · ao off · tone hable',
    'gi metal=0.5 · subtract(sphere r=1, cylinder r=0.4 h=2, cylinder r=0.4 h=2 rot=(90,0,0)) · camera flatten=1 zoom=3',
  ];

  it('parses the task\'s example and the templates without errors', () => {
    for (const r of recipes) expect(parseRecipe(r).errors, r).toEqual([]);
  });

  it('round-trips: recipe → spec → recipe → spec is the same spec, and printing is stable', () => {
    for (const r of recipes) {
      const a = parseRecipe(r).spec;
      const printed = printRecipe(a);
      const b = parseRecipe(printed);
      expect(b.errors, printed).toEqual([]);
      same(a, b.spec);
      expect(printRecipe(b.spec)).toBe(printed);
      expect(printRecipe(parseRecipe(printRecipe(a, { multiline: true })).spec)).toBe(printed);
    }
  });

  it('reads the task\'s example as meant', () => {
    const { spec } = parseRecipe(TASK_RECIPE);
    expect(spec.look.mode).toBe('volumetric');
    expect(spec.root.op).toBe('union');
    expect(spec.root.k).toBe(0.3);
    expect(spec.root.children.map(c => c.type === 'shape' && c.kind)).toEqual(['sphere', 'cone']);
    const cone = spec.root.children[1];
    expect(cone.type === 'shape' && cone.rot).toEqual([30, 0, 0]);
    expect(spec.root.warps.map(w => [w.kind, w.values.k ?? w.values.count])).toEqual([['twist', 0.5], ['polar-repeat', 6]]);
    expect(spec.camera).toMatchObject({ dist: 4, orbit: 0.2 });
    expect(spec.look.fog).toBe(0.3);
  });

  it('is forgiving: aliases, case, units, colour names and hex', () => {
    const { spec, errors } = parseRecipe('LIT\nBall 0.4 at=(1,0,0) colour=gold\ndonut 1 0.1 rot=(0.5rad, 90deg, 0)\ncube 0.3 color=#08f');
    expect(errors).toEqual([]);
    const [ball, donut, cube] = allShapes(spec);
    expect([ball.kind, donut.kind, cube.kind]).toEqual(['sphere', 'torus', 'box']);
    expect(ball.size.r).toBe(0.4);
    expect(donut.size).toMatchObject({ R: 1, r: 0.1 });
    expect(donut.rot[0]).toBeCloseTo(28.6479, 3);
    expect(donut.rot[1]).toBe(90);
    expect(cube.size.size).toEqual([0.3, 0.3, 0.3]);
    expect(cube.color).toEqual([0, 0.5333, 1]);
  });

  it('reports mistakes with a position and a suggestion, and keeps the rest', () => {
    const r = parseRecipe('surface\nsphre r=1\nbox size=0.4 colr=red\ntorus R=1 · twist(\nfog 0.2');
    const msgs = r.errors.map(e => `${e.line}:${e.col} ${e.message}`);
    expect(msgs.some(m => m.startsWith('2:1') && m.includes('Did you mean “sphere”'))).toBe(true);
    expect(msgs.some(m => m.startsWith('3:14') && m.includes('Did you mean “color”'))).toBe(true);
    expect(msgs.some(m => m.includes('never closed'))).toBe(true);
    expect(allShapes(r.spec).map(s => s.kind)).toEqual(['box', 'torus']);
    expect(r.spec.look.fog).toBe(0.2);
  });
});

describe('spec → graph', () => {
  it('builds the task\'s example the way it would be wired by hand', () => {
    const { spec } = parseRecipe(TASK_RECIPE);
    const { nodes, outputId } = buildStandaloneGraph(spec);
    const scene = byRole(nodes, 'scene')!;
    const loop = byRole(nodes, 'march')!;
    const cam = byRole(nodes, 'camera')!;
    expect(scene.type).toBe('sceneGroup');
    expect(loop.type).toBe('marchLoopGroup');
    expect(loop.params.volumetric).toBe(true);
    expect(src(nodes, loop, 'scene')?.id).toBe(scene.id);
    expect(src(nodes, loop, 'ro')?.id).toBe(cam.id);
    // Inside the scene: Scene Pos → Twist → Polar Repeat → (sphere | rotate → cone) → smooth union → Scene Output.
    const ins = inner(scene);
    const out = ins.find(n => n.type === 'sceneOutput')!;
    const union = src(ins, out, 'dist')!;
    expect(union.type).toBe('sdfUnion');
    expect(union.params.k).toBe(0.3);
    const sphere = src(ins, union, 'a')!, cone = src(ins, union, 'b')!;
    expect([sphere.type, cone.type]).toEqual(['sphereSDF3D', 'coneSDF3D']);
    const rot = src(ins, cone, 'pos')!;
    expect(rot.type).toBe('rotate3D');
    expect(rot.params).toMatchObject({ axis: 'x' });
    expect(rot.params.angle).toBeCloseTo(-Math.PI / 6, 5);
    const polar = src(ins, rot, 'pos')!;
    expect(polar.type).toBe('polarRepeat3D');
    expect(src(ins, sphere, 'pos')?.id).toBe(polar.id);
    const twist = src(ins, polar, 'pos')!;
    expect(twist.type).toBe('twist3D');
    expect(src(ins, twist, 'pos')?.type).toBe('scenePos');
    // Twist stretches space: the loop takes smaller steps.
    expect(loop.params.stepScale).toBe(autoStepScale(spec));
    expect(loop.params.stepScale).toBeLessThan(1);
    // Volumetric: Scene Distance → Volume Glow (+=) in the body, Glow to Color after the loop.
    const glow = inner(loop).find(n => n.type === 'volumeGlow')!;
    expect(glow.assignOp).toBe('+=');
    const g2c = byRole(nodes, 'glowColor')!;
    expect(g2c.inputs.glow.connection).toEqual({ nodeId: loop.id, outputKey: 'acc0' });
    expect(nodes.find(n => n.id === outputId)!.inputs.color.connection?.nodeId).toBe(byRole(nodes, 'tone')!.id);
    // A note on every node, the insides included.
    for (const n of every(nodes)) if (n.type !== 'output') expect(typeof n.params.__comment, `${n.type} has a note`).toBe('string');
  });

  it('lights a surface scene with shadows, AO and Multi-Light from one sun, and picks a colour per shape', () => {
    const { nodes } = buildStandaloneGraph(templateSpec('blobs'));
    const scene = byRole(nodes, 'scene')!, sun = byRole(nodes, 'sun')!;
    for (const role of ['shadow', 'ao']) expect(src(nodes, byRole(nodes, role), 'scene')?.id).toBe(scene.id);
    expect(src(nodes, byRole(nodes, 'shadow'), 'lightDir')?.id).toBe(sun.id);
    const light = byRole(nodes, 'light')!;
    expect(src(nodes, light, 'sunDir')?.id).toBe(sun.id);
    expect(src(nodes, light, 'baseColor')?.params[ROLE_KEY]).toBe('materials');
    expect(every(nodes).filter(n => n.type === 'materialSelect').length).toBe(allShapes(templateSpec('blobs')).length - 1);
  });

  it('every template compiles, and its sliders are live uniforms (dragging them never recompiles)', () => {
    for (const t of SCENE_TEMPLATES) {
      const spec = templateSpec(t.key);
      const { nodes } = buildStandaloneGraph(spec);
      const r = compileGraph({ nodes });
      expect(r.success, `${t.key}: ${(r.errors ?? []).join('; ')}`).toBe(true);
      const shape = byRole(nodes, allShapes(spec)[0].id)!;
      const key = Object.keys(getNodeDefinition(shape.type)!.paramDefs ?? {}).find(k => typeof shape.params[k] === 'number')!;
      expect(r.paramBindings[`${shape.id}::${key}`], `${t.key}: ${shape.type}.${key} is a uniform`).toBeTruthy();
      expect(r.paramBindings[`${byRole(nodes, 'camera')!.id}::camDist`]).toBeTruthy();
    }
  });

  it('the Scene Builder examples compile, carry their spec, and show their recipe in a note', () => {
    expect(SCENE_BUILDER_EXAMPLE_KEYS.length).toBeGreaterThanOrEqual(4);
    for (const k of SCENE_BUILDER_EXAMPLE_KEYS) {
      const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition);
      expect(compileGraph({ nodes }).success, k).toBe(true);
      const scene = nodes.find(n => n.type === 'sceneGroup' && n.params.sceneBuilder)!;
      expect(String(scene.params.__comment)).toContain('The recipe this scene was built from');
      expect(EXAMPLE_GRAPHS[k].description).toContain('Recipe:');
    }
  });

  it('Flatten adds the orthographic camera only when set', () => {
    const plain = buildStandaloneGraph(starterSpec());
    expect(byRole(plain.nodes, 'camera')!.params.ortho).toBeUndefined();
    const flat = starterSpec();
    flat.camera.flatten = 1;
    const built = buildStandaloneGraph(flat);
    const r = compileGraph({ nodes: built.nodes });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/_lat\s+=/);
    expect(compileGraph({ nodes: plain.nodes }).fragmentShader).not.toMatch(/_lat\s+=/);
  });
});

describe('graph → spec (Describe this graph)', () => {
  it('reads every template\'s graph back exactly', () => {
    for (const t of SCENE_TEMPLATES) {
      const spec = templateSpec(t.key);
      const d = describeGraph(buildStandaloneGraph(spec).nodes)!;
      expect(d.unknown, t.key).toEqual([]);
      expect(d.builderMade).toBe(true);
      same(spec, d.spec);
      expect(printRecipe(d.spec)).toBe(printRecipe(spec));
    }
  });

  it('reads a hand-made still life: shapes, a smooth union inside a union, a moved cone, the lights', () => {
    const d = describeGraph(resolveNodeAliases(EXAMPLE_GRAPHS.litStillLife.nodes, getNodeDefinition))!;
    expect(d.builderMade).toBe(false);
    expect(d.spec.look.mode).toBe('surface');
    const [blend, plane] = d.spec.root.children;
    expect(blend.type === 'group' && [blend.op, blend.k]).toEqual(['union', 0.1]);
    expect(blend.type === 'group' && blend.children.map(c => c.type === 'shape' && c.kind)).toEqual(['capsule', 'cone']);
    const cone = blend.type === 'group' ? blend.children[1] : null;
    expect(cone?.type === 'shape' && cone.at).toEqual([0.9, -0.3, 0.2]);
    expect(plane.type === 'shape' && plane.kind).toBe('plane');
    expect(d.spec.look.shadows).toBe(16);
    expect(d.coverage.read).toBe(d.coverage.total);
  });

  it('reads warps in other hand-made scenes and marks what it doesn\'t know as custom', () => {
    const polar = describeGraph(resolveNodeAliases(EXAMPLE_GRAPHS.sdfPolarRepeat.nodes, getNodeDefinition))!;
    expect(polar.recipe).toMatch(/box .*@polar-repeat\(8\)/);
    const tunnel = describeGraph(resolveNodeAliases(EXAMPLE_GRAPHS.mlgWiggleTunnel.nodes, getNodeDefinition))!;
    expect(tunnel.recipe).toContain('custom-warp(Expression Block)');
    expect(tunnel.recipe).toMatch(/octahedron .*@repeat/);
    expect(tunnel.coverage.read).toBeLessThan(tunnel.coverage.total);
    // The recognised part opens in the builder and builds.
    const rebuilt = buildStandaloneGraph(tunnel.spec);
    expect(compileGraph({ nodes: rebuilt.nodes }).success).toBe(true);
    expect(rebuilt.warnings.some(w => w.includes('custom'))).toBe(true);
  });

  it('returns null for a graph with no 3D scene', () => {
    expect(describeGraph(EXAMPLE_GRAPHS.blank.nodes)).toBeNull();
  });
});

describe('Build and Rebuild in a graph', () => {
  const ids = () => { let i = 0; return () => `n${++i}`; };

  it('builds beside what is there and takes the Output over', () => {
    const before = structuredClone(EXAMPLE_GRAPHS.blank.nodes);
    const res = applyScene(before, templateSpec('twisted'), { nextId: ids() });
    const out = res.nodes.find(n => n.type === 'output')!;
    expect(out.inputs.color.connection?.nodeId).toBe(res.nodes.find(n => n.params[ROLE_KEY] === 'tone')!.id);
    expect(res.nodes.length).toBe(before.length + buildSceneGraph(templateSpec('twisted')).nodes.length);
    const r = compileGraph({ nodes: resolveNodeAliases(res.nodes, getNodeDefinition) });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  });

  it('keeps the user\'s own settings and wires, and the node ids, across a rebuild', () => {
    const next = ids();
    const spec = templateSpec('twisted');
    let graph = applyScene([], spec, { nextId: next }).nodes;
    const sceneId = graph.find(n => n.type === 'sceneGroup')!.id;
    // The user turns up the shadows' hardness and wires the tone-mapped colour into a node of their own.
    const shadow = graph.find(n => n.params[ROLE_KEY] === 'shadow')!;
    const tone = graph.find(n => n.params[ROLE_KEY] === 'tone')!;
    graph = graph.map(n => (n.id === shadow.id ? { ...n, params: { ...n.params, k: 40 } } : n));
    graph.push({ id: 'mine', type: 'invert', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: tone.id, outputKey: 'color' } } }, outputs: {}, params: {} });
    // …and in the builder, changes the camera.
    const changed = structuredClone(spec);
    changed.camera.dist = 6;
    const report = checkEdits(graph, sceneId, changed);
    expect(report.lost).toEqual([]);
    expect(report.kept).toContain('Soft Shadow · Hardness (k)');
    const res = applyScene(graph, changed, { nextId: next, sceneId });
    const after = (role: string) => res.nodes.find(n => n.params[ROLE_KEY] === role)!;
    expect(after('shadow').params.k).toBe(40);
    expect(after('shadow').id).toBe(shadow.id);
    expect(after('camera').params.camDist).toBe(6);
    expect(res.nodes.find(n => n.id === 'mine')!.inputs.color.connection?.nodeId).toBe(tone.id);
    expect(res.nodes.filter(n => n.type === 'sceneGroup')).toHaveLength(1);
  });

  it('reports what a rebuild can\'t keep: a setting both changed, a moved wire, a node added inside', () => {
    const spec = templateSpec('twisted');
    let graph = applyScene([], spec, { nextId: ids() }).nodes;
    const sceneId = graph.find(n => n.type === 'sceneGroup')!.id;
    const cam = graph.find(n => n.params[ROLE_KEY] === 'camera')!;
    graph = graph.map(n => (n.id === cam.id ? { ...n, params: { ...n.params, camDist: 9 } } : n));
    graph = graph.map(n => (n.id !== sceneId ? n : { ...n, params: { ...n.params, subgraph: { ...(n.params.subgraph as SubgraphData), nodes: [...inner(n), { id: 'extra', type: 'sphereSDF3D', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} }] } } }));
    const changed = structuredClone(spec);
    changed.camera.dist = 6;
    const report = checkEdits(graph, sceneId, changed);
    expect(report.lost.some(l => l.includes('March Camera · Cam Dist'))).toBe(true);
    expect(report.lost.some(l => l.includes('you added inside'))).toBe(true);
  });
});

describe('editing the tree', () => {
  it('moves and nests items, and never into themselves', () => {
    const spec = starterSpec();
    const box = addShape(spec, 'box', null);
    const g = addGroup(spec, box.id, 'subtract');
    expect(spec.root.children.map(c => c.id)).toEqual(['s1', g.id]);
    expect(moveItem(spec, 's1', g.id, 'into')).toBe(true);
    expect(isWithin(spec, 's1', g.id)).toBe(true);
    expect(moveItem(spec, g.id, 's1', 'before')).toBe(false);
    expect(moveItem(spec, 's1', box.id, 'before')).toBe(true);
    expect(g.children.map(c => c.id)).toEqual(['s1', box.id]);
  });
});
