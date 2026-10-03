/**
 * The Finish stack (play/kit/finish.js, types/playFinish.ts): curves and the
 * lookup they bake into, the grade's maths on a few pixels, halation's energy
 * estimate, the time ring's order in an offline render, the record (parse,
 * old files, controls on its numbers, Free), and exports carrying it.
 */
import { describe, it, expect } from 'vitest';
import {
  FN_EFFECTS, FN_KINDS, fnActive, fnAnimated, fnBakeLut, fnBuildFinal, fnCurveEval, fnDefaultCurves, fnDefaultEffect, fnEnergy, fnGradePixel,
  FN_HAL, FN_HALATION_PRESETS, fnHalSat, fnHalSource, fnHalSpread, fnHalTailEdge, fnHalTailMix, fnHalEdgeBleed, fnHalReceive, fnHalTint, fnHalPixel, fnMigrateHalation,
  fnHueCurveEval, fnHueCurvesUsed, fnCurvesNeutral, fnRing, fnRingSize, fnRunning, fnWheel, fnLuma, type FnEffect,
} from '../kit/finish.js';
import { FN_TONE_GLSL, FN_CRT_MASK_GLSL } from '../kit/finishGlsl.js';
import { ToneMapNode, CrtMaskNode } from '../../nodes/definitions/effects';
import {
  GRADE_LOOKS, applyLook, finishTarget, isFinishEmpty, lookFromGrade, newFinishEffect, parseFinish, parseFinishTarget, readFinishValue, type PlayFinish,
} from '../../types/playFinish';
import { emptyPlayRecord, isPlayRecordEmpty, parsePlayRecord, parsePropTarget, type PlayRecord } from '../../types/play';
import { playableForPlan, proOnlyParts } from '../planGates';
import { bakeLayerValues, readControlValue } from '../playControls';
import { buildPlayHtml, kitScript, playBundle, type PlayHtmlInput } from '../exportHtml';

const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

describe('curves', () => {
  it('no points, or the default two, is the straight line', () => {
    for (const x of [0, 0.1, 0.5, 0.93, 1]) {
      expect(fnCurveEval([], x)).toBe(x);
      expect(close(fnCurveEval([0, 0, 1, 1], x), x, 1e-9)).toBe(true);
    }
  });

  it('passes through its points, holds flat beyond the ends, and never overshoots between them', () => {
    const c = [0.1, 0.2, 0.4, 0.3, 0.6, 0.9, 0.9, 0.95];
    expect(close(fnCurveEval(c, 0.4), 0.3, 1e-9)).toBe(true);
    expect(close(fnCurveEval(c, 0.6), 0.9, 1e-9)).toBe(true);
    expect(fnCurveEval(c, 0)).toBe(0.2);
    expect(fnCurveEval(c, 1)).toBe(0.95);
    // Monotone points give a monotone curve that stays inside each segment's range.
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const x = i / 200, y = fnCurveEval(c, x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
      if (x > 0.6 && x < 0.9) { expect(y).toBeGreaterThanOrEqual(0.9 - 1e-9); expect(y).toBeLessThanOrEqual(0.95 + 1e-9); }
    }
  });

  it('points given out of order or on top of each other still make one curve', () => {
    expect(fnCurveEval([1, 1, 0, 0, 0.5, 0.7], 0.5)).toBeCloseTo(0.7, 9);
    expect(fnCurveEval([0, 0, 0.5, 0.5, 0.5, 0.9, 1, 1], 0.5)).toBeCloseTo(0.5, 9);
  });

  it('hue curves are flat at 0.5 with no points and wrap round from hue 1 to hue 0', () => {
    expect(fnHueCurveEval([], 0.3)).toBe(0.5);
    const c = [0.1, 0.8, 0.5, 0.2];
    expect(fnHueCurveEval(c, 0.1)).toBeCloseTo(0.8, 6);
    expect(fnHueCurveEval(c, 0.5)).toBeCloseTo(0.2, 6);
    expect(fnHueCurveEval(c, 0)).toBeCloseTo(fnHueCurveEval(c, 1), 6);
  });

  it('bakes into a 256 × 2 lookup: identity when neutral, the master curve under each channel', () => {
    const lut = fnBakeLut(fnDefaultCurves());
    expect(lut.length).toBe(256 * 2 * 4);
    for (let i = 0; i < 256; i += 17) {
      expect(lut[i * 4]).toBe(i); expect(lut[i * 4 + 1]).toBe(i); expect(lut[i * 4 + 2]).toBe(i);
      expect(lut[i * 4 + 3]).toBe(128); // luma vs sat: no change
      expect(lut[(256 + i) * 4]).toBe(128); expect(lut[(256 + i) * 4 + 1]).toBe(128);
    }
    // Master lifts the blacks; red then halves: red = r(m(x)).
    const c = { ...fnDefaultCurves(), rgb: [0, 0.2, 1, 1], r: [0, 0, 1, 0.5] };
    const l2 = fnBakeLut(c);
    expect(l2[0]).toBe(Math.round(0.1 * 255));
    expect(l2[1]).toBe(Math.round(0.2 * 255));
    expect(fnCurvesNeutral(fnDefaultCurves())).toBe(true);
    expect(fnCurvesNeutral(c)).toBe(false);
    expect(fnHueCurvesUsed({ ...fnDefaultCurves(), hueSat: [0.5, 0.5] })).toBe(false);
    expect(fnHueCurvesUsed({ ...fnDefaultCurves(), hueSat: [0.5, 0.7] })).toBe(true);
  });
});

