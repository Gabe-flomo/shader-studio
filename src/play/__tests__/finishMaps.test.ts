/**
 * The Finish stack's maps and the "TouchDesigner-style" effects (docs/finish-stack.md, "Where" and
 * "Warps, glitches and feedback"): which map textures a stack reads, how an effect's Where mixes it
 * in, the new kinds in the pass, the record keeping Where and Displace's map, the hosts' layer list,
 * and particles born where a map says. The GLSL itself is compiled in a browser by the checks in
 * the release notes' validation; here it is checked for structure.
 */
import { describe, it, expect } from 'vitest';
import {
  FN_DISPLACE_MAPS, FN_EFFECTS, FN_KINDS, FN_MAP_MAX, FN_WHERE, fnAnimated, fnBuildFinal, fnDefaultEffect, fnMapKeys, fnMapLayers, fnRunning, fnUsesMotion, fnWhereOf,
  type FnEffect,
} from '../kit/finish.js';
import { newFinishEffect, parseFinish, parseFinishEffect, type PlayFinish } from '../../types/playFinish';
import { createParticles, pickCell, seededRandom, stepParticles, type ParticleEnv, type ParticleParams } from '../particle-sim.js';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type ParticlesLayer } from '../../types/play';
import { buildPlayHtml, kitScript, type PlayHtmlInput } from '../exportHtml';

const fx = (kind: string, id: string, extra: Record<string, unknown> = {}): FnEffect => Object.assign(fnDefaultEffect(kind as never, id), extra);

describe('maps: what a stack reads', () => {
  it('an effect with no Where (or an odd one) shows everywhere', () => {
    expect(fnWhereOf(fx('grade', 'g'))).toBe('all');
    expect(fnWhereOf({ where: 'nowhere' })).toBe('all');
    expect(FN_WHERE).toEqual(['all', 'layer', 'picture', 'motion']);
  });

  it('collects layer and motion maps once each, in stack order, up to the limit', () => {
    const effects = [
      fx('glitch', 'a', { where: 'layer', whereLayer: 'hand' }),
      fx('bloom', 'b', { where: 'motion' }),
      fx('displace', 'c', { map: 'layer', layerId: 'blob' }),
      fx('time', 'd', { map: 'layer', layerId: 'hand' }),
      fx('grain', 'e', { where: 'picture' }),
      fx('edges', 'f', { where: 'layer', whereLayer: '' }),
    ];
    expect(fnMapKeys(effects)).toEqual(['layer:hand', 'motion', 'layer:blob']);
    const many: FnEffect[] = Array.from({ length: 7 }, (_, i) => ({ id: `x${i}`, kind: 'custom', enabled: true, code: 'vec3 effect(vec2 uv, vec3 color) { return color; }', where: 'layer', whereLayer: `L${i}` }));
    expect(fnMapKeys(many)).toHaveLength(FN_MAP_MAX);
  });

  it('tells the host which layers to draw alone and whether to keep the motion map', () => {
    const finish: PlayFinish = { on: true, effects: [newFinishEffect('ripple', 'r'), { ...newFinishEffect('mosaic', 'm'), where: 'layer', whereLayer: 'shape1' }] };
    expect(fnMapLayers(finish)).toEqual(['shape1']);
    expect(fnUsesMotion(finish)).toBe(false);
    expect(fnUsesMotion({ on: true, effects: [{ ...newFinishEffect('displace', 'd'), map: 'motion' }] })).toBe(true);
    // Off, or the effect off: nothing to read.
    expect(fnMapLayers({ ...finish, on: false })).toEqual([]);
    expect(fnUsesMotion({ on: true, effects: [{ ...newFinishEffect('grain', 'g'), where: 'motion', enabled: false }] })).toBe(false);
  });
});

describe('Where in the pass', () => {
  it('mixes a colour step and a warp by the map at the point, and inverts on request', () => {
    const { src, maps } = fnBuildFinal([fx('posterize', 'p', { where: 'layer', whereLayer: 'L', whereInvert: true }), fx('ripple', 'r', { where: 'motion' })]);
    expect(maps).toEqual(['layer:L', 'motion']);
    expect(src).toContain('uniform sampler2D uM0;');
    expect(src).toContain('float fnM0(vec2 p) { return texture(uM0, p).a; }');
    expect(src).toContain('float fnM1(vec2 p) { return texture(uM1, p).r; }');
    expect(src).toContain('float fnW0(vec2 p) { float m = clamp(fnM0(p), 0.0, 1.0); return 1.0 - m; }');
    expect(src).toContain('c = mix(c0, c, fnW0(p));');
    expect(src).toContain('q = mix(q0, q, fnW1(p));');
  });

  it('the picture map is its own brightness; a missing layer reads nothing', () => {
    expect(fnBuildFinal([fx('grade', 'g', { where: 'picture' })]).src).toContain('float m = clamp(fnPicLuma(p), 0.0, 1.0)');
    expect(fnBuildFinal([fx('grade', 'g', { where: 'layer', whereLayer: '' })]).src).toContain('float m = clamp(0.0, 0.0, 1.0)');
  });

  it('a colour split and Time displacement are scaled by their Where', () => {
    const chroma = fnBuildFinal([fx('chroma', 'c', { where: 'picture' })]).src;
    expect(chroma).toMatch(/vec2 o = normalize\(d \+ 1e-6\) \* sc \* fnW0\(p\);/);
    const time = fnBuildFinal([fx('time', 't', { map: 'layer', layerId: 'L', where: 'motion' })], { timeMap: 'layer' });
    expect(time.maps).toEqual(['layer:L', 'motion']);
    expect(time.src).toContain('float fnTimeMap(vec2 q) { return fnM0(q); }');
    expect(time.src).toContain('m *= fnW0(q);');
  });

  it('with no Where, the existing effects build exactly as before (no mixing, no maps)', () => {
    const { src, maps } = fnBuildFinal([fx('vignette', 'v'), fx('grade', 'g'), fx('chroma', 'c')]);
    expect(maps).toEqual([]);
    expect(src).not.toContain('fnW0');
    expect(src).not.toContain('uniform sampler2D uM0');
    expect(src).toContain('c = fnGrade(c);');
  });
});

