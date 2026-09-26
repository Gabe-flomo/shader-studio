/**
 * A 3D group added from the palette arrives working: camera → Scene Group
 * (Scene Pos → Sphere → Scene Output) → march loop, loop colour on the Output
 * when it's free. Before this, the Scene Group was empty until opened and the
 * loop called a scene function that didn't exist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { migrateNodeParams } from '../../types/nodeGraph';

const outputOnly = (): GraphNode[] => [
  { id: 'out', type: 'output', position: { x: 900, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} },
];

const subgraphOf = (n: GraphNode | undefined) => n?.params.subgraph as SubgraphData | undefined;

describe('adding a 3D group from the palette', () => {
  beforeEach(() => {
    useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
    useNodeGraphStore.getState().replaceGraph(outputOnly());
  });

  for (const type of ['marchLoopGroup', 'giLitMarchGroup', 'marchCamera', 'sceneGroup']) {
    it(`${type}: a sphere scene that compiles, with the loop colour on the Output`, () => {
      useNodeGraphStore.getState().addNode(type, { x: 0, y: 0 });
      const nodes = useNodeGraphStore.getState().nodes;

      const scene = nodes.find(n => n.type === 'sceneGroup');
      const inner = subgraphOf(scene)!.nodes;
      const pos = inner.find(n => n.type === 'scenePos')!;
      const sphere = inner.find(n => n.type === 'sphereSDF3D')!;
      const out = inner.find(n => n.type === 'sceneOutput')!;
      expect(sphere.inputs.pos.connection).toEqual({ nodeId: pos.id, outputKey: 'pos' });
      expect(out.inputs.dist.connection).toEqual({ nodeId: sphere.id, outputKey: 'dist' });
      // Required parts: stamped so they can't be deleted.
      expect(pos.params._groupOriginal).toBe(true);
      expect(out.params._groupOriginal).toBe(true);

      const loop = nodes.find(n => n.type === 'marchLoopGroup' || n.type === 'giLitMarchGroup')!;
      expect(loop.type).toBe(type === 'giLitMarchGroup' ? 'giLitMarchGroup' : 'marchLoopGroup');
      expect(loop.inputs.scene.connection).toEqual({ nodeId: scene!.id, outputKey: 'scene' });
      expect(subgraphOf(loop)!.nodes.map(n => n.type).sort()).toEqual(['marchLoopInputs', 'marchLoopOutput']);
      const camera = nodes.find(n => n.type === 'marchCamera')!;
      expect(loop.inputs.ro.connection?.nodeId).toBe(camera.id);
      expect(nodes.find(n => n.type === 'output')!.inputs.color.connection).toEqual({ nodeId: loop.id, outputKey: 'color' });

      const r = compileGraph({ nodes });
      expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
      expect(r.fragmentShader).not.toMatch(/MISSING_SCENE/);
      expect(r.fragmentShader).toMatch(/sdf3d_sphere\(p, /);
    });
  }

  it('Volumetric Scene: a volumetric loop with Scene Distance → Volume Glow (+=) → Glow to Color → Output', () => {
    useNodeGraphStore.getState().addNode('volumetricScene', { x: 0, y: 0 });
    const nodes = useNodeGraphStore.getState().nodes;
    expect(nodes.some(n => n.type === 'volumetricScene')).toBe(false);
    const loop = nodes.find(n => n.type === 'marchLoopGroup')!;
    expect(loop.params.volumetric).toBe(true);
    const body = subgraphOf(loop)!.nodes;
    const glow = body.find(n => n.type === 'volumeGlow')!;
    expect(glow.assignOp).toBe('+=');
    expect(glow.inputs.dist.connection?.nodeId).toBe(body.find(n => n.type === 'marchSceneDist')!.id);
    const colour = nodes.find(n => n.type === 'glowToColor')!;
    expect(colour.inputs.glow.connection).toEqual({ nodeId: loop.id, outputKey: 'acc0' });
    expect(nodes.find(n => n.type === 'output')!.inputs.color.connection).toEqual({ nodeId: colour.id, outputKey: 'color' });

    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).not.toMatch(/MISSING_SCENE/);
    // The glow accumulator is declared before the loop and read by Glow to Color.
    const acc = r.fragmentShader.match(/float (\w+) = 0\.0;\n[\s\S]*?for \(int/)?.[1];
    expect(acc).toBeTruthy();
    expect(r.fragmentShader).toMatch(new RegExp(`tanh\\(clamp\\(${acc} \\*`));
  });

  it('leaves a wired Output alone', () => {
    const st = useNodeGraphStore.getState();
    st.addNode('marchLoopGroup', { x: 0, y: 0 });
    const firstLoop = useNodeGraphStore.getState().nodes.find(n => n.type === 'marchLoopGroup')!;
    st.addNode('giLitMarchGroup', { x: 0, y: 600 });
    expect(useNodeGraphStore.getState().nodes.find(n => n.type === 'output')!.inputs.color.connection?.nodeId).toBe(firstLoop.id);
  });

  it('a Scene Group added next to a loop with a free Scene input goes into that loop', () => {
    const st = useNodeGraphStore.getState();
    st.addNode('marchLoopGroup', { x: 0, y: 0 });
    const loop = useNodeGraphStore.getState().nodes.find(n => n.type === 'marchLoopGroup')!;
    st.disconnectInput(loop.id, 'scene');
    st.addNode('sceneGroup', { x: 0, y: 300 });
    const nodes = useNodeGraphStore.getState().nodes;
    expect(nodes.filter(n => n.type === 'marchLoopGroup')).toHaveLength(1);
    const groups = nodes.filter(n => n.type === 'sceneGroup');
    expect(nodes.find(n => n.id === loop.id)!.inputs.scene.connection?.nodeId).toBe(groups[groups.length - 1].id);
  });
});

describe('March Loop colours', () => {
  it('folds the old per-channel Background / Albedo floats into the colour params', () => {
    const def = getNodeDefinition('marchLoopGroup')!;
    const saved: GraphNode = {
      id: 'mlg', type: 'marchLoopGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {},
      params: { maxSteps: 64, bgR: 0.1, bgG: 0.2, bgB: 0.3, albedoR: 0.4, albedoG: 0.5, albedoB: 0.6 },
    };
    const migrated = migrateNodeParams(saved, getNodeDefinition);
    expect(migrated.params.bg).toEqual([0.1, 0.2, 0.3]);
    expect(migrated.params.albedo).toEqual([0.4, 0.5, 0.6]);
    expect(migrated.params).not.toHaveProperty('bgR');
    expect(migrated.params).not.toHaveProperty('albedoB');
    expect(migrated.params._schemaVersion).toBe(def.version);
    // The colour sockets are added to older saves too.
    expect(migrated.inputs.bg?.type).toBe('vec3');
    expect(migrated.inputs.albedo?.type).toBe('vec3');
  });

  it('GI Lit keeps its own albedo default for a channel an old save never had', () => {
    const migrated = migrateNodeParams({ id: 'gi', type: 'giLitMarchGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { bgR: 0.5 } }, getNodeDefinition);
    expect(migrated.params.bg).toEqual([0.5, 0, 0]);
    expect(migrated.params.albedo).toBeUndefined();
  });

  it('a wire into Background or Albedo overrides the colour; old and new params compile the same', () => {
    useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
    useNodeGraphStore.getState().replaceGraph(outputOnly());
    useNodeGraphStore.getState().addNode('marchLoopGroup', { x: 0, y: 0 });
    const nodes = useNodeGraphStore.getState().nodes;
    const withLoopParams = (params: Record<string, unknown>) => nodes.map(n => n.type === 'marchLoopGroup' ? { ...n, params: { ...n.params, bg: undefined, albedo: undefined, ...params } } : n);

    const legacy = compileGraph({ nodes: withLoopParams({ bgR: 0.1, bgG: 0.2, bgB: 0.3 }) });
    const colour = compileGraph({ nodes: withLoopParams({ bg: [0.1, 0.2, 0.3] }) });
    expect(colour.fragmentShader).toMatch(/_bg\s+= vec3\(0\.1, 0\.2, 0\.3\);/);
    expect(legacy.fragmentShader).toBe(colour.fragmentShader);

    const loopId = nodes.find(n => n.type === 'marchLoopGroup')!.id;
    const camId = nodes.find(n => n.type === 'marchCamera')!.id;
    const wired = nodes.map(n => n.id === loopId ? { ...n, inputs: { ...n.inputs, bg: { ...n.inputs.bg, connection: { nodeId: camId, outputKey: 'rd' } } } } : n);
    const r = compileGraph({ nodes: wired });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/_bg\s+= \w+_rd;/);
  });
});
