/**
 * learn.ts — Learn a sound (docs/audio-tools.md): detection by example on the Audio Source, pure so it can be tested.
 *
 * **Fingerprint.** From the moment the user picked (the window's selection or trim on a file, the last two seconds
 * of the Mic), find the strongest onset (spectral flux over the whole spectrum) and take the analysis frames in the
 * LEARN_WINDOW after it (about 50 ms; each frame already holds the 43 ms before it, so ~90 ms of sound):
 *  - `spec`: the power in LEARN_BANDS log-spaced bands (40 Hz – 16 kHz), averaged over those frames, in dB, floored
 *    60 dB under its loudest band, then centred (its mean taken away) and scaled to length 1. Centring dB removes the
 *    overall loudness, so a quiet clap and a loud one have the same fingerprint;
 *  - `env`: its loudness at ENV_POINTS moments across the window, relative to the loudest of them (0..1).
 *
 * **Matching, live.** Every frame the whole spectrum is watched for an onset (spectral flux over the learn bands with
 * Hit's adaptive threshold). After an onset, the frames of the next LEARN_WINDOW make a fingerprint the same way, and each
 * learned sound gets a similarity: 0.85 × the cosine of the two `spec`s (clamped at 0) + 0.15 × how alike the
 * envelopes are. At or above the sound's **Match** it fires (Trigger 1 for one frame, at most once per Cooldown); its
 * Match output holds the similarity of the last onset, falling to 0 in MATCH_FALL seconds. The trigger comes about
 * LEARN_WINDOW after the hit.
 */
import { binHz, DB_FLOOR, hitThreshold, HIT_HISTORY, spectrumDb } from './dsp';

export const LEARN_BANDS = 40;
export const LEARN_MIN_HZ = 40;
export const LEARN_MAX_HZ = 16000;
/** Seconds of frames after an onset that make a fingerprint. */
export const LEARN_WINDOW = 0.05;
export const ENV_POINTS = 4;
/** Seconds the Match output takes to fall from 1 to 0 after an onset. */
export const MATCH_FALL = 0.5;
/** How far under its loudest band a fingerprint's bands are floored, dB. */
const FLOOR_DB = 60;
/** The analysis the live path sees (engine.ts: FFT 2048), and the hop learning from a file uses (60 frames a second). */
export const LEARN_FFT = 2048;
export const LEARN_HOP_SECONDS = 1 / 60;
/** The longest selection a file is learned from, in seconds. */
export const LEARN_MAX_SELECTION = 20;
/** Seconds of frames the engine keeps for "Learn last hit". */
export const LEARN_RING_SECONDS = 2.5;

/** The onset detector the matcher listens with: Sensitivity (as Hit's) and the shortest gap between two onsets. */
export const LEARN_ONSET = { sensitivity: 0.6, cooldownMs: 80 };

// ── Features ─────────────────────────────────────────────────────────────────────────────────────────────────

const edges = (() => {
  const e = new Float64Array(LEARN_BANDS + 1);
  for (let i = 0; i <= LEARN_BANDS; i++) e[i] = LEARN_MIN_HZ * Math.pow(LEARN_MAX_HZ / LEARN_MIN_HZ, i / LEARN_BANDS);
  return e;
})();

/** The power in each learn band of a dB spectrum (AnalyserNode's), as dB. A band narrower than a bin reads its nearest bin. */
export function learnBands(freqDb: Float32Array, sampleRate: number, out = new Float32Array(LEARN_BANDS)): Float32Array {
  const nb = freqDb.length, hz = binHz(sampleRate, nb);
  const p = (i: number) => { const db = freqDb[Math.max(0, Math.min(nb - 1, i))]; return db > DB_FLOOR ? Math.pow(10, db / 10) : 0; };
  for (let b = 0; b < LEARN_BANDS; b++) {
    const a = Math.ceil(edges[b] / hz), z = Math.min(nb - 1, Math.floor(edges[b + 1] / hz));
    let sum = 0, n = 0;
    for (let i = a; i <= z; i++) { sum += p(i); n++; }
    const pw = n ? sum / n : p(Math.round((edges[b] + edges[b + 1]) / 2 / hz));
    out[b] = pw > 0 ? 10 * Math.log10(pw) : DB_FLOOR;
  }
  return out;
}

