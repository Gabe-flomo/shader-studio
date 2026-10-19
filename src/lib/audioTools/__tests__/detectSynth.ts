/**
 * Synthetic sounds for the Detect tests (detect.test.ts): kicks over a held bass, hats over chords, a filter sweep,
 * and a live run that reads them the way AnalyserNode does (the last 2048 samples, once a frame).
 */
import { atSpectrumDbAt } from '../../../play/kit/audioTools.js';

export const SR = 48000;

/** A seeded random in [−1, 1). */
export function noiseGen(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s / 0xffffffff) * 2 - 1; };
}

/** A kick: a sine falling 150 → 50 Hz, decaying in about 60 ms, with a short click. */
export function addKick(out: Float32Array, at: number, amp = 0.8): void {
  const i0 = Math.round(at * SR);
  let ph = 0;
  for (let i = 0; i < Math.round(0.35 * SR) && i0 + i < out.length; i++) {
    const t = i / SR, f = 50 + 100 * Math.exp(-t / 0.03);
    ph += (2 * Math.PI * f) / SR;
    out[i0 + i] += amp * Math.exp(-t / 0.06) * Math.sin(ph) + (i < 48 ? 0.3 * amp * (1 - i / 48) : 0);
  }
}

/** A held tone with a few harmonics from `from` to `to` seconds (10 ms fades). */
export function addTone(out: Float32Array, hz: number, from: number, to: number, amp: number, harmonics = 1, fadeS = 0.01): void {
  const a = Math.round(from * SR), b = Math.min(out.length, Math.round(to * SR)), fade = fadeS * SR;
  for (let i = a; i < b; i++) {
    const env = Math.min(1, (i - a) / fade, (b - i) / fade);
    let v = 0;
    for (let k = 1; k <= harmonics; k++) if (hz * k < SR / 2.2) v += Math.sin((2 * Math.PI * hz * k * i) / SR) / k;
    out[i] += amp * env * v;
  }
}

/** A noise burst (a hat, a snare): white noise decaying in `decay` seconds. */
export function addBurst(out: Float32Array, at: number, amp: number, decay = 0.03, rnd = noiseGen(at * 1e4 + 7)): void {
  const i0 = Math.round(at * SR);
  for (let i = 0; i < Math.round(decay * 6 * SR) && i0 + i < out.length; i++) out[i0 + i] += amp * Math.exp(-i / SR / decay) * rnd();
}

/** Kicks every `every` seconds over a held 55 Hz bass (with its octave) for `seconds`. */
export function kicksOverBass(seconds = 4, every = 0.5): { mono: Float32Array; kicks: number[] } {
  const mono = new Float32Array(Math.round(seconds * SR));
  addTone(mono, 55, 0, seconds, 0.35, 2);
  const kicks: number[] = [];
  for (let t = 0.25; t < seconds - 0.3; t += every) { addKick(mono, t); kicks.push(t); }
  return { mono, kicks };
}

/**
 * The same kicks, but the bass line changes note every `every` seconds half-way between them: a melody under the
 * kick (each new note is an onset of its own).
 */
export function kicksOverBassLine(seconds = 4, every = 0.5, fadeS = 0.01): { mono: Float32Array; kicks: number[]; notes: number[] } {
  const mono = new Float32Array(Math.round(seconds * SR));
  const line = [55, 65.4, 73.4, 49];
  const notes: number[] = [];
  for (let k = 0, t = 0; t < seconds; k++, t += every) { addTone(mono, line[k % line.length], t, Math.min(seconds, t + every), 0.35, 2, fadeS); notes.push(t); }
  const kicks: number[] = [];
  for (let t = 0.25; t < seconds - 0.3; t += every) { addKick(mono, t); kicks.push(t); }
  return { mono, kicks, notes };
}

/** A chord (C E G with 30 harmonics each, up into the hats band) held throughout, and noise bursts (hats) every 0.25 s. */
export function hatsOverChords(seconds = 3): { mono: Float32Array; hats: number[] } {
  const mono = new Float32Array(Math.round(seconds * SR));
  for (const hz of [261.6, 329.6, 392]) addTone(mono, hz, 0, seconds, 0.12, 30);
  const hats: number[] = [];
  const rnd = noiseGen(3);
  for (let t = 0.2; t < seconds - 0.2; t += 0.25) { addBurst(mono, t, 0.25, 0.02, rnd); hats.push(t); }
  return { mono, hats };
}

/** Notes (a tone with harmonics, a new note every 0.4 s) and noise bursts half-way between them. */
export function notesAndBursts(seconds = 4): { mono: Float32Array; notes: number[]; bursts: number[] } {
  const mono = new Float32Array(Math.round(seconds * SR));
  const scale = [330, 392, 440, 494, 587];
  const notes: number[] = [], bursts: number[] = [];
  const rnd = noiseGen(9);
  for (let k = 0, t = 0.2; t < seconds - 0.4; k++, t += 0.4) {
    addTone(mono, scale[k % scale.length], t, t + 0.3, 0.3, 4);
    notes.push(t);
    addBurst(mono, t + 0.2, 0.35, 0.025, rnd);
    bursts.push(t + 0.2);
  }
  return { mono, notes, bursts };
}

