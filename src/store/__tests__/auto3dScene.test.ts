/**
 * Every 3D node added on the top level ends up in a wired scene that draws it:
 * a new camera → Scene Group → march loop on the Output when the graph has no
 * scene, or inside the existing Scene Group (joined with a Union, or bending
 * the whole scene for a warp) when it has one. Inside a Scene Group a shape is
 * wired into the scene's output. The Volumetric switch on a loop builds (and
 * takes away) Scene Distance → Volume Glow (+=) → Glow to Color. Each is one
 * undo step. See nodes/scene3dShapes.ts and nodes/volumetricAuto.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { getOfferedDefinitions } from '../../nodes/definitions';
import { sceneRole } from '../../nodes/scene3dShapes';

const outputOnly = (): GraphNode[] => [
  { id: 'out', type: 'output', position: { x: 900, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} },
];
const st = () => useNodeGraphStore.getState();
const subOf = (n: GraphNode | undefined) => (n?.params.subgraph as SubgraphData | undefined)?.nodes ?? [];
const scenes = () => st().nodes.filter(n => n.type === 'sceneGroup');
const loopOf = () => st().nodes.find(n => n.type === 'marchLoopGroup')!;
const outputWire = () => st().nodes.find(n => n.type === 'output')!.inputs.color.connection;

function compiles(nodes: GraphNode[]) {
  const r = compileGraph({ nodes });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  expect(r.fragmentShader).not.toMatch(/MISSING_SCENE/);
  return r;
}

/** Walks back from Scene Output: true when `id` is on the path that reaches it. */
function reaches(inner: GraphNode[], id: string): boolean {
  const byId = new Map(inner.map(n => [n.id, n]));
  const seen = new Set<string>();
  const stack = [inner.find(n => n.type === 'sceneOutput')!.id];
  while (stack.length) {
    const cur = byId.get(stack.pop()!);
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    if (cur.id === id) return true;
    for (const v of Object.values(cur.inputs)) if (v.connection) stack.push(v.connection.nodeId);
  }
  return false;
}

const SCENE_TYPES = getOfferedDefinitions().filter(d => sceneRole(d)).map(d => d.type);

beforeEach(() => {
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  st().replaceGraph(outputOnly());
});

describe('a 3D node on the top level of a graph with no scene', () => {
  it('covers every 3D primitive, transform and fractal', () => {
    expect(SCENE_TYPES.length).toBeGreaterThan(40);
    for (const t of ['sphereSDF3D', 'repeat3D', 'displace3D', 'scale3d', 'kifsTetra', 'mandelboxDE', 'gyroidField', 'voxelize', 'planeSDF3D']) expect(SCENE_TYPES).toContain(t);
  });

  it.each(SCENE_TYPES)('%s: a new Scene Group draws it, with a camera and loop on the Output', type => {
    const id = st().addNode(type, { x: 0, y: 0 });
    expect(scenes()).toHaveLength(1);
    const scene = scenes()[0];
    expect(id).toBe(scene.id);
    const inner = subOf(scene);
    const added = inner.find(n => n.type === type)!;
    expect(added, 'the node is inside the group').toBeTruthy();
    expect(reaches(inner, added.id), 'the node leads to Scene Output').toBe(true);
    const loop = loopOf();
    expect(loop.inputs.scene.connection?.nodeId).toBe(scene.id);
    expect(outputWire()).toEqual({ nodeId: loop.id, outputKey: 'color' });
    compiles(st().nodes);
  });

  it('one undo takes the whole scene away', () => {
    st().addNode('repeat3D', { x: 0, y: 0 });
    st().undo();
    expect(st().nodes.map(n => n.type)).toEqual(['output']);
  });
});

