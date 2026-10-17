/**
 * dsp.ts — the Audio nodes' sums (docs/audio-tools.md), pure so they can be tested on synthetic sound.
 *
 * Every function reads one analysis frame: a spectrum in dB per FFT bin (what AnalyserNode.getFloatFrequencyData
 * gives: `fftSize / 2` bins from 0 Hz to half the sample rate) and/or the last `fftSize` samples. The engine
 * (engine.ts) calls them once per rendered frame per node.
 */
/** dBFS → 0..1: −80 dB is silence, −10 dB is loud (the same scale as lib/liveAudio.ts). */
export function dbToUnit(db: number): number {
  return Math.max(0, Math.min(1, (db + 80) / 70));
}

/** Silence, in dB (an analyser reports −Infinity for a bin with nothing in it). */
export const DB_FLOOR = -100;

/** The Hz one FFT bin spans. */
export const binHz = (sampleRate: number, bins: number): number => sampleRate / 2 / bins;

/** Mean level of the bins between `lo` and `hi` Hz, 0..1 (−80 dB silence … −10 dB loud). */
export function bandLevel(freqDb: Float32Array, sampleRate: number, lo: number, hi: number): number {
  const hz = binHz(sampleRate, freqDb.length);
  const a = Math.max(1, Math.floor(Math.min(lo, hi) / hz)), b = Math.min(freqDb.length - 1, Math.ceil(Math.max(lo, hi) / hz));
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) sum += Math.max(DB_FLOOR, freqDb[i]);
  return dbToUnit(sum / (b - a + 1));
}

/** RMS of a block of samples, 0..1 on the same dB scale as bandLevel. */
export function rmsLevel(wave: Float32Array): number {
  let s = 0;
  for (let i = 0; i < wave.length; i++) s += wave[i] * wave[i];
  const rms = Math.sqrt(s / Math.max(1, wave.length));
  return dbToUnit(20 * Math.log10(Math.max(1e-6, rms)));
}

/**
 * One step of an attack / release follower: rises towards `target` with time constant `attack` seconds, falls with
 * `release` (0 = jump straight there).
 */
export function follow(prev: number, target: number, dt: number, attack: number, release: number): number {
  const tc = target > prev ? attack : release;
  if (tc <= 0 || dt <= 0) return dt <= 0 ? prev : target;
  return prev + (target - prev) * (1 - Math.exp(-dt / tc));
}

/** Band level's state: the followed level and a peak that holds, then falls. */
export interface BandState { level: number; peak: number; heldFor: number }
export const newBandState = (): BandState => ({ level: 0, peak: 0, heldFor: 0 });

/** Seconds a peak holds before it falls, and how fast it falls (per second). */
export const PEAK_HOLD = 0.6;
export const PEAK_FALL = 0.8;

export function stepBand(s: BandState, raw: number, dt: number, attack: number, release: number, gain: number): BandState {
  const level = Math.min(1, follow(s.level, Math.min(1, raw * gain), dt, attack, release));
  let peak = s.peak, heldFor = s.heldFor + dt;
  if (level >= peak) { peak = level; heldFor = 0; }
  else if (heldFor > PEAK_HOLD) peak = Math.max(level, peak - PEAK_FALL * dt);
  return { level, peak, heldFor };
}

// ── Hit: onsets by spectral flux with an adaptive threshold ──────────────────────────────────────────────────

export interface HitSettings {
  lo: number;
  hi: number;
  /** 0..1: higher catches quieter hits. */
  sensitivity: number;
  /** Shortest gap between two hits, ms. */
  cooldownMs: number;
  /** Seconds the Envelope takes from 1 back to 0. */
  decay: number;
}

export interface HitState {
  prev: Float32Array | null;
  /** Recent flux values (a ring), for the adaptive threshold. */
  history: Float32Array;
  at: number;
  filled: number;
  lastHit: number;
  trigger: number;
  envelope: number;
  count: number;
  strength: number;
  /** The last frame's flux and threshold (for the card's readout). */
  flux: number;
  threshold: number;
}

/** About 0.7 s of frames at 60 fps. */
export const HIT_HISTORY = 40;

