/**
 * Triggers and noise: the pure frame-by-frame logic behind the Trigger and
 * Noise sources, plus the OSC decoder the bridge uses.
 */
import { describe, it, expect } from 'vitest';
import { beatAt, newTriggerState, noiseAt, stepTrigger, triggerKey, type TriggerParams } from '../triggers';
import { decodeOsc, encodeOsc } from '../../lib/osc/decode.js';

const ENV: TriggerParams = { mode: 'envelope', attack: 100, decay: 100, sustain: 0.5, release: 200, steps: 4 };
const run = (st: ReturnType<typeof newTriggerState>, p: TriggerParams, presses: number, gate: boolean, frames: number, dt = 0.01, vel = 1) => {
  let v = 0;
  for (let i = 0; i < frames; i++) v = stepTrigger(st, p, presses, gate, dt, vel);
  return v;
};

describe('envelope', () => {
  it('attacks, decays to sustain while held, and releases to zero', () => {
    const st = newTriggerState();
    expect(run(st, ENV, 1, true, 5)).toBeCloseTo(0.5);      // half-way up a 100 ms attack
    expect(run(st, ENV, 1, true, 5)).toBeCloseTo(1);        // peak
    expect(st.stage).toBe('decay');
    expect(run(st, ENV, 1, true, 20)).toBeCloseTo(0.5);     // sustain level
    expect(st.stage).toBe('sustain');
    run(st, ENV, 1, false, 1);                              // key up → release
    expect(st.stage).toBe('release');
    expect(run(st, ENV, 1, false, 40)).toBe(0);
    expect(st.stage).toBe('idle');
  });

  it('a tap shorter than a frame still plays the whole attack', () => {
    const st = newTriggerState();
    // Pressed and released between frames: the gate is already closed when the frame sees the press.
    expect(run(st, ENV, 1, false, 10)).toBeCloseTo(1);
    run(st, ENV, 1, false, 1);
    expect(st.stage).toBe('release');
  });

  it('scales the peak by velocity and retriggers from where it is', () => {
    const st = newTriggerState();
    expect(run(st, ENV, 1, true, 20, 0.01, 0.4)).toBeLessThanOrEqual(0.4);
    const before = st.value;
    stepTrigger(st, ENV, 2, true, 0.01, 1);
    expect(st.stage).toBe('attack');
    expect(st.value).toBeGreaterThan(before);
  });

  it('ignores presses made before the mapping existed', () => {
    const st = newTriggerState(5);
    expect(stepTrigger(st, ENV, 5, false, 0.01)).toBe(0);
  });
});

describe('toggle, step, random', () => {
  it('toggle flips on each press', () => {
    const st = newTriggerState();
    const p = { ...ENV, mode: 'toggle' as const };
    expect(stepTrigger(st, p, 1, true, 0.01)).toBe(1);
    expect(stepTrigger(st, p, 1, false, 0.01)).toBe(1);
    expect(stepTrigger(st, p, 2, true, 0.01)).toBe(0);
  });
  it('step walks 0, ⅓, ⅔, 1 and wraps', () => {
    const st = newTriggerState();
    const p = { ...ENV, mode: 'step' as const, steps: 4 };
    const seen = [1, 2, 3, 4, 5].map(n => stepTrigger(st, p, n, true, 0.01));
    expect(seen.map(v => Math.round(v * 3))).toEqual([0, 1, 2, 3, 0]);
  });
  it('random draws a new value only on a press', () => {
    const st = newTriggerState();
    const p = { ...ENV, mode: 'random' as const };
    const vals = [0.2, 0.9];
    let i = 0;
    const rand = () => vals[i++];
    expect(stepTrigger(st, p, 1, true, 0.01, 1, rand)).toBe(0.2);
    expect(stepTrigger(st, p, 1, true, 0.01, 1, rand)).toBe(0.2);
    expect(stepTrigger(st, p, 2, true, 0.01, 1, rand)).toBe(0.9);
  });
});

