/**
 * The trigger accuracy harness (accuracy.test.ts; docs/audio-tools.md "How well it finds hits"): test songs with known
 * onset times, every preset (and Sensitivity, Only) run over them ahead (a File: atDetAnalyse + atDetPickAll + Only),
 * live in the AudioWorklet (a frame every 5 ms) and live once an animation frame (60 fps), scored as MIREX onsets
 * (strict, ±30 ms): precision, recall, F and the timing error (mean ± σ). Plus the silence test and a level sweep.
 *
 * Songs: the user's drums-test.wav (synthesised here), kicks over a moving bass line, hats over held chords, melody
 * notes with noise bursts, and a song with silence gaps (a noise floor, then digital silence) and a crescendo. A WAV
 * reference loop can join them (readWav), with its truth read from a JSON file: a licensed sample stays out of the repo.
 */
import { readFileSync } from 'node:fs';
import {
  atCharFilter, atDetAnalyse, atDetConfig, atDetHop, atDetPickAll, atNewBandRun, atStepBandRun,
  type AtBand, type AtDetConfig, type AtDetCurves,
} from '../../../play/kit/audioTools.js';
import { bandsOf, type AudioBandSpec } from '../bands';
import {
  SR, addHat, addKick, addSnare, addTone, drumsTest, hatsOverChords, kicksOverBassLine, noiseGen, notesAndBursts,
} from './detectSynth';

export type Target = 'kick' | 'snare' | 'hats' | 'notes';
export interface Song {
  name: string;
  mono: Float32Array;
  sampleRate: number;
  /** Onset times (s) each target should find. */
  truth: Partial<Record<Target, number[]>>;
  /** Times where a hit is neither right nor wrong (a snare's top for Hats, a clap's flam). */
  optional?: Partial<Record<Target, number[]>>;
  /** Stretches of silence (s): a hit in one is counted on its own too. */
  quiet?: Array<[number, number]>;
}

/** Tolerance either side of an onset, seconds. */
export const TOL = 0.03;

/** A groove from `t0` for `bars` bars of 2 s (120 BPM): kicks on the beat, snares on 2 and 4, hats on the 8ths, a bass and chords; `gain(t)` scales each hit. */
function groove(m: Float32Array, t0: number, bars: number, gain: (t: number) => number, truth: Required<Pick<Song['truth'], 'kick' | 'snare' | 'hats'>>) {
  const end = t0 + bars * 2, bass = [55, 65.4, 73.4, 49];
  for (let k = 0; t0 + k * 0.5 < end; k++) {
    const t = t0 + k * 0.5;
    addTone(m, bass[(k >> 1) % 4], t, t + 0.48, 0.25 * gain(t), 2, 0.02);
    for (const hz of [261.6, 329.6, 392]) addTone(m, hz, t, t + 0.48, 0.03 * gain(t), 12, 0.04);
    addKick(m, t, 0.8 * gain(t)); truth.kick.push(t);
    if (k % 2 === 1) { addSnare(m, t, 0.45 * gain(t)); truth.snare.push(t); }
    addHat(m, t + 0.25, 0.35 * gain(t + 0.25)); truth.hats.push(t + 0.25);
  }
}

/** 14 s: a groove, 2 s of a −60 dB hiss, a 4 s crescendo (−30 → 0 dB), 1 s of digital silence, a last bar. */
export function gapsAndCrescendo(): Song {
  const m = new Float32Array(14 * SR);
  const truth = { kick: [] as number[], snare: [] as number[], hats: [] as number[] };
  groove(m, 0, 2, () => 1, truth);
  const rnd = noiseGen(21);
  for (let i = 4 * SR; i < 6 * SR; i++) m[i] += rnd() * Math.pow(10, -60 / 20);
  groove(m, 6, 2, t => Math.pow(10, (-30 + 30 * Math.min(1, (t - 6) / 4)) / 20), truth);
  groove(m, 11, 1, () => 1, truth);
  // Up to 1 s of release after the groove; the silences: the noise floor and the digital zero.
  for (let i = 10 * SR; i < 11 * SR; i++) m[i] = 0;
  return { name: 'gaps + crescendo', mono: m, sampleRate: SR, truth, optional: { hats: truth.snare.slice() }, quiet: [[4.3, 5.95], [10.3, 10.95]] };
}

