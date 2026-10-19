/**
 * audioTools.js — the Audio nodes' sums, once per frame (docs/audio-tools.md). The same code runs in the app
 * (lib/audioTools/engine.ts, through dsp.ts, bands.ts and learn.ts, which re-export it) and on an exported page
 * (runtime/play-runtime.js, through the inlined kit as SSKit.audioTools), so a page's bands, triggers, learned sounds
 * and pictures of the sound move exactly as the app's do.
 *
 * Pure: no DOM, no Web Audio, no clock of its own. Every function reads one analysis frame: the last samples heard
 * (the hit detector's window) and / or a spectrum in dB per FFT bin (AnalyserNode.getFloatFrequencyData: the card's
 * picture, the textures, learned sounds); `now` is seconds on the wall clock, `dt` seconds since the last frame.
 *
 *   atDetFrame / atDetPick  the hit detector (log-filtered spectral flux, online peak picking, a dBFS Gate), one frame
 *   atDetAnalyse / atDetPickAll  the same over a whole File ahead; atEventsHeard then fires its hits as they are heard
 *   atStepSource    an Audio Source's frame: its card spectrum, its bands (Value, Trigger), its learned sounds
 *   atStepListener  a listening node's frame: Band level, Hit, or a Spectrum / Spectrogram / Waveform texture
 *   atApplyGain     a source's Gain on its frame (dB on the spectrum, × on the wave)
 *
 * Top-level names start with `at` / `AT_` (the kit's files share one scope in exports).
 */

// ── Levels ───────────────────────────────────────────────────────────────────────────────────────────────────

/** dBFS → 0..1: −80 dB is silence, −10 dB is loud (the same scale as lib/liveAudio.ts). */
export function atDbToUnit(db) {
  return Math.max(0, Math.min(1, (db + 80) / 70));
}

/** Silence, in dB (an analyser reports −Infinity for a bin with nothing in it). */
export const AT_DB_FLOOR = -100;

/** The Hz one FFT bin spans. */
export function atBinHz(sampleRate, bins) { return sampleRate / 2 / bins; }

/** Mean level of the bins between `lo` and `hi` Hz, 0..1 (−80 dB silence … −10 dB loud). */
export function atBandLevel(freqDb, sampleRate, lo, hi) {
  const hz = atBinHz(sampleRate, freqDb.length);
  const a = Math.max(1, Math.floor(Math.min(lo, hi) / hz)), b = Math.min(freqDb.length - 1, Math.ceil(Math.max(lo, hi) / hz));
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) sum += Math.max(AT_DB_FLOOR, freqDb[i]);
  return atDbToUnit(sum / (b - a + 1));
}

/** RMS of a block of samples, 0..1 on the same dB scale as atBandLevel. */
export function atRmsLevel(wave) {
  let s = 0;
  for (let i = 0; i < wave.length; i++) s += wave[i] * wave[i];
  const rms = Math.sqrt(s / Math.max(1, wave.length));
  return atDbToUnit(20 * Math.log10(Math.max(1e-6, rms)));
}

/** One step of an attack / release follower (time constants in seconds; 0 = jump straight there). */
export function atFollow(prev, target, dt, attack, release) {
  const tc = target > prev ? attack : release;
  if (tc <= 0 || dt <= 0) return dt <= 0 ? prev : target;
  return prev + (target - prev) * (1 - Math.exp(-dt / tc));
}

export function atNewBandState() { return { level: 0, peak: 0, heldFor: 0 }; }

/** Seconds a peak holds before it falls, and how fast it falls (per second). */
export const AT_PEAK_HOLD = 0.6;
export const AT_PEAK_FALL = 0.8;

export function atStepBand(s, raw, dt, attack, release, gain) {
  const level = Math.min(1, atFollow(s.level, Math.min(1, raw * gain), dt, attack, release));
  let peak = s.peak, heldFor = s.heldFor + dt;
  if (level >= peak) { peak = level; heldFor = 0; }
  else if (heldFor > AT_PEAK_HOLD) peak = Math.max(level, peak - AT_PEAK_FALL * dt);
  return { level, peak, heldFor };
}

// ── Onsets by spectral flux with an adaptive threshold (what Learn a sound listens with) ─────────────────────

/** About 0.7 s of frames at 60 fps. */
export const AT_HIT_HISTORY = 40;

/** The onset threshold's multiple of the recent mean flux, and its floor, for a sensitivity (Learn a sound's AT_LEARN_ONSET). */
export function atHitThreshold(meanFlux, sensitivity) {
  const s = Math.max(0, Math.min(1, sensitivity));
  return Math.max(0.002 + 0.012 * (1 - s), meanFlux * (4 - 2.5 * s));
}

/**
 * A bin's magnitude for the flux: log(1 + 100·|X|) scaled so a full-scale bin is 1 (the usual onset-detection
 * compression). Plain dB makes a quiet click after silence count as much as a loud hit; plain amplitude makes a
 * broadband hi-hat vanish next to a kick. This sits between.
 */
const AT_FLUX_GAMMA = 100;
const AT_FLUX_NORM = 1 / Math.log1p(AT_FLUX_GAMMA);
function atFluxUnit(db) { return db > AT_DB_FLOOR ? Math.log1p(AT_FLUX_GAMMA * Math.min(1, Math.pow(10, db / 20))) * AT_FLUX_NORM : 0; }

/** Spectral flux in the band: how much the bins between `lo` and `hi` Hz rose since the last frame, averaged. */
export function atBandFlux(prev, cur, sampleRate, lo, hi) {
  const hz = atBinHz(sampleRate, cur.length);
  const a = Math.max(1, Math.floor(Math.min(lo, hi) / hz)), b = Math.min(cur.length - 1, Math.ceil(Math.max(lo, hi) / hz));
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) {
    const d = atFluxUnit(cur[i]) - atFluxUnit(prev[i]);
    if (d > 0) sum += d;
  }
  return sum / (b - a + 1);
}

// ── The hit detector (docs/audio-tools.md "How hits are found") ──────────────────────────────────────────────
//
// One pipeline for every band, live and ahead (Böck, Krebs & Schedl 2012; madmom / librosa / aubio):
//   1. A frame: the window of samples ending now (AT_DET_FFT, Hann), as magnitudes scaled so a full-scale sine reads
//      1. Live it runs every AT_DET_HOP_SECONDS (5 ms) in an AudioWorklet (once per animation frame where there is
//      none); a File analysed ahead runs the very same frames over the whole file.
//   2. Band energy in dBFS: Σ|X|² over the band's bins (÷ the Hann window's 1.5-bin noise bandwidth, so a full-scale
//      sine is 0 dBFS). The Value maps it −60 → 0, 0 → 1; the Gate compares it with a dBFS line.
//   3. The onset function: the band's bins through a log-spaced triangular filterbank, log10(1 + λ·X), and how much
//      each filter rose over the frame about half a window back (half-wave rectified, averaged over the filters).
//      Notes and Custom bands take the old frame's maximum over 3 neighbouring filters first (SuperFlux), so vibrato
//      doesn't fire. Divided by its own running maximum (decaying over AT_DET_MAX_TAU s, never under
//      its floor: atDetFloor), so one Sensitivity works across songs and silence stays near 0.
//   4. Peak picking, online: this frame is a hit if it is the largest of the last pre_max ms, beats the mean of the
//      last pre_avg ms by δ (δ = the preset's × 4^(0.5 − Sensitivity)), comes at least Min interval after the last
//      hit, and the Gate is open (band energy over its dBFS line; it closes 6 dB under it, after 80 ms; Track room
//      noise lifts the line to 10 dB over the band's tracked noise floor: Doblinger's minimum tracking).
// Only (noisy / tonal) then judges the AT_CHAR_WINDOW after each hit.