describe('the grade on a few pixels', () => {
  const g = (over: Record<string, unknown> = {}) => ({ ...fnDefaultEffect('grade', 'g'), ...over });
  const px = [[0.5, 0.5, 0.5], [0.9, 0.2, 0.1], [0.1, 0.6, 0.8], [0.02, 0.02, 0.03], [1, 1, 1]];

  it('at its defaults changes nothing', () => {
    const lut = fnBakeLut(fnDefaultCurves());
    for (const p of px) fnGradePixel(p, g(), lut).forEach((v, i) => expect(close(v, p[i], 1 / 255 + 1e-6)).toBe(true));
  });

  it('exposure is stops of light: +1 doubles the linear value', () => {
    const [r] = fnGradePixel([0.5, 0.5, 0.5], g({ exposure: 1 }), null);
    expect(r).toBeCloseTo(0.5 * Math.pow(2, 1 / 2.2), 4); // 0.6849
    const [d] = fnGradePixel([0.5, 0.5, 0.5], g({ exposure: -1 }), null);
    expect(d).toBeCloseTo(0.5 * Math.pow(0.5, 1 / 2.2), 4);
  });

  it('saturation -1 is grey at the colour’s luma; +vibrance leaves grey alone', () => {
    const out = fnGradePixel([0.9, 0.2, 0.1], g({ saturation: -1 }), null);
    expect(close(out[0], out[1], 1e-9) && close(out[1], out[2], 1e-9)).toBe(true);
    expect(out[0]).toBeCloseTo(fnLuma([0.9, 0.2, 0.1]), 6);
    const grey = fnGradePixel([0.4, 0.4, 0.4], g({ vibrance: 1 }), null);
    grey.forEach(v => expect(v).toBeCloseTo(0.4, 6));
  });

  it('temperature warms (more red, less blue) and keeps the brightness', () => {
    const out = fnGradePixel([0.5, 0.5, 0.5], g({ temperature: 0.8 }), null);
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[2]).toBeLessThan(0.5);
  });

  it('contrast pushes tones away from the middle without clipping', () => {
    const [lo] = fnGradePixel([0.25, 0.25, 0.25], g({ contrast: 1 }), null);
    const [hi] = fnGradePixel([0.75, 0.75, 0.75], g({ contrast: 1 }), null);
    const [mid] = fnGradePixel([0.5, 0.5, 0.5], g({ contrast: 1 }), null);
    expect(lo).toBeLessThan(0.25); expect(hi).toBeGreaterThan(0.75); expect(mid).toBeCloseTo(0.5, 6);
    expect(lo).toBeGreaterThan(0); expect(hi).toBeLessThan(1);
  });

  it('a wheel pushes toward its hue and has no brightness of its own', () => {
    const w = fnWheel(1, 0); // red
    expect(w[0]).toBeGreaterThan(0);
    expect(fnLuma(w)).toBeCloseTo(0, 9);
    const out = fnGradePixel([0.5, 0.5, 0.5], g({ gainX: 0.6 }), null);
    expect(out[0]).toBeGreaterThan(out[1]);
  });

  it('amount 0 is the picture as it was, whatever the grade', () => {
    const graded = g({ exposure: 2, saturation: -1, temperature: 1, amount: 0 });
    for (const p of px) fnGradePixel(p, graded, null).forEach((v, i) => expect(v).toBeCloseTo(p[i], 9));
  });

  it('the curves are applied through the lookup, as the shader reads it', () => {
    const curves = { ...fnDefaultCurves(), rgb: [0, 1, 1, 0] }; // an inverting curve
    const out = fnGradePixel([0.2, 0.5, 0.8], g({ curves }), fnBakeLut(curves));
    expect(out[0]).toBeCloseTo(0.8, 2); expect(out[2]).toBeCloseTo(0.2, 2);
  });
});

