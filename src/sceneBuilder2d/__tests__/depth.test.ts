/**
 * A picture with depth in the 2D Scene Builder (sceneBuilder2d/depth.ts, docs/depth-mix.md): every look and both shape
 * responses build and compile, the recipe clause round-trips, Build / Edit this one keep the spec, Generate depth's
 * bake goes onto the Depth node, and the two examples compile. No model runs: the Depth node's texture is a sampler
 * the compile leaves to the app (a synthetic depth stands in where values are checked).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { applyScene2D, find2dBuild } from '../apply';
import { canonicalScene, emptyScene, newShape, texturesUsed2D, type Scene2D } from '../spec';
import { DEPTH_LOOKS, DEPTH_PALETTES, newDepthPic, depthMixParams, type DepthPic2D } from '../depth';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import { templateScene } from '../templates';
import { textureNodeFor, type TexSource } from '../../builders/textures';
import { buildSceneBuilder2DExamples } from '../../store/sceneBuilder2dExamples';
import { depthMixShape, depthMixFront } from '../../nodes/definitions/depthMix';
import type { DepthBakeInfo } from '../../nodes/definitions/depth';

const PIC: TexSource = { name: 'pond', node: 'pic1', aspect: 1.5, kind: 'image' };

function scene(d: Partial<DepthPic2D> = {}): Scene2D {
  const s = emptyScene();
  s.textures = [{ ...PIC }];
  s.layers.push(newShape('circle', 's1', { glow: true, size: { r: 0.2 }, motion: [{ id: 'm1', kind: 'pulse', speed: 0.5, amount: 0.2, phase: 0, dir: 0 }] }));
  s.layers.push(newShape('ring', 's2', { at: [0.4, 0.1] }));
  s.look.glow.mode = 'all';
  s.depth = newDepthPic('pond', d);
  return s;
}

function compiles(sc: Scene2D) {
  const built = buildStandalone2D(sc);
  const r = compileGraph({ nodes: built.nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  expect(() => parser.parse(r.fragmentShader, { quiet: true })).not.toThrow();
  return { ...built, r };
}

const BAKE: DepthBakeInfo = { kind: 'image', libraryId: 'img_depth1', model: 'depth-anything-v2-small', side: 518, width: 518, height: 345, fps: 0, frames: 1, duration: 0, smoothing: 0, bytes: 1234, bakedAt: 1, source: 'pond' };

describe('2D Scene Builder: a picture with depth', () => {
  it('builds the picture, its Depth node (reading the picture\'s fit) and a Depth Mix on the Output', () => {
    const { nodes, warnings, final, r } = compiles(scene());
    expect(warnings).toEqual([]);
    const depth = nodes.find(n => n.type === 'depth')!;
    expect(depth.inputs.texture.connection).toEqual({ nodeId: 'pic1', outputKey: 'texture' });
    const fit = nodes.find(n => n.params._sbRole === 'depth:pic:fit')!;
    expect(depth.inputs.uv.connection?.nodeId).toBe(fit.id);
    const mix = nodes.find(n => n.params._sbRole === 'depth:mix')!;
    expect(final).toEqual({ nodeId: mix.id, outputKey: 'color' });
    expect(mix.inputs.depth.connection).toEqual({ nodeId: depth.id, outputKey: 'depth' });
    // The picture and the depth texture are both samplers the app binds
    expect(Object.values(r.textureUniforms)).toEqual(expect.arrayContaining(['pic1', depth.id]));
    expect(texturesUsed2D(scene())).toEqual(['pond']);
  });

  it.each(DEPTH_LOOKS)('look %s compiles, with size and space by depth on', look => {
    const { nodes } = compiles(scene({ look, size: { on: true, far: 0.3, near: 1.7 }, space: { on: true, style: 'shift', amount: 0.3, dir: 45, focus: 0.2 } }));
    expect(nodes.find(n => n.params._sbRole === 'depth:mix')!.params.mode).toBe({ top: 'size', occlude: 'occlude', fog: 'fog', mix: 'mix', light: 'light' }[look]);
  });

  it.each(['add', 'screen', 'over', 'tint'] as const)('With the picture: %s compiles (Over wires a Scene mask)', w => {
    const { nodes } = compiles(scene({ look: 'occlude', with: w }));
    const mix = nodes.find(n => n.params._sbRole === 'depth:mix')!;
    expect(!!mix.inputs.coverage.connection).toBe(w === 'over');
  });

  it('depth → size grows every top-level layer through its Transform\'s Grow (times a pulse)', () => {
    const { nodes } = compiles(scene({ size: { on: true, far: 0.4, near: 1.6 } }));
    const shapes = nodes.find(n => n.params._sbRole === 'depth:shapes')!;
    expect(shapes.params.mode).toBe('size');
    const ring = nodes.find(n => n.params._sbRole === 's2:place')!;
    expect(ring.inputs.grow.connection).toEqual({ nodeId: shapes.id, outputKey: 'scale' });
    // The circle pulses too: its Grow is the pulse times the depth's scale
    const circle = nodes.find(n => n.params._sbRole === 's1:place')!;
    const both = nodes.find(n => n.id === circle.inputs.grow.connection!.nodeId)!;
    expect(both.params._sbRole).toBe('s1:depthgrow');
    // Its distance is put back in the picture's units by the Transform's Scale
    expect(nodes.some(n => n.params._sbRole === 's2:fix')).toBe(true);
  });

  it.each(['shift', 'radial', 'swirl'] as const)('depth → space (%s): every shape is measured from Depth UV', style => {
    const { nodes } = compiles(scene({ space: { on: true, style, amount: 0.5, dir: 90, focus: 0 } }));
    const shapes = nodes.find(n => n.params._sbRole === 'depth:shapes')!;
    expect(shapes.params.mode).toBe('space');
    const ring = nodes.find(n => n.params._sbRole === 's2:place')!;
    expect(ring.inputs.p.connection).toEqual({ nodeId: shapes.id, outputKey: 'uv' });
  });

  it('the gradient over depth: its palette, and Time into Phase when it flows', () => {
    const { nodes } = compiles(scene({ gradient: { palette: 'fire', on: 'both', how: 'colorize', amount: 0.7, cycles: 2, phase: 0.1, flow: 0.2 } }));
    const mix = nodes.find(n => n.params._sbRole === 'depth:mix')!;
    expect(mix.params.gradient).toBe(String(DEPTH_PALETTES.find(p => p.key === 'fire')!.index));
    expect(mix.params.gradientTo).toBe('both');
    const flow = nodes.find(n => n.id === mix.inputs.phase.connection!.nodeId)!;
    expect(flow.params._sbRole).toBe('depth:flow');
  });

  it('a generated depth goes onto the Depth node as a bake (Update: Baked)', () => {
    const { nodes } = compiles(scene({ bake: BAKE }));
    const depth = nodes.find(n => n.type === 'depth')!;
    expect(depth.params.update).toBe('baked');
    expect(depth.params.depthBake).toEqual(BAKE);
  });

  it('the recipe clause round-trips: depth-picture with every setting', () => {
    const sc = scene({
      fit: 'contain', size: { on: true, far: 0.2, near: 1.9 }, space: { on: true, style: 'swirl', amount: 0.4, dir: 30, focus: 0.5 },
      look: 'fog', with: 'screen', picture: 0.7, range: [0.1, 0.9], curve: 1.5, at: 0.6, soft: 0.1, fog: 0.5, haze: 0.2, fogColor: [0.1, 0.2, 0.3],
      light: 3, own: 0.4, glow: 0.8, near: 'scene', mix: 0.6,
      gradient: { palette: 'rainbow', on: 'picture', how: 'add', amount: 0.5, cycles: 3, phase: 0.25, flow: 0.1 },
    });
    const text = printRecipe2D(sc);
    expect(text).toMatch(/depth-picture pond fit=contain size=\(0\.2,1\.9\) space=turn shift=0\.4 dir=30 focus=0\.5 look=fog with=screen/);
    const back = parseRecipe2D(text);
    expect(back.errors).toEqual([]);
    expect(canonicalScene(back.scene).depth).toEqual(canonicalScene(sc).depth);
    // The defaults print short
    expect(printRecipe2D(scene())).toMatch(/depth-picture pond$/);
    expect(parseRecipe2D('circle · depth-picture pond size look=occlude at=0.4').scene.depth).toMatchObject({ tex: 'pond', size: { on: true }, look: 'occlude', at: 0.4 });
  });

  it('the recipe reports what it can\'t read', () => {
    expect(parseRecipe2D('circle · depth-picture').errors[0].message).toMatch(/needs a picture/);
    expect(parseRecipe2D('circle · depth-picture pond look=wobble').errors[0].message).toMatch(/look is one of top, occlude, fog, mix, light/);
    expect(parseRecipe2D('circle · depth-picture pond gradient=plaid').errors[0].message).toMatch(/gradient is off or one of/);
  });

  it('spec → graph → spec: Build keeps the scene on its UV node, and a rebuild reads it back', () => {
    const sc = scene({ look: 'mix', size: { on: true, far: 0.5, near: 1.5 }, gradient: { palette: 'sunset', on: 'scene', how: 'multiply', amount: 0.8, cycles: 1, phase: 0, flow: 0 } });
    let i = 0;
    const graph = [textureNodeFor(PIC, 'pic1')];
    const res = applyScene2D(graph, sc, { nextId: () => `n${++i}`, at: { x: 0, y: 0 } });
    const found = find2dBuild(res.nodes, res.sceneId)!;
    expect(found.meta.spec.depth).toEqual(sc.depth);
    expect(found.byRole.get('depth')!.type).toBe('depth');
    expect(found.byRole.get('depth:mix')!.params).toMatchObject(depthMixParams(sc.depth!));
    // Rebuilt with a change: the same node ids, the new setting
    const next = structuredClone(found.meta.spec);
    next.depth!.look = 'light';
    const again = applyScene2D(res.nodes, next, { nextId: () => `n${++i}`, sceneId: res.sceneId });
    const f2 = find2dBuild(again.nodes, again.sceneId)!;
    expect(f2.byRole.get('depth:mix')!.id).toBe(found.byRole.get('depth:mix')!.id);
    expect(f2.byRole.get('depth:mix')!.params.mode).toBe('light');
    expect(compileGraph({ nodes: again.nodes }).success).toBe(true);
  });

  it('a picture with depth and no picture node yet: Build makes an empty Texture node for it', () => {
    const sc = parseRecipe2D('circle glow · depth-picture photo size').scene;
    let i = 0;
    const res = applyScene2D([], sc, { nextId: () => `n${++i}`, at: { x: 0, y: 0 } });
    const tex = res.nodes.find(n => n.type === 'textureInput')!;
    expect(res.nodes.find(n => n.type === 'depth')!.inputs.texture.connection?.nodeId).toBe(tex.id);
    expect(compileGraph({ nodes: res.nodes }).success).toBe(true);
  });

  it('the maths on a synthetic depth: near pixels hide an occluded scene, far ones show it', () => {
    // A synthetic depth: a ramp from far (left) to near (right)
    const ramp = [0, 0.25, 0.5, 0.75, 1];
    const d = newDepthPic('pond', { look: 'occlude', at: 0.5, soft: 0.05 });
    const shown = ramp.map(x => depthMixFront(depthMixShape(x, d.range[0], d.range[1], d.curve), d.at, d.soft));
    expect(shown[0]).toBe(1);
    expect(shown[4]).toBe(0);
    expect(shown[2]).toBeCloseTo(0.5);
  });

  describe('templates and examples', () => {
    it.each(['depthSize', 'depthBeams'])('template %s builds and compiles', key => {
      const sc = templateScene(key);
      expect(sc.depth).toBeTruthy();
      const { warnings } = compiles(sc);
      expect(warnings).toEqual([]);
    });

    it('the two depth examples compile, with the picture on their Texture node', () => {
      const ex = buildSceneBuilder2DExamples();
      for (const key of ['sb2DepthSize', 'sb2DepthBeams']) {
        const g = ex[key];
        expect(g, key).toBeTruthy();
        const r = compileGraph({ nodes: g.nodes });
        expect(r.errors ?? [], key).toEqual([]);
        expect(r.success, key).toBe(true);
        const pic = g.nodes.find(n => n.type === 'textureInput')!;
        // The built-in Room and cat photo (lib/builtinImages.ts), loaded by its id, not embedded.
        expect(pic.params.libraryId).toBe('builtin:room-and-cat');
        expect(g.images).toBeUndefined();
        expect(g.nodes.find(n => n.type === 'depth')!.inputs.texture.connection?.nodeId).toBe(pic.id);
      }
      // Size: shapes grow by depth; Beams: shapes read Depth UV, with a flowing gradient
      expect(ex.sb2DepthSize.nodes.some(n => n.type === 'depthMix' && n.params.mode === 'size' && n.inputs.picture?.connection)).toBe(true);
      expect(ex.sb2DepthBeams.nodes.some(n => n.type === 'depthMix' && n.params.mode === 'space')).toBe(true);
      expect(ex.sb2DepthBeams.nodes.some(n => n.type === 'depthMix' && n.params.gradient !== 'off' && n.inputs.phase?.connection)).toBe(true);
    });
  });
});
