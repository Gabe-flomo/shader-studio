/**
 * Nodes that belong inside a 3D render (docs/groups.md): Scene Pos / Scene
 * Output are offered only inside a Scene Group, Scene Distance only inside a
 * March Loop; graphs that already have them elsewhere still load and compile.
 * A 3D shape added on its own at the top level brings its Scene (camera, Scene
 * Group, loop on the Output) as one undo step; inside a Scene Group it is added
 * as before; Time Cube nodes bring their own setup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { addScopeOf, hiddenHere, offeredHere, SCOPED_TYPES, TOP_LEVEL } from '../../nodes/addScope';
import { HIDDEN_TYPES } from '../../components/NodeGraph/nodeCategoryMeta';
import { creatable } from '../../lang/barAssist';

const st = () => useNodeGraphStore.getState();
const outputOnly = (): GraphNode[] => [
  { id: 'out', type: 'output', position: { x: 900, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} },
];
const subOf = (n: GraphNode | undefined) => (n?.params.subgraph as SubgraphData | undefined)?.nodes ?? [];

beforeEach(() => {
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  st().replaceGraph(outputOnly());
});

describe('Scene Pos / Scene Output only inside a 3D render', () => {
  it('are not offered on the top level, nor inside a plain Group or an Agents group', () => {
    for (const scope of [TOP_LEVEL, { groupType: 'group' }, { groupType: 'agentsGroup' }]) {
      for (const t of ['scenePos', 'sceneOutput', 'marchSceneDist']) expect(offeredHere(t, scope), `${t} in ${scope.groupType}`).toBe(false);
      const hidden = hiddenHere(HIDDEN_TYPES, scope);
      for (const t of SCOPED_TYPES) expect(hidden.has(t)).toBe(true);
    }
    expect(creatable(hiddenHere(new Set(), TOP_LEVEL)).some(c => c.words?.includes('scenePos'))).toBe(false);
  });

  it('inside a Scene Group: Scene Pos is offered, Scene Output only when the group has none', () => {
    st().addNode('sceneGroup', { x: 0, y: 0 });
    const scene = st().nodes.find(n => n.type === 'sceneGroup')!;
    st().enterGroup(scene.id);
    const here = addScopeOf(st().nodes, st().activeGroupPath);
    expect(here).toEqual({ groupType: 'sceneGroup', hasSceneOutput: true });
    expect(offeredHere('scenePos', here)).toBe(true);
    expect(offeredHere('sceneOutput', here)).toBe(false);
    expect(offeredHere('sceneOutput', { groupType: 'sceneGroup', hasSceneOutput: false })).toBe(true);
    expect(offeredHere('marchSceneDist', here)).toBe(false);
    const hidden = hiddenHere(HIDDEN_TYPES, here);
    expect(hidden.has('scenePos')).toBe(false);
    expect(hidden.has('group')).toBe(true); // the rest of the hidden list is untouched
    expect(creatable(hiddenHere(new Set(), here)).some(c => c.words?.includes('scenePos'))).toBe(true);
  });

  it('inside a March Loop: Scene Distance is offered, Scene Pos is not', () => {
    st().addNode('marchLoopGroup', { x: 0, y: 0 });
    const loop = st().nodes.find(n => n.type === 'marchLoopGroup')!;
    st().enterGroup(loop.id);
    const here = addScopeOf(st().nodes, st().activeGroupPath);
    expect(offeredHere('marchSceneDist', here)).toBe(true);
    expect(offeredHere('scenePos', here)).toBe(false);
  });

  it('an old graph with Scene Pos and Scene Output on the top level still loads and compiles', () => {
    const old: GraphNode[] = [
      { id: 'sp', type: 'scenePos', position: { x: 0, y: 0 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
      { id: 'so', type: 'sceneOutput', position: { x: 300, y: 0 }, inputs: { dist: { type: 'float', label: 'Distance' } }, outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
      ...outputOnly(),
    ];
    st().replaceGraph(old);
    expect(st().nodes.map(n => n.type).sort()).toEqual(['output', 'sceneOutput', 'scenePos']);
    const r = compileGraph({ nodes: st().nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  });
});

describe('a 3D shape added on its own creates its Scene', () => {
  it('a Sphere on the top level: camera → Scene Group (the sphere inside) → loop on the Output, placed where it was dropped', () => {
    const id = st().addNode('sphereSDF3D', { x: 1234, y: 567 });
    const scene = st().nodes.find(n => n.id === id)!;
    expect(scene.type).toBe('sceneGroup');
    expect(scene.position).toEqual({ x: 1234, y: 567 });
    expect(subOf(scene).some(n => n.type === 'sphereSDF3D')).toBe(true);
    const loop = st().nodes.find(n => n.type === 'marchLoopGroup')!;
    expect(loop.inputs.scene.connection?.nodeId).toBe(scene.id);
    expect(st().nodes.some(n => n.type === 'marchCamera')).toBe(true);
    expect(st().nodes.find(n => n.type === 'output')!.inputs.color.connection).toEqual({ nodeId: loop.id, outputKey: 'color' });
    expect(compileGraph({ nodes: st().nodes }).success).toBe(true);
  });

  it('is one undo step', () => {
    st().addNode('boxSDF3D', { x: 0, y: 0 });
    expect(st().nodes.length).toBeGreaterThan(3);
    st().undo();
    expect(st().nodes.map(n => n.type)).toEqual(['output']);
  });

  it('inside a Scene Group a shape is added as before (no new scene)', () => {
    st().addNode('sceneGroup', { x: 0, y: 0 });
    const scene = st().nodes.find(n => n.type === 'sceneGroup')!;
    const before = st().nodes.length;
    st().enterGroup(scene.id);
    st().addNode('boxSDF3D', { x: 200, y: 200 });
    st().exitToRoot();
    expect(st().nodes.length).toBe(before);
    expect(st().nodes.filter(n => n.type === 'sceneGroup')).toHaveLength(1);
    expect(subOf(st().nodes.find(n => n.id === scene.id)).some(n => n.type === 'boxSDF3D')).toBe(true);
  });

  it('a Time Cube View brings its own setup, not a Scene Group', () => {
    st().addNode('timeCubeView', { x: 0, y: 0 });
    expect(st().nodes.some(n => n.type === 'sceneGroup')).toBe(false);
  });
});