describe('looks', () => {
  it('a look sets the grade to exactly its numbers and curves, everything else back to default', () => {
    const start = { ...newFinishEffect('grade', 'g'), exposure: 1.5, hslRange: 40, enabled: false };
    const look = GRADE_LOOKS.find(l => l.id === 'bleach-bypass')!;
    const e = applyLook(start, look);
    expect(e.id).toBe('g');
    expect(e.enabled).toBe(false);
    expect(e.exposure).toBe(0);
    expect(e.hslRange).toBe(0);
    expect(e.saturation).toBe(-0.6);
    expect(e.look).toBe('bleach-bypass');
    expect(e.curves!.rgb).toEqual(look.curves!.rgb);
    // Saving the look back keeps the same numbers.
    expect(lookFromGrade(e).values).toEqual(look.values);
  });

  it('every built-in look parses back unchanged (its numbers are in range)', () => {
    for (const l of GRADE_LOOKS) {
      const e = applyLook(newFinishEffect('grade', 'g'), l);
      expect(parseFinish({ effects: [e] })!.effects[0], l.id).toEqual(e);
    }
  });
});

describe('halation', () => {
  it('a clipped white bleeds no more than the reference\'s brightest glint (the source saturates)', () => {
    // fnHalSat: linear for small excesses, never past the ceiling.
    expect(fnHalSat(0.05, 0.3)).toBeCloseTo(0.05, 2);
    expect(fnHalSat(0.3, 0.3)).toBeLessThan(0.3);
    expect(fnHalSat(200, 0.3)).toBeLessThanOrEqual(0.3);
    expect(fnHalSat(-1, 0.3)).toBe(0);
    // A clipped white, a lamp under 6 stops of headroom and a bright paper all sit at the ceiling.
    const thr = FN_HAL.threshold;
    const white = fnHalSource([1, 1, 1], thr, 6)[0], lamp = fnHalSource([64, 64, 64], thr, 6)[0];
    expect(white).toBeLessThanOrEqual(FN_HAL.srcMax);
    expect(lamp).toBeLessThanOrEqual(FN_HAL.srcMax);
    expect(lamp - white).toBeLessThan(0.02);
  });
  it('turns display light back into scene light: mid-tones stay, white opens up to 2^headroom', () => {
    expect(fnEnergy(0.18, 6)).toBe(0.18);
    expect(fnEnergy(0.7, 6)).toBe(0.7);
    expect(fnEnergy(1, 6)).toBeCloseTo(64, 6);
    expect(fnEnergy(1, 2)).toBeCloseTo(4, 6);
    let prev = 0;
    for (let i = 0; i <= 100; i++) { const e = fnEnergy(i / 100, 8); expect(e).toBeGreaterThanOrEqual(prev); prev = e; }
    // Paper white (display 0.9, linear 0.79) is barely over the knee; a clipped lamp is far above it.
    expect(fnEnergy(Math.pow(0.9, 2.2), 6)).toBeLessThan(1.1);
  });

  it('only red over the threshold bleeds, with a soft knee: teal makes none, and the reference starts at linear 0.45', () => {
    const lin = (display: number[]) => display.map(c => Math.pow(c, 2.2));
    const thr = FN_HAL.threshold;
    expect(Math.pow(2, thr)).toBeCloseTo(0.45, 2);
    // Under the knee: nothing. A grey of display 0.55 (linear 0.27) is under 0.45 × (1 − 0.3).
    expect(fnHalSource(lin([0.55, 0.55, 0.55]), thr, 6)[0]).toBe(0);
    // Over it: the excess, rising steadily (the glints in the reference bleed in proportion to it).
    const a = fnHalSource(lin([0.8, 0.8, 0.8]), thr, 6)[0], b = fnHalSource(lin([0.87, 0.87, 0.87]), thr, 6)[0];
    expect(a).toBeGreaterThan(0.1); expect(b).toBeGreaterThan(a);
    // …through the soft ceiling (fnHalSat), so a brighter source bleeds more but never past srcMax.
    const raw = (d: number) => Math.pow(d, 2.2) - Math.pow(2, thr);
    expect(b - a).toBeCloseTo(fnHalSat(raw(0.87), FN_HAL.srcMax) - fnHalSat(raw(0.8), FN_HAL.srcMax), 2);
    // Teal has no red: no bleed however bright it is.
    expect(fnHalSource(lin([0, 1, 0.94]), thr, 6)[0]).toBe(0);
    // Only light over white in every channel grows (the white source): paper at 0.9 doesn't, a clipped lamp does.
    expect(fnHalSource(lin([0.9, 0.9, 0.9]), thr, 6)[1]).toBeLessThan(0.01);
    expect(fnHalSource([1, 1, 1], thr, 6)[1]).toBeGreaterThan(0.5);
    expect(fnHalSource([1, 1, 1], thr, 6)[1]).toBeLessThanOrEqual(FN_HAL.whiteMax);
  });

  it('the radius profile: a tight max-spread (σ 4.5 px at 1080 lines) plus a Reach tail, scaled with the picture', () => {
    expect(fnHalSpread(0)).toBe(1);
    // Half strength at σ·√(2 ln 2) ≈ 5.3 px, under 2 % by 12 px: the thin edge bleed the reference shows.
    expect(fnHalSpread(4.5 * Math.sqrt(2 * Math.LN2))).toBeCloseTo(0.5, 6);
    expect(fnHalSpread(12)).toBeLessThan(0.03);
    // Measured at the dog's back (sky beside the edge), relative to 4 px: 6 px 0.59, 8 px 0.28, 10 px 0.11.
    const rel = (d: number) => fnHalSpread(d) / fnHalSpread(4);
    expect(rel(6)).toBeCloseTo(0.59, 1); expect(rel(8)).toBeCloseTo(0.28, 1); expect(rel(10)).toBeCloseTo(0.11, 1);
    // Twice the lines, twice the distance.
    expect(fnHalSpread(10, 2160)).toBeCloseTo(fnHalSpread(5, 1080), 9);
    // The tail: 0 at Reach 0, the fitted strength from 0.5, and wider (not stronger) toward 1.
    expect(fnHalTailEdge(3, 0)).toBe(0);
    expect(fnHalTailMix(0.5)).toEqual({ strength: 1, wide: 0 });
    expect(fnHalTailEdge(0, 0.5)).toBeCloseTo(FN_HAL.tail / 2, 3);
    expect(fnHalTailEdge(40, 1)).toBeGreaterThan(fnHalTailEdge(40, 0.5));
    // The whole bleed falls off steadily with distance, and Amount scales it.
    let prev = Infinity;
    for (let d = 0; d <= 60; d += 2) { const v = fnHalEdgeBleed(d, 0.3); expect(v).toBeLessThanOrEqual(prev); prev = v; }
    expect(fnHalEdgeBleed(4, 0.3, 2)).toBeCloseTo(2 * fnHalEdgeBleed(4, 0.3, 1), 9);
    // Most of it is within ~10 px: the tight part dominates near the edge.
    expect(fnHalEdgeBleed(20, 0.3)).toBeLessThan(fnHalEdgeBleed(3, 0.3) * 0.25);
  });

  it('the tint is red with a touch of orange where strong, and takes a little blue away', () => {
    const [r, g, b] = fnHalTint(0.2, FN_HAL.warmth);
    expect(r).toBe(0.2); expect(b).toBeCloseTo(-0.014, 6);
    expect(g / r).toBeGreaterThan(0.15); expect(g / r).toBeLessThan(0.3);
    // Far out (a faint bleed) it is nearly pure red.
    const far = fnHalTint(0.005, FN_HAL.warmth);
    expect(far[1] / far[0]).toBeLessThan(0.02);
    // Warmth 0 is pure red, 1 more orange.
    expect(fnHalTint(0.2, 0)[1]).toBe(0);
    expect(fnHalTint(0.2, 1)[1]).toBeGreaterThan(g);
    expect(fnHalTint(-1, 1)).toEqual([0, 0, -0]);
  });

  it('lands on the dark side of an edge only, and Conserve takes it from the bright part', () => {
    expect(fnHalReceive(0.05)).toBe(1);
    expect(fnHalReceive(0.9)).toBe(0);
    const sky = [0.29, 0.33, 0.4], dog = [0.83, 0.82, 0.8];
    const out = fnHalPixel(sky, 0.2, 0);
    expect(out[0] - sky[0]).toBeGreaterThan(0.1);
    expect(out[2]).toBeLessThan(sky[2]);
    // The bright part itself takes no bleed…
    const hi = fnHalPixel(dog, 0.5, 0, { conserve: 0 });
    hi.forEach((c, i) => expect(c).toBeCloseTo(dog[i], 9));
    // …and with Conserve loses a share of its excess, evenly: 1 takes the red down to the threshold.
    const src = dog[0] - Math.pow(2, FN_HAL.threshold);
    const kept = fnHalPixel(dog, 0.5, src, { conserve: 1 });
    expect(kept[0]).toBeCloseTo(Math.pow(2, FN_HAL.threshold), 6);
    expect(fnHalPixel(dog, 0.5, src)[1]).toBeCloseTo(dog[1] - FN_HAL.conserve * src, 6);
  });

  it('presets are in range, Classic cine is the measured default, and old effects migrate', () => {
    const params = FN_EFFECTS.halation.params;
    for (const pr of FN_HALATION_PRESETS) {
      for (const [k, v] of Object.entries(pr.values)) {
        const p = params.find(q => q.key === k)!;
        expect(p, `${pr.name}.${k}`).toBeTruthy();
        expect(v).toBeGreaterThanOrEqual(p.min); expect(v).toBeLessThanOrEqual(p.max);
      }
      expect(Object.keys(pr.values).sort()).toEqual(params.map(p => p.key).sort());
    }
    const d = fnDefaultEffect('halation', 'h');
    const classic = FN_HALATION_PRESETS.find(p => p.name === 'Classic cine')!;
    for (const [k, v] of Object.entries(classic.values)) expect(d[k]).toBe(v);
    expect(d.model).toBe(FN_HAL.model);
    // An effect saved before the model: Amount rescales (old 0.7 = new 1), the rest keeps its meaning, Conserve gets its default.
    const old = { id: 'h', kind: 'halation', enabled: true, amount: 0.7, reach: 0.55, threshold: 0.5, headroom: 6, warmth: 0.5, growth: 0.4 };
    const m = fnMigrateHalation(old);
    expect(m).toMatchObject({ amount: 1, reach: 0.55, threshold: 0.5, headroom: 6, warmth: 0.5, growth: 0.4, conserve: FN_HAL.conserve, model: FN_HAL.model });
    expect(fnMigrateHalation({ ...old, amount: 1.8 }).amount).toBe(2);
    expect(fnMigrateHalation(m)).toBe(m);
    // Through the file parser too, and a current record round-trips unchanged.
    const parsed = parseFinish({ effects: [old] })!.effects[0];
    expect(parsed).toMatchObject({ amount: 1, conserve: FN_HAL.conserve, model: FN_HAL.model });
    expect(parseFinish({ effects: [d] })!.effects[0]).toEqual(d);
  });

  it('the pass reads the half-size max-spread and the tail levels', () => {
    const { src, glow } = fnBuildFinal([fnDefaultEffect('halation', 'h')]);
    expect(glow).toBe(true);
    expect(src).toContain('uniform sampler2D uHM;');
    expect(src).toContain('halation_conserve');
  });
});

