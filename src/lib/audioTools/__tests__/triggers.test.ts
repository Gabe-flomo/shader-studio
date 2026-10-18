/**
 * Fixed-threshold triggers (play/kit/audioTools.js atStepTrigger; docs/audio-tools.md "Triggers"): the line stays put,
 * a signal hovering round it fires once until it drops below Release, the Cooldown swallows (never delays) a rise, the
 * Gate keeps noise out, Min time ignores a one-step blip; and a file analysed ahead (atAnalyseLevels + atPickTriggers)
 * finds a synthetic kick track's onsets within a frame, fired by heard position round a loop (atEventsHeard).
 */
import { describe, expect, it } from 'vitest';
import {
  AT_GATE_HOLD, atAnalyseLevels, atEventsHeard, atNewTriggerState, atOfflineHop, atPickTriggers, atStepTrigger, atThresholdFromSensitivity,
  atTriggerOpts, type AtTriggerOpts,
} from '../../../play/kit/audioTools.js';
import { newBand, newBandRun, stepBandRun } from '../bands';
import { spectrumDb } from '../dsp';

const opts = (o: Partial<AtTriggerOpts> = {}): AtTriggerOpts => atTriggerOpts({ threshold: 0.5, releaseAt: 0.8, gate: 0, minMs: 0, cooldownMs: 0, ...o });

/** Step a trigger through `xs` (one value per `dt`), the times it fired. */
function run(xs: number[], o: AtTriggerOpts, dt = 1 / 60): number[] {
  const s = atNewTriggerState(), out: number[] = [];
  xs.forEach((x, i) => { atStepTrigger(s, x, i * dt, dt, o); if (s.trigger) out.push(+s.lastHit.toFixed(6)); });
  return out;
}

describe('a fixed Threshold with hysteresis', () => {
  it('a signal oscillating round the Threshold fires once, and again only after dropping below Release', () => {
    // 0.47 … 0.53 round the line (0.5) for a second: once.
    const wobble = Array.from({ length: 60 }, (_, i) => 0.5 + 0.03 * Math.sin(i * 1.3));
    expect(run(wobble, opts())).toHaveLength(1);
    // Down to 0.42 (above Release, 0.4) and back: still once. Down to 0.3 and back: twice.
    expect(run([0.6, 0.6, 0.42, 0.42, 0.6, 0.6], opts())).toHaveLength(1);
    expect(run([0.6, 0.6, 0.3, 0.3, 0.6, 0.6], opts())).toHaveLength(2);
    // Release 1: it re-arms as soon as it is under the line.
    expect(run([0.6, 0.49, 0.6], opts({ releaseAt: 1 }))).toHaveLength(2);
  });

  it('the line does not move: the same level fires the same way however loud the music was before', () => {
    const loud = Array.from({ length: 120 }, (_, i) => (i % 20 < 3 ? 0.9 : 0.1));
    const quietHit = [...loud, 0.1, 0.1, 0.55, 0.55, 0.1];
    // The adaptive detector raised its bar after loud hits; a fixed line catches the quieter one too.
    expect(run(quietHit, opts())).toHaveLength(7);
  });

  it('Cooldown is the shortest gap, and a rise inside it is swallowed, not fired late', () => {
    // Pulses every 50 ms (3 frames at 60 fps), each falling to 0 between.
    const pulses = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 0.8 : 0));
    const hits = run(pulses, opts({ cooldownMs: 120 }));
    for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeGreaterThanOrEqual(0.12 - 1e-6);
    // Every hit is on a pulse's own frame (a swallowed rise doesn't fire on a later frame).
    for (const t of hits) expect(Math.round(t * 60) % 3).toBe(0);
    expect(hits.length).toBe(7); // every third pulse (150 ms apart) in the second
  });

  it('Min time: a one-step blip above the line is ignored; a hit that stays fires, stamped when it rose', () => {
    const dt = 0.005;
    expect(run([0, 0.9, 0, 0, 0], opts({ minMs: 10 }), dt)).toEqual([]);
    expect(run([0, 0.9, 0.9, 0, 0], opts({ minMs: 10 }), dt)).toEqual([0.005]);
    // At 60 fps one frame is already 16.7 ms: a single frame above is enough.
    expect(run([0, 0.9, 0], opts({ minMs: 10 }))).toHaveLength(1);
  });
});

