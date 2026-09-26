/**
 * takeAudio.ts — what audio layers drew during a take, kept small enough to
 * save with it, and handed back to them when the take plays back or renders.
 *
 * An audio layer draws the sound it hears: the live input, or a song loaded
 * into it. Neither is there when a take is rendered later, so while an audio
 * layer is showing, a take keeps its sound's analyser frames:
 *
 *   wave  the waveform, AUDIO_BINS points across the analyser's window,
 *         a byte each (square-root companded, so quiet sound keeps detail)
 *   freq  the spectrum as AUDIO_BINS log-spaced bands from 40 Hz to 12 kHz
 *         (the range the layer draws), a byte each over -110..-10 dB
 *
 * about 30 times a second, with one leading byte per frame for "the input was
 * on". A minute of one sound is about 150 KB of text. Played back, a frame
 * turns into the { wave, freq, sampleRate } the layer reads, so its bars,
 * rings, blobs and waveform move as they did.
 */
import type { KitAudio } from '../play/kit/kit.js';
import type { PlayLayer, PlayRecord, PlayTake, TakeAudioTrack } from '../types/play';

/** Waveform points and spectrum bands kept per frame. */
export const AUDIO_BINS = 64;
/** Frames closer together than this are skipped (about 30 a second). */
export const AUDIO_GAP = 1 / 31;
/** Spectrum bands span this range (Hz), as the audio layer's do. */
const LO_HZ = 40, SPAN = 300;
const DB_LO = -110, DB_RANGE = 100;
/** The spectrum rebuilt on playback: this many bins at this sample rate. */
const OUT_BINS = 1024, OUT_RATE = 48000;

type Raw = { wave: Float32Array; freq: Float32Array; sampleRate: number };

/** Which sound an audio layer draws: 'live' (the input) or the layer's own song (its id). */
export function audioSourceOf(l: PlayLayer): string {
  return (l as { input?: string }).input === 'file' ? l.id : 'live';
}

/** The sounds showing layers draw, and what each needs (the waveform, the spectrum, or both). */
export function audioNeeds(record: PlayRecord): Map<string, { wave: boolean; freq: boolean }> {
  const out = new Map<string, { wave: boolean; freq: boolean }>();
  for (const l of record.layers) {
    if (l.kind !== 'audio' || !l.visible) continue;
    const src = audioSourceOf(l);
    const n = out.get(src) ?? { wave: false, freq: false };
    if ((l as { style?: string }).style === 'wave') n.wave = true; else n.freq = true;
    out.set(src, n);
  }
  return out;
}

/** One frame as bytes: [on, wave…, freq…]. `raw` null is the input off. */
export function packAudioFrame(raw: Raw | null, wave: boolean, freq: boolean, bins = AUDIO_BINS): Uint8Array {
  const out = new Uint8Array(1 + bins * ((wave ? 1 : 0) + (freq ? 1 : 0)));
  if (!raw) { if (wave) out.fill(128, 1, 1 + bins); return out; }
  out[0] = 1;
  let o = 1;
  if (wave) {
    const w = raw.wave;
    for (let i = 0; i < bins; i++) {
      const v = Math.max(-1, Math.min(1, w[Math.floor((i * w.length) / bins)] || 0));
      out[o++] = Math.round(128 + Math.sign(v) * Math.sqrt(Math.abs(v)) * 127);
    }
  }
  if (freq) {
    const f = raw.freq, binHz = (raw.sampleRate || OUT_RATE) / 2 / Math.max(1, f.length);
    for (let i = 0; i < bins; i++) {
      // The same bands the layer averages: log-spaced, at least one bin each.
      const lo = LO_HZ * Math.pow(SPAN, i / bins), hi = LO_HZ * Math.pow(SPAN, (i + 1) / bins);
      const a = Math.max(1, Math.floor(lo / binHz)), z = Math.max(a, Math.min(f.length - 1, Math.ceil(hi / binHz)));
      let s = 0;
      for (let k = a; k <= z; k++) s += Math.max(DB_LO, Number.isFinite(f[k]) ? f[k] : DB_LO);
      const db = s / (z - a + 1);
      out[o++] = Math.round(Math.max(0, Math.min(1, (db - DB_LO) / DB_RANGE)) * 255);
    }
  }
  return out;
}

/** Which rebuilt spectrum bin belongs to which band (shared, built once). */
let bandOfBin: Int16Array | null = null;
function bandMap(bins: number): Int16Array {
  if (bandOfBin && bandOfBin.length === OUT_BINS && (bandOfBin as unknown as { bins?: number }).bins === bins) return bandOfBin;
  const m = new Int16Array(OUT_BINS), binHz = OUT_RATE / 2 / OUT_BINS;
  for (let k = 0; k < OUT_BINS; k++) {
    const hz = Math.max(LO_HZ, k * binHz);
    m[k] = Math.max(0, Math.min(bins - 1, Math.floor((Math.log(hz / LO_HZ) / Math.log(SPAN)) * bins)));
  }
  (m as unknown as { bins: number }).bins = bins;
  bandOfBin = m;
  return m;
}

