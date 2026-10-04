/**
 * The Finish stack's temporal effects (play/kit/finish.js): Feedback, Echo, Datamosh and Motion
 * extract. Their declarations and presets, the record round trip (Sources, Datamosh's Motion from, a
 * Feedback saved before Source), the passes they head (fnSegments), the GLSL each pass gets,
 * Datamosh's grid, keyframes and vector encoding, Echo's copies, Motion extract's ring and its maths
 * on the CPU, and the exported kit carrying them.
 */
import { describe, it, expect } from 'vitest';
import {
  FN_ECHO_CAP, FN_ECHO_MAX_DELAY, FN_EFFECTS, FN_KINDS, FN_MOSH_MAPS, FN_SOURCE_MAPS, FN_TEMPORAL_KINDS, fnAnimated, fnBuildFinal, fnDefaultEffect, fnEchoPixel, fnEchoPlan, fnEchoRingSize, fnSourceOf,
  fnMapKeys, fnMapLayers, fnMoshDecode, fnMoshEncode, fnMoshGrid, fnMoshKeyframe, fnSegments, type FnEffect, type FnKind,
} from '../kit/finish.js';
import { finishTarget, newFinishEffect, parseFinish, parseFinishEffect, readFinishValue } from '../../types/playFinish';
import { emptyPlayRecord, parsePlayRecord, type PlayRecord } from '../../types/play';
import { buildPlayHtml, kitScript, type PlayHtmlInput } from '../exportHtml';

const NEW: FnKind[] = ['datamosh', 'motionx'];
const ALL: FnKind[] = ['feedback', 'echo', 'datamosh', 'motionx'];
const fx = (kind: FnKind, patch: Record<string, unknown> = {}): FnEffect => ({ ...fnDefaultEffect(kind, kind), ...patch });
const kinds = (list: FnEffect[]) => fnSegments(list).map(s => s.map(e => e.kind));

describe('temporal effects: declarations', () => {
  it('are in the Add menu with a few explained, mappable numbers', () => {
    expect(FN_TEMPORAL_KINDS).toEqual(ALL);
    for (const k of ALL) {
      expect(FN_KINDS, k).toContain(k);
      const d = FN_EFFECTS[k];
      expect(d.label && d.group && d.icon && d.summary, k).toBeTruthy();
      const sliders = d.params.filter(p => !p.hidden);
      expect(sliders.length, `${k}: few controls`).toBeLessThanOrEqual(8);
      for (const p of d.params) {
        expect(p.hint, `${k}.${p.key}`).toBeTruthy();
        expect(p.value).toBeGreaterThanOrEqual(p.min);
        expect(p.value).toBeLessThanOrEqual(p.max);
      }
    }
    expect(FN_EFFECTS.datamosh.params.map(p => p.key)).toEqual(['amount', 'bleed', 'block', 'push', 'sustain', 'refresh', 'every', 'hold', 'reset']);
    expect(FN_EFFECTS.motionx.params.map(p => p.key)).toEqual(['delay', 'gain', 'colour', 'background', 'edges', 'neon', 'amount']);
    // Mosh is a switch (0 / 1), so a key or a signal can hold it.
    const hold = FN_EFFECTS.datamosh.params.find(p => p.key === 'hold')!;
    expect([hold.min, hold.max, hold.step, hold.value]).toEqual([0, 1, 1, 0]);
    expect(FN_EFFECTS.motionx.params.find(p => p.key === 'delay')!.max).toBe(FN_ECHO_MAX_DELAY);
  });

  it('have their presets, the defaults among them, and never set Mosh', () => {
    expect(FN_EFFECTS.datamosh.presets!.map(p => p.name)).toEqual(['Bloom', 'Melt', 'Blocky', 'Pulse', 'On cue']);
    expect(FN_EFFECTS.motionx.presets!.map(p => p.name)).toEqual(['Classic grey', 'On black', 'Neon motion']);
    for (const k of NEW) {
      const d = FN_EFFECTS[k];
      for (const pr of d.presets!) for (const [key, v] of Object.entries(pr.values)) {
        const p = d.params.find(x => x.key === key)!;
        expect(p, `${k} ${pr.name}.${key}`).toBeDefined();
        expect(v).toBeGreaterThanOrEqual(p.min);
        expect(v).toBeLessThanOrEqual(p.max);
      }
      expect(d.presets!.some(pr => Object.entries(pr.values).every(([key, v]) => d.params.find(x => x.key === key)!.value === v)), k).toBe(true);
    }
    for (const pr of FN_EFFECTS.datamosh.presets!) expect(pr.values.hold, pr.name).toBeUndefined();
    // Pulse keyframes on a rhythm; On cue heals so it moshes only while Mosh is held.
    expect(FN_EFFECTS.datamosh.presets!.find(p => p.name === 'Pulse')!.values.every).toBeGreaterThan(0);
    expect(FN_EFFECTS.datamosh.presets!.find(p => p.name === 'On cue')!.values.refresh).toBeGreaterThan(0.3);
    expect(FN_EFFECTS.motionx.presets!.find(p => p.name === 'On black')!.values.background).toBe(1);
  });
});

