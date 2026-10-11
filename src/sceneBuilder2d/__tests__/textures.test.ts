/**
 * Pictures in the 2D Scene Builder (docs/scene-builder-2d.md, "Textures"): a shape filled with a
 * picture, a picture layer, a picture mask, the background picture read through every space
 * transform and block, the recipe words, and Build / Edit this one keeping the picture's node.
 */
import { describe, expect, it } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { applyScene2D, find2dBuild } from '../apply';
import { BLOCK_LIBRARY, blockFromEntry } from '../blockLibrary';
import { COMBINE_MODES } from '../blocks';
import { SPACES, canonicalScene, emptyScene, newBlockOp, newCombineOp, newShape, newSpaceOp, texturesUsed2D, type Scene2D } from '../spec';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import { textureNodeFor, type TexSource } from '../../builders/textures';
import type { GraphNode } from '../../types/nodeGraph';

const PIC: TexSource = { name: 'pond', node: 'pic1', aspect: 1.5, kind: 'image' };

function compiles(scene: Scene2D) {
  const { nodes, warnings } = buildStandalone2D(scene);
  const r = compileGraph({ nodes });
  expect(r.success, String(r.errors)).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return { nodes, warnings, r };
}

/** A scene whose background is the picture, read at the warped point. */
function warpedPicture(space: Scene2D['space']): Scene2D {
  const s = emptyScene();
  s.textures = [{ ...PIC }];
  s.space = space;
  s.look.bgTex = { tex: 'pond', fit: 'cover', scale: 1, warp: true };
  return s;
}

describe('2D Scene Builder: pictures', () => {
  it('fills a shape with a picture, read at the shape\'s own point', () => {
    const s = emptyScene();
    s.textures = [{ ...PIC }];
    s.layers.push(newShape('circle', 's1', { at: [0.3, 0], fill: { tex: 'pond', fit: 'cover', scale: 1 }, dup: { count: 5, radius: 0.5, levels: 1, factor: 1.6 } }));
    const { nodes, warnings, r } = compiles(s);
    expect(warnings).toEqual([]);
    const sample = nodes.find(n => n.type === 'sampleTexture')!;
    expect(sample.inputs.texture.connection).toEqual({ nodeId: 'pic1', outputKey: 'texture' });
    // The fit reads the point after the ring of copies (each copy shows the picture).
    const fit = nodes.find(n => n.params._sbRole === 's1:tex:fit')!;
    const ring = nodes.find(n => n.params._sbRole === 's1:ring-at')!;
    expect(fit.inputs.q.connection?.nodeId).toBe(ring.id);
    expect(Object.keys(r.textureUniforms)).toHaveLength(1);
    expect(Object.values(r.textureUniforms)).toEqual(['pic1']);
  });

  it.each(['cover', 'contain', 'stretch', 'tile'] as const)('every fit compiles: %s', fit => {
    const s = emptyScene();
    s.textures = [{ ...PIC }];
    s.layers.push(newShape('box', 's1', { fill: { tex: 'pond', fit, scale: fit === 'tile' ? 3 : 1 } }));
    compiles(s);
  });

  it('a picture layer is a box of the picture\'s shape, painted with it', () => {
    const s = emptyScene();
    s.textures = [{ ...PIC }];
    s.layers.push(newShape('picture', 's1', { size: { h: 0.5 }, fill: { tex: 'pond', fit: 'cover', scale: 1 } }));
    const { nodes } = compiles(s);
    const box = nodes.find(n => n.params._sbRole === 's1')!;
    expect(box.params.shape).toBe('box');
    expect(box.params.rx).toBeCloseTo(0.75);
    expect(box.params.ry).toBeCloseTo(0.5);
  });

  it('a picture mask shows a layer only where the picture is bright (or dark)', () => {
    const s = emptyScene();
    s.textures = [{ ...PIC }];
    s.layers.push(newShape('circle', 's1', { mask: { tex: 'pond', cut: 0.4, invert: true } }));
    const { nodes } = compiles(s);
    const masked = nodes.find(n => n.params._sbRole === 's1:masked')!;
    expect(masked.params.cut).toBe(0.4);
    expect((masked.params.lines as Array<{ rhs: string }>).some(l => l.rhs === '1.0 - m')).toBe(true);
  });

  it('warns about a picture the scene does not have', () => {
    const s = emptyScene();
    s.layers.push(newShape('circle', 's1', { fill: { tex: 'nope', fit: 'cover', scale: 1 } }));
    expect(buildStandalone2D(s).warnings.join(' ')).toMatch(/“nope”/);
  });

  it('a Shader Texture source is wired the same way', () => {
    const s = emptyScene();
    s.textures = [{ name: 'noise', node: 'st1', kind: 'shader' }];
    s.layers.push(newShape('circle', 's1', { fill: { tex: 'noise', fit: 'stretch', scale: 1 } }));
    compiles(s);
  });
});

