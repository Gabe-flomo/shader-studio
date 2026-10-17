/**
 * Learn a sound (lib/audioTools/learn.ts) on synthetic sound: a clap (band-limited noise burst) and a tone stab are
 * learned from a stretch of samples; a stream of claps, stabs and kicks fires each learned sound on its own hits
 * only; Match is a threshold; and a fingerprint doesn't change with loudness.
 */
import { describe, expect, it } from 'vitest';
import { spectrumDb } from '../dsp';
import {
  ENV_POINTS, LEARN_BANDS, LEARN_FFT, fingerprintOf, framesFromSamples, learnFromFrames, learnFromSamples, newLearnListener,
  newSound, similarity, soundOutputs, soundsOf, stepLearn, learnFromRing, type AudioSoundSpec, type Fingerprint,
} from '../learn';

const SR = 48000, HOP = 800; // 60 frames a second

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };

/** Noise through a crude band-pass (difference of two one-pole low-passes), ~1–5 kHz, decaying fast: a clap. */
function addClap(s: Float32Array, t0: number, amp = 0.6) {
  const a = Math.round(t0 * SR);
  let l1 = 0, l2 = 0;
  const k1 = 1 - Math.exp((-2 * Math.PI * 5000) / SR), k2 = 1 - Math.exp((-2 * Math.PI * 1000) / SR);
  for (let i = 0; i < 0.12 * SR && a + i < s.length; i++) {
    const x = rnd();
    l1 += k1 * (x - l1); l2 += k2 * (x - l2);
    s[a + i] += amp * 2.5 * (l1 - l2) * Math.exp(-i / SR / 0.025);
  }
}
/** A 330 Hz tone with a few harmonics, 150 ms (faded out, so its end isn't a click): a stab. */
function addStab(s: Float32Array, t0: number, amp = 0.4) {
  const a = Math.round(t0 * SR);
  for (let i = 0; i < 0.15 * SR && a + i < s.length; i++) {
    const t = i / SR, env = Math.min(1, i / (0.003 * SR)) * Math.exp(-t / 0.12) * Math.min(1, (0.15 * SR - i) / (0.03 * SR));
    let v = 0;
    for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * 330 * h * t) / h;
    s[a + i] += amp * env * v * 0.6;
  }
}
/** A decaying 55 Hz thump: a kick. */
function addKick(s: Float32Array, t0: number, amp = 0.8) {
  const a = Math.round(t0 * SR);
  for (let i = 0; i < 0.2 * SR && a + i < s.length; i++) s[a + i] += amp * Math.exp(-i / SR / 0.07) * Math.sin(2 * Math.PI * 55 * (i / SR) * (1 + 0.5 * Math.exp(-i / SR / 0.02)));
}

const solo = (add: (s: Float32Array, t: number, amp?: number) => void, amp?: number) => { const s = new Float32Array(SR); add(s, 0.3, amp); return s; };

/** Run the live listener over a stream (frames ending every hop), counting each sound's fires by time. */
function listen(stream: Float32Array, sounds: AudioSoundSpec[]): Map<string, number[]> {
  const L = newLearnListener(), fires = new Map(sounds.map(s => [s.id, [] as number[]]));
  const block = new Float32Array(LEARN_FFT);
  for (let end = 0; end <= stream.length; end += HOP) {
    for (let i = 0; i < LEARN_FFT; i++) { const k = end - LEARN_FFT + i; block[i] = k >= 0 ? stream[k] : 0; }
    const t = end / SR;
    stepLearn(L, sounds, spectrumDb(block), SR, t, HOP / SR);
    for (const s of sounds) if (L.runs.get(s.id)!.trigger) fires.get(s.id)!.push(t);
  }
  return fires;
}

