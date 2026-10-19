/**
 * bands.ts — Audio Source's own bands and trim (docs/audio-tools.md), pure so they can be tested.
 *
 * A band is a frequency range picked on the Audio Source's window: it sends out a Value (its level 0–1, followed with
 * Attack / Release, scaled by Gain), a Trigger (1 for one frame each time its level rises above a fixed Threshold:
 * Release, Gate, Min time, Cooldown; play/kit/audioTools.js atStepTrigger), or both. Each becomes an output socket on
 * the node (`<band id>_v`, `<band id>_t`), named after the band. Below the Gate the band is silence: Value 0, no hits.
 *
 * The trim is In / Out in seconds on the loaded file: playback loops between them.
 */
import { AT_CHAR_AT, AT_TRIGGER_DEFAULTS, atCharacterOf, atDetectOf, atThresholdFromSensitivity, type AtCharacter, type AtDetect } from '../../play/kit/audioTools.js';

export type AudioBandDetect = AtDetect;
export type AudioBandCharacter = AtCharacter;

/** Detect's choices, in the window's order, with what each reads (docs/audio-tools.md "Detect"). */
export const BAND_DETECTS: ReadonlyArray<{ key: AudioBandDetect; label: string; title: string }> = [
  { key: 'level', label: 'Level', title: 'How loud the band is (as before): fires when it rises above the Threshold.' },
  { key: 'hits', label: 'Hits', title: 'Onsets: how suddenly new sound arrives in the band, against how busy it has been. Catches kicks over a held bass line.' },
  { key: 'transient', label: 'Transient', title: 'Attack sharpness: a click or snap reads high, a swell stays low.' },
  { key: 'flatness', label: 'Noisy ↔ tonal', title: 'Spectral flatness: 0 a pure tone, near 1 noise (hats, snares, breath).' },
  { key: 'brightness', label: 'Brightness', title: 'Where the band\'s energy sits: 0 at its bottom, 1 at its top (its spectral centroid).' },
  { key: 'drums', label: 'Drums only', title: 'Separates the drums from sustained notes first (harmonic / percussive separation), then finds hits on the drums alone.' },
];
export const BAND_CHARACTERS: ReadonlyArray<{ key: AudioBandCharacter; label: string; title: string }> = [
  { key: 'any', label: 'Any', title: 'Every hit counts.' },
  { key: 'noisy', label: 'Noisy', title: 'Only hits that are noisy (drums, hats, snares): the band\'s flatness just after the hit is at least "Noisy at".' },
  { key: 'tonal', label: 'Tonal', title: 'Only hits that are tonal (melodic notes): the band\'s flatness just after the hit is under "Noisy at".' },
];

export interface AudioBandSpec {
  id: string;
  name: string;
  /** CSS colour (#rrggbb) for the band on the window and its readouts. */
  color: string;
  lo: number;
  hi: number;
  /** Sends a Value output: the band's level, 0–1. */
  value: boolean;
  /** Sends a Trigger output: 1 for one frame per hit in the band. */
  trigger: boolean;
  attack: number;
  release: number;
  gain: number;
  /** Fires when the level rises above this (0–1, the level's scale), once per rise. */
  threshold: number;
  /** Re-arms once the level falls below Threshold × this (0–1). */
  releaseAt: number;
  /** Below this level the band is silence (Value 0, no hits); 0 is off. */
  gate: number;
  /** Milliseconds the level must stay above Threshold to fire. */
  minMs: number;
  cooldown: number;
  /**
   * How the band isolates (the window's equaliser, components/audio/bandEq.ts): Band (a band-pass from lo to hi),
   * Low cut (everything above lo: hi is the top) or High cut (everything below hi: lo is the bottom). The analysis
   * measures lo–hi either way. Bands saved before shapes are Band.
   */
  shape: AudioBandShape;
  /** How steeply its edges fall, dB per octave: the drawn curve and what Solo / Hear hovered play. */
  slope: AudioBandSlope;
  /**
   * What its Value sends and its Trigger fires on (play/kit/audioTools.js "Detect"): Level (the default, as before),
   * Hits, Transient, Noisy ↔ tonal (flatness), Brightness, Drums only. The Gate reads the level whatever it detects.
   */
  detect: AudioBandDetect;
  /** Only: let a hit through when the band is noisy (drums) or tonal (notes) just after it, or any. */
  character: AudioBandCharacter;
  /** Only's line on the band's flatness (0 tonal … 1 noise). */
  charAt: number;
}

