/**
 * Audio Source's bands and trim (lib/audioTools/bands.ts): cleaning saved bands, the quick presets (Kick / Snare /
 * Hi-hat come as triggers with Hit's ranges), the outputs a band adds, a trigger per band on a synthetic click train
 * (inside its range, not outside it), and the trim maths (seconds ↔ samples, the loop window).
 */
import { describe, expect, it } from 'vitest';
import {
  BAND_QUICK_PRESETS, bandOutputs, bandsOf, intoWindow, newBand, newBandRun, samplesToSeconds, secondsToSamples, stepBandRun,
  trimWindow, windowPosition, MIN_TRIM,
} from '../bands';
import { spectrumDb } from '../dsp';
import { HIT_PRESETS } from '../../../nodes/definitions/audioTools';

const SR = 48000, FFT = 2048, HOP = 800;

function frames(signal: Float32Array, to: number, fn: (db: Float32Array, t: number) => void): void {
  const block = new Float32Array(FFT);
  for (let end = 0; end <= Math.round(to * SR); end += HOP) {
    for (let i = 0; i < FFT; i++) { const k = end - FFT + i; block[i] = k >= 0 && k < signal.length ? signal[k] : 0; }
    fn(spectrumDb(block), end / SR);
  }
}

/** Decaying 60 Hz thumps (kicks) every half second. */
function kicks(seconds: number): Float32Array {
  const s = new Float32Array(Math.round(seconds * SR));
  for (let t0 = 0.25; t0 < seconds; t0 += 0.5) {
    const a = Math.round(t0 * SR);
    for (let i = 0; i < 0.15 * SR && a + i < s.length; i++) s[a + i] += 0.8 * Math.exp(-i / SR / 0.06) * Math.sin((2 * Math.PI * 60 * i) / SR);
  }
  return s;
}

/** Short bursts of high noise (hi-hat clicks, nothing below a few kHz) every quarter second. */
function hats(seconds: number): Float32Array {
  const s = new Float32Array(Math.round(seconds * SR));
  let seed = 3, prev = 0;
  for (let t = 0.2; t < seconds; t += 0.25) {
    const a = Math.round(t * SR);
    for (let i = 0; i < 0.03 * SR && a + i < s.length; i++) {
      seed = (seed * 16807) % 2147483647;
      const n = (seed / 2147483647) * 2 - 1;
      // A first difference: white noise tilted to the highs, so the low bins stay quiet.
      s[a + i] = (n - prev) * 0.4 * Math.exp(-i / SR / 0.008); prev = n;
    }
  }
  return s;
}

function countTriggers(signal: Float32Array, seconds: number, preset: string): number {
  const band = newBand([], preset), run = newBandRun();
  let hits = 0;
  frames(signal, seconds, (db, t) => { stepBandRun(run, band, db, SR, t, HOP / SR); hits += run.hit.trigger; });
  return hits;
}

