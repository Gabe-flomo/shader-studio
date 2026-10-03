/**
 * The Finish stack's creative effects (play/kit/finish.js): their
 * declarations (numbers, presets, colours), the passes a stack with a stage
 * effect splits into (fnSegments), the GLSL each pass gets, which ones need
 * the clock, the record round trip, and the exported kit carrying them.
 */
import { describe, it, expect } from 'vitest';
import {
  FN_ASCII_GLYPHS, FN_EFFECTS, FN_KINDS, FN_STAGE_KINDS, fnAnimated, fnBuildFinal, fnDefaultEffect, fnRunning, fnSegments, type FnEffect, type FnKind,
} from '../kit/finish.js';
import { finishNumericProps, finishTarget, newFinishEffect, parseFinish, parseFinishEffect, readFinishValue } from '../../types/playFinish';
import { emptyPlayRecord, parsePlayRecord, type PlayRecord } from '../../types/play';
import { buildPlayHtml, kitScript, type PlayHtmlInput } from '../exportHtml';

const CREATIVE: FnKind[] = ['trails', 'kaleido', 'warp', 'glitch', 'pixelsort', 'halftone', 'dither', 'ascii', 'neon', 'leaks'];
const fx = (kind: FnKind, patch: Record<string, unknown> = {}): FnEffect => ({ ...fnDefaultEffect(kind, kind), ...patch });

