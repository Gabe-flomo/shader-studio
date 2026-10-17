/**
 * audioChain.js — the Audio nodes that change the sound (docs/audio-tools.md, "Audio → audio"): Filter, Resonator bank
 * and Spectral. Each takes the sound on its `audio` wire, processes it with Web Audio and hands it on (so they chain:
 * Source → Filter → Resonator → Hit…), and reads what it made once a frame for the picture: its Level, a Resonator's
 * Energies (each resonator's ringing, 0–1, and the loudest one), a Spectral's spectrum.
 *
 * The same code runs in the app (lib/audioTools/engine.ts) and on an exported page (runtime/play-runtime.js, through
 * the inlined kit as SSKit.audioTools.chain), so a page sounds and moves as the app does.
 *
 *   acBiquadCoeffs / acBiquadMag / acBiquadRun   the Web Audio spec's biquad, as numbers (pure, tested)
 *   acResonatorHz / acResonatorQ / acResonatorGains / acResonatorMakeup   tuning a bank (pure, tested)
 *   AC_SPECTRAL_CORE   the Spectral node's FFT and frame rules as source text: the AudioWorklet runs it, tests eval it
 *   acBuild(ctx, spec) the Web Audio nodes of one effect: input, output, a probe analyser; update(spec), dispose()
 *   acNewRun / acStepEffect   one frame of an effect's numbers and texture
 *
 * Top-level names start with `ac` / `AC_` (the kit's files share one scope in exports).
 */
import { atFollow, atRmsLevel, atSpectrumBins, atWriteRow } from './audioTools.js';

/** The probe's FFT (as the Audio Source's: 1024 bins). */
export const AC_FFT = 2048;
/** The most resonators a bank holds (three vec4s of Energies). */
export const AC_MAX_RESONATORS = 12;
/** Bins in a Spectral node's spectrum texture. */
export const AC_SPECTRAL_BINS = 128;
/** Smoothing for moving numbers (s), so a slider or a Play control never clicks. */
export const AC_TAU = 0.015;

// ── Biquads ──────────────────────────────────────────────────────────────────────────────────────────────────

export const AC_FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking'];

/**
 * A biquad's coefficients, normalised by a0, as the Web Audio spec computes them (Audio EQ Cookbook). `q` is the plain
 * Q for every type: Web Audio reads a low- or high-pass's Q in dB, so acBuild hands those 20·log10(q) (the same curve).
 */
export function acBiquadCoeffs(type, f0, q, gainDb, sampleRate) {
  const f = Math.max(1, Math.min(sampleRate * 0.4999, f0));
  const w0 = 2 * Math.PI * f / sampleRate, cw = Math.cos(w0), sw = Math.sin(w0);
  const Q = Math.max(1e-4, q), A = Math.pow(10, gainDb / 40), alpha = sw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'peaking': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    default: b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** How much a biquad passes at `hz` (1 = unchanged). */
export function acBiquadMag(c, hz, sampleRate) {
  const w = 2 * Math.PI * hz / sampleRate, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di));
}

/** Run samples through a biquad (direct form I); `st` keeps [x1, x2, y1, y2] between calls. */
export function acBiquadRun(c, x, out = new Float32Array(x.length), st = [0, 0, 0, 0]) {
  let [x1, x2, y1, y2] = st;
  for (let i = 0; i < x.length; i++) {
    const y = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  st[0] = x1; st[1] = x2; st[2] = y1; st[3] = y2;
  return out;
}

// ── Resonator bank: tuning ───────────────────────────────────────────────────────────────────────────────────

/** Semitones within an octave per scale; Fifths stacks fifths, Harmonic is the root's harmonic series. */
export const AC_SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  minorChord: [0, 3, 7],
  majorChord: [0, 4, 7],
  fifths: 'fifths',
  harmonic: 'harmonic',
};
export const AC_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A MIDI note's frequency (69 = A4 = 440 Hz). */
export function acMidiHz(note) { return 440 * Math.pow(2, (note - 69) / 12); }
/** A MIDI note's name ("A3"; 60 = C4). */
export function acNoteName(note) { const n = Math.round(note); return AC_NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }

/** The MIDI notes (fractional for Harmonic) of `count` resonators from `root` up `scale`. */
export function acResonatorNotes(root, scale, count) {
  const n = Math.max(1, Math.min(AC_MAX_RESONATORS, Math.round(count)));
  const steps = AC_SCALES[scale] ?? AC_SCALES.minor;
  const out = [];
  for (let k = 0; k < n; k++) {
    if (steps === 'fifths') out.push(root + 7 * k);
    else if (steps === 'harmonic') out.push(root + 12 * Math.log2(k + 1));
    else out.push(root + steps[k % steps.length] + 12 * Math.floor(k / steps.length));
  }
  return out;
}