/** The analysis window (samples; at 48 kHz, 21 ms) and the hop: 5 ms (200 frames a second). */
export const AT_DET_FFT = 1024;
export const AT_DET_HOP_SECONDS = 0.005;
export function atDetHop(sampleRate) { return Math.max(1, Math.round(sampleRate * AT_DET_HOP_SECONDS)); }
/** A band whose bottom is under this (Hz) is analysed with a 2048 window (a low note at 1024 ripples with its phase). */
export const AT_DET_LOW_HZ = 150;
/** log10(1 + λ·X): λ so a −60 dBFS bin gives λ·X = 1 (the +1 is the floor that keeps silence at 0). */
export const AT_DET_LAMBDA = 1000;
/** The flux compares the frame this fraction of a window back. */
export const AT_DET_DIFF = 0.5;
/** The onset function's running maximum: how fast it falls (s) and the least it is taken to be. */
export const AT_DET_MAX_TAU = 2;
/** The running maximum's floor: this share of the onset a jump from silence to a −60 dBFS bin makes (atDetFloor). */
export const AT_DET_MAX_FLOOR = 0.67;
/** The least the onset function's running maximum is taken to be, for a λ: quieter than about −60 dBFS never scales up. */
export function atDetFloor(lambda) { return AT_DET_MAX_FLOOR * Math.log10(1 + lambda * 1e-3); }
/** The least rise (dB, in every filter at the band's level) the onset function is measured against. */
export const AT_DET_STEP_DB = 12;
/** The Gate's hysteresis (dB under its line before it closes) and hold (s). */
export const AT_DET_GATE_HYST = 6;
export const AT_DET_GATE_HOLD = 0.08;
/** The Value's dBFS range: this reads 0, 0 dBFS reads 1. */
export const AT_DET_VALUE_FLOOR = -60;
/**
 * A hit is decided at the end of its frame; a File's hits are stamped this much earlier (s), where the onset itself
 * is heard (measured on the test songs: the mean of decision − onset).
 */
export const AT_DET_LAG = 0.008;
/** Track room noise: the line sits this far (dB) over the tracked floor; Doblinger's constants for 8 ms frames. */
export const AT_DET_NOISE_MARGIN = 10;
export const AT_DOB = { alpha: 0.7, gamma: 0.998, beta: 0.96, frame: 0.008 };

/**
 * What to catch: each preset's band (Hz; Snare listens to its body and its crack, `split` leaves the middle out), its
 * window (samples: Kick's 2048 resolves 40–130 Hz without a bass note's ripple), log compression λ (low for the drums,
 * so a loud hit over a tail beats a quiet sound out of silence; high for Hats, whose hits are quiet), filterbank (bands
 * per octave, max filter), the peak picker's windows (ms) and δ (at Sensitivity 0.5), Min interval (ms), the Gate
 * (dBFS), its own Only (Snare and Hats noisy, Notes tonal: a kick's click or a note's attack in their band isn't one)
 * and the Value's attack / release (s). Custom takes the band the user drew. Tuned on the accuracy harness
 * (lib/audioTools/__tests__/accuracy.test.ts).
 */
export const AT_DET_PRESETS = {
  kick: { lo: 40, hi: 130, fft: 2048, lambda: 30, floor: 0.1, bpo: 6, maxFilter: false, preMax: 30, preAvg: 80, delta: 0.25, minInterval: 60, gateDb: -55, character: 'any', attack: 0.005, release: 0.12 },
  snare: { lo: 150, hi: 5000, split: [300, 2000], fft: 1024, lambda: 10, floor: 0.08, stepDb: 20, bpo: 6, maxFilter: false, preMax: 30, preAvg: 100, delta: 0.25, minInterval: 60, gateDb: -55, character: 'noisy', attack: 0.005, release: 0.12 },
  hats: { lo: 6000, hi: 16000, fft: 1024, lambda: 1000, floor: 0.5, bpo: 6, maxFilter: false, preMax: 20, preAvg: 60, delta: 0.2, minInterval: 40, gateDb: -60, character: 'noisy', attack: 0.005, release: 0.08 },
  notes: { lo: 200, hi: 4000, fft: 1024, lambda: 30, floor: 0.03, bpo: 24, maxFilter: true, preMax: 30, preAvg: 150, delta: 0.3, minInterval: 80, gateDb: -55, character: 'tonal', attack: 0.005, release: 0.12 },
  custom: { lo: 60, hi: 250, fft: 1024, lambda: 30, floor: 0.4, stepDb: 20, bpo: 12, maxFilter: true, preMax: 30, preAvg: 100, delta: 0.25, minInterval: 50, gateDb: -55, character: 'any', attack: 0.005, release: 0.12 },
};
export const AT_DET_PRESET_KEYS = ['kick', 'snare', 'hats', 'notes', 'custom'];
export function atDetPresetOf(k) { return AT_DET_PRESET_KEYS.indexOf(k) >= 0 ? k : 'custom'; }
export const AT_DET_SENSITIVITY = 0.5;

/** δ for a preset's δ and a Sensitivity: 0 → 2 × the preset's (only the clearest hits), 1 → ½ × (quieter ones too). */
export function atDetDelta(presetDelta, sensitivity) {
  const s = typeof sensitivity === 'number' && Number.isFinite(sensitivity) ? Math.max(0, Math.min(1, sensitivity)) : AT_DET_SENSITIVITY;
  return presetDelta * Math.pow(4, 0.5 - s);
}

/** The Hz ranges a band listens to: its own, or Snare's two (body and crack) when its band spans the gap. */
export function atDetRanges(preset, lo, hi) {
  const p = AT_DET_PRESETS[atDetPresetOf(preset)], a = Math.min(lo, hi), b = Math.max(lo, hi);
  if (p.split && a < p.split[0] && b > p.split[1]) return [[a, p.split[0]], [p.split[1], b]];
  return [[a, b]];
}

/**
 * A band's (or Hit's) detector settings, resolved: its preset's, with what the band overrides (Min interval, Gate,
 * Track room noise, Value attack / release) and δ from its Sensitivity. `liveInput`: the Mic or a Live track (Track
 * room noise defaults on there). `spec` (the part that changes the analysis) and `specKey` key a File's analysis.
 */
export function atDetConfig(b, liveInput) {
  const key = atDetPresetOf(b.preset), p = AT_DET_PRESETS[key];
  const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const lo = n(b.lo, p.lo), hi = n(b.hi, p.hi), ranges = atDetRanges(key, lo, hi);
  // A band reaching below AT_DET_LOW_HZ needs the longer window: at 1024 a low note's few bins ripple with its phase.
  const fft = Math.min(lo, hi) < AT_DET_LOW_HZ ? Math.max(p.fft, 2048) : p.fft;
  return {
    preset: key, lo, hi,
    spec: { fft, ranges, bpo: p.bpo, maxFilter: p.maxFilter, lambda: p.lambda || AT_DET_LAMBDA, floor: p.floor || atDetFloor(p.lambda || AT_DET_LAMBDA), stepDb: p.stepDb || AT_DET_STEP_DB },
    specKey: `${fft}|${ranges.map(r => r.map(Math.round).join('-')).join(',')}|${p.bpo}|${p.maxFilter ? 1 : 0}|${p.lambda || AT_DET_LAMBDA}|${p.floor || ''}|${p.stepDb || AT_DET_STEP_DB}`,
    preMax: p.preMax / 1000, preAvg: p.preAvg / 1000, delta: atDetDelta(p.delta, b.sensitivity),
    minInterval: Math.max(0.01, n(b.minInterval, p.minInterval) / 1000), gateDb: n(b.gateDb, p.gateDb),
    trackNoise: b.trackNoise === true || (b.trackNoise !== false && !!liveInput),
    attack: n(b.attack, p.attack), release: n(b.release, p.release),
    // Only: the band's own choice, or (auto) its preset's.
    character: b.character === 'any' || b.character === 'noisy' || b.character === 'tonal' ? b.character : p.character, charAt: n(b.charAt, AT_CHAR_AT),
  };
}

// The FFT (Hann, any power of two), its tables kept per size.
const atDetTables = new Map();
function atDetTablesOf(n) {
  let T = atDetTables.get(n);
  if (T) return T;
  const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), win = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    rev[i] = j;
  }
  for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos((-2 * Math.PI * k) / n); sin[k] = Math.sin((-2 * Math.PI * k) / n); }
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  T = { n, rev, cos, sin, win, re: new Float64Array(n), im: new Float64Array(n) };
  atDetTables.set(n, T);
  return T;
}