/** One analysis frame as the learner keeps it: when (seconds), its learn bands (dB), and the whole-spectrum flux. */
export interface LearnFrame { t: number; bands: Float32Array; flux: number }

/**
 * Spectral flux over the learn bands: how much each band rose since the last frame (log-compressed amplitude, as
 * Hit's), averaged with every band counting the same, so a kick's few low bands count as much as a clap's many.
 */
const fluxUnit = (db: number): number => (db > DB_FLOOR ? Math.log1p(100 * Math.min(1, Math.pow(10, db / 20))) / Math.log1p(100) : 0);
export function learnFlux(prev: Float32Array, cur: Float32Array): number {
  let sum = 0;
  for (let b = 0; b < LEARN_BANDS; b++) { const d = fluxUnit(cur[b]) - fluxUnit(prev[b]); if (d > 0) sum += d; }
  return sum / LEARN_BANDS;
}

/** Onsets over the whole spectrum: the flux above a threshold that follows its recent mean (Hit's). */
export interface OnsetState { prev: Float32Array | null; history: Float32Array; at: number; filled: number; last: number; flux: number; trigger: number }
export const newOnsetState = (): OnsetState => ({ prev: null, history: new Float32Array(HIT_HISTORY), at: 0, filled: 0, last: -Infinity, flux: 0, trigger: 0 });
export function stepOnset(s: OnsetState, bands: Float32Array, now: number): OnsetState {
  s.trigger = 0;
  s.flux = s.prev ? learnFlux(s.prev, bands) : 0;
  s.prev = bands;
  let mean = 0;
  for (let i = 0; i < s.filled; i++) mean += s.history[i];
  mean = s.filled ? mean / s.filled : 0;
  const thr = hitThreshold(mean, LEARN_ONSET.sensitivity);
  s.history[s.at] = s.flux;
  s.at = (s.at + 1) % s.history.length;
  s.filled = Math.min(s.history.length, s.filled + 1);
  if (s.flux > thr && (now - s.last) * 1000 >= LEARN_ONSET.cooldownMs) { s.last = now; s.trigger = 1; }
  return s;
}

export interface Fingerprint {
  /** LEARN_BANDS values: centred dB, length 1. */
  spec: number[];
  /** ENV_POINTS values 0..1: loudness across the window, 1 = its loudest. */
  env: number[];
}

const levelDb = (bands: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < bands.length; i++) s += Math.pow(10, bands[i] / 10);
  return s > 0 ? 10 * Math.log10(s) : DB_FLOOR;
};