describe('creative effects: declarations', () => {
  it('are all in the Add menu, each with a label, group, icon, summary and a few well-named numbers', () => {
    for (const k of CREATIVE) {
      expect(FN_KINDS, k).toContain(k);
      const d = FN_EFFECTS[k];
      expect(d.label && d.group && d.icon && d.summary, k).toBeTruthy();
      const sliders = d.params.filter(p => !p.hidden);
      expect(sliders.length, k).toBeGreaterThanOrEqual(2);
      expect(sliders.length, `${k}: few controls`).toBeLessThanOrEqual(6);
      for (const p of d.params) {
        expect(p.hint || p.hidden, `${k}.${p.key} explains itself`).toBeTruthy();
        expect(p.value, `${k}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(p.value, `${k}.${p.key}`).toBeLessThanOrEqual(p.max);
      }
      expect(new Set(d.params.map(p => p.key)).size, `${k}: keys unique`).toBe(d.params.length);
    }
    expect(new Set(FN_KINDS).size).toBe(FN_KINDS.length);
  });

  it('presets only set numbers the effect has, inside their ranges, and one of them is the defaults', () => {
    for (const k of CREATIVE) {
      const d = FN_EFFECTS[k];
      for (const pr of d.presets ?? []) {
        for (const [key, v] of Object.entries(pr.values)) {
          const p = d.params.find(x => x.key === key);
          expect(p, `${k} preset ${pr.name}: ${key}`).toBeDefined();
          expect(v).toBeGreaterThanOrEqual(p!.min);
          expect(v).toBeLessThanOrEqual(p!.max);
        }
      }
      // One preset is the defaults, so a fresh card shows which starting point it is on.
      if (d.presets?.length) expect(d.presets.some(pr => Object.entries(pr.values).every(([key, v]) => d.params.find(x => x.key === key)!.value === v)), `${k}: a preset is the default look`).toBe(true);
    }
  });

  it('a colour is three hidden numbers that are still control targets', () => {
    for (const k of CREATIVE) for (const c of FN_EFFECTS[k].colours ?? []) {
      for (const key of c.keys) expect(FN_EFFECTS[k].params.find(p => p.key === key)?.hidden, `${k}.${key}`).toBe(true);
    }
    const ht = newFinishEffect('halftone', 'h');
    const keys = finishNumericProps(ht).map(p => p.key);
    expect(keys.slice(0, 4)).toEqual(['size', 'angle', 'colour', 'amount']);
    expect(keys).toContain('paperR');
  });

  it('ASCII characters go from empty to dense, and fit a 5 × 5 bitmap', () => {
    const bits = (n: number) => n.toString(2).split('').filter(b => b === '1').length;
    expect(FN_ASCII_GLYPHS[0]).toBe(0);
    for (let i = 1; i < FN_ASCII_GLYPHS.length; i++) {
      expect(FN_ASCII_GLYPHS[i]).toBeLessThan(1 << 25);
      expect(bits(FN_ASCII_GLYPHS[i])).toBeGreaterThanOrEqual(bits(FN_ASCII_GLYPHS[i - 1]));
    }
  });
});

describe('creative effects: passes', () => {
  it('a stage effect starts a pass of its own, unless it is first', () => {
    const kinds = (list: FnEffect[]) => fnSegments(list).map(s => s.map(e => e.kind));
    expect(kinds([fx('grade'), fx('bloom')])).toEqual([['grade', 'bloom']]);
    expect(kinds([fx('halftone'), fx('grade')])).toEqual([['halftone', 'grade']]);
    expect(kinds([fx('grade'), fx('halftone'), fx('vignette'), fx('neon'), fx('glitch')])).toEqual([['grade'], ['halftone', 'vignette'], ['neon'], ['glitch']]);
    for (const k of FN_STAGE_KINDS) expect(fnSegments([fx('grade'), fx(k)]).length, k).toBe(2);
  });

  it('the first pass bends and samples the picture; later ones read the pass before; only the last draws the wipe', () => {
    const list = [fx('kaleido'), fx('chroma'), fx('grade'), fx('halftone'), fx('trails')];
    const a = fnBuildFinal(list, { segment: 0 }), b = fnBuildFinal(list, { segment: 1 });
    expect(a.segments).toBe(2); expect(b.segments).toBe(2);
    expect(a.src).toContain('kaleido_segments');
    expect(a.src).toContain('chroma_amount * 0.018');
    expect(a.src).toContain('c = fnGrade(c);');
    expect(a.src).not.toContain('float sz = max(2.0, halftone_size');
    expect(a.src).not.toContain('uStage');
    expect(a.src).toContain('fragColor = vec4(c * a, a);');
    expect(a.src).not.toContain('wipe = fnWipe(p);');
    expect(b.src).toContain('uniform sampler2D uStage;');
    expect(b.src).not.toContain('float n = max(1.0, floor(kaleido_segments');
    expect(b.src).toContain('float sz = max(2.0, halftone_size');
    expect(b.src).toContain('wipe = fnWipe(p);');
    expect(a.lut).toBe(true); expect(b.lut).toBe(false);
    expect(a.trails).toBe(false); expect(b.trails).toBe(true);
    expect(b.src).toContain('uniform sampler2D uFb;');
  });

  it('a stack with no stage effect is still one pass, built as before', () => {
    const one = fnBuildFinal([fx('vignette'), fx('grade'), fx('leaks'), fx('warp')]);
    expect(one.segments).toBe(1);
    expect(one.src).toContain('fragColor = uLive > 0.5 ? vec4(c * a, 1.0) : vec4(c, a);');
    expect(one.src).not.toContain('uStage');
  });

  it('custom effects keep their numbering (and so their uniforms) in whichever pass they land', () => {
    const code = 'uniform float amount; // 0..1 = 0.5\nvec3 effect(vec2 uv, vec3 color) { return color * amount; }';
    const list: FnEffect[] = [{ id: 'c0', kind: 'custom', enabled: true, code }, fx('dither'), { id: 'c1', kind: 'custom', enabled: true, code }];
    const a = fnBuildFinal(list, { segment: 0 }), b = fnBuildFinal(list, { segment: 1 });
    expect(a.custom).toEqual(['c0']); expect(b.custom).toEqual(['c1']);
    expect(a.src).toContain('uniform vec4 U_cx0[1];'); expect(a.src).not.toContain('U_cx1');
    expect(b.src).toContain('uniform vec4 U_cx1[1];'); expect(b.src).not.toContain('uniform vec4 U_cx0');
  });

  it('needs the clock only when it moves', () => {
    const on = (e: FnEffect) => fnAnimated({ on: true, effects: [e] });
    expect(on(fx('trails'))).toBe(true);
    expect(on(fx('warp'))).toBe(true);
    expect(on(fx('warp', { speed: 0 }))).toBe(false);
    expect(on(fx('kaleido', { spin: 0 }))).toBe(false);
    expect(on(fx('glitch', { speed: 0 }))).toBe(false);
    expect(on(fx('leaks'))).toBe(true);
    expect(on(fx('halftone'))).toBe(false);
    expect(on(fx('dither'))).toBe(false);
    expect(on(fx('neon', { rainbow: 0 }))).toBe(false);
    expect(fnRunning({ on: true, effects: CREATIVE.map(k => fx(k)) }).length).toBe(CREATIVE.length);
  });
});

describe('creative effects: the record', () => {
  it('parse back with numbers clamped, colours kept, and controls on any number', () => {
    const f = parseFinish({ on: true, effects: [
      { id: 'k', kind: 'kaleido', segments: 99, zoom: -3 },
      { id: 'd', kind: 'dither', darkR: 0.2, darkG: 2, levels: 3 },
      { id: 't', kind: 'trails', amount: 1.5 },
    ] })!;
    expect(f.effects.map(e => e.kind)).toEqual(['kaleido', 'dither', 'trails']);
    expect(f.effects[0].segments).toBe(16);
    expect(f.effects[0].zoom).toBe(0.25);
    expect(f.effects[0].spin).toBe(FN_EFFECTS.kaleido.params.find(p => p.key === 'spin')!.value);
    expect(f.effects[1]).toMatchObject({ darkR: 0.2, darkG: 1, levels: 3 });
    expect(f.effects[2].amount).toBe(0.99);
    for (const k of CREATIVE) expect(parseFinishEffect(newFinishEffect(k, k)), k).toEqual(newFinishEffect(k, k));
    const rec: PlayRecord = { ...emptyPlayRecord(), finish: f, controls: [{ id: 'c', target: finishTarget('d', 'lightG'), kind: 'float', label: 'Dither · Light G', min: 0, max: 1 }] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.finish).toEqual(f);
    expect(back.controls.map(c => c.id)).toEqual(['c']);
    expect(readFinishValue(back.finish, 'finish:d::lightG')).toBe(FN_EFFECTS.dither.params.find(p => p.key === 'lightG')!.value);
  });

  it('go out with a website, the inlined kit building every pass', () => {
    const input: PlayHtmlInput = {
      title: 'Creative', fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }', uniforms: {}, paramBindings: {},
      play: { ...emptyPlayRecord(), finish: { on: true, effects: [newFinishEffect('kaleido', 'k'), newFinishEffect('halftone', 'h'), newFinishEffect('trails', 't')] } },
      aspect: '16:9',
    };
    expect(buildPlayHtml(input)).toContain('"kind":"halftone"');
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { finish: { active: (f: unknown) => boolean } };
    expect(SSKit.finish.active(input.play.finish)).toBe(true);
    expect(kitScript()).toContain('function fnSegments(');
  });
});