describe('beats and keys', () => {
  it('fires once per period with a short gate', () => {
    expect(beatAt(120, 1, 0.01)).toEqual({ count: 1, gate: true });
    expect(beatAt(120, 1, 0.3)).toEqual({ count: 1, gate: false });
    expect(beatAt(120, 1, 0.51).count).toBe(2);
    expect(beatAt(120, 4, 1.9).count).toBe(1);
  });
  it('names triggers so a note matches its exact and any-note keys', () => {
    expect(triggerKey({ on: 'note', channel: 0, note: -1 })).toBe('note:0:*');
    expect(triggerKey({ on: 'note', channel: 2, note: 60 })).toBe('note:2:60');
    expect(triggerKey({ on: 'osc', address: '/a' })).toBe('osc:/a');
  });
});

describe('noise', () => {
  it('stays in 0..1, is smooth for smooth, and holds then jumps for stepped', () => {
    for (const type of ['smooth', 'drift', 'random', 'stepped'] as const) {
      for (let t = 0; t < 20; t += 0.37) {
        const v = noiseAt(type, t, 2, 5, 0, Math.round(t * 60));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // smooth: tiny time step → tiny change
    expect(Math.abs(noiseAt('smooth', 3.5, 1, 1, 0, 0) - noiseAt('smooth', 3.501, 1, 1, 0, 0))).toBeLessThan(0.01);
    // stepped: constant within a step, snapped to levels
    expect(noiseAt('stepped', 2.1, 1, 1, 0, 0)).toBe(noiseAt('stepped', 2.9, 1, 1, 0, 0));
    const snapped = noiseAt('stepped', 7.2, 1, 3, 5, 0);
    expect(Math.round(snapped * 4)).toBeCloseTo(snapped * 4);
    // random: changes with the frame, not the clock
    expect(noiseAt('random', 1, 1, 1, 0, 10)).not.toBe(noiseAt('random', 1, 1, 1, 0, 11));
    // seeds differ
    expect(noiseAt('smooth', 4.2, 1, 1, 0, 0)).not.toBe(noiseAt('smooth', 4.2, 1, 2, 0, 0));
  });
});

describe('OSC decoder', () => {
  it('round-trips floats, ints, strings and booleans, and unpacks bundles', () => {
    const [m] = decodeOsc(encodeOsc('/1/fader1', [0.25, { i: 7 }, 'hi', true, false]));
    expect(m.address).toBe('/1/fader1');
    expect(m.args).toEqual([0.25, 7, 'hi', true, false]);
    const a = encodeOsc('/a', [1]), b = encodeOsc('/b', [2]);
    const head = new Uint8Array(16); head.set(new TextEncoder().encode('#bundle'));
    const size = (n: number) => { const x = new Uint8Array(4); new DataView(x.buffer).setInt32(0, n); return x; };
    const bundle = new Uint8Array([...head, ...size(a.length), ...a, ...size(b.length), ...b]);
    expect(decodeOsc(bundle).map(x => x.address)).toEqual(['/a', '/b']);
  });
  it('ignores garbage without throwing', () => {
    expect(decodeOsc(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(decodeOsc(new TextEncoder().encode('no slash\0\0\0\0'))).toEqual([]);
  });
});

describe('live audio analysis', () => {
  it('maps dB to 0..1 and averages a band', async () => {
    const { bandFromSpectrum, dbToUnit, levelFromWave } = await import('../../lib/liveAudio');
    expect(dbToUnit(-80)).toBe(0);
    expect(dbToUnit(-10)).toBe(1);
    expect(dbToUnit(-45)).toBeCloseTo(0.5);
    // 1024 bins at 48 kHz: ~23.4 Hz per bin. Loud bass, silent elsewhere.
    const spec = new Float32Array(1024).fill(-100);
    for (let i = 1; i <= 7; i++) spec[i] = -10;
    expect(bandFromSpectrum(spec, 48000, 25, 150)).toBeGreaterThan(0.8);
    expect(bandFromSpectrum(spec, 48000, 3000, 12000)).toBe(0);
    // A full-scale sine is loud; silence is 0.
    const sine = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i / 5));
    expect(levelFromWave(sine)).toBeGreaterThan(0.9);
    expect(levelFromWave(new Float32Array(2048))).toBe(0);
  });
});
