/**
 * bandEq.ts — the sums behind the Audio Source window's equaliser view (BandEqEditor.tsx), pure so they can be
 * tested: where a frequency sits across the spectrum, a band's centre and width from its lo / hi and back, the
 * curve each shape draws, and what a drag or a scroll does to a band.
 *
 * A band's lo / hi (lib/audioTools/bands.ts) stay what the analysis measures. The view shows them as a centre
 * frequency and a width in octaves (Band, Q = √(2^N)/(2^N − 1)), or a corner frequency (Low cut: everything above lo;
 * High cut: everything below hi). lo and hi are the −3 dB points of the filters the band is heard through and drawn
 * as (lib/audioTools/bandFilter.ts).
 */
import { BAND_MAX_HZ, BAND_MIN_HZ, type AudioBandShape, type AudioBandSlope } from '../../lib/audioTools/bands';
import { DEFAULT_SAMPLE_RATE, bandGain, gainDb } from '../../lib/audioTools/bandFilter';

export const MIN_WIDTH_OCT = 0.1;
export const MAX_WIDTH_OCT = 8;
/** A new band's width (double-click on the spectrum), in octaves. */
export const NEW_BAND_WIDTH = 1;

const LOG_SPAN = Math.log(BAND_MAX_HZ / BAND_MIN_HZ);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 0–1 across the spectrum (log, 20 Hz – 20 kHz) for a frequency, and back. */
export const hzToX = (hz: number): number => Math.log(clamp(hz, BAND_MIN_HZ, BAND_MAX_HZ) / BAND_MIN_HZ) / LOG_SPAN;
export const xToHz = (x: number): number => BAND_MIN_HZ * Math.exp(clamp(x, 0, 1) * LOG_SPAN);

type BandLike = { lo: number; hi: number; shape: AudioBandShape; slope?: AudioBandSlope };

/** A band as the view shows it: its handle's frequency, and its width in octaves (a cut's is its range's). */
export function bandView(b: BandLike): { freq: number; width: number } {
  const width = Math.log2(Math.max(b.hi, b.lo + 1) / Math.max(1, b.lo));
  if (b.shape === 'lowcut') return { freq: b.lo, width };
  if (b.shape === 'highcut') return { freq: b.hi, width };
  return { freq: Math.sqrt(b.lo * b.hi), width };
}

/** lo / hi for a band with its handle at `freq` (and, a Band, `width` octaves wide), kept inside 20 Hz – 20 kHz. */
export function bandRange(shape: AudioBandShape, freq: number, width: number): { lo: number; hi: number } {
  if (shape === 'lowcut') return { lo: Math.round(clamp(freq, BAND_MIN_HZ, BAND_MAX_HZ - 1)), hi: BAND_MAX_HZ };
  if (shape === 'highcut') return { lo: BAND_MIN_HZ, hi: Math.round(clamp(freq, BAND_MIN_HZ + 1, BAND_MAX_HZ)) };
  const w = clamp(width, MIN_WIDTH_OCT, MAX_WIDTH_OCT);
  // The band slides inside the range rather than squashing at an end.
  const half = 2 ** (w / 2);
  const f = clamp(freq, BAND_MIN_HZ * half, BAND_MAX_HZ / half);
  const lo = Math.max(BAND_MIN_HZ, Math.round(f / half)), hi = Math.min(BAND_MAX_HZ, Math.round(f * half));
  return { lo, hi: Math.max(hi, lo + 1) };
}

/** Move a band's handle to `freq`, keeping its width. */
export const withFreq = (b: BandLike, freq: number) => bandRange(b.shape, freq, bandView(b).width);
/** Make a Band `width` octaves wide round its centre. */
export const withWidth = (b: BandLike, width: number) => bandRange(b.shape, bandView(b).freq, width);

/** Change a band's shape, keeping its handle where it is (a cut turned into a Band takes the new-band width). */
export function withShape(b: BandLike, shape: AudioBandShape): { shape: AudioBandShape; lo: number; hi: number } {
  const v = bandView(b);
  return { shape, ...bandRange(shape, v.freq, b.shape === 'band' ? v.width : NEW_BAND_WIDTH) };
}

/** A new Band centred on `freq`. */
export const newBandAt = (freq: number) => bandRange('band', freq, NEW_BAND_WIDTH);