export function syntheticSongs(): Song[] {
  const d = drumsTest();
  const kb = kicksOverBassLine(6, 0.5);
  const hc = hatsOverChords(4);
  const nb = notesAndBursts(6);
  return [
    { name: 'drums-test.wav', mono: d.mono, sampleRate: SR, truth: { kick: d.kicks, snare: d.snares, hats: d.hats }, optional: { hats: d.snares } },
    // The bass's note changes are notes, not kicks (a kick detector firing on them is wrong).
    { name: 'kicks over a bass line', mono: kb.mono, sampleRate: SR, truth: { kick: kb.kicks, snare: [], hats: [] } },
    // Its bursts are white noise (low end too): only Hats is scored on it.
    { name: 'hats over chords', mono: hc.mono, sampleRate: SR, truth: { hats: hc.hats } },
    { name: 'melody + noise bursts', mono: nb.mono, sampleRate: SR, truth: { notes: nb.notes } },
    gapsAndCrescendo(),
  ];
}

/** A WAV file (PCM 16 / 24 / 32-bit or float), channels averaged. */
export function readWav(path: string): { mono: Float32Array; sampleRate: number } {
  const b = readFileSync(path);
  let p = 12, fmt: { format: number; ch: number; sr: number; bits: number } | null = null, data: { at: number; len: number } | null = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = { at: p + 8, len: Math.min(len, b.length - p - 8) };
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('not a WAV');
  const bps = fmt.bits / 8, frames = Math.floor(data.len / (bps * fmt.ch)), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = data.at + (i * fmt.ch + c) * bps;
      s += fmt.format === 3 ? b.readFloatLE(o) : fmt.bits === 16 ? b.readInt16LE(o) / 32768 : fmt.bits === 24 ? b.readIntLE(o, 3) / 8388608 : b.readInt32LE(o) / 2147483648;
    }
    mono[i] = s / fmt.ch;
  }
  return { mono, sampleRate: fmt.sr };
}

/** A reference song from a WAV and its truth JSON ({ kick: [{t}…], snare, hats, optional: { snare: [t…] } }), or null when either is missing. */
export function referenceSong(wav: string | undefined, truthJson: string | undefined, name = 'reference loop'): Song | null {
  if (!wav || !truthJson) return null;
  try {
    const { mono, sampleRate } = readWav(wav);
    const t = JSON.parse(readFileSync(truthJson, 'utf8')) as Record<string, unknown>;
    const times = (v: unknown) => (Array.isArray(v) ? v.map(x => (typeof x === 'number' ? x : (x as { t: number }).t)) : []);
    const opt = (t.optional ?? {}) as Record<string, unknown>;
    return {
      name, mono, sampleRate,
      truth: { kick: times(t.kick), snare: times(t.snare), hats: times(t.hats) },
      optional: { kick: times(opt.kick), snare: times(opt.snare), hats: times(opt.hats) },
    };
  } catch { return null; }
}

// ── Silence and level ────────────────────────────────────────────────────────────────────────────────────────

/** Pink-ish noise (white through a 1/f-ish filter) at an RMS in dBFS. */
function pinkNoise(n: number, db: number, seed = 31): Float32Array {
  const rnd = noiseGen(seed), out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848; s2 += out[i] * out[i];
  }
  const g = Math.pow(10, db / 20) / Math.sqrt(s2 / n);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/**
 * The silence test (a pass / fail gate before any F-measure): 10 s of digital silence, 10 s of −70 dBFS pink noise,
 * 10 s of −80 dBFS white noise, 10 s of a −30 dBFS sustained chord and 10 s of a −40 dBFS tone. No hits anywhere.
 */