describe('temporal effects: the record', () => {
  it('Datamosh measures motion on the picture by default, or on a layer (a camera), which the kit then draws alone', () => {
    expect(FN_MOSH_MAPS).toEqual(['picture', 'layer']);
    expect(newFinishEffect('datamosh', 'd')).toMatchObject({ map: 'picture', layerId: '', hold: 0 });
    const f = parseFinish({ on: true, effects: [
      { id: 'd', kind: 'datamosh', map: 'layer', layerId: 'cam', block: 999, hold: 1 },
      { id: 'm', kind: 'motionx', delay: 99, gain: -3 },
    ] })!;
    expect(f.effects[0]).toMatchObject({ map: 'layer', layerId: 'cam', block: 96, hold: 1 });
    expect(f.effects[1]).toMatchObject({ delay: FN_ECHO_MAX_DELAY, gain: 0, background: 0 });
    expect(parseFinishEffect({ kind: 'datamosh', map: 'camera' })!.map).toBe('picture');
    expect(fnMapLayers(f)).toEqual(['cam']);
    expect(fnMapKeys([fx('datamosh')])).toEqual([]);
    for (const k of NEW) expect(parseFinishEffect(newFinishEffect(k, k)), k).toEqual(newFinishEffect(k, k));
    const rec: PlayRecord = { ...emptyPlayRecord(), finish: f, controls: [{ id: 'c', target: finishTarget('d', 'hold'), kind: 'float', label: 'Datamosh · Mosh', min: 0, max: 1 }] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.finish).toEqual(f);
    expect(back.controls.map(c => c.id)).toEqual(['c']);
    expect(readFinishValue(back.finish, 'finish:d::hold')).toBe(1);
  });

  it('keep the preview drawing (they change from frame to frame)', () => {
    for (const k of NEW) expect(fnAnimated({ on: true, effects: [fx(k)] }), k).toBe(true);
  });
});

