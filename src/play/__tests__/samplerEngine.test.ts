/**
 * The Sampler's engine (play/kit/sampler.js, docs/sampler.md) rendered through
 * real Web Audio in Node (node-web-audio-api), into buffers only — nothing
 * reaches a speaker. Timing to the sample, envelope stages and slopes, chokes
 * without clicks, loops with a crossfade, filters, pitch envelopes, LFO,
 * voices; and the pure parts: note names, roots from file names, zero
 * crossings, transient slicing, zone picks and round robin.
 */
import { describe, expect, it } from 'vitest';
import { OfflineAudioContext as NodeOffline } from 'node-web-audio-api';
import { dpCreateSampler, dpSynthData } from '../kit/drumPads.js';
import {
  SM_PARAMS, smCreateSampler, smEnvAt, smEnvSegments, smHits, smLoopBuffer, smNoteName, smNoteOf, smNumbers, smPadOfNote, smNoteOfPad,
  smReleaseAt, smRootFromName, smShape, smSnap, smTransients, smVelGain, smZeroCrossing,
} from '../kit/sampler.js';

const RATE = 44100;
const offline = (secs: number, ch = 2) => new NodeOffline(ch, Math.ceil(secs * RATE), RATE) as unknown as OfflineAudioContext;
function buf(ctx: BaseAudioContext, secs: number, f: (i: number) => number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(secs * RATE), RATE);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = f(i);
  return b;
}
const dc = (ctx: BaseAudioContext, secs: number) => buf(ctx, secs, () => 1);
const firstLoud = (d: Float32Array, over = 1e-4) => d.findIndex(v => Math.abs(v) > over);
const maxStep = (d: Float32Array, from = 0, to = d.length) => { let m = 0; for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(d[i] - d[i - 1])); return m; };
const flat = { attack: 0, decay: 0, sustain: 1, release: 0.05, volume: 1, pan: 0, vel: 0 };
async function render(secs: number, play: (ctx: OfflineAudioContext) => void, ch = 1): Promise<Float32Array> {
  const ctx = offline(secs, ch);
  play(ctx);
  const r = await ctx.startRendering();
  return r.getChannelData(0);
}

