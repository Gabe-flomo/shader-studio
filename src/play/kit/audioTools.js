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
 *   atStepTrigger   a trigger (a band's, Hit's): a fixed Threshold with hysteresis, a noise Gate, a minimum time above
 *   atAnalyseLevels a whole file's band levels ahead; atPickTriggers / atEventsHeard then fire them as they are heard
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

// ── Triggers: a fixed Threshold with hysteresis, a noise Gate and a minimum time above ─────────────────────────
//
// A trigger watches one 0..1 signal, its band's level (the same number as the band's Value, before Attack / Release
// and Gain), against lines that never move:
//   Gate       below it is silence (no trigger, Value 0); it closes only after AT_GATE_HOLD below, so noise hovering
//              around it doesn't flicker it open and shut.
//   Threshold  the signal must rise above it, and stay there for Min time (ms, counting the frame it rose on), to fire.
//   Release    Threshold × Release: it re-arms only once the signal falls below this, so a held note or a swell fires
//              once (a Schmitt trigger: TouchDesigner's Trigger / Release Threshold pair).
//   Cooldown   the shortest gap between two hits; a rise inside it is swallowed (never fired late).

/** Seconds the gate stays open after the signal drops under it. */
export const AT_GATE_HOLD = 0.08;

/** A new trigger's settings (Threshold and Gate on the 0..1 level scale, Release a fraction of Threshold). */
export const AT_TRIGGER_DEFAULTS = { threshold: 0.5, releaseAt: 0.8, gate: 0.1, minMs: 10, cooldownMs: 120 };

/**
 * An old Sensitivity (0..1, the adaptive detector's, gone) as a fixed Threshold on the level: 0.5 → 0.5; higher
 * sensitivity → a lower line (catches quieter hits): 0 → 0.7, 1 → 0.3.
 */
export function atThresholdFromSensitivity(sensitivity) {
  const v = Math.max(0, Math.min(1, typeof sensitivity === 'number' && Number.isFinite(sensitivity) ? sensitivity : 0.5));
  return Math.round((0.7 - 0.4 * v) * 100) / 100;
}

export function atNewTriggerState() {
  return { gateOpen: false, below: 0, armed: true, above: 0, crossAt: 0, lastHit: -Infinity, trigger: 0, signal: 0, level: 0, gated: 0, strength: 0, count: 0 };
}

/**
 * One step of a trigger on signal `x` over the `dt` seconds ending at `now` (`o`: threshold, releaseAt, gate, minMs,
 * cooldownMs, as atTriggerOpts cleans them). Fires (s.trigger = 1) once the gated signal has been above Threshold for
 * Min time, when armed and out of the Cooldown; s.lastHit is then the moment it first rose above (the onset).
 * `g` (optional): what the Gate reads, when it isn't `x` — a band's level, while `x` is a feature its Detect picked
 * (Hits, Transient…): the Gate stays "below this level the band is silence". Mutates and returns `s`.
 */
export function atStepTrigger(s, x, now, dt, o, g) {
  s.trigger = 0;
  s.signal = x;
  const gs = g === undefined ? x : g;
  s.level = gs;
  if (gs > o.gate) { s.gateOpen = true; s.below = 0; }
  else if (s.gateOpen) { s.below += dt; if (s.below >= AT_GATE_HOLD - 1e-9) s.gateOpen = false; }
  const v = s.gateOpen ? x : 0;
  s.gated = v;
  const thr = o.threshold;
  if (s.armed) {
    if (v > thr) {
      if (s.above === 0) s.crossAt = now;
      s.above += Math.max(dt, 1e-6);
      if (s.above * 1000 >= o.minMs - 1e-6) {
        s.armed = false;
        // A rise inside the Cooldown is swallowed: it neither fires now nor later.
        if ((s.crossAt - s.lastHit) * 1000 >= o.cooldownMs - 1e-6) {
          s.lastHit = s.crossAt;
          s.trigger = 1;
          s.count += 1;
          s.strength = v;
        }
      }
    } else s.above = 0;
  } else if (v < thr * o.releaseAt) {
    s.armed = true;
    s.above = 0;
  }
  return s;
}

/** A band's or Hit's trigger settings, cleaned (Cooldown as `cooldownMs` or `cooldown`). */
export function atTriggerOpts(o) {
  const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const D = AT_TRIGGER_DEFAULTS;
  return {
    threshold: Math.max(0, Math.min(1, n(o.threshold, D.threshold))),
    releaseAt: Math.max(0, Math.min(1, n(o.releaseAt, D.releaseAt))),
    gate: Math.max(0, Math.min(1, n(o.gate, D.gate))),
    minMs: Math.max(0, n(o.minMs, D.minMs)),
    cooldownMs: Math.max(0, n(o.cooldownMs !== undefined ? o.cooldownMs : o.cooldown, D.cooldownMs)),
  };
}