describe('temporal effects: passes', () => {
  it('each heads a pass of its own (unless first), so it keeps the picture as the effects above left it', () => {
    expect(kinds([fx('datamosh'), fx('grade')])).toEqual([['datamosh', 'grade']]);
    expect(kinds([fx('grade'), fx('datamosh'), fx('vignette'), fx('motionx'), fx('bloom')])).toEqual([['grade'], ['datamosh', 'vignette'], ['motionx', 'bloom']]);
    expect(kinds([fx('motionx'), fx('halftone')])).toEqual([['motionx'], ['halftone']]);
  });

  it('a pass reads its effect’s own frames, mixed in by Amount and its Where', () => {
    const list = [fx('grade'), fx('datamosh', { where: 'picture' }), fx('motionx')];
    const a = fnBuildFinal(list, { segment: 0 }), b = fnBuildFinal(list, { segment: 1 }), c = fnBuildFinal(list, { segment: 2 });
    expect(a.mosh).toBe(false); expect(a.mx).toBe(false);
    expect(a.src).not.toContain('uMosh');
    expect(b.mosh).toBe(true); expect(b.mx).toBe(false);
    expect(b.src).toContain('uniform sampler2D uMosh;');
    expect(b.src).toContain('uniform sampler2D uStage;');
    expect(b.src).toMatch(/vec3 c0 = c;[\s\S]*texture\(uMosh, q\)[\s\S]*datamosh_amount[\s\S]*c = mix\(c0, c, fnW1\(p\)\);/);
    expect(c.mx).toBe(true);
    expect(c.src).toContain('uniform sampler2DArray uMxRing;');
    expect(c.src).toContain('0.5 + 0.5 * d, abs(d), motionx_background');
    expect(c.src).toContain('wipe = fnWipe(p);');
  });

  it('first in the stack, Datamosh is in the first pass, after its bends', () => {
    const one = fnBuildFinal([fx('datamosh'), fx('mirror')]);
    expect(one.segments).toBe(1);
    expect(one.mosh).toBe(true);
    expect(one.src).toContain('if (sd < 0.0) v -= 2.0 * sd * nrm;');
  });

  it('motion from a layer reads that layer as a map texture', () => {
    const b = fnBuildFinal([fx('datamosh', { map: 'layer', layerId: 'cam' })]);
    expect(b.maps).toEqual(['layer:cam']);
  });
});

describe('Datamosh: grid, keyframes, vectors', () => {
  it('blocks are whole quarter-size pixels, scaled with the picture', () => {
    const g = fnMoshGrid(24, 1920, 1080);
    expect([g.lowW, g.lowH, g.bl, g.gw, g.gh]).toEqual([480, 270, 6, 80, 45]);
    expect(g.px).toBe(24);
    const s = fnMoshGrid(24, 960, 540);
    expect(s.bl).toBe(3);
    expect(fnMoshGrid(8, 640, 360).bl).toBe(2); // never under 2
    expect(fnMoshGrid(96, 1920, 1080).bl).toBe(24);
    expect(fnMoshGrid(16, 1000, 700).gw).toBe(Math.ceil(250 / fnMoshGrid(16, 1000, 700).bl));
  });

  it('keyframes land on the clock: never with Every 0, never on the first frame, then once each period', () => {
    expect(fnMoshKeyframe(0, 3, 2)).toEqual({ idx: -1, key: false });
    let last = -1;
    const keys: number[] = [];
    for (let f = 0; f < 150; f++) {
      const t = f / 30;
      const k = fnMoshKeyframe(1, t, last);
      if (k.key) keys.push(f);
      last = k.idx;
    }
    expect(keys).toEqual([30, 60, 90, 120]);
    // Starting part-way (a render from 2.5 s): the first frame isn't one.
    expect(fnMoshKeyframe(1, 2.5, -1).key).toBe(false);
  });

  it('a vector survives the trip through the RGBA8 texture to well under a pixel', () => {
    for (const v of [[0, 0], [15, -15], [-40, 40], [3.37, -0.61], [63.9, -63.9]] as [number, number][]) {
      const back = fnMoshDecode(fnMoshEncode(v));
      expect(Math.abs(back[0] - v[0])).toBeLessThan(0.002);
      expect(Math.abs(back[1] - v[1])).toBeLessThan(0.002);
    }
    expect(fnMoshEncode([0, 0]).every(b => b >= 0 && b <= 255)).toBe(true);
  });
});

