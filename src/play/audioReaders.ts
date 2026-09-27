/**
 * audioReaders.ts — the pure part of audio readers: dots placed on the live
 * spectrum, each reading one band as 0..1 (types/play.ts AudioReader).
 *
 *   spectrum (dB per FFT bin) → power mean over hz ± width/2 octaves → dB
 *   → 0..1 over a READER_RANGE_DB window whose top is set by the gain
 *   → attack / release smoothing
 *
 * The same numbers in the app (lib/audioReaderBank.ts) and on a website
 * (runtime/play-runtime.js carries a line-for-line copy). No DOM here.
 */
import type { AudioReader } from '../types/play';

/** The spectrum's frequency axis. */
export const SPEC_MIN_HZ = 20;
export const SPEC_MAX_HZ = 20000;
/** The spectrum's dB axis (what the analyser reports for music sits well inside it). */
export const PLOT_DB_MIN = -100;
export const PLOT_DB_MAX = -10;
/** A reader with gain 0 reads 1 at this level… */
export const READER_REF_DB = -10;
/** …and 0 this many dB below its top. */
export const READER_RANGE_DB = 40;
/** Gain limits (dB), the same as the parser's. */
export const READER_GAIN_MIN = -20;
export const READER_GAIN_MAX = 80;
export const READER_WIDTH_MIN = 0.05;
export const READER_WIDTH_MAX = 4;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const LOG_MIN = Math.log(SPEC_MIN_HZ), LOG_SPAN = Math.log(SPEC_MAX_HZ) - Math.log(SPEC_MIN_HZ);

/** Hz → 0..1 across the log axis (20 Hz = 0, 20 kHz = 1). */
export function hzToUnit(hz: number): number {
  return (Math.log(clamp(hz, SPEC_MIN_HZ, SPEC_MAX_HZ)) - LOG_MIN) / LOG_SPAN;
}

/** 0..1 across the log axis → Hz. */
export function unitToHz(u: number): number {
  return Math.exp(LOG_MIN + clamp(u, 0, 1) * LOG_SPAN);
}

/** The (fractional) FFT bin whose centre is `hz`: bin k sits at k × sampleRate / 2 / bins. */
export function hzToBin(hz: number, sampleRate: number, bins: number): number {
  return hz / (sampleRate / 2 / bins);
}

export function binToHz(bin: number, sampleRate: number, bins: number): number {
  return bin * (sampleRate / 2 / bins);
}

/** A reader's band edges: `width` octaves centred (geometrically) on `hz`. */
export function readerBand(hz: number, width: number): { lo: number; hi: number } {
  const half = Math.pow(2, clamp(width, READER_WIDTH_MIN, READER_WIDTH_MAX) / 2);
  return { lo: hz / half, hi: hz * half };
}

/**
 * Mean power over `lo..hi` Hz, in dB. Each bin covers ±half a bin around its
 * centre and counts by how much of it the band overlaps, so a band narrower
 * than a bin (60 Hz ± a sixth of an octave, with 23 Hz bins) still reads the
 * bins around it in proportion. The DC bin is left out.
 */
export function bandDb(freqDb: ArrayLike<number>, sampleRate: number, lo: number, hi: number): number {
  const n = freqDb.length;
  if (n < 2) return -160;
  const a = Math.max(0.5, hzToBin(Math.min(lo, hi), sampleRate, n));
  const b = Math.min(n - 0.5, hzToBin(Math.max(lo, hi), sampleRate, n));
  if (b <= a) return -160;
  let wSum = 0, pSum = 0;
  for (let k = Math.max(1, Math.floor(a + 0.5)); k <= Math.min(n - 1, Math.floor(b + 0.5)); k++) {
    const w = Math.min(b, k + 0.5) - Math.max(a, k - 0.5);
    if (w <= 0) continue;
    const db = freqDb[k];
    pSum += w * Math.pow(10, (Number.isFinite(db) ? Math.max(-160, db) : -160) / 10);
    wSum += w;
  }
  return wSum > 0 ? 10 * Math.log10(Math.max(1e-16, pSum / wSum)) : -160;
}

/** The dB at which a reader reads 1 (where its dot sits on the spectrum). */
export function readerTopDb(gain: number): number {
  return READER_REF_DB - gain;
}

/** The gain that puts a reader's top at `db`. */
export function gainForTopDb(db: number): number {
  return clamp(READER_REF_DB - db, READER_GAIN_MIN, READER_GAIN_MAX);
}

/** A band level in dB as 0..1: 0 at READER_RANGE_DB below the top, 1 at the top and above. */
export function readerLevel(db: number, gain: number): number {
  const top = readerTopDb(gain);
  return clamp((db - (top - READER_RANGE_DB)) / READER_RANGE_DB, 0, 1);
}

/** One reader's unsmoothed reading of a spectrum. */
export function readSpectrum(r: Pick<AudioReader, 'hz' | 'width' | 'gain'>, freqDb: ArrayLike<number>, sampleRate: number): number {
  const { lo, hi } = readerBand(r.hz, r.width);
  return readerLevel(bandDb(freqDb, sampleRate, lo, hi), r.gain);
}

/** One step of attack / release smoothing: rising takes `attackMs`, falling `releaseMs` (0 = at once). */
export function smoothLevel(prev: number, target: number, dt: number, attackMs: number, releaseMs: number): number {
  const tau = target > prev ? attackMs : releaseMs;
  if (tau <= 0 || dt <= 0) return tau <= 0 ? target : prev;
  return prev + (target - prev) * (1 - Math.exp(-(dt * 1000) / tau));
}

