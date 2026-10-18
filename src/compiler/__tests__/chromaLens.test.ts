/**
 * Chromatic Aberration (lens) (play/kit/chroma.js, nodes/definitions/chromaLens.ts;
 * docs/chromatic-aberration.md): the spectral weights, the shift and blur maths, the node in every
 * look and geometry, the builders' card and its old recipes, and the Finish effect.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { n } from '../../store/graphBuilder';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { CA_MAX_TAPS, CA_MIN_TAPS, CA_SPREAD, CA_SUB, caBlurPx, caReads, caRow, caShiftPx, caSpectralWeights, caTapCount } from '../../play/kit/chroma.js';
import { FN_EFFECTS, fnBuildFinal, fnDefaultEffect } from '../../play/kit/finish.js';
import { parseFinishEffect } from '../../types/playFinish';
import { FX_BY_KIND } from '../../builders/look/effects';
import { newStackItem } from '../../builders/look/stack';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { parseRecipe2D, printRecipe2D } from '../../sceneBuilder2d/recipe';
import { starterScene } from '../../sceneBuilder2d/spec';
import { kitScript } from '../../play/exportHtml';

const parses = (fs: string) => expect(() => parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();

const picture = (): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('circleSDF', 'circ', 0, 0, { radius: 0.4 }, { position: ['uv', 'uv'] }),
  n('floatToVec3', 'rgb', 0, 0, {}, { input: ['circ', 'distance'] }),
  n('pass', 'p', 0, 0, {}, { color: ['rgb', 'rgb'] }),
];

describe('the spectral weights', () => {
  it('sum to white for any number of taps', () => {
    for (let taps = CA_MIN_TAPS; taps <= CA_MAX_TAPS; taps++) {
      const w = caSpectralWeights(taps);
      expect(w).toHaveLength(taps);
      for (let c = 0; c < 3; c++) expect(w.reduce((s, t) => s + t.w[c], 0)).toBeCloseTo(1, 10);
      // Never negative, and every tap brings some colour.
      for (const t of w) { expect(Math.min(...t.w)).toBeGreaterThanOrEqual(0); expect(t.w[0] + t.w[1] + t.w[2]).toBeGreaterThan(0); }
    }
    // A flat grey picture stays grey, whatever the Amount.
    for (const a of [0, 4, 30]) caRow(() => [0.4, 0.4, 0.4], 0, a).forEach(v => expect(v).toBeCloseTo(0.4, 10));
  });

  it('run red → yellow → green → cyan → blue → violet, red shifted one way and violet the other', () => {
    const w = caSpectralWeights(16);
    expect(w[0].shift).toBeGreaterThan(0);
    expect(w[15].shift).toBeLessThan(0);
    expect(w[0].w[0]).toBeGreaterThan(w[0].w[1] + w[0].w[2]); // red
    expect(w[8].w[1]).toBeGreaterThan(w[8].w[0]); // green in the middle
    expect(w[12].w[2]).toBeGreaterThan(w[12].w[1]); // blue
    expect(w[15].w[0]).toBeGreaterThan(0); // violet has some red
    // Some tap mixes red and green (yellow), another green and blue (cyan): a gradient, not three copies.
    expect(w.some(t => t.w[0] > 0.02 && t.w[1] > 0.02)).toBe(true);
    expect(w.some(t => t.w[1] > 0.02 && t.w[2] > 0.02)).toBe(true);
  });

  it('move red and blue as far apart on average as Channel split does (the old strength)', () => {
    const fine = caSpectralWeights(2048);
    const mid = (c: number) => fine.reduce((s, t) => s + t.shift * t.w[c], 0);
    expect(mid(0) - mid(2)).toBeCloseTo(2, 2);
    expect(CA_SPREAD).toBeGreaterThan(1);
    const split = caSpectralWeights(3, 'split');
    expect(split.map(t => [t.shift, ...t.w])).toEqual([[1, 1, 0, 0], [0, 0, 1, 0], [-1, 0, 0, 1]]);
    // An edge: Channel split moves red Amount one way, blue the other (the old node's maths).
    const edge = (x: number): [number, number, number] => (x >= 0 ? [1, 1, 1] : [0, 0, 0]);
    expect(caRow(edge, -3, 4, 3, 'split')).toEqual([1, 0, 0]);
    expect(caRow(edge, 3, 4, 3, 'split')).toEqual([1, 1, 0]);
    // Spectral fringes in steps across the edge: many in-between colours.
    const row = Array.from({ length: 21 }, (_, i) => caRow(edge, i - 10, 4).map(v => Math.round(v * 100) / 100).join());
    expect(new Set(row).size).toBeGreaterThan(8);
  });
});

describe('the shift and the blur', () => {
  it('Lateral grows from the centre by Falloff; Directional is even; Axial does not move', () => {
    expect(caShiftPx('lateral', 4, 1, 1)).toBe(4);
    expect(caShiftPx('lateral', 4, 0.5, 1)).toBe(2);
    expect(caShiftPx('lateral', 4, 0.5, 2)).toBe(1);
    expect(caShiftPx('lateral', 4, 0.5, 0)).toBe(4);
    expect(caShiftPx('lateral', 4, 0, 1)).toBe(0);
    expect(caShiftPx('directional', 4, 0.1, 2)).toBe(4);
    expect(caShiftPx('axial', 4, 1, 1)).toBe(0);
  });

  it('each tap is blurred more the further it is shifted', () => {
    const taps = caSpectralWeights(12);
    const radii = taps.map(t => caBlurPx(10 * t.shift, 0.5));
    for (let i = 0; i < taps.length; i++) for (let j = 0; j < taps.length; j++) {
      if (Math.abs(taps[i].shift) > Math.abs(taps[j].shift) + 1e-9) expect(radii[i]).toBeGreaterThan(radii[j]);
    }
    expect(caBlurPx(10, 0)).toBe(0);
    expect(caBlurPx(-8, 0.5)).toBe(4);
    // Axial: the defocus grows away from green too.
    expect(caBlurPx(0, 0, 6, 1)).toBeGreaterThan(caBlurPx(0, 0, 6, 0.2));
  });

  it('reads taps, × CA_SUB while it blurs', () => {
    expect(caTapCount('split', 12)).toBe(3);
    expect(caTapCount('spectral', 40)).toBe(CA_MAX_TAPS);
    expect(caTapCount('spectral', 1)).toBe(CA_MIN_TAPS);
    expect(caReads('spectral', 12, 0, 'lateral')).toBe(12);
    expect(caReads('spectral', 12, 0.3, 'lateral')).toBe(12 * CA_SUB);
    expect(caReads('split', 12, 0, 'axial')).toBe(3 * CA_SUB);
  });
});

describe('the node', () => {
  it('compiles in every look and geometry, one pass, its sliders uniforms', () => {
    for (const mode of ['spectral', 'split']) for (const geometry of ['lateral', 'axial', 'directional']) for (const blur of [0, 0.5]) {
      const nodes = [...picture(), n('chromaLens', 'ca', 0, 0, { mode, geometry, blur, distortion: 0.2 }, { texture: ['p', 'texture'] }), n('output', 'out', 0, 0, {}, { color: ['ca', 'color'] })];
      const r = compileGraph({ nodes });
      expect(r.success, `${mode} ${geometry}: ${(r.errors ?? []).join('; ')}`).toBe(true);
      expect((r.passes ?? []).filter(x => x.hidden)).toHaveLength(0);
      parses(r.fragmentShader);
      for (const x of r.passes ?? []) parses(x.fragmentShader);
      expect(r.fragmentShader).toContain('caRead(');
      expect(r.fragmentShader).toContain(`, ${mode === 'split' ? 1 : 0}.0, ${['lateral', 'axial', 'directional'].indexOf(geometry)}.0, `);
      expect(r.fragmentShader).toMatch(/u_p_\w+_amount/);
    }
  });

  it('Centre and every slider can be wired (#829)', () => {
    const def = getNodeDefinition('chromaLens')!;
    for (const k of ['amount', 'samples', 'blur', 'falloff', 'centerX', 'centerY', 'angle', 'distortion', 'center']) expect(def.inputs[k], k).toBeDefined();
    const nodes = [...picture(), n('mouse', 'm', 0, 0), n('constant', 'k', 0, 0, { value: 9 }),
      n('chromaLens', 'ca', 0, 0, {}, { texture: ['p', 'texture'], center: ['m', 'uv'], amount: ['k', 'value'] }),
      n('output', 'out', 0, 0, {}, { color: ['ca', 'color'] })];
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toContain('u_mouse');
    expect(r.fragmentShader.split('void main')[1]).not.toMatch(/u_p_\w+_amount\b/);
  });

  it('is found as Chromatic aberration; the old RGB Split (texture) opens as its Channel split and compiles', () => {
    expect(getNodeDefinition('chromaLens')!.aliases).toEqual(expect.arrayContaining(['Chromatic aberration', 'Dispersion', 'Prism']));
    expect(getNodeDefinition('chromaTexture')!.type).toBe('chromaLens');
    for (const mode of ['radial', 'directional']) {
      const old: GraphNode = { id: 'ch', type: 'chromaTexture', position: { x: 0, y: 0 }, params: { mode, amount: 6 },
        inputs: { texture: { type: 'texture', label: 'Texture', connection: { nodeId: 'p', outputKey: 'texture' } } }, outputs: { color: { type: 'vec3', label: 'Color' } } };
      const nodes = resolveNodeAliases([...picture(), old, n('output', 'out', 0, 0, {}, { color: ['ch', 'color'] })], getNodeDefinition);
      expect(nodes.find(x => x.id === 'ch')!.params).toMatchObject({ mode: 'split', geometry: mode === 'radial' ? 'lateral' : 'directional', blur: 0 });
      const r = compileGraph({ nodes });
      expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    }
  });
});

describe('the builders\' card', () => {
  it('builds Chromatic Aberration (lens) on the Pass of the picture so far, and compiles', () => {
    const s = starterScene();
    const it0 = newStackItem(FX_BY_KIND.chroma, 'fx1', { amount: 7, look: 'spectral', mode: 'axial', blur: 0.4 });
    s.effects = [it0];
    const { nodes } = buildStandalone2D(s);
    const ca = nodes.find(x => x.type === 'chromaLens')!;
    expect(ca.params).toMatchObject({ mode: 'spectral', geometry: 'axial', amount: 7, blur: 0.4, samples: 12 });
    expect(nodes.find(x => x.id === ca.inputs.texture.connection?.nodeId)?.type).toBe('pass');
    expect(nodes.some(x => x.type === 'chromaTexture')).toBe(false);
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  });

  it('old recipes (chroma amount=…, mode=directional) map onto the new node with the same strength', () => {
    const s = parseRecipe2D('circle · chroma 6 mode=directional angle=30').scene;
    expect(s.effects!.map(e => [e.kind, e.params.amount, e.params.mode, e.params.angle])).toEqual([['chroma', 6, 'directional', 30]]);
    const ca = buildStandalone2D(s).nodes.find(x => x.type === 'chromaLens')!;
    expect(ca.params).toMatchObject({ geometry: 'directional', amount: 6, angle: 30, mode: 'spectral' });
    const r = parseRecipe2D('circle · chroma amount=3').scene;
    expect(buildStandalone2D(r).nodes.find(x => x.type === 'chromaLens')!.params).toMatchObject({ geometry: 'lateral', amount: 3, falloff: 1 });
  });

  it('round-trips through the recipe', () => {
    const s = parseRecipe2D('circle · chroma 5 look=split mode=axial blur=0.5 samples=8 distortion=0.2').scene;
    expect(s.effects![0].params).toMatchObject({ amount: 5, look: 'split', mode: 'axial', blur: 0.5, samples: 8, distortion: 0.2 });
    const text = printRecipe2D(s);
    expect(text).toContain('chroma 5');
    expect(text).toContain('look=split');
    expect(parseRecipe2D(text).scene.effects![0].params).toEqual(s.effects![0].params);
  });
});

describe('the Finish effect', () => {
  it('keeps Amount and Falloff and adds the new controls; an old stack loads with the same numbers', () => {
    const keys = FN_EFFECTS.chroma.params.map(p => p.key);
    expect(keys).toEqual(['amount', 'falloff', 'style', 'geometry', 'samples', 'blur', 'cx', 'cy', 'angle', 'distortion']);
    const old = parseFinishEffect({ id: 'c', kind: 'chroma', enabled: true, amount: 0.6, falloff: 2 })!;
    expect(old).toMatchObject({ kind: 'chroma', amount: 0.6, falloff: 2, style: 0, geometry: 0 });
    expect(FN_EFFECTS.chroma.presets!.map(p => p.name)).toEqual(expect.arrayContaining(['Lens', 'Prism', 'RGB split']));
  });

  it('reads the picture through the spectral taps, alone and with Glitch\'s split, in every look and geometry', () => {
    for (const style of [0, 1]) for (const geometry of [0, 1, 2]) {
      const e = { ...fnDefaultEffect('chroma', 'c'), style, geometry };
      for (const list of [[e], [e, fnDefaultEffect('glitch', 'g')], [fnDefaultEffect('grade', 'gr'), e, fnDefaultEffect('halftone', 'h')]]) {
        const b = fnBuildFinal(list);
        expect(b.src).toContain('caReadR(q, vec2(chroma_cx, chroma_cy)');
        parses(b.src);
      }
    }
    expect(fnBuildFinal([fnDefaultEffect('chroma', 'c'), fnDefaultEffect('glitch', 'g')]).src).toContain('gCaR = oR;');
  });

  it('goes into exported pages with the Finish kit', () => {
    const kit = kitScript(new Set(['finish']));
    expect(kit).toContain('function caGlsl(');
    expect(kit).not.toMatch(/^import /m);
  });
});
