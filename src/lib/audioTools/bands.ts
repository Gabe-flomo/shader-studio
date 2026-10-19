/**
 * bands.ts — Audio Source's own bands and trim (docs/audio-tools.md), pure so they can be tested.
 *
 * A band is a frequency range picked on the Audio Source's window: it sends out a Value (how loud it is, 0–1: its
 * energy from −60 to 0 dBFS, followed with Attack / Release, times Gain), Hits (1 for one frame each time the hit
 * detector finds one: play/kit/audioTools.js "The hit detector"), or both. Each becomes an output socket on the node
 * (`<band id>_v`, `<band id>_t`), named after the band. What to catch (a preset: Kick, Snare, Hats, Notes or a Custom
 * band) and Sensitivity are all a band needs; Min interval, the silence Gate, Track room noise, Only and the Value's
 * smoothing are Fine-tune.
 *
 * The trim is In / Out in seconds on the loaded file: playback loops between them.
 */
import {
  AT_CHAR_AT, AT_DET_PRESETS, AT_DET_PRESET_KEYS, AT_DET_SENSITIVITY, atCharacterOf, atDetPresetOf, atValueFromOf,
  type AtCharacter, type AtPreset, type AtValueFrom,
} from '../../play/kit/audioTools.js';

export type AudioBandPreset = AtPreset;
export type AudioBandCharacter = AtCharacter;
export type AudioBandValueFrom = AtValueFrom;

/** What to catch, in the window's order: each a preset of the detector (play/kit/audioTools.js AT_DET_PRESETS). */
export const BAND_CATCHES: ReadonlyArray<{ key: AudioBandPreset; label: string; title: string }> = [
  { key: 'kick', label: 'Kick', title: 'Kick drums (40–130 Hz): each kick, even over a held bass line.' },
  { key: 'snare', label: 'Snare', title: 'Snares and claps: their body (150–300 Hz) and their crack (2–5 kHz) together.' },
  { key: 'hats', label: 'Hats', title: 'Hi-hats and shakers (6–16 kHz): quiet, fast hits.' },
  { key: 'notes', label: 'Notes', title: 'Each new note of a melody or chord (200 Hz–4 kHz); a held note or its vibrato doesn\'t fire again.' },
  { key: 'custom', label: 'Custom band', title: 'Any new sound in the band you drew above.' },
];
export const BAND_CHARACTERS: ReadonlyArray<{ key: AudioBandCharacter; label: string; title: string }> = [
  { key: 'auto', label: 'As the preset', title: 'What to catch decides: Snare and Hats keep noisy hits, Notes tonal ones, Kick and Custom every hit.' },
  { key: 'any', label: 'Any', title: 'Every hit counts.' },
  { key: 'noisy', label: 'Noisy only', title: 'Only hits that are noisy (drums, hats, snares): what arrives just after the hit is at least "Noisy at" on the noisiness scale.' },
  { key: 'tonal', label: 'Tonal only', title: 'Only hits that are tonal (melodic notes): what arrives just after the hit is under "Noisy at".' },
];
export const BAND_VALUE_FROM: ReadonlyArray<{ key: AudioBandValueFrom; label: string; title: string }> = [
  { key: 'level', label: 'Loudness', title: 'How loud the band is: −60 dBFS reads 0, 0 dBFS reads 1.' },
  { key: 'brightness', label: 'Brightness', title: 'Where the band\'s sound sits: 0 at its bottom, 1 at its top.' },
  { key: 'flatness', label: 'Noisiness', title: '0 a pure tone … about 0.9 noise (hats, breath).' },
];

export interface AudioBandSpec {
  id: string;
  name: string;
  /** CSS colour (#rrggbb) for the band on the window and its readouts. */
  color: string;
  lo: number;
  hi: number;
  /** Sends a Value output: how loud the band is, 0–1. */
  value: boolean;
  /** Sends a Hits output: 1 for one frame per hit in the band. */
  trigger: boolean;
  /** The Value's smoothing: seconds to rise and to fall. */
  attack: number;
  release: number;
  gain: number;
  /** What to catch: the detector's preset. */
  preset: AudioBandPreset;
  /** How eager it is, 0 (only the clearest hits) … 1 (quieter ones too). */
  sensitivity: number;
  /** Fine-tune (null: the preset's): the shortest gap between hits (ms), the silence Gate (dBFS), Track room noise (null: on for the Mic and Live tracks). */
  minInterval: number | null;
  gateDb: number | null;
  trackNoise: boolean | null;
  /** Only: let a hit through when what arrives just after it is noisy (drums) or tonal (notes), any, or as the preset (auto). */
  character: AudioBandCharacter;
  /** Only's line on the noisiness scale (0 tonal … 1 noise). */
  charAt: number;
  /** What the Value sends: loudness (the default), brightness or noisiness. */
  valueFrom: AudioBandValueFrom;
  /**
   * How the band isolates (the window's equaliser, components/audio/bandEq.ts): Band (a band-pass from lo to hi),
   * Low cut (everything above lo: hi is the top) or High cut (everything below hi: lo is the bottom). The analysis
   * measures lo–hi either way. Bands saved before shapes are Band.
   */
  shape: AudioBandShape;
  /** How steeply its edges fall, dB per octave: the drawn curve and what Solo / Hear hovered play. */
  slope: AudioBandSlope;
}