/**
 * The magnitudes (n / 2 bins) of the `n` samples of `samples` ending just before index `end` (zeros outside),
 * Hann-windowed and scaled by 4 / n: a full-scale sine centred on a bin reads 1 there.
 */
export function atDetMag(samples, end, n, out) {
  const T = atDetTablesOf(n), re = T.re, im = T.im, start = end - n;
  for (let i = 0; i < n; i++) {
    const k = start + i, r = T.rev[i];
    re[r] = (k >= 0 && k < samples.length ? samples[k] : 0) * T.win[i];
    im[r] = 0;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = T.cos[k * step], wi = T.sin[k * step], a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  const s = 4 / n;
  for (let i = 0; i < n / 2; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * s;
  return out;
}

/** The bins (indices) a set of Hz ranges covers: those whose centre is inside, at least the nearest one per range. */
export function atDetBins(sampleRate, n, ranges) {
  const hz = sampleRate / n, nb = n / 2, out = [];
  for (const r of ranges) {
    let lo = Math.max(1, Math.ceil(r[0] / hz)), hi = Math.min(nb - 1, Math.floor(r[1] / hz));
    if (hi < lo) lo = hi = Math.max(1, Math.min(nb - 1, Math.round((r[0] + r[1]) / 2 / hz)));
    for (let k = lo; k <= hi; k++) if (out.indexOf(k) < 0) out.push(k);
  }
  return out.sort((x, y) => x - y);
}

const atDetBanks = new Map();
/**
 * A log-spaced triangular filterbank over a set of ranges (`bpo` filters per octave; unnormalised, so a wider
 * filter sums more): [{ bins, w }]. Where the bins are too coarse for the octaves (a kick band is 2–3 bins at 1024),
 * each bin is a filter of its own.
 */
export function atDetFilterbank(sampleRate, n, ranges, bpo) {
  const key = `${sampleRate}|${n}|${ranges.map(r => r.join('-')).join(',')}|${bpo}`;
  let fb = atDetBanks.get(key);
  if (fb) return fb;
  const hz = sampleRate / n;
  fb = [];
  for (const r of ranges) {
    const bins = atDetBins(sampleRate, n, [r]);
    const lo = bins[0], hi = bins[bins.length - 1], cs = [];
    for (let f = r[0]; f <= r[1] * 1.0001; f *= Math.pow(2, 1 / Math.max(1, bpo))) {
      const c = Math.max(lo, Math.min(hi, Math.round(f / hz)));
      if (cs.indexOf(c) < 0) cs.push(c);
    }
    if (cs.indexOf(lo) < 0) cs.push(lo);
    if (cs.indexOf(hi) < 0) cs.push(hi);
    cs.sort((x, y) => x - y);
    if (cs.length < 3) { for (const k of bins) fb.push({ bins: [k], w: [1] }); continue; }
    for (let j = 1; j < cs.length - 1; j++) {
      const l = cs[j - 1], c = cs[j], rr = cs[j + 1], fbins = [], w = [];
      for (let k = l; k <= rr; k++) {
        const v = k === c ? 1 : k < c ? (k - l) / Math.max(1, c - l) : (rr - k) / Math.max(1, rr - c);
        if (v > 0) { fbins.push(k); w.push(v); }
      }
      fb.push({ bins: fbins, w });
    }
  }
  atDetBanks.set(key, fb);
  return fb;
}

export function atNewDetector() { return { key: '', rows: [], max: 0, t: 0 }; }

/**
 * One frame of a band's detector (stages 1–3) on magnitudes `mag` (atDetMag at `spec.fft`), `dt` seconds after the
 * last: { odf (the normalised onset function, 0..1 mostly), raw, edb (band energy, dBFS), aflat / arise (what
 * arrived: the flatness of the power rises and their mean, for Only), flat (the band's flatness, 0 tonal … 1 noise),
 * bright (its centroid, 0 bottom … 1 top) }. Mutates `d`.
 */
export function atDetFrame(d, mag, spec, sampleRate, dt) {
  const n = spec.fft, lam = spec.lambda || AT_DET_LAMBDA, floor = spec.floor || atDetFloor(lam);
  const key = `${n}|${sampleRate}|${spec.ranges.map(r => r.join('-')).join(',')}|${spec.bpo}|${spec.maxFilter ? 1 : 0}|${lam}|${floor}|${spec.stepDb || AT_DET_STEP_DB}`;
  if (d.key !== key) { d.key = key; d.rows = []; d.max = 0; d.t = 0; }
  d.t += Math.max(0, dt);
  const bins = atDetBins(sampleRate, n, spec.ranges), fb = atDetFilterbank(sampleRate, n, spec.ranges, spec.bpo);
  // Energy, and the band's power per bin (Only, flatness, brightness).
  let e = 0, lg = 0, top = 0, sf = 0;
  const pow = new Float64Array(bins.length);
  for (let i = 0; i < bins.length; i++) {
    const m = mag[bins[i]], p = m * m;
    pow[i] = p; e += p; sf += p * bins[i];
    lg += Math.log10(Math.max(1e-20, p));
    if (p > top) top = p;
  }
  const edb = 10 * Math.log10(e / 1.5 + 1e-20), nb = bins.length;
  const flat = top > 1e-14 && nb > 1 ? Math.max(0, Math.min(1, 1 + (10 * (lg / nb - Math.log10(e / nb))) / AT_FLAT_DB)) : 0;
  const bright = e > 1e-14 && nb > 1 ? Math.max(0, Math.min(1, Math.log(sf / e / bins[0]) / Math.log(bins[nb - 1] / bins[0]))) : 0;
  // The filterbank, log-compressed.
  const row = new Float32Array(fb.length);
  for (let f = 0; f < fb.length; f++) {
    let s = 0;
    for (let j = 0; j < fb[f].bins.length; j++) s += fb[f].w[j] * mag[fb[f].bins[j]];
    row[f] = Math.log10(1 + lam * s);
  }
  // The frame about half a window back (at least one frame).
  const back = (AT_DET_DIFF * n) / sampleRate;
  let ref = null;
  for (let i = d.rows.length - 1; i >= 0; i--) { ref = d.rows[i]; if (d.t - d.rows[i].t >= back - 1e-9) break; }
  let raw = 0, aflat = 0, arise = 0, step = 0;
  if (ref && ref.row.length === row.length) {
    const rr = ref.row, k = Math.pow(10, (spec.stepDb || AT_DET_STEP_DB) / 20);
    for (let f = 0; f < row.length; f++) {
      const r = spec.maxFilter ? Math.max(rr[f], f > 0 ? rr[f - 1] : 0, f + 1 < rr.length ? rr[f + 1] : 0) : rr[f];
      const v = row[f] - r;
      if (v > 0) raw += v;
      // What a rise of AT_DET_STEP_DB in this filter would read, at its level then (log10(1 + k·λX) − log10(1 + λX)).
      step += Math.log10(1 + k * (Math.pow(10, rr[f]) - 1)) - rr[f];
    }
    raw /= Math.max(1, row.length);
    step /= Math.max(1, row.length);
    // What arrived: the power rises' flatness (a new note rises in a few bins: tonal; a hat in all of them: noisy).
    let sum = 0;
    for (let i = 0; i < nb; i++) { const r = pow[i] - ref.pow[i]; if (r > 0) sum += r; }
    if (sum > 0 && nb > 1) {
      const mean = sum / nb, floor = mean * 1e-4;
      let l2 = 0;
      for (let i = 0; i < nb; i++) l2 += Math.log10(Math.max(floor, pow[i] - ref.pow[i]));
      aflat = Math.max(0, Math.min(1, 1 + (10 * (l2 / nb - Math.log10(mean))) / AT_FLAT_DB));
      arise = mean;
    }
  }
  d.rows.push({ t: d.t, row, pow });
  while (d.rows.length > 2 && d.t - d.rows[1].t >= back + 0.05) d.rows.shift();
  d.max = Math.max(raw, d.max * Math.exp(-Math.max(0, dt) / AT_DET_MAX_TAU));
  // Over a steady sound (nothing bigger lately) the running maximum is its own wobble: a rise is measured against at
  // least what an AT_DET_STEP_DB step would read at the band's level, so a held note's ripple never looks like a hit.
  return { odf: raw / Math.max(d.max, floor, step), raw, edb, aflat, arise, flat, bright };
}

export function atNewPicker() { return { hist: [], last: -Infinity, open: false, below: 0, line: 0, P: -1, Pp: 0, N: -1, noiseDb: -200, gateLine: 0 }; }

/** The Value for a band energy (dBFS): −60 → 0, 0 → 1. */
export function atDetLevel(edb) { return Math.max(0, Math.min(1, (edb - AT_DET_VALUE_FLOOR) / -AT_DET_VALUE_FLOOR)); }

/**
 * Stage 4: is the frame at `t` (seconds) a hit? `odf` and `edb` from atDetFrame, `dt` since the last frame, `c` from
 * atDetConfig. Keeps the Gate (p.open), the line the onset function had to beat (p.line: the recent mean + δ), the
 * tracked noise floor (p.noiseDb) and the Gate's line now (p.gateLine). Returns 1 on a hit. Mutates `p`.
 */
export function atDetPick(p, odf, edb, t, dt, c) {
  // The noise floor (Doblinger's minimum tracking on the band's power), and the Gate's line.
  if (c.trackNoise) {
    const k = Math.max(0, dt) / AT_DOB.frame, E = Math.pow(10, edb / 10);
    const a = Math.pow(AT_DOB.alpha, k), g = Math.pow(AT_DOB.gamma, k);
    if (p.P < 0) { p.P = E; p.Pp = E; p.N = E; }
    p.Pp = p.P;
    p.P = a * p.P + (1 - a) * E;
    p.N = p.P < p.N ? p.P : g * p.N + (1 - g) * (p.P - AT_DOB.beta * p.Pp);
    p.N = Math.max(1e-20, Math.min(p.N, p.P));
    p.noiseDb = 10 * Math.log10(p.N);
  } else { p.P = -1; p.noiseDb = -200; }
  const line = c.trackNoise ? Math.max(c.gateDb, p.noiseDb + AT_DET_NOISE_MARGIN) : c.gateDb;
  p.gateLine = line;
  if (edb >= line) { p.open = true; p.below = 0; }
  else if (edb < line - AT_DET_GATE_HYST) { p.below += Math.max(0, dt); if (p.below >= AT_DET_GATE_HOLD - 1e-9) p.open = false; }
  else p.below = 0;
  // Peak picking on the last pre_max / pre_avg seconds (this frame not counted).
  const span = Math.max(c.preMax, c.preAvg);
  let mx = 0, sum = 0, cnt = 0;
  for (let i = p.hist.length - 1; i >= 0; i--) {
    const h = p.hist[i], age = t - h.t;
    if (age > span + 1e-9) break;
    if (age <= c.preMax + 1e-9 && h.o > mx) mx = h.o;
    if (age <= c.preAvg + 1e-9) { sum += h.o; cnt++; }
  }
  p.line = (cnt ? sum / cnt : 0) + c.delta;
  const hit = p.open && odf >= mx && odf >= p.line && t - p.last > c.minInterval - 1e-9;
  if (hit) p.last = t;
  p.hist.push({ t, o: odf });
  while (p.hist.length && t - p.hist[0].t > span + 0.05) p.hist.shift();
  return hit ? 1 : 0;
}

/**
 * A whole sound's detector frames ahead (a File source): one per AT_DET_HOP_SECONDS, frame i the window ending at
 * i × hop (as live), for each spectral spec (atDetConfig(…).spec) its odf, edb, aflat, arise, flat and bright curves.
 * `onProgress(0..1)` now and then.
 */
export function atDetAnalyse(mono, sampleRate, specs, onProgress) {
  const hop = atDetHop(sampleRate), hopSec = hop / sampleRate, frames = Math.max(1, Math.ceil(mono.length / hop) + 1);
  const mags = new Map();
  const out = specs.map(spec => ({
    spec, d: atNewDetector(),
    c: { odf: new Float32Array(frames), edb: new Float32Array(frames), aflat: new Float32Array(frames), arise: new Float32Array(frames), flat: new Float32Array(frames), bright: new Float32Array(frames) },
  }));
  for (let i = 0; i < frames; i++) {
    mags.clear();
    for (const o of out) {
      const n = o.spec.fft;
      let mag = mags.get(n);
      if (!mag) { mag = atDetMag(mono, i * hop, n, new Float32Array(n / 2)); mags.set(n, mag); }
      const r = atDetFrame(o.d, mag, o.spec, sampleRate, hopSec);
      o.c.odf[i] = r.odf; o.c.edb[i] = r.edb; o.c.aflat[i] = r.aflat; o.c.arise[i] = r.arise; o.c.flat[i] = r.flat; o.c.bright[i] = r.bright;
    }
    if (onProgress && (i & 1023) === 0) onProgress(i / frames);
  }
  return out.map(o => o.c);
}

/**
 * A band's hits in curves analysed ahead (atDetAnalyse), picked by the same stage 4 as live: their times (each
 * decision less AT_DET_LAG, where its onset is heard) and strengths (the Value then), and per frame the line the
 * onset function had to beat and the Gate's line (for the scope).
 */
export function atDetPickAll(c, hopSeconds, cfg) {
  const p = atNewPicker(), n = c.odf.length, times = [], strengths = [], line = new Float32Array(n), gate = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * hopSeconds;
    if (atDetPick(p, c.odf[i], c.edb[i], t, hopSeconds, cfg)) { times.push(Math.max(0, t - AT_DET_LAG)); strengths.push(atDetLevel(c.edb[i])); }
    line[i] = p.line; gate[i] = p.gateLine;
  }
  return { times: Float64Array.from(times), strengths: Float32Array.from(strengths), line, gate };
}

// ── Only: noisy / tonal, judged on what arrived after each hit ────────────────────────────────────────────────

/** Only: auto (the preset's own), any, noisy or tonal. */
export const AT_CHARACTERS = ['auto', 'any', 'noisy', 'tonal'];
export const AT_CHAR_AT = 0.3;
/** Flatness: the flatness in dB (10·log10 G/A) that reads 0. */
export const AT_FLAT_DB = 30;
/** Seconds after a hit over which Only (noisy / tonal) judges what arrived. */
export const AT_CHAR_WINDOW = 0.005;
export function atCharacterOf(c) { return AT_CHARACTERS.indexOf(c) >= 0 ? c : 'auto'; }

/** Whether a hit whose arrival's flatness was `flat` passes Only (`character`: any / noisy / tonal) at `charAt`. */
export function atCharPass(character, flat, charAt) {
  const c = atCharacterOf(character);
  if (c !== 'noisy' && c !== 'tonal') return true;
  const cut = typeof charAt === 'number' && Number.isFinite(charAt) ? charAt : AT_CHAR_AT;
  return c === 'noisy' ? flat >= cut : flat < cut;
}

/**
 * Hits picked ahead kept only where Only passes, judged as a live hit is: the arrivals' flatness (`aflat`) weighted by
 * their energy (`arise`), from each hit's decision over AT_CHAR_WINDOW (curves one value per `hopSeconds`).
 */
export function atCharFilter(ev, aflat, arise, hopSeconds, character, charAt) {
  const ch = atCharacterOf(character);
  if (ch !== 'noisy' && ch !== 'tonal') return ev;
  const times = [], strengths = [];
  for (let k = 0; k < ev.times.length; k++) {
    const t0 = ev.times[k] + AT_DET_LAG;
    const a = Math.max(0, Math.round(t0 / hopSeconds) - 1), b = Math.min(aflat.length - 1, Math.round((t0 + AT_CHAR_WINDOW) / hopSeconds));
    let sf = 0, se = 0;
    for (let i = a; i <= b; i++) { sf += aflat[i] * arise[i]; se += arise[i]; }
    if (atCharPass(character, se > 0 ? sf / se : 0, charAt)) { times.push(ev.times[k]); strengths.push(ev.strengths[k]); }
  }
  return { times: Float64Array.from(times), strengths: Float32Array.from(strengths) };
}

// ── Where playback was heard, frame to frame (a File analysed ahead) ─────────────────────────────────────────

/** A step back no longer than this (s) is the heard clock's wobble, not a jump: nothing is heard, the old place kept. */
export const AT_HEARD_WOBBLE = 0.25;

/**
 * The stretch of the song heard since the last frame: from `prev` (the last place heard, null on a new run) to `pos`
 * (now). Forward is (prev, pos]. Back is round the loop only when going round is the shorter way (prev near the end,
 * pos near the start); a small step back is the clock's wobble (getOutputTimestamp against the latencies, a render
 * quantum): nothing heard, and `keep` stays at prev, so the same stretch is never heard twice — reading a wobble as a
 * loop fired every hit in the file at once. A bigger jump back starts again from pos.
 * Returns { from, to, keep }: the hits in (from, to] (atEventsHeard; to < from goes round the loop), and the place to
 * remember.
 */
export function atHeardSpan(prev, pos, win, loop) {
  if (prev === null || prev === undefined || !Number.isFinite(prev)) return { from: pos, to: pos, keep: pos };
  if (pos >= prev) return { from: prev, to: pos, keep: pos };
  const back = prev - pos;
  if (loop && win && win.end > win.start) {
    const around = (win.end - prev) + (pos - win.start);
    if (around >= -1e-9 && around < back) return { from: prev, to: pos, keep: pos };
  }
  if (back <= AT_HEARD_WOBBLE) return { from: prev, to: prev, keep: prev };
  return { from: pos, to: pos, keep: pos };
}

/** The largest value of a curve (one value per `hopSeconds`) over (a, b], or at b when the stretch is empty; round a loop's window when b < a. */
export function atCurveMax(curve, hopSeconds, a, b, win) {
  const span = (x, y) => {
    let i = Math.max(0, Math.floor(x / hopSeconds) + 1);
    const j = Math.min(curve.length - 1, Math.round(y / hopSeconds));
    if (j < i) return atCurveAt(curve, hopSeconds, y);
    let m = -Infinity;
    for (; i <= j; i++) if (curve[i] > m) m = curve[i];
    return m;
  };
  if (b >= a) return span(a, b);
  return win ? Math.max(span(a, win.end), span(win.start - hopSeconds, b)) : atCurveAt(curve, hopSeconds, b);
}

/** A curve's value at a song time (its nearest hop), 0 outside it. */
export function atCurveAt(curve, hopSeconds, t) {
  const i = Math.round(t / hopSeconds);
  return i >= 0 && i < curve.length ? curve[i] : 0;
}

// ── AnalyserNode's spectrum, offline (Learn a sound from a file; tests) ──────────────────────────────────────

let atFftTables = null;
function atTables(n) {
  if (atFftTables && atFftTables.n === n) return atFftTables;
  const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), win = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    rev[i] = j;
  }
  for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos((-2 * Math.PI * k) / n); sin[k] = Math.sin((-2 * Math.PI * k) / n); }
  for (let i = 0; i < n; i++) win[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n);
  atFftTables = { n, rev, cos, sin, win, re: new Float64Array(n), im: new Float64Array(n) };
  return atFftTables;
}

