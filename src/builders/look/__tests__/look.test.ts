import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../../compiler/graphCompiler';
import { getNodeDefinition } from '../../../nodes/definitions';
import type { GraphNode } from '../../../types/nodeGraph';
import { buildStandalone2D } from '../../../sceneBuilder2d/build';
import { RECIPE_VOCABULARY_2D, parseRecipe2D, printRecipe2D } from '../../../sceneBuilder2d/recipe';
import { canonicalScene, starterScene, type Scene2D } from '../../../sceneBuilder2d/spec';
import { surpriseScene2D } from '../../../sceneBuilder2d/surprise';
import { GRADE_KINDS } from '../grade';
import { FX_BY_KIND, FX_KINDS } from '../effects';
import { newStackItem, placeStackItem, moveStackItem, type StackItem } from '../stack';
import { CUSTOM_PALETTE, paletteSwatches, slotColour } from '../palette';

const compiles = (scene: Scene2D) => {
  const { nodes, warnings } = buildStandalone2D(scene);
  const r = compileGraph({ nodes });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  return { nodes, warnings, r };
};
const types = (nodes: GraphNode[]) => nodes.map(n => n.type);
const withPicture = (s: Scene2D) => { s.textures = [{ name: 'clouds' }]; return s; };

describe('Look: palette slots', () => {
  it('shapes and the background take palette slots, one shared Color node per slot', () => {
    const s = starterScene();
    s.layers.push({ ...structuredClone(s.layers[0]), id: 's2' });
    s.layers.forEach(it => { it.slot = 1; });
    s.look.bgSlot = 0;
    s.look.colour.palette = 'heat';
    const { nodes } = compiles(s);
    const slots = nodes.filter(n => String(n.params._sbRole ?? '').startsWith('palette:slot'));
    expect(slots.map(n => n.params._sbRole).sort()).toEqual(['palette:slot1', 'palette:slot2']);
    expect(slots.find(n => n.params._sbRole === 'palette:slot2')!.params.color).toEqual(slotColour(paletteSwatches('heat'), 1));
  });

  it('a palette of your own colours the slots and colour-by', () => {
    const s = starterScene();
    s.look.colour = { ...s.look.colour, palette: CUSTOM_PALETTE, by: 'length' };
    s.look.custom = [[0, 0, 0.2], [1, 0.5, 0], [1, 1, 1]];
    const { nodes } = compiles(s);
    const ramp = nodes.find(n => n.type === 'colorRamp')!;
    expect(ramp.params.stops).toBe('3');
    expect(ramp.params.color1).toEqual([1, 0.5, 0]);
  });
});

describe('Look: the grade stack', () => {
  for (const def of GRADE_KINDS) it(`${def.kind} builds and compiles`, () => {
    const s = starterScene();
    s.look.grade = [newStackItem(def, 'gr1')];
    const { nodes } = compiles(s);
    for (const t of def.nodes) expect(types(nodes)).toContain(t);
  });
  it('the grade runs in order and an item that is off is left out', () => {
    const s = starterScene();
    s.look.grade = [newStackItem(GRADE_KINDS[2], 'gr1'), { ...newStackItem(GRADE_KINDS[7], 'gr2'), on: false }, newStackItem(GRADE_KINDS[0], 'gr3')];
    const { nodes } = compiles(s);
    expect(types(nodes)).not.toContain('posterize');
    const bc = nodes.find(n => n.type === 'brightnessContrast')!;
    const sat = nodes.find(n => n.type === 'colorSaturation')!;
    expect(bc.inputs.color.connection?.nodeId).toBe(sat.id);
  });
});

