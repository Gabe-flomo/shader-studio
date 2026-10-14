/**
 * March Loop Voxels (docs/march-voxels.md): the ray walks a grid cell by cell (Amanatides & Woo) with a
 * sphere-trace jump through empty space; a cell is solid where the scene is inside at its centre, lit by
 * its face. Off builds exactly as before.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import type { GraphNode } from '../../types/nodeGraph';
import { buildLearn3dExamples } from '../../store/learn3dExamples';
import { getNodeDefinition } from '../../nodes/definitions';

const compile = (nodes: GraphNode[]) => compileGraph({ nodes }) as CompilationResult;

/** The first 3D example with a surface March Loop. */
function scene(): GraphNode[] {
  for (const ex of Object.values(buildLearn3dExamples())) {
    const loop = ex.nodes.find(n => n.type === 'marchLoopGroup' && !n.params.volumetric && !n.params.curvature && (n.params.warpSafety ?? 'off') === 'off');
    if (loop) return ex.nodes;
  }
  throw new Error('no plain 3D example');
}
const withVoxels = (nodes: GraphNode[], on: boolean, size = 0.1) =>
  nodes.map(n => (n.type === 'marchLoopGroup' ? { ...n, params: { ...n.params, voxels: on, voxelSize: size } } : n));

describe('March Loop: Voxels', () => {
  it('is a setting on the loop: Voxels (off by default) and a Voxel size', () => {
    const def = getNodeDefinition('marchLoopGroup')!;
    expect(def.defaultParams).toMatchObject({ voxels: false, voxelSize: 0.08 });
    expect(def.paramDefs!.voxelSize.showWhen).toEqual({ param: 'voxels', value: 'true' });
  });

  it('on: the march walks the grid and lights each cube by its face', () => {
    const r = compile(withVoxels(scene(), true));
    expect(r.errors ?? []).toEqual([]);
    const fs = r.fragmentShader;
    expect(fs).toMatch(/vec3\s+\w+_vtm = /);
    expect(fs).toMatch(/if \(\w+_d < 0\.0\) \{ \w+_hit = 1\.0;/);
    expect(fs).toMatch(/vec3\s+\w+_n\s+= \w+_vn;/);
  });

  it('off: the shader is exactly as before', () => {
    const before = compile(scene()).fragmentShader;
    expect(compile(withVoxels(scene(), false)).fragmentShader).toBe(before);
    expect(before).not.toMatch(/_vtm/);
  });
});