/**
 * The dB spectrum of `mono[start … start + n)` (zeros outside) into `out` (n / 2 bins), as AnalyserNode computes it:
 * a Blackman window, an FFT, magnitude ÷ n, 20·log10.
 */
export function atSpectrumDbAt(mono, start, n, out) {
  const T = atTables(n), re = T.re, im = T.im;
  for (let i = 0; i < n; i++) {
    const k = start + i, r = T.rev[i];
    re[r] = (k >= 0 && k < mono.length ? mono[k] : 0) * T.win[i];
    im[r] = 0;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = T.cos[k * step], wi = T.sin[k * step], a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  for (let i = 0; i < n / 2; i++) { const m = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / n; out[i] = m > 1e-12 ? 20 * Math.log10(m) : -240; }
  return out;
}

/** How many of the sorted `times` are in (a, b], and the index of the last one (−1 with none). */
export function atEventsIn(times, a, b) {
  if (!(b > a)) return { count: 0, last: -1 };
  const after = t => { let lo = 0, hi = times.length; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; } return lo; };
  const i = after(a), j = after(b);
  return { count: j - i, last: j > i ? j - 1 : -1 };
}

/**
 * The hits heard between two playback positions inside a window that loops: (from, to], or, when playback went round
 * (`to < from`, `loop`), (from, end] and [start, to]. How many, and the strongest one's strength.
 */