/** The resonators' frequencies, Hz; any above 0.45 × the sample rate drops by octaves until it fits. */
export function acResonatorHz(root, scale, count, sampleRate = 48000) {
  return acResonatorNotes(root, scale, count).map(m => { let hz = acMidiHz(m); while (hz > sampleRate * 0.45) hz /= 2; return hz; });
}

/**
 * The Q that makes a resonator at `hz` ring for `decay` seconds (its tail falls 60 dB): a two-pole ring dies as
 * e^(−π·(hz/Q)·t), so T60 = ln(1000)·Q / (π·hz).
 */
export function acResonatorQ(hz, decay) {
  return Math.max(0.5, Math.min(3000, Math.PI * hz * Math.max(0.01, decay) / Math.log(1000)));
}

/** Each resonator's level: Brightness 0.5 is even, lower darkens the high ones, higher brightens them; the loudest is 1. */
export function acResonatorGains(hzs, brightness) {
  const tilt = (Math.max(0, Math.min(1, brightness)) - 0.5) * 2;
  const g = hzs.map(hz => Math.pow(hz / hzs[0], tilt));
  const top = Math.max(...g);
  return g.map(v => v / top);
}

/** Make-up gain for a bank: a narrow band-pass passes only a sliver of a broad sound. */
export function acResonatorMakeup(q) { return Math.max(1, Math.min(24, 0.6 * Math.sqrt(q))); }

/**
 * A resonator's ringing level, 0..1, from the RMS of its output (before make-up and Mix): −60 dB is 0, −10 dB is 1.
 * Tighter than a band's −80…−10, so the notes that ring stand clear of the ones that only hum along.
 */
export const AC_ENERGY_FLOOR_DB = -60;
export const AC_ENERGY_TOP_DB = -10;
export function acEnergyUnit(rms) {
  const d = 20 * Math.log10(Math.max(1e-7, rms));
  return Math.max(0, Math.min(1, (d - AC_ENERGY_FLOOR_DB) / (AC_ENERGY_TOP_DB - AC_ENERGY_FLOOR_DB)));
}

/** The bank's settings as numbers: its frequencies, Q, gains and make-up. */
export function acBankOf(spec, sampleRate) {
  const hz = acResonatorHz(spec.root, spec.scale, spec.count, sampleRate);
  const q = hz.map(f => acResonatorQ(f, spec.decay));
  const makeup = acResonatorMakeup(q.reduce((a, v) => a + v, 0) / q.length);
  return { hz, q, gains: acResonatorGains(hz, spec.brightness), makeup };
}

/** Each resonator's energy (0..1) for a block of samples (pure: tests, and anything offline). */
export function acResonatorEnergies(samples, sampleRate, spec) {
  const b = acBankOf(spec, sampleRate);
  return b.hz.map((hz, k) => {
    const y = acBiquadRun(acBiquadCoeffs('bandpass', hz, b.q[k], 0, sampleRate), samples);
    // The ring settles in a few time constants: measure the last half.
    let s = 0;
    const from = Math.floor(y.length / 2);
    for (let i = from; i < y.length; i++) s += y[i] * y[i];
    return acEnergyUnit(Math.sqrt(s / Math.max(1, y.length - from)));
  });
}

/** The index of the loudest energy among the first `n` (0 when all are silent). */
export function acLoudest(energies, n) {
  let best = 0;
  for (let k = 1; k < n; k++) if (energies[k] > energies[best]) best = k;
  return best;
}

// ── Spectral: the AudioWorklet's code (text, so a worklet can load it; tests evaluate it) ───────────────────

/**
 * An STFT of 1024 samples every 256 (Hann windows, overlap-add), per channel. Each frame's bins are changed by mode:
 *  0 Freeze: while Freeze is on, every bin keeps the loudness it had when Freeze began and turns at the rate it did
 *    then (so a held chord keeps sounding); off, the sound passes as it is.
 *  1 Blur: each bin's loudness follows the frames before it (Amount 0 none … 0.99 a long smear), phases as heard.
 *  2 Gate: a bin quieter than Threshold (dB, a full-scale sine reads 0) is silenced.
 * Mix blends the dry sound (delayed to line up) with the processed one.
 */