/** A frame back as what the audio layer reads (into `into`'s arrays when given), or null when the input was off. */
export function unpackAudioFrame(bytes: Uint8Array, wave: boolean, freq: boolean, bins = AUDIO_BINS, into?: Raw): Raw | null {
  if (!bytes[0]) return null;
  const out: Raw = into ?? { wave: new Float32Array(bins * 2), freq: new Float32Array(OUT_BINS), sampleRate: OUT_RATE };
  let o = 1;
  if (wave) {
    // Twice as many points, the in-between ones halfway: the layer's waveform reads 128.
    const w = out.wave;
    const at = (i: number) => { const s = (bytes[o + Math.min(bins - 1, i)] - 128) / 127; return Math.sign(s) * s * s; };
    for (let i = 0; i < bins; i++) { w[i * 2] = at(i); w[i * 2 + 1] = (at(i) + at(i + 1)) / 2; }
    o += bins;
  } else out.wave.fill(0);
  if (freq) {
    const map = bandMap(bins);
    for (let k = 0; k < OUT_BINS; k++) out.freq[k] = DB_LO + (bytes[o + map[k]] / 255) * DB_RANGE;
  } else out.freq.fill(DB_LO);
  return out;
}

// ── base64, both ways (browsers and Node have btoa/atob) ─────────────────────

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Recording ────────────────────────────────────────────────────────────────

/** Frames of one sound as they are recorded. */
export class AudioFrameBuffer {
  readonly source: string;
  readonly wave: boolean;
  readonly freq: boolean;
  t: number[] = [];
  frames: Uint8Array[] = [];
  constructor(source: string, wave: boolean, freq: boolean) { this.source = source; this.wave = wave; this.freq = freq; }
  push(t: number, raw: Raw | null): void { this.t.push(t); this.frames.push(packAudioFrame(raw, this.wave, this.freq)); }
  /** Drop frames before `from`, keeping the one at or before it. */
  trim(from: number): void {
    let i = 0;
    while (i + 1 < this.t.length && this.t[i + 1] <= from) i++;
    if (i > 0) { this.t.splice(0, i); this.frames.splice(0, i); }
  }
  /** The frames from `from` for `length` seconds, every `stride`-th, as a take's track (null with none). */
  toTrack(from: number, length: number, stride = 1): TakeAudioTrack | null {
    let i = 0;
    while (i + 1 < this.t.length && this.t[i + 1] <= from) i++;
    const pick: number[] = [];
    for (let k = i, n = 0; k < this.t.length && this.t[k] <= from + length + 1e-6; k++, n++) if (n % stride === 0) pick.push(k);
    if (!pick.length) return null;
    const size = this.frames[0].length;
    const data = new Uint8Array(pick.length * size);
    const gaps: string[] = [];
    let lastMs = 0;
    pick.forEach((k, j) => {
      const ms = Math.max(lastMs, Math.round(Math.max(0, this.t[k] - from) * 1000));
      gaps.push(String(ms - lastMs));
      lastMs = ms;
      data.set(this.frames[k], j * size);
    });
    return { source: this.source, wave: this.wave, freq: this.freq, bins: AUDIO_BINS, times: gaps.join(','), data: bytesToBase64(data) };
  }
}

// ── Playing back ─────────────────────────────────────────────────────────────

interface DecodedAudio { t: Float64Array; bytes: Uint8Array; size: number; out: Raw }
const decodedAudio = new WeakMap<TakeAudioTrack, DecodedAudio>();

function decodeAudio(tr: TakeAudioTrack): DecodedAudio {
  let d = decodedAudio.get(tr);
  if (d) return d;
  const gaps = tr.times ? tr.times.split(',').map(Number) : [];
  const t = new Float64Array(gaps.length);
  let ms = 0;
  gaps.forEach((g, i) => { ms += g || 0; t[i] = ms / 1000; });
  const size = 1 + tr.bins * ((tr.wave ? 1 : 0) + (tr.freq ? 1 : 0));
  d = { t, bytes: base64ToBytes(tr.data), size, out: { wave: new Float32Array(tr.bins * 2), freq: new Float32Array(OUT_BINS), sampleRate: OUT_RATE } };
  decodedAudio.set(tr, d);
  return d;
}

/** Bytes per frame of a track. */
export function audioFrameSize(tr: Pick<TakeAudioTrack, 'bins' | 'wave' | 'freq'>): number {
  return 1 + tr.bins * ((tr.wave ? 1 : 0) + (tr.freq ? 1 : 0));
}

/**
 * What `source` sounded like at clock `time` in the take: the frame at or
 * before it. Undefined when the take has no frames of that sound (an older
 * take, or a layer shown by an action): the layer hears the live sound then.
 */
export function takeAudioAt(take: PlayTake, time: number, source: string): KitAudio | null | undefined {
  const tr = take.audioFrames?.find(a => a.source === source);
  if (!tr) return undefined;
  const d = decodeAudio(tr);
  const n = d.t.length;
  if (!n) return undefined;
  const s = time - take.from;
  let lo = 0, hi = n - 1;
  if (s >= d.t[hi]) lo = hi;
  else if (s > d.t[0]) { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d.t[m] <= s) lo = m; else hi = m; } }
  return unpackAudioFrame(d.bytes.subarray(lo * d.size, (lo + 1) * d.size), tr.wave, tr.freq, tr.bins, d.out);
}

/** An audio layer's sound from the take, for the layer kit (undefined: not recorded). */
export function takeAudioFor(take: PlayTake, time: number): (l: PlayLayer) => KitAudio | null | undefined {
  return l => takeAudioAt(take, time, audioSourceOf(l));
}