/** Frames a trigger scope keeps (about 5 s at 60 fps): the signal it measured and where it fired. */
export const AT_SCOPE_FRAMES = 300;
/** `vals` is what the trigger measured (the level, or the feature Detect picked), `lvls` the band's level (what the Gate reads). */
export function atNewScope() { return { vals: new Float32Array(AT_SCOPE_FRAMES), lvls: new Float32Array(AT_SCOPE_FRAMES), hits: new Uint8Array(AT_SCOPE_FRAMES), at: 0 }; }
function atPushScope(sc, v, hit, lvl) { sc.vals[sc.at] = v; sc.lvls[sc.at] = lvl === undefined ? v : lvl; sc.hits[sc.at] = hit ? 1 : 0; sc.at = (sc.at + 1) % sc.vals.length; }

export function atNewHitState() {
  return Object.assign(atNewTriggerState(), { envelope: 0, pending: [], cands: [], arr: [], scope: atNewScope() });
}

/**
 * One frame of Hit: Trigger is 1 on the frame of a hit and 0 on every other. `o`: lo, hi, threshold, releaseAt, gate,
 * minMs, cooldownMs, decay, and `delay` (seconds to hold a live hit back: a sound that reaches the speakers later than
 * the analyser reads it). `ext` (optional): this frame's hit decided ahead (a file analysed ahead: { fired, signal,
 * strength, level? }); the live trigger still runs then, for the gate. `o.x` / `o.level` (optional): the signal the
 * trigger measures and the band's level the Gate reads, when worked out already (a band's Detect); otherwise both are
 * the band's level. `o.character` / `o.charAt` / `o.arrival` (optional, a band's Only; atBandArrival's { flat,
 * energy } this frame): a live hit is held for AT_CHAR_WINDOW, then fired (stamped at its onset) only if what arrived
 * in the band from its onset on was noisy / tonal enough (atCharPass on the arrivals' energy-weighted flatness); one that
 * isn't never fires and isn't counted. Mutates and returns `s`.
 */
export function atStepHit(s, freqDb, sampleRate, now, dt, o, ext) {
  s.envelope = o.decay > 0 ? Math.max(0, s.envelope - dt / o.decay) : 0;
  const level = o.level !== undefined ? o.level : atBandLevel(freqDb, sampleRate, o.lo, o.hi);
  const x = o.x !== undefined ? o.x : level;
  const count = s.count, strength = s.strength;
  atStepTrigger(s, x, now, dt, atTriggerOpts(o), level);
  let fired = 0;
  if (ext) {
    s.count = count; s.strength = strength;
    if (ext.fired) { fired = 1; s.count += ext.fired; s.strength = ext.strength; }
    atPushScope(s.scope, ext.signal, fired, ext.level);
  } else {
    const delay = o.delay > 0 ? o.delay : 0;
    const judged = o.character === 'noisy' || o.character === 'tonal';
    if (judged) {
      const ar = o.arrival;
      s.arr.push({ t: now, f: ar ? ar.flat : 0, e: ar ? ar.energy : 0 });
      while (s.arr.length && now - s.arr[0].t > AT_CHAR_WINDOW + 0.5) s.arr.shift();
    } else { s.arr.length = 0; s.cands.length = 0; }
    if (s.trigger) {
      if (judged) s.cands.push(s.lastHit);
      else s.pending.push(s.lastHit + delay);
    }
    while (s.cands.length && now - s.cands[0] >= AT_CHAR_WINDOW - 1e-9) {
      const t0 = s.cands.shift();
      let sf = 0, se = 0;
      for (const a of s.arr) if (a.t >= t0 - 1e-6 && a.t <= t0 + AT_CHAR_WINDOW + 1e-6) { sf += a.f * a.e; se += a.e; }
      if (atCharPass(o.character, se > 0 ? sf / se : 0, o.charAt)) s.pending.push(t0 + delay);
      else s.count = Math.max(0, s.count - 1);
    }
    while (s.pending.length && s.pending[0] <= now + 1e-9) { s.pending.shift(); fired = 1; }
    atPushScope(s.scope, x, fired, level);
  }
  s.trigger = fired;
  if (fired) s.envelope = 1;
  return s;
}

// ── A whole file analysed ahead (a File source; docs/audio-tools.md "Files: analysed ahead") ───────────────────

