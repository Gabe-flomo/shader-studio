import { describe, it, expect } from 'vitest';
import { getNodeDefinition } from '../definitions';
import { planSmart3DAdd } from '../smart3d';
import { addToScene, buildSceneSubgraphFor, sceneRole } from '../scene3dShapes';
import { instantiateNode } from '../scene3dDefaults';
import type { GraphNode } from '../../types/nodeGraph';

let n = 0;
const nextId = () => `t${++n}`;
const make = (type: string) => instantiateNode(nextId(), type, getNodeDefinition(type)!, { x: 0, y: 0 });
const types = (nodes: GraphNode[]) => nodes.map(x => x.type);
const feeds = (nodes: GraphNode[], to: GraphNode, key: string) => nodes.find(x => x.id === to.inputs[key]?.connection?.nodeId)?.type;

describe('4D nodes build their own scene', () => {
  it('plans a new scene (camera + loop) for 4D shapes and transforms, not for Noise 4D', () => {
    for (const t of ['hypersphereSDF', 'tesseractSDF', 'rotate4D', 'lift4D', 'wireframe4D', 'stereo4D']) {
      const plan = planSmart3DAdd(t, getNodeDefinition(t)!, [], { x: 0, y: 0 });
      expect(plan.kind, t).toBe('wrap-scene');
      if (plan.kind === 'wrap-scene') expect(plan.spawnMarch).toBe(true);
    }
    expect(planSmart3DAdd('noise4D', getNodeDefinition('noise4D')!, [], { x: 0, y: 0 }).kind).toBe('none');
  });

  it('a 4D shape gets Scene Pos → Lift to 4D → shape → Scene Output', () => {
    const shape = make('duocylinderSDF');
    const sub = buildSceneSubgraphFor(nextId, shape, sceneRole(getNodeDefinition('duocylinderSDF')!)!);
    expect(types(sub.nodes)).toEqual(['scenePos', 'lift4D', 'duocylinderSDF', 'sceneOutput']);
    const out = sub.nodes.find(x => x.type === 'sceneOutput')!;
    expect(feeds(sub.nodes, out, 'dist')).toBe('duocylinderSDF');
    expect(feeds(sub.nodes, shape, 'p4')).toBe('lift4D');
  });

  it('a 4D transform gets a Lift before it and a Tesseract after it', () => {
    const rot = make('rotate4D');
    const sub = buildSceneSubgraphFor(nextId, rot, sceneRole(getNodeDefinition('rotate4D')!)!);
    expect(types(sub.nodes)).toEqual(['scenePos', 'lift4D', 'rotate4D', 'tesseractSDF', 'sceneOutput']);
  });

  it('Stereographic 4D gets Hopf Circles and the distance fix', () => {
    const st = make('stereo4D');
    const sub = buildSceneSubgraphFor(nextId, st, sceneRole(getNodeDefinition('stereo4D')!)!);
    expect(types(sub.nodes)).toEqual(['scenePos', 'stereo4D', 'hopfCirclesSDF', 'stereoDist4D', 'sceneOutput']);
  });

  it('a second 4D shape joins the existing Lift (one W) beside the first, with a Union', () => {
    const first = buildSceneSubgraphFor(nextId, make('hypersphereSDF'), sceneRole(getNodeDefinition('hypersphereSDF')!)!);
    const second = make('tesseractSDF');
    const placed = addToScene(nextId, first, second, sceneRole(getNodeDefinition('tesseractSDF')!)!, { byHand: false })!;
    const t = types(placed.subgraph.nodes);
    expect(t.filter(x => x === 'lift4D')).toHaveLength(1);
    expect(t).toContain('translate4D');
    expect(t).toContain('sdfUnion');
    expect(feeds(placed.subgraph.nodes, second, 'p4')).toBe('translate4D');
  });

  it('inside a group by hand, a 4D shape is wired from the Lift without moving it', () => {
    const first = buildSceneSubgraphFor(nextId, make('hypersphereSDF'), sceneRole(getNodeDefinition('hypersphereSDF')!)!);
    const second = make('cell24SDF');
    const placed = addToScene(nextId, first, second, sceneRole(getNodeDefinition('cell24SDF')!)!, { byHand: true })!;
    expect(feeds(placed.subgraph.nodes, second, 'p4')).toBe('lift4D');
    expect(types(placed.subgraph.nodes)).not.toContain('translate4D');
  });
});