describe('the Gate keeps noise out', () => {
  it('white noise under the Gate never fires and its Value reads 0, even with the Threshold below it', () => {
    const SR = 48000, FFT = 2048, HOP = 800;
    let seed = 11;
    const noise = Float32Array.from({ length: SR * 3 }, () => { seed = (seed * 16807) % 2147483647; return ((seed / 2147483647) * 2 - 1) * 0.04; });
    const countWith = (gate: number) => {
      const band = { ...newBand([], 'kick'), value: true, threshold: 0.02, releaseAt: 0.95, cooldown: 40, gate }, r = newBandRun();
      let hits = 0, maxValue = 0;
      const block = new Float32Array(FFT);
      for (let end = FFT; end <= noise.length; end += HOP) {
        block.set(noise.subarray(end - FFT, end));
        stepBandRun(r, band, spectrumDb(block), SR, end / SR, HOP / SR);
        hits += r.hit.trigger;
        maxValue = Math.max(maxValue, r.band.level);
      }
      return { hits, maxValue };
    };
    // Without a gate the noise flickers across the low line and fires.
    expect(countWith(0).hits).toBeGreaterThan(0);
    const gated = countWith(0.3);
    expect(gated.hits).toBe(0);
    expect(gated.maxValue).toBe(0);
  });

  it('the gate holds open a moment, so a level hovering round it doesn\'t flicker it', () => {
    const s = atNewTriggerState(), o = opts({ gate: 0.2, threshold: 0.9 });
    atStepTrigger(s, 0.25, 0, 1 / 60, o);
    expect(s.gateOpen).toBe(true);
    // Below for less than the hold: still open.
    for (let i = 1; i < Math.floor(AT_GATE_HOLD * 60); i++) { atStepTrigger(s, 0.15, i / 60, 1 / 60, o); expect(s.gateOpen).toBe(true); }
    for (let i = 0; i < 4; i++) atStepTrigger(s, 0.15, 1, 1 / 60, o);
    expect(s.gateOpen).toBe(false);
    expect(s.gated).toBe(0);
  });
});

describe('an old Sensitivity becomes a Threshold', () => {
  it('maps 0 → 0.7, 0.5 → 0.5, 1 → 0.3 (higher sensitivity, lower line)', () => {
    expect([0, 0.5, 1, 0.75].map(atThresholdFromSensitivity)).toEqual([0.7, 0.5, 0.3, 0.4]);
    expect(atThresholdFromSensitivity(undefined)).toBe(0.5);
  });
});

// ── A file analysed ahead ────────────────────────────────────────────────────────────────────────────────────

const SR = 48000;
/** A kick track: decaying 60 Hz thumps at `times`, over a quiet noise bed. */
function kickTrack(times: readonly number[], seconds: number, bed = 0.01): Float32Array {
  const s = new Float32Array(Math.round(seconds * SR));
  let seed = 5;
  for (let i = 0; i < s.length; i++) { seed = (seed * 16807) % 2147483647; s[i] = ((seed / 2147483647) * 2 - 1) * bed; }
  for (const t0 of times) {
    const a = Math.round(t0 * SR);
    for (let i = 0; i < 0.15 * SR && a + i < s.length; i++) s[a + i] += 0.8 * Math.exp(-i / SR / 0.06) * Math.sin((2 * Math.PI * 60 * i) / SR);
  }
  return s;
}

describe('a file analysed ahead', () => {
  const times = [0.25, 0.75, 1.3, 1.82, 2.4, 3.05];
  const hop = atOfflineHop(SR), hopS = hop / SR;
  const [curve] = atAnalyseLevels(kickTrack(times, 3.5), SR, [{ lo: 30, hi: 150 }], hop);

  it('finds each kick once, within a frame (1/60 s) of when it starts', () => {
    const ev = atPickTriggers(curve, hopS, { threshold: 0.5, releaseAt: 0.8, gate: 0.1, minMs: 10, cooldownMs: 120 });
    expect(ev.times.length).toBe(times.length);
    ev.times.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThanOrEqual(1 / 60));
    // The noise bed alone: nothing.
    const [bed] = atAnalyseLevels(kickTrack([], 2), SR, [{ lo: 30, hi: 150 }], hop);
    expect(atPickTriggers(bed, hopS, { threshold: 0.5, gate: 0.1 }).times.length).toBe(0);
  });

  it('fires the hits playback is heard passing, round a loop too', () => {
    const ev = atPickTriggers(curve, hopS, { threshold: 0.5 });
    const win = { start: 0.5, end: 2 };
    expect(atEventsHeard(ev, 0.7, 0.76, win, true).count).toBe(1);
    expect(atEventsHeard(ev, 0.76, 1.2, win, true).count).toBe(0);
    // Round the loop's end (1.98 → 0.52): the 1.82 kick is behind, nothing between 0.5 and 0.52.
    expect(atEventsHeard(ev, 1.7, 0.52, win, true).count).toBe(1);
    expect(atEventsHeard(ev, 1.9, 0.8, win, true).count).toBe(1);
    // Not looping, a jump back fires nothing.
    expect(atEventsHeard(ev, 1.9, 0.8, win, false).count).toBe(0);
  });
});