export type AudioBandShape = 'band' | 'lowcut' | 'highcut';
export type AudioBandSlope = 12 | 24 | 48;
export const BAND_SHAPES: readonly AudioBandShape[] = ['band', 'lowcut', 'highcut'];
export const BAND_SLOPES: readonly AudioBandSlope[] = [12, 24, 48];

export const BAND_COLORS = ['#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#89dceb', '#89b4fa', '#cba6f7', '#f5c2e7'];

const BAND_DEFAULTS = {
  value: true, trigger: true, attack: 0.005, release: 0.12, gain: 1,
  preset: 'custom' as AudioBandPreset, sensitivity: AT_DET_SENSITIVITY, minInterval: null, gateDb: null, trackNoise: null,
  shape: 'band' as AudioBandShape, slope: 24 as AudioBandSlope,
  character: 'auto' as AudioBandCharacter, charAt: AT_CHAR_AT, valueFrom: 'level' as AudioBandValueFrom,
};

export interface BandPreset {
  key: string; name: string; lo: number; hi: number; value: boolean; trigger: boolean; preset: AudioBandPreset; release?: number; title?: string;
}

/**
 * Quick bands: the four presets as hits (with a Value too), and levels with Band level's ranges (Sub, Bass, Vocals,
 * Air) as values.
 */
export const BAND_QUICK_PRESETS: readonly BandPreset[] = [
  { key: 'kick', name: 'Kick', lo: AT_DET_PRESETS.kick.lo, hi: AT_DET_PRESETS.kick.hi, value: true, trigger: true, preset: 'kick', title: 'Kick hits (40–130 Hz)' },
  { key: 'snare', name: 'Snare', lo: AT_DET_PRESETS.snare.lo, hi: AT_DET_PRESETS.snare.hi, value: true, trigger: true, preset: 'snare', title: 'Snare and clap hits (body and crack)' },
  { key: 'hats', name: 'Hats', lo: AT_DET_PRESETS.hats.lo, hi: AT_DET_PRESETS.hats.hi, value: true, trigger: true, preset: 'hats', title: 'Hi-hat hits (6–16 kHz)' },
  { key: 'notes', name: 'Notes', lo: AT_DET_PRESETS.notes.lo, hi: AT_DET_PRESETS.notes.hi, value: true, trigger: true, preset: 'notes', title: 'Each new note (200 Hz–4 kHz)' },
  { key: 'sub', name: 'Sub', lo: 20, hi: 60, value: true, trigger: false, preset: 'custom' },
  { key: 'bass', name: 'Bass', lo: 60, hi: 250, value: true, trigger: false, preset: 'custom', release: 0.25 },
  { key: 'vocals', name: 'Vocals', lo: 300, hi: 3000, value: true, trigger: false, preset: 'custom' },
  { key: 'air', name: 'Air', lo: 6000, hi: 16000, value: true, trigger: false, preset: 'custom' },
];
/** Older keys for the quick bands (the Detect presets' and Hi-hat's), still accepted by newBand. */
const QUICK_ALIASES: Record<string, string> = { hihat: 'hats', kickDrums: 'kick', snareNoisy: 'snare', hatsNoisy: 'hats', melody: 'notes' };

export const BAND_MIN_HZ = 20, BAND_MAX_HZ = 20000;

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const numOrNull = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
const slugId = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);

/**
 * The preset nearest a band saved before presets (a Detect mode, fixed lines or an old Sensitivity): Notes for tonal
 * hits, Hats high up, Snare across the body and crack, Kick low down, else Custom.
 */
export function presetForOldBand(b: Record<string, unknown>): AudioBandPreset {
  const lo = num(b.lo, 60), hi = num(b.hi, 250), mid = Math.sqrt(Math.max(1, lo) * Math.max(1, hi));
  if (b.character === 'tonal') return 'notes';
  if (b.trigger !== true) return 'custom';
  if (lo >= 4000) return 'hats';
  if (hi <= 260) return 'kick';
  if (lo >= 100 && lo <= 450 && hi >= 2000) return 'snare';
  return mid >= 4000 ? 'hats' : 'custom';
}

/**
 * The Sensitivity a band saved before presets meant: an old Sensitivity as it was; a v2 Threshold read back off the
 * line v2 made it with (Threshold = 0.7 − 0.4 × Sensitivity); otherwise the middle.
 */