describe('the new effects', () => {
  it('are in the catalogue with defaults in range, and each builds into the pass', () => {
    for (const k of ['glitch', 'ripple', 'displace', 'mosaic', 'mirror', 'gradmap', 'posterize', 'edges', 'feedback']) {
      expect(FN_KINDS).toContain(k);
      for (const p of FN_EFFECTS[k as keyof typeof FN_EFFECTS].params) {
        expect(p.value, `${k}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(p.value, `${k}.${p.key}`).toBeLessThanOrEqual(p.max);
      }
      const { src } = fnBuildFinal([fx(k, 'e')]);
      expect(src, k).toContain(`uniform vec4 U_${k}[`);
    }
  });

  it('warps bend where the picture is read; Glitch also splits colour and swaps blocks', () => {
    const { src } = fnBuildFinal([fx('glitch', 'g')]);
    expect(src).toContain('float hit = step(fnHash(vec3(cell, s)), glitch_amount * 0.35);');
    expect(src).toContain('s = vec4(fetch(q + oR).r, m.g, fetch(q + oB).b, m.a);');
    expect(src).toContain('c = mix(c, c.brg, swap);');
    expect(fnBuildFinal([fx('mirror', 'm')]).src).toContain('if (sd < 0.0) v -= 2.0 * sd * nrm;');
  });

  it('Displace reads noise, the picture, a layer or motion', () => {
    expect(FN_DISPLACE_MAPS).toEqual(['noise', 'picture', 'layer', 'motion']);
    expect(fnBuildFinal([fx('displace', 'd')]).src).toContain('fnNoise(vec3(s, uTime * displace_speed))');
    expect(fnBuildFinal([fx('displace', 'd', { map: 'picture' })]).src).toContain('(fnPicLuma(q) - 0.5) * 2.0');
    const layer = fnBuildFinal([fx('displace', 'd', { map: 'layer', layerId: 'blob' })]);
    expect(layer.maps).toEqual(['layer:blob']);
    expect(layer.src).toContain('vec2 d = vec2(cos(a), sin(a)) * fnM0(q);');
  });

  it('Feedback heads a pass of its own and reads its own history, and only it asks the renderer to keep one', () => {
    const list = [fx('grade', 'g'), fx('feedback', 'f')];
    expect(fnBuildFinal(list, { segment: 0 }).feedback).toBe(false);
    const fb = fnBuildFinal(list, { segment: 1 });
    expect(fb.feedback).toBe(true);
    expect(fb.src).toContain('uniform sampler2D uFbPrev, uFbNow, uFbRaw, uFbRawPrev;');
    expect(fb.src).toContain('vec4 tr = max(fnFbTrail(q) * feedback_amount - 0.003, 0.0) * uFbOn;');
    expect(fnBuildFinal([fx('grade', 'g')]).feedback).toBe(false);
  });

  it('keep drawing frames when they move with the clock', () => {
    const on = (e: FnEffect) => fnAnimated({ on: true, effects: [e] });
    expect(on(fx('glitch', 'g'))).toBe(true);
    expect(on(fx('glitch', 'g', { speed: 0 }))).toBe(false);
    expect(on(fx('ripple', 'r'))).toBe(true);
    expect(on(fx('ripple', 'r', { speed: 0 }))).toBe(false);
    expect(on(fx('feedback', 'f'))).toBe(true);
    expect(on(fx('mosaic', 'm'))).toBe(false);
    expect(on(fx('mosaic', 'm', { where: 'motion' }))).toBe(true);
    expect(on(fx('displace', 'd', { map: 'picture' }))).toBe(false);
  });
});

describe('the record', () => {
  it('keeps a Where (and its layer and invert) only when it is a real one', () => {
    const e = parseFinishEffect({ id: 'a', kind: 'glitch', where: 'layer', whereLayer: 'hand', whereInvert: true, amount: 5 })!;
    expect(e.where).toBe('layer');
    expect(e.whereLayer).toBe('hand');
    expect(e.whereInvert).toBe(true);
    expect(e.amount).toBe(1); // clamped
    expect(parseFinishEffect({ id: 'b', kind: 'grade', where: 'all' })!.where).toBeUndefined();
    expect(parseFinishEffect({ id: 'c', kind: 'grade', where: 'sideways' })!.where).toBeUndefined();
    expect(parseFinishEffect({ id: 'd', kind: 'grain', where: 'motion', whereLayer: 'x' })!.whereLayer).toBeUndefined();
    const custom = parseFinishEffect({ id: 'e', kind: 'custom', code: 'vec3 effect(vec2 uv, vec3 color) { return color; }', where: 'picture' })!;
    expect(custom.where).toBe('picture');
  });

  it('keeps Displace’s map and layer, and a stack with the new kinds round-trips through a Play record', () => {
    expect(parseFinishEffect({ id: 'd', kind: 'displace', map: 'motion' })!.map).toBe('motion');
    expect(parseFinishEffect({ id: 'd', kind: 'displace', map: 'slit' })!.map).toBe('noise');
    const finish = parseFinish({ on: true, effects: FN_KINDS.slice(11, 20).map((k, i) => ({ id: `e${i}`, kind: k })) })!;
    expect(finish.effects.map(e => e.kind)).toEqual(['glitch', 'ripple', 'displace', 'mosaic', 'mirror', 'gradmap', 'posterize', 'edges', 'feedback']);
    const rec = parsePlayRecord(JSON.parse(JSON.stringify({ ...emptyPlayRecord(), finish: { ...finish, effects: finish.effects.map(e => (e.kind === 'ripple' ? { ...e, where: 'picture' } : e)) } })));
    expect(rec.finish?.effects.find(e => e.kind === 'ripple')?.where).toBe('picture');
    expect(fnRunning(rec.finish).length).toBe(9);
  });
});

describe('exports', () => {
  const input = (): PlayHtmlInput => ({
    title: 'Maps', fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }',
    uniforms: {}, paramBindings: {},
    play: { ...emptyPlayRecord(), finish: { on: true, effects: [{ ...newFinishEffect('glitch', 'g'), where: 'layer', whereLayer: 'L' }, { ...newFinishEffect('displace', 'd'), map: 'motion' }] } },
    aspect: '16:9',
  });

  it('the page kit tells the runtime which layers and whether motion the stack reads', () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { finish: { mapLayers: (f: unknown) => string[]; usesMotion: (f: unknown) => boolean } };
    const finish = input().play.finish;
    expect(SSKit.finish.mapLayers(finish)).toEqual(['L']);
    expect(SSKit.finish.usesMotion(finish)).toBe(true);
    expect(buildPlayHtml(input())).toContain('motion: K ? K.motionMap() : null');
  });
});

describe('particles born where a map says', () => {
  const params = (over: Partial<ParticlesLayer> = {}): ParticleParams => ({ ...(defaultLayer('particles', 'p', 'P') as ParticlesLayer), ...over }) as ParticleParams;
  const env = (over: Partial<ParticleEnv> = {}): ParticleEnv => ({ dt: 1 / 60, time: 0, aspect: 1, sample: null, sw: 16, sh: 16, attractorPoint: null, spawnPoint: null, H: 720, ...over });

  it('picks a cell in proportion to its weight', () => {
    const cdf = Float32Array.from([0, 0, 1, 1, 3]); // weights 0, 0, 1, 0, 2
    expect(pickCell(cdf, 0.5)).toBe(2);
    expect(pickCell(cdf, 1.5)).toBe(4);
    expect(pickCell(cdf, 2.99)).toBe(4);
  });

  it('respawned particles appear only in the cells that have weight (y up, row 0 at the top)', () => {
    // A 4 × 2 grid: only the top-right cell has weight.
    const w = 4, h = 2, weights = [0, 0, 0, 1, 0, 0, 0, 0];
    let t = 0; const cdf = Float32Array.from(weights.map(v => (t += v)));
    const rand = seededRandom(7);
    const st = createParticles(30, rand, false);
    const p = params({ spawn: 'motion', life: 0.05, speed: 0, edges: 'respawn' });
    const e = env({ spawnMap: { cdf, total: t, w, h } });
    for (let f = 0; f < 30; f++) { e.time += e.dt; stepParticles(st, p, e, rand); }
    for (let i = 0; i < st.count; i++) if (st.age[i] < 0.05) {
      expect(st.x[i]).toBeGreaterThanOrEqual(0.75 - 0.05);
      expect(st.y[i]).toBeGreaterThanOrEqual(0.5 - 0.05);
    }
  });

  it('a layer saved with the new spawn settings keeps them', () => {
    const rec = parsePlayRecord({ ...emptyPlayRecord(), layers: [{ ...defaultLayer('particles', 'p1', 'P'), spawn: 'motion' }, { ...defaultLayer('particles', 'p2', 'P'), spawn: 'bright' }] });
    expect(rec.layers.map(l => (l as ParticlesLayer).spawn)).toEqual(['motion', 'bright']);
  });
});