export type AudioBandShape = 'band' | 'lowcut' | 'highcut';
export type AudioBandSlope = 12 | 24 | 48;
export const BAND_SHAPES: readonly AudioBandShape[] = ['band', 'lowcut', 'highcut'];
export const BAND_SLOPES: readonly AudioBandSlope[] = [12, 24, 48];

export const BAND_COLORS = ['#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#89dceb', '#89b4fa', '#cba6f7', '#f5c2e7'];

const BAND_DEFAULTS = {
  value: true, trigger: false, attack: 0.01, release: 0.15, gain: 1,
  threshold: AT_TRIGGER_DEFAULTS.threshold, releaseAt: AT_TRIGGER_DEFAULTS.releaseAt, gate: AT_TRIGGER_DEFAULTS.gate, minMs: AT_TRIGGER_DEFAULTS.minMs, cooldown: 120,
  shape: 'band' as AudioBandShape, slope: 24 as AudioBandSlope,
  detect: 'level' as AudioBandDetect, character: 'any' as AudioBandCharacter, charAt: AT_CHAR_AT,
};

export interface BandPreset {
  key: string; name: string; lo: number; hi: number; value: boolean; trigger: boolean; threshold?: number; cooldown?: number; release?: number;
  detect?: AudioBandDetect; character?: AudioBandCharacter; minMs?: number; title?: string;
}

/**
 * Quick bands. Kick, Snare and Hi-hat are triggers with Hit's ranges (nodes/definitions/audioTools.ts HIT_PRESETS, the
 * Kick ring example's Cooldown); the rest are levels with Band level's ranges.
 */
export const BAND_QUICK_PRESETS: readonly BandPreset[] = [
  { key: 'sub', name: 'Sub', lo: 20, hi: 60, value: true, trigger: false },
  { key: 'bass', name: 'Bass', lo: 60, hi: 250, value: true, trigger: false, release: 0.25 },
  { key: 'kick', name: 'Kick', lo: 30, hi: 150, value: false, trigger: true, cooldown: 150 },
  { key: 'snare', name: 'Snare', lo: 200, hi: 5000, value: false, trigger: true, threshold: 0.35, cooldown: 120 },
  { key: 'hihat', name: 'Hi-hat', lo: 6000, hi: 16000, value: false, trigger: true, threshold: 0.2, cooldown: 80 },
  { key: 'vocals', name: 'Vocals', lo: 300, hi: 3000, value: true, trigger: false },
  { key: 'air', name: 'Air', lo: 6000, hi: 16000, value: true, trigger: false },
];

/**
 * Bands that set their Detect too: triggers that listen for a kind of sound rather than a loudness. Kick: Drums only
 * (a bass line under it is separated out; a snare's low end still counts, it is a drum); Snare: Drums only, noisy hits
 * only; Hats: Hits, noisy only; Melody notes: Hits, tonal only (each new note).
 */
export const BAND_DETECT_PRESETS: readonly BandPreset[] = [
  { key: 'kickDrums', name: 'Kick', lo: 30, hi: 150, value: false, trigger: true, detect: 'drums', threshold: 0.5, cooldown: 150, minMs: 0,
    title: 'Kick: Drums only on 30–150 Hz, so a bass line under it is ignored' },
  { key: 'snareNoisy', name: 'Snare', lo: 150, hi: 5000, value: false, trigger: true, detect: 'drums', character: 'noisy', threshold: 0.5, cooldown: 120, minMs: 0,
    title: 'Snare: Drums only on 150 Hz–5 kHz, noisy hits only' },
  { key: 'hatsNoisy', name: 'Hats', lo: 6000, hi: 16000, value: false, trigger: true, detect: 'hits', character: 'noisy', threshold: 0.5, cooldown: 60, minMs: 0,
    title: 'Hats: Hits on 6–16 kHz, noisy hits only' },
  { key: 'melody', name: 'Melody notes', lo: 200, hi: 2000, value: false, trigger: true, detect: 'hits', character: 'tonal', threshold: 0.5, cooldown: 100, minMs: 0,
    title: 'Melody notes: Hits on 200 Hz–2 kHz, tonal hits only (each new note)' },
];