export function sensitivityForOldBand(b: Record<string, unknown>): number {
  if (typeof b.sensitivity === 'number' && Number.isFinite(b.sensitivity)) return Math.max(0, Math.min(1, b.sensitivity));
  if (typeof b.threshold === 'number' && Number.isFinite(b.threshold)) return Math.round(Math.max(0, Math.min(1, (0.7 - b.threshold) / 0.4)) * 100) / 100;
  return AT_DET_SENSITIVITY;
}

/**
 * A band saved before presets, in today's terms (graphs migrate through this: nodes/definitions/audioTools.ts
 * migrateAudioSourceV3): What to catch from its range and Detect, Sensitivity from its old Sensitivity or Threshold;
 * a Detect of Brightness or Noisy ↔ tonal becomes what its Value sends. The fixed lines (Threshold, Release, Gate on
 * the old level scale, Min time, Cooldown) and Detect go: the preset sets the timing and the Gate.
 */
export function upgradeOldBand(b: Record<string, unknown>): Record<string, unknown> {
  if (typeof b.preset === 'string') return b;
  const { threshold: _t, releaseAt: _r, gate: _g, minMs: _m, cooldown: _c, detect, sensitivity: _s, ...rest } = b;
  void _t; void _r; void _g; void _m; void _c; void _s;
  const valueFrom = detect === 'brightness' ? 'brightness' : detect === 'flatness' ? 'flatness' : 'level';
  const preset = presetForOldBand(b);
  // Only: 'every hit' becomes the preset's own; a kick band's noisy / tonal goes too (a kick is neither: it would never fire).
  const character = b.character === 'noisy' || b.character === 'tonal' ? (preset === 'kick' ? 'auto' : b.character) : 'auto';
  return { ...rest, preset, sensitivity: sensitivityForOldBand(b), valueFrom, character };
}

/** The node's bands, cleaned: a missing or odd field takes its default, ids are unique and GLSL-safe; old bands are upgraded (upgradeOldBand). */
export function bandsOf(params: Record<string, unknown>): AudioBandSpec[] {
  const raw = Array.isArray(params.bands) ? params.bands : [];
  const out: AudioBandSpec[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const b = upgradeOldBand(r as Record<string, unknown>);
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
      preset: atDetPresetOf(b.preset),
      sensitivity: num(b.sensitivity, BAND_DEFAULTS.sensitivity, 0, 1),
      minInterval: numOrNull(b.minInterval, 10, 2000),
      gateDb: numOrNull(b.gateDb, -120, 0),
      trackNoise: typeof b.trackNoise === 'boolean' ? b.trackNoise : null,
      character: atCharacterOf(b.character),
      charAt: num(b.charAt, BAND_DEFAULTS.charAt, 0, 1),
      valueFrom: atValueFromOf(b.valueFrom),
      shape,
      slope: BAND_SLOPES.includes(b.slope as AudioBandSlope) ? b.slope as AudioBandSlope : BAND_DEFAULTS.slope,
    });
  });
  // A band that sends nothing still sends its Value (otherwise it has no socket to show).
  for (const b of out) if (!b.value && !b.trigger) b.value = true;
  return out;
}

/** A preset's own settings (ms, dBFS) for the window's Fine-tune: what a band's null fields mean. */
export function presetDefaults(p: AudioBandPreset): { minInterval: number; gateDb: number; lo: number; hi: number } {
  const d = AT_DET_PRESETS[atDetPresetOf(p)];
  return { minInterval: d.minInterval, gateDb: d.gateDb, lo: d.lo, hi: d.hi };
}
export const BAND_PRESET_KEYS: readonly AudioBandPreset[] = AT_DET_PRESET_KEYS;

/** A fresh id not used by `bands`. */
export function freshBandId(bands: readonly AudioBandSpec[]): string {
  for (let i = 1; ; i++) { const id = `b${i}`; if (!bands.some(b => b.id === id)) return id; }
}

/** A name not used by `bands`: "Kick", then "Kick 2"… */
function freshName(bands: readonly AudioBandSpec[], name: string): string {
  if (!bands.some(b => b.name === name)) return name;
  for (let i = 2; ; i++) { const n = `${name} ${i}`; if (!bands.some(b => b.name === n)) return n; }
}

/** A new band from a quick preset key (or a custom range, which catches Custom hits), added after `bands`. */
export function newBand(bands: readonly AudioBandSpec[], preset: string | { lo: number; hi: number }): AudioBandSpec {
  const key = typeof preset === 'string' ? QUICK_ALIASES[preset] ?? preset : '';
  const p = key ? BAND_QUICK_PRESETS.find(q => q.key === key) : undefined;
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
    trigger: p ? p.trigger : true,
    preset: p ? p.preset : 'custom',
    ...(p?.release !== undefined ? { release: p.release } : {}),
  };
}

/** The output keys and labels a band adds: Value is named after the band ("Bass"), its hits "Kick (trigger)". */
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
 * One frame of a band on the last samples heard: its Value and its hits (the detector), in play/kit/audioTools.js (an
 * exported page runs the same). `now` is seconds on the wall clock, `dt` seconds since the last frame. stepBandRun
 * mutates and returns `run`.
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