describe('Effects page', () => {
  for (const def of FX_KINDS) it(`${def.kind} builds and compiles`, () => {
    const s = withPicture(starterScene());
    const it0 = newStackItem(def, 'fx1');
    if (def.kind === 'displace') { it0.params.by = 'picture'; it0.tex = 'clouds'; }
    s.effects = [it0];
    const { nodes, warnings } = compiles(s);
    expect(warnings).toEqual([]);
    expect(types(nodes).some(t => def.nodes.includes(t))).toBe(true);
  });
  it('a run of moves shares one Pass and one read; Blur after them blurs the moved picture', () => {
    const s = starterScene();
    s.effects = ['swirl', 'pixelate', 'kaleido', 'blur', 'crt'].map((k, i) => newStackItem(FX_BY_KIND[k], `fx${i + 1}`));
    const { nodes } = compiles(s);
    // swirl+pixelate+kaleido: one Pass and one read; Blur: a Pass of the moved picture; CRT curvature: a third.
    expect(types(nodes).filter(t => t === 'pass')).toHaveLength(3);
    const blur = nodes.find(n => n.type === 'blurTexture')!;
    expect(blur.inputs.uv.connection).toBeUndefined();
    const blurPass = nodes.find(n => n.id === blur.inputs.texture.connection?.nodeId)!;
    const read = nodes.find(n => n.id === blurPass.inputs.color.connection?.nodeId)!;
    expect(read.type).toBe('sampleTexture');
    expect(nodes.find(n => n.id === read.inputs.uv.connection?.nodeId)?.type).toBe('kaleidoSpace');
  });
  it('every effect together, and noise displacement, compile', () => {
    const s = withPicture(starterScene());
    s.effects = FX_KINDS.map((d, i) => newStackItem(d, `fx${i + 1}`));
    s.look.grade = GRADE_KINDS.map((d, i) => newStackItem(d, `gr${i + 1}`));
    const { r } = compiles(s);
    for (const fs of [r.fragmentShader, ...(r.passes ?? []).map(p => p.fragmentShader)]) {
      expect(() => parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
    }
  });
  it('drag and arrows reorder the stack', () => {
    const items: StackItem[] = ['a', 'b', 'c'].map(id => ({ id, kind: 'blur', on: true, params: {} }));
    expect(placeStackItem(items, 'c', 'a').map(x => x.id)).toEqual(['c', 'a', 'b']);
    expect(placeStackItem(items, 'a', null).map(x => x.id)).toEqual(['b', 'c', 'a']);
    expect(moveStackItem(items, 'b', -1).map(x => x.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('Bloom and Scanlines leave the finish options', () => {
  it('the recipe help no longer offers them; old scenes still parse and build them', () => {
    expect(RECIPE_VOCABULARY_2D.look.join(' ')).not.toMatch(/bloom|scanlines/);
    const p = parseRecipe2D('circle r=0.3 · bloom 0.5 · scanlines 0.3');
    expect(p.errors).toEqual([]);
    expect(p.scene.look.post).toMatchObject({ bloom: 0.5, scanlines: 0.3 });
    const { nodes } = compiles(p.scene);
    expect(types(nodes)).toEqual(expect.arrayContaining(['bloom', 'scanlines']));
    expect(printRecipe2D(p.scene)).toContain('bloom 0.5');
  });
  it('Surprise me never sets them', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = surpriseScene2D(seed);
      expect(s.look.post.bloom).toBe(0);
      expect(s.look.post.scanlines).toBe(0);
    }
  });
});

describe('recipe round trip', () => {
  const recipes = [
    'circle r=0.3 slot=2 · palette fire · background slot=1',
    'circle r=0.3 · palette #102030 #e94f37 #f6c90e name=Dusk · grade saturation 1.5 · grade levels blacks=0.05 off · grade lgg gain=(1.1,1,0.9)',
    'texture clouds · circle r=0.3 · crt mask=aperture size=4 strength=0.7 curve=0.05 · chroma 6 mode=directional angle=30 · fx displace picture=clouds pixels=40 · fx pixelate 0.03 · fx glow 1.2 threshold=0.5',
    'circle r=0.3 · grade duotone dark=#102030 light=gold · fx kaleido 8 rotate=15 · fx ripple 0.02 freq=12',
  ];
  for (const src of recipes) it(src, () => {
    const a = parseRecipe2D(src);
    expect(a.errors).toEqual([]);
    const printed = printRecipe2D(a.scene);
    const b = parseRecipe2D(printed);
    expect(b.errors).toEqual([]);
    expect(canonicalScene(b.scene)).toEqual(canonicalScene(a.scene));
    compiles(a.scene);
  });
  it('reads the settings it was given', () => {
    const s = parseRecipe2D('circle · crt mask=shadow size=3 strength=0.5 · chroma amount=7').scene;
    expect(s.effects!.map(e => e.kind)).toEqual(['crt', 'chroma']);
    expect(s.effects![0].params).toMatchObject({ mask: 'shadow', size: 3, strength: 0.5 });
    expect(s.effects![1].params.amount).toBe(7);
  });
  it('says what is wrong', () => {
    expect(parseRecipe2D('circle · grade sparkle').errors[0].message).toMatch(/grade is one of/);
    expect(parseRecipe2D('circle · crt colour=red').errors[0].message).toMatch(/no setting/);
  });
});

describe('the new and changed nodes, wired and unwired', () => {
  type Conn = { nodeId: string; outputKey: string };
  const mk = (id: string, type: string, params: Record<string, unknown> = {}, wires: Record<string, Conn> = {}): GraphNode => {
    const def = getNodeDefinition(type)!;
    const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: wires[k] } : {}) }]));
    const outputs = Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }]));
    return { id, type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def.defaultParams ?? {}), ...params } };
  };
  const c = (nodeId: string, outputKey: string): Conn => ({ nodeId, outputKey });
  const ok = (nodes: GraphNode[]) => { const r = compileGraph({ nodes }); expect(r.success, (r.errors ?? []).join('; ')).toBe(true); return r; };
  const out = (from: Conn) => mk('out', 'output', {}, { color: from });

  it('Chromatic Aberration (texture): unwired, and on a Pass, radial and directional', () => {
    ok([mk('ch', 'chromaTexture'), out(c('ch', 'color'))]);
    for (const mode of ['radial', 'directional']) {
      const r = ok([mk('t', 'time'), mk('pal', 'palette', {}, { value: c('t', 'time') }), mk('p', 'pass', {}, { color: c('pal', 'color') }),
        mk('k', 'constant', { value: 3 }), mk('ch', 'chromaTexture', { mode }, { texture: c('p', 'texture'), amount: c('k', 'value') }), out(c('ch', 'color'))]);
      expect(r.passes?.length).toBe(1);
    }
  });
  it('CRT Mask: each mask type, Strength wired, and an old node compiles as before', () => {
    for (const maskType of ['slot', 'aperture', 'shadow']) {
      const fs = ok([mk('uv', 'uv'), mk('k', 'constant', { value: 0.5 }), mk('m', 'crtMask', { maskType }, { color: c('uv', 'uv'), strength: c('k', 'value') }), out(c('m', 'result'))]).fragmentShader;
      expect(fs).toContain(maskType === 'slot' ? 'vec3 crtMaskFn(' : 'vec3 crtMaskKindFn(');
    }
    const old = mk('m', 'crtMask');
    delete old.params.strength;
    delete old.params.maskType;
    const fs = ok([old, out(c('m', 'result'))]).fragmentShader;
    expect(fs).toContain('crtMaskFn(');
    expect(fs).not.toContain('mix(vec3(1.0), m_mask');
  });
});