const learn = (s: Float32Array, from = 0.2, to = 0.5): Fingerprint => {
  const r = learnFromSamples(s, SR, from, to);
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('fingerprints', () => {
  it('are LEARN_BANDS centred values of length 1, and an envelope of ENV_POINTS 0..1', () => {
    const fp = learn(solo(addClap));
    expect(fp.spec).toHaveLength(LEARN_BANDS);
    expect(fp.env).toHaveLength(ENV_POINTS);
    expect(Math.abs(fp.spec.reduce((a, v) => a + v, 0))).toBeLessThan(1e-2);
    expect(Math.hypot(...fp.spec)).toBeCloseTo(1, 2);
    for (const e of fp.env) { expect(e).toBeGreaterThanOrEqual(0); expect(e).toBeLessThanOrEqual(1); }
    expect(Math.max(...fp.env)).toBe(1);
  });

  it('do not change with loudness', () => {
    seed = 11; const loud = learn(solo(addClap, 0.8));
    seed = 11; const quiet = learn(solo(addClap, 0.05));
    expect(similarity(loud, quiet)).toBeGreaterThan(0.98);
    for (let i = 0; i < LEARN_BANDS; i++) expect(Math.abs(loud.spec[i] - quiet.spec[i])).toBeLessThan(0.02);
  });

  it('find the hit inside a longer selection', () => {
    const s = new Float32Array(3 * SR);
    addClap(s, 1.7);
    const r = learnFromSamples(s, SR, 0, 3);
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(Math.abs(r.at - 1.7)).toBeLessThan(0.05);
  });

  it('silence has nothing to learn', () => {
    expect('error' in learnFromSamples(new Float32Array(SR), SR, 0, 1)).toBe(true);
    expect(fingerprintOf([])).toBeNull();
  });

  it('a clap, a stab and a kick are told apart', () => {
    const clap = learn(solo(addClap)), stab = learn(solo(addStab)), kick = learn(solo(addKick));
    seed = 99; const clap2 = learn(solo(addClap));
    expect(similarity(clap2, clap)).toBeGreaterThan(0.9);
    expect(similarity(stab, clap)).toBeLessThan(0.6);
    expect(similarity(kick, clap)).toBeLessThan(0.6);
    expect(similarity(kick, stab)).toBeLessThan(0.7);
  });
});

describe('matching live', () => {
  // Claps, stabs and kicks at their own times, plus one quiet clap.
  const stream = new Float32Array(9 * SR);
  const claps = [0.5, 2.0, 3.5, 6.2, 8.0], stabs = [1.25, 4.4, 7.1], kicks = [0.9, 2.6, 3.0, 5.0, 5.6, 6.6, 7.6];
  seed = 1234;
  claps.forEach((t, i) => addClap(stream, t, i === 3 ? 0.25 : 0.6));
  stabs.forEach(t => addStab(stream, t));
  kicks.forEach(t => addKick(stream, t));

  seed = 5;
  const clapFp = learn(solo(addClap));
  const stabFp = learn(solo(addStab));
  const clap: AudioSoundSpec = { ...newSound([], clapFp), name: 'Clap' };
  const stab: AudioSoundSpec = { ...newSound([clap], stabFp), name: 'Stab' };

  const near = (times: number[], at: number[]) => times.every(t => at.some(a => Math.abs(a - t) < 0.12));

  it('the clap fires on each clap only, the stab on each stab only', () => {
    const fires = listen(stream, [clap, stab]);
    const c = fires.get(clap.id)!, s = fires.get(stab.id)!;
    expect(c).toHaveLength(claps.length);
    expect(near(c, claps)).toBe(true);
    expect(s).toHaveLength(stabs.length);
    expect(near(s, stabs)).toBe(true);
  });

  it('Match is a threshold: 1 never fires, 0 fires on every onset', () => {
    expect(listen(stream, [{ ...clap, match: 1 }]).get(clap.id)).toHaveLength(0);
    const all = listen(stream, [{ ...clap, match: 0, cooldown: 40 }]).get(clap.id)!;
    expect(all.length).toBeGreaterThanOrEqual(claps.length + stabs.length + kicks.length - 1);
  });

  it('the Match output holds the similarity of the last onset, then falls', () => {
    const L = newLearnListener();
    const block = new Float32Array(LEARN_FFT);
    let peak = 0, after = 1;
    const s = solo(addClap);
    for (let end = 0; end <= 2 * SR; end += HOP) {
      for (let i = 0; i < LEARN_FFT; i++) { const k = end - LEARN_FFT + i; block[i] = k >= 0 && k < s.length ? s[k] : 0; }
      stepLearn(L, [clap], spectrumDb(block), SR, end / SR, HOP / SR);
      const m = L.runs.get(clap.id)!.match;
      peak = Math.max(peak, m);
      if (end / SR > 1.5) after = Math.min(after, m);
    }
    expect(peak).toBeGreaterThan(0.85);
    expect(after).toBe(0);
  });

  it('"Learn last hit" learns from the ring the listener keeps', () => {
    const L = newLearnListener();
    const block = new Float32Array(LEARN_FFT);
    seed = 5;
    const s = solo(addClap);
    for (let end = 0; end <= SR; end += HOP) {
      for (let i = 0; i < LEARN_FFT; i++) { const k = end - LEARN_FFT + i; block[i] = k >= 0 && k < s.length ? s[k] : 0; }
      stepLearn(L, [], spectrumDb(block), SR, end / SR, HOP / SR);
    }
    const r = learnFromRing(L);
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(similarity(r, clapFp)).toBeGreaterThan(0.95);
  });

  it('frames and learning agree on the onset', () => {
    const s = solo(addClap);
    const frames = framesFromSamples(s, SR, 0, 0.6);
    const r = learnFromFrames(frames, 0, 0.5);
    if ('error' in r) throw new Error(r.error);
    expect(Math.abs(r.at - 0.3)).toBeLessThan(0.04);
  });
});

describe('learned sounds in params', () => {
  it('clean up, never clash with band ids, and become outputs', () => {
    const fp = learn(solo(addClap));
    const a = newSound([], fp, new Set(['s1']));
    expect(a.id).toBe('s2');
    expect(a.name).toBe('Sound 1');
    const sounds = soundsOf({ sounds: [{ ...a, match: 3, cooldown: 1 }, { id: 'b1', name: 'Bell', trigger: false, matchOut: false }] }, new Set(['b1']));
    expect(sounds[0].match).toBe(1);
    expect(sounds[0].cooldown).toBe(40);
    expect(sounds[1].id).toBe('b1x');
    expect(sounds[1].trigger).toBe(true); // a sound that sends nothing still sends its Trigger
    expect(sounds[1].spec).toEqual([]);
    expect(soundOutputs(sounds).map(o => o.label)).toEqual(['Sound 1 (trigger)', 'Sound 1 (match)', 'Bell (trigger)']);
  });
});