/** The fingerprint of the frames after an onset (`frames[0]` is the onset), or null for silence. */
export function fingerprintOf(frames: readonly LearnFrame[]): Fingerprint | null {
  if (!frames.length) return null;
  const t0 = frames[0].t;
  const use = frames.filter(f => f.t - t0 <= LEARN_WINDOW + 1e-6);
  // Average power, back to dB, floored under the loudest band, centred, length 1.
  const pw = new Float64Array(LEARN_BANDS);
  for (const f of use) for (let b = 0; b < LEARN_BANDS; b++) pw[b] += Math.pow(10, f.bands[b] / 10) / use.length;
  const db = Array.from(pw, v => (v > 0 ? 10 * Math.log10(v) : DB_FLOOR));
  const top = Math.max(...db);
  if (!(top > DB_FLOOR + 1)) return null;
  for (let b = 0; b < LEARN_BANDS; b++) db[b] = Math.max(db[b], top - FLOOR_DB);
  const mean = db.reduce((a, v) => a + v, 0) / LEARN_BANDS;
  let norm = 0;
  for (let b = 0; b < LEARN_BANDS; b++) { db[b] -= mean; norm += db[b] * db[b]; }
  norm = Math.sqrt(norm);
  if (!(norm > 1e-6)) return null;
  const spec = db.map(v => +(v / norm).toFixed(4));
  // The envelope: each frame's level, read at ENV_POINTS moments (between frames: the nearer two, blended).
  const lv = use.map(f => ({ t: f.t - t0, l: levelDb(f.bands) }));
  const at = (t: number) => {
    if (lv.length === 1 || t <= lv[0].t) return lv[0].l;
    for (let i = 1; i < lv.length; i++) if (t <= lv[i].t) { const k = (t - lv[i - 1].t) / Math.max(1e-9, lv[i].t - lv[i - 1].t); return lv[i - 1].l * (1 - k) + lv[i].l * k; }
    return lv[lv.length - 1].l;
  };
  const raw = Array.from({ length: ENV_POINTS }, (_, i) => at((LEARN_WINDOW * i) / (ENV_POINTS - 1)));
  const peak = Math.max(...raw);
  const env = raw.map(l => +Math.max(0, 1 + (l - peak) / 40).toFixed(4));
  return { spec, env };
}

/** How alike two fingerprints are, 0..1: mostly the spectra's cosine, a little the envelopes'. */
export function similarity(a: Fingerprint, b: { spec: readonly number[]; env: readonly number[] }): number {
  if (a.spec.length !== b.spec.length || !a.spec.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.spec.length; i++) dot += a.spec[i] * b.spec[i];
  let envSim = 1;
  if (a.env.length && a.env.length === b.env.length) {
    let d = 0;
    for (let i = 0; i < a.env.length; i++) d += Math.abs(a.env[i] - b.env[i]);
    envSim = 1 - d / a.env.length;
  }
  return Math.max(0, Math.min(1, 0.85 * Math.max(0, dot) + 0.15 * envSim));
}

// ── Learning ─────────────────────────────────────────────────────────────────────────────────────────────────

export type LearnResult = (Fingerprint & { at: number }) | { error: string };

/**
 * Learn from frames: the strongest onset with its time between `from` and `to` (seconds; the earliest of the two
 * frames before it that already rose half as much, so it lines up with where the live detector fires), and the
 * fingerprint of the frames after it.
 */
export function learnFromFrames(frames: readonly LearnFrame[], from: number, to: number): LearnResult {
  let best = -1;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    if (f.t < from - 1e-6 || f.t > to + 1e-6) continue;
    if (best < 0 || f.flux > frames[best].flux) best = i;
  }
  if (best < 0 || !(frames[best].flux > 1e-4)) return { error: 'No hit found there: pick a moment where the sound starts.' };
  let on = best;
  for (let k = 1; k <= 2 && best - k >= 1; k++) if (frames[best - k].flux >= 0.5 * frames[best].flux) on = best - k;
  const fp = fingerprintOf(frames.slice(on));
  return fp ? { ...fp, at: frames[on].t } : { error: 'That moment is silent.' };
}

/**
 * The frames the live path would see over a stretch of sound: one AnalyserNode-like spectrum (FFT 2048) ending at
 * every hop from `from` to `to` seconds (zeros before the sound), its learn bands and its flux.
 */
export function framesFromSamples(samples: Float32Array, sampleRate: number, from: number, to: number, hop = LEARN_HOP_SECONDS): LearnFrame[] {
  const out: LearnFrame[] = [];
  const block = new Float32Array(LEARN_FFT);
  let prev: Float32Array | null = null;
  const h = Math.max(1, Math.round(hop * sampleRate));
  // Start a few frames early so the first onset has a frame before it to rise from.
  for (let end = Math.max(0, Math.round(from * sampleRate) - 3 * h); end <= Math.round(to * sampleRate); end += h) {
    for (let i = 0; i < LEARN_FFT; i++) { const k = end - LEARN_FFT + i; block[i] = k >= 0 && k < samples.length ? samples[k] : 0; }
    const bands = learnBands(spectrumDb(block), sampleRate);
    out.push({ t: end / sampleRate, bands, flux: prev ? learnFlux(prev, bands) : 0 });
    prev = bands;
  }
  return out;
}