describe('Motion extract: ring and maths', () => {
  it('keeps enough frames for its Delay, at full size while it fits, and never shrinks while mapped', () => {
    expect(fnEchoRingSize(3, 1920, 1080)).toMatchObject({ frames: 4, w: 1920, h: 1080 });
    const d7 = fnEchoRingSize(7, 1920, 1080);
    expect(d7.frames).toBe(8);
    expect(d7.bytes).toBeLessThanOrEqual(FN_ECHO_CAP);
    const d30 = fnEchoRingSize(30, 1920, 1080);
    expect(d30.frames).toBe(32);
    expect(d30.bytes).toBeLessThanOrEqual(FN_ECHO_CAP);
    expect(d30.w).toBeGreaterThan(900);
    expect(fnEchoRingSize(99, 640, 360).frames).toBe(32);
    expect(fnEchoRingSize(2, 1920, 1080, 16).frames).toBe(16);
    expect(fnEchoRingSize(2, 640, 360)).toMatchObject({ frames: 4, w: 640, h: 360 });
  });

  it('still parts cancel to mid-grey (or black); movement shows', () => {
    const still = [0.3, 0.6, 0.9];
    expect(fnEchoPixel(still, still)).toEqual([0.5, 0.5, 0.5]);
    expect(fnEchoPixel(still, still, { background: 1 })).toEqual([0, 0, 0]);
    // The classic trick, exactly: the frame inverted at 50 % over the old one.
    const now = [0.8, 0.2, 0.4], then = [0.1, 0.5, 0.4];
    const classic = fnEchoPixel(now, then, { gain: 1, colour: 1, background: 0, neon: 0 });
    classic.forEach((v, i) => expect(v).toBeCloseTo(0.5 * (1 - now[i]) + 0.5 * then[i], 6));
    const mono = fnEchoPixel(now, then, { colour: 0 });
    expect(mono[0]).toBeCloseTo(mono[1], 6); expect(mono[1]).toBeCloseTo(mono[2], 6);
    // Neon on black: something bright arriving glows cyan, leaving magenta.
    const arrive = fnEchoPixel([1, 1, 1], [0, 0, 0], { background: 1, neon: 1 });
    expect(arrive[2]).toBeGreaterThan(arrive[0]);
    const leave = fnEchoPixel([0, 0, 0], [1, 1, 1], { background: 1, neon: 1 });
    expect(leave[0]).toBeGreaterThan(leave[1]);
  });
});

describe('temporal effects: websites', () => {
  it('go out with a website, the inlined kit carrying their passes', () => {
    const input: PlayHtmlInput = {
      title: 'Mosh', fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }', uniforms: {}, paramBindings: {},
      play: { ...emptyPlayRecord(), finish: { on: true, effects: [newFinishEffect('datamosh', 'd'), newFinishEffect('motionx', 'm')] } },
      aspect: '16:9',
    };
    const html = buildPlayHtml(input);
    expect(html).toContain('"kind":"datamosh"');
    expect(html).toContain('"kind":"motionx"');
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { finish: { active: (f: unknown) => boolean } };
    expect(SSKit.finish.active(input.play.finish)).toBe(true);
    for (const name of ['FN_MOSH_VEC', 'FN_MOSH_ADV', 'FN_TMP_CAPTURE', 'function fnEchoRingSize(']) expect(kitScript()).toContain(name);
  });
});

