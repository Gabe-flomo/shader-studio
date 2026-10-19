/**
 * The Audio nodes' sums on synthetic sound (docs/audio-tools.md): band energy from a sine, a Hit on a click train
 * (the count, Min interval, nothing on a held tone), the log frequency layout and the spectrogram's scroll.
 */
import { describe, expect, it } from 'vitest';
import {
  bandLevel, follow, hzAt, newBandState, rmsLevel, scrollRows, spectrumBins, spectrumDb, stepBand, waveRow, xOfHz,
} from '../dsp';
import { atNewListener, atStepListener, type AtListenerSpec } from '../../../play/kit/audioTools.js';

const SR = 48000, FFT = 2048, HOP = 800; // 60 frames a second

const sine = (hz: number, amp: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

/** Decaying 60 Hz thumps (a kick) at the given times. */
function kicks(times: number[], seconds: number): Float32Array {
  const s = new Float32Array(Math.round(seconds * SR));
  for (const t0 of times) {
    const a = Math.round(t0 * SR);
    for (let i = 0; i < 0.15 * SR && a + i < s.length; i++) s[a + i] += 0.8 * Math.exp(-i / SR / 0.06) * Math.sin((2 * Math.PI * 60 * i) / SR);
  }
  return s;
}

/** Short noise bursts (hi-hat-like clicks) every `every` seconds. */
function clicks(every: number, seconds: number): Float32Array {
  const s = new Float32Array(Math.round(seconds * SR));
  let seed = 3;
  for (let t = 0.2; t < seconds; t += every) {
    const a = Math.round(t * SR);
    for (let i = 0; i < 0.03 * SR && a + i < s.length; i++) { seed = (seed * 16807) % 2147483647; s[a + i] = ((seed / 2147483647) * 2 - 1) * 0.5 * Math.exp(-i / SR / 0.008); }
  }
  return s;
}

describe('band energy', () => {
  it('a 100 Hz sine is loud in its band and quiet elsewhere', () => {
    const block = sine(100, 0.5, FFT / SR);
    const db = spectrumDb(block);
    expect(bandLevel(db, SR, 30, 150)).toBeGreaterThan(0.45);
    expect(bandLevel(db, SR, 2000, 8000)).toBeLessThan(0.15);
    expect(rmsLevel(block)).toBeGreaterThan(0.7);
    expect(rmsLevel(new Float32Array(FFT))).toBe(0);
  });

  it('follows with attack and release, and the peak holds then falls', () => {
    expect(follow(0, 1, 0.1, 0, 1)).toBe(1);
    expect(follow(0, 1, 0.1, 0.1, 1)).toBeCloseTo(1 - Math.exp(-1), 5);
    let s = newBandState();
    s = stepBand(s, 0.8, 1 / 60, 0, 0.2, 1);
    expect(s.level).toBeCloseTo(0.8);
    expect(s.peak).toBeCloseTo(0.8);
    for (let i = 0; i < 30; i++) s = stepBand(s, 0, 1 / 60, 0, 0.2, 1);
    expect(s.level).toBeLessThan(0.15);
    expect(s.peak).toBeCloseTo(0.8); // still held (under 0.6 s)
    for (let i = 0; i < 80; i++) s = stepBand(s, 0, 1 / 60, 0, 0.2, 1);
    expect(s.peak).toBeLessThan(0.8);
    expect(stepBand(newBandState(), 0.3, 1 / 60, 0, 0, 2).level).toBeCloseTo(0.6);
  });
});

describe('Hit (onsets)', () => {
  /** A Hit node's frames (atStepListener, the last BUF samples heard each 1/60 s): the times its Trigger read 1. */
  const BUF = 4096;
  function runHit(signal: Float32Array, o: Partial<AtListenerSpec>, from: number, to: number, l = atNewListener('audioHit', 0, 0)): number[] {
    const spec: AtListenerSpec = { ...KICK, ...o } as AtListenerSpec, hits: number[] = [], block = new Float32Array(BUF);
    let trig = 0;
    const c0 = l.hit.count;
    for (let end = Math.round(from * SR) + HOP; end <= Math.round(to * SR); end += HOP) {
      for (let i = 0; i < BUF; i++) { const k = end - BUF + i; block[i] = k >= 0 && k < signal.length ? signal[k] : 0; }
      atStepListener(l, spec, new Float32Array(FFT / 2), block, SR, true, (end / SR) * 1000, HOP / SR, (ch, v) => { if (ch === 'trigger') trig = v; });
      if (trig) hits.push(end / SR);
    }
    expect(l.hit.count - c0).toBe(hits.length);
    return hits;
  }
  const KICK = { type: 'audioHit', lo: 40, hi: 130, preset: 'kick', sensitivity: 0.5, minInterval: null, gateDb: null, trackNoise: null, decay: 0.3, attack: 0.01, release: 0.15, gain: 1, layout: 'log', minDb: -90, maxDb: -20, smoothing: 0 } as const;

  it('counts each kick of a kick train once, within a frame or two of when it starts', () => {
    const times = [0.3, 0.8, 1.3, 1.8, 2.3, 2.8, 3.3, 3.8];
    const hits = runHit(kicks(times, 4.2), {}, 0, 4.2);
    expect(hits.length).toBe(times.length);
    hits.forEach((t, i) => expect(t - times[i]).toBeGreaterThan(0));
    hits.forEach((t, i) => expect(t - times[i]).toBeLessThan(0.045));
  });

  it('Min interval is the shortest gap on a fast click train', () => {
    const fast = runHit(clicks(0.1, 3), { lo: 6000, hi: 16000, preset: 'hats' }, 0, 3);
    expect(fast.length).toBeGreaterThanOrEqual(27); // one per click
    expect(fast.length).toBeLessThanOrEqual(28);
    const slow = runHit(clicks(0.1, 3), { lo: 6000, hi: 16000, preset: 'hats', minInterval: 250 }, 0, 3);
    expect(slow.length).toBeGreaterThanOrEqual(9);
    expect(slow.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < slow.length; i++) expect(slow[i] - slow[i - 1]).toBeGreaterThanOrEqual(0.25 - 1 / 60);
  });

  it('a steady tone never fires once it is held; Trigger lasts one frame', () => {
    expect(runHit(sine(60, 0.6, 4), {}, 1, 4)).toEqual([]);
    const l = atNewListener('audioHit', 0, 0);
    const hits = runHit(kicks([0.3], 1), {}, 0, 1, l);
    expect(hits.length).toBe(1);
    expect(l.hit.trigger).toBe(0);
    expect(l.hit.strength).toBeGreaterThan(0.3);
  });

  it('Envelope jumps to 1 on a hit and falls to 0 in Decay', () => {
    const l = atNewListener('audioHit', 0, 0);
    runHit(kicks([0.3], 0.5), {}, 0, 0.5, l);
    expect(l.hit.envelope).toBeGreaterThan(0);
    runHit(new Float32Array(SR), {}, 0, 0.6, l);
    expect(l.hit.envelope).toBe(0);
  });
});

describe('spectrum layout', () => {
  it('log and linear positions invert', () => {
    for (const x of [0, 0.25, 0.5, 0.9]) {
      expect(xOfHz(hzAt(x, 'log', 20, 20000), 'log', 20, 20000)).toBeCloseTo(x, 6);
      expect(xOfHz(hzAt(x, 'linear', 0, 24000), 'linear', 0, 24000)).toBeCloseTo(x, 6);
    }
    expect(hzAt(0.5, 'log', 20, 20000)).toBeCloseTo(Math.sqrt(20 * 20000), 3); // equal steps per octave
  });

  it('a 1 kHz sine peaks where the layout puts 1 kHz', () => {
    const db = spectrumDb(sine(1000, 0.5, FFT / SR));
    for (const layout of ['log', 'linear'] as const) {
      const out = new Float32Array(128);
      spectrumBins(db, SR, out, layout, -100, -10);
      const peak = out.indexOf(Math.max(...out));
      const want = xOfHz(1000, layout, layout === 'log' ? 20 : 0, 20000) * 128;
      expect(Math.abs(peak + 0.5 - want)).toBeLessThan(2);
      expect(out.every(v => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it('smoothing blends with the last frame', () => {
    const loud = new Float32Array(1024).fill(-10), quiet = new Float32Array(1024).fill(-100);
    const out = new Float32Array(16);
    spectrumBins(loud, SR, out, 'linear', -100, -10);
    expect(out[5]).toBeCloseTo(1);
    spectrumBins(quiet, SR, out, 'linear', -100, -10, 0.5);
    expect(out[5]).toBeCloseTo(0.5);
  });
});

describe('spectrogram and waveform rows', () => {
  it('the newest row is on top and older rows move down', () => {
    const w = 2, h = 3, data = new Uint8Array(w * h * 4);
    scrollRows(data, w, h, [1, 0]);
    scrollRows(data, w, h, [0, 1]);
    const at = (x: number, y: number) => data[(y * w + x) * 4];
    expect([at(0, 2), at(1, 2)]).toEqual([0, 255]);
    expect([at(0, 1), at(1, 1)]).toEqual([255, 0]);
    expect([at(0, 0), at(1, 0)]).toEqual([0, 0]);
    expect(data[(2 * w) * 4 + 3]).toBe(255);
  });

  it('a waveform row is the last samples around 0.5', () => {
    const out = new Float32Array(4);
    waveRow(Float32Array.from([9, 9, 1, -1, 0, 0.5]), out);
    expect(Array.from(out)).toEqual([1, 0, 0.5, 0.75]);
  });
});
