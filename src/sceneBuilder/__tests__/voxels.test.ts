/** 3D Scene Builder: Voxels (Quality › Voxels, recipe `quality voxel=…`) builds a March Loop with Voxels on. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parseRecipe, printRecipe } from '../recipe';
import { buildSceneGraph } from '../build';
import { SCENE_TEMPLATES } from '../templates';
import { paramTarget } from '../paramMap';

const orb = () => parseRecipe(SCENE_TEMPLATES.find(t => t.key === 'twisted')!.recipe).spec;

describe('3D Scene Builder: Voxels', () => {
  it('recipe: quality voxel=0.06 reads and writes; off removes it', () => {
    const spec = parseRecipe(`${printRecipe(orb())} · quality voxel=0.06`).spec;
    expect(spec.quality.voxel).toBe(0.06);
    expect(printRecipe(spec)).toContain('voxel=0.06');
    expect(parseRecipe(`${printRecipe(spec)} · quality voxel=off`).spec.quality.voxel).toBeUndefined();
  });

  it('builds the March Loop with Voxels on and its size; without it, no voxel params', () => {
    const on = orb(); on.quality.voxel = 0.1;
    const loop = buildSceneGraph(on).nodes.find(n => n.type === 'marchLoopGroup')!;
    expect(loop.params).toMatchObject({ voxels: true, voxelSize: 0.1 });
    const off = buildSceneGraph(orb()).nodes.find(n => n.type === 'marchLoopGroup')!;
    expect(off.params.voxels).toBeFalsy();
  });

  it('Voxel size is a Play target on the loop', () => {
    expect(paramTarget(orb(), { at: 'quality', key: 'voxel' })).toEqual({ role: 'march', key: 'voxelSize' });
  });
});