export function silenceSongs(): Song[] {
  const n = 10 * SR, white = new Float32Array(n), rnd = noiseGen(77), chord = new Float32Array(n), tone = new Float32Array(n);
  for (let i = 0; i < n; i++) white[i] = rnd() * Math.pow(10, -80 / 20) * Math.sqrt(3);
  // A chord (C E G, a few harmonics) at about −30 dBFS RMS, faded in over 50 ms; a 440 Hz tone at −40 dBFS.
  for (const hz of [130.8, 164.8, 196, 261.6, 329.6, 392]) addTone(chord, hz, 0, 10, 0.0105, 3, 0.05);
  addTone(tone, 440, 0, 10, Math.pow(10, -40 / 20) * Math.SQRT2, 1, 0.05);
  const none = { kick: [], snare: [], hats: [], notes: [] };
  return [
    { name: 'digital silence', mono: new Float32Array(n), sampleRate: SR, truth: none },
    { name: '−70 dBFS pink noise', mono: pinkNoise(n, -70), sampleRate: SR, truth: none },
    { name: '−80 dBFS white noise', mono: white, sampleRate: SR, truth: none },
    { name: '−30 dBFS held chord', mono: chord, sampleRate: SR, truth: none },
    { name: '−40 dBFS tone', mono: tone, sampleRate: SR, truth: none },
  ];
}

/** A song at another level (dB). */
export function atLevel(s: Song, db: number): Song {
  const g = Math.pow(10, db / 20), mono = new Float32Array(s.mono.length);
  for (let i = 0; i < mono.length; i++) mono[i] = s.mono[i] * g;
  return { ...s, name: `${s.name} ${db} dB`, mono };
}

// ── Detectors ────────────────────────────────────────────────────────────────────────────────────────────────

export interface Detector { name: string; target: Target; band: Record<string, unknown> }

/** A band from raw fields, cleaned as a saved band is (bands.ts bandsOf), as a trigger. */
export const bandFrom = (raw: Record<string, unknown>): AudioBandSpec => bandsOf({ bands: [{ id: 'x', name: 'x', value: false, trigger: true, ...raw }] })[0];

/** How the detector is run: ahead (a File), live in the AudioWorklet (5 ms hops) or live once an animation frame (60 fps). */
export type RunMode = 'ahead' | 'worklet' | 'raf';
export const RUN_MODES: readonly RunMode[] = ['ahead', 'worklet', 'raf'];

// ── Running ──────────────────────────────────────────────────────────────────────────────────────────────────

const aheadCache = new WeakMap<Float32Array, Map<string, AtDetCurves>>();
function curvesOf(song: Song, cfg: AtDetConfig): AtDetCurves {
  let m = aheadCache.get(song.mono);
  if (!m) aheadCache.set(song.mono, (m = new Map()));
  let c = m.get(cfg.specKey);
  if (!c) { [c] = atDetAnalyse(song.mono, song.sampleRate, [cfg.spec]); m.set(cfg.specKey, c); }
  return c;
}

/** A band's hits on a song analysed ahead, as a File's are picked (ahead.ts AheadAnalysis.events): onset times. */
export function aheadHits(song: Song, b: AudioBandSpec): number[] {
  const cfg = atDetConfig(b), c = curvesOf(song, cfg), hs = atDetHop(song.sampleRate) / song.sampleRate;
  const all = atDetPickAll(c, hs, cfg);
  return Array.from(atCharFilter(all, c.aflat, c.arise, hs, cfg.character, cfg.charAt).times);
}

/**
 * A band's hits live: the moments its Trigger fires (what a picture sees). `worklet`: a frame every 5 ms on the 1024
 * samples ending then (the AudioWorklet); `raf`: a frame every 1/60 s on the last 2048 samples (AnalyserNode's buffer).
 */
export function liveHits(song: Song, b: AudioBandSpec, mode: 'worklet' | 'raf' = 'worklet'): number[] {
  const run = atNewBandRun(), out: number[] = [], sr = song.sampleRate;
  const hop = mode === 'worklet' ? atDetHop(sr) : sr / 60, len = 4096;
  const buf = new Float32Array(len);
  for (let f = 1; f * hop <= song.mono.length; f++) {
    const end = Math.round(f * hop);
    for (let i = 0; i < len; i++) { const k = end - len + i; buf[i] = k >= 0 ? song.mono[k] : 0; }
    atStepBandRun(run, b as AtBand, buf, sr, end / sr, hop / sr);
    if (run.hit.trigger) out.push(end / sr);
  }
  return out;
}

export function hitsOf(song: Song, b: AudioBandSpec, mode: RunMode): number[] {
  return mode === 'ahead' ? aheadHits(song, b) : liveHits(song, b, mode);
}

// ── Scoring (MIREX onsets, strict, ±30 ms) ───────────────────────────────────────────────────────────────────