describe('a 3D node on the top level of a graph that already has a scene', () => {
  beforeEach(() => { st().addNode('sphereSDF3D', { x: 0, y: 0 }); });

  it.each(SCENE_TYPES)('%s goes into the existing Scene Group and shows', type => {
    const scene = scenes()[0];
    const before = subOf(scene).length;
    expect(st().addNode(type, { x: 400, y: 400 })).toBe(scene.id);
    expect(scenes()).toHaveLength(1);
    expect(st().nodes.filter(n => n.type === 'marchLoopGroup')).toHaveLength(1);
    const inner = subOf(scenes()[0]);
    expect(inner.length).toBeGreaterThan(before);
    const added = inner.find(n => n.type === type && !subOf(scene).some(o => o.id === n.id))!;
    expect(reaches(inner, added.id)).toBe(true);
    // The first sphere still counts.
    expect(reaches(inner, subOf(scene).find(n => n.type === 'sphereSDF3D')!.id)).toBe(true);
    compiles(st().nodes);
  });

  it('a second shape is joined by a Union and moved beside the first, each with a note', () => {
    st().addNode('boxSDF3D', { x: 400, y: 400 });
    const inner = subOf(scenes()[0]);
    const union = inner.find(n => n.type === 'sdfUnion')!;
    const box = inner.find(n => n.type === 'boxSDF3D')!;
    const shift = inner.find(n => n.type === 'translate3D')!;
    expect(inner.find(n => n.type === 'sceneOutput')!.inputs.dist.connection).toEqual({ nodeId: union.id, outputKey: 'dist' });
    expect(union.inputs.b.connection).toEqual({ nodeId: box.id, outputKey: 'dist' });
    expect(box.inputs.pos.connection).toEqual({ nodeId: shift.id, outputKey: 'pos' });
    expect(shift.params.tx).not.toBe(0);
    expect(typeof union.params.__comment).toBe('string');
    expect(typeof shift.params.__comment).toBe('string');
    // The camera, still at its default distance, moves back to keep both in view.
    expect(st().nodes.find(n => n.type === 'marchCamera')!.params.camDist as number).toBeGreaterThan(3);
    // A third goes to the other side.
    st().addNode('torusSDF3D', { x: 400, y: 800 });
    const shifts = subOf(scenes()[0]).filter(n => n.type === 'translate3D').map(n => n.params.tx as number);
    expect(Math.sign(shifts[0])).toBe(-Math.sign(shifts[1]));
  });

  it('a camera the user moved is left where it is', () => {
    const cam = st().nodes.find(n => n.type === 'marchCamera')!;
    st().updateNodeParams(cam.id, { camDist: 2.2 });
    st().addNode('boxSDF3D', { x: 400, y: 400 });
    expect(st().nodes.find(n => n.id === cam.id)!.params.camDist).toBe(2.2);
  });

  it('a warp bends the whole scene: the sphere reads it instead of Scene Pos', () => {
    st().addNode('twist3D', { x: 400, y: 400 });
    const inner = subOf(scenes()[0]);
    const twist = inner.find(n => n.type === 'twist3D')!;
    expect(inner.find(n => n.type === 'sphereSDF3D')!.inputs.pos.connection).toEqual({ nodeId: twist.id, outputKey: 'pos' });
    expect(twist.inputs.pos.connection?.nodeId).toBe(inner.find(n => n.type === 'scenePos')!.id);
  });

  it('is one undo step', () => {
    const before = JSON.stringify(st().nodes);
    st().addNode('boxSDF3D', { x: 400, y: 400 });
    st().undo();
    expect(JSON.stringify(st().nodes)).toBe(before);
  });
});

describe('a shape added inside a Scene Group', () => {
  it('is wired from Scene Pos and joined to the scene output, without being moved', () => {
    st().addNode('sphereSDF3D', { x: 0, y: 0 });
    const scene = scenes()[0];
    st().enterGroup(scene.id);
    const id = st().addNode('boxSDF3D', { x: 500, y: 600 })!;
    const inner = subOf(st().nodes.find(n => n.id === scene.id));
    const box = inner.find(n => n.id === id)!;
    expect(box.inputs.pos.connection?.nodeId).toBe(inner.find(n => n.type === 'scenePos')!.id);
    expect(reaches(inner, id)).toBe(true);
    expect(inner.some(n => n.type === 'translate3D')).toBe(false);
    compiles(st().nodes);
  });

  it('goes straight into an empty Scene Output', () => {
    st().addNode('sphereSDF3D', { x: 0, y: 0 });
    const scene = scenes()[0];
    st().enterGroup(scene.id);
    const sphere = subOf(scene).find(n => n.type === 'sphereSDF3D')!;
    st().removeNode(sphere.id);
    const id = st().addNode('torusSDF3D', { x: 500, y: 200 })!;
    const inner = subOf(st().nodes.find(n => n.id === scene.id));
    expect(inner.find(n => n.type === 'sceneOutput')!.inputs.dist.connection).toEqual({ nodeId: id, outputKey: 'dist' });
  });
});

