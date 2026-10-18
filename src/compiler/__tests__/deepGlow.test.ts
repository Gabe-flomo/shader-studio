/**
 * Deep Glow (play/kit/deepglow.js, nodes/definitions/deepGlow.ts; docs/deep-glow.md): the chain's plan
 * and pass count, the weights and knee, the node and its hidden passes, the builders' card (and the old
 * Glow card, retired but still building), and the Finish effect (and the old Bloom, retired).
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { n } from '../../store/graphBuilder';
import { hasHiddenBlur, planDeepGlow } from '../blurPasses';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { DG_LEVELS, DG_TAIL, dgCompositePixel, dgKnee, dgLevels, dgPassCount, dgReach, dgScales, dgWeight, dgWeightSum } from '../../play/kit/deepglow.js';
import { FN_EFFECTS, FN_KINDS, FN_OFFERED_KINDS, FN_RETIRED, fnBuildFinal, fnDefaultEffect, fnSegments, fnUpgradeEffect } from '../../play/kit/finish.js';
import { parseFinishEffect } from '../../types/playFinish';
import { FX_BY_KIND, FX_KINDS, fxOffered, fxUpgrade } from '../../builders/look/effects';
import { newStackItem } from '../../builders/look/stack';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { parseRecipe2D, printRecipe2D } from '../../sceneBuilder2d/recipe';
import { starterScene } from '../../sceneBuilder2d/spec';
import { kitScript } from '../../play/exportHtml';

const parses = (fs: string) => expect(() => parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();

const picture = (scale = '1'): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('circleSDF', 'circ', 0, 0, { radius: 0.4 }, { position: ['uv', 'uv'] }),
  n('floatToVec3', 'rgb', 0, 0, {}, { input: ['circ', 'distance'] }),
  n('pass', 'p', 0, 0, { scale, format: 'half' }, { color: ['rgb', 'rgb'] }),
];

describe('the mip chain', () => {
  it('halves eight times: a prefilter, seven downs and seven ups (15 passes)', () => {
    expect(DG_LEVELS).toBe(8);
    expect(dgLevels(1)).toBe(8);
    expect(dgPassCount(8)).toBe(15);
    expect(dgScales(1)).toEqual([1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64, 1 / 128, 1 / 256]);
    // A half-size source stops at 1/256 of the picture: one level fewer.
    expect(dgLevels(0.5)).toBe(7);
    expect(dgPassCount(dgLevels(0.5))).toBe(13);
  });

  it('plans the chain as hidden passes: each down reads the one before, each up the level below and its own', () => {
    const p = planDeepGlow(1);
    expect(p.stages).toHaveLength(15);
    expect(p.stages.map(s => s.key)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'u7', 'u6', 'u5', 'u4', 'u3', 'u2', 'u1']);
    expect(p.stages[0]).toMatchObject({ reads: ['source'], scale: 0.5, params: { __stage: 'pre' } });
    expect(p.stages[1]).toMatchObject({ reads: ['d1'], scale: 0.25, params: { __stage: 'down' } });
    expect(p.stages[8]).toMatchObject({ key: 'u7', reads: ['d7', 'd8'], scale: 1 / 128, params: { __stage: 'up', __level: 7, __lowRaw: true } });
    expect(p.stages[14]).toMatchObject({ key: 'u1', reads: ['d1', 'u2'], scale: 0.5 });
    expect(p).toMatchObject({ out: 'u1', outScale: 0.5, levels: 8, stageType: 'deepGlowTextureStage' });
  });
});

describe('the weights and the knee', () => {
  it('fall off exponentially level by level out to Radius, then cut off smoothly', () => {
    const reach = dgReach(200);
    expect(reach).toBeCloseTo(Math.log2(200), 10);
    for (let k = 2; k <= 7; k++) expect(dgWeight(k, reach)[1] / dgWeight(k - 1, reach)[1]).toBeCloseTo(2 ** -DG_TAIL, 10);
    expect(dgWeight(8, reach)[1]).toBeGreaterThan(0);
    expect(dgWeight(8, dgReach(16))[1]).toBe(0);
    expect(dgWeight(1, dgReach(1))).toEqual([1, 1, 1]);
    // A bigger Radius adds tail, never takes the core away.
    expect(dgWeightSum(dgReach(400))[1]).toBeGreaterThan(dgWeightSum(dgReach(40))[1]);
  });

  it('Chromatic spread lets red reach further and blue less', () => {
    const w = dgWeight(6, 5.2, 1);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[2]).toBeLessThan(w[1]);
    expect(dgWeight(6, 5.2, 0)).toEqual([w[1], w[1], w[1]]);
  });

  it('the knee is soft round Threshold and linear above it', () => {
    expect(dgKnee(0.2, 0.6, 0.2)).toBe(0);
    expect(dgKnee(0.6, 0.6, 0.2)).toBeCloseTo(0.05, 10);
    expect(dgKnee(1.6, 0.6, 0.2)).toBeCloseTo(1, 10);
    expect(dgCompositePixel(0.5, 0.8, 'add')).toBeCloseTo(1.3);
    expect(dgCompositePixel(0.5, 0.8, 'screen')).toBeCloseTo(0.9);
  });
});

describe('the node', () => {
  it('compiles with its chain in hidden half-float passes before the picture, in both composites', () => {
    for (const composite of ['add', 'screen']) {
      const nodes = [...picture(), n('deepGlowTexture', 'dg', 0, 0, { composite, spread: 0.5 }, { texture: ['p', 'texture'] }), n('output', 'out', 0, 0, {}, { color: ['dg', 'color'] })];
      expect(hasHiddenBlur(nodes)).toBe(true);
      const r = compileGraph({ nodes });
      expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
      const hidden = (r.passes ?? []).filter(x => x.hidden);
      expect(hidden).toHaveLength(15);
      expect(hidden.every(x => x.format === 'half')).toBe(true);
      expect(hidden[0].label).toBe('Deep Glow (texture) · threshold ½');
      expect(hidden[0].fragmentShader).toContain('dgPre(');
      expect(hidden[1].fragmentShader).toContain('dgDown(');
      expect(hidden[14].fragmentShader).toContain('dgUp(');
      for (const x of r.passes ?? []) parses(x.fragmentShader);
      parses(r.fragmentShader);
      expect(r.fragmentShader).toContain(`u_pass_${hidden[14].slug}`);
      expect(r.fragmentShader).toContain(`, ${composite === 'screen' ? '1.0' : '0.0'});`);
      // One slider drives every pass: they are uniforms.
      expect(hidden[0].fragmentShader).toMatch(/u_p_\w+_threshold/);
      expect(hidden[14].fragmentShader).toMatch(/u_p_\w+_radius/);
    }
  });

  it('every slider can be wired, in each hidden pass too (#829)', () => {
    const def = getNodeDefinition('deepGlowTexture')!;
    for (const k of ['radius', 'intensity', 'threshold', 'knee', 'spread', 'preserve', 'tint']) expect(def.inputs[k], k).toBeDefined();
    const nodes = [...picture(), n('constant', 'k', 0, 0, { value: 0.3 }),
      n('deepGlowTexture', 'dg', 0, 0, {}, { texture: ['p', 'texture'], threshold: ['k', 'value'] }), n('output', 'out', 0, 0, {}, { color: ['dg', 'color'] })];
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    const pre = (r.passes ?? []).filter(x => x.hidden)[0];
    expect(pre.fragmentShader.split('void main')[1]).not.toMatch(/u_p_\w+_threshold\b/);
  });

  it('where hidden passes can\'t go it draws one jittered pass', () => {
    const g = getNodeDefinition('deepGlowTexture')!.generateGLSL(n('deepGlowTexture', 'dg', 0, 0, {}), { texture: 'u_pass_x' });
    expect(g.code).toContain('dgSingle(u_pass_x');
  });

  it('the old Glow (texture) stays in the library and compiles as before', () => {
    const old = getNodeDefinition('glowTexture')!;
    expect(old.deprecated).toBeFalsy();
    const nodes = [...picture(), n('glowTexture', 'gl', 0, 0, {}, { texture: ['p', 'texture'] }), n('output', 'out', 0, 0, {}, { color: ['gl', 'glow'] })];
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).not.toContain('dgComposite');
  });
});

describe('the builders\' Effects page', () => {
  it('offers Deep Glow and not the old Glow, which still builds for old scenes', () => {
    const offered = fxOffered().map(d => d.kind);
    expect(offered).toContain('deepglow');
    expect(offered).not.toContain('glow');
    expect(FX_KINDS.map(d => d.kind)).toContain('glow');
    const s = starterScene();
    s.effects = [newStackItem(FX_BY_KIND.glow, 'fx1', { intensity: 1.2, threshold: 0.5, radius: 16 })];
    const { nodes } = buildStandalone2D(s);
    expect(nodes.find(x => x.type === 'glowTexture')!.params).toMatchObject({ intensity: 1.2, threshold: 0.5, radius: 16 });
    expect(nodes.some(x => x.type === 'deepGlowTexture')).toBe(false);
  });

  it('upgrades an old Glow card to Deep Glow, keeping its id, place and strength', () => {
    const old = newStackItem(FX_BY_KIND.glow, 'fx3', { intensity: 1.2, threshold: 0.5, radius: 16 });
    old.on = false;
    const up = fxUpgrade(old)!;
    expect(up).toMatchObject({ id: 'fx3', kind: 'deepglow', on: false });
    expect(up.params).toMatchObject({ intensity: 1.2, threshold: 0.5, radius: 64 });
    expect(fxUpgrade(newStackItem(FX_BY_KIND.blur, 'fx1'))).toBeNull();
  });

  it('builds a Deep Glow on the Pass of the picture so far, and compiles', () => {
    const s = starterScene();
    s.effects = [newStackItem(FX_BY_KIND.swirl, 'fx0'), newStackItem(FX_BY_KIND.deepglow, 'fx1', { radius: 300, spread: 0.4, composite: 'screen', tint: [1, 0.8, 0.6] })];
    const { nodes } = buildStandalone2D(s);
    const dg = nodes.find(x => x.type === 'deepGlowTexture')!;
    expect(dg.params).toMatchObject({ radius: 300, spread: 0.4, composite: 'screen', tint: [1, 0.8, 0.6] });
    expect(nodes.find(x => x.id === dg.inputs.texture.connection?.nodeId)?.type).toBe('pass');
    expect(nodes.find(x => x.id === dg.inputs.uv.connection?.nodeId)?.type).toBe('uvWarp');
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect((r.passes ?? []).filter(x => x.hidden)).toHaveLength(15);
  });

  it('round-trips through the recipe, old Glow included', () => {
    const s = parseRecipe2D('circle · fx deepglow 1.5 radius=300 spread=0.4 composite=screen · fx glow 1.2 threshold=0.5').scene;
    expect(s.effects!.map(e => e.kind)).toEqual(['deepglow', 'glow']);
    expect(s.effects![0].params).toMatchObject({ intensity: 1.5, radius: 300, spread: 0.4, composite: 'screen' });
    const text = printRecipe2D(s);
    expect(text).toContain('fx deepglow 1.5');
    expect(text).toContain('fx glow 1.2 threshold=0.5');
    expect(parseRecipe2D(text).scene.effects).toEqual(s.effects);
  });
});

describe('the Finish effect', () => {
  it('is offered in place of Bloom, which old stacks keep', () => {
    expect(FN_KINDS).toContain('deepglow');
    expect(FN_KINDS).toContain('bloom');
    expect(FN_OFFERED_KINDS).toContain('deepglow');
    expect(FN_OFFERED_KINDS).not.toContain('bloom');
    expect(FN_RETIRED.bloom).toBe('deepglow');
    const old = parseFinishEffect({ id: 'b', kind: 'bloom', enabled: true, amount: 0.9, threshold: 0.5, radius: 0.25 })!;
    expect(old).toMatchObject({ kind: 'bloom', amount: 0.9, threshold: 0.5, radius: 0.25 });
    // It still builds as before.
    expect(fnBuildFinal([old]).src).toContain('bloom_amount');
    const up = fnUpgradeEffect(old)!;
    expect(up).toMatchObject({ id: 'b', kind: 'deepglow', enabled: true, threshold: 0.5 });
    expect(up.radius).toBeGreaterThan(40);
    expect(fnUpgradeEffect(fnDefaultEffect('vignette', 'v'))).toBeNull();
    expect(FN_EFFECTS.deepglow.presets!.length).toBeGreaterThanOrEqual(4);
  });

  it('heads a pass of its own and composites its chain there', () => {
    const grade = fnDefaultEffect('grade', 'g'), dg = fnDefaultEffect('deepglow', 'd'), vig = fnDefaultEffect('vignette', 'v');
    expect(fnSegments([grade, dg, vig]).map(s => s.map(e => e.kind))).toEqual([['grade'], ['deepglow', 'vignette']]);
    for (const composite of [0, 1]) {
      const b = fnBuildFinal([grade, { ...dg, composite }, vig], { segment: 1 });
      expect(b.deepglow).toBe(true);
      expect(b.src).toContain('uniform sampler2D uDeepGlow;');
      expect(b.src).toContain('dgComposite(');
      parses(b.src);
      expect(fnBuildFinal([grade, dg, vig], { segment: 0 }).deepglow).toBe(false);
    }
  });

  it('goes into exported pages with the Finish kit', () => {
    const kit = kitScript(new Set(['finish']));
    expect(kit).toContain('function dgGlsl(');
    expect(kit).not.toMatch(/^import /m);
  });
});