export function atEventsHeard(ev, from, to, win, loop) {
  const take = (a, b) => {
    const r = atEventsIn(ev.times, a, b);
    let st = 0;
    for (let k = r.last - r.count + 1; k <= r.last; k++) st = Math.max(st, ev.strengths[k]);
    return { count: r.count, strength: st };
  };
  if (to >= from) return take(from, to);
  if (!loop) return { count: 0, strength: 0 };
  const x = take(from, win.end), y = take(win.start - 1e-9, to);
  return { count: x.count + y.count, strength: Math.max(x.strength, y.strength) };
}

// ── Spectrum layouts and textures ────────────────────────────────────────────────────────────────────────────

export const AT_SPECTRUM_MIN_HZ = 20;

/** The frequency at position `x` (0..1) across a spectrum. */
export function atHzAt(x, layout, minHz, maxHz) {
  return layout === 'log' ? minHz * Math.pow(maxHz / minHz, x) : minHz + (maxHz - minHz) * x;
}

/** Where a frequency sits across a spectrum, 0..1 (the inverse of atHzAt). */
export function atXOfHz(hz, layout, minHz, maxHz) {
  return layout === 'log' ? Math.log(hz / minHz) / Math.log(maxHz / minHz) : (hz - minHz) / (maxHz - minHz);
}

/** The highest frequency a spectrum shows (20 kHz, or less at a low sample rate). */
export function atSpectrumMaxHz(sampleRate) { return Math.min(20000, sampleRate / 2); }

/**
 * Resample a dB spectrum into `out.length` bins across `layout`, each as 0..1 between `minDb` and `maxDb`. A bin wider
 * than one FFT bin takes the loudest it covers; a narrower one reads between its two nearest. `smoothing` (0..1)
 * blends with what `out` held before.
 */