describe('time displacement: the frame ring', () => {
  it('reads frames back in the order they were drawn, across the wrap', () => {
    const ring = fnRing(4);
    expect(ring.slotFor(1)).toBe(-1);
    const slotOf: number[] = []; // frame index → slot it was written to
    for (let f = 0; f < 11; f++) { slotOf.push(ring.slotForWrite()); ring.push(); }
    expect(ring.count).toBe(4);
    // One frame back is the last drawn (frame 10), four back is frame 7; five back is gone.
    for (let back = 1; back <= 4; back++) expect(ring.slotFor(back)).toBe(slotOf[11 - back]);
    expect(ring.slotFor(5)).toBe(-1);
    ring.reset();
    expect(ring.count).toBe(0);
    expect(ring.slotForWrite()).toBe(0);
  });

  it('an offline render fills it the same way every time (first frame starts it over)', () => {
    const render = (frames: number) => {
      const ring = fnRing(8), history: number[][] = [];
      for (let f = 0; f < frames; f++) {
        if (f === 0) ring.reset();
        history.push([1, 3, 8].map(b => ring.slotFor(b)));
        ring.push();
      }
      return history;
    };
    expect(render(20)).toEqual(render(20));
  });

  it('stays under its memory cap at 1440 × 900 and at 4K', () => {
    for (const q of ['low', 'medium', 'high']) for (const [W, H] of [[1440, 900], [3840, 2160]]) {
      const s = fnRingSize(q, W, H);
      const cap = { low: 8e6, medium: 20e6, high: 48e6 }[q]!;
      expect(s.bytes, `${q} ${W}`).toBeLessThanOrEqual(cap);
      expect(s.w).toBeGreaterThan(0);
    }
    expect(fnRingSize('medium', 1440, 900).frames).toBe(32);
  });
});