/** Learn from a stretch of a file's samples (mono), `from`…`to` seconds. */
export function learnFromSamples(samples: Float32Array, sampleRate: number, from: number, to: number): LearnResult {
  if (to - from > LEARN_MAX_SELECTION) return { error: `Select a shorter moment (under ${LEARN_MAX_SELECTION} s) around one hit of the sound.` };
  return learnFromFrames(framesFromSamples(samples, sampleRate, from, to + LEARN_WINDOW + LEARN_HOP_SECONDS), from, to);
}

// ── Learned sounds in the node's params ──────────────────────────────────────────────────────────────────────

export interface AudioSoundSpec {
  id: string;
  name: string;
  color: string;
  /** 0..1: fire at or above this similarity. */
  match: number;
  /** Milliseconds after a fire before the next. */
  cooldown: number;
  /** Sends a Trigger output. */
  trigger: boolean;
  /** Sends a Match output (the similarity at the last onset, falling). */
  matchOut: boolean;
  spec: number[];
  env: number[];
}

export const SOUND_COLORS = ['#f9e2af', '#a6e3a1', '#f5c2e7', '#89dceb', '#fab387', '#cba6f7', '#f38ba8', '#89b4fa'];
export const SOUND_DEFAULTS = { match: 0.8, cooldown: 150 };

const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const slugId = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
const numbers = (v: unknown, n: number): number[] => (Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v as number[] : []);

