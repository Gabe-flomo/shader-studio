/**
 * Audio Source's bands and trim (lib/audioTools/bands.ts): cleaning saved bands, the quick bands (Kick / Snare / Hats
 * / Notes as hits with their preset, Sub / Bass / Vocals / Air as values), old bands upgraded to a preset and a
 * Sensitivity, the outputs a band adds, a band's hits on a synthetic click train (inside its range, not outside it),
 * and the trim maths (seconds ↔ samples, the loop window).
 */
import { describe, expect, it } from 'vitest';
import {
  BAND_QUICK_PRESETS, bandOutputs, bandsOf, intoWindow, newBand, newBandRun, samplesToSeconds, secondsToSamples, stepBandRun,
  trimWindow, upgradeOldBand, windowPosition, MIN_TRIM,
} from '../bands';
import { AT_DET_PRESETS } from '../../../play/kit/audioTools.js';
import { HIT_PRESETS } from '../../../nodes/definitions/audioTools';

const SR = 48000, HOP = 800, BUF = 4096;

/** Animation frames (every HOP samples) with the last BUF samples heard, as the engine hands them over. */
function frames(signal: Float32Array, to: number, fn: (wave: Float32Array, t: number) => void): void {
  const block = new Float32Array(BUF);
  for (let end = HOP; end <= Math.round(to * SR); end += HOP) {
    for (let i = 0; i < BUF; i++) { const k = end - BUF + i; block[i] = k >= 0 && k < signal.length ? signal[k] : 0; }
    fn(block, end / SR);
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
  frames(signal, seconds, (w, t) => { stepBandRun(run, band, w, SR, t, HOP / SR); hits += run.hit.trigger; });
  return hits;
}

describe('bands', () => {
  it('quick bands: Kick, Snare, Hats and Notes send hits (and a Value) with their preset\'s band; the rest send their level', () => {
    for (const k of ['kick', 'snare', 'hats', 'notes'] as const) {
      const b = newBand([], k), p = AT_DET_PRESETS[k];
      expect([b.lo, b.hi, b.trigger, b.value, b.preset, b.sensitivity]).toEqual([p.lo, p.hi, true, true, k, 0.5]);
      expect([b.minInterval, b.gateDb, b.trackNoise, b.character]).toEqual([null, null, null, 'auto']);
    }
    // Older keys still make the same bands; Hit's sounds share the presets' bands.
    expect(newBand([], 'hihat').preset).toBe('hats');
    expect(newBand([], 'kickDrums').preset).toBe('kick');
    expect([HIT_PRESETS.kick.lo, HIT_PRESETS.kick.hi]).toEqual([AT_DET_PRESETS.kick.lo, AT_DET_PRESETS.kick.hi]);
    for (const k of ['sub', 'bass', 'vocals', 'air']) { const b = newBand([], k); expect(b.value && !b.trigger).toBe(true); }
    expect(BAND_QUICK_PRESETS.map(p => p.name)).toEqual(['Kick', 'Snare', 'Hats', 'Notes', 'Sub', 'Bass', 'Vocals', 'Air']);
    // A range drawn on the spectrum catches Custom hits.
    expect(newBand([], { lo: 500, hi: 900 }).preset).toBe('custom');
  });

  it('old bands (a v1 Sensitivity, v2 lines, a Detect) upgrade to their nearest preset and Sensitivity', () => {
    const [v1, v2, user, bright, notes, hat] = bandsOf({ bands: [
      { id: 'a', lo: 30, hi: 150, trigger: true, sensitivity: 0.8 },
      { id: 'b', lo: 200, hi: 5000, trigger: true, threshold: 0.4, releaseAt: 0.8, gate: 0.1, minMs: 10, cooldown: 120 },
      { id: 'c', lo: 63, hi: 134, value: true, trigger: true, detect: 'transient', character: 'noisy', charAt: 0.3, threshold: 0.5, releaseAt: 0.8, gate: 0.71, minMs: 10, cooldown: 120 },
      { id: 'd', lo: 100, hi: 8000, value: true, detect: 'brightness' },
      { id: 'e', lo: 200, hi: 2000, trigger: true, detect: 'hits', character: 'tonal' },
      { id: 'f', lo: 6000, hi: 16000, trigger: true, detect: 'hits', character: 'noisy', threshold: 0.5 },
    ] });
    expect([v1.preset, v1.sensitivity, v1.lo, v1.hi]).toEqual(['kick', 0.8, 30, 150]);
    expect([v2.preset, v2.sensitivity]).toEqual(['snare', 0.75]);
    // The bug report's band: a kick band (its edges kept), Only dropped (a kick is never noisy), the middle Sensitivity.
    expect([user.preset, user.sensitivity, user.character, user.lo, user.hi]).toEqual(['kick', 0.5, 'auto', 63, 134]);
    expect([bright.preset, bright.valueFrom, bright.trigger]).toEqual(['custom', 'brightness', false]);
    expect([notes.preset, notes.character]).toEqual(['notes', 'tonal']);
    expect([hat.preset, hat.character]).toEqual(['hats', 'noisy']);
    // The fixed lines are gone from the saved band.
    const up = upgradeOldBand({ lo: 30, hi: 150, trigger: true, threshold: 0.5, gate: 0.2, cooldown: 120, minMs: 10, releaseAt: 0.8 });
    expect(Object.keys(up).filter(k => ['threshold', 'gate', 'cooldown', 'minMs', 'releaseAt', 'detect'].includes(k))).toEqual([]);
    // A band already in today's terms is left as it is.
    expect(upgradeOldBand({ preset: 'hats', sensitivity: 0.3 })).toEqual({ preset: 'hats', sensitivity: 0.3 });
  });

  it('new bands get fresh ids, names and colours', () => {
    const a = newBand([], 'kick'), b = newBand([a], 'kick'), c = newBand([a, b], { lo: 500, hi: 300 });
    expect([a.id, b.id, c.id]).toEqual(['b1', 'b2', 'b3']);
    expect([a.name, b.name, c.name]).toEqual(['Kick', 'Kick 2', 'Band']);
    expect(new Set([a.color, b.color, c.color]).size).toBe(3);
    expect([c.lo, c.hi]).toEqual([300, 500]);
  });

  it('outputs: Value named after the band, its hits "Name (trigger)"', () => {
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

  it('a Kick band hits on each kick, and not on hi-hats; a Hats band the other way round', () => {
    const k = countTriggers(kicks(3), 3, 'kick');
    expect(k).toBeGreaterThanOrEqual(5);
    expect(k).toBeLessThanOrEqual(6);
    expect(countTriggers(hats(3), 3, 'kick')).toBe(0);
    expect(countTriggers(hats(3), 3, 'hats')).toBeGreaterThanOrEqual(10);
  });

  it('trigger is 1 for exactly one frame per hit, and Value follows the band', () => {
    const band = { ...newBand([], 'kick'), value: true }, run = newBandRun();
    let prev = 0, rises = 0, ones = 0, maxLevel = 0;
    frames(kicks(2), 2, (w, t) => {
      stepBandRun(run, band, w, SR, t, HOP / SR);
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