describe('the pass', () => {
  it('is built from the effects that are on, the colour ones in the stack’s order', () => {
    const effects: FnEffect[] = [fnDefaultEffect('vignette', 'v'), fnDefaultEffect('grade', 'g'), { ...fnDefaultEffect('grain', 'n'), enabled: false }];
    const running = fnRunning({ on: true, effects });
    expect(running.map(e => e.kind)).toEqual(['vignette', 'grade']);
    const { src, glow, time } = fnBuildFinal(running, { tone: 'none' });
    expect(src.indexOf('c = mix(c, vec3(vignette_colorR')).toBeLessThan(src.indexOf('c = fnGrade(c);'));
    expect(src).not.toContain('grain_amount *');
    expect(glow).toBe(false); expect(time).toBe(false);
    expect(fnBuildFinal([fnDefaultEffect('halation', 'h')]).glow).toBe(true);
    expect(fnBuildFinal([fnDefaultEffect('time', 't')]).time).toBe(true);
  });

  it('costs nothing when empty, bypassed or all off', () => {
    expect(fnActive(undefined)).toBe(false);
    expect(fnActive({ on: true, effects: [] })).toBe(false);
    expect(fnActive({ on: false, effects: [fnDefaultEffect('grade', 'g')] })).toBe(false);
    expect(fnActive({ on: true, effects: [{ ...fnDefaultEffect('grade', 'g'), enabled: false }] })).toBe(false);
    expect(fnActive({ on: true, effects: [fnDefaultEffect('grade', 'g')] })).toBe(true);
    expect(fnAnimated({ on: true, effects: [fnDefaultEffect('grade', 'g')] })).toBe(false);
    expect(fnAnimated({ on: true, effects: [fnDefaultEffect('grain', 'g')] })).toBe(true);
  });

  it('uses the Studio’s own Tone Map and CRT Mask GLSL', () => {
    expect(ToneMapNode.glslFunction).toBe(FN_TONE_GLSL);
    expect(CrtMaskNode.glslFunction).toBe(FN_CRT_MASK_GLSL);
    expect(fnBuildFinal([fnDefaultEffect('grade', 'g')], { tone: 'aces' }).src).toContain('x = toneACES(x);');
  });

  it('every number of every effect has a default inside its range', () => {
    for (const k of FN_KINDS) for (const p of FN_EFFECTS[k].params) {
      expect(p.value, `${k}.${p.key}`).toBeGreaterThanOrEqual(p.min);
      expect(p.value, `${k}.${p.key}`).toBeLessThanOrEqual(p.max);
    }
  });
});