/** The node's learned sounds, cleaned. `taken` are ids already used (its bands'), so the outputs never clash. */
export function soundsOf(params: Record<string, unknown>, taken: ReadonlySet<string> = new Set()): AudioSoundSpec[] {
  const raw = Array.isArray(params.sounds) ? params.sounds : [];
  const out: AudioSoundSpec[] = [];
  const seen = new Set(taken);
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const s = r as Record<string, unknown>;
    let id = slugId(String(s.id ?? '')) || `s${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const trigger = s.trigger !== false, matchOut = s.matchOut !== false;
    out.push({
      id,
      name: String(s.name ?? '').trim() || `Sound ${i + 1}`,
      color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : SOUND_COLORS[i % SOUND_COLORS.length],
      match: num(s.match, SOUND_DEFAULTS.match, 0, 1),
      cooldown: num(s.cooldown, SOUND_DEFAULTS.cooldown, 40, 4000),
      // A sound that sends nothing still sends its Trigger.
      trigger: trigger || !matchOut,
      matchOut,
      spec: numbers(s.spec, LEARN_BANDS),
      env: numbers(s.env, ENV_POINTS),
    });
  });
  return out;
}

/** A new learned sound ("Sound 1", "Sound 2"…) with a fingerprint, after `sounds`. */
export function newSound(sounds: readonly AudioSoundSpec[], fp: Fingerprint, takenIds: ReadonlySet<string> = new Set()): AudioSoundSpec {
  let id = '';
  for (let i = 1; ; i++) { id = `s${i}`; if (!sounds.some(s => s.id === id) && !takenIds.has(id)) break; }
  let name = '';
  for (let i = 1; ; i++) { name = `Sound ${i}`; if (!sounds.some(s => s.name === name)) break; }
  const used = new Set(sounds.map(s => s.color));
  return {
    id, name, color: SOUND_COLORS.find(c => !used.has(c)) ?? SOUND_COLORS[sounds.length % SOUND_COLORS.length],
    ...SOUND_DEFAULTS, trigger: true, matchOut: true, spec: fp.spec, env: fp.env,
  };
}

export const soundTriggerKey = (id: string) => `${id}_t`;
export const soundMatchKey = (id: string) => `${id}_m`;

/** The outputs a learned sound adds: "Clap (trigger)" and "Clap (match)". */
export function soundOutputs(sounds: readonly AudioSoundSpec[]): Array<{ key: string; label: string; channel: string }> {
  const out: Array<{ key: string; label: string; channel: string }> = [];
  for (const s of sounds) {
    if (s.trigger) out.push({ key: soundTriggerKey(s.id), label: `${s.name} (trigger)`, channel: soundTriggerKey(s.id) });
    if (s.matchOut) out.push({ key: soundMatchKey(s.id), label: `${s.name} (match)`, channel: soundMatchKey(s.id) });
  }
  return out;
}

// ── Listening, once per frame ────────────────────────────────────────────────────────────────────────────────

export interface SoundRun {
  /** 1 on the frame it fired. */
  trigger: number;
  /** The similarity at the last onset, falling to 0. */
  match: number;
  /** The similarity at the last onset, as it was. */
  last: number;
  lastFire: number;
  /** When it last fired (seconds), for the window's flash. */
  hitAt: number;
  count: number;
}
const newSoundRun = (): SoundRun => ({ trigger: 0, match: 0, last: 0, lastFire: -Infinity, hitAt: -Infinity, count: 0 });

export interface LearnListener {
  onset: OnsetState;
  pending: { t0: number; frames: LearnFrame[] } | null;
  /** The last LEARN_RING_SECONDS of frames, oldest first. */
  ring: LearnFrame[];
  runs: Map<string, SoundRun>;
  /** Onsets heard (for the window). */
  onsets: number;
}
export const newLearnListener = (): LearnListener => ({ onset: newOnsetState(), pending: null, ring: [], runs: new Map(), onsets: 0 });

/**
 * One frame: keep it in the ring, watch for an onset, and LEARN_WINDOW after one compare its fingerprint with every
 * learned sound. `now` is seconds on the wall clock, `dt` seconds since the last frame. Mutates `L`.
 */
export function stepLearn(L: LearnListener, sounds: readonly AudioSoundSpec[], freqDb: Float32Array, sampleRate: number, now: number, dt: number): void {
  for (const id of [...L.runs.keys()]) if (!sounds.some(s => s.id === id)) L.runs.delete(id);
  for (const s of sounds) {
    let r = L.runs.get(s.id);
    if (!r) L.runs.set(s.id, (r = newSoundRun()));
    r.trigger = 0;
    r.match = Math.max(0, r.match - dt / MATCH_FALL);
  }
  const bands = learnBands(freqDb, sampleRate);
  stepOnset(L.onset, bands, now);
  const frame: LearnFrame = { t: now, bands, flux: L.onset.flux };
  L.ring.push(frame);
  while (L.ring.length && now - L.ring[0].t > LEARN_RING_SECONDS) L.ring.shift();
  if (L.pending) {
    L.pending.frames.push(frame);
    if (now - L.pending.t0 >= LEARN_WINDOW - 1e-6) {
      const fp = fingerprintOf(L.pending.frames);
      L.pending = null;
      if (fp) for (const s of sounds) {
        if (!s.spec.length) continue;
        const r = L.runs.get(s.id)!, sim = similarity(fp, s);
        r.match = r.last = sim;
        if (sim >= s.match && (now - r.lastFire) * 1000 >= s.cooldown) { r.trigger = 1; r.lastFire = r.hitAt = now; r.count++; }
      }
    }
  } else if (L.onset.trigger) {
    L.onsets++;
    L.pending = { t0: now, frames: [frame] };
  }
}

/** "Learn last hit": the strongest onset in the ring that has its whole window after it. */
export function learnFromRing(L: LearnListener): LearnResult {
  if (L.ring.length < 3) return { error: 'Nothing heard yet: play the sound, then press Learn last hit.' };
  const last = L.ring[L.ring.length - 1].t;
  return learnFromFrames(L.ring, L.ring[0].t, last - LEARN_WINDOW);
}
