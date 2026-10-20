/**
 * Combine, phase 2 (docs/combine.md, docs/combine-plan.md §2.3, §2.4, §2.8): Collide with and Follow the shape build
 * the hand-wired nodes inside the points' Agents group (each mode its own, by role), they compile, and a rebuild or
 * Start over puts the group back as its builder left it; Follow surface (3D Scene)'s maths (pull to the surface,
 * velocity along it) in JS and in its GLSL; one-line expressions compile to Simple Expressions and refuse bad lines.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { applyScene } from '../../sceneBuilder/apply';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { applyScene2D } from '../../sceneBuilder2d/apply';
import { parseRecipe2D } from '../../sceneBuilder2d/recipe';
import { getNodeDefinition } from '../../nodes/definitions';
import { withAgentSpace } from '../../nodes/definitions/agents';
import { followSceneStep } from '../../nodes/definitions/agentFollowScene';
import { GP_VOL } from '../../play/kit/gpuParticles.js';
import { runGlsl, type Val } from '../../compiler/__tests__/glslEval';
import { applyCombine, removeCombine } from '../apply';
import { CB_BUILD } from '../meta';
import { checkExpr, exprTargets, WALKER_NAMES } from '../exprs';
import { offeredVerbs, verbLine, type CombineLayer, type CombineSpec, type ProductRef } from '../spec';
import { agentsBuildNodes, presetGraph } from '../presets';

let k = 0;
const nextId = () => `t${++k}`;

const ROOM = [
  'plane y=-1 name=Floor',
  'sphere r=0.5 at=(0,-0.2,0) name=Ball',
  'camera dist=4 angle=10 elev=12',
].join('\n');

/** A graph with a one-shape 2D build, a 3D build, a 2D and a 3D Agents build, and the Output. */
function world() {
  let nodes: GraphNode[] = [n('output', 'out', 3000, 0)];
  const r2 = applyScene2D(nodes, parseRecipe2D('hexagon r=0.5 color=gold · background night').scene, { nextId, asNew: true });
  nodes = r2.nodes;
  const r3 = applyScene(nodes, parseRecipe(ROOM).spec, { nextId, asNew: true });
  nodes = r3.nodes;
  const a2 = agentsBuildNodes('2d', nextId);
  const a3 = agentsBuildNodes('3d', nextId);
  nodes = [...nodes, ...a2.nodes, ...a3.nodes];
  return { nodes, twoD: r2.sceneId, threeD: r3.sceneId, pts2: a2.groupId, pts3: a3.groupId };
}

const L = (id: string, product: ProductRef, verb: CombineLayer['verb'], settings: CombineLayer['settings'] = {}, extra: Partial<CombineLayer> = {}): CombineLayer => ({ id, product, verb, settings, ...extra });
const inside = (nodes: GraphNode[], groupId: string) => ((nodes.find(x => x.id === groupId)!.params.subgraph as SubgraphData).nodes);
const roles = (nodes: GraphNode[], groupId: string) => inside(nodes, groupId).filter(x => x.params[CB_BUILD]).map(x => `${x.type}`);

function compiles(nodes: GraphNode[]) {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  return r;
}

beforeEach(() => { k = 0; });

describe('the verb matrix (phase 2)', () => {
  it('offers Collide with and Follow the shape for points on a shape or in a 3D scene with surfaces', () => {
    expect(offeredVerbs('points', 'scene3d')).toEqual(['placeIn', 'collide', 'follow']);
    expect(offeredVerbs('points', 'scene3d', { flatScene: true })).toEqual(['placeIn']);
    expect(offeredVerbs('points', 'picture', { shape: true })).toEqual(['placeIn', 'collide', 'follow']);
    expect(offeredVerbs('points', 'picture')).toEqual(['placeIn']);
    // On a mask (a jump flood first) and pushed by Motion: later.
    expect(offeredVerbs('points', 'mask')).toEqual(['replaceMask']);
  });
});