export const newHitState = (): HitState => ({
  prev: null, history: new Float32Array(HIT_HISTORY), at: 0, filled: 0, lastHit: -Infinity,
  trigger: 0, envelope: 0, count: 0, strength: 0, flux: 0, threshold: 0,
});

/** The threshold's multiple of the recent mean flux, and its floor, for a Sensitivity. */
export function hitThreshold(meanFlux: number, sensitivity: number): number {
  const s = Math.max(0, Math.min(1, sensitivity));
  return Math.max(0.002 + 0.012 * (1 - s), meanFlux * (4 - 2.5 * s));
}

/**
 * A bin's magnitude for the flux: log-compressed amplitude, log(1 + 100·|X|) scaled so a full-scale bin is 1 (the
 * usual onset-detection compression). Plain dB makes a quiet click after silence count as much as a loud hit; plain
 * amplitude makes a broadband hi-hat vanish next to a kick. This sits between.
 */
const FLUX_GAMMA = 100;
const FLUX_NORM = 1 / Math.log1p(FLUX_GAMMA);
const fluxUnit = (db: number): number => (db > DB_FLOOR ? Math.log1p(FLUX_GAMMA * Math.min(1, Math.pow(10, db / 20))) * FLUX_NORM : 0);

/**
 * Spectral flux in the band: how much the bins between `lo` and `hi` Hz rose since the last frame (amplitude, only
 * rises count), averaged over the band.
 */
export function bandFlux(prev: Float32Array, cur: Float32Array, sampleRate: number, lo: number, hi: number): number {
  const hz = binHz(sampleRate, cur.length);
  const a = Math.max(1, Math.floor(Math.min(lo, hi) / hz)), b = Math.min(cur.length - 1, Math.ceil(Math.max(lo, hi) / hz));
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) {
    const d = fluxUnit(cur[i]) - fluxUnit(prev[i]);
    if (d > 0) sum += d;
  }
  return sum / (b - a + 1);
}

/**
 * One frame of Hit. `now` is seconds on the wall clock (sound is real time), `dt` seconds since the last frame.
 * Trigger is 1 on the frame of a hit and 0 on every other; the state is mutated and returned.
 */
export function stepHit(s: HitState, freqDb: Float32Array, sampleRate: number, now: number, dt: number, o: HitSettings): HitState {
  s.trigger = 0;
  s.envelope = o.decay > 0 ? Math.max(0, s.envelope - dt / o.decay) : 0;
  if (!s.prev || s.prev.length !== freqDb.length) {
    s.prev = new Float32Array(freqDb);
    return s;
  }
  const flux = bandFlux(s.prev, freqDb, sampleRate, o.lo, o.hi);
  s.prev.set(freqDb);
  let mean = 0;
  for (let i = 0; i < s.filled; i++) mean += s.history[i];
  mean = s.filled ? mean / s.filled : 0;
  const thr = hitThreshold(mean, o.sensitivity);
  s.flux = flux; s.threshold = thr;
  s.history[s.at] = flux;
  s.at = (s.at + 1) % s.history.length;
  s.filled = Math.min(s.history.length, s.filled + 1);
  if (flux > thr && (now - s.lastHit) * 1000 >= Math.max(40, o.cooldownMs)) {
    s.lastHit = now;
    s.trigger = 1;
    s.envelope = 1;
    s.count += 1;
    s.strength = bandLevel(freqDb, sampleRate, o.lo, o.hi);
  }
  return s;
}

// ── Spectrum layouts ─────────────────────────────────────────────────────────────────────────────────────────

export type SpectrumLayout = 'log' | 'linear';
export const SPECTRUM_MIN_HZ = 20;

/** The frequency at position `x` (0..1) across a spectrum. */
export function hzAt(x: number, layout: SpectrumLayout, minHz: number, maxHz: number): number {
  return layout === 'log' ? minHz * Math.pow(maxHz / minHz, x) : minHz + (maxHz - minHz) * x;
}

/** Where a frequency sits across a spectrum, 0..1 (the inverse of hzAt). */
export function xOfHz(hz: number, layout: SpectrumLayout, minHz: number, maxHz: number): number {
  return layout === 'log' ? Math.log(hz / minHz) / Math.log(maxHz / minHz) : (hz - minHz) / (maxHz - minHz);
}