describe('the record', () => {
  const finish = (): PlayFinish => ({ on: true, effects: [{ ...newFinishEffect('grade', 'g'), exposure: 0.5 }, newFinishEffect('bloom', 'b')] });

  it('an old record (no finish) gets none, and an empty stack saves as nothing', () => {
    const r = parsePlayRecord({ controls: [], mappings: [], layers: [] });
    expect(r.finish).toBeUndefined();
    expect(parseFinish({ on: true, effects: [] })).toBeUndefined();
    expect(isFinishEmpty(undefined)).toBe(true);
    expect(isPlayRecordEmpty({ ...emptyPlayRecord(), finish: finish() })).toBe(false);
    // A bypassed stack with no effects is still worth keeping (the switch is off).
    expect(parseFinish({ on: false, effects: [] })).toEqual({ on: false, effects: [] });
  });

  it('parses a stack: unknown kinds and second copies go, numbers are clamped, missing ones defaulted', () => {
    const f = parseFinish({
      on: true,
      effects: [
        { id: 'a', kind: 'grade', exposure: 99, curves: { rgb: [0, 0.1, 1, 0.9, 'x'], hueSat: [0.2, 0.9] }, tone: 'aces' },
        { id: 'b', kind: 'sparkles' },
        { id: 'c', kind: 'grade' },
        { id: 'a', kind: 'bloom', enabled: false },
        { kind: 'time', map: 'layer', layerId: 'L', quality: 'ultra' },
      ],
    })!;
    expect(f.effects.map(e => e.kind)).toEqual(['grade', 'bloom', 'time']);
    const g = f.effects[0];
    expect(g.exposure).toBe(4);
    expect(g.contrast).toBe(0);
    expect(g.tone).toBe('aces');
    expect(g.curves!.rgb).toEqual([0, 0.1, 1, 0.9]);
    expect(g.curves!.hueSat).toEqual([0.2, 0.9]);
    expect(g.curves!.r).toEqual([0, 0, 1, 1]);
    // The bloom's id clashed with the grade's: it gets a new one, and stays off.
    expect(f.effects[1].id).not.toBe('a');
    expect(f.effects[1].enabled).toBe(false);
    expect(f.effects[2].map).toBe('layer');
    expect(f.effects[2].quality).toBe('medium');
  });

  it('round-trips through the record, with controls on its numbers kept only while their effect exists', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), finish: finish(),
      controls: [
        { id: 'c1', target: finishTarget('g', 'exposure'), kind: 'float', label: 'Grade · Exposure', min: -4, max: 4 },
        { id: 'c2', target: finishTarget('gone', 'amount'), kind: 'float', label: 'Gone', min: 0, max: 1 },
      ],
      mappings: [{ id: 'm', controlId: 'c1', source: { kind: 'mouse', axis: 'x' }, outMin: -1, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.finish).toEqual(rec.finish);
    expect(back.controls.map(c => c.id)).toEqual(['c1']);
    expect(back.mappings.map(m => m.id)).toEqual(['m']);
  });

  it('finish targets: parsed, read, driven like layer properties, and baked into an export', () => {
    expect(parseFinishTarget('finish:fx_1::exposure')).toEqual({ effectId: 'fx_1', key: 'exposure' });
    expect(parseFinishTarget('layer:x::y')).toBeNull();
    expect(parsePropTarget('finish:fx_1::exposure')).toEqual({ layerId: 'finish:fx_1', key: 'exposure' });
    const rec: PlayRecord = { ...emptyPlayRecord(), finish: finish(), controls: [{ id: 'c', target: finishTarget('g', 'exposure'), kind: 'float', label: 'E', min: -4, max: 4 }] };
    expect(readFinishValue(rec.finish, 'finish:g::exposure')).toBe(0.5);
    expect(readControlValue([], 'finish:g::exposure', rec)).toBe(0.5);
    expect(readFinishValue(rec.finish, 'finish:g::nope')).toBeUndefined();
    const baked = bakeLayerValues(rec, new Map([['c', 1.25]]));
    expect(baked.finish!.effects[0].exposure).toBe(1.25);
  });

  it('is Pro: Free plays without it and says so, Pro plays it', () => {
    const rec: PlayRecord = { ...emptyPlayRecord(), finish: finish() };
    expect(playableForPlan(rec, 'free').finish).toBeUndefined();
    expect(proOnlyParts(rec, 'free')).toContain('the Finish stack');
    expect(playableForPlan(rec, 'pro')).toBe(rec);
  });
});

describe('exports', () => {
  const input = (): PlayHtmlInput => ({
    title: 'Finish', fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }',
    uniforms: {}, paramBindings: {},
    play: { ...emptyPlayRecord(), finish: { on: true, effects: [newFinishEffect('grade', 'g'), newFinishEffect('time', 't')] } },
    aspect: '16:9',
  });

  it('carry the stack in the bundle and the Finish kit in the page', () => {
    const b = playBundle(input());
    expect(b.play.finish?.effects.map(e => e.kind)).toEqual(['grade', 'time']);
    const html = buildPlayHtml(input());
    expect(html).toContain('"finish":{"on":true');
    expect(html).toContain('function fnCreate(');
    expect(html).toContain("finish: { create: fnCreate, active: fnActive, mapLayers: fnMapLayers, usesMotion: fnUsesMotion }");
  });

  it('the inlined kit hands the page a working finish API', () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { finish: { create: unknown; active: (f: unknown) => boolean } };
    expect(typeof SSKit.finish.create).toBe('function');
    expect(SSKit.finish.active(playBundle(input()).play.finish)).toBe(true);
    expect(SSKit.finish.active({ on: false, effects: [] })).toBe(false);
  });
});