describe('Collide with', () => {
  it.each([
    ['bounce', ['agentCollide', 'simpleExpr']],
    ['slide', ['agentCollide', 'simpleExpr']],
    ['settle', ['agentGravity', 'agentIntegrate', 'agentCollide', 'simpleExpr']],
  ] as const)('points on a 2D shape: %s', (mode, types) => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '2d', id: w.twoD }, 'base'), L('L2', { kind: 'build', scene: 'agents', id: w.pts2 }, 'collide', { mode })] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(roles(r.nodes, w.pts2)).toEqual(types);
    // The shape comes in through a port, Agent Output's motion from the new nodes.
    const g = r.nodes.find(x => x.id === w.pts2)!;
    expect(g.inputs.cbL2Shape.connection).toBeTruthy();
    const out = inside(r.nodes, w.pts2).find(x => x.type === 'agentOutput')!;
    const col = inside(r.nodes, w.pts2).find(x => x.type === 'agentCollide')!;
    expect(out.inputs.position.connection).toEqual({ nodeId: col.id, outputKey: 'position' });
    expect(col.params.bounce).toBe(mode === 'bounce' ? 0.6 : 0);
    // Top level: Draw agents draws the walkers over the 2D picture (its Background patched), a Mix by Amount.
    expect(r.build.glue.map(x => x.type)).toEqual(['mix']);
    expect(r.build.patches.map(p => p.input)).toEqual(['over']);
    compiles(r.nodes);
    expect(verbLine(spec.layers[1])).toBe(`Collide · ${mode}`);
  });

  it('points in a 3D scene: Collide (3D Scene) on a Scene port; Draw agents sees through the scene\'s camera', () => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '3d', id: w.threeD }, 'base'), L('L2', { kind: 'build', scene: 'agents', id: w.pts3 }, 'collide', { mode: 'settle' })] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(roles(r.nodes, w.pts3)).toEqual(['agentGravity', 'agentIntegrate', 'agentCollideScene', 'simpleExpr']);
    const g = r.nodes.find(x => x.id === w.pts3)!;
    expect(g.inputs.cbL2Scene.connection).toEqual({ nodeId: w.threeD, outputKey: 'scene' });
    expect(r.build.patches.map(p => p.input)).toEqual(['camOrigin', 'camRay', 'depth', 'over']);
    const c = compiles(r.nodes);
    expect(c.agents!.groups.find(x => x.nodeId === w.pts3)!.grids).toHaveLength(1);
  });

  it('a 2D group can\'t go in a 3D scene: the layer says so and builds nothing', () => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '3d', id: w.threeD }, 'base'), L('L2', { kind: 'build', scene: 'agents', id: w.pts2 }, 'collide')] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.layers.L2.problem).toMatch(/2D Agents group/);
    expect(roles(r.nodes, w.pts2)).toEqual([]);
  });
});

describe('Follow the shape', () => {
  it.each([
    ['trace', ['agentRidePath']],
    ['orbit', ['agentRidePath']],
    ['cling', ['constant', 'simpleExpr', 'agentCurl', 'agentFlow', 'agentIntegrate']],
    ['flow', ['constant', 'simpleExpr', 'agentCurl', 'agentFlow', 'agentFlow', 'agentIntegrate']],
  ] as const)('points on a 2D shape: %s', (how, types) => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '2d', id: w.twoD }, 'base'), L('L2', { kind: 'build', scene: 'agents', id: w.pts2 }, 'follow', { how })] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(roles(r.nodes, w.pts2)).toEqual(types);
    compiles(r.nodes);
  });

  it.each(['trace', 'orbit', 'cling', 'flow'] as const)('points in a 3D scene: Follow surface (3D Scene), %s', how => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '3d', id: w.threeD }, 'base'), L('L2', { kind: 'build', scene: 'agents', id: w.pts3 }, 'follow', { how })] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    const fol = inside(r.nodes, w.pts3).find(x => x.type === 'agentFollowScene')!;
    expect(fol.params.mode).toBe(how === 'cling' ? 'cling' : how === 'flow' ? 'along' : 'around');
    expect(fol.params.agentSpace).toBe('3d');
    const c = compiles(r.nodes);
    const grp = c.agents!.groups.find(x => x.nodeId === w.pts3)!;
    expect(grp.grids).toHaveLength(1);
    expect(grp.fragmentShader).toContain('agSceneAt(');
  });
});