/** A reader trigger's gate: opens at `threshold`, lets go only below `threshold - hysteresis`. */
export function readerGate(open: boolean, v: number, threshold: number, hysteresis: number): boolean {
  return open ? v > threshold - hysteresis : v >= threshold;
}

/** Readers' smoothed levels, stepped once a frame from a spectrum. Keyed by reader id. */
export function stepReaders(readers: readonly AudioReader[], freqDb: ArrayLike<number>, sampleRate: number, dt: number, levels: Map<string, number>): Map<string, number> {
  for (const r of readers) levels.set(r.id, smoothLevel(levels.get(r.id) ?? 0, readSpectrum(r, freqDb, sampleRate), dt, r.attack, r.release));
  for (const id of [...levels.keys()]) if (!readers.some(r => r.id === id)) levels.delete(id);
  return levels;
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** "60 Hz", "120 Hz", "1.2 kHz", "8 kHz". */
export function formatHz(hz: number): string {
  if (hz < 1000) return `${Math.round(hz)} Hz`;
  const k = hz / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10} kHz`;
}

/** "⅓ oct", "1 oct", "0.25 oct". */
export function formatWidth(width: number): string {
  if (Math.abs(width - 1 / 3) < 0.005) return '⅓ oct';
  if (Math.abs(width - 1 / 6) < 0.005) return '⅙ oct';
  return `${Math.round(width * 100) / 100} oct`;
}

/** The labelled ticks along the frequency axis. */
export const SPEC_TICKS: { hz: number; label: string }[] = [
  { hz: 20, label: '20' }, { hz: 50, label: '50' }, { hz: 100, label: '100' }, { hz: 200, label: '200' }, { hz: 500, label: '500' },
  { hz: 1000, label: '1k' }, { hz: 2000, label: '2k' }, { hz: 5000, label: '5k' }, { hz: 10000, label: '10k' }, { hz: 20000, label: '20k' },
];

/** Reader colours, taken in turn. */
export const READER_COLOURS: [number, number, number][] = [
  [1, 0.45, 0.4], [0.35, 0.82, 0.98], [1, 0.78, 0.3], [0.62, 0.52, 1], [0.45, 0.9, 0.55], [1, 0.52, 0.82], [0.98, 0.92, 0.4], [0.4, 0.62, 1],
];

/** A new reader at `hz` whose dot sits at `topDb` (its gain), named by its frequency, in the next free colour. */
export function newReader(id: string, hz: number, topDb: number, existing: readonly AudioReader[] = []): AudioReader {
  const used = new Set(existing.map(r => r.colour.join(',')));
  const colour = READER_COLOURS.find(c => !used.has(c.join(','))) ?? READER_COLOURS[existing.length % READER_COLOURS.length];
  const f = clamp(hz, SPEC_MIN_HZ, SPEC_MAX_HZ);
  return { id, name: formatHz(f), hz: f, width: 1 / 3, gain: gainForTopDb(topDb), attack: 5, release: 150, colour: [...colour] };
}

/** "Reader · Kick". */
export function readerLabel(name: string | undefined): string {
  return `Reader · ${name ?? 'missing'}`;
}

// ── Name tags on the spectrum ───────────────────────────────────────────────

export interface LabelBox { x: number; y: number; w: number; h: number }

const overlaps = (a: LabelBox, b: LabelBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where each dot's name tag goes, `w` wide and `h` tall, inside W × H: above
 * the dot, else below it, else a row further up or down, never over another
 * tag or another dot. Earlier items win (put the selected reader first); a
 * tag that fits nowhere is null (the list below names it anyway).
 */
export function placeLabels(items: ReadonlyArray<{ x: number; y: number; w: number }>, W: number, H: number, h = 14, gap = 9, dot = 8): (LabelBox | null)[] {
  const placed: LabelBox[] = [];
  const dots = items.map(it => ({ x: it.x - dot, y: it.y - dot, w: dot * 2, h: dot * 2 }));
  return items.map((it, i) => {
    const x = Math.max(2, Math.min(W - 2 - it.w, it.x - it.w / 2));
    for (const ty of [it.y - gap - h, it.y + gap, it.y - gap - 2 * h - 3, it.y + gap + h + 3]) {
      const b = { x, y: Math.max(2, Math.min(H - 2 - h, ty)), w: it.w, h };
      if (placed.some(p => overlaps(p, b)) || dots.some((d, j) => j !== i && overlaps(d, b))) continue;
      placed.push(b);
      return b;
    }
    return null;
  });
}

// ── Learn ───────────────────────────────────────────────────────────────────

/**
 * Learn with sound: of the candidates (bands and readers), the one that rose
 * most above the lowest it read since Learn began, when that rise is at least
 * `min`. Ties go to the first (callers list readers first: they are the more
 * specific). Null while nothing has moved enough.
 */
export function pickLearned(candidates: ReadonlyArray<{ key: string; low: number; now: number }>, min = 0.3): string | null {
  let best: string | null = null, rise = min;
  for (const c of candidates) {
    const d = c.now - c.low;
    if (d > rise + 1e-9 || (best === null && d >= rise)) { best = c.key; rise = d; }
  }
  return best;
}