export const AC_SPECTRAL_CORE = String.raw`
function acFft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, ang = (inv ? 2 : -2) * Math.PI / len;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      for (let i = k; i < n; i += len) {
        const b = i + half, xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[i] - xr; im[b] = im[i] - xi; re[i] += xr; im[i] += xi;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function acSpecNew(n, hop) {
  const h = n / 2 + 1;
  return { n, hop, prev: new Float32Array(h), held: new Float32Array(h), dphi: new Float32Array(h), phase: new Float32Array(h), smear: new Float32Array(h), frozen: false };
}
function acWrap(p) { return p - 2 * Math.PI * Math.round(p / (2 * Math.PI)); }
function acSpecFrame(st, re, im, o) {
  const n = st.n, h = n / 2, full = n / 4;
  const freeze = o.mode === 0 && o.freeze, capture = freeze && !st.frozen;
  const a = Math.max(0, Math.min(0.995, o.amount)), thr = o.threshold;
  for (let k = 0; k <= h; k++) {
    const mag = Math.hypot(re[k], im[k]), ph = Math.atan2(im[k], re[k]);
    const dp = acWrap(ph - st.prev[k]);
    st.prev[k] = ph;
    let m = mag, p = ph;
    if (freeze) {
      if (capture) { st.held[k] = mag; st.dphi[k] = dp; st.phase[k] = ph; }
      else st.phase[k] = acWrap(st.phase[k] + st.dphi[k]);
      m = st.held[k]; p = st.phase[k];
    } else if (o.mode === 1) {
      st.smear[k] = st.smear[k] * a + mag * (1 - a);
      m = st.smear[k];
    } else if (o.mode === 2) {
      if (20 * Math.log10(mag / full + 1e-12) < thr) m = 0;
    }
    re[k] = m * Math.cos(p); im[k] = m * Math.sin(p);
  }
  im[0] = 0; im[h] = 0;
  for (let k = 1; k < h; k++) { re[n - k] = re[k]; im[n - k] = -im[k]; }
  st.frozen = freeze;
}
function acStftNew(n, hop) {
  const win = new Float32Array(n);
  let w2 = 0;
  for (let i = 0; i < n; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); w2 += win[i] * win[i]; }
  return { n, hop, win, norm: hop / w2, inF: new Float32Array(n), acc: new Float32Array(n), outF: new Float32Array(hop), fill: n - hop,
    re: new Float64Array(n), im: new Float64Array(n), spec: acSpecNew(n, hop), dry: new Float32Array(n), dryAt: 0 };
}
function acStftFrame(st, o) {
  const n = st.n, hop = st.hop, re = st.re, im = st.im;
  for (let i = 0; i < n; i++) { re[i] = st.inF[i] * st.win[i]; im[i] = 0; }
  acFft(re, im, false);
  acSpecFrame(st.spec, re, im, o);
  acFft(re, im, true);
  for (let i = 0; i < n; i++) st.acc[i] += re[i] * st.win[i] * st.norm;
  for (let i = 0; i < hop; i++) st.outF[i] = st.acc[i];
  st.acc.copyWithin(0, hop); st.acc.fill(0, n - hop);
  st.inF.copyWithin(0, hop);
}
function acStftProcess(st, input, output, o) {
  const lag = st.n - st.hop, mix = Math.max(0, Math.min(1, o.mix));
  for (let i = 0; i < output.length; i++) {
    const x = input ? input[i] : 0;
    st.inF[st.fill] = x;
    const wet = st.outF[st.fill - lag];
    const d = st.dry[st.dryAt];
    st.dry[st.dryAt] = x; st.dryAt = (st.dryAt + 1) % st.dry.length;
    output[i] = d * (1 - mix) + wet * mix;
    if (++st.fill >= st.n) { st.fill = lag; acStftFrame(st, o); }
  }
}
`;

/** The worklet: the core above, run on up to two channels. */
export const AC_SPECTRAL_WORKLET = AC_SPECTRAL_CORE + String.raw`
class AcSpectral extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'freeze', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'amount', defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: -50, minValue: -140, maxValue: 0, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.st = []; }
  process(inputs, outputs, params) {
    const inp = inputs[0] || [], out = outputs[0];
    const o = { mode: Math.round(params.mode[0]), freeze: params.freeze[0] > 0.5, amount: params.amount[0], threshold: params.threshold[0], mix: params.mix[0] };
    for (let c = 0; c < out.length; c++) {
      if (!this.st[c]) this.st[c] = acStftNew(1024, 256);
      acStftProcess(this.st[c], inp[c] || inp[0] || null, out[c], o);
    }
    return true;
  }
}
registerProcessor('ac-spectral', AcSpectral);`;