/** The analysis window (AnalyserNode's size, so a level reads as it does live) and its hop: 5 ms. */
export const AT_OFFLINE_FFT = 2048;
export const AT_OFFLINE_HOP_SECONDS = 0.005;
export function atOfflineHop(sampleRate) { return Math.max(1, Math.round(sampleRate * AT_OFFLINE_HOP_SECONDS)); }

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

/**
 * Each range's level (atBandLevel, 0..1) through a whole sound, one value per `hop` samples: value `i` is the window
 * centred on sample `i · hop`, so it lines up with the song's time `i · hop / sampleRate`. `onProgress(0..1)` now and then.
 */
export function atAnalyseLevels(mono, sampleRate, ranges, hop, onProgress) {
  const n = AT_OFFLINE_FFT, frames = Math.max(1, Math.ceil(mono.length / hop));
  const curves = ranges.map(() => new Float32Array(frames));
  const db = new Float32Array(n / 2);
  for (let i = 0; i < frames; i++) {
    atSpectrumDbAt(mono, i * hop - n / 2, n, db);
    for (let r = 0; r < ranges.length; r++) curves[r][i] = atBandLevel(db, sampleRate, ranges[r].lo, ranges[r].hi);
    if (onProgress && (i & 1023) === 0) onProgress(i / frames);
  }
  return curves;
}

/**
 * The hits in a level curve (one value per `hopSeconds`), found by the same trigger as live: their times (the onsets,
 * in seconds) and strengths. `gateCurve` (optional): what the Gate reads, when the curve is a feature (the band's level).
 */
