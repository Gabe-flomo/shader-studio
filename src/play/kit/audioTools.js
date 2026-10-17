/**
 * audioTools.js — the Audio nodes' sums, once per frame (docs/audio-tools.md). The same code runs in the app
 * (lib/audioTools/engine.ts, through dsp.ts, bands.ts and learn.ts, which re-export it) and on an exported page
 * (runtime/play-runtime.js, through the inlined kit as SSKit.audioTools), so a page's bands, triggers, learned sounds
 * and pictures of the sound move exactly as the app's do.
 *
 * Pure: no DOM, no Web Audio, no clock of its own. Every function reads one analysis frame: a spectrum in dB per FFT
 * bin (AnalyserNode.getFloatFrequencyData: `fftSize / 2` bins from 0 Hz to half the sample rate) and / or the last
 * `fftSize` samples; `now` is seconds on the wall clock, `dt` seconds since the last frame.
 *
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

// ── Hit: onsets by spectral flux with an adaptive threshold ──────────────────────────────────────────────────

/** About 0.7 s of frames at 60 fps. */
export const AT_HIT_HISTORY = 40;

export function atNewHitState() {
  return { prev: null, history: new Float32Array(AT_HIT_HISTORY), at: 0, filled: 0, lastHit: -Infinity, trigger: 0, envelope: 0, count: 0, strength: 0, flux: 0, threshold: 0 };
}

/** The threshold's multiple of the recent mean flux, and its floor, for a Sensitivity. */
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

/** One frame of Hit: Trigger is 1 on the frame of a hit and 0 on every other. Mutates and returns `s`. */
export function atStepHit(s, freqDb, sampleRate, now, dt, o) {
  s.trigger = 0;
  s.envelope = o.decay > 0 ? Math.max(0, s.envelope - dt / o.decay) : 0;
  if (!s.prev || s.prev.length !== freqDb.length) {
    s.prev = new Float32Array(freqDb);
    return s;
  }
  const flux = atBandFlux(s.prev, freqDb, sampleRate, o.lo, o.hi);
  s.prev.set(freqDb);
  let mean = 0;
  for (let i = 0; i < s.filled; i++) mean += s.history[i];
  mean = s.filled ? mean / s.filled : 0;
  const thr = atHitThreshold(mean, o.sensitivity);
  s.flux = flux; s.threshold = thr;
  s.history[s.at] = flux;
  s.at = (s.at + 1) % s.history.length;
  s.filled = Math.min(s.history.length, s.filled + 1);
  if (flux > thr && (now - s.lastHit) * 1000 >= Math.max(40, o.cooldownMs)) {
    s.lastHit = now;
    s.trigger = 1;
    s.envelope = 1;
    s.count += 1;
    s.strength = atBandLevel(freqDb, sampleRate, o.lo, o.hi);
  }
  return s;
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

// ── An Audio Source's bands ──────────────────────────────────────────────────────────────────────────────────

export function atNewBandRun() { return { band: atNewBandState(), hit: atNewHitState(), hitAt: -Infinity }; }

/** One frame of a band (lib/audioTools/bands.ts AudioBandSpec): its Value and Trigger. Mutates and returns `run`. */
export function atStepBandRun(run, b, freqDb, sampleRate, now, dt) {
  run.band = atStepBand(run.band, atBandLevel(freqDb, sampleRate, b.lo, b.hi), dt, b.attack, b.release, b.gain);
  if (b.trigger) {
    atStepHit(run.hit, freqDb, sampleRate, now, dt, { lo: b.lo, hi: b.hi, sensitivity: b.sensitivity, cooldownMs: b.cooldown, decay: 0.3 });
    if (run.hit.trigger) run.hitAt = now;
  } else run.hit.trigger = 0;
  return run;
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
 */
export function atStepSource(st, bands, sounds, freq, sampleRate, now, dt, write) {
  atSpectrumBins(freq, sampleRate, st.row, 'log', -90, -20, 0.5);
  for (const id of [...st.runs.keys()]) if (!bands.some(b => b.id === id)) st.runs.delete(id);
  for (const b of bands) {
    let run = st.runs.get(b.id);
    if (!run) st.runs.set(b.id, (run = atNewBandRun()));
    atStepBandRun(run, b, freq, sampleRate, now, dt);
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
export function atNewListener(type, w, h) {
  const l = { band: atNewBandState(), hit: atNewHitState(), row: new Float32Array(w || 0), data: null, w: w || 0, h: h || 0, hitAt: 0 };
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
 * `l.data` and returns true when it changed (a Spectrogram holds while its source is silent).
 */
export function atStepListener(l, spec, freq, wave, sampleRate, active, nowMs, dt, write) {
  switch (spec.type) {
    case 'audioBand':
      l.band = atStepBand(l.band, atBandLevel(freq, sampleRate, spec.lo, spec.hi), dt, spec.attack, spec.release, Math.max(0, spec.gain));
      write('level', l.band.level);
      write('peak', l.band.peak);
      return false;
    case 'audioHit':
      atStepHit(l.hit, freq, sampleRate, nowMs / 1000, dt, { lo: spec.lo, hi: spec.hi, sensitivity: spec.sensitivity, cooldownMs: spec.cooldown, decay: spec.decay });
      if (l.hit.trigger) l.hitAt = nowMs;
      write('trigger', l.hit.trigger);
      write('envelope', l.hit.envelope);
      write('count', l.hit.count);
      write('strength', l.hit.strength);
      return false;
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