/** The highest frequency a spectrum shows (20 kHz, or less at a low sample rate). */
export const spectrumMaxHz = (sampleRate: number): number => Math.min(20000, sampleRate / 2);

/**
 * Resample a dB spectrum into `out.length` bins across `layout` (Log: equal steps per octave, as music is heard),
 * each as 0..1 between `minDb` and `maxDb`. A bin wider than one FFT bin takes the loudest it covers; a narrower one
 * reads between its two nearest. `smoothing` (0..1) blends with what `out` held before.
 */
export function spectrumBins(freqDb: Float32Array, sampleRate: number, out: Float32Array, layout: SpectrumLayout, minDb: number, maxDb: number, smoothing = 0): void {
  const n = out.length, nb = freqDb.length, hz = binHz(sampleRate, nb);
  const lo = layout === 'log' ? SPECTRUM_MIN_HZ : 0, hi = spectrumMaxHz(sampleRate);
  const span = Math.max(1e-3, maxDb - minDb);
  const db = (i: number) => Math.max(DB_FLOOR, freqDb[Math.max(0, Math.min(nb - 1, i))]);
  const sm = Math.max(0, Math.min(0.99, smoothing));
  for (let i = 0; i < n; i++) {
    const f0 = hzAt(i / n, layout, lo, hi) / hz, f1 = hzAt((i + 1) / n, layout, lo, hi) / hz;
    let v: number;
    if (f1 - f0 >= 1) {
      v = -Infinity;
      for (let b = Math.floor(f0); b <= Math.min(nb - 1, Math.ceil(f1) - 1); b++) v = Math.max(v, db(b));
    } else {
      const c = (f0 + f1) / 2, b = Math.floor(c), t = c - b;
      v = db(b) * (1 - t) + db(b + 1) * t;
    }
    const u = Math.max(0, Math.min(1, (v - minDb) / span));
    out[i] = sm > 0 ? out[i] * sm + u * (1 - sm) : u;
  }
}

/**
 * Spectrogram: push one row of 0..1 values (`row.length` = width) on top of an RGBA8 image `w` × `h` whose row 0 is
 * the bottom of the texture. The newest row is the top (row h−1); everything else moves down one, the oldest drops off.
 */
export function scrollRows(data: Uint8Array, w: number, h: number, row: ArrayLike<number>): void {
  const stride = w * 4;
  data.copyWithin(0, stride, stride * h);
  writeRow(data, (h - 1) * stride, row, w);
}

/** Write 0..1 values as grey texels (alpha 1) starting at byte `offset`. */
export function writeRow(data: Uint8Array, offset: number, row: ArrayLike<number>, w: number): void {
  for (let i = 0; i < w; i++) {
    const v = Math.round(Math.max(0, Math.min(1, row[i] ?? 0)) * 255), o = offset + i * 4;
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
  }
}

/** The last `out.length` samples of a block, as 0..1 (0.5 = silence), times `gain`. */
export function waveRow(wave: Float32Array, out: Float32Array, gain = 1): void {
  const n = out.length, start = Math.max(0, wave.length - n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(1, 0.5 + 0.5 * (wave[start + i] ?? 0) * gain));
}

// ── An FFT like AnalyserNode's, for tests and offline use ─────────────────────────────────────────────────────

/**
 * The dB spectrum of `block` (length a power of two) as AnalyserNode computes it: a Blackman window, an FFT,
 * magnitude ÷ length, 20·log10. Returns `block.length / 2` bins.
 */
export function spectrumDb(block: Float32Array): Float32Array {
  const n = block.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  const a0 = 0.42, a1 = 0.5, a2 = 0.08;
  for (let i = 0; i < n; i++) {
    const w = a0 - a1 * Math.cos((2 * Math.PI * i) / n) + a2 * Math.cos((4 * Math.PI * i) / n);
    re[i] = block[i] * w;
  }
  // Bit-reversed order, then butterflies.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = 20 * Math.log10(Math.max(1e-12, Math.hypot(re[i], im[i]) / n));
  return out;
}
