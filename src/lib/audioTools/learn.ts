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
import { spectrumDb } from './dsp';
import {
  AT_LEARN_WINDOW as LEARN_WINDOW, AT_LEARN_BANDS as LEARN_BANDS, AT_ENV_POINTS as ENV_POINTS, atFingerprintOf as fingerprintOf, atLearnBands as learnBands, atLearnFlux as learnFlux,
  type AtFingerprint as Fingerprint, type AtLearnFrame as LearnFrame, type AtLearnListener as LearnListener,
} from '../../play/kit/audioTools.js';

/**
 * The features and the live matcher live in play/kit/audioTools.js, so an exported page (runtime/play-runtime.js)
 * matches learned sounds exactly as the app does; re-exported here under their app names.
 */
export {
  AT_LEARN_BANDS as LEARN_BANDS, AT_LEARN_MIN_HZ as LEARN_MIN_HZ, AT_LEARN_MAX_HZ as LEARN_MAX_HZ, AT_LEARN_WINDOW as LEARN_WINDOW,
  AT_ENV_POINTS as ENV_POINTS, AT_MATCH_FALL as MATCH_FALL, AT_LEARN_RING_SECONDS as LEARN_RING_SECONDS, AT_LEARN_ONSET as LEARN_ONSET,
  atLearnBands as learnBands, atLearnFlux as learnFlux, atNewOnsetState as newOnsetState, atStepOnset as stepOnset,
  atFingerprintOf as fingerprintOf, atSimilarity as similarity, atNewLearnListener as newLearnListener, atStepLearn as stepLearn,
} from '../../play/kit/audioTools.js';
export type {
  AtLearnFrame as LearnFrame, AtOnsetState as OnsetState, AtFingerprint as Fingerprint, AtSoundRun as SoundRun, AtLearnListener as LearnListener,
} from '../../play/kit/audioTools.js';

/** The analysis the live path sees (engine.ts: FFT 2048), and the hop learning from a file uses (60 frames a second). */
export const LEARN_FFT = 2048;
export const LEARN_HOP_SECONDS = 1 / 60;
/** The longest selection a file is learned from, in seconds. */
export const LEARN_MAX_SELECTION = 20;

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

// ── Listening, once per frame: newLearnListener and stepLearn (above, from the kit) ───────────────────────────


/** "Learn last hit": the strongest onset in the ring that has its whole window after it. */
export function learnFromRing(L: LearnListener): LearnResult {
  if (L.ring.length < 3) return { error: 'Nothing heard yet: play the sound, then press Learn last hit.' };
  const last = L.ring[L.ring.length - 1].t;
  return learnFromFrames(L.ring, L.ring[0].t, last - LEARN_WINDOW);
}