// ── Drag and scroll ──────────────────────────────────────────────────────────────────────────────────────

/** Pixels of vertical drag that halve (up) or double (down) a Band's width. */
export const DRAG_PX_PER_OCTAVE_STEP = 80;
/** Scroll units (deltaY) that halve or double a Band's width. */
export const WHEEL_PER_STEP = 400;

/** A horizontal drag: the frequency under the pointer, from 0–1 across the spectrum. */
export const dragFreq = (x: number): number => xToHz(x);
/** A vertical drag of `dy` CSS px (down is positive) from a Band `width0` wide: up narrows it, down widens it. */
export const dragWidth = (width0: number, dy: number): number => clamp(width0 * 2 ** (dy / DRAG_PX_PER_OCTAVE_STEP), MIN_WIDTH_OCT, MAX_WIDTH_OCT);
/** The scroll wheel over a Band (deltaY, down is positive): scrolling up narrows it (a higher Q), as Pro-Q's does. */
export const wheelWidth = (width: number, deltaY: number): number => clamp(width * 2 ** (deltaY / WHEEL_PER_STEP), MIN_WIDTH_OCT, MAX_WIDTH_OCT);
/** The scroll wheel over a cut steps its slope: up steeper, down gentler. */
export function wheelSlope(slope: AudioBandSlope, deltaY: number): AudioBandSlope {
  const order: AudioBandSlope[] = [12, 24, 48];
  const i = order.indexOf(slope) + (deltaY < 0 ? 1 : deltaY > 0 ? -1 : 0);
  return order[clamp(i, 0, order.length - 1)];
}

// ── The curve: the filters the band is heard through (lib/audioTools/bandFilter.ts) ──────────────────────────

export { widthToQ, qToWidth, bandGains, gainDb, DEFAULT_SAMPLE_RATE } from '../../lib/audioTools/bandFilter';

/**
 * How much of `hz` the band lets through, 0–1, from the same biquads Solo / Hear hovered play: 1 (0 dB) at a Band's
 * centre and 0.707 (−3 dB) at its lo and hi; a cut 0.707 at its corner, 1 well inside, falling at its slope beyond.
 */
export const bandResponse = (b: BandLike, hz: number, sampleRate = DEFAULT_SAMPLE_RATE): number => bandGain(b, hz, sampleRate);

/** Response in dB (−∞ floored at −120). */
export const responseDb = gainDb;

// ── Labels ────────────────────────────────────────────────────────────────────────────────────────────────

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** The nearest note to a frequency: 440 → "A4", 261.6 → "C4". */
export function noteName(hz: number): string {
  if (!(hz > 0)) return '';
  const m = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** "440 Hz", "1.25 kHz", "12 kHz". */
export function fmtFreq(hz: number): string {
  if (hz >= 10000) return `${+(hz / 1000).toFixed(1)} kHz`;
  if (hz >= 1000) return `${+(hz / 1000).toFixed(2)} kHz`;
  return `${Math.round(hz)} Hz`;
}

/** The frequency grid's labels. */
export const FREQ_LABELS: ReadonlyArray<[number, string]> = [
  [20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k'],
];
/** Fainter lines between them (30, 40, 60…). */
export const FREQ_MINOR: readonly number[] = [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000];

export const SHAPE_LABELS: Record<AudioBandShape, string> = { band: 'Band', lowcut: 'Low cut', highcut: 'High cut' };
export const SHAPE_HINTS: Record<AudioBandShape, string> = {
  band: 'Band: only the frequencies round its centre',
  lowcut: 'Low cut: everything above its frequency',
  highcut: 'High cut: everything below its frequency',
};

/**
 * The Audio Source window's Delete (removes its selected band): Delete or Backspace, without ⌘ / Ctrl / Alt, and not
 * typed into a field (a band's name, a number).
 */
export function isBandDeleteKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: EventTarget | null }): boolean {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const el = e.target as HTMLElement | null | undefined;
  if (el && typeof el.tagName === 'string' && (/^(TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return false;
  if (el && el.tagName === 'INPUT' && !/^(color|checkbox|radio|range|button)$/.test((el as HTMLInputElement).type)) return false;
  return true;
}