describe('bands', () => {
  it('quick presets: Kick, Snare and Hi-hat are triggers with Hit\'s ranges; the rest send their level', () => {
    for (const k of ['kick', 'snare', 'hihat']) {
      const b = newBand([], k), h = HIT_PRESETS[k];
      expect([b.lo, b.hi, b.trigger, b.value]).toEqual([h.lo, h.hi, true, false]);
      expect([b.releaseAt, b.gate, b.minMs]).toEqual([0.8, 0.1, 10]);
      expect(b.threshold).toBe(k === 'kick' ? 0.5 : k === 'snare' ? 0.35 : 0.2);
    }
    expect(newBand([], 'kick').cooldown).toBe(150);
    for (const k of ['sub', 'bass', 'vocals', 'air']) { const b = newBand([], k); expect(b.value && !b.trigger).toBe(true); }
    expect(BAND_QUICK_PRESETS.map(p => p.name)).toEqual(['Sub', 'Bass', 'Kick', 'Snare', 'Hi-hat', 'Vocals', 'Air']);
  });

  it('new bands get fresh ids, names and colours', () => {
    const a = newBand([], 'kick'), b = newBand([a], 'kick'), c = newBand([a, b], { lo: 500, hi: 300 });
    expect([a.id, b.id, c.id]).toEqual(['b1', 'b2', 'b3']);
    expect([a.name, b.name, c.name]).toEqual(['Kick', 'Kick 2', 'Band']);
    expect(new Set([a.color, b.color, c.color]).size).toBe(3);
    expect([c.lo, c.hi]).toEqual([300, 500]);
  });

  it('outputs: Value named after the band, Trigger "Name (trigger)"', () => {
    const bands = bandsOf({ bands: [{ id: 'k', name: 'Kick', lo: 30, hi: 150, value: true, trigger: true }, { id: 'b', name: 'Bass', lo: 60, hi: 250 }] });
    expect(bandOutputs(bands).map(o => [o.key, o.label])).toEqual([['k_v', 'Kick'], ['k_t', 'Kick (trigger)'], ['b_v', 'Bass']]);
  });

  it('saved bands are cleaned: odd ids, swapped ranges, a band that sends nothing', () => {
    const [a, b] = bandsOf({ bands: [{ id: 'a-1!', lo: 900, hi: 100, value: false, trigger: false }, { id: 'a1', lo: 5 }, 'junk'] });
    expect(a.id).toBe('a1');
    expect(b.id).toBe('a1x');
    expect([a.lo, a.hi, a.value]).toEqual([100, 900, true]);
    expect(b.lo).toBe(20);
  });

  it('a Kick band triggers on each kick, and not on hi-hats; a Hi-hat band the other way round', () => {
    const k = countTriggers(kicks(3), 3, 'kick');
    expect(k).toBeGreaterThanOrEqual(5);
    expect(k).toBeLessThanOrEqual(6);
    expect(countTriggers(hats(3), 3, 'kick')).toBe(0);
    expect(countTriggers(hats(3), 3, 'hihat')).toBeGreaterThanOrEqual(10);
  });

  it('trigger is 1 for exactly one frame per hit, and Value follows the band', () => {
    const band = { ...newBand([], 'kick'), value: true }, run = newBandRun();
    let prev = 0, rises = 0, ones = 0, maxLevel = 0;
    frames(kicks(2), 2, (db, t) => {
      stepBandRun(run, band, db, SR, t, HOP / SR);
      if (run.hit.trigger === 1) ones++;
      if (run.hit.trigger > 0.5 && prev <= 0.5) rises++;
      prev = run.hit.trigger;
      maxLevel = Math.max(maxLevel, run.band.level);
    });
    expect(ones).toBe(rises);
    expect(maxLevel).toBeGreaterThan(0.5);
  });
});

describe('trim', () => {
  it('seconds ↔ samples', () => {
    expect(secondsToSamples(1.5, 48000)).toBe(72000);
    expect(samplesToSeconds(72000, 48000)).toBe(1.5);
    expect(samplesToSeconds(secondsToSamples(0.123, 44100), 44100)).toBeCloseTo(0.123, 4);
    expect(secondsToSamples(-1, 48000)).toBe(0);
  });

  it('the window: Out 0 is the end, clamped to the file, never shorter than the minimum', () => {
    expect(trimWindow(10, 0, 0)).toEqual({ start: 0, end: 10 });
    expect(trimWindow(10, 2, 4)).toEqual({ start: 2, end: 4 });
    expect(trimWindow(10, 2, 50)).toEqual({ start: 2, end: 10 });
    const w = trimWindow(10, 5, 5);
    expect(w.end - w.start).toBeCloseTo(MIN_TRIM, 6);
    expect(trimWindow(0, 1, 2)).toEqual({ start: 0, end: 0 });
  });

  it('playback loops inside the window', () => {
    const w = { start: 2, end: 4 };
    expect(windowPosition(2, 0.5, w, true)).toBeCloseTo(2.5);
    expect(windowPosition(3.5, 1, w, true)).toBeCloseTo(2.5);
    expect(windowPosition(2, 5, w, true)).toBeCloseTo(3);
    expect(windowPosition(8, 0.25, w, true)).toBeCloseTo(2.25); // outside: starts at In
    expect(windowPosition(3, 5, w, false)).toBe(4);
    expect(intoWindow(1, w)).toBe(2);
    expect(intoWindow(3, w)).toBe(3);
  });
});
