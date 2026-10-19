/**
 * The hit detector (play/kit/audioTools.js "The hit detector"; docs/audio-tools.md "How hits are found"):
 * - band energy in dBFS (a full-scale sine is 0 dBFS) and the Value's −60 → 0 … 0 → 1;
 * - every feature tends to 0 in silence, −80 dBFS noise and a held −40 dBFS tone (never to 1 or NaN);
 * - online peak picking: one hit per onset, Min interval, the recent mean + δ, Sensitivity's δ;
 * - the Gate in dBFS with hysteresis and a hold, Track room noise lifting it over a noisy bed;
 * - live (every 5 ms, or once an animation frame stepping its new samples) and ahead agree on the same sound;
 * - a File's hits fire as playback is heard passing them, round a loop, and a small step back of the heard clock is
 *   never read as a loop (the bug that fired every hit in the file at once);
 * - an exported page's kit gives the app's numbers frame for frame.
 */
import { describe, expect, it } from 'vitest';
import {
  AT_DET_GATE_HOLD, AT_DET_HOP_SECONDS, atDetAnalyse, atDetConfig, atDetDelta, atDetFrame, atDetHop, atDetLevel, atDetMag, atDetPick,
  atDetPickAll, atEventsHeard, atHeardSpan, atNewBandRun, atNewDetector, atNewPicker, atNewSource, atStepBandRun, atStepSource,
  type AtBand, type AtSource,
} from '../../../play/kit/audioTools.js';
import { kitScript } from '../../../play/exportHtml';
import { newBand } from '../bands';
import { SR, addKick, addTone, littleSong, noiseGen } from './detectSynth';

const HOP = atDetHop(SR), HS = HOP / SR;

/** A sound's detector frames for a band (every 5 ms): odf, edb and the hits picked. */
function analyse(mono: Float32Array, b: Partial<AtBand>) {
  const cfg = atDetConfig({ preset: 'custom', ...b });
  const [c] = atDetAnalyse(mono, SR, [cfg.spec]);
  return { c, cfg, ev: atDetPickAll(c, HS, cfg) };
}

describe('band energy and the Value', () => {
  it('a full-scale sine reads 0 dBFS in its band, −20 dB lower 20 dB down; the Value maps −60 → 0, 0 → 1', () => {
    const n = 2048, s = new Float32Array(n * 2);
    for (let i = 0; i < s.length; i++) s[i] = Math.sin((2 * Math.PI * 1000 * i) / SR);
    const mag = atDetMag(s, s.length, 1024, new Float32Array(512));
    const d = atNewDetector(), spec = atDetConfig({ preset: 'custom', lo: 800, hi: 1300 }).spec;
    const e0 = atDetFrame(d, mag, spec, SR, HS).edb;
    expect(e0).toBeGreaterThan(-1);
    expect(e0).toBeLessThan(1);
    for (let i = 0; i < s.length; i++) s[i] *= 0.1;
    expect(atDetFrame(atNewDetector(), atDetMag(s, s.length, 1024, new Float32Array(512)), spec, SR, HS).edb).toBeCloseTo(e0 - 20, 0);
    expect([atDetLevel(-60), atDetLevel(-30), atDetLevel(0), atDetLevel(-90)]).toEqual([0, 0.5, 1, 0]);
  });
});

describe('silence and steady sound', () => {
  const quiet = (kind: 'zero' | 'noise' | 'tone') => {
    const m = new Float32Array(3 * SR), rnd = noiseGen(5);
    if (kind === 'noise') for (let i = 0; i < m.length; i++) m[i] = rnd() * 1e-4 * Math.sqrt(3);
    if (kind === 'tone') addTone(m, 440, 0, 3, Math.pow(10, -40 / 20) * Math.SQRT2, 1, 0.05);
    return m;
  };
  it('the onset function tends to 0 (not 1, not NaN): digital silence, −80 dBFS noise, a held −40 dBFS tone', () => {
    for (const kind of ['zero', 'noise', 'tone'] as const) {
      for (const preset of ['kick', 'snare', 'hats', 'notes', 'custom'] as const) {
        const { c, ev } = analyse(quiet(kind), { preset, ...(preset === 'custom' ? { lo: 200, hi: 2000 } : {}) });
        // After the tone's own start (its first 0.3 s).
        let mx = 0;
        for (let i = Math.round(0.3 / HS); i < c.odf.length; i++) { expect(Number.isFinite(c.odf[i])).toBe(true); mx = Math.max(mx, c.odf[i]); }
        expect({ kind, preset, mx: mx < 0.05 }).toEqual({ kind, preset, mx: true });
        expect({ kind, preset, hits: Array.from(ev.times).filter(t => t > 0.3) }).toEqual({ kind, preset, hits: [] });
      }
    }
  });
});