export function atSpectrumBins(freqDb, sampleRate, out, layout, minDb, maxDb, smoothing = 0) {
  const n = out.length, nb = freqDb.length, hz = atBinHz(sampleRate, nb);
  const lo = layout === 'log' ? AT_SPECTRUM_MIN_HZ : 0, hi = atSpectrumMaxHz(sampleRate);
  const span = Math.max(1e-3, maxDb - minDb);
  const db = i => Math.max(AT_DB_FLOOR, freqDb[Math.max(0, Math.min(nb - 1, i))]);
  const sm = Math.max(0, Math.min(0.99, smoothing));
  for (let i = 0; i < n; i++) {
    const f0 = atHzAt(i / n, layout, lo, hi) / hz, f1 = atHzAt((i + 1) / n, layout, lo, hi) / hz;
    let v;
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

/** Write 0..1 values as grey texels (alpha 1) starting at byte `offset`. */
export function atWriteRow(data, offset, row, w) {
  for (let i = 0; i < w; i++) {
    const v = Math.round(Math.max(0, Math.min(1, row[i] ?? 0)) * 255), o = offset + i * 4;
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
  }
}

/** Spectrogram: push one row on top of an RGBA8 image `w` × `h` whose row 0 is the bottom; the oldest drops off. */
export function atScrollRows(data, w, h, row) {
  const stride = w * 4;
  data.copyWithin(0, stride, stride * h);
  atWriteRow(data, (h - 1) * stride, row, w);
}

/** The last `out.length` samples of a block, as 0..1 (0.5 = silence), times `gain`. */
export function atWaveRow(wave, out, gain = 1) {
  const n = out.length, start = Math.max(0, wave.length - n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(1, 0.5 + 0.5 * (wave[start + i] ?? 0) * gain));
}

// ── Hits and an Audio Source's bands, frame by frame ─────────────────────────────────────────────────────────

/** Frames a scope keeps (about 5 s at 60 fps). */
export const AT_SCOPE_FRAMES = 300;
/** The scope's dBFS scale: this reads 0 (its bottom), 0 dBFS its top. */
export const AT_SCOPE_DB_FLOOR = -90;
export function atScopeDb(db) { return Math.max(0, Math.min(1, (db - AT_SCOPE_DB_FLOOR) / -AT_SCOPE_DB_FLOOR)); }
/**
 * A band's scope: per frame its onset function (`vals`), the line it had to beat (`line`: the recent mean + δ), its
 * energy (`db`, 0..1 on AT_SCOPE_DB_FLOOR … 0 dBFS), the Gate's line and the tracked noise floor on that scale, and
 * whether it hit. A ring; `at` is the oldest.
 */
export function atNewScope() {
  const n = AT_SCOPE_FRAMES;
  return { vals: new Float32Array(n), line: new Float32Array(n), db: new Float32Array(n), gate: new Float32Array(n), noise: new Float32Array(n), hits: new Uint8Array(n), at: 0 };
}
function atPushScope(sc, f, hit) {
  const i = sc.at;
  sc.vals[i] = f.odf; sc.line[i] = f.line; sc.db[i] = atScopeDb(f.edb); sc.gate[i] = atScopeDb(f.gate); sc.noise[i] = atScopeDb(f.noise); sc.hits[i] = hit ? 1 : 0;
  sc.at = (i + 1) % sc.vals.length;
}

export function atNewHitState() {
  return { trigger: 0, count: 0, strength: 0, envelope: 0, lastHit: -Infinity, gateOpen: false, pending: [], cands: [], arr: [], scope: atNewScope() };
}

/**
 * One frame of a hit output (a band's Trigger, Hit): Trigger is 1 on the frame of a hit, 0 on every other. `f`: this
 * step of the detector (atDetStepLive: { hit, subs, odf, line, edb, gate, noise, open }); `o`: { decay, delay (s to hold a live hit:
 * its sound reaches the speakers later), character / charAt (Only) }. `ext` (optional): this frame's hits decided ahead
 * (a File: { fired, strength, odf, line, edb, gate, noise, open }), which then fire instead of the live ones. With
 * Only noisy / tonal a live hit is held for AT_CHAR_WINDOW and fires only if what arrived passes; one that doesn't
 * never fires and isn't counted. A live hit queued to fire is also pushed to `s.queued` when it is an array (the
 * editor's Listen clicks on it: lib/audioTools/listen.ts). Mutates and returns `s`.
 */
export function atStepHit(s, now, dt, f, o, ext) {
  s.envelope = o.decay > 0 ? Math.max(0, s.envelope - dt / o.decay) : 0;
  let fired = 0;
  if (ext) {
    if (ext.fired) { fired = 1; s.count += ext.fired; s.strength = ext.strength; s.lastHit = now; }
    s.gateOpen = !!ext.open;
    atPushScope(s.scope, ext, fired);
  } else {
    s.gateOpen = !!f.open;
    const delay = o.delay > 0 ? o.delay : 0;
    const judged = o.character === 'noisy' || o.character === 'tonal';
    for (const sub of f.subs) {
      if (judged) s.arr.push({ t: sub.t, f: sub.arrival.flat, e: sub.arrival.energy });
      if (!sub.hit) continue;
      s.count += 1;
      s.strength = atDetLevel(f.edb);
      if (judged) s.cands.push(sub.t);
      else { s.pending.push(sub.t + delay); if (s.queued) s.queued.push(sub.t + delay); }
    }
    if (judged) { while (s.arr.length && now - s.arr[0].t > AT_CHAR_WINDOW + 0.5) s.arr.shift(); }
    else { s.arr.length = 0; s.cands.length = 0; }
    while (s.cands.length && now - s.cands[0] >= AT_CHAR_WINDOW - 1e-9) {
      const t0 = s.cands.shift();
      let sf = 0, se = 0;
      for (const a of s.arr) if (a.t >= t0 - 0.006 && a.t <= t0 + AT_CHAR_WINDOW + 1e-6) { sf += a.f * a.e; se += a.e; }
      if (atCharPass(o.character, se > 0 ? sf / se : 0, o.charAt)) { s.pending.push(t0 + delay); if (s.queued) s.queued.push(t0 + delay); }
      else s.count = Math.max(0, s.count - 1);
    }
    while (s.pending.length && s.pending[0] <= now + 1e-9) { s.pending.shift(); fired = 1; s.lastHit = now; }
    atPushScope(s.scope, f, f.hit);
  }
  s.trigger = fired;
  if (fired) s.envelope = 1;
  return s;
}

/** A band's or Hit's detector: frames (atDetFrame), picker (atDetPick), and its magnitudes buffer. */
export function atNewDetRun() { return { det: atNewDetector(), pick: atNewPicker(), mag: null, pend: 0, last: null }; }

/**
 * A live step of a detector on the last samples heard (`wave`, newest last), `dt` seconds after the last step: it
 * runs one detector frame per AT_DET_HOP_SECONDS of the new samples (the window ending at each; frames whose window
 * reaches past the buffer's start are skipped), so once an animation frame it still sees what the AudioWorklet's 5 ms
 * frames see — its hits are just told a little later. Returns what atStepHit and the Value read: the newest frame's
 * { odf (the largest this step), line, edb, gate, noise, open, flat, bright } and `subs` ({ t, hit, arrival } per frame).
 */
export function atDetStepLive(r, cfg, wave, sampleRate, now, dt) {
  const n = cfg.spec.fft, hop = atDetHop(sampleRate);
  if (!r.mag || r.mag.length !== n / 2) r.mag = new Float32Array(n / 2);
  // New samples since the last step, never more than the buffer holds (a hidden tab's long gap).
  r.pend = Math.min(r.pend + Math.max(0, dt) * sampleRate, Math.max(hop, wave.length - n + hop));
  const subs = [];
  let odf = 0, fr = r.last;
  while (r.pend >= hop - 1e-6) {
    r.pend -= hop;
    const end = Math.round(wave.length - r.pend), t = now - r.pend / sampleRate;
    if (end - n < 0 || end > wave.length) continue;
    atDetMag(wave, end, n, r.mag);
    fr = atDetFrame(r.det, r.mag, cfg.spec, sampleRate, hop / sampleRate);
    const hit = atDetPick(r.pick, fr.odf, fr.edb, t, hop / sampleRate, cfg);
    subs.push({ t, hit, arrival: { flat: fr.aflat, energy: fr.arise } });
    if (fr.odf > odf) odf = fr.odf;
  }
  r.last = fr;
  const z = fr || { edb: -200, flat: 0, bright: 0 };
  return {
    hit: subs.some(x => x.hit) ? 1 : 0, subs, odf, line: r.pick.line, edb: z.edb, gate: r.pick.gateLine, noise: r.pick.noiseDb, open: r.pick.open,
    flat: z.flat, bright: z.bright,
  };
}

/** What a band's Value can send: its loudness (the default), or its brightness or noisiness (0 tonal … 1 noise). */
export const AT_VALUE_FROM = ['level', 'brightness', 'flatness'];
export function atValueFromOf(v) { return AT_VALUE_FROM.indexOf(v) >= 0 ? v : 'level'; }

export function atNewBandRun() { return { band: atNewBandState(), hit: atNewHitState(), hitAt: -Infinity, r: atNewDetRun(), frame: null }; }

/**
 * One frame of a band (lib/audioTools/bands.ts AudioBandSpec) on the last samples heard (`wave`): its Value (its
 * energy, −60 → 0 … 0 dBFS → 1, or its brightness / noisiness; 0 while its Gate is shut; followed with Attack /
 * Release, times Gain) and its Trigger (the detector's hits, Only applied). `x` (optional): { delay, ext, liveInput } —
 * seconds to hold live hits back, this frame's hits decided ahead (a File), and whether the sound is live input (the
 * Mic, a Live track: Track room noise defaults on). Mutates and returns `run`.
 */
export function atStepBandRun(run, b, wave, sampleRate, now, dt, x) {
  const cfg = atDetConfig(b, x && x.liveInput);
  const f = atDetStepLive(run.r, cfg, wave, sampleRate, now, dt);
  run.frame = f;
  atStepHit(run.hit, now, dt, f, {
    decay: 0.3, delay: x && x.delay ? x.delay : 0, character: b.trigger ? cfg.character : 'any', charAt: cfg.charAt,
  }, b.trigger && x && x.ext ? x.ext : undefined);
  if (!b.trigger) run.hit.trigger = 0;
  if (run.hit.trigger) run.hitAt = now;
  const from = atValueFromOf(b.valueFrom), v = from === 'brightness' ? f.bright : from === 'flatness' ? f.flat : atDetLevel(f.edb);
  run.band = atStepBand(run.band, f.open ? v : 0, dt, cfg.attack, cfg.release, typeof b.gain === 'number' ? b.gain : 1);
  return run;
}

/** A band's energy now (dBFS) on the last samples of `wave`, as the detector measures it (Band level). */
export function atBandDb(wave, sampleRate, lo, hi, mag) {
  const n = AT_DET_FFT, m = mag && mag.length === n / 2 ? mag : new Float32Array(n / 2);
  atDetMag(wave, wave.length, n, m);
  let e = 0;
  for (const k of atDetBins(sampleRate, n, [[lo, hi]])) e += m[k] * m[k];
  return 10 * Math.log10(e / 1.5 + 1e-20);
}

// ── Learned sounds (lib/audioTools/learn.ts has the why) ─────────────────────────────────────────────────────

export const AT_LEARN_BANDS = 40;
export const AT_LEARN_MIN_HZ = 40;
export const AT_LEARN_MAX_HZ = 16000;
/** Seconds of frames after an onset that make a fingerprint. */
export const AT_LEARN_WINDOW = 0.05;
export const AT_ENV_POINTS = 4;
/** Seconds the Match output takes to fall from 1 to 0 after an onset. */
export const AT_MATCH_FALL = 0.5;
/** How far under its loudest band a fingerprint's bands are floored, dB. */
const AT_FLOOR_DB = 60;
/** Seconds of frames kept for "Learn last hit". */
export const AT_LEARN_RING_SECONDS = 2.5;
/** The onset detector the matcher listens with. */
export const AT_LEARN_ONSET = { sensitivity: 0.6, cooldownMs: 80 };

const atEdges = (() => {
  const e = new Float64Array(AT_LEARN_BANDS + 1);
  for (let i = 0; i <= AT_LEARN_BANDS; i++) e[i] = AT_LEARN_MIN_HZ * Math.pow(AT_LEARN_MAX_HZ / AT_LEARN_MIN_HZ, i / AT_LEARN_BANDS);
  return e;
})();

/** The power in each learn band of a dB spectrum, as dB. A band narrower than a bin reads its nearest bin. */
export function atLearnBands(freqDb, sampleRate, out = new Float32Array(AT_LEARN_BANDS)) {
  const nb = freqDb.length, hz = atBinHz(sampleRate, nb);
  const p = i => { const db = freqDb[Math.max(0, Math.min(nb - 1, i))]; return db > AT_DB_FLOOR ? Math.pow(10, db / 10) : 0; };
  for (let b = 0; b < AT_LEARN_BANDS; b++) {
    const a = Math.ceil(atEdges[b] / hz), z = Math.min(nb - 1, Math.floor(atEdges[b + 1] / hz));
    let sum = 0, n = 0;
    for (let i = a; i <= z; i++) { sum += p(i); n++; }
    const pw = n ? sum / n : p(Math.round((atEdges[b] + atEdges[b + 1]) / 2 / hz));
    out[b] = pw > 0 ? 10 * Math.log10(pw) : AT_DB_FLOOR;
  }
  return out;
}

/** Spectral flux over the learn bands, every band counting the same. */
export function atLearnFlux(prev, cur) {
  let sum = 0;
  for (let b = 0; b < AT_LEARN_BANDS; b++) { const d = atFluxUnit(cur[b]) - atFluxUnit(prev[b]); if (d > 0) sum += d; }
  return sum / AT_LEARN_BANDS;
}

export function atNewOnsetState() { return { prev: null, history: new Float32Array(AT_HIT_HISTORY), at: 0, filled: 0, last: -Infinity, flux: 0, trigger: 0 }; }

/** Onsets over the whole spectrum: the flux above a threshold that follows its recent mean (Hit's). */
export function atStepOnset(s, bands, now) {
  s.trigger = 0;
  s.flux = s.prev ? atLearnFlux(s.prev, bands) : 0;
  s.prev = bands;
  let mean = 0;
  for (let i = 0; i < s.filled; i++) mean += s.history[i];
  mean = s.filled ? mean / s.filled : 0;
  const thr = atHitThreshold(mean, AT_LEARN_ONSET.sensitivity);
  s.history[s.at] = s.flux;
  s.at = (s.at + 1) % s.history.length;
  s.filled = Math.min(s.history.length, s.filled + 1);
  if (s.flux > thr && (now - s.last) * 1000 >= AT_LEARN_ONSET.cooldownMs) { s.last = now; s.trigger = 1; }
  return s;
}

function atLevelDb(bands) {
  let s = 0;
  for (let i = 0; i < bands.length; i++) s += Math.pow(10, bands[i] / 10);
  return s > 0 ? 10 * Math.log10(s) : AT_DB_FLOOR;
}

/** The fingerprint of the frames after an onset (`frames[0]` is the onset), or null for silence. */
export function atFingerprintOf(frames) {
  if (!frames.length) return null;
  const t0 = frames[0].t;
  const use = frames.filter(f => f.t - t0 <= AT_LEARN_WINDOW + 1e-6);
  const pw = new Float64Array(AT_LEARN_BANDS);
  for (const f of use) for (let b = 0; b < AT_LEARN_BANDS; b++) pw[b] += Math.pow(10, f.bands[b] / 10) / use.length;
  const db = Array.from(pw, v => (v > 0 ? 10 * Math.log10(v) : AT_DB_FLOOR));
  const top = Math.max(...db);
  if (!(top > AT_DB_FLOOR + 1)) return null;
  for (let b = 0; b < AT_LEARN_BANDS; b++) db[b] = Math.max(db[b], top - AT_FLOOR_DB);
  const mean = db.reduce((a, v) => a + v, 0) / AT_LEARN_BANDS;
  let norm = 0;
  for (let b = 0; b < AT_LEARN_BANDS; b++) { db[b] -= mean; norm += db[b] * db[b]; }
  norm = Math.sqrt(norm);
  if (!(norm > 1e-6)) return null;
  const spec = db.map(v => +(v / norm).toFixed(4));
  const lv = use.map(f => ({ t: f.t - t0, l: atLevelDb(f.bands) }));
  const at = t => {
    if (lv.length === 1 || t <= lv[0].t) return lv[0].l;
    for (let i = 1; i < lv.length; i++) if (t <= lv[i].t) { const k = (t - lv[i - 1].t) / Math.max(1e-9, lv[i].t - lv[i - 1].t); return lv[i - 1].l * (1 - k) + lv[i].l * k; }
    return lv[lv.length - 1].l;
  };
  const raw = Array.from({ length: AT_ENV_POINTS }, (_, i) => at((AT_LEARN_WINDOW * i) / (AT_ENV_POINTS - 1)));
  const peak = Math.max(...raw);
  const env = raw.map(l => +Math.max(0, 1 + (l - peak) / 40).toFixed(4));
  return { spec, env };
}

/** How alike two fingerprints are, 0..1: mostly the spectra's cosine, a little the envelopes'. */
export function atSimilarity(a, b) {
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

function atNewSoundRun() { return { trigger: 0, match: 0, last: 0, lastFire: -Infinity, hitAt: -Infinity, count: 0 }; }
export function atNewLearnListener() { return { onset: atNewOnsetState(), pending: null, ring: [], runs: new Map(), onsets: 0 }; }

/**
 * One frame: keep it in the ring, watch for an onset, and AT_LEARN_WINDOW after one compare its fingerprint with every
 * learned sound (lib/audioTools/learn.ts AudioSoundSpec). Mutates `L`.
 */
export function atStepLearn(L, sounds, freqDb, sampleRate, now, dt) {
  for (const id of [...L.runs.keys()]) if (!sounds.some(s => s.id === id)) L.runs.delete(id);
  for (const s of sounds) {
    let r = L.runs.get(s.id);
    if (!r) L.runs.set(s.id, (r = atNewSoundRun()));
    r.trigger = 0;
    r.match = Math.max(0, r.match - dt / AT_MATCH_FALL);
  }
  const bands = atLearnBands(freqDb, sampleRate);
  atStepOnset(L.onset, bands, now);
  const frame = { t: now, bands, flux: L.onset.flux };
  L.ring.push(frame);
  while (L.ring.length && now - L.ring[0].t > AT_LEARN_RING_SECONDS) L.ring.shift();
  if (L.pending) {
    L.pending.frames.push(frame);
    if (now - L.pending.t0 >= AT_LEARN_WINDOW - 1e-6) {
      const fp = atFingerprintOf(L.pending.frames);
      L.pending = null;
      if (fp) for (const s of sounds) {
        if (!s.spec.length) continue;
        const r = L.runs.get(s.id), sim = atSimilarity(fp, s);
        r.match = r.last = sim;
        if (sim >= s.match && (now - r.lastFire) * 1000 >= s.cooldown) { r.trigger = 1; r.lastFire = r.hitAt = now; r.count++; }
      }
    }
  } else if (L.onset.trigger) {
    L.onsets++;
    L.pending = { t0: now, frames: [frame] };
  }
}

// ── A frame of the Audio nodes ───────────────────────────────────────────────────────────────────────────────

/** Bins in the Audio Source card's spectrum. */
export const AT_CARD_BINS = 48;

/** A source's running state: its bands' runs, its learned-sound listener and the card's spectrum row. */
export function atNewSource() { return { runs: new Map(), learn: atNewLearnListener(), row: new Float32Array(AT_CARD_BINS) }; }

/** A source's Gain on its frame: + dB on the spectrum, × on the wave. Then its Level (RMS). */
export function atApplyGain(freq, wave, gain) {
  const g = Math.max(0, gain);
  if (g !== 1) {
    const db = 20 * Math.log10(Math.max(1e-6, g));
    for (let i = 0; i < freq.length; i++) freq[i] += db;
    for (let i = 0; i < wave.length; i++) wave[i] *= g;
  }
  return atRmsLevel(wave);
}

/**
 * One frame of an Audio Source after its Level and Time: the card's spectrum, each band's Value / Trigger
 * (`<band>_v` / `_t`), each learned sound's Trigger / Match (`<sound>_t` / `_m`), written by channel through `write`.
 * `x` (optional): { wave, delay, ext, liveInput } — the last samples heard (what the bands analyse: AT_DET_FFT or
 * more; without them the bands hear silence), seconds to hold live band hits back, the hits decided ahead (by band
 * id), and whether the sound is live input (atStepBandRun).
 */
export function atStepSource(st, bands, sounds, freq, sampleRate, now, dt, write, x) {
  atSpectrumBins(freq, sampleRate, st.row, 'log', -90, -20, 0.5);
  for (const id of [...st.runs.keys()]) if (!bands.some(b => b.id === id)) st.runs.delete(id);
  for (const b of bands) {
    let run = st.runs.get(b.id);
    if (!run) st.runs.set(b.id, (run = atNewBandRun()));
    atStepBandRun(run, b, x && x.wave ? x.wave : AT_SILENT_WAVE, sampleRate, now, dt, x ? { delay: x.delay || 0, ext: x.ext ? x.ext.get(b.id) : undefined, liveInput: !!x.liveInput } : undefined);
    if (b.value) write(b.id + '_v', run.band.level);
    if (b.trigger) write(b.id + '_t', run.hit.trigger);
  }
  atStepLearn(st.learn, sounds, freq, sampleRate, now, dt);
  for (const s of sounds) {
    const r = st.learn.runs.get(s.id);
    if (!r) continue;
    if (s.trigger) write(s.id + '_t', r.trigger);
    if (s.matchOut) write(s.id + '_m', r.match);
  }
}

/** A listening node's running state; `w` × `h` texels for the texture nodes (`data` RGBA8, silence filled in). */
/** Silence, for a band with no samples. */
const AT_SILENT_WAVE = new Float32Array(2048);

export function atNewListener(type, w, h) {
  const l = { band: atNewBandState(), hit: atNewHitState(), r: atNewDetRun(), mag: null, row: new Float32Array(w || 0), data: null, w: w || 0, h: h || 0, hitAt: 0 };
  if (w && h) {
    l.data = new Uint8Array(w * h * 4);
    const quiet = type === 'audioWaveform' ? 128 : 0;
    for (let i = 0; i < l.data.length; i += 4) { l.data[i] = l.data[i + 1] = l.data[i + 2] = quiet; l.data[i + 3] = 255; }
  }
  return l;
}

/**
 * One frame of a listening node (`spec`: its type and settings, lib/audioTools/engine.ts listenerSpecOf) on its
 * source's frame (silence when `active` is false). Numbers go through `write` by channel; a texture node fills
 * `l.data` and returns true when it changed (a Spectrogram holds while its source is silent). `x` (optional, Hit):
 * { delay, ext, liveInput } as atStepBandRun's. Band level reads the band's energy (−60 → 0 … 0 dBFS → 1), Hit the
 * band's detector with its preset (`spec.preset`, Sensitivity, Min interval, Gate).
 */
export function atStepListener(l, spec, freq, wave, sampleRate, active, nowMs, dt, write, x) {
  switch (spec.type) {
    case 'audioBand': {
      if (!l.mag) l.mag = new Float32Array(AT_DET_FFT / 2);
      const db = atBandDb(active ? wave : AT_SILENT_WAVE, sampleRate, spec.lo, spec.hi, l.mag);
      l.band = atStepBand(l.band, atDetLevel(db), dt, spec.attack, spec.release, Math.max(0, spec.gain));
      write('level', l.band.level);
      write('peak', l.band.peak);
      return false;
    }
    case 'audioHit': {
      const cfg = atDetConfig(spec, x && x.liveInput), now = nowMs / 1000;
      const f = atDetStepLive(l.r, cfg, active ? wave : AT_SILENT_WAVE, sampleRate, now, dt);
      atStepHit(l.hit, now, dt, f, { decay: spec.decay, delay: x && x.delay ? x.delay : 0, character: cfg.character, charAt: cfg.charAt }, x && x.ext ? x.ext : undefined);
      if (l.hit.trigger) l.hitAt = nowMs;
      write('trigger', l.hit.trigger);
      write('envelope', l.hit.envelope);
      write('count', l.hit.count);
      write('strength', l.hit.strength);
      return false;
    }
  }
  if (!l.data) return false;
  const layout = spec.layout === 'linear' ? 'linear' : 'log';
  switch (spec.type) {
    case 'audioSpectrum':
      atSpectrumBins(freq, sampleRate, l.row, layout, spec.minDb, spec.maxDb, spec.smoothing);
      atWriteRow(l.data, 0, l.row, l.w);
      return true;
    case 'audioSpectrogram':
      if (!active) return false;
      atSpectrumBins(freq, sampleRate, l.row, layout, spec.minDb, spec.maxDb);
      atScrollRows(l.data, l.w, l.h, l.row);
      return true;
    case 'audioWaveform':
      atWaveRow(wave, l.row);
      atWriteRow(l.data, 0, l.row, l.w);
      return true;
  }
  return false;
}
