/**
 * A picture with depth in the 3D Scene Builder (docs/scene-builder-3d.md, "A picture with depth"): the three choices
 * (in the picture, lit, reflected) build the same wiring as the March Loop card's "Add a picture with depth" and
 * compile, in Surface and GI lit; other modes leave it out with a warning; the recipe clause round-trips; Build keeps
 * the spec and a generated depth goes onto the Depth node. No model runs.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandaloneGraph } from '../build';
import { applyScene, findBuild } from '../apply';
import { parseRecipe, printRecipe } from '../recipe';
import { canonicalSpec, texturesUsed3D } from '../spec';
import { textureNodeFor } from '../../builders/textures';
import type { DepthBakeInfo } from '../../nodes/definitions/depth';

const PIC = 'texture pond node=pic1 aspect=1.5';

function build(recipe: string) {
  const r0 = parseRecipe(recipe);
  expect(r0.errors).toEqual([]);
  const g = buildStandaloneGraph(r0.spec);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return { spec: r0.spec, g, r };
}

describe('3D Scene Builder: a picture with depth', () => {
  it.each(['surface', 'gi'])('in the picture (%s): Depth Composite of the picture and the lit scene, by the loop\'s Distance and Hit', mode => {
    const { g, spec } = build(`${mode} · ${PIC} · sphere r=0.6 · depth-picture pond`);
    expect(g.warnings).toEqual([]);
    expect(texturesUsed3D(spec)).toContain('pond');
    const depth = g.nodes.find(n => n.type === 'depth')!;
    expect(depth.inputs.texture.connection).toEqual({ nodeId: 'pic1', outputKey: 'texture' });
    const comp = g.nodes.find(n => n.type === 'depthComposite')!;
    const loop = g.nodes.find(n => n.type === 'marchLoopGroup' || n.type === 'giLitMarchGroup')!;
    expect(comp.inputs.dist.connection).toEqual({ nodeId: loop.id, outputKey: 'dist' });
    expect(comp.inputs.hit.connection).toEqual({ nodeId: loop.id, outputKey: 'hit' });
    expect(comp.inputs.picture.connection).toEqual({ nodeId: 'pic1', outputKey: 'color' });
    // The tone map reads the composite
    const tone = g.nodes.find(n => n.type === 'toneMap')!;
    expect(tone.inputs.color.connection?.nodeId).toBe(comp.id);
  });

  it('…lit by the scene: a Depth Light with the scene as its Glowing scene and Shadows from, only on the picture', () => {
    const { g } = build(`surface · ${PIC} · sphere r=0.6 · depth-picture pond how=lit near=2 far=10`);
    const light = g.nodes.find(n => n.type === 'depthLight')!;
    const scene = g.nodes.find(n => n.type === 'sceneGroup')!;
    expect(light.inputs.glow.connection).toEqual({ nodeId: scene.id, outputKey: 'scene' });
    expect(light.inputs.occluders.connection).toEqual({ nodeId: scene.id, outputKey: 'scene' });
    expect(light.params).toMatchObject({ nearD: 2, farD: 10 });
    expect(g.nodes.find(n => n.id === light.inputs.mask.connection!.nodeId)!.params.result).toBe('1.0 - front');
  });

  it('…lit, and reflected: Picture Environment, mirrored at the loop\'s normal, before the composite', () => {
    const { g } = build(`surface · ${PIC} · box size=0.5 · depth-picture pond how=reflect`);
    const env = g.nodes.find(n => n.type === 'pictureEnvironment' && n.params._sbRole === 'depth:env')!;
    expect(env.inputs.picture.connection).toEqual({ nodeId: 'pic1', outputKey: 'texture' });
    const comp = g.nodes.find(n => n.type === 'depthComposite')!;
    expect(g.nodes.find(n => n.id === comp.inputs.scene.connection!.nodeId)!.params._sbRole).toBe('depth:reflect');
    expect(g.nodes.some(n => n.type === 'depthLight')).toBe(true);
  });

  it.each(['volumetric', 'glass'])('%s mode leaves it out, with a warning', mode => {
    const { g } = build(`${mode} · ${PIC} · sphere r=0.6 · depth-picture pond`);
    expect(g.nodes.some(n => n.type === 'depthComposite')).toBe(false);
    expect(g.warnings.join(' ')).toMatch(/needs Surface or GI lit/);
  });

  it('the recipe clause round-trips', () => {
    const { spec } = build(`surface · ${PIC} · sphere · depth-picture pond how=lit near=2.5 far=12 soft=0.2`);
    const text = printRecipe(spec);
    expect(text).toMatch(/depth-picture pond how=lit near=2\.5 far=12 soft=0\.2/);
    const back = parseRecipe(text);
    expect(back.errors).toEqual([]);
    expect(canonicalSpec(back.spec).depth).toEqual(canonicalSpec(spec).depth);
    expect(parseRecipe('sphere · depth-picture pond how=sideways').errors[0].message).toMatch(/how=composite\|lit\|reflect/);
  });

  it('spec → graph → spec, and a generated depth goes onto the Depth node', () => {
    const bake: DepthBakeInfo = { kind: 'image', libraryId: 'img_d', model: 'm', side: 518, width: 518, height: 345, fps: 0, frames: 1, duration: 0, smoothing: 0, bytes: 1, bakedAt: 1, source: 'pond' };
    const spec = parseRecipe(`surface · ${PIC} · sphere r=0.6 · depth-picture pond how=lit`).spec;
    spec.depth!.bake = bake;
    let i = 0;
    const res = applyScene([textureNodeFor({ name: 'pond', node: 'pic1', aspect: 1.5 }, 'pic1')], spec, { nextId: () => `n${++i}`, at: { x: 0, y: 0 } });
    const found = findBuild(res.nodes, res.sceneId)!;
    expect(found.meta.spec.depth).toEqual(spec.depth);
    const depth = res.nodes.find(n => n.type === 'depth')!;
    expect(depth.params).toMatchObject({ update: 'baked', depthBake: bake });
    expect(compileGraph({ nodes: res.nodes }).success).toBe(true);
  });
});
