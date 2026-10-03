/**
 * The Finish stack's creative effects (play/kit/finish.js): Pixel sort, Halftone, ASCII and Light
 * leaks, the presets, colour swatches and notes effects declare, the passes a stack with a stage
 * effect splits into (fnSegments), the GLSL each pass gets, Where on the new effects, which ones
 * need the clock, the record round trip, and the exported kit carrying them.
 */
import { describe, it, expect } from 'vitest';
import {
  FN_ASCII_GLYPHS, FN_EFFECTS, FN_HALATION_PRESETS, FN_KINDS, FN_STAGE_KINDS, fnAnimated, fnBuildFinal, fnDefaultEffect, fnRunning, fnSegments, type FnEffect, type FnKind,
} from '../kit/finish.js';
import { finishNumericProps, finishTarget, newFinishEffect, parseFinish, parseFinishEffect, readFinishValue } from '../../types/playFinish';
import { emptyPlayRecord, parsePlayRecord, type PlayRecord } from '../../types/play';
import { buildPlayHtml, kitScript, type PlayHtmlInput } from '../exportHtml';

const NEW: FnKind[] = ['pixelsort', 'halftone', 'ascii', 'leaks'];
const fx = (kind: FnKind, patch: Record<string, unknown> = {}): FnEffect => ({ ...fnDefaultEffect(kind, kind), ...patch });