describe('pure parts', () => {
  it('note names are Live’s (C3 = 60, C1 = 36) both ways', () => {
    expect(smNoteName(60)).toBe('C3');
    expect(smNoteName(36)).toBe('C1');
    expect(smNoteName(0)).toBe('C-2');
    expect(smNoteName(61)).toBe('C#3');
    expect(smNoteOf('C3')).toBe(60);
    expect(smNoteOf('F#1')).toBe(42);
    expect(smNoteOf('Bb-1')).toBe(22);
    expect(smNoteOf('H2')).toBe(-1);
  });
  it('a file name’s note is its root key, else C3', () => {
    expect(smRootFromName('Cello_A2.wav')).toBe(57);
    expect(smRootFromName('piano-c#3.aif')).toBe(61);
    expect(smRootFromName('Pad 48.wav')).toBe(48);
    expect(smRootFromName('Kick Deep.wav')).toBe(60);
    expect(smRootFromName('Bass E1 soft.wav')).toBe(40);
    // A letter-and-digit inside a word isn't a note.
    expect(smRootFromName('Shaker2.wav')).toBe(60);
    expect(smRootFromName('loop.wav', 36)).toBe(36);
  });
  it('pads are notes from the base, wrapping round 128', () => {
    expect(smNoteOfPad(0, 36)).toBe(36);
    expect(smNoteOfPad(15, 36)).toBe(51);
    expect(smNoteOfPad(127, 36)).toBe(35);
    expect(smPadOfNote(35, 36)).toBe(127);
    expect(smPadOfNote(36, 36)).toBe(0);
  });
  it('slopes bend a stage and keep its ends', () => {
    expect(smShape(0.5, 0)).toBeCloseTo(0.5);
    expect(smShape(0, 0.7)).toBe(0);
    expect(smShape(1, -0.7)).toBeCloseTo(1);
    expect(smShape(0.25, 0.8)).toBeGreaterThan(0.6); // up: fast first
    expect(smShape(0.25, -0.8)).toBeLessThan(0.05); // down: slow first
  });
  it('the envelope reaches each level at the right time, slopes or not', () => {
    for (const [as, ds] of [[0, 0], [0.6, 0.6], [-0.5, 0.9]]) {
      expect(smEnvAt(0, 0.1, 0.2, 0.5, as, ds)).toBe(0);
      expect(smEnvAt(0.1, 0.1, 0.2, 0.5, as, ds)).toBeCloseTo(1, 5);
      expect(smEnvAt(0.3, 0.1, 0.2, 0.5, as, ds)).toBeCloseTo(0.5, 5);
      expect(smEnvAt(2, 0.1, 0.2, 0.5, as, ds)).toBe(0.5);
    }
    // Flat stages are straight lines (the old drum pads').
    expect(smEnvAt(0.05, 0.1, 0.2, 0.5)).toBeCloseTo(0.5);
    expect(smEnvAt(0.2, 0.1, 0.2, 0.5)).toBeCloseTo(0.75);
    // A positive decay slope falls faster first.
    expect(smEnvAt(0.15, 0.1, 0.2, 0, 0, 0.8)).toBeLessThan(smEnvAt(0.15, 0.1, 0.2, 0));
    expect(smReleaseAt(0, 0.5)).toBe(1);
    expect(smReleaseAt(0.25, 0.5)).toBeCloseTo(0.5);
    expect(smReleaseAt(0.5, 0.5)).toBe(0);
  });
  it('a one-shot’s envelope is cut at its end with a fade', () => {
    const segs = smEnvSegments(0.01, 0.2, 0.5, 0, 0, 0.1, 0.003);
    const last = segs[segs.length - 1];
    expect(last.t1).toBeCloseTo(0.1);
    expect(last.t0).toBeCloseTo(0.097);
    expect(last.v1).toBe(0);
    expect(last.v0).toBeCloseTo(smEnvAt(0.097, 0.01, 0.2, 0.5));
  });
  it('velocity: amount and curve', () => {
    expect(smVelGain(0.5, 1, 0)).toBeCloseTo(0.5);
    expect(smVelGain(0.5, 0, 0)).toBe(1);
    expect(smVelGain(0.5, 1, 0.5)).toBeGreaterThan(0.5);
    expect(smVelGain(0.5, 1, -0.5)).toBeLessThan(0.5);
    expect(smVelGain(1, 1, -1)).toBeCloseTo(1);
  });
  it('zero crossings: the nearest sign change', () => {
    const d = new Float32Array(1000).map((_, i) => Math.sin((i / 100) * Math.PI * 2));
    const z = smZeroCrossing(d, 47, 100);
    expect(z === 50 || z === 51).toBe(true);
    expect(Math.abs(d[z])).toBeLessThan(0.07);
    const x = smSnap(d, 0.248);
    expect(Math.abs(d[Math.round(x * 999)])).toBeLessThan(0.07);
  });
  it('transients: one slice per click in a click train', () => {
    const sr = 44100, d = new Float32Array(sr * 2);
    const at = [0.1, 0.45, 0.8, 1.2, 1.55];
    for (const t of at) { const s = Math.round(t * sr); for (let i = 0; i < 2000; i++) d[s + i] = Math.sin(i * 0.3) * Math.exp(-i / 300); }
    const cuts = smTransients(d, sr, 0.5);
    expect(cuts[0]).toBe(0);
    const found = cuts.slice(1).map(x => x * 2);
    expect(found.length).toBe(at.length);
    found.forEach((t, i) => expect(Math.abs(t - at[i])).toBeLessThan(0.006));
  });
  it('defaults are the old drum pads’ numbers', () => {
    const o = smNumbers(() => undefined);
    expect(o).toMatchObject({ start: 0, end: 1, pitch: 0, volume: 0.8, pan: 0, attack: 0.001, decay: 0.2, sustain: 1, release: 0.05, vel: 1 });
    expect(o).toMatchObject({ aSlope: 0, dSlope: 0, rSlope: 0, fEnv: 0, pEnv: 0, lfoAmt: 0, glide: 0, velCurve: 0, fadeOut: 0.003 });
    expect(SM_PARAMS.length).toBeGreaterThan(30);
  });
});