describe('rebuild and Start over put the group back as its builder left it', () => {
  it('same ids on a rebuild; a mode change swaps the nodes; Start over takes them, the port and the wires back', () => {
    const w = world();
    const before = structuredClone(w.nodes.find(x => x.id === w.pts2)!);
    const spec: CombineSpec = { v: 1, layers: [L('L1', { kind: 'build', scene: '2d', id: w.twoD }, 'base'), L('L2', { kind: 'build', scene: 'agents', id: w.pts2 }, 'collide', { mode: 'slide' })] };
    const r1 = applyCombine(w.nodes, spec, { nextId });
    const id1 = inside(r1.nodes, w.pts2).find(x => x.type === 'agentCollide')!.id;
    const r2 = applyCombine(r1.nodes, spec, { nextId, anchorId: r1.anchorId });
    expect(inside(r2.nodes, w.pts2).find(x => x.type === 'agentCollide')!.id).toBe(id1);
    expect(roles(r2.nodes, w.pts2)).toEqual(['agentCollide', 'simpleExpr']);
    const follow: CombineSpec = { v: 1, layers: [spec.layers[0], { ...spec.layers[1], verb: 'follow', settings: { how: 'trace' } }] };
    const r3 = applyCombine(r2.nodes, follow, { nextId, anchorId: r2.anchorId });
    expect(roles(r3.nodes, w.pts2)).toEqual(['agentRidePath']);
    const gone = removeCombine(r3.nodes, r3.anchorId!);
    const after = gone.find(x => x.id === w.pts2)!;
    expect(after.inputs).toEqual(before.inputs);
    expect(JSON.stringify(after.params.subgraph)).toBe(JSON.stringify(before.params.subgraph));
  });
});

describe('Follow surface (3D Scene): the maths', () => {
  const sphere = (q: number[]) => Math.hypot(q[0], q[1], q[2]) - 0.5;
  const P = { axis: 'y' as const, offset: 0.05, speed: 0.4, steer: 1, pull: 0.5, dt: 1 / 60 };
  it('pulls a walker to the surface at Offset, a share of the gap a step', () => {
    let p: [number, number, number] = [0.9, 0.1, 0.2], v: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 40; i++) ({ p, v } = followSceneStep(p, v, sphere, { ...P, mode: 'cling' }));
    expect(sphere(p)).toBeCloseTo(0.05, 2);
  });
  it('keeps its velocity along the surface: Around circles the axis, Along goes the axis\'s way', () => {
    const at: [number, number, number] = [0.55, 0, 0];
    const around = followSceneStep(at, [0, 0, 0], sphere, { ...P, mode: 'around' });
    const n = [1, 0, 0];
    expect(Math.abs(around.v[0] * n[0])).toBeLessThan(1e-6);
    // Round the up axis at +x: along −z (cross(y, x)).
    expect(around.v[2]).toBeCloseTo(-0.4, 6);
    const along = followSceneStep(at, [0, 0, 0], sphere, { ...P, mode: 'along' });
    expect(along.v[1]).toBeCloseTo(0.4, 6);
  });
  it('Along lets go at the top (no pooling there), and comes back round from the grid\'s far side', () => {
    const top = followSceneStep([0, 0.55, 0], [0, 0.4, 0], sphere, { ...P, mode: 'along' });
    expect(top.v[1]).toBeGreaterThan(0.3);
    expect(top.p[1]).toBeGreaterThan(0.55);
    const out = followSceneStep([0, 1.85, 0], [0, 0.4, 0], sphere, { ...P, mode: 'along', reach: 2 });
    expect(out.p[1]).toBeLessThan(-1);
  });
  it('its GLSL does the same as the JS', () => {
    const node = withAgentSpace(n('agentFollowScene', 'F', 0, 0, { mode: 'around', axis: 'y', offset: 0.05, speed: 0.4, speedVar: 0, steer: 1, pull: 0.5, reach: 2 }), true, getNodeDefinition);
    const { code, outputVars } = getNodeDefinition('agentFollowScene')!.generateGLSL(node, {});
    const pos = [0.55, 0.1, -0.05], vel = [0, 0, 0];
    // The walker's own hash (a bit mix the evaluator doesn't do) is left out: Speed variation is 0 here.
    const env = runGlsl(code.replace(/agHash\(uint\(a_index\) \^ 0x[0-9A-F]+u\)/, 'agHash(1.0)'), {
      a_pos: pos, a_vel: vel, a_dt: 1 / 60, a_dir: [1, 0, 0], a_index: 3, u_agVolC_F: [0, 0, 0, 2],
      all: ((b: Val) => (b as unknown as boolean[]).every(Boolean)) as unknown as Val,
      cross: ((a: Val, b: Val) => { const [x, y] = [a as number[], b as number[]]; return [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]; }) as unknown as Val,
      agHash: (() => 1) as unknown as Val, agRnd: (() => 0.5) as unknown as Val,
      agSceneAt: ((_s: Val, q: Val) => sphere((q as number[]).map(c => (c / GP_VOL * 2 - 1) * 2))) as unknown as Val,
      u_agVol_F: 0,
    });
    const js = followSceneStep(pos as [number, number, number], vel as [number, number, number], sphere, { ...P, mode: 'around', pull: 0.5, steer: 1 });
    const gp = env[outputVars.position] as number[];
    for (let i = 0; i < 3; i++) expect(gp[i]).toBeCloseTo(js.p[i], 2);
  });
});

