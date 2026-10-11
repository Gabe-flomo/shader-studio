/**
 * Pictures in the 3D Scene Builder (docs/scene-builder-3d.md, "Textures"): a shape's surface
 * coloured by a picture in its own space (triplanar, planar, spherical, face), repeated with the
 * shape by Repeat, the background from a picture, the recipe words, and Build / Edit this one
 * keeping the picture's node.
 */
import { describe, expect, it } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandaloneGraph } from '../build';
import { applyScene, findBuild } from '../apply';
import { parseRecipe, printRecipe } from '../recipe';
import { TEX_MAPS, canonicalSpec, texturesUsed3D } from '../spec';
import { SCENE_TEMPLATES, templateSpec } from '../templates';
import { textureNodeFor } from '../../builders/textures';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

function compiles(recipe: string) {
  const r0 = parseRecipe(recipe);
  expect(r0.errors).toEqual([]);
  const g = buildStandaloneGraph(r0.spec);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.success, String(r.errors)).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return { spec: r0.spec, g, r };
}

const PIC = 'texture pond node=pic1 aspect=1.5';

describe('3D Scene Builder: pictures on surfaces', () => {
  it('triplanar compiles in a March Loop, reading the shape\'s own point and the normal', () => {
    const { g, r } = compiles(`surface · ${PIC} · sphere r=0.7 texture=pond at=(0.5,0,0)`);
    expect(g.warnings).toEqual([]);
    const samples = g.nodes.filter(n => n.type === 'sampleTexture');
    expect(samples).toHaveLength(3);
    for (const s of samples) expect(s.inputs.texture.connection).toEqual({ nodeId: 'pic1', outputKey: 'texture' });
    const coords = g.nodes.find(n => n.params._sbRole === 's1:pic:coords')!;
    const mat = g.nodes.find(n => n.type === 'group' && n.params._sbRole === 'materials')!;
    expect(coords.inputs.p.connection).toEqual({ nodeId: mat.id, outputKey: 'tp0' });
    const loop = g.nodes.find(n => n.type === 'marchLoopGroup')!;
    expect(coords.inputs.n.connection).toEqual({ nodeId: loop.id, outputKey: 'normal' });
    // The point is the shape's own: after its move (the Transform inside Materials).
    const inner = (mat.params.subgraph as SubgraphData);
    const port = inner.outputPorts.find(p => p.key === 'tp0')!;
    expect(inner.nodes.find(n => n.id === port.fromNodeId)?.type).toBe('transform');
    expect(Object.values(r.textureUniforms)).toEqual(['pic1']);
    expect(r.fragmentShader).toMatch(/pow\(abs\(/);
  });

  it.each(TEX_MAPS.map(m => [m] as const))('every map compiles: %s', map => {
    const { g } = compiles(`${PIC} · box size=0.5 texture=pond map=${map} tiles=2`);
    expect(g.nodes.filter(n => n.type === 'sampleTexture')).toHaveLength(map === 'triplanar' ? 3 : 1);
  });

  it('several painted shapes, and plain ones beside them, each take their own picture', () => {
    const { g } = compiles(`${PIC} · texture moss · sphere r=0.4 texture=pond · box size=0.3 at=(1,0,0) texture=moss map=planar · plane y=-1 color=grey`);
    const paint = g.nodes.find(n => n.params._sbRole === 'pictures')!;
    expect(paint.params.result).toBe('mix(mix(base, c0, slots.x), c1, slots.y)');
  });

  it('a picture repeated forever: the Repeat warp bends the point the picture is read at', () => {
    const { g } = compiles(`${PIC} · box size=0.5 texture=pond @repeat(2)`);
    const mat = g.nodes.find(n => n.params._sbRole === 'materials')!;
    const inner = (mat.params.subgraph as SubgraphData);
    const port = inner.outputPorts.find(p => p.key === 'tp0')!;
    expect(inner.nodes.find(n => n.id === port.fromNodeId)?.type).toBe('repeat3D');
  });

  it('the template "A picture, repeated forever" builds and compiles', () => {
    const t = SCENE_TEMPLATES.find(x => x.key === 'pictures')!;
    const { g } = compiles(t.recipe);
    expect(g.warnings).toEqual([]);
    expect(templateSpec('pictures').textures).toEqual([{ name: 'picture' }]);
  });

  it('tiled maps repeat seamlessly (textureGrad from the unwrapped place); face doesn\'t wrap', () => {
    const { g, r } = compiles(`${PIC} · box size=0.5 texture=pond`);
    for (const s of g.nodes.filter(n => n.type === 'sampleTexture')) expect(s.params.wrap).toBe('repeat');
    expect(r.fragmentShader).toMatch(/textureGrad\([^,]+, fract\(/);
    const face = compiles(`${PIC} · box size=0.5 texture=pond map=face`).g;
    expect(face.nodes.find(n => n.type === 'sampleTexture')!.params.wrap).toBeUndefined();
  });

  it('blend sharpness, offset and turn are live sliders on the coordinates', () => {
    const { g } = compiles(`${PIC} · box size=0.5 texture=pond sharp=9 tex-offset=(0.25,-0.5) tex-rot=30`);
    const coords = g.nodes.find(n => n.params._sbRole === 's1:pic:coords')!;
    expect([coords.params.sharp, coords.params.ox, coords.params.oy, coords.params.turn]).toEqual([9, 0.25, -0.5, 30]);
    const planar = compiles(`${PIC} · box texture=pond map=planar tex-rot=45`).g.nodes.find(n => n.params._sbRole === 's1:pic:coords')!;
    expect(planar.params.turn).toBe(45);
  });

  it('bump from brightness tilts the normal the lights read; shadows keep the shape\'s own', () => {
    const { g, r } = compiles(`${PIC} · sphere texture=pond bump=1.5 · plane y=-1`);
    const bump = g.nodes.find(n => n.params._sbRole === 'bump')!;
    const light = g.nodes.find(n => n.type === 'multiLight')!;
    const loop = g.nodes.find(n => n.type === 'marchLoopGroup')!;
    expect(light.inputs.normal.connection?.nodeId).toBe(bump.id);
    const shadow = g.nodes.find(n => n.type === 'softShadow')!;
    expect(shadow.inputs.normal.connection?.nodeId).toBe(loop.id);
    const paint = g.nodes.find(n => n.params._sbRole === 'pictures')!;
    expect(paint.params.b0).toBe(1.5);
    expect(r.fragmentShader).toMatch(/dFdx/);
  });

  it('the background from a picture: Picture Environment on the camera\'s rays', () => {
    const { g } = compiles(`${PIC} · sphere · background picture=pond`);
    const env = g.nodes.find(n => n.type === 'pictureEnvironment')!;
    const cam = g.nodes.find(n => n.type === 'marchCamera')!;
    expect(env.inputs.picture.connection).toEqual({ nodeId: 'pic1', outputKey: 'texture' });
    expect(env.inputs.dir.connection).toEqual({ nodeId: cam.id, outputKey: 'rd' });
    expect(env.inputs.forward.connection).toEqual({ nodeId: cam.id, outputKey: 'forward' });
  });

  it('other modes keep the shapes\' colours, and say so', () => {
    const { g } = compiles(`volumetric · ${PIC} · sphere texture=pond`);
    expect(g.warnings.join(' ')).toMatch(/Surface-mode feature/);
  });

  it('warns about a picture the scene does not have', () => {
    const spec = parseRecipe('sphere texture=pond').spec;
    spec.textures = [];
    expect(buildStandaloneGraph(spec).warnings.join(' ')).toMatch(/“pond”/);
  });
});

describe('3D Scene Builder: picture words in the recipe', () => {
  const recipe = `surface\n${PIC}\nsphere r=0.6 texture=pond map=spherical tiles=2 tex-offset=(0.1,0.2) tex-rot=15 bump=0.5\nbox size=0.2 at=(0,1,0) texture=pond sharp=8\nbox size=0.4 at=(1,0,0) texture=pond\nbackground navy picture=pond`;

  it('reads them', () => {
    const r = parseRecipe(recipe);
    expect(r.errors).toEqual([]);
    expect(r.spec.textures).toEqual([{ name: 'pond', node: 'pic1', aspect: 1.5 }]);
    const [a, sharpBox, b] = r.spec.root.children;
    expect(sharpBox.type === 'shape' && sharpBox.tex?.sharp).toBe(8);
    expect(a.type === 'shape' && a.tex).toEqual({ tex: 'pond', map: 'spherical', scale: 2, offset: [0.1, 0.2], rot: 15, bump: 0.5 });
    expect(b.type === 'shape' && b.tex).toEqual({ tex: 'pond', map: 'triplanar', scale: 1 });
    expect(r.spec.look.bgTex).toBe('pond');
    expect(texturesUsed3D(r.spec)).toEqual(['pond']);
  });

  it('round-trips', () => {
    const s = parseRecipe(recipe).spec;
    const printed = printRecipe(s);
    const again = parseRecipe(printed);
    expect(again.errors).toEqual([]);
    expect(canonicalSpec(again.spec)).toEqual(canonicalSpec(s));
    expect(printRecipe(again.spec)).toBe(printed);
  });

  it('says what is wrong', () => {
    expect(parseRecipe('sphere texture=pond map=cubic').errors[0].message).toMatch(/map is one of/);
    expect(parseRecipe('texture aspect=2').errors[0].message).toMatch(/texture needs a name/);
  });
});

describe('3D Scene Builder: Build and Edit this one keep the picture', () => {
  it('uses the picture\'s node; a picture typed in a recipe gets an empty Texture node', () => {
    let n = 0;
    const nextId = () => `node_${200 + n++}`;
    const pic: GraphNode = textureNodeFor({ name: 'pond', node: 'pic1', aspect: 1.5 }, 'pic1');
    const spec = parseRecipe(`${PIC} · texture moss · sphere texture=pond · box at=(1,0,0) size=0.3 texture=moss`).spec;
    const res = applyScene([pic], spec, { nextId });
    const tex = res.nodes.filter(x => x.type === 'textureInput');
    expect(tex.map(t => t.id).sort()).toEqual(['node_200', 'pic1'].sort());
    expect(tex.find(t => t.id !== 'pic1')!.params.label).toBe('moss');
    const r = compileGraph({ nodes: res.nodes });
    expect(r.success, String(r.errors)).toBe(true);
    const found = findBuild(res.nodes, res.sceneId)!;
    expect(found.meta.spec.textures!.map(t => t.node)).toEqual(['pic1', 'node_200']);
    // A rebuild (Edit this one, Build) reads the same nodes and makes none.
    const again = applyScene(res.nodes, found.meta.spec, { nextId, sceneId: res.sceneId });
    expect(again.nodes.filter(x => x.type === 'textureInput')).toHaveLength(2);
    expect(compileGraph({ nodes: again.nodes }).success).toBe(true);
  });
});