export const BAND_MIN_HZ = 20, BAND_MAX_HZ = 20000;

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const slugId = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);

/**
 * The node's bands, cleaned: a missing or odd field takes its default, ids are unique and GLSL-safe. A band saved
 * before fixed thresholds (a Sensitivity, no Threshold) gets its Threshold from it, and no Gate (its Value unchanged).
 */
export function bandsOf(params: Record<string, unknown>): AudioBandSpec[] {
  const raw = Array.isArray(params.bands) ? params.bands : [];
  const out: AudioBandSpec[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const b = r as Record<string, unknown>;
    let id = slugId(String(b.id ?? '')) || `b${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const shape: AudioBandShape = BAND_SHAPES.includes(b.shape as AudioBandShape) ? b.shape as AudioBandShape : 'band';
    // A cut reaches the end of the range on its open side.
    const lo = shape === 'highcut' ? BAND_MIN_HZ : num(b.lo, 60, BAND_MIN_HZ, BAND_MAX_HZ);
    const hi = shape === 'lowcut' ? BAND_MAX_HZ : num(b.hi, 250, BAND_MIN_HZ, BAND_MAX_HZ);
    out.push({
      id,
      name: String(b.name ?? '').trim() || `Band ${i + 1}`,
      color: typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : BAND_COLORS[i % BAND_COLORS.length],
      lo: Math.min(lo, hi), hi: Math.max(Math.max(lo, hi), Math.min(lo, hi) + 1),
      value: b.value !== false && !(b.value === undefined && b.trigger === true),
      trigger: b.trigger === true,
      attack: num(b.attack, BAND_DEFAULTS.attack, 0, 2),
      release: num(b.release, BAND_DEFAULTS.release, 0, 4),
      gain: num(b.gain, BAND_DEFAULTS.gain, 0, 8),
      threshold: num(b.threshold, typeof b.sensitivity === 'number' ? atThresholdFromSensitivity(b.sensitivity) : BAND_DEFAULTS.threshold, 0, 1),
      releaseAt: num(b.releaseAt, BAND_DEFAULTS.releaseAt, 0, 1),
      gate: num(b.gate, b.threshold === undefined ? 0 : BAND_DEFAULTS.gate, 0, 1),
      minMs: num(b.minMs, BAND_DEFAULTS.minMs, 0, 500),
      cooldown: num(b.cooldown, BAND_DEFAULTS.cooldown, 40, 2000),
      shape,
      slope: BAND_SLOPES.includes(b.slope as AudioBandSlope) ? b.slope as AudioBandSlope : BAND_DEFAULTS.slope,
      // Bands saved before Detect read their level, with every hit counting.
      detect: atDetectOf(b.detect),
      character: atCharacterOf(b.character),
      charAt: num(b.charAt, BAND_DEFAULTS.charAt, 0, 1),
    });
  });
  // A band that sends nothing still sends its Value (otherwise it has no socket to show).
  for (const b of out) if (!b.value && !b.trigger) b.value = true;
  return out;
}

/** A fresh id not used by `bands`. */
export function freshBandId(bands: readonly AudioBandSpec[]): string {
  for (let i = 1; ; i++) { const id = `b${i}`; if (!bands.some(b => b.id === id)) return id; }
}

/** A name not used by `bands`: "Kick", then "Kick 2"… */
function freshName(bands: readonly AudioBandSpec[], name: string): string {
  if (!bands.some(b => b.name === name)) return name;
  for (let i = 2; ; i++) { const n = `${name} ${i}`; if (!bands.some(b => b.name === n)) return n; }
}

/** A new band from a quick preset key (or a custom range), added after `bands`. */
export function newBand(bands: readonly AudioBandSpec[], preset: string | { lo: number; hi: number }): AudioBandSpec {
  const p = typeof preset === 'string' ? [...BAND_QUICK_PRESETS, ...BAND_DETECT_PRESETS].find(q => q.key === preset) : undefined;
  const lo = p ? p.lo : typeof preset === 'object' ? preset.lo : 60;
  const hi = p ? p.hi : typeof preset === 'object' ? preset.hi : 250;
  const used = new Set(bands.map(b => b.color));
  return {
    ...BAND_DEFAULTS,
    id: freshBandId(bands),
    name: freshName(bands, p?.name ?? 'Band'),
    color: BAND_COLORS.find(c => !used.has(c)) ?? BAND_COLORS[bands.length % BAND_COLORS.length],
    lo: Math.min(lo, hi), hi: Math.max(lo, hi),
    value: p ? p.value : true,
    trigger: p ? p.trigger : false,
    ...(p?.threshold !== undefined ? { threshold: p.threshold } : {}),
    ...(p?.cooldown !== undefined ? { cooldown: p.cooldown } : {}),
    ...(p?.release !== undefined ? { release: p.release } : {}),
    ...(p?.detect !== undefined ? { detect: p.detect } : {}),
    ...(p?.character !== undefined ? { character: p.character } : {}),
    ...(p?.minMs !== undefined ? { minMs: p.minMs } : {}),
  };
}

/** The output keys and labels a band adds: Value is named after the band ("Bass"), Trigger "Kick (trigger)". */
export const bandValueKey = (id: string) => `${id}_v`;
export const bandTriggerKey = (id: string) => `${id}_t`;
export function bandOutputs(bands: readonly AudioBandSpec[]): Array<{ key: string; label: string; channel: string }> {
  const out: Array<{ key: string; label: string; channel: string }> = [];
  for (const b of bands) {
    if (b.value) out.push({ key: bandValueKey(b.id), label: b.name, channel: bandValueKey(b.id) });
    if (b.trigger) out.push({ key: bandTriggerKey(b.id), label: `${b.name} (trigger)`, channel: bandTriggerKey(b.id) });
  }
  return out;
}

// ── Running a band, once per frame ────────────────────────────────────────────────────────────────────────

/**
 * One frame of a band on a dB spectrum: its Value (followed level) and Trigger (a rise above its Threshold), in
 * play/kit/audioTools.js (an exported page runs the same). `now` is seconds on the wall clock, `dt` seconds since the
 * last frame. stepBandRun mutates and returns `run`.
 */
export { atNewBandRun as newBandRun, atStepBandRun as stepBandRun } from '../../play/kit/audioTools.js';
export type { AtBandRun as BandRun } from '../../play/kit/audioTools.js';

// ── Trim ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The shortest trim, in seconds. */
export const MIN_TRIM = 0.05;

/**
 * The window playback loops in, in seconds: In and Out clamped to the file (Out 0 or unset: the end), at least
 * MIN_TRIM long.
 */
export function trimWindow(duration: number, trimIn: unknown, trimOut: unknown): { start: number; end: number } {
  if (!(duration > 0)) return { start: 0, end: 0 };
  const a = num(trimIn, 0, 0, duration);
  let b = num(trimOut, 0, 0, duration);
  if (b <= 0) b = duration;
  const start = Math.min(a, Math.max(0, duration - MIN_TRIM));
  const end = Math.max(Math.min(b, duration), Math.min(duration, start + MIN_TRIM));
  return { start, end };
}

/** True when the window is the whole file (nothing trimmed). */
export const isUntrimmed = (w: { start: number; end: number }, duration: number) => w.start <= 1e-6 && w.end >= duration - 1e-6;

export const secondsToSamples = (s: number, sampleRate: number): number => Math.round(Math.max(0, s) * sampleRate);
export const samplesToSeconds = (n: number, sampleRate: number): number => (sampleRate > 0 ? Math.max(0, n) / sampleRate : 0);

/**
 * Where playback is after `elapsed` seconds from `offset`, in a window it loops in (`loop`) or stops at the end of:
 * `start + (offset − start + elapsed) mod (end − start)`. An offset outside the window starts at the window's In.
 */
export function windowPosition(offset: number, elapsed: number, w: { start: number; end: number }, loop: boolean): number {
  const len = w.end - w.start;
  if (!(len > 0)) return w.start;
  const off = offset >= w.start && offset < w.end ? offset : w.start;
  const t = off - w.start + Math.max(0, elapsed);
  if (!loop) return Math.min(w.end, w.start + t);
  return w.start + (((t % len) + len) % len);
}

/** Clamp a play position into the window (a position outside it goes to the In). */
export const intoWindow = (pos: number, w: { start: number; end: number }): number => (pos >= w.start && pos < w.end ? pos : w.start);