describe('Feedback and Echo', () => {
  it('Feedback leaves local trails by default: no zoom, so they stay where things were', () => {
    const d = FN_EFFECTS.feedback;
    expect(d.params.find(p => p.key === 'zoom')!.value).toBe(0);
    expect(d.presets!.map(p => p.name)).toEqual(['Ghost trail', 'Tunnel', 'Spiral', 'Smear']);
    expect(d.params.find(p => p.key === 'mode')!.max).toBe(4);
    expect(FN_EFFECTS.echo.presets!.map(p => p.name)).toEqual(['Echo', 'Ghost trail', 'Strobe echo']);
    expect(FN_KINDS.indexOf('echo')).toBe(FN_KINDS.indexOf('feedback') + 1);
  });

  it('take their Source from the picture, a layer, the moving or the bright parts; a Feedback saved before Source keeps the whole picture', () => {
    expect(FN_SOURCE_MAPS).toEqual(['picture', 'layer', 'moving', 'bright']);
    const old = parseFinishEffect({ id: 'f', kind: 'feedback', amount: 0.9, zoom: 0.01, rotate: 0, shiftX: 0, shiftY: 0, hue: 0, mode: 2 })!;
    expect(old).toMatchObject({ map: 'picture', zoom: 0.01, mode: 2, amount: 0.9 });
    const f = parseFinish({ on: true, effects: [{ id: 'f', kind: 'feedback', map: 'layer', layerId: 'p1' }, { id: 'e', kind: 'echo', map: 'moving', count: 99 }] })!;
    expect(f.effects[0]).toMatchObject({ map: 'layer', layerId: 'p1' });
    expect(f.effects[1]).toMatchObject({ map: 'moving', count: 8 });
    expect(fnSourceOf({ map: 'noise' })).toBe('picture');
    expect(fnMapLayers(f)).toEqual(['p1']);
    expect(parseFinishEffect({ kind: 'echo', map: 'motion' })!.map).toBe('picture');
  });

  it('Feedback keeps its own history (a pass of its own), read exactly when nothing moves it, fading through a floor', () => {
    const b = fnBuildFinal([fx('feedback')]);
    expect(b.feedback).toBe(true);
    expect(b.src).toContain('t = texelFetch(uFbPrev,');
    expect(b.src).toContain('feedback_amount - 0.003');
    expect(b.src).not.toContain('uFeed;');
    expect(fnBuildFinal([fx('feedback', { map: 'moving' })]).src).toContain('smoothstep(0.03, 0.15, abs(fnLuma(r.rgb) - fnLuma(r0.rgb)))');
    expect(fnBuildFinal([fx('feedback', { map: 'layer', layerId: 'L' })]).maps).toEqual(['layer:L']);
    expect(kinds([fx('grade'), fx('feedback'), fx('vignette')])).toEqual([['grade'], ['feedback', 'vignette']]);
  });

  it('Echo lays its copies oldest first, by its operator', () => {
    const b = fnBuildFinal([fx('echo', { map: 'bright' })]);
    expect(b.echo).toBe(true);
    expect(b.src).toContain('uniform sampler2DArray uEcR;');
    expect(b.src).toContain('echo_start * pow(echo_decay, float(k - 1))');
    expect(b.src).toContain('smoothstep(0.5, 0.8,');
  });

  it('Echo’s copies are Echo time apart, never past 30 frames, and with Strobe hold still between steps', () => {
    expect(fnEchoPlan(4, 3, false, 50).backs).toEqual([1, 5, 9, 13]);
    expect(fnEchoPlan(10, 8, false, 50).backs).toEqual([1, 11, 21, 31]);
    expect(fnEchoPlan(10, 8, false, 50, true)).toEqual({ backs: [1, 11, 21], deepest: 22 });
    expect(fnEchoPlan(30, 2, false, 1).backs).toEqual([1, 31]);
    // Strobe: from frame n the copies sit on the last multiple of Echo time, so they stay put as n steps on.
    const at = (n: number) => fnEchoPlan(6, 2, true, n).backs.map((b, i) => (i ? n - b + 1 : null));
    expect(at(13)).toEqual([null, 7, 1]);
    expect(at(14)).toEqual([null, 7, 1]);
    expect(at(18)).toEqual([null, 7, 1]);
    expect(at(19)).toEqual([null, 13, 7]);
    for (let n = 1; n < 80; n++) for (const strobe of [false, true]) expect(fnEchoPlan(7, 8, strobe, n, true).deepest).toBeLessThanOrEqual(FN_ECHO_MAX_DELAY + 1);
  });
});