describe('one-line expressions', () => {
  it('the names each verb\'s settings offer', () => {
    expect(Object.keys(exprTargets('collide', { mode: 'settle' }))).toEqual(['bounce', 'friction', 'gravity']);
    expect(Object.keys(exprTargets('follow', { how: 'trace' }))).toEqual(['speed', 'offset', 'width']);
    expect(Object.keys(exprTargets('follow', { d3: true }))).toEqual(['speed', 'offset']);
    expect(exprTargets('follow', { how: 'trace' }).speed.map(x => x.name)).toEqual(['speed', 'age', 'd']);
  });
  it('refuses bad lines (the number is used, the window says why)', () => {
    expect(checkExpr('0.2 + 0.6 * step(1.0, speed)', WALKER_NAMES).ok).toBe(true);
    expect(checkExpr('0.3 + sin(t * k)', WALKER_NAMES, { k: 2 }).ok).toBe(true);
    expect(checkExpr('foo * 2.0', WALKER_NAMES).ok).toBe(false);
    expect(checkExpr('vec2(1.0)', WALKER_NAMES).ok).toBe(false);
    expect(checkExpr('a = 1.0', WALKER_NAMES).ok).toBe(false);
  });
  it('compile to a Simple Expression wired where the number went, its sliders Constants', () => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [
      L('L1', { kind: 'build', scene: '2d', id: w.twoD }, 'base'),
      L('L2', { kind: 'build', scene: 'agents', id: w.pts2 }, 'follow', { how: 'trace' }, { exprs: { speed: '0.3 + amp * sin(age * 2.0 + t)' }, sliders: { speed: { amp: 0.2 } } }),
    ] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    const ins = inside(r.nodes, w.pts2);
    const x = ins.find(q => q.type === 'simpleExpr')!;
    const amp = ins.find(q => q.type === 'constant')!;
    const ride = ins.find(q => q.type === 'agentRidePath')!;
    expect(ride.inputs.speed.connection).toEqual({ nodeId: x.id, outputKey: 'result' });
    expect(x.params.expr).toBe('0.3 + amp * sin(age * 2.0 + t)');
    expect(Object.values(x.inputs).map(s => s.label)).toEqual(['age', 'amp']);
    expect(amp.params.value).toBe(0.2);
    compiles(r.nodes);
  });
  it('a bad line builds nothing: the slider\'s number is used, with a warning', () => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [
      L('L1', { kind: 'build', scene: '2d', id: w.twoD }, 'base'),
      L('L2', { kind: 'build', scene: 'agents', id: w.pts2 }, 'collide', { mode: 'bounce' }, { exprs: { bounce: 'nope + 1.0' } }),
    ] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings.join(' ')).toMatch(/Bounce = nope \+ 1\.0/);
    expect(roles(r.nodes, w.pts2)).toEqual(['agentCollide', 'simpleExpr']);
    compiles(r.nodes);
  });
  it('a picture\'s Amount as a line, at the top level', () => {
    const w = world();
    const spec: CombineSpec = { v: 1, layers: [
      L('L1', { kind: 'build', scene: '2d', id: w.twoD }, 'base'),
      L('L2', { kind: 'build', scene: 'agents', id: w.pts2 }, 'placeIn', {}, { exprs: { amount: '0.5 + 0.5 * sin(t)' } }),
    ] };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.glue.map(x => x.type)).toEqual(['simpleExpr', 'mix']);
    compiles(r.nodes);
  });
});

describe('the phase 2 presets', () => {
  it.each(['sparksTrace', 'dustSettles'])('%s builds and compiles', key => {
    const made = presetGraph(key, [n('output', 'out', 0, 0)], nextId)!;
    expect(made).toBeTruthy();
    const r = applyCombine(made.nodes, made.spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(Object.values(r.build.layers).every(l => !l.problem)).toBe(true);
    compiles(r.nodes);
  });
});
