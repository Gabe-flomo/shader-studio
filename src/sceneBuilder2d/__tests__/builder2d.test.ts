import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useSceneBuilder2D } from '../store';
import { buildFromBuilder2D, editScene2DInBuilder, openNewSceneBuilder2D } from '../actions';
import { templateScene } from '../templates';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildSceneBuilder2DExamples } from '../../store/sceneBuilder2dExamples';
import { find2dBuild } from '../apply';

describe('the 2D Scene Builder window', () => {
  it('opens on a starter scene, edits with undo, builds into the graph, and opens again on the build', () => {
    openNewSceneBuilder2D();
    const sb = useSceneBuilder2D.getState();
    expect(sb.open).toBe(true);
    expect(sb.scene.layers).toHaveLength(1);
    sb.edit(d => { d.layers[0].scale = 2; });
    expect(useSceneBuilder2D.getState().scene.layers[0].scale).toBe(2);
    useSceneBuilder2D.getState().undo();
    expect(useSceneBuilder2D.getState().scene.layers[0].scale).toBe(1);

    useSceneBuilder2D.getState().replace(templateScene('orbits'));
    expect(buildFromBuilder2D()).toBe(true);
    const nodes = useNodeGraphStore.getState().nodes;
    expect(compileGraph({ nodes }).success).toBe(true);
    const sceneId = useSceneBuilder2D.getState().targetSceneId!;
    expect(find2dBuild(nodes, sceneId)).not.toBeNull();
    const out = nodes.find(n => n.type === 'output')!;
    expect(out.inputs.color.connection).toBeTruthy();

    useSceneBuilder2D.getState().close();
    expect(editScene2DInBuilder(sceneId)).toBe(true);
    expect(useSceneBuilder2D.getState().open).toBe(true);
    expect(useSceneBuilder2D.getState().scene.layers.length).toBe(templateScene('orbits').layers.length);
  });

  it('builds the 2D: Scene Builder examples, each editable in the builder', () => {
    const ex = buildSceneBuilder2DExamples();
    expect(Object.keys(ex)).toHaveLength(3);
    for (const [k, g] of Object.entries(ex)) {
      expect(compileGraph({ nodes: g.nodes }).success, k).toBe(true);
      const uv = g.nodes.find(n => n.params.sceneBuilder2D);
      expect(uv, k).toBeTruthy();
    }
  });
});