/** A hat: white noise high-passed (two one-pole stages at about 6 kHz), decaying in `decay` seconds. */
export function addHat(out: Float32Array, at: number, amp: number, decay = 0.02, rnd = noiseGen(at * 1e4 + 11)): void {
  const i0 = Math.round(at * SR), a = 1 - Math.exp((-2 * Math.PI * 6000) / SR);
  let l1 = 0, l2 = 0;
  for (let i = 0; i < Math.round(decay * 6 * SR) && i0 + i < out.length; i++) {
    const x = rnd();
    l1 += a * (x - l1);
    const h1 = x - l1;
    l2 += a * (h1 - l2);
    out[i0 + i] += amp * Math.exp(-i / SR / decay) * (h1 - l2);
  }
}

/** A snare: a noise burst (60 ms, high-passed at about 400 Hz, as the wires sound) over a 190 Hz body (40 ms). */
export function addSnare(out: Float32Array, at: number, amp = 0.4): void {
  const i0 = Math.round(at * SR), rnd = noiseGen(at * 1e4 + 13), a = 1 - Math.exp((-2 * Math.PI * 400) / SR);
  let l1 = 0, l2 = 0;
  for (let i = 0; i < Math.round(0.36 * SR) && i0 + i < out.length; i++) {
    const x = rnd();
    l1 += a * (x - l1);
    l2 += a * (x - l1 - l2);
    out[i0 + i] += amp * Math.exp(-i / SR / 0.06) * (x - l1 - l2);
  }
  for (let i = 0; i < Math.round(0.25 * SR) && i0 + i < out.length; i++) out[i0 + i] += amp * 0.6 * Math.exp(-i / SR / 0.04) * Math.sin((2 * Math.PI * 190 * i) / SR);
}

/**
 * A little song: kicks on the beat (0.25 + n s), snares between (0.75 + n s), high hats on the off-beats (every
 * 0.25 s from 0.125), a bass line changing note every second (30 ms attack) and melody notes every 0.5 s.
 */
export function littleSong(seconds = 4): { mono: Float32Array; kicks: number[]; snares: number[]; hats: number[]; notes: number[] } {
  const mono = new Float32Array(Math.round(seconds * SR));
  const bass = [55, 65.4, 73.4, 49], mel = [330, 392, 440, 494, 587, 523, 440, 392];
  const kicks: number[] = [], snares: number[] = [], hats: number[] = [], notes: number[] = [];
  for (let k = 0; k < seconds; k++) addTone(mono, bass[k % bass.length], k, Math.min(seconds, k + 1), 0.3, 2, 0.03);
  for (let k = 0, t = 0; t < seconds - 0.3; k++, t += 0.5) { addTone(mono, mel[k % mel.length], t, t + 0.45, 0.12, 4); if (t > 0) notes.push(t); }
  for (let t = 0.25; t < seconds - 0.3; t += 1) { addKick(mono, t); kicks.push(t); }
  for (let t = 0.75; t < seconds - 0.3; t += 1) { addSnare(mono, t); snares.push(t); }
  for (let t = 0.125; t < seconds - 0.2; t += 0.25) { addHat(mono, t, 0.4); hats.push(t); }
  return { mono, kicks, snares, hats, notes };
}

/** White noise through four one-pole low-passes whose cutoff sweeps 300 → 6000 Hz (log) over `seconds`. */
export function filterSweep(seconds = 2): Float32Array {
  const mono = new Float32Array(Math.round(seconds * SR));
  const rnd = noiseGen(5), st = [0, 0, 0, 0];
  for (let i = 0; i < mono.length; i++) {
    const fc = 300 * Math.pow(20, i / mono.length), a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    let x = rnd() * 0.5;
    for (let k = 0; k < 4; k++) { st[k] += a * (x - st[k]); x = st[k]; }
    mono[i] = x;
  }
  return mono;
}

/** A live run: AnalyserNode's frame (the 2048 samples ending at each frame) every `fps`; `cb(freqDb, t, dt)`. */
export function liveFrames(mono: Float32Array, cb: (freq: Float32Array, t: number, dt: number) => void, fps = 60): void {
  const freq = new Float32Array(1024), hop = SR / fps;
  for (let f = 1; f * hop <= mono.length; f++) {
    const end = Math.round(f * hop);
    atSpectrumDbAt(mono, end - 2048, 2048, freq);
    cb(freq, end / SR, 1 / fps);
  }
}

/** Times in `found` matched to `want` within `tol` seconds: how many of `want` were found, and how many extra. */
export function matchTimes(found: readonly number[], want: readonly number[], tol: number): { hit: number; extra: number } {
  const used = new Set<number>();
  let hit = 0;
  for (const w of want) {
    const k = found.findIndex((f, i) => !used.has(i) && Math.abs(f - w) <= tol);
    if (k >= 0) { used.add(k); hit++; }
  }
  return { hit, extra: found.length - used.size };
}
