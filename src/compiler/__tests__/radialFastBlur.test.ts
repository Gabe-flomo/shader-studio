/**
 * Radial Fast Blur / Light rays (play/kit/rays.js, nodes/definitions/radialFastBlur.ts;
 * docs/radial-fast-blur.md): the log-step maths, the threshold and composite, the node and its
 * hidden passes in every mode, the builders' card, the Finish effect and the examples.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { n } from '../../store/graphBuilder';
import { hasHiddenBlur, planRays } from '../blurPasses';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { RF_OPACITY, RF_PASSES, RF_TAPS, rfBrightest, rfCompositePixel, rfDecayRate, rfEffective, rfKnee, rfOffsets, rfReach, rfSpan, rfStep } from '../../play/kit/rays.js';
import { FN_EFFECTS, FN_KINDS, fnBuildFinal, fnDefaultEffect, fnSegments } from '../../play/kit/finish.js';
import { FX_BY_KIND } from '../../builders/look/effects';
import { newStackItem } from '../../builders/look/stack';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { parseRecipe2D, printRecipe2D } from '../../sceneBuilder2d/recipe';
import { starterScene } from '../../sceneBuilder2d/spec';
import { buildRaysExamples, RAYS_EXAMPLE_KEYS } from '../../store/raysExamples';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { kitScript } from '../../play/exportHtml';

const parses = (fs: string) => expect(() => parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();

const picture = (): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('circleSDF', 'circ', 0, 0, { radius: 0.4 }, { position: ['uv', 'uv'] }),
  n('floatToVec3', 'rgb', 0, 0, {}, { input: ['circ', 'distance'] }),
  n('pass', 'p', 0, 0, {}, { color: ['rgb', 'rgb'] }),
];

describe('the log-step maths', () => {
  it('4 passes × 8 taps read 4096 evenly spaced offsets from 0 to the span', () => {
    expect(RF_PASSES).toBe(4);
    expect(RF_TAPS).toBe(8);
    expect(rfEffective()).toBe(4096);
    for (const len of [0.25, 1, 3]) {
      const offs = rfOffsets(len);
      expect(offs).toHaveLength(4096);
      expect(offs[0]).toBe(0);
      expect(offs[offs.length - 1]).toBeCloseTo(rfSpan(len), 10);
      const step = rfStep(len, 0);
      // No gaps, no doubles: every neighbour exactly one finest step apart.
      for (let i = 1; i < offs.length; i++) expect(offs[i] - offs[i - 1]).toBeCloseTo(step, 10);
    }
  });

  it('each pass is RF_TAPS times coarser than the one before; Length sets the span', () => {
    expect(rfStep(1, 1) / rfStep(1, 0)).toBeCloseTo(8, 10);
    expect(rfStep(1, 3) / rfStep(1, 0)).toBeCloseTo(512, 10);
    // Length 1: the farthest copy is twice as big (Out reads from half way to the centre).
    expect(Math.exp(-rfSpan(1))).toBeCloseTo(0.5, 10);
    expect(rfSpan(0)).toBe(0);
    expect(rfSpan(-1)).toBe(0);
  });

  it('Decay weighs the far end e^(-4·Decay), whatever the Length', () => {
    for (const len of [0.3, 2]) expect(Math.exp(-rfDecayRate(len, 0.5) * rfSpan(len))).toBeCloseTo(Math.exp(-2), 10);
    expect(rfDecayRate(1, 0)).toBe(0);
  });

  it('a decayed average over the composed passes equals one 4096-tap decayed average (it factors)', () => {
    const len = 1.5, rate = rfDecayRate(len, 0.7);
    const f = (t: number) => Math.sin(7 * t) + 2; // any brightness along the streak
    const offs = rfOffsets(len);
    const direct = offs.reduce((s, t) => s + f(t) * Math.exp(-rate * t), 0) / offs.reduce((s, t) => s + Math.exp(-rate * t), 0);
    // Pass by pass, as the GPU does: each pass's weights normalised on their own.
    let level = (t: number) => f(t);
    for (let k = 0; k < RF_PASSES; k++) {
      const prev = level, s = rfStep(len, k);
      const ws = Array.from({ length: RF_TAPS }, (_, j) => Math.exp(-rate * j * s));
      const sum = ws.reduce((a, b) => a + b, 0);
      level = (t: number) => ws.reduce((acc, w, j) => acc + w * prev(t + j * s), 0) / sum;
    }
    expect(level(0)).toBeCloseTo(direct, 8);
  });
});

describe('the threshold and the composite', () => {
  it('Threshold 0 streaks everything; above it a soft knee', () => {
    expect(rfKnee(0, 0, 0.1)).toBe(1);
    expect(rfKnee(0.2, 0.5, 0.1)).toBe(0);
    expect(rfKnee(0.5, 0.5, 0.1)).toBeCloseTo(0.5, 10);
    expect(rfKnee(0.8, 0.5, 0.1)).toBe(1);
    expect(rfKnee(0.45, 0.5, 0.1)).toBeGreaterThan(0);
    expect(rfKnee(0.45, 0.5, 0.1)).toBeLessThan(0.5);
  });

  it('Average replaces, Brightest lightens, Add adds', () => {
    expect(rfCompositePixel(0.2, 0.6, 'average', 1)).toBeCloseTo(0.6);
    expect(rfCompositePixel(0.2, 0.6, 'average', 0.5)).toBeCloseTo(0.4);
    expect(rfCompositePixel(0.8, 0.6, 'brightest', 1, 1)).toBeCloseTo(0.8 + 0.2 * 0.6);
    expect(rfCompositePixel(0.2, 1, 'brightest', 1, 1)).toBeCloseTo(1);
    expect(rfCompositePixel(0.2, 0.6, 'add', 0.5, 1)).toBeCloseTo(0.5);
  });

  it('Opacity blends Brightest\'s rays over the picture (a screen), scales Add, and leaves Average alone', () => {
    expect(RF_OPACITY).toBeGreaterThanOrEqual(0.5);
    expect(RF_OPACITY).toBeLessThanOrEqual(0.6);
    // Brightest: orig + (1 − orig) · rays · opacity: a full white ray at 0.6 leaves 40 % of what is behind it.
    expect(rfCompositePixel(0.2, 1, 'brightest', 1, 0.6)).toBeCloseTo(0.2 + 0.8 * 0.6);
    expect(rfCompositePixel(0.2, 1, 'brightest', 1, 0)).toBeCloseTo(0.2);
    expect(rfCompositePixel(0.2, 1, 'brightest', 1)).toBeCloseTo(0.2 + 0.8 * RF_OPACITY);
    // It only lightens, never past white, and a fading ray fades into the picture continuously.
    for (const o of [0.3, 0.6, 1]) for (const orig of [0, 0.4, 0.9]) {
      let prev = rfCompositePixel(orig, 0, 'brightest', 1, o);
      expect(prev).toBeCloseTo(orig);
      for (let r = 0.05; r <= 1.0001; r += 0.05) {
        const v = rfCompositePixel(orig, r, 'brightest', 1, o);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(v).toBeLessThanOrEqual(1 + 1e-12);
        expect(v - prev).toBeLessThan(0.051);
        prev = v;
      }
    }
    expect(rfCompositePixel(0.2, 0.5, 'add', 1, 0.5)).toBeCloseTo(0.45);
    for (const o of [0, 0.3, 1]) expect(rfCompositePixel(0.2, 0.6, 'average', 1, o)).toBeCloseTo(0.6);
  });

  it('Brightest fades smoothly along a ray, from its source to nothing (no step), exact across the passes', () => {
    // A bright point 0.05 log units along: the ray behind it, at a pixel t log units further, sees it at t.
    const len = 0.76;
    for (const decay of [0, 0.17, 0.5]) {
      const rate = rfDecayRate(len, decay, true);
      // Brightest reads five Lengths, fading all the way.
      // At Length a soft tail is still there; at the end of the reads (five Lengths) it is 3 % at most.
      expect(Math.exp(-rate * rfSpan(len))).toBeGreaterThan(0.1 * Math.exp(-3 * decay));
      expect(Math.exp(-rate * rfReach(len, true))).toBeLessThanOrEqual(0.035);
      // Brightness of the ray at distances d from a bright source (a step: 1 up to the source, 0 past it).
      const prof: number[] = [];
      for (let i = 0; i <= 600; i++) {
        const d = (i / 600) * rfReach(len, true) * 1.1;
        prof.push(rfBrightest(t => (t >= d ? 1 : 0), len, decay));
      }
      for (let i = 1; i < prof.length; i++) {
        expect(prof[i]).toBeLessThanOrEqual(prof[i - 1] + 1e-12); // monotonic
        expect(prof[i - 1] - prof[i]).toBeLessThan(0.035); // no step anywhere, the end included
      }
      expect(prof[0]).toBeCloseTo(1);
      expect(prof[prof.length - 1]).toBe(0);
    }
    // The pass-by-pass weighted max equals one max over the 4096 reads (the weights multiply).
    const rate = rfDecayRate(1.2, 0.3, true), f = (t: number) => 0.5 + 0.5 * Math.sin(9 * t);
    let level = (t: number) => f(t);
    for (let k = 0; k < RF_PASSES; k++) {
      const prev = level, st = rfStep(1.2, k, RF_PASSES, RF_TAPS, true);
      level = (t: number) => Math.max(...Array.from({ length: RF_TAPS }, (_, j) => prev(t + j * st) * Math.exp(-rate * j * st)));
    }
    expect(level(0)).toBeCloseTo(rfBrightest(f, 1.2, 0.3), 10);
    // Average and Add keep their old decay.
    expect(rfDecayRate(1, 0.5)).toBeCloseTo(2 / rfSpan(1), 10);
  });
});

describe('the node', () => {
  it('plans four hidden passes at the source scale, each reading the one before', () => {
    const p = planRays(0.5);
    expect(p.stages.map(s => [s.key, s.scale, s.reads, s.params.__k])).toEqual([
      ['r0', 0.5, ['source'], 0], ['r1', 0.5, ['r0'], 1], ['r2', 0.5, ['r1'], 2], ['r3', 0.5, ['r2'], 3],
    ]);
    expect(p).toMatchObject({ out: 'r3', outScale: 0.5, cubic: false, stageType: 'radialFastBlurStage' });
  });

  it('compiles in every mode and direction, with four hidden passes before the picture', () => {
    for (const mode of ['average', 'brightest', 'add']) for (const direction of ['out', 'in']) {
      const nodes = [...picture(), n('radialFastBlur', 'rays', 0, 0, { mode, direction }, { texture: ['p', 'texture'] }), n('output', 'out', 0, 0, {}, { color: ['rays', 'color'] })];
      expect(hasHiddenBlur(nodes)).toBe(true);
      const r = compileGraph({ nodes });
      expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
      const hidden = (r.passes ?? []).filter(x => x.hidden);
      expect(hidden.map(x => x.label)).toEqual([1, 2, 3, 4].map(k => `Radial Fast Blur · streak ${k}/4`));
      expect(hidden.every(x => x.format === 'half')).toBe(true);
      // The first streak pass applies Threshold; later ones read the pass before.
      expect(hidden[0].fragmentShader).toMatch(/rfPass\(u_pass_\w+, vUv, \w+, rfStep\([^,]*, 0\.0, [01]\.0\)/);
      expect(hidden[1].fragmentShader).toContain(`u_pass_${hidden[0].slug}`);
      // Brightest takes the max along the streak; the others average.
      expect(hidden[2].fragmentShader).toContain(mode === 'brightest' ? ', 1.0, 0.0,' : ', 0.0, 0.0,');
      expect(hidden[0].fragmentShader).toContain(direction === 'in' ? '-1.0' : ', 1.0,');
      for (const x of r.passes ?? []) parses(x.fragmentShader);
      parses(r.fragmentShader);
      // The picture reads the last streak pass and lays it over the source.
      expect(r.fragmentShader).toContain(`u_pass_${hidden[3].slug}`);
      expect(r.fragmentShader).toContain('rfComposite(');
      // Every slider is a uniform: one drag drives all four passes.
      expect(hidden[0].fragmentShader).toMatch(/u_p_\w+_length/);
      expect(r.fragmentShader).toMatch(/u_p_\w+_intensity/);
    }
  });

  it('Centre and every slider can be wired, in each hidden pass too (#829)', () => {
    const def = getNodeDefinition('radialFastBlur')!;
    for (const k of ['length', 'centerX', 'centerY', 'threshold', 'knee', 'intensity', 'decay', 'falloff', 'tint', 'center']) expect(def.inputs[k], k).toBeDefined();
    const nodes = [...picture(), n('mouse', 'm', 0, 0), n('constant', 'k', 0, 0, { value: 2 }),
      n('radialFastBlur', 'rays', 0, 0, {}, { texture: ['p', 'texture'], center: ['m', 'uv'], length: ['k', 'value'] }),
      n('output', 'out', 0, 0, {}, { color: ['rays', 'color'] })];
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    const hidden = (r.passes ?? []).filter(x => x.hidden);
    expect(hidden).toHaveLength(4);
    for (const x of hidden) { expect(x.fragmentShader).toContain('u_mouse'); expect(x.fragmentShader.split('void main')[1]).not.toMatch(/u_p_\w+_length\b/); }
  });

  it('where hidden passes can\'t go it draws one jittered pass of 48 reads', () => {
    const def = getNodeDefinition('radialFastBlur')!;
    const node = n('radialFastBlur', 'rays', 0, 0, {});
    const g = def.generateGLSL(node, { texture: 'u_pass_x' });
    expect(g.code).toContain('rfSingle(u_pass_x');
    expect(g.code).toContain('rfIGN(gl_FragCoord.xy)');
    const hidden = def.generateGLSL({ ...node, params: { ...node.params, __blurSrc: 'u_pass_h' } }, { texture: 'u_pass_x' });
    expect(hidden.code).toContain('texture2D(u_pass_h');
    expect(hidden.code).not.toContain('rfSingle');
  });

  it('is found as Light rays, God rays and CC Radial Fast Blur', () => {
    const def = getNodeDefinition('radialFastBlur')!;
    expect(def.aliases).toEqual(expect.arrayContaining(['Light rays', 'God rays', 'CC Radial Fast Blur', 'Zoom blur (texture)']));
  });
});

describe('the builders\' Light rays card', () => {
  it('builds a Radial Fast Blur on the Pass of the picture so far, and compiles', () => {
    const s = starterScene();
    const it0 = newStackItem(FX_BY_KIND.rays, 'fx1');
    it0.params = { mode: 'add', length: 1.5, threshold: 0.4, tint: [1, 0.8, 0.5], direction: 'in', cx: 0.2 };
    s.effects = [newStackItem(FX_BY_KIND.swirl, 'fx0'), it0];
    const { nodes } = buildStandalone2D(s);
    const rays = nodes.find(x => x.type === 'radialFastBlur')!;
    expect(rays.params).toMatchObject({ mode: 'add', length: 1.5, threshold: 0.4, tint: [1, 0.8, 0.5], direction: 'in', centerX: 0.2 });
    const pass = nodes.find(x => x.id === rays.inputs.texture.connection?.nodeId)!;
    expect(pass.type).toBe('pass');
    // After a move, it streaks the moved picture: the swirl bends the scene itself, which the Pass holds.
    expect(rays.inputs.uv.connection).toBeUndefined();
    expect(nodes.filter(x => x.type === 'pass')).toHaveLength(1);
    expect(nodes.some(x => x.type === 'sampleTexture')).toBe(false);
    expect(nodes.find(x => x.type === 'uvWarp')).toBeDefined();
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect((r.passes ?? []).filter(x => x.hidden)).toHaveLength(4);
  });

  it('round-trips through the recipe', () => {
    const s = parseRecipe2D('circle · fx rays 1.2 mode=average threshold=0').scene;
    expect(s.effects!.map(e => [e.kind, e.params.length, e.params.mode, e.params.threshold])).toEqual([['rays', 1.2, 'average', 0]]);
    expect(printRecipe2D(s)).toContain('fx rays 1.2 mode=average threshold=0');
    const t = parseRecipe2D('circle · fx rays 0.8 threshold=0.5 cx=0.3 tint=#ffcc88').scene;
    expect(t.effects![0].params).toMatchObject({ length: 0.8, threshold: 0.5, cx: 0.3 });
    expect((t.effects![0].params.tint as number[])[0]).toBeCloseTo(1, 2);
  });
});

describe('the Finish effect', () => {
  it('is a Light rays effect with the same controls', () => {
    expect(FN_KINDS).toContain('rays');
    const keys = FN_EFFECTS.rays.params.map(p => p.key);
    expect(keys).toEqual(['mode', 'direction', 'length', 'cx', 'cy', 'threshold', 'knee', 'intensity', 'opacity', 'decay', 'falloff', 'tintR', 'tintG', 'tintB']);
    expect(fnDefaultEffect('rays', 'r')).toMatchObject({ kind: 'rays', mode: 1, length: 0.6, threshold: 0.35 });
  });

  it('heads a pass of its own and reads its streaks there, in every mode', () => {
    const grade = fnDefaultEffect('grade', 'g'), rays = fnDefaultEffect('rays', 'r'), vig = fnDefaultEffect('vignette', 'v');
    expect(fnSegments([grade, rays, vig]).map(s => s.map(e => e.kind))).toEqual([['grade'], ['rays', 'vignette']]);
    expect(fnSegments([rays, vig]).map(s => s.map(e => e.kind))).toEqual([['rays', 'vignette']]);
    for (const mode of [0, 1, 2]) {
      const list = [grade, { ...rays, mode }, vig];
      const b = fnBuildFinal(list, { segment: 1 });
      expect(b.rays).toBe(true);
      expect(b.src).toContain('uniform sampler2D uRays;');
      expect(b.src).toContain('rfComposite(vec4(c * a, a), texture(uRays, q), rays_mode');
      parses(b.src);
      expect(fnBuildFinal(list, { segment: 0 }).rays).toBe(false);
    }
  });

  it('goes into exported pages with the Finish kit', () => {
    const kit = kitScript(new Set(['finish']));
    expect(kit).toContain('function rfGlsl(');
    expect(kit).toContain('RF_BASE_GLSL');
    expect(kit).not.toMatch(/^import /m);
  });
});

describe('the examples', () => {
  it('LIGHT and the colour burst compile, with four streak passes each, and are in Effects & Lens', () => {
    const g = buildRaysExamples();
    expect(Object.keys(g)).toEqual(RAYS_EXAMPLE_KEYS);
    for (const key of RAYS_EXAMPLE_KEYS) {
      const r = compileGraph({ nodes: g[key].nodes });
      expect(r.success, `${key}: ${(r.errors ?? []).join('; ')}`).toBe(true);
      expect((r.passes ?? []).filter(x => x.hidden)).toHaveLength(4);
      for (const x of r.passes ?? []) parses(x.fragmentShader);
      parses(r.fragmentShader);
      // Every Play control names a slider on the node.
      for (const c of g[key].play!.controls) expect(g[key].nodes.find(x => x.id === c.target.split('::')[0]), c.target).toBeDefined();
    }
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Effects & Lens')!.keys).toEqual(expect.arrayContaining(RAYS_EXAMPLE_KEYS));
  });
});
