/**
 * audioEngineProtocol.ts — what passes between the page and the desktop
 * app's Audio engine (src-tauri/src/audio_engine): the spectrum frames it
 * sends, the parameters it lists, and MIDI as bytes. Pure: no Tauri here
 * (lib/audioEngineHost.ts does the talking).
 *
 * Frames (`audio-engine://frame`, analysis.rs): one byte per FFT bin, dB =
 * byte / 2 − 130, and a waveform of bytes, sample = (byte − 128) / 127.
 */
import type { MidiEvent } from './midiEngine';

export const FRAME_EVENT = 'audio-engine://frame';
export const FRAME_DB_FLOOR = -130;

export interface NativeFrame {
  rack: string;
  sampleRate: number;
  bins: string;
  wave: string;
  rms: number;
  peak: number;
}

/** A frame as the readers and the Listener and the meters read it. */
export interface EngineSpectrum {
  /** dB per bin (like AnalyserNode.getFloatFrequencyData). */
  freq: Float32Array;
  /** −1..1. */
  wave: Float32Array;
  sampleRate: number;
  rms: number;
  peak: number;
  /** performance.now() when it came. */
  at: number;
}

function b64Bytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A native frame → spectrum and waveform (into `into` when its sizes fit, so a frame a tick allocates nothing). */
export function decodeFrame(f: NativeFrame, at: number, into?: EngineSpectrum): EngineSpectrum | null {
  if (!f || typeof f.bins !== 'string' || typeof f.wave !== 'string') return null;
  let bins: Uint8Array, wave: Uint8Array;
  try { bins = b64Bytes(f.bins); wave = b64Bytes(f.wave); } catch { return null; }
  const freq = into && into.freq.length === bins.length ? into.freq : new Float32Array(bins.length);
  for (let i = 0; i < bins.length; i++) freq[i] = bins[i] / 2 + FRAME_DB_FLOOR;
  const w = into && into.wave.length === wave.length ? into.wave : new Float32Array(wave.length);
  for (let i = 0; i < wave.length; i++) w[i] = (wave[i] - 128) / 127;
  const sampleRate = Number.isFinite(f.sampleRate) && f.sampleRate > 0 ? f.sampleRate : 48000;
  const out = into ?? ({} as EngineSpectrum);
  out.freq = freq; out.wave = w; out.sampleRate = sampleRate;
  out.rms = Number.isFinite(f.rms) ? f.rms : 0;
  out.peak = Number.isFinite(f.peak) ? f.peak : 0;
  out.at = at;
  return out;
}

/** A frame this old means the rack went quiet (the engine stops sending once it has decayed). */
export const FRAME_STALE_MS = 1500;

/** A parameter as the engine describes it (audio_engine/params.rs). */
export interface AuParam {
  address: string;
  identifier: string;
  name: string;
  min: number;
  max: number;
  value: number;
  unit: string;
  kind: 'number' | 'toggle' | 'list';
  step: number;
  log: boolean;
  values?: string[];
}

export function parseParamList(raw: unknown): AuParam[] {
  const out: AuParam[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.address !== 'string' || !/^\d{1,20}$/.test(o.address)) continue;
    const min = Number(o.min), max = Number(o.max), value = Number(o.value);
    if (![min, max, value].every(Number.isFinite)) continue;
    const kind = o.kind === 'toggle' || o.kind === 'list' ? o.kind : 'number';
    out.push({
      address: o.address,
      identifier: typeof o.identifier === 'string' ? o.identifier : '',
      name: typeof o.name === 'string' && o.name ? o.name : `Parameter ${o.address}`,
      min, max, value, kind,
      unit: typeof o.unit === 'string' ? o.unit : '',
      step: Number.isFinite(Number(o.step)) ? Number(o.step) : 0,
      log: o.log === true,
      ...(Array.isArray(o.values) ? { values: o.values.filter((v): v is string => typeof v === 'string') } : {}),
    });
  }
  return out;
}

/** "1.2 kHz", "−6 dB", "Saw": a parameter's value for showing. */
export function formatParam(p: Pick<AuParam, 'unit' | 'kind' | 'values' | 'min'>, v: number): string {
  if (p.kind === 'toggle') return v >= 0.5 ? 'On' : 'Off';
  if (p.kind === 'list' && p.values?.length) return p.values[Math.round(v - p.min)] ?? String(Math.round(v));
  if (p.unit === 'Hz' && Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10} kHz`;
  const a = Math.abs(v);
  const s = a >= 100 ? String(Math.round(v)) : a >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString();
  return p.unit ? `${s} ${p.unit}` : s;
}

/** Should a mapping glide to a value (numbers), or jump (lists, toggles)? */
export const paramGlides = (p: Pick<AuParam, 'kind'>) => p.kind === 'number';

/** A MIDI engine event as channel message bytes (devices: nothing). */
export function midiEventBytes(e: MidiEvent): number[] | null {
  if (e.kind === 'devices') return null;
  const ch = Math.max(1, Math.min(16, e.channel || 1)) - 1;
  const b7 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));
  switch (e.kind) {
    case 'noteOn': return [0x90 | ch, b7(e.note), Math.max(1, b7(e.velocity))];
    case 'noteOff': return [0x80 | ch, b7(e.note), 0];
    case 'cc': return [0xb0 | ch, b7(e.cc), b7(e.value)];
    case 'bend': {
      const v = Math.max(0, Math.min(16383, Math.round((Math.max(-1, Math.min(1, e.value)) + 1) * 8192)));
      return [0xe0 | ch, v & 0x7f, (v >> 7) & 0x7f];
    }
  }
  return null;
}

/** All notes off on every channel (a rack's input changed, or it was muted). */
export function allNotesOff(): number[] {
  const out: number[] = [];
  for (let ch = 0; ch < 16; ch++) out.push(0xb0 | ch, 123, 0);
  return out;
}

/** A sound's file extension for the engine's cache ("wav"), from its type or name. */
export function soundExt(type: string, name: string): string {
  const byType: Record<string, string> = {
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/aiff': 'aif', 'audio/x-aiff': 'aif', 'audio/ogg': 'ogg', 'audio/webm': 'weba',
  };
  const t = byType[type.split(';')[0]];
  if (t) return t;
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1].toLowerCase() : 'wav';
}
