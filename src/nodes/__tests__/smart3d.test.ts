import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../definitions';
import { planSmart3DAdd } from '../smart3d';

const n = (id: string, type: string, x = 0, extra: Partial<GraphNode> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  return { id, type, position: { x, y: 0 }, inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { ...s }])), outputs: { ...def.outputs }, params: {}, ...extra };
};

describe('planSmart3DAdd', () => {
  it('wraps a primitive in a scene group and spawns a march loop when there is none', () => {
    const output = n('out', 'output');
    const plan = planSmart3DAdd('sphereSDF3D', getNodeDefinition('sphereSDF3D')!, [n('uv', 'uv'), output], { x: 0, y: 0 });
    expect(plan).toEqual({ kind: 'wrap-scene', posInput: 'pos', distOutput: 'dist', attachToMarchId: null, spawnMarch: true, outputNodeId: 'out' });
  });

  it('attaches to the nearest march loop with a free Scene input instead of spawning one', () => {
    const far = n('far', 'marchLoopGroup', 2000);
    const near = n('near', 'marchLoopGroup', 100);
    const busy = n('busy', 'marchLoopGroup', 10);
    busy.inputs.scene.connection = { nodeId: 'sg', outputKey: 'scene' };
    const plan = planSmart3DAdd('boxSDF3D', getNodeDefinition('boxSDF3D')!, [far, near, busy], { x: 0, y: 0 });
    expect(plan).toMatchObject({ kind: 'wrap-scene', attachToMarchId: 'near', spawnMarch: false, outputNodeId: null });
  });

  it('a 3D transform gets Scene Pos but no Scene Output wire', () => {
    const plan = planSmart3DAdd('translate3D', getNodeDefinition('translate3D')!, [], { x: 0, y: 0 });
    expect(plan).toMatchObject({ kind: 'wrap-scene', posInput: 'pos', distOutput: null });
  });

  it('wires a lighting node to the march loop by socket name, plus its scene and camera', () => {
    const cam = n('cam', 'marchCamera', -400);
    const sg = n('sg', 'sceneGroup', -200);
    const mlg = n('mlg', 'marchLoopGroup', 0);
    mlg.inputs.scene.connection = { nodeId: 'sg', outputKey: 'scene' };
    const plan = planSmart3DAdd('sdfAo', getNodeDefinition('sdfAo')!, [cam, sg, mlg], { x: 300, y: 0 });
    expect(plan.kind).toBe('wire-lighting');
    if (plan.kind !== 'wire-lighting') return;
    expect(plan.marchId).toBe('mlg');
    expect(plan.wires).toEqual(expect.arrayContaining([{ input: 'pos', fromKey: 'pos' }, { input: 'normal', fromKey: 'normal' }, { input: 'hit', fromKey: 'hit' }]));
    expect(plan.sceneSourceId).toBe('sg');
    expect(plan.cameraId).toBe('cam');
  });

  it('does nothing for lighting with no loop, or for 2D nodes and the groups themselves', () => {
    expect(planSmart3DAdd('sdfAo', getNodeDefinition('sdfAo')!, [], { x: 0, y: 0 })).toEqual({ kind: 'none' });
    expect(planSmart3DAdd('circleSDF', getNodeDefinition('circleSDF')!, [], { x: 0, y: 0 })).toEqual({ kind: 'none' });
    expect(planSmart3DAdd('sceneGroup', getNodeDefinition('sceneGroup')!, [], { x: 0, y: 0 })).toEqual({ kind: 'none' });
  });
});