describe('a lighting node with no scene', () => {
  it('brings a scene and is wired to its loop', () => {
    st().addNode('sdfAo', { x: 0, y: 0 });
    const loop = loopOf();
    const ao = st().nodes.find(n => n.type === 'sdfAo')!;
    expect(ao.inputs.normal.connection).toEqual({ nodeId: loop.id, outputKey: 'normal' });
    expect(ao.inputs.scene.connection?.nodeId).toBe(scenes()[0].id);
    expect(outputWire()).toEqual({ nodeId: loop.id, outputKey: 'color' });
    compiles(st().nodes);
    st().undo();
    expect(st().nodes.map(n => n.type)).toEqual(['output']);
  });
});

describe('the Volumetric switch', () => {
  beforeEach(() => { st().addNode('torusSDF3D', { x: 0, y: 0 }); });

  it('on: builds Scene Distance → Volume Glow (+=) → Glow to Color on the Output, each with a note', () => {
    const loop = loopOf();
    st().setLoopVolumetric(loop.id, true);
    const after = loopOf();
    expect(after.params.volumetric).toBe(true);
    const body = subOf(after);
    const sd = body.find(n => n.type === 'marchSceneDist')!;
    const glow = body.find(n => n.type === 'volumeGlow')!;
    expect(glow.assignOp).toBe('+=');
    expect(glow.inputs.dist.connection).toEqual({ nodeId: sd.id, outputKey: 'rawDist' });
    expect(sd.inputs.pos.connection?.outputKey).toBe('marchPos');
    const g2c = st().nodes.find(n => n.type === 'glowToColor')!;
    expect(g2c.inputs.glow.connection).toEqual({ nodeId: loop.id, outputKey: 'acc0' });
    expect(outputWire()).toEqual({ nodeId: g2c.id, outputKey: 'color' });
    for (const n of [sd, glow, g2c]) expect(String(n.params.__comment)).toMatch(/Volumetric switch/);
    const r = compiles(st().nodes);
    expect(r.fragmentShader).toMatch(/tanh\(clamp\(/);
  });

  it('off: removes exactly what it added and shows the loop\'s Color again', () => {
    const before = st().nodes;
    const loop = loopOf();
    st().setLoopVolumetric(loop.id, true);
    st().setLoopVolumetric(loop.id, false);
    const after = loopOf();
    expect(after.params.volumetric).toBe(false);
    expect(after.params._volumetricAuto).toBeUndefined();
    expect(subOf(after).map(n => n.type).sort()).toEqual(subOf(before.find(n => n.id === loop.id)).map(n => n.type).sort());
    expect(st().nodes.map(n => n.type).sort()).toEqual(before.map(n => n.type).sort());
    expect(outputWire()).toEqual({ nodeId: loop.id, outputKey: 'color' });
    compiles(st().nodes);
  });

  it('off: keeps a node that was changed, with a note saying why', () => {
    const loop = loopOf();
    st().setLoopVolumetric(loop.id, true);
    const g2c = st().nodes.find(n => n.type === 'glowToColor')!;
    st().updateNodeParams(g2c.id, { exposure: 3 });
    st().setLoopVolumetric(loop.id, false);
    const kept = st().nodes.find(n => n.id === g2c.id)!;
    expect(kept).toBeTruthy();
    expect(String(kept.params.__comment)).toMatch(/Kept when Volumetric was turned off/);
    expect(subOf(loopOf()).some(n => n.type === 'volumeGlow')).toBe(false);
    expect(outputWire()).toEqual({ nodeId: loop.id, outputKey: 'color' });
    compiles(st().nodes);
  });

  it('on and off are one undo step each', () => {
    const loop = loopOf();
    const plain = JSON.stringify(st().nodes);
    st().setLoopVolumetric(loop.id, true);
    const vol = JSON.stringify(st().nodes);
    st().setLoopVolumetric(loop.id, false);
    st().undo();
    expect(JSON.stringify(st().nodes)).toBe(vol);
    st().undo();
    expect(JSON.stringify(st().nodes)).toBe(plain);
  });

  it('reuses a glow that is already there (the Volumetric Scene starter)', () => {
    st().replaceGraph(outputOnly());
    st().addNode('volumetricScene', { x: 0, y: 0 });
    const loop = loopOf();
    st().setLoopVolumetric(loop.id, false);
    st().setLoopVolumetric(loop.id, true);
    expect(subOf(loopOf()).filter(n => n.type === 'volumeGlow')).toHaveLength(1);
    expect(st().nodes.filter(n => n.type === 'glowToColor')).toHaveLength(1);
    compiles(st().nodes);
  });
});