describe('the sampler', () => {
  it('a hit at time t starts on t’s sample (±1)', async () => {
    for (const t of [0.0123, 0.25, 0.3333]) {
      const d = await render(0.5, ctx => {
        const s = smCreateSampler(ctx);
        s.output.connect(ctx.destination);
        s.hit(0, { ...flat, buffer: dc(ctx, 0.1) }, t);
      });
      expect(Math.abs(firstLoud(d) - Math.round(t * RATE))).toBeLessThanOrEqual(1);
    }
  });
  it('envelope: attack reaches 1 at A, decay reaches S at A+D, then holds', async () => {
    const d = await render(1, ctx => {
      const s = smCreateSampler(ctx);
      s.output.connect(ctx.destination);
      s.hit(0, { ...flat, mode: 'gate', attack: 0.1, decay: 0.2, sustain: 0.4, buffer: dc(ctx, 1) }, 0);
    });
    expect(d[Math.round(0.05 * RATE)]).toBeCloseTo(0.5, 2);
    expect(d[Math.round(0.1 * RATE)]).toBeCloseTo(1, 2);
    expect(d[Math.round(0.2 * RATE)]).toBeCloseTo(0.7, 2);
    expect(d[Math.round(0.3 * RATE)]).toBeCloseTo(0.4, 2);
    expect(d[Math.round(0.6 * RATE)]).toBeCloseTo(0.4, 2);
  });
  it('sloped stages follow the curve and stay smooth', async () => {
    const o = { ...flat, mode: 'gate' as const, attack: 0.1, decay: 0.3, sustain: 0.2, aSlope: 0.6, dSlope: 0.8 };
    const d = await render(0.8, ctx => {
      const s = smCreateSampler(ctx);
      s.output.connect(ctx.destination);
      s.hit(0, { ...o, buffer: dc(ctx, 1) }, 0);
    });
    for (const t of [0.03, 0.1, 0.15, 0.25, 0.4, 0.6]) expect(d[Math.round(t * RATE)]).toBeCloseTo(smEnvAt(t, 0.1, 0.3, 0.2, 0.6, 0.8), 2);
    expect(maxStep(d, 0, Math.round(0.7 * RATE))).toBeLessThan(0.01);
  });
  it('release goes from wherever the level is to 0 over Release, shaped', async () => {
    const d = await render(1, ctx => {
      const s = smCreateSampler(ctx);
      s.output.connect(ctx.destination);
      s.hit(0, { ...flat, mode: 'gate', sustain: 0.5, decay: 0.1, release: 0.2, rSlope: 0.5, buffer: dc(ctx, 1) }, 0);
      s.release(0, 0.3);
    });
    expect(d[Math.round(0.299 * RATE)]).toBeCloseTo(0.5, 2);
    expect(d[Math.round(0.4 * RATE)]).toBeCloseTo(0.5 * smReleaseAt(0.1, 0.2, 0.5), 2);
    expect(Math.abs(d[Math.round(0.505 * RATE)])).toBeLessThan(1e-3);
    // Smooth after the 1 ms attack.
    expect(maxStep(d, 100)).toBeLessThan(0.001);
  });
  it('a choke cuts within 4 ms with no click', async () => {
    const d = await render(0.5, ctx => {
      const s = smCreateSampler(ctx);
      s.output.connect(ctx.destination);
      // A loud low sine (an open hat stand-in), then a silent hit in the same group.
      s.hit(0, { ...flat, choke: 1, buffer: buf(ctx, 1, i => 0.9 * Math.sin(i * 2 * Math.PI * 110 / RATE)) }, 0);
      s.hit(1, { ...flat, choke: 1, buffer: buf(ctx, 0.2, () => 0) }, 0.2);
    });
    const c = Math.round(0.2 * RATE);
    expect(Math.abs(d[c + Math.round(0.0045 * RATE)])).toBeLessThan(1e-3);
    // No step bigger than the sine's own (2π·110/44100·0.9 ≈ 0.014) around the cut.
    expect(maxStep(d, c - 200, c + 400)).toBeLessThan(0.016);
  });
  it('voices: the oldest is faded out to make room', async () => {
    const d = await render(0.6, ctx => {
      const s = smCreateSampler(ctx, { voices: 2 });
      s.output.connect(ctx.destination);
      for (let i = 0; i < 3; i++) s.hit(i, { ...flat, buffer: dc(ctx, 1) }, i * 0.1);
    });
    expect(d[Math.round(0.15 * RATE)]).toBeCloseTo(2, 2);
    // The third hit takes the first's place: still two.
    expect(d[Math.round(0.25 * RATE)]).toBeCloseTo(2, 2);
    expect(maxStep(d, Math.round(0.19 * RATE), Math.round(0.21 * RATE))).toBeLessThan(0.3);
  });
  it('a loop with a crossfade wraps continuously', async () => {
    // A ramp that jumps at the loop's end: without a crossfade the wrap is a step of ~0.5.
    const ctx = offline(0.1);
    const b = buf(ctx, 1, i => (i / RATE) * 0.5);
    const baked = smLoopBuffer(ctx, b, 0.4, 0.8, 0.05);
    const x = baked.getChannelData(0), le = Math.round(0.8 * RATE), ls = Math.round(0.4 * RATE);
    expect(Math.abs(x[le - 1] - x[ls - 1])).toBeLessThan(1e-3);
    expect(Math.abs(x[ls] - x[le - 1])).toBeLessThan(1e-3);
    expect(maxStep(x, le - 2300, le)).toBeLessThan(0.002);
    const d = await render(1.2, c2 => {
      const s = smCreateSampler(c2);
      s.output.connect(c2.destination);
      s.hit(0, { ...flat, mode: 'gate', loop: true, loopStart: 0.4, loopEnd: 0.8, xfade: 0.05, buffer: buf(c2, 1, i => (i / RATE) * 0.5) }, 0);
    });
    expect(maxStep(d, 100, d.length)).toBeLessThan(0.002);
  });
  it('the pitch envelope bends the pitch and comes back', async () => {
    // A sine at 441 Hz with a +12 st pitch envelope decaying over 50 ms: early it runs at twice the speed.
    const d = await render(0.5, ctx => {
      const s = smCreateSampler(ctx);
      s.output.connect(ctx.destination);
      s.hit(0, { ...flat, mode: 'gate', pEnv: 12, pA: 0.001, pD: 0.05, pS: 0, buffer: buf(ctx, 2, i => Math.sin(i * 2 * Math.PI * 441 / RATE)) }, 0);
    });
    const zc = (a: number, b: number) => { let n = 0; for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) n++; return n; };
    expect(zc(Math.round(0.002 * RATE), Math.round(0.012 * RATE))).toBeGreaterThan(14);
    expect(zc(Math.round(0.3 * RATE), Math.round(0.4 * RATE))).toBeGreaterThanOrEqual(87);
    expect(zc(Math.round(0.3 * RATE), Math.round(0.4 * RATE))).toBeLessThanOrEqual(90);
  });
  it('the low-pass filter takes the highs off, and its envelope opens it', async () => {
    const noise = (ctx: BaseAudioContext) => { let x = 1; return buf(ctx, 1, () => { x = (x * 16807) % 2147483647; return x / 2147483647 * 2 - 1; }); };
    const rmsOf = (d: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / (b - a)); };
    const open = await render(0.5, ctx => { const s = smCreateSampler(ctx); s.output.connect(ctx.destination); s.hit(0, { ...flat, mode: 'gate', buffer: noise(ctx) }, 0); });
    const closed = await render(0.5, ctx => { const s = smCreateSampler(ctx); s.output.connect(ctx.destination); s.hit(0, { ...flat, mode: 'gate', filter: 'lp24', cutoff: 200, buffer: noise(ctx) }, 0); });
    const swept = await render(0.5, ctx => { const s = smCreateSampler(ctx); s.output.connect(ctx.destination); s.hit(0, { ...flat, mode: 'gate', filter: 'lp24', cutoff: 200, fEnv: 60, fA: 0.001, fD: 0.1, fS: 0, buffer: noise(ctx) }, 0); });
    expect(rmsOf(closed, 4410, 8820)).toBeLessThan(rmsOf(open, 4410, 8820) * 0.2);
    expect(rmsOf(swept, 100, 1000)).toBeGreaterThan(rmsOf(closed, 100, 1000) * 2);
    expect(rmsOf(swept, 15000, 20000)).toBeCloseTo(rmsOf(closed, 15000, 20000), 1);
  });
  it('the LFO on amp makes a tremolo at its rate', async () => {
    const d = await render(1, ctx => { const s = smCreateSampler(ctx); s.output.connect(ctx.destination); s.hit(0, { ...flat, mode: 'gate', lfoTo: 'amp', lfoAmt: 1, lfoRate: 5, buffer: dc(ctx, 2) }, 0); });
    let lo = 9, hi = 0;
    for (let i = 4410; i < 44100; i++) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    expect(lo).toBeLessThan(0.05);
    expect(hi).toBeGreaterThan(0.95);
    // 5 Hz: the peak a fifth of a second after the first.
    expect(d[Math.round(0.05 * RATE)]).toBeCloseTo(d[Math.round(0.25 * RATE)], 1);
  });
  it('defaults render exactly like the old drum pads’ sampler', async () => {
    const kick = dpSynthData('kick', RATE), hat = dpSynthData('openhat', RATE);
    const hits = [
      { pad: 0, at: 0.01, o: { start: 0, end: 1, pitch: 0, volume: 0.8, pan: 0, attack: 0.001, decay: 0.2, sustain: 1, release: 0.05, vel: 1, mode: 'oneshot', velocity: 0.7 }, data: kick },
      { pad: 1, at: 0.2, o: { start: 0.1, end: 0.8, pitch: 5, volume: 1.2, pan: -0.4, attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.05, vel: 0.5, mode: 'oneshot', reverse: true, velocity: 0.4 }, data: hat },
      { pad: 2, at: 0.33, o: { start: 0, end: 0.5, pitch: -3, volume: 0.6, pan: 0.5, attack: 0.001, decay: 0.05, sustain: 0.3, release: 0.1, vel: 1, mode: 'gate', loop: true, velocity: 1 }, data: hat },
    ];
    const run = async (make: (ctx: BaseAudioContext) => { output: AudioNode; hit: (p: number, o: never, w: number) => unknown; release: (p: number, w?: number) => void }) => {
      const ctx = offline(0.8);
      const s = make(ctx);
      s.output.connect(ctx.destination);
      for (const h of hits) {
        const b = ctx.createBuffer(1, h.data.length, RATE);
        b.getChannelData(0).set(h.data);
        s.hit(h.pad, { ...h.o, buffer: b } as never, h.at);
      }
      // Can't release at a time in the future reliably on both: release at the start, schedule-wise identical.
      const r = await ctx.startRendering();
      return [r.getChannelData(0), r.getChannelData(1)];
    };
    const [oldL, oldR] = await run(ctx => dpCreateSampler(ctx) as never);
    const [newL, newR] = await run(ctx => smCreateSampler(ctx) as never);
    let err = 0;
    for (let i = 0; i < oldL.length; i++) err = Math.max(err, Math.abs(oldL[i] - newL[i]), Math.abs(oldR[i] - newR[i]));
    expect(err).toBeLessThan(1e-4);
  });
});