const acWorklets = new WeakMap();
/** Load the Spectral worklet into a context once (resolves false where AudioWorklet or Blob URLs aren't there). */
export function acLoadSpectral(ctx) {
  let p = acWorklets.get(ctx);
  if (p) return p;
  p = (async () => {
    try {
      if (!ctx.audioWorklet || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
      const url = URL.createObjectURL(new Blob([AC_SPECTRAL_WORKLET], { type: 'application/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      return true;
    } catch { return false; }
  })();
  acWorklets.set(ctx, p);
  return p;
}

// ── Building ─────────────────────────────────────────────────────────────────────────────────────────────────

function acSet(param, v, ctx) {
  if (!param || !Number.isFinite(v)) return;
  try { param.setTargetAtTime(v, ctx.currentTime, AC_TAU); } catch { param.value = v; }
}
const acOff = n => { try { n.disconnect(); } catch { /* gone */ } };

/**
 * The Web Audio nodes of one effect (spec: lib/audioTools engine's effectSpecOf): `input` takes the sound, `output`
 * hands it on, `probe` reads it (FFT 2048, no smoothing). A Resonator also has a `taps` analyser per resonator (its
 * ringing). `update(spec)` moves the numbers (smoothed) and rebuilds a bank whose size changed; `dispose()` lets go.
 */
export function acBuild(ctx, spec) {
  const input = ctx.createGain(), output = ctx.createGain(), probe = ctx.createAnalyser();
  probe.fftSize = AC_FFT; probe.smoothingTimeConstant = 0;
  output.connect(probe);
  const fx = { type: spec.type, ctx, input, output, probe, taps: [], makeup: 1, n: 0, ready: true, disposed: false, last: '', update: null, dispose: null };
  let parts = [];
  const sr = ctx.sampleRate;

  if (spec.type === 'audioFilter') {
    const bq = ctx.createBiquadFilter();
    input.connect(bq); bq.connect(output);
    parts = [bq];
    fx.update = s => {
      const type = AC_FILTER_TYPES.includes(s.filterType) ? s.filterType : 'lowpass';
      if (bq.type !== type) bq.type = type;
      acSet(bq.frequency, Math.max(10, Math.min(sr / 2, s.frequency)), ctx);
      acSet(bq.Q, type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(Math.max(1e-4, s.q)) : Math.max(1e-4, s.q), ctx);
      acSet(bq.gain, s.gain, ctx);
    };
  } else if (spec.type === 'audioResonator') {
    const dry = ctx.createGain(), wet = ctx.createGain(), sum = ctx.createGain();
    input.connect(dry); dry.connect(output); sum.connect(wet); wet.connect(output);
    let bank = [];
    const make = n => {
      for (const b of bank) { acOff(b.bp); acOff(b.g); }
      bank = [];
      fx.taps = [];
      for (let k = 0; k < n; k++) {
        const bp = ctx.createBiquadFilter(), g = ctx.createGain(), tap = ctx.createAnalyser();
        bp.type = 'bandpass'; tap.fftSize = 512; tap.smoothingTimeConstant = 0;
        input.connect(bp); bp.connect(g); g.connect(sum); bp.connect(tap);
        bank.push({ bp, g, tap });
        fx.taps.push(tap);
      }
      fx.n = n;
    };
    parts = [dry, wet, sum];
    fx.update = s => {
      const n = Math.max(1, Math.min(AC_MAX_RESONATORS, Math.round(s.count)));
      if (n !== fx.n) make(n);
      const b = acBankOf(s, sr);
      fx.makeup = b.makeup;
      for (let k = 0; k < n; k++) {
        acSet(bank[k].bp.frequency, b.hz[k], ctx);
        acSet(bank[k].bp.Q, b.q[k], ctx);
        acSet(bank[k].g.gain, b.gains[k], ctx);
      }
      const mix = Math.max(0, Math.min(1, s.mix));
      acSet(dry.gain, 1 - mix, ctx);
      acSet(wet.gain, mix * b.makeup, ctx);
    };
    const disposeBank = () => { for (const b of bank) { acOff(b.bp); acOff(b.g); acOff(b.tap); } };
    parts.push({ disconnect: disposeBank });
  } else {
    // Spectral: straight through until the worklet is in, then through it.
    const bypass = ctx.createGain();
    input.connect(bypass); bypass.connect(output);
    let node = null, want = spec;
    fx.ready = false;
    const apply = s => {
      if (!node) return;
      const P = node.parameters;
      const mode = s.mode === 'blur' ? 1 : s.mode === 'gate' ? 2 : 0;
      try { P.get('mode').setValueAtTime(mode, ctx.currentTime); P.get('freeze').setValueAtTime(s.freeze ? 1 : 0, ctx.currentTime); } catch { /* gone */ }
      acSet(P.get('amount'), Math.max(0, Math.min(0.99, s.amount)), ctx);
      acSet(P.get('threshold'), s.threshold, ctx);
      acSet(P.get('mix'), Math.max(0, Math.min(1, s.mix)), ctx);
    };
    void acLoadSpectral(ctx).then(ok => {
      if (!ok || fx.disposed || typeof AudioWorkletNode === 'undefined') return;
      try { node = new AudioWorkletNode(ctx, 'ac-spectral', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }); } catch { return; }
      try { input.disconnect(bypass); } catch { /* gone */ }
      input.connect(node); node.connect(output);
      parts.push(node);
      fx.ready = true;
      apply(want);
    });
    parts = [bypass];
    fx.update = s => { want = s; apply(s); };
  }

  const upd = fx.update;
  fx.update = s => {
    const key = JSON.stringify(s);
    if (key === fx.last) return;
    fx.last = key;
    upd(s);
  };
  fx.dispose = () => {
    fx.disposed = true;
    for (const p of parts) acOff(p);
    acOff(input); acOff(output); acOff(probe);
  };
  fx.update(spec);
  return fx;
}

// ── Every frame ──────────────────────────────────────────────────────────────────────────────────────────────

/** The texture an effect fills: a Resonator's energies (one texel each), a Spectral's spectrum; none for a Filter. */
export function acTextureSize(spec) {
  if (spec.type === 'audioResonator') return { w: Math.max(1, Math.min(AC_MAX_RESONATORS, Math.round(spec.count))), h: 1 };
  if (spec.type === 'audioSpectral') return { w: AC_SPECTRAL_BINS, h: 1 };
  return { w: 0, h: 0 };
}

/** An effect's running numbers: Level, a bank's Energies and loudest, a texture row and its bytes. */
export function acNewRun(spec) {
  const { w, h } = acTextureSize(spec);
  const run = {
    level: 0, energies: new Float32Array(AC_MAX_RESONATORS), loudest: 0, peak: 0,
    row: new Float32Array(w), data: null, w, h, freq: new Float32Array(AC_FFT / 2).fill(-200), wave: new Float32Array(AC_FFT), tap: new Float32Array(512), sr: 48000,
  };
  if (w && h) { run.data = new Uint8Array(w * h * 4); for (let i = 3; i < run.data.length; i += 4) run.data[i] = 255; }
  return run;
}

/** Seconds a resonator's Energy takes to rise and to fall. */
export const AC_ENERGY_ATTACK = 0.01;
export const AC_ENERGY_RELEASE = 0.25;

/**
 * One frame of an effect (`fx` from acBuild, or null while it has none): reads its probe (silence when `active` is
 * false), writes its numbers by channel (`level`; a bank's `e0`…`e11`, `loudest`, `peak`) and fills `run.data`.
 * True when the texture changed.
 */
export function acStepEffect(run, fx, spec, active, dt, write) {
  const on = !!(active && fx);
  if (on) {
    fx.probe.getFloatFrequencyData(run.freq);
    fx.probe.getFloatTimeDomainData(run.wave);
    run.sr = fx.ctx.sampleRate;
  } else { run.freq.fill(-200); run.wave.fill(0); }
  run.level = atRmsLevel(run.wave);
  write('level', run.level);
  if (spec.type === 'audioResonator') {
    const n = Math.min(run.w, AC_MAX_RESONATORS);
    for (let k = 0; k < AC_MAX_RESONATORS; k++) {
      let target = 0;
      if (k < n && on && fx.taps[k]) {
        fx.taps[k].getFloatTimeDomainData(run.tap);
        let s = 0;
        for (let i = 0; i < run.tap.length; i++) s += run.tap[i] * run.tap[i];
        target = acEnergyUnit(Math.sqrt(s / run.tap.length));
      }
      run.energies[k] = k < n ? atFollow(run.energies[k], target, dt, AC_ENERGY_ATTACK, AC_ENERGY_RELEASE) : 0;
      write('e' + k, run.energies[k]);
    }
    run.loudest = acLoudest(run.energies, n);
    run.peak = run.energies[run.loudest];
    write('loudest', run.loudest);
    write('peak', run.peak);
    for (let k = 0; k < run.w; k++) run.row[k] = run.energies[k];
    if (run.data) atWriteRow(run.data, 0, run.row, run.w);
    return true;
  }
  if (spec.type === 'audioSpectral' && run.data) {
    atSpectrumBins(run.freq, run.sr, run.row, 'log', -90, -20, 0.3);
    atWriteRow(run.data, 0, run.row, run.w);
    return true;
  }
  return false;
}