export interface Score { tp: number; fp: number; fn: number; errs: number[]; quietHits: number }
export const emptyScore = (): Score => ({ tp: 0, fp: 0, fn: 0, errs: [], quietHits: 0 });

/** Reference onsets within TOL of each other become one, at their mean (Böck 2012: a flam is not a miss). */
export function combineTruth(truth: readonly number[]): number[] {
  const t = [...truth].sort((a, b) => a - b), out: number[] = [];
  for (let i = 0; i < t.length;) {
    let j = i, sum = 0;
    while (j < t.length && t[j] - t[i] <= TOL) sum += t[j++];
    out.push(sum / (j - i));
    i = j;
  }
  return out;
}

/**
 * Strict matching within TOL: each reference matched at most once, nearest pairs first. Hits near an optional time
 * (and no reference) are dropped. `errs`: detected − reference of each match (s).
 */
export function score(hits: readonly number[], truthIn: readonly number[], optional: readonly number[] = [], quiet: ReadonlyArray<[number, number]> = []): Score {
  const truth = combineTruth(truthIn);
  const kept = hits.filter(h => !optional.some(o => Math.abs(h - o) <= TOL) || truth.some(t => Math.abs(h - t) <= TOL));
  const pairs: Array<[number, number, number]> = [];
  kept.forEach((h, i) => truth.forEach((t, j) => { const d = Math.abs(h - t); if (d <= TOL + 1e-9) pairs.push([d, i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const ui = new Set<number>(), uj = new Set<number>(), errs: number[] = [];
  for (const [, i, j] of pairs) if (!ui.has(i) && !uj.has(j)) { ui.add(i); uj.add(j); errs.push(kept[i] - truth[j]); }
  const quietHits = hits.filter(h => quiet.some(([a, b]) => h >= a && h <= b)).length;
  return { tp: ui.size, fp: kept.length - ui.size, fn: truth.length - uj.size, errs, quietHits };
}

export function add(a: Score, b: Score): Score {
  return { tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn, errs: [...a.errs, ...b.errs], quietHits: a.quietHits + b.quietHits };
}

/** P, R, F, and the timing error's mean and σ (ms). */
export function prf(s: Score): { p: number; r: number; f: number; mean: number; sd: number } {
  const p = s.tp + s.fp ? s.tp / (s.tp + s.fp) : s.fn ? 0 : 1;
  const r = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 1;
  const n = s.errs.length, mean = n ? s.errs.reduce((a, v) => a + v, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(s.errs.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1)) : 0;
  return { p, r, f: p + r ? (2 * p * r) / (p + r) : 0, mean: mean * 1000, sd: sd * 1000 };
}

/** A detector over songs in each run mode: summed scores (songs without truth for its target are skipped). */
export function evaluate(d: Detector, songs: readonly Song[], modes: readonly RunMode[] = RUN_MODES): Record<RunMode, Score> {
  const b = bandFrom(d.band), out = { ahead: emptyScore(), worklet: emptyScore(), raf: emptyScore() };
  for (const s of songs) {
    const truth = s.truth[d.target];
    if (!truth) continue;
    const opt = s.optional?.[d.target] ?? [];
    for (const m of modes) out[m] = add(out[m], score(hitsOf(s, b, m), truth, opt, s.quiet));
  }
  return out;
}

/** One table row: P / R / F and timing (mean ± σ ms) per mode, hits in silence. */
export function row(d: Detector, songs: readonly Song[]): string {
  const e = evaluate(d, songs), f = (x: number) => x.toFixed(2);
  const cell = (m: RunMode) => { const q = prf(e[m]); return `${f(q.p)} / ${f(q.r)} / **${f(q.f)}** | ${q.mean >= 0 ? '+' : ''}${q.mean.toFixed(0)} ± ${q.sd.toFixed(0)}`; };
  return `| ${d.target} | ${d.name} | ${cell('ahead')} | ${cell('worklet')} | ${cell('raf')} | ${e.ahead.quietHits + e.worklet.quietHits + e.raf.quietHits} |`;
}
export const TABLE_HEAD = '| Target | Detector | Ahead P / R / F | ms | Live 5 ms P / R / F | ms | Live 60 fps P / R / F | ms | Hits in silence |\n|---|---|---|---|---|---|---|---|---|';
