/**
 * Depth in 3D scenes (nodes/definitions/depthScene.ts): the picture's distance from its nearness, and
 * Depth Composite / Depth Light compiling into a real ray-marched scene beside a Depth node.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import { getNodeDefinition, resolveNodeAliases } from '..';
import { depthSceneDist } from '../depthScene';
import type { GraphNode } from '../../../types/nodeGraph';

/** The 3D example plus a picture, its depth, and the two nodes, into the Output. */
function sceneWithPicture(show = 'composite'): GraphNode[] {
  const base = resolveNodeAliases(EXAMPLE_GRAPHS.shapesAndGround3D.nodes, getNodeDefinition).filter(x => x.type !== 'output');
  const loop = base.find(x => x.type === 'marchLoopGroup')!;
  const cam = base.find(x => x.type === 'marchCamera')!;
  return [
    ...base,
    n('textureInput', 'pic', 0, 0),
    n('depth', 'dep', 0, 0, {}, { texture: ['pic', 'texture'] }),
    n('depthComposite', 'comp', 0, 0, { show }, { picture: ['pic', 'color'], nearness: ['dep', 'depth'], scene: [loop.id, 'color'], dist: [loop.id, 'dist'], hit: [loop.id, 'hit'] }),
    n('depthLight', 'lit', 0, 0, {}, { picture: ['comp', 'color'], nearness: ['dep', 'depth'], ro: [cam.id, 'ro'], rd: [cam.id, 'rd'] }),
    n('output', 'out', 0, 0, {}, { color: ['lit', 'color'] }),
  ];
}

describe('Depth in 3D scenes', () => {
  it('nearness 1 is Nearest, 0 is Farthest, halfway is halfway in 1/distance', () => {
    expect(depthSceneDist(1, 1.5, 8)).toBeCloseTo(1.5);
    expect(depthSceneDist(0, 1.5, 8)).toBeCloseTo(8);
    expect(depthSceneDist(0.5, 2, 6)).toBeCloseTo(1 / ((1 / 2 + 1 / 6) / 2));
    // Out of range nearness is held to the ends
    expect(depthSceneDist(2, 1.5, 8)).toBeCloseTo(1.5);
    expect(depthSceneDist(-1, 1.5, 8)).toBeCloseTo(8);
  });

  it.each(['composite', 'distances', 'front'])('Depth Composite (Show: %s) and Depth Light compile into a ray-marched scene', show => {
    const r = compileGraph({ nodes: sceneWithPicture(show) });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    // The shared helper appears once, however many nodes use it
    expect(r.fragmentShader.match(/float depthSceneDist\(/g)?.length).toBe(1);
    expect(r.fragmentShader).toMatch(/dFdx\(/);
  });

  it('the scene wins where it is nearer than the picture, and only where it hit something', () => {
    const def = getNodeDefinition('depthComposite')!;
    const g = def.generateGLSL(n('depthComposite', 'c', 0, 0), { picture: 'P', nearness: 'N', scene: 'S', dist: 'D', hit: 'H' } as Record<string, string>);
    expect(g.code).toMatch(/clamp\(H, 0\.0, 1\.0\) \* smoothstep/);
    expect(g.code).toMatch(/mix\(P, S, c_front\)/);
  });
});