export function atPickTriggers(curve, hopSeconds, o, gateCurve) {
  const s = atNewTriggerState(), opts = atTriggerOpts(o), times = [], strengths = [];
  for (let i = 0; i < curve.length; i++) {
    atStepTrigger(s, curve[i], i * hopSeconds, hopSeconds, opts, gateCurve ? gateCurve[i] : undefined);
    if (s.trigger) { times.push(s.lastHit); strengths.push(s.strength); }
  }
  return { times: Float64Array.from(times), strengths: Float32Array.from(strengths) };
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

/** A curve's value at a song time (its nearest hop), 0 outside it. */
export function atCurveAt(curve, hopSeconds, t) {
  const i = Math.round(t / hopSeconds);
  return i >= 0 && i < curve.length ? curve[i] : 0;
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

// ── Detect: what a band's Value and Trigger read (docs/audio-tools.md "Detect") ─────────────────────────────────────
//
// A band's Detect picks the 0..1 signal its Value sends and its Trigger fires on (the same fixed Threshold / Release /
// Min ms / Cooldown). The Gate always reads the band's level: below it the band is silence, whatever it detects.
//   level       the band's level (atBandLevel): as before Detect, and still the default
//   hits        onset strength: spectral flux (half-wave rectified, on log-compressed magnitudes) over the band's bins,
//               against its own recent mean (AT_ONSET_TAU): flux / (flux + K·mean + floor), so 0.5 is "K × the recent
//               mean". A steady note has no flux: a kick over a held bass line reads near 1 at each kick, near 0 between.
//   transient   attack sharpness: how far the band's level (dB) jumped above its own slow follower (AT_TRANSIENT_TAU),
//               over AT_TRANSIENT_DB. A click or snap reads 1; a swell (rising slower than the follower) stays low.
//   flatness    noisy ↔ tonal: the band's spectral flatness (geometric ÷ arithmetic mean of its bins' power) in dB,
//               over AT_FLAT_DB: 0 a pure tone … about 0.9 white noise. Needs a band a few FFT bins wide.
//   brightness  the band's spectral centroid, on a log scale from its bottom (0) to its top (1).
//   drums       "Drums only": harmonic / percussive separation (HPSS: a median across time is the harmonic part, a
//               median across frequency the percussive part, a soft mask P / (P + H)) on the band's spectrum, then Hits
//               on what is left, so a sustained melody under the kick is ignored. Live (Mic, Video, a web page) it is
//               causal: the time median covers the last AT_HPSS_SECONDS only. A File analysed ahead centres that window
//               on each moment (atAnalyseFeatures), so it sees how long a sound lasts on both sides.
// `character` (Only: any / noisy / tonal) lets a hit through only where the band's flatness is at least (noisy) or under
// (tonal) `charAt`: drums, hats and snares are noisy, melodic notes tonal. It doesn't apply to Flatness or Brightness.

export const AT_DETECTS = ['level', 'hits', 'transient', 'flatness', 'brightness', 'drums'];
export const AT_CHARACTERS = ['any', 'noisy', 'tonal'];
export const AT_CHAR_AT = 0.3;
export function atDetectOf(d) { return AT_DETECTS.indexOf(d) >= 0 ? d : 'level'; }
export function atCharacterOf(c) { return AT_CHARACTERS.indexOf(c) >= 0 ? c : 'any'; }
/** Whether Only (noisy / tonal) applies to a Detect. */
export function atDetectTakesCharacter(d) { const k = atDetectOf(d); return k !== 'flatness' && k !== 'brightness'; }

/**
 * Onsets: seconds of the recent mean flux an onset is measured against; the multiple of it that reads 0.5; the share of
 * the band's own loudness (log-compressed) a flux must beat to count; a floor for near-silence.
 */
export const AT_ONSET_TAU = 0.5;
export const AT_ONSET_K = 3;
export const AT_ONSET_REL = 0.02;
export const AT_ONSET_FLOOR = 0.0002;
/** Transient: the slow follower's time constant (s) and the jump (dB) that reads 1. */
export const AT_TRANSIENT_TAU = 0.1;
export const AT_TRANSIENT_DB = 15;
/** Flatness: the flatness in dB (10·log10 G/A) that reads 0. */
export const AT_FLAT_DB = 30;
/** HPSS: the time median's length (s), the frequency median's width (groups), the most frequency groups worked on. */
export const AT_HPSS_SECONDS = 0.2;
export const AT_HPSS_FREQ = 17;
export const AT_HPSS_GROUPS = 96;
/** The frame live analysis compares with (60 fps): a file analysed ahead (5 ms hops) compares about this far back. */
export const AT_LIVE_FRAME = 1 / 60;
export function atOfflineLag(hopSeconds) { return Math.max(1, Math.round(AT_LIVE_FRAME / hopSeconds)); }

/** The bins a band reads: atBandLevel's. */
function atBinRange(nb, sampleRate, lo, hi) {
  const hz = atBinHz(sampleRate, nb);
  return [Math.max(1, Math.floor(Math.min(lo, hi) / hz)), Math.min(nb - 1, Math.ceil(Math.max(lo, hi) / hz))];
}

/** Spectral flatness in the band, 0 (a pure tone) … 1 (flat): 1 + 10·log10(geometric / arithmetic mean power) / AT_FLAT_DB. */
export function atBandFlatness(freqDb, sampleRate, lo, hi) {
  const [a, b] = atBinRange(freqDb.length, sampleRate, lo, hi);
  if (b < a) return 0;
  let lg = 0, ar = 0, top = AT_DB_FLOOR;
  for (let i = a; i <= b; i++) { const db = Math.max(AT_DB_FLOOR, freqDb[i]); lg += db; ar += Math.pow(10, db / 10); if (db > top) top = db; }
  // Silence is neither: 0 (not the 1 its equal, empty bins would read).
  if (top <= AT_DB_FLOOR + 1) return 0;
  const n = b - a + 1, flatDb = lg / n - 10 * Math.log10(ar / n);
  return Math.max(0, Math.min(1, 1 + flatDb / AT_FLAT_DB));
}

/** The band's spectral centroid (power-weighted), 0 at its bottom bin … 1 at its top, on a log scale. */
export function atBandBrightness(freqDb, sampleRate, lo, hi) {
  const [a, b] = atBinRange(freqDb.length, sampleRate, lo, hi);
  if (b <= a) return 0;
  let sp = 0, sf = 0;
  for (let i = a; i <= b; i++) { const db = freqDb[i]; if (!(db > AT_DB_FLOOR)) continue; const p = Math.pow(10, db / 10); sp += p; sf += p * i; }
  if (!(sp > 0)) return 0;
  return Math.max(0, Math.min(1, Math.log(sf / sp / a) / Math.log(b / a)));
}

export function atNewFeature() { return { key: '', hist: [], mean: 0, slow: -1, t: 0, ring: [], perc: [] }; }

/**
 * Onset strength from a flux, against the recent mean (which then moves on by `dt` seconds) and a floor that scales
 * with how loud the band is now (`ref`: its bins' mean log-compressed magnitude), so a quiet band's hits count as much
 * as a loud one's while the tiny wobble of a held note never does: flux / (flux + K·mean + REL·ref + floor).
 */
function atOnsetNorm(f, flux, dt, ref) {
  const v = flux / (flux + AT_ONSET_K * f.mean + AT_ONSET_REL * ref + AT_ONSET_FLOOR);
  f.mean += (flux - f.mean) * (1 - Math.exp(-Math.max(0, dt) / AT_ONSET_TAU));
  return v;
}

const atRowMean = row => { let s = 0; for (let i = 0; i < row.length; i++) s += row[i]; return row.length ? s / row.length : 0; };

/** How much `row` (log-compressed magnitudes) rose over the row `lag` frames back (kept in `hist`), averaged. */
function atLagFlux(hist, row, lag) {
  let flux = 0;
  if (hist.length >= lag) {
    const p = hist[hist.length - lag];
    for (let i = 0; i < row.length; i++) { const d = row[i] - p[i]; if (d > 0) flux += d; }
    flux /= Math.max(1, row.length);
  }
  hist.push(row);
  while (hist.length > lag) hist.shift();
  return flux;
}

/** HPSS's frequency groups for a band: groups of `g` bins over it, and AT_HPSS_FREQ / 2 groups of context on each side. */
export function atHpssRegion(nb, sampleRate, lo, hi) {
  const [a, b] = atBinRange(nb, sampleRate, lo, hi);
  const m = AT_HPSS_FREQ >> 1, n = Math.max(1, b - a + 1);
  const g = Math.max(1, Math.ceil(n / (AT_HPSS_GROUPS - 2 * m)));
  const nBand = Math.ceil(n / g);
  return { nb, g, m, nBand, groups: nBand + 2 * m, start: a - m * g };
}

/**
 * The power of each of a region's groups (the mean of its bins'). Past either end of the spectrum (and DC) is silence,
 * so a low tone's few bins near 0 Hz don't fill the frequency median and pass for a broadband hit.
 */
export function atGroupPow(freqDb, R, out) {
  for (let k = 0; k < R.groups; k++) {
    let s = 0;
    for (let j = 0; j < R.g; j++) {
      const i = R.start + k * R.g + j, db = i >= 1 && i < R.nb ? freqDb[i] : AT_DB_FLOOR;
      s += db > AT_DB_FLOOR ? Math.pow(10, db / 10) : 1e-10;
    }
    out[k] = s / R.g;
  }
  return out;
}

function atMedianOf(buf, n) {
  const a = buf.subarray(0, n).sort();
  return n & 1 ? a[n >> 1] : 0.5 * (a[(n >> 1) - 1] + a[n >> 1]);
}

/**
 * The percussive part of one frame's band groups (`cur`, power) given their harmonic estimate (`harm`): the median
 * across AT_HPSS_FREQ groups, a soft mask P / (P + H) on the power (the band's groups only).
 */
export function atPercRow(cur, harm, R) {
  const row = new Float64Array(R.nBand), buf = new Float64Array(AT_HPSS_FREQ);
  for (let kb = 0; kb < R.nBand; kb++) {
    for (let j = 0; j < AT_HPSS_FREQ; j++) buf[j] = cur[kb + j];
    const k = kb + R.m, p = atMedianOf(buf, AT_HPSS_FREQ);
    row[kb] = cur[k] * (p / (p + harm[k] + 1e-20));
  }
  return row;
}

/** How loud a frame's band groups are (all of it, not only the percussive part): their mean log-compressed magnitude. */
function atBandRef(cur, R) {
  let s = 0;
  for (let kb = 0; kb < R.nBand; kb++) { const p = cur[kb + R.m]; s += atFluxUnit(p > 1e-10 ? 10 * Math.log10(p) : AT_DB_FLOOR); }
  return R.nBand ? s / R.nBand : 0;
}

/** The percussive power of a frame's band groups as log-compressed magnitudes, for the flux (atFluxUnit). */
function atPercFlux(perc) {
  const row = new Float32Array(perc.length);
  for (let i = 0; i < perc.length; i++) row[i] = atFluxUnit(perc[i] > 1e-10 ? 10 * Math.log10(perc[i]) : AT_DB_FLOOR);
  return row;
}

/**
 * One frame of a band's feature (hits, transient, brightness, flatness, drums), 0..1, on a dB spectrum `dt` seconds after
 * the last. `lag`: how many frames back the flux compares with (1 live; atOfflineLag ahead). `level` (optional): the
 * band's level this frame, when known. Mutates `f`.
 */
export function atStepFeature(f, detect, freqDb, sampleRate, lo, hi, dt, lag, level) {
  const nb = freqDb.length;
  const key = `${detect}|${nb}|${sampleRate}|${Math.round(lo)}|${Math.round(hi)}`;
  if (f.key !== key) { f.key = key; f.hist = []; f.mean = 0; f.slow = -1; f.t = 0; f.ring = []; f.perc = []; }
  const L = Math.max(1, lag | 0), step = Math.max(0, dt);
  f.t += step;
  switch (detect) {
    case 'hits': {
      const [a, b] = atBinRange(nb, sampleRate, lo, hi);
      if (b < a) return 0;
      const row = new Float32Array(b - a + 1);
      for (let i = a; i <= b; i++) row[i - a] = atFluxUnit(freqDb[i]);
      return atOnsetNorm(f, atLagFlux(f.hist, row, L), step, atRowMean(row));
    }
    case 'transient': {
      const cur = (level !== undefined ? level : atBandLevel(freqDb, sampleRate, lo, hi)) * 70;
      if (!(f.slow >= 0)) f.slow = cur;
      const v = Math.max(0, Math.min(1, (cur - f.slow) / AT_TRANSIENT_DB));
      f.slow += (cur - f.slow) * (1 - Math.exp(-step / AT_TRANSIENT_TAU));
      return v;
    }
    case 'brightness': return atBandBrightness(freqDb, sampleRate, lo, hi);
    case 'flatness': return atBandFlatness(freqDb, sampleRate, lo, hi);
    case 'drums': {
      const R = atHpssRegion(nb, sampleRate, lo, hi);
      const cur = atGroupPow(freqDb, R, new Float64Array(R.groups));
      f.ring.push({ t: f.t, pow: cur });
      while (f.ring.length > 1 && f.t - f.ring[0].t > AT_HPSS_SECONDS - 1e-9) f.ring.shift();
      const harm = new Float64Array(R.groups), buf = new Float64Array(f.ring.length);
      for (let k = 0; k < R.groups; k++) {
        for (let j = 0; j < f.ring.length; j++) buf[j] = f.ring[j].pow[k];
        harm[k] = atMedianOf(buf, f.ring.length);
      }
      return atOnsetNorm(f, atLagFlux(f.perc, atPercFlux(atPercRow(cur, harm, R)), L), step, atBandRef(cur, R));
    }
  }
  return level !== undefined ? level : atBandLevel(freqDb, sampleRate, lo, hi);
}

/** Seconds after a hit's onset over which Only (noisy / tonal) judges what arrived. */
export const AT_CHAR_WINDOW = 0.04;

/**
 * What arrived in the band since `st.prev` (`lag` frames back: its bins' power rises): the flatness of those rises on
 * atBandFlatness's scale (a new note rises in a few harmonic bins: tonal; a hat or a snare in all of them: noisy),
 * and their mean power (how much arrived, the weight Only judges a hit's frames by). Keeps this frame's power in `st`.
 */
export function atBandArrival(st, freqDb, sampleRate, lo, hi, lag) {
  const [a, b] = atBinRange(freqDb.length, sampleRate, lo, hi);
  const n = Math.max(0, b - a + 1), pow = new Float64Array(n);
  for (let i = 0; i < n; i++) { const db = freqDb[a + i]; pow[i] = db > AT_DB_FLOOR ? Math.pow(10, db / 10) : 0; }
  const L = Math.max(1, lag | 0);
  const prev = st.hist.length >= L ? st.hist[st.hist.length - L] : null;
  st.hist.push(pow);
  while (st.hist.length > L) st.hist.shift();
  if (!prev || prev.length !== n || !n) return { flat: 0, energy: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) { const r = pow[i] - prev[i]; if (r > 0) sum += r; }
  if (!(sum > 0)) return { flat: 0, energy: 0 };
  const mean = sum / n, floor = mean * 1e-4;
  let lg = 0;
  for (let i = 0; i < n; i++) lg += 10 * Math.log10(Math.max(floor, pow[i] - prev[i]));
  return { flat: Math.max(0, Math.min(1, 1 + (lg / n - 10 * Math.log10(mean)) / AT_FLAT_DB)), energy: mean };
}

/** Whether a hit whose arrival's flatness was `flat` passes Only (`character`: any / noisy / tonal) at `charAt`. */
export function atCharPass(character, flat, charAt) {
  const c = atCharacterOf(character);
  if (c === 'any') return true;
  const cut = typeof charAt === 'number' && Number.isFinite(charAt) ? charAt : AT_CHAR_AT;
  return c === 'noisy' ? flat >= cut : flat < cut;
}

/** The Only a band's trigger uses: its character, or 'any' when its Detect doesn't take one (Flatness, Brightness). */
export function atBandCharacter(b) { return atDetectTakesCharacter(b.detect) ? atCharacterOf(b.character) : 'any'; }

/**
 * Hits picked ahead (atPickTriggers) kept only where Only passes, judged as a live hit is: the arrivals' flatness
 * (`aflat`) weighted by their energy (`arise`), over AT_CHAR_WINDOW from each onset (curves one value per `hopSeconds`).
 */
export function atCharFilter(ev, aflat, arise, hopSeconds, character, charAt) {
  if (atCharacterOf(character) === 'any') return ev;
  const times = [], strengths = [];
  for (let k = 0; k < ev.times.length; k++) {
    const a = Math.max(0, Math.round(ev.times[k] / hopSeconds)), b = Math.min(aflat.length - 1, Math.round((ev.times[k] + AT_CHAR_WINDOW) / hopSeconds));
    let sf = 0, se = 0;
    for (let i = a; i <= b; i++) { sf += aflat[i] * arise[i]; se += arise[i]; }
    if (atCharPass(character, se > 0 ? sf / se : 0, charAt)) { times.push(ev.times[k]); strengths.push(ev.strengths[k]); }
  }
  return { times: Float64Array.from(times), strengths: Float32Array.from(strengths) };
}

/** Sliding median of `col` over `w` (odd) values centred on each (past the ends, the end value), into `out`. */
export function atSlidingMedian(col, w, out) {
  const n = col.length, h = w >> 1, win = new Float64Array(w);
  const at = i => col[Math.max(0, Math.min(n - 1, i))];
  for (let j = 0; j < w; j++) win[j] = at(j - h);
  win.sort();
  for (let i = 0; i < n; i++) {
    out[i] = win[h];
    if (i + 1 >= n) break;
    // Slide: the value leaving is replaced by the one entering, moved along until the window is sorted again.
    const old = at(i - h), nu = at(i + 1 + h);
    let p = 0;
    while (p < w - 1 && win[p] !== old) p++;
    while (p > 0 && win[p - 1] > nu) { win[p] = win[p - 1]; p--; }
    while (p < w - 1 && win[p + 1] < nu) { win[p] = win[p + 1]; p++; }
    win[p] = nu;
  }
  return out;
}

/**
 * A whole sound's band features ahead (a File source): for each request { lo, hi, detect } its `value` (what Detect
 * reads), `level` (what the Gate reads) and `flat` (what Only reads) curves, one value per `hop` samples, each centred
 * on its time as atAnalyseLevels's are. Hits, Transient, Flatness and Brightness are the live sums stepped every hop
 * (the flux compares atOfflineLag hops back: about one live frame). Drums only is non-causal here: its time median is
 * centred on each moment.
 */
export function atAnalyseFeatures(mono, sampleRate, reqs, hop, onProgress) {
  const n = AT_OFFLINE_FFT, frames = Math.max(1, Math.ceil(mono.length / hop)), hopSec = hop / sampleRate, lag = atOfflineLag(hopSec);
  const db = new Float32Array(n / 2);
  const out = reqs.map(r => {
    const d = atDetectOf(r.detect);
    return {
      detect: d, level: new Float32Array(frames), value: d === 'level' ? null : new Float32Array(frames), flat: new Float32Array(frames),
      aflat: new Float32Array(frames), arise: new Float32Array(frames), arr: { hist: [] }, st: atNewFeature(), R: null, mat: null, row: null,
    };
  });
  for (let i = 0; i < frames; i++) {
    atSpectrumDbAt(mono, i * hop - n / 2, n, db);
    for (let r = 0; r < reqs.length; r++) {
      const o = out[r], lo = reqs[r].lo, hi = reqs[r].hi;
      const level = atBandLevel(db, sampleRate, lo, hi);
      o.level[i] = level;
      o.flat[i] = atBandFlatness(db, sampleRate, lo, hi);
      const ar = atBandArrival(o.arr, db, sampleRate, lo, hi, lag);
      o.aflat[i] = ar.flat; o.arise[i] = ar.energy;
      if (o.detect === 'drums') {
        if (!o.R) { o.R = atHpssRegion(db.length, sampleRate, lo, hi); o.mat = new Float32Array(frames * o.R.groups); o.row = new Float64Array(o.R.groups); }
        o.mat.set(atGroupPow(db, o.R, o.row), i * o.R.groups);
      } else if (o.detect === 'flatness') o.value[i] = o.flat[i];
      else if (o.value) o.value[i] = atStepFeature(o.st, o.detect, db, sampleRate, lo, hi, hopSec, lag, level);
    }
    if (onProgress && (i & 1023) === 0) onProgress(i / frames);
  }
  for (const o of out) {
    if (o.detect !== 'drums' || !o.R) continue;
    const R = o.R, G = R.groups, w = Math.max(3, Math.round(AT_HPSS_SECONDS / hopSec) | 1);
    const harm = new Float32Array(frames * G), col = new Float32Array(frames), med = new Float32Array(frames);
    for (let k = 0; k < G; k++) {
      for (let i = 0; i < frames; i++) col[i] = o.mat[i * G + k];
      atSlidingMedian(col, w, med);
      for (let i = 0; i < frames; i++) harm[i * G + k] = med[i];
    }
    const f = atNewFeature(), hist = [];
    for (let i = 0; i < frames; i++) {
      const cur = o.mat.subarray(i * G, (i + 1) * G), perc = atPercRow(cur, harm.subarray(i * G, (i + 1) * G), R);
      o.value[i] = atOnsetNorm(f, atLagFlux(hist, atPercFlux(perc), lag), hopSec, atBandRef(cur, R));
    }
    o.mat = null;
  }
  return out.map(o => ({ value: o.value || o.level, level: o.level, flat: o.flat, aflat: o.aflat, arise: o.arise }));
}

// ── An Audio Source's bands ──────────────────────────────────────────────────────────────────────────────────

export function atNewBandRun() { return { band: atNewBandState(), hit: atNewHitState(), hitAt: -Infinity, feat: atNewFeature(), flat: 0, arr: { hist: [] } }; }

/**
 * One frame of a band (lib/audioTools/bands.ts AudioBandSpec): its Value (what its Detect reads — the level, or a
 * feature — once the Gate lets it through, followed with Attack / Release, times Gain) and its Trigger. `x` (optional):
 * { delay, ext } — seconds to hold live hits back, and this frame's hit decided ahead (a file analysed ahead). A band
 * on Level with Only: any runs exactly as before Detect. Only (noisy / tonal) judges each hit, never the Value.
 * Mutates and returns `run`.
 */
export function atStepBandRun(run, b, freqDb, sampleRate, now, dt, x) {
  const detect = atDetectOf(b.detect), character = b.trigger ? atBandCharacter(b) : 'any';
  let sig, level, arrival;
  if (detect !== 'level' || character !== 'any') {
    level = atBandLevel(freqDb, sampleRate, b.lo, b.hi);
    const flat = atBandFlatness(freqDb, sampleRate, b.lo, b.hi);
    run.flat = flat;
    sig = detect === 'level' ? level : detect === 'flatness' ? flat : atStepFeature(run.feat, detect, freqDb, sampleRate, b.lo, b.hi, dt, 1, level);
  }
  if (character !== 'any') arrival = atBandArrival(run.arr, freqDb, sampleRate, b.lo, b.hi, 1);
  else run.arr.hist.length = 0;
  atStepHit(run.hit, freqDb, sampleRate, now, dt, {
    lo: b.lo, hi: b.hi, threshold: b.threshold, releaseAt: b.releaseAt, gate: b.gate, minMs: b.minMs, cooldownMs: b.cooldown,
    decay: 0.3, delay: x && x.delay ? x.delay : 0, x: sig, level, character, charAt: b.charAt, arrival,
  }, b.trigger && x && x.ext ? x.ext : undefined);
  if (!b.trigger) run.hit.trigger = 0;
  if (run.hit.trigger) run.hitAt = now;
  run.band = atStepBand(run.band, run.hit.gateOpen ? run.hit.signal : 0, dt, b.attack, b.release, b.gain);
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
 * `x` (optional): { delay, ext } — seconds to hold live band hits back, and the hits decided ahead, by band id.
 */
export function atStepSource(st, bands, sounds, freq, sampleRate, now, dt, write, x) {
  atSpectrumBins(freq, sampleRate, st.row, 'log', -90, -20, 0.5);
  for (const id of [...st.runs.keys()]) if (!bands.some(b => b.id === id)) st.runs.delete(id);
  for (const b of bands) {
    let run = st.runs.get(b.id);
    if (!run) st.runs.set(b.id, (run = atNewBandRun()));
    atStepBandRun(run, b, freq, sampleRate, now, dt, x ? { delay: x.delay || 0, ext: x.ext ? x.ext.get(b.id) : undefined } : undefined);
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
 * `l.data` and returns true when it changed (a Spectrogram holds while its source is silent). `x` (optional, Hit):
 * { delay, ext } as atStepBandRun's.
 */
export function atStepListener(l, spec, freq, wave, sampleRate, active, nowMs, dt, write, x) {
  switch (spec.type) {
    case 'audioBand':
      l.band = atStepBand(l.band, atBandLevel(freq, sampleRate, spec.lo, spec.hi), dt, spec.attack, spec.release, Math.max(0, spec.gain));
      write('level', l.band.level);
      write('peak', l.band.peak);
      return false;
    case 'audioHit':
      atStepHit(l.hit, freq, sampleRate, nowMs / 1000, dt, {
        lo: spec.lo, hi: spec.hi, threshold: spec.threshold, releaseAt: spec.releaseAt, gate: spec.gate, minMs: spec.minMs, cooldownMs: spec.cooldown,
        decay: spec.decay, delay: x && x.delay ? x.delay : 0,
      }, x && x.ext ? x.ext : undefined);
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