describe('peak picking', () => {
  const cfg = (o: Record<string, unknown> = {}) => ({ ...atDetConfig({ preset: 'custom' }), gateDb: -200, trackNoise: false, ...o });
  /** Step the picker through odf values (energy 0 dBFS: the Gate open), one per 5 ms: the hit times. */
  const pick = (xs: number[], c = cfg()) => { const p = atNewPicker(), out: number[] = []; xs.forEach((x, i) => { if (atDetPick(p, x, 0, i * HS, HS, c)) out.push(+(i * HS).toFixed(4)); }); return out; };

  it('a spike fires once, on its rise; a plateau never again; Min interval swallows a second spike', () => {
    const one = [0, 0, 0, 0.9, 1, 0.8, 0.5, 0.2, 0, 0, 0];
    expect(pick(one)).toEqual([0.015]);
    expect(pick([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toEqual([0.01]);
    const two = [0, 0, 1, 0, 0, 0, 0, 1, 0, 0];
    expect(pick(two, cfg({ minInterval: 0.02 }))).toEqual([0.01, 0.035]);
    expect(pick(two, cfg({ minInterval: 0.05 }))).toEqual([0.01]);
  });

  it('the recent mean + δ: a small bump over a busy stretch doesn\'t fire, the same bump over quiet does', () => {
    const busy = Array.from({ length: 30 }, (_, i): number => (i % 2 ? 0.5 : 0.45)).concat([0.6, 0.45, 0.45]);
    const calm = Array.from({ length: 30 }, () => 0).concat([0.6, 0, 0]);
    expect(pick(busy, cfg({ minInterval: 0.01 })).filter(t => t >= 0.15)).toEqual([]);
    expect(pick(calm)).toEqual([0.15]);
  });

  it('Sensitivity: δ = the preset\'s × 4^(0.5 − Sensitivity), 2× at 0, ½× at 1', () => {
    expect(atDetDelta(0.25, 0.5)).toBeCloseTo(0.25);
    expect(atDetDelta(0.25, 0)).toBeCloseTo(0.5);
    expect(atDetDelta(0.25, 1)).toBeCloseTo(0.125);
    expect(atDetConfig({ preset: 'kick', sensitivity: 1 }).delta).toBeLessThan(atDetConfig({ preset: 'kick', sensitivity: 0 }).delta);
  });

  it('the Gate (dBFS): opens at its line, closes 6 dB under it after the hold, and nothing fires while it is shut', () => {
    const c = cfg({ gateDb: -40 }), p = atNewPicker();
    expect(atDetPick(p, 1, -50, 0, HS, c)).toBe(0);
    expect(p.open).toBe(false);
    atDetPick(p, 0, -39, HS, HS, c);
    expect(p.open).toBe(true);
    // 3 dB under: stays open however long; 7 dB under: shut after the hold.
    for (let i = 0; i < 40; i++) atDetPick(p, 0, -43, (2 + i) * HS, HS, c);
    expect(p.open).toBe(true);
    let t = 50 * HS;
    for (let k = 0; t < 50 * HS + AT_DET_GATE_HOLD - HS; k++, t += HS) atDetPick(p, 0, -47, t, HS, c);
    expect(p.open).toBe(true);
    atDetPick(p, 0, -47, t, HS, c); atDetPick(p, 0, -47, t + HS, HS, c);
    expect(p.open).toBe(false);
  });

  it('Track room noise lifts the Gate to 10 dB over a noisy bed, so a hit has to stand out of it', () => {
    const c = cfg({ gateDb: -80, trackNoise: true }), p = atNewPicker();
    for (let i = 0; i < 600; i++) atDetPick(p, 0, -50 + (i % 3), i * HS, HS, c);
    // Minimum tracking sits a little under the bed's mean.
    expect(p.noiseDb).toBeGreaterThan(-56);
    expect(p.noiseDb).toBeLessThan(-46);
    expect(p.gateLine).toBeGreaterThan(-45);
    expect(atDetPick(p, 1, -47, 600 * HS, HS, c)).toBe(0);
  });
});

describe('live and ahead', () => {
  it('a kick train: ahead, live every 5 ms and live at 60 fps find the same kicks', () => {
    const m = new Float32Array(4 * SR), times = [0.3, 0.8, 1.3, 1.8, 2.3, 2.8, 3.3];
    addTone(m, 55, 0, 4, 0.2, 2, 0.05);
    for (const t of times) addKick(m, t);
    const band = { ...newBand([], 'kick') } as AtBand;
    // The bass starting (at 0) is an onset in the band too: only the kicks after it are counted.
    const ahead = Array.from(analyse(m, band).ev.times).filter(t => t > 0.1);
    expect(ahead.length).toBe(times.length);
    ahead.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(0.03));
    for (const step of [HOP, SR / 60]) {
      const run = atNewBandRun(), buf = new Float32Array(4096), hits: number[] = [];
      for (let f = 1; f * step <= m.length; f++) {
        const end = Math.round(f * step);
        for (let i = 0; i < buf.length; i++) { const k = end - buf.length + i; buf[i] = k >= 0 ? m[k] : 0; }
        atStepBandRun(run, band, buf, SR, end / SR, step / SR);
        if (run.hit.trigger && end / SR > 0.1) hits.push(end / SR);
      }
      expect(hits.length).toBe(times.length);
      // Decided within a hop or two of the window seeing the kick; at 60 fps told up to a frame later.
      hits.forEach((t, i) => expect(t - times[i]).toBeLessThan(0.03 + step / SR));
    }
  });
});

describe('a File\'s hits, as playback is heard', () => {
  it('fire the hits playback is heard passing, round a loop too', () => {
    const ev = { times: Float64Array.from([0.25, 0.75, 1.3, 1.82]), strengths: Float32Array.from([1, 1, 1, 1]) };
    const win = { start: 0.5, end: 2 };
    expect(atEventsHeard(ev, 0.7, 0.76, win, true).count).toBe(1);
    expect(atEventsHeard(ev, 0.76, 1.2, win, true).count).toBe(0);
    expect(atEventsHeard(ev, 1.7, 0.52, win, true).count).toBe(1);
    expect(atEventsHeard(ev, 1.9, 0.8, win, false).count).toBe(0);
  });

  it('a small step back of the heard clock is its wobble, not a loop: nothing heard, the old place kept', () => {
    const win = { start: 0, end: 8 };
    expect(atHeardSpan(3.0, 3.016, win, true)).toEqual({ from: 3.0, to: 3.016, keep: 3.016 });
    // 40 ms back (getOutputTimestamp against the latencies): nothing, and next frame goes on from 3.0.
    expect(atHeardSpan(3.0, 2.96, win, true)).toEqual({ from: 3.0, to: 3.0, keep: 3.0 });
    // Round the loop's end: the shorter way is round.
    expect(atHeardSpan(7.99, 0.006, win, true)).toEqual({ from: 7.99, to: 0.006, keep: 0.006 });
    // A real jump back (a seek inside the same run): start again there.
    expect(atHeardSpan(5, 2, win, true)).toEqual({ from: 2, to: 2, keep: 2 });
    expect(atHeardSpan(null, 1, win, true)).toEqual({ from: 1, to: 1, keep: 1 });
  });
});

describe('an exported page', () => {
  it('runs every preset with the app\'s numbers, frame for frame', () => {
    const song = littleSong(3);
    const bands = (['kick', 'snare', 'hats', 'notes', 'bass'] as const).map((k, i) => ({ ...newBand([], k), id: `p${i}`, value: true }));
    const SSKit = new Function(`${kitScript(new Set(['audioTools']))}\nreturn SSKit;`)() as {
      audioTools: { newSource(): AtSource; stepSource(...a: unknown[]): void };
    };
    const page = SSKit.audioTools.newSource(), app = atNewSource();
    let frames = 0, fired = 0;
    const step = SR / 60, buf = new Float32Array(4096), freq = new Float32Array(1024).fill(-100);
    for (let f = 1; f * step <= song.mono.length; f++) {
      const end = Math.round(f * step);
      for (let i = 0; i < buf.length; i++) { const k = end - buf.length + i; buf[i] = k >= 0 ? song.mono[k] : 0; }
      const A = new Map<string, number>(), P = new Map<string, number>();
      atStepSource(app, bands, [], new Float32Array(freq), SR, end / SR, 1 / 60, (ch, v) => A.set(ch, v), { wave: new Float32Array(buf) });
      SSKit.audioTools.stepSource(page, bands, [], new Float32Array(freq), SR, end / SR, 1 / 60, (ch: string, v: number) => P.set(ch, v), { wave: new Float32Array(buf) });
      expect([...P]).toEqual([...A]);
      for (const [k, v] of A) if (k.endsWith('_t') && v) fired++;
      frames++;
    }
    expect(frames).toBeGreaterThan(150);
    expect(fired).toBeGreaterThan(20);
    expect(AT_DET_HOP_SECONDS).toBe(0.005);
  });
});
