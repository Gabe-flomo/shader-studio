/**
 * The depth preview switch (builders/depthPreview.ts, docs/depth-mix.md "Seeing the depth"): every view of the 2D
 * Scene Builder's picture with depth and of the 3D Scene Builder's compiles, reads the same Depth node as the build,
 * and Shaped depth goes through the range and curve (2D) or Nearest / Farthest (3D).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { emptyScene, newShape, type Scene2D } from '../../sceneBuilder2d/spec';
import { DEFAULT_GRADIENT, newDepthPic, type DepthPic2D } from '../../sceneBuilder2d/depth';
import { buildStandaloneGraph } from '../../sceneBuilder/build';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { DEPTH_VIEWS, depthViewsFor, withDepthView, type DepthView } from '../depthPreview';
import type { GraphNode } from '../../types/nodeGraph';

function scene(d: Partial<DepthPic2D> = {}): Scene2D {
  const s = emptyScene();
  s.textures = [{ name: 'pond', node: 'pic1', aspect: 1.5, kind: 'image' }];
  s.layers.push(newShape('circle', 's1', { glow: true, size: { r: 0.2 } }));
  s.depth = newDepthPic('pond', d);
  return s;
}

function compiles(nodes: GraphNode[]) {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return r;
}

const fed = (nodes: GraphNode[], outputId: string) => {
  const out = nodes.find(n => n.id === outputId)!;
  return nodes.find(n => n.id === out.inputs.color.connection!.nodeId)!;
};

describe('the depth preview switch', () => {
  it('offers the four views, then the depth-only effects that are on', () => {
    expect(depthViewsFor()).toEqual(['result', 'picture', 'depth', 'shaped']);
    expect(depthViewsFor({ gradient: true, space: true })).toEqual(['result', 'picture', 'depth', 'shaped', 'gradient', 'space']);
  });

  const all: Partial<DepthPic2D> = { size: { on: true, far: 0.3, near: 2 }, space: { on: true, style: 'shift', amount: 0.2, dir: 0, focus: 0 }, gradient: { ...DEFAULT_GRADIENT } };
  it.each([...DEPTH_VIEWS, 'gradient', 'size', 'space'] as DepthView[])('2D: %s compiles, from the build\'s own Depth node', view => {
    const g = buildStandalone2D(scene(all));
    for (const heat of [false, true]) {
      const nodes = withDepthView(g.nodes, g.outputId, view, { heat })!;
      expect(nodes).not.toBeNull();
      compiles(nodes);
      if (view === 'result') { expect(fed(nodes, g.outputId).id).toBe(g.final.nodeId); continue; }
      const block = fed(nodes, g.outputId);
      expect(block.type).toBe('exprNode');
      // Only the preview's block is new: the build's nodes (its Depth node, its depth texture) are the same.
      expect(nodes.length).toBe(g.nodes.length + 1);
      expect(nodes.filter(n => n.type === 'depth').map(n => n.id)).toEqual(g.nodes.filter(n => n.type === 'depth').map(n => n.id));
      if (view === 'depth') expect(block.inputs.depth.connection).toEqual({ nodeId: g.nodes.find(n => n.type === 'depth')!.id, outputKey: 'depth' });
      if (heat && (view === 'depth' || view === 'shaped' || view === 'size')) expect(String(block.params.result)).toMatch(/abs\(4\.0/);
    }
  });

  it('2D Shaped depth is the Depth Mix\'s depth after the range and curve', () => {
    const g = buildStandalone2D(scene({ range: [0.2, 0.8], curve: 2.5 }));
    const nodes = withDepthView(g.nodes, g.outputId, 'shaped')!;
    const block = fed(nodes, g.outputId);
    const mix = nodes.find(n => n.id === block.inputs.shaped.connection!.nodeId)!;
    expect(block.inputs.shaped.connection!.outputKey).toBe('depth');
    expect(mix.params).toMatchObject({ farEnd: 0.2, nearEnd: 0.8, curve: 2.5 });
    expect(mix.inputs.depth.connection!.nodeId).toBe(nodes.find(n => n.type === 'depth')!.id);
    const r = compiles(nodes);
    // The range and curve are live uniforms the preview carries.
    const u = Object.values(r.paramUniforms as Record<string, unknown>);
    expect(u).toEqual(expect.arrayContaining([0.2, 0.8, 2.5]));
  });

  it('2D: a view whose effect is off has nothing to show', () => {
    const g = buildStandalone2D(scene());
    expect(withDepthView(g.nodes, g.outputId, 'gradient')).toBeNull();
    expect(withDepthView(g.nodes, g.outputId, 'size')).toBeNull();
    const plain = emptyScene();
    const p = buildStandalone2D(plain);
    expect(withDepthView(p.nodes, p.outputId, 'depth')).toBeNull();
  });

  it.each(DEPTH_VIEWS)('3D: %s compiles; Shaped depth goes through Nearest / Farthest', view => {
    const r0 = parseRecipe('surface · texture pond node=pic1 aspect=1.5 · sphere r=0.6 · depth-picture pond near=2 far=10');
    expect(r0.errors).toEqual([]);
    const g = buildStandaloneGraph(r0.spec);
    const nodes = withDepthView(g.nodes, g.outputId, view, { heat: view === 'depth' })!;
    expect(nodes).not.toBeNull();
    compiles(nodes);
    if (view === 'shaped') {
      const block = fed(nodes, g.outputId);
      const comp = nodes.find(n => n.type === 'depthComposite')!;
      expect(block.inputs.dist.connection).toEqual({ nodeId: comp.id, outputKey: 'pictureDist' });
      expect(String(block.params.result)).toContain('(dist - 2.0) / max(10.0 - 2.0');
    }
    if (view === 'picture') expect(fed(nodes, g.outputId).inputs.picture.connection).toEqual({ nodeId: 'pic1', outputKey: 'color' });
  });
});