describe('creative effects: declarations', () => {
  it('are all in the Add menu, each with a label, group, icon, summary and a few well-named numbers', () => {
    for (const k of NEW) {
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

  it('presets (on any effect) only set numbers the effect has, inside their ranges, and one of them is the defaults', () => {
    const withPresets = FN_KINDS.filter(k => FN_EFFECTS[k].presets?.length);
    // The new effects, and the presets folded into the effects they overlapped.
    for (const k of [...NEW, 'glitch', 'displace', 'mirror', 'posterize', 'edges', 'feedback', 'halation'] as FnKind[]) expect(withPresets, k).toContain(k);
    for (const k of withPresets) {
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
      expect(d.presets!.some(pr => Object.entries(pr.values).every(([key, v]) => d.params.find(x => x.key === key)!.value === v)), `${k}: a preset is the default look`).toBe(true);
    }
    expect(FN_EFFECTS.halation.presets).toBe(FN_HALATION_PRESETS);
    expect(FN_EFFECTS.feedback.presets!.map(p => p.name)).toEqual(['Ghosts', 'Tunnel', 'Smear', 'Vortex']);
    expect(FN_EFFECTS.mirror.presets!.map(p => p.name)).toEqual(['Mirror', 'Mandala', 'Crystal', 'Butterfly']);
    expect(FN_EFFECTS.edges.presets!.map(p => p.name)).toEqual(['Chalk', 'Neon', 'Ink outline', 'Laser']);
  });

  it('a colour is three hidden numbers that are still control targets, declared wherever an effect has one', () => {
    for (const k of FN_KINDS) for (const c of FN_EFFECTS[k].colours ?? []) {
      expect(c.keys.length).toBe(3);
      for (const key of c.keys) expect(FN_EFFECTS[k].params.find(p => p.key === key)?.hidden, `${k}.${key}`).toBe(true);
    }
    for (const k of ['vignette', 'bloom', 'gradmap', 'posterize', 'edges', 'halftone', 'ascii'] as FnKind[]) expect(FN_EFFECTS[k].colours?.length, k).toBeGreaterThan(0);
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
    expect(FN_STAGE_KINDS).toEqual(['pixelsort', 'halftone', 'ascii']);
    expect(kinds([fx('grade'), fx('bloom'), fx('edges'), fx('leaks')])).toEqual([['grade', 'bloom', 'edges', 'leaks']]);
    expect(kinds([fx('halftone'), fx('grade')])).toEqual([['halftone', 'grade']]);
    expect(kinds([fx('grade'), fx('halftone'), fx('vignette'), fx('ascii'), fx('pixelsort')])).toEqual([['grade'], ['halftone', 'vignette'], ['ascii'], ['pixelsort']]);
    for (const k of FN_STAGE_KINDS) expect(fnSegments([fx('grade'), fx(k)]).length, k).toBe(2);
  });

  it('the first pass bends and samples the picture; later ones read the pass before; only the last draws the wipe', () => {
    const list = [fx('mirror'), fx('chroma'), fx('grade'), fx('halftone'), fx('feedback')];
    const a = fnBuildFinal(list, { segment: 0 }), b = fnBuildFinal(list, { segment: 1 });
    expect(a.segments).toBe(2); expect(b.segments).toBe(2);
    expect(a.src).toContain('if (sd < 0.0) v -= 2.0 * sd * nrm;');
    expect(a.src).toContain('chroma_amount * 0.018');
    expect(a.src).toContain('c = fnGrade(c);');
    expect(a.src).not.toContain('float sz = max(2.0, halftone_size');
    expect(a.src).not.toContain('uStage');
    expect(a.src).toContain('fragColor = vec4(c * a, a);');
    expect(a.src).not.toContain('wipe = fnWipe(p);');
    expect(b.src).toContain('uniform sampler2D uStage;');
    expect(b.src).not.toContain('if (sd < 0.0) v -= 2.0 * sd * nrm;');
    expect(b.src).not.toContain('chroma_amount * 0.018');
    expect(b.src).toContain('float sz = max(2.0, halftone_size');
    expect(b.src).toContain('vec3 fnRead(vec2 q)');
    expect(b.src).toContain('wipe = fnWipe(p);');
    expect(a.lut).toBe(true); expect(b.lut).toBe(false);
    expect(a.feedback).toBe(false); expect(b.feedback).toBe(true);
    expect(b.src).toContain('uniform float uFeedOn, uFeedFlip;');
    // Both passes read the same map textures, so a Where works in either.
    expect(a.maps).toEqual(b.maps);
  });

  it('a stage effect that is first reads the picture through the first pass’s splits', () => {
    const one = fnBuildFinal([fx('ascii'), fx('chroma')]);
    expect(one.segments).toBe(1);
    expect(one.src).toContain('vec4 fnSample(vec2 q, vec2 p)');
    expect(one.src).toContain('oR += o; oB -= o;');
    expect(one.src).toContain('fnGlyph(gi, fract(P / cell))');
  });

  it('a stack with no stage effect is still one pass, built as before', () => {
    const one = fnBuildFinal([fx('vignette'), fx('grade'), fx('leaks'), fx('displace'), fx('edges')]);
    expect(one.segments).toBe(1);
    expect(one.src).toContain('fragColor = uLive > 0.5 ? vec4(c * a, 1.0) : vec4(c, a);');
    expect(one.src).not.toContain('uStage');
    expect(one.src).not.toContain('fnRead(');
    expect(one.src).toContain('leaks_hue / 360.0');
  });

  it('a stage effect honours its Where, in whichever pass it lands', () => {
    const list = [fx('grade'), fx('halftone', { where: 'layer', whereLayer: 'L', whereInvert: true }), fx('pixelsort', { where: 'motion' })];
    for (let i = 0; i < 3; i++) {
      const b = fnBuildFinal(list, { segment: i });
      expect(b.maps).toEqual(['layer:L', 'motion']);
      expect(b.src).toContain('uniform sampler2D uM0;');
    }
    const ht = fnBuildFinal(list, { segment: 1 }).src;
    expect(ht).toContain('float fnW1(vec2 p) { float m = clamp(fnM0(p), 0.0, 1.0); return 1.0 - m; }');
    expect(ht).toMatch(/vec3 c0 = c;[\s\S]*halftone_size[\s\S]*c = mix\(c0, c, fnW1\(p\)\);/);
    const ps = fnBuildFinal(list, { segment: 2 }).src;
    expect(ps).toMatch(/pixelsort_threshold[\s\S]*c = mix\(c0, c, fnW2\(p\)\);/);
  });

  it('custom effects keep their numbering (and so their uniforms) in whichever pass they land', () => {
    const code = 'uniform float amount; // 0..1 = 0.5\nvec3 effect(vec2 uv, vec3 color) { return color * amount; }';
    const list: FnEffect[] = [{ id: 'c0', kind: 'custom', enabled: true, code }, fx('halftone'), { id: 'c1', kind: 'custom', enabled: true, code }];
    const a = fnBuildFinal(list, { segment: 0 }), b = fnBuildFinal(list, { segment: 1 });
    expect(a.custom).toEqual(['c0']); expect(b.custom).toEqual(['c1']);
    expect(a.src).toContain('uniform vec4 U_cx0[1];'); expect(a.src).not.toContain('U_cx1');
    expect(b.src).toContain('uniform vec4 U_cx1[1];'); expect(b.src).not.toContain('uniform vec4 U_cx0');
  });

  it('folds #443’s ideas into the effects that were already there', () => {
    const mirror = fnBuildFinal([fx('mirror', { spin: 0.1, zoom: 2 })]).src;
    expect(mirror).toContain('v /= max(mirror_zoom, 0.05);');
    expect(mirror).toContain('q = 1.0 - abs(1.0 - mod(q, 2.0));');
    const edges = fnBuildFinal([fx('edges')]).src;
    expect(edges).toContain('edges_glow > 0.0');
    expect(edges).toContain('edges_rainbow > 0.0');
    const poster = fnBuildFinal([fx('posterize')]).src;
    expect(poster).toContain('if (posterize_colour < 1.0)');
  });

  it('needs the clock only when it moves', () => {
    const on = (e: FnEffect) => fnAnimated({ on: true, effects: [e] });
    expect(on(fx('leaks'))).toBe(true);
    expect(on(fx('leaks', { speed: 0 }))).toBe(false);
    expect(on(fx('halftone'))).toBe(false);
    expect(on(fx('ascii'))).toBe(false);
    expect(on(fx('pixelsort'))).toBe(false);
    expect(on(fx('mirror'))).toBe(false);
    expect(on(fx('mirror', { spin: 0.04 }))).toBe(true);
    expect(on({ id: 'm', kind: 'mirror', enabled: true, segments: 6 })).toBe(false); // a record from before Spin
    expect(on(fx('edges'))).toBe(false);
    expect(on(fx('edges', { rainbow: 0.5 }))).toBe(true);
    expect(fnRunning({ on: true, effects: NEW.map(k => fx(k)) }).length).toBe(NEW.length);
  });
});

describe('creative effects: the record', () => {
  it('parse back with numbers clamped, colours kept, older records filled in, and controls on any number', () => {
    const f = parseFinish({ on: true, effects: [
      { id: 'h', kind: 'halftone', size: 999, paperR: 0.2, paperG: 2 },
      { id: 'p', kind: 'posterize', levels: 3, lightG: 0.4 },
      { id: 'm', kind: 'mirror', segments: 6 },
    ] })!;
    expect(f.effects.map(e => e.kind)).toEqual(['halftone', 'posterize', 'mirror']);
    expect(f.effects[0]).toMatchObject({ size: 60, paperR: 0.2, paperG: 1 });
    expect(f.effects[1]).toMatchObject({ levels: 3, lightG: 0.4, colour: 1 });
    expect(f.effects[2]).toMatchObject({ segments: 6, spin: 0, zoom: 1 });
    for (const k of NEW) expect(parseFinishEffect(newFinishEffect(k, k)), k).toEqual(newFinishEffect(k, k));
    const rec: PlayRecord = { ...emptyPlayRecord(), finish: f, controls: [{ id: 'c', target: finishTarget('p', 'darkG'), kind: 'float', label: 'Posterize · Dark G', min: 0, max: 1 }] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.finish).toEqual(f);
    expect(back.controls.map(c => c.id)).toEqual(['c']);
    expect(readFinishValue(back.finish, 'finish:p::darkG')).toBe(FN_EFFECTS.posterize.params.find(p => p.key === 'darkG')!.value);
  });

  it('go out with a website, the inlined kit building every pass', () => {
    const input: PlayHtmlInput = {
      title: 'Creative', fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }', uniforms: {}, paramBindings: {},
      play: { ...emptyPlayRecord(), finish: { on: true, effects: [newFinishEffect('mirror', 'm'), newFinishEffect('halftone', 'h'), newFinishEffect('leaks', 'l')] } },
      aspect: '16:9',
    };
    expect(buildPlayHtml(input)).toContain('"kind":"halftone"');
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { finish: { active: (f: unknown) => boolean } };
    expect(SSKit.finish.active(input.play.finish)).toBe(true);
    expect(kitScript()).toContain('function fnSegments(');
    expect(kitScript()).toContain('FN_STAGE_OPS');
  });
});