describe('2D Scene Builder: warping a picture through space', () => {
  it('the background picture reads the warped point: bending it is adding a transform', () => {
    const { nodes } = compiles(warpedPicture([newSpaceOp('swirl', 'p1')]));
    const fit = nodes.find(n => n.params._sbRole === 'bgpic:fit')!;
    const swirl = nodes.find(n => n.params._sbRole === 'p1')!;
    expect(fit.inputs.q.connection?.nodeId).toBe(swirl.id);
  });

  it('`still` reads the screen instead', () => {
    const s = warpedPicture([newSpaceOp('swirl', 'p1')]);
    s.look.bgTex!.warp = false;
    const { nodes } = compiles(s);
    const fit = nodes.find(n => n.params._sbRole === 'bgpic:fit')!;
    expect(nodes.find(n => n.id === fit.inputs.q.connection?.nodeId)?.type).toBe('uv');
  });

  it.each(SPACES.filter(d => d.kind !== 'fn').map(d => [d.kind] as const))('through the built-in %s', kind => {
    compiles(warpedPicture([newSpaceOp(kind, 'p1')]));
  });

  it.each(BLOCK_LIBRARY.map(e => [e.id, e] as const))('through the block %s', (_id, e) => {
    compiles(warpedPicture([newBlockOp('p1', blockFromEntry(e))]));
  });

  it.each(COMBINE_MODES.map(m => [m.mode] as const))('through a combine (%s)', mode => {
    compiles(warpedPicture([newCombineOp('p1', blockFromEntry(BLOCK_LIBRARY[0]), blockFromEntry(BLOCK_LIBRARY[5]), mode)]));
  });
});

describe('2D Scene Builder: picture words in the recipe', () => {
  const recipe = [
    'texture pond node=pic1 aspect=1.5',
    'swirl 2',
    'circle r=0.4 fill=pond fit=tile tiles=3 mask=pond mask-cut=0.3 mask-invert',
    'picture pond h=0.3 at=(0.5,0) fit=contain zoom=1.2',
    'background navy picture=pond fit=stretch still',
  ].join('\n');

  it('reads them', () => {
    const r = parseRecipe2D(recipe);
    expect(r.errors).toEqual([]);
    const s = r.scene;
    expect(s.textures).toEqual([{ name: 'pond', node: 'pic1', aspect: 1.5 }]);
    expect(s.layers[0].fill).toEqual({ tex: 'pond', fit: 'tile', scale: 3 });
    expect(s.layers[0].mask).toEqual({ tex: 'pond', cut: 0.3, invert: true });
    expect(s.layers[1].type === 'shape' && s.layers[1].kind).toBe('picture');
    expect(s.layers[1].fill).toEqual({ tex: 'pond', fit: 'contain', scale: 1.2 });
    expect(s.look.bgTex).toEqual({ tex: 'pond', fit: 'stretch', scale: 1, warp: false });
    expect(texturesUsed2D(s)).toEqual(['pond']);
  });

  it('round-trips', () => {
    const s = parseRecipe2D(recipe).scene;
    const again = parseRecipe2D(printRecipe2D(s));
    expect(again.errors).toEqual([]);
    expect(canonicalScene(again.scene)).toEqual(canonicalScene(s));
    expect(printRecipe2D(again.scene)).toBe(printRecipe2D(s));
  });

  it('a name used but never declared becomes a picture of the scene', () => {
    const r = parseRecipe2D('circle fill=brick');
    expect(r.errors).toEqual([]);
    expect(r.scene.textures).toEqual([{ name: 'brick' }]);
    expect(printRecipe2D(r.scene)).toBe('texture brick · circle fill=brick');
  });

  it('says what is wrong', () => {
    expect(parseRecipe2D('circle fill=pond fit=sideways').errors[0].message).toMatch(/fit is one of/);
    expect(parseRecipe2D('texture node=x').errors[0].message).toMatch(/texture needs a name/);
  });
});

describe('2D Scene Builder: Build and Edit this one keep the picture', () => {
  const out: GraphNode = { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} };
  let n = 0;
  const nextId = () => `node_${100 + n++}`;

  it('uses the picture\'s node, and the whole graph compiles', () => {
    const pic = textureNodeFor(PIC, 'pic1');
    const s = parseRecipe2D('texture pond node=pic1 aspect=1.5 · circle r=0.5 fill=pond').scene;
    const res = applyScene2D([out, pic], s, { nextId });
    expect(res.nodes.filter(x => x.type === 'textureInput')).toHaveLength(1);
    const r = compileGraph({ nodes: res.nodes });
    expect(r.success, String(r.errors)).toBe(true);
    expect(Object.values(r.textureUniforms)).toEqual(['pic1']);
    // Edit this one: the saved spec still names the picture's node.
    const found = find2dBuild(res.nodes, res.sceneId)!;
    expect(found.meta.spec.textures).toEqual([{ name: 'pond', node: 'pic1', aspect: 1.5 }]);
    expect(found.meta.spec.layers[0].fill?.tex).toBe('pond');
    // A rebuild keeps reading it.
    const again = applyScene2D(res.nodes, found.meta.spec, { nextId, sceneId: res.sceneId });
    expect(again.nodes.filter(x => x.type === 'textureInput')).toHaveLength(1);
    expect(compileGraph({ nodes: again.nodes }).success).toBe(true);
  });

  it('a picture with no node (typed in a recipe) gets an empty Texture node named after it', () => {
    const s = parseRecipe2D('circle r=0.5 fill=brick').scene;
    const res = applyScene2D([out], s, { nextId });
    const tex = res.nodes.filter(x => x.type === 'textureInput');
    expect(tex).toHaveLength(1);
    expect(tex[0].params.label).toBe('brick');
    expect(res.spec.textures).toEqual([{ name: 'brick', node: tex[0].id, kind: 'image' }]);
    expect(find2dBuild(res.nodes, res.sceneId)!.meta.spec.textures![0].node).toBe(tex[0].id);
    expect(compileGraph({ nodes: res.nodes }).success).toBe(true);
  });
});