describe('a hit’s voices from a layer', () => {
  const zone = (over: Record<string, unknown>) => ({ id: 1, sampleId: 's', fileName: 'x', bytes: 0, synth: '', name: '', lo: 0, hi: 127, root: 60, vlo: 1, vhi: 127, tune: 0, detune: 0, gain: 1, pan: 0, start: 0, end: 1, loopStart: 0, loopEnd: 1, xfade: 0, loop: false, reverse: false, track: true, ...over });
  const keys = (zones: unknown[], inst: Record<string, unknown> = {}) => ({ view: 'keys', baseNote: 0, pads: [], zones, inst: { mode: 'classic', select: 'all', seed: 0, voices: 8, retrigger: true, legato: false, filter: 'off', lfoShape: 'sine', lfoTo: 'pitch', ...inst } });
  const B = {} as AudioBuffer;
  const env = () => ({ num: () => undefined, buffer: () => B, state: { hits: 0, lastPitch: null } });
  it('key and velocity ranges pick the zones', () => {
    const l = keys([zone({ id: 1, lo: 0, hi: 59 }), zone({ id: 2, lo: 60, hi: 127, vlo: 1, vhi: 63 }), zone({ id: 3, lo: 60, hi: 127, vlo: 64, vhi: 127 })]);
    const e = env();
    expect(smHits(l, 40, 0.8, e).voices.length).toBe(1);
    const soft = smHits(l, 64, 0.3, e), hard = smHits(l, 64, 0.9, e);
    expect(soft.voices.length).toBe(1);
    expect(hard.voices.length).toBe(1);
    expect(soft.voices[0].o).not.toBe(hard.voices[0].o);
    // Overlaps layer by default.
    expect(smHits(keys([zone({}), zone({ id: 2 })]), 60, 1, env()).voices.length).toBe(2);
  });
  it('pitch tracking: semitones from the root key, or none', () => {
    const e = env();
    expect(smHits(keys([zone({ root: 60 })]), 72, 1, e).voices[0].o.pitch).toBe(12);
    expect(smHits(keys([zone({ root: 60 })]), 53, 1, e).voices[0].o.pitch).toBe(-7);
    expect(smHits(keys([zone({ root: 60, track: false })]), 72, 1, e).voices[0].o.pitch).toBe(0);
    expect(smHits(keys([zone({ root: 57, tune: 2 })]), 57, 1, e).voices[0].o.pitch).toBe(2);
  });
  it('round robin cycles through overlapping zones; random is seeded; a take’s slot repeats', () => {
    const zs = [zone({ id: 1 }), zone({ id: 2 }), zone({ id: 3 })];
    const l = keys(zs, { select: 'cycle' });
    const e = env();
    const slots = Array.from({ length: 6 }, () => smHits(l, 60, 1, e).slot);
    expect(slots).toEqual([1, 2, 3, 1, 2, 3]);
    const r = keys(zs, { select: 'random', seed: 7 });
    const a = Array.from({ length: 8 }, (_, i) => smHits(r, 60, 1, { ...env(), state: { hits: i, lastPitch: null } }).slot);
    const b = Array.from({ length: 8 }, (_, i) => smHits(r, 60, 1, { ...env(), state: { hits: i, lastPitch: null } }).slot);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1);
    expect(smHits(l, 60, 1, env(), 3).voices.length).toBe(1);
    expect(smHits(l, 60, 1, env(), 3).slot).toBe(3);
  });
  it('slice mode: pad k plays slice k', () => {
    const l = keys([zone({ slices: [0, 0.25, 0.5, 0.75] })], { mode: 'slice' });
    const h = smHits(l, 2, 1, env());
    expect(h.voices[0].o.region).toEqual({ start: 0.5, end: 0.75 });
    expect(smHits(l, 3, 1, env()).voices[0].o.region).toEqual({ start: 0.75, end: 1 });
    expect(smHits(l, 4, 1, env()).voices.length).toBe(0);
    expect(h.voices[0].o.mode).toBe('oneshot');
  });
  it('glide starts from the last note', () => {
    const l = keys([zone({})]);
    const e = { num: (k: string) => (k === 'k_glide' ? 0.1 : undefined), buffer: () => B, state: { hits: 0, lastPitch: null } };
    expect(smHits(l, 60, 1, e).voices[0].o.glideFrom).toBeUndefined();
    expect(smHits(l, 67, 1, e).voices[0].o.glideFrom).toBe(-7);
  });
});
