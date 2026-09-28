/**
 * granulator.js — the Audio engine's Granulator instrument (docs/granulator.md):
 * grains read from a sample, modelled on Ableton's Granulator III. Plain
 * JavaScript, so the app (lib/audioEngineHost.ts), offline renders
 * (lib/recordingAudio.ts) and website exports (runtime/play-runtime.js,
 * through the inlined kit as SSKit.granulator) make the same grains from the
 * same numbers. Every top-level name starts `gr`/`GR_` (the kit's files share
 * one scope in exports).
 *
 *   GR_PARAMS        every setting, with a fixed numeric address (the rack's
 *                    `au:<rack>:inst::<address>` targets, so each one is a
 *                    control and a mapping target): numbers, lists, toggles
 *   grMakeEngine()   the grain engine as a self-contained factory (no Web
 *                    Audio, no outside names): its source is also the
 *                    AudioWorklet's, so the worklet, the ScriptProcessor
 *                    fallback, renders and tests run one engine. Seeded
 *                    random numbers and sample-exact events: the same notes
 *                    at the same frames make the same samples, bit for bit
 *   grCreate(ctx)    a live granulator on a context: an AudioWorklet when it
 *                    loads (else a ScriptProcessor), notes at context times,
 *                    settings, and the grains' readouts (count, positions,
 *                    levels, pitches) posted back ~60 times a second
 *   grRender(o)      render notes offline with the pure engine (takes, tests)
 *   grSynthData      generated samples (a pad chord, a pluck, a vowel, a bell,
 *                    noise, a sine, and the drum pads' drums), so an example
 *                    needs no audio file
 */
import { dpSynthData, DP_SYNTHS } from './drumPads.js';

const GR_P = (addr, key, name, min, max, value, unit, extra) => Object.assign({ addr: addr, key: key, name: name, min: min, max: max, value: value, unit: unit || '', kind: 'number', step: 0, log: false, hint: '' }, extra || {});

/** Most grains alive at once (a Grain cap below it lowers it). */
export const GR_MAX_GRAINS = 64;
/** Most voices (notes sounding at once). */
export const GR_MAX_VOICES = 16;
export const GR_MODES = ['Classic', 'Flux', 'Cloud', 'Emit', 'Spectral'];
/** Which way Emit's (and Spectral's) travelling spawn points move. */
export const GR_DIRS = ['Forward', 'Backward', 'Both · alternate', 'Both · random'];
/** What a travelling spawn point does at the end of the sample (or of the spectrum). */
export const GR_EDGES = ['Wrap', 'Bounce', 'Respawn'];
/** Spectral's analysis window (the hop is a quarter of it). */
export const GR_FFT_SIZES = [1024, 2048, 4096];
export const GR_FILTERS = ['Off', 'Low-pass', 'High-pass', 'Band-pass', 'Notch'];
export const GR_WINDOWS = ['Hann', 'Triangle', 'Tukey', 'Rectangle'];

/**
 * Every setting. `addr` is its address for good (records and controls keep
 * it): never renumber, only add. Lists count from 0; toggles are 0 / 1.
 */
export const GR_PARAMS = [
  GR_P(0, 'mode', 'Mode', 0, 4, 0, '', { kind: 'list', step: 1, values: GR_MODES, hint: 'Classic: two overlapping grains per voice, a new one every half grain. Flux: a regular stream at Density with flickering levels. Cloud: grains at random moments, each at its own pitch and place. Emit: grains from spawn points that travel through the sample. Spectral: grains play frequency bands of the sample instead of time slices.' }),
  GR_P(1, 'position', 'Position', 0, 1, 0.3, '', { step: 0.001, hint: 'Where in the sample the grains read (0 = the start, 1 = the end). Click or drag the waveform.' }),
  GR_P(2, 'spray', 'Spray', 0, 2, 0.05, 's', { step: 0.001, hint: 'Each grain starts up to this far either side of Position, at random.' }),
  GR_P(3, 'size', 'Grain size', 2, 2000, 120, 'ms', { step: 1, log: true, hint: 'How long each grain lasts.' }),
  GR_P(4, 'sizeRand', 'Size random', 0, 1, 0, '', { step: 0.01, hint: 'Each grain’s length varies by up to this much of Grain size.' }),
  GR_P(5, 'density', 'Density', 1, 200, 20, '/s', { step: 0.1, log: true, hint: 'Grains a second in Flux and Cloud (Classic follows the grain size).' }),
  GR_P(6, 'pitch', 'Pitch', -48, 48, 0, 'st', { step: 0.01, hint: 'Semitones up or down, on top of the note played.' }),
  GR_P(7, 'spread', 'Spread', 0, 24, 0, 'st', { step: 0.01, hint: 'Classic and Flux: grains alternate left sharp, right flat by half this. Cloud: each grain’s pitch lands anywhere in this range.' }),
  GR_P(8, 'pitchRand', 'Pitch random', 0, 24, 0, 'st', { step: 0.01, hint: 'Each grain is up to this many semitones off, at random.' }),
  GR_P(9, 'panRand', 'Pan random', 0, 1, 0.3, '', { step: 0.01, hint: 'How far left or right each grain may land.' }),
  GR_P(10, 'levelRand', 'Level random', 0, 1, 0, '', { step: 0.01, hint: 'Each grain is quieter by up to this much. In Flux, some grains drop out altogether.' }),
  GR_P(11, 'reverse', 'Reverse', 0, 1, 0, '', { step: 0.01, hint: 'The chance a grain plays backwards (1: all of them).' }),
  GR_P(12, 'fmRate', 'FM rate', 0, 2000, 0, 'Hz', { step: 0.01, log: true, hint: 'How fast the grains’ pitch is swung (slow: vibrato; fast: sidebands).' }),
  GR_P(13, 'fmAmount', 'FM amount', 0, 24, 0, 'st', { step: 0.01, hint: 'How far the FM swings the pitch, in semitones.' }),
  GR_P(14, 'filter', 'Filter', 0, 4, 0, '', { kind: 'list', step: 1, values: GR_FILTERS, hint: 'A resonant filter on the granulator’s output.' }),
  GR_P(15, 'cutoff', 'Cutoff', 20, 20000, 6000, 'Hz', { step: 1, log: true, hint: 'Where the filter bites.' }),
  GR_P(16, 'resonance', 'Resonance', 0.5, 20, 0.71, 'Q', { step: 0.01, hint: 'A peak at the cutoff: 0.71 is flat.' }),
  GR_P(17, 'attack', 'Attack', 0, 10, 0.02, 's', { step: 0.001, hint: 'A note’s rise to full level.' }),
  GR_P(18, 'decay', 'Decay', 0, 10, 0.3, 's', { step: 0.001, hint: 'Its fall to Sustain.' }),
  GR_P(19, 'sustain', 'Sustain', 0, 1, 0.8, '', { step: 0.01, hint: 'The level held while the key is down.' }),
  GR_P(20, 'release', 'Release', 0, 20, 0.8, 's', { step: 0.001, hint: 'The fade once the key goes up.' }),
  GR_P(21, 'window', 'Grain window', 0, 3, 0, '', { kind: 'list', step: 1, values: GR_WINDOWS, hint: 'Each grain’s fade in and out: Hann is smooth, Rectangle keeps the edges (clicky), Tukey has a flat top.' }),
  GR_P(22, 'skew', 'Window skew', 0, 1, 0.5, '', { step: 0.01, hint: '0.5: symmetric. Lower: a sharp attack and a long tail (percussive). Higher: a slow rise and an abrupt end.' }),
  GR_P(23, 'scan', 'Scan', -4, 4, 0, '×', { step: 0.01, hint: 'The playhead moves through the sample from each note: 1 is the sample’s own speed (a time-stretch), negative goes backwards.' }),
  GR_P(24, 'lfoRate', 'Scan LFO rate', 0, 20, 0, 'Hz', { step: 0.01, hint: 'A sine that sways the position this many times a second.' }),
  GR_P(25, 'lfoDepth', 'Scan LFO depth', 0, 1, 0.2, '', { step: 0.01, hint: 'How far the LFO sways the position (1: the whole sample).' }),
  GR_P(26, 'freeze', 'Freeze', 0, 1, 0, '', { kind: 'toggle', step: 1, hint: 'Stops the playhead where it is: Scan and the LFO hold still.' }),
  GR_P(27, 'hold', 'Hold', 0, 1, 0, '', { kind: 'toggle', step: 1, hint: 'Notes keep sounding after their key goes up, until a new note starts with every key up.' }),
  GR_P(28, 'drone', 'Drone', 0, 1, 0, '', { kind: 'toggle', step: 1, hint: 'A voice at the root note plays without any key: the granulator sounds on its own.' }),
  GR_P(29, 'cap', 'Grain cap', 1, 64, 64, '', { step: 1, hint: 'Most grains alive at once; a grain that would go over is skipped.' }),
  GR_P(30, 'voices', 'Voices', 1, 16, 8, '', { step: 1, hint: 'Notes at once (the oldest is let go for a new one).' }),
  GR_P(31, 'root', 'Root note', 0, 127, 60, '', { step: 1, hint: 'The key where the sample plays at its own pitch.' }),
  GR_P(32, 'velocity', 'Velocity', 0, 1, 1, '', { step: 0.01, hint: 'How much a note’s velocity sets its level: 0 plays every note the same.' }),
  GR_P(33, 'level', 'Level', 0, 2, 0.8, '', { step: 0.01, hint: 'The granulator’s output level.' }),
  GR_P(34, 'seed', 'Seed', 0, 9999, 1, '', { step: 1, hint: 'The random numbers’ seed: the same seed and notes make the same grains.' }),
  GR_P(35, 'fromRate', 'Grains per thing', 0.1, 60, 6, '/s', { step: 0.1, log: true, hint: 'Grains from a layer: each thing inside makes this many grains a second while it stays, so more things make more grains.' }),
  GR_P(36, 'emitDir', 'Direction', 0, 3, 0, '', { kind: 'list', step: 1, values: GR_DIRS, hint: 'Emit: which way the spawn points travel through the sample. Both: alternate spawn points go opposite ways, or each picks a way at random.' }),
  GR_P(37, 'emitSpeed', 'Travel speed', 0, 4, 0.2, '×/s', { step: 0.001, hint: 'Emit: how fast each spawn point moves along the sample, in sample lengths a second (0: they stay put).' }),
  GR_P(38, 'emitSpread', 'Emit spread', 0, 1, 0.1, '', { step: 0.001, hint: 'Emit: how far apart the spawn points start. 0: every grain shoots from Position in one line; 1: spawn points scattered over the whole sample.' }),
  GR_P(39, 'emitEdge', 'At the end', 0, 2, 0, '', { kind: 'list', step: 1, values: GR_EDGES, hint: 'Emit: when a spawn point reaches an end of the sample it wraps to the other end, bounces back, or jumps somewhere new (seeded).' }),
  GR_P(40, 'band', 'Band', 0, 1, 0.35, '', { step: 0.001, hint: 'Spectral: the centre of the frequencies each grain plays, over the spectrum on a log scale (0: 20 Hz, 1: the top).' }),
  GR_P(41, 'bandWidth', 'Band width', 0.01, 1, 0.12, '', { step: 0.001, hint: 'Spectral: how wide each grain’s band is, as a part of the spectrum.' }),
  GR_P(42, 'bandSpread', 'Band spread', 0, 1, 0.1, '', { step: 0.001, hint: 'Spectral: how far apart the grains’ bands are around Band (their spawn points on the frequency axis).' }),
  GR_P(43, 'bandSpeed', 'Band travel', 0, 4, 0, '×/s', { step: 0.001, hint: 'Spectral: how fast the bands travel along the spectrum, in spectrum lengths a second (0: they stay put).' }),
  GR_P(44, 'bandDir', 'Band direction', 0, 3, 0, '', { kind: 'list', step: 1, values: GR_DIRS, hint: 'Spectral: which way the bands travel (up is Forward).' }),
  GR_P(45, 'bandEdge', 'Band at the end', 0, 2, 1, '', { kind: 'list', step: 1, values: GR_EDGES, hint: 'Spectral: when a travelling band reaches the bottom or top of the spectrum it wraps, bounces back, or jumps somewhere new.' }),
  GR_P(46, 'shift', 'Shift', -2000, 2000, 0, 'Hz', { step: 1, hint: 'Spectral: moves every frequency of a grain up or down by this many hertz (inharmonic, unlike Pitch, which multiplies).' }),
  GR_P(47, 'partials', 'Partials', 1, 16, 8, '', { step: 1, hint: 'Spectral: how many of the band’s strongest peaks each grain plays back as sines.' }),
  GR_P(48, 'fftSize', 'Analysis window', 0, 2, 1, '', { kind: 'list', step: 1, values: GR_FFT_SIZES.map(String), hint: 'Spectral: the analysis window in samples (hop a quarter of it). Larger: finer frequencies, blurrier in time.' }),
];
export const GR_KEYS = GR_PARAMS.map(p => p.key);

/** A setting by key or address. */
export function grParam(k) {
  for (const p of GR_PARAMS) if (p.key === k || String(p.addr) === String(k)) return p;
  return null;
}

/** Every setting's default, by key. */
export function grDefaults() {
  const o = {};
  for (const p of GR_PARAMS) o[p.key] = p.value;
  return o;
}

/** Settings by key from the record's `params` (address → value), clamped, defaults for the rest. */
export function grSettings(params, valueOf) {
  const o = {};
  for (const p of GR_PARAMS) {
    const a = String(p.addr);
    let v = params && typeof params[a] === 'number' && isFinite(params[a]) ? params[a] : p.value;
    if (valueOf) { const d = valueOf(a, v); if (typeof d === 'number' && isFinite(d)) v = d; }
    v = Math.max(p.min, Math.min(p.max, v));
    if (p.kind !== 'number' || p.step === 1) v = Math.round(v);
    o[p.key] = v;
  }
  return o;
}

// ── The engine ──────────────────────────────────────────────────────────────

/**
 * The grain engine's factory. Self-contained on purpose: its source text is
 * put in the AudioWorklet module as it is (no outside names, no class fields,
 * nothing a bundler adds helpers for). Returns create(sampleRate, seed):
 *
 *   e.setBuffer(channels, rate)   the sample (1 or 2 Float32Arrays) at its rate
 *   e.set(settings)               settings by key (grSettings), any subset
 *   e.noteOn(note, vel, frame)    vel 0..1; frame: when (the engine's frame count)
 *   e.noteOff(note, frame) · e.allOff(frame) · e.bend(semitones, frame)
 *   e.process(left, right, n)     the next n frames (added to nothing: written)
 *   e.sync(frame)                 where the engine's frame count is now (the worklet's currentFrame)
 *   e.stats(o)                    fill o: count, maxCount, pos/amp/pitch per live grain
 *   e.reset(seed)                 silence, a fresh random sequence
 */
export function grMakeEngine() {
  var MAXG = 64, MAXV = 24;
  function mulberry(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function windowAt(kind, x, skew) {
    var s = skew < 0.02 ? 0.02 : skew > 0.98 ? 0.98 : skew;
    var u = x < s ? 0.5 * x / s : 0.5 + 0.5 * (x - s) / (1 - s);
    if (kind === 1) return 1 - Math.abs(2 * u - 1);
    if (kind === 2) return u < 0.25 ? 0.5 - 0.5 * Math.cos(Math.PI * u / 0.25) : u > 0.75 ? 0.5 - 0.5 * Math.cos(Math.PI * (1 - u) / 0.25) : 1;
    if (kind === 3) return Math.min(1, u * 64, (1 - u) * 64);
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
  }
  // ── Spectral: a sine table, an FFT, and the analysis (peaks per STFT frame) ──
  var TBL = 4096, SINE = new Float32Array(TBL + 1);
  for (var ti = 0; ti <= TBL; ti++) SINE[ti] = Math.sin(2 * Math.PI * ti / TBL);
  var HEADS = 8, PEAKS = 48, MAXFRAMES = 1024, FMIN = 20;
  /** In-place radix-2 FFT of re/im (length a power of two). */
  function fft(re, im, n) {
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var tm = im[i]; im[i] = im[j]; im[j] = tm; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (var k = 0; k < n; k += len) {
        var cr = 1, ci = 0;
        for (var m = 0; m < half; m++) {
          var a = k + m, b = a + half;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  /**
   * The sample's spectrogram, as the strongest peaks of each frame: a Hann
   * window of `size` samples every size/4 (longer hops past 1024 frames),
   * up to 48 peaks a frame, strongest first, each at a fractional bin
   * (parabolic on the log magnitude) with its sine amplitude. Pure: the same
   * sample gives the same numbers.
   */
  function analyse(chans, size) {
    var N = size === 1024 || size === 4096 ? size : 2048, L = chans && chans[0], R = chans && (chans[1] || chans[0]);
    var len = L ? L.length : 0;
    var hop = N / 4, frames = Math.max(1, Math.ceil(len / hop));
    if (frames > MAXFRAMES) { hop = Math.ceil(len / MAXFRAMES); frames = Math.max(1, Math.ceil(len / hop)); }
    var win = new Float64Array(N), wsum = 0;
    for (var i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); wsum += win[i]; }
    var re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(N / 2 + 1);
    var bins = new Float32Array(frames * PEAKS), amps = new Float32Array(frames * PEAKS), count = new Uint8Array(frames), energy = new Float32Array(frames);
    var pb = new Float64Array(PEAKS), pa = new Float64Array(PEAKS);
    for (var f = 0; f < frames; f++) {
      var at = f * hop - N / 2;
      for (var s = 0; s < N; s++) {
        var x = at + s;
        re[s] = x >= 0 && x < len ? 0.5 * (L[x] + R[x]) * win[s] : 0;
        im[s] = 0;
      }
      fft(re, im, N);
      var e2 = 0;
      for (var b = 0; b <= N / 2; b++) { mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]); e2 += mag[b] * mag[b]; }
      energy[f] = Math.sqrt(e2) * 2 / wsum;
      var n = 0;
      for (var q = 2; q < N / 2 - 1; q++) {
        var m0 = mag[q];
        if (!(m0 > mag[q - 1] && m0 >= mag[q + 1])) continue;
        var amp = m0 * 2 / wsum;
        if (amp < 1e-5) continue;
        var la = Math.log(mag[q - 1] + 1e-12), lb = Math.log(m0 + 1e-12), lc = Math.log(mag[q + 1] + 1e-12), den = la - 2 * lb + lc;
        var off = den < 0 ? 0.5 * (la - lc) / den : 0;
        if (off > 0.5) off = 0.5; else if (off < -0.5) off = -0.5;
        amp = Math.exp(lb - 0.25 * (la - lc) * off) * 2 / wsum;
        // Keep the strongest, in order.
        var k2;
        if (n < PEAKS) { k2 = n; n++; } else { if (amp <= pa[PEAKS - 1]) continue; k2 = PEAKS - 1; }
        while (k2 > 0 && pa[k2 - 1] < amp) { pa[k2] = pa[k2 - 1]; pb[k2] = pb[k2 - 1]; k2--; }
        pa[k2] = amp; pb[k2] = q + off;
      }
      count[f] = n;
      for (var c = 0; c < n; c++) { bins[f * PEAKS + c] = pb[c]; amps[f * PEAKS + c] = pa[c]; }
    }
    return { size: N, hop: hop, frames: frames, peaks: PEAKS, len: len, bins: bins, amps: amps, count: count, energy: energy };
  }
  /** Where 0..1 on the spectral axis is, in Hz (log, 20 Hz up to half the sample's rate). */
  function bandHz(u, nyq) { return FMIN * Math.pow(Math.max(FMIN * 1.01, nyq) / FMIN, u); }
  // ── Travelling spawn points (Emit, and Spectral's bands) ──
  function newHeads() { return { ok: false, u: new Float64Array(HEADS), t: new Float64Array(HEADS), d: new Float64Array(HEADS), r: new Float64Array(HEADS), dir: -1, next: 0 }; }
  function dirOf(mode, i, r) { return mode === 1 ? -1 : mode === 2 ? (i % 2 ? -1 : 1) : mode === 3 ? (r < 0.5 ? -1 : 1) : 1; }
  /** Spawn points spaced evenly over [-0.5, 0.5] (times the spread when used), a little seeded jitter each, travelling their way. */
  function headsInit(h, dirMode, rnd) {
    for (var i = 0; i < HEADS; i++) {
      var r1 = rnd(), r2 = rnd();
      h.u[i] = (i + 0.5) / HEADS - 0.5 + (r1 - 0.5) / HEADS;
      h.t[i] = 0; h.r[i] = r2; h.d[i] = dirOf(dirMode, i, r2);
    }
    h.dir = dirMode; h.next = 0; h.ok = true;
  }
  /**
   * Move every spawn point `inc` along the axis (0..1): at an end it wraps to
   * the other (edge 0), bounces back (1), or jumps to a seeded random place (2).
   */
  function headsStep(h, origin, spread, inc, edge, dirMode, rnd) {
    if (h.dir !== dirMode) { for (var j = 0; j < HEADS; j++) h.d[j] = dirOf(dirMode, j, h.r[j]); h.dir = dirMode; }
    for (var i = 0; i < HEADS; i++) {
      h.t[i] += h.d[i] * inc;
      var base = origin + spread * h.u[i], a = base + h.t[i];
      if (a >= 0 && a < 1) continue;
      if (edge === 1) { if (a >= 1) h.t[i] -= 2 * (a - 1); else h.t[i] -= 2 * a; h.d[i] = -h.d[i]; }
      else if (edge === 2) h.t[i] = rnd() - base;
      a = base + h.t[i];
      if (a < 0 || a >= 1) h.t[i] -= Math.floor(a);
    }
  }
  function headAt(h, origin, spread, i) { var a = origin + spread * h.u[i] + h.t[i]; return a - Math.floor(a); }
  function create(sampleRate, seed, opts) {
    var sr = sampleRate > 0 ? sampleRate : 48000;
    var P = {
      mode: 0, position: 0.3, spray: 0.05, size: 120, sizeRand: 0, density: 20, pitch: 0, spread: 0, pitchRand: 0, panRand: 0.3, levelRand: 0, reverse: 0,
      fmRate: 0, fmAmount: 0, filter: 0, cutoff: 6000, resonance: 0.71, attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.8, window: 0, skew: 0.5,
      scan: 0, lfoRate: 0, lfoDepth: 0.2, freeze: 0, hold: 0, drone: 0, cap: 64, voices: 8, root: 60, velocity: 1, level: 0.8, seed: 1, fromRate: 6,
      emitDir: 0, emitSpeed: 0.2, emitSpread: 0.1, emitEdge: 0, band: 0.35, bandWidth: 0.12, bandSpread: 0.1, bandSpeed: 0, bandDir: 0, bandEdge: 1, shift: 0, partials: 8, fftSize: 1,
    };
    // Spectral: the analysis (made here when needed unless opts.autoSpectrum === false: the worklet gets it from the main thread).
    var autoSpec = !(opts && opts.autoSpectrum === false), spec = null, bufRate = sr;
    var rnd = mulberry(seed || 1), seedNow = seed || 1;
    var bufL = null, bufR = null, bufLen = 0, ratio = 1, bufDur = 0;
    var frame = 0, events = [], held = {}, bend = 0, fmPhase = 0, lfoPhase = 0, seq = 0, maxCount = 0, voiceSeq = 0;
    var gainS = P.level, cutS = P.cutoff, fc = { g: 0, k: 0, a1: 0, a2: 0, a3: 0 }, ic1L = 0, ic2L = 0, ic1R = 0, ic2R = 0, coefAt = -1;
    var voices = [];
    for (var vi = 0; vi < MAXV; vi++) voices.push({ on: false, note: 60, vel: 1, stage: 0, level: 0, rate: 0, relRate: 0, scan: 0, wait: 0, alt: false, drone: false, latched: false, keyUp: false, order: 0, eh: newHeads(), sh: newHeads(), origin: 0 });
    // The things a layer drives grains from (points()): their grains hang on this voice, always at full level.
    voices.push({ on: false, note: 60, vel: 1, stage: 2, level: 1, rate: 0, relRate: 0, scan: 0, wait: 0, alt: false, drone: false, latched: false, keyUp: false, order: 0, eh: newHeads(), sh: newHeads(), origin: 0 });
    var pts = [], ptCutoff = NaN;
    var grains = [];
    for (var gi = 0; gi < MAXG; gi++) grains.push({ on: false, v: 0, pos: 0, rate: 1, len: 1, age: 0, amp: 0, gl: 0, gr: 0, semis: 0, band: 0, energy: 0, np: 0, pinc: new Float64Array(16), pamp: new Float64Array(16), pph: new Float64Array(16) });
    var live = 0;

    function wrap(x) { return x - Math.floor(x); }
    function sample(buf, p) {
      var i = Math.floor(p), f = p - i;
      i = ((i % bufLen) + bufLen) % bufLen;
      var j = i + 1 >= bufLen ? 0 : i + 1;
      return buf[i] + (buf[j] - buf[i]) * f;
    }
    function envRates(v) {
      v.rate = P.attack > 0 ? 1 / (P.attack * sr) : 1;
    }
    function startVoice(note, vel, drone) {
      var active = 0, oldest = -1, oldestOrder = Infinity, free = -1;
      for (var i = 0; i < MAXV; i++) {
        var v = voices[i];
        if (!v.on) { if (free < 0) free = i; continue; }
        if (v.stage === 3 && v.relFast) continue;
        active++;
        if (!v.drone && v.order < oldestOrder) { oldestOrder = v.order; oldest = i; }
      }
      if (active >= Math.max(1, Math.round(P.voices)) && oldest >= 0) releaseVoice(voices[oldest], 0.005);
      if (free < 0) { // every slot taken: reuse the quietest releasing one
        var q = Infinity;
        for (var k = 0; k < MAXV; k++) if (voices[k].stage === 3 && voices[k].level < q) { q = voices[k].level; free = k; }
        if (free < 0) free = oldest >= 0 ? oldest : 0;
        killGrains(free);
      }
      var w = voices[free];
      w.on = true; w.note = note; w.vel = vel; w.stage = 0; w.level = 0; w.scan = 0; w.wait = 0; w.alt = false; w.drone = !!drone; w.latched = false; w.keyUp = false; w.relFast = false; w.order = ++voiceSeq;
      w.eh.ok = false; w.sh.ok = false;
      envRates(w);
    }
    function releaseVoice(v, secs) {
      if (!v.on || v.stage === 3) return;
      v.stage = 3;
      var r = secs !== undefined ? secs : P.release;
      v.relFast = secs !== undefined;
      v.relRate = r > 0 ? v.level / (r * sr) : v.level + 1;
      if (v.relRate <= 0) v.relRate = 1e-9;
    }
    function killGrains(vIndex) {
      for (var i = 0; i < MAXG; i++) if (grains[i].on && grains[i].v === vIndex) { grains[i].on = false; live--; }
    }
    function applyEvent(ev) {
      if (ev.t === 1) {
        // A new note with every key up releases what Hold latched.
        if (P.hold) {
          var anyHeld = false;
          for (var n in held) if (held[n]) { anyHeld = true; break; }
          if (!anyHeld) for (var i = 0; i < MAXV; i++) if (voices[i].on && voices[i].latched) releaseVoice(voices[i]);
        }
        held[ev.note] = true;
        startVoice(ev.note, ev.vel, false);
      } else if (ev.t === 2) {
        held[ev.note] = false;
        for (var j = 0; j < MAXV; j++) {
          var v = voices[j];
          if (!v.on || v.drone || v.note !== ev.note || v.stage === 3 || v.keyUp) continue;
          v.keyUp = true;
          if (P.hold) v.latched = true; else releaseVoice(v);
        }
      } else if (ev.t === 3) {
        held = {};
        for (var k = 0; k < MAXV; k++) if (voices[k].on && !voices[k].drone) releaseVoice(voices[k], 0.005);
      } else if (ev.t === 4) {
        bend = ev.value;
      }
    }
    function push(ev) {
      ev.s = seq++;
      var i = events.length;
      while (i > 0 && (events[i - 1].frame > ev.frame)) i--;
      events.splice(i, 0, ev);
    }
    function GR_FFT(i) { i = i | 0; return i <= 0 ? 1024 : i >= 2 ? 4096 : 2048; }
    /** Fill a grain with frame `fr`'s strongest peaks inside the band around `u` (up to Partials), shifted and pitched; false when none. */
    function pickPartials(g, fr, u, semis) {
      var nyq = bufRate / 2, w = P.bandWidth / 2;
      var lo = bandHz(Math.max(0, u - w), nyq) * spec.size / bufRate, hi = bandHz(Math.min(1, u + w), nyq) * spec.size / bufRate;
      var want = Math.max(1, Math.min(16, Math.round(P.partials))), mul = Math.pow(2, semis / 12), n = 0, e2 = 0;
      var o = fr * spec.peaks, c = spec.count[fr];
      for (var j = 0; j < c && n < want; j++) {
        var b = spec.bins[o + j];
        if (b < lo || b > hi) continue;
        var hz = b * bufRate / spec.size * mul + P.shift;
        if (!(hz > 0 && hz < sr * 0.49)) continue;
        var a = spec.amps[o + j];
        g.pinc[n] = hz / sr; g.pamp[n] = a;
        // A fixed start phase from the peak's place: no random numbers, so the sequence never shifts.
        var ph = (b * 0.6180339887 + fr * 0.1234567) % 1; g.pph[n] = ph < 0 ? ph + 1 : ph;
        e2 += a * a; n++;
      }
      g.np = n; g.energy = Math.sqrt(e2);
      return n > 0;
    }
    function spawn(vIndex, v) {
      var cap = Math.max(1, Math.min(MAXG, Math.round(P.cap)));
      var mode = P.mode | 0;
      var baseLen = Math.max(2, P.size) * 0.001 * sr;
      // When the next grain comes.
      if (mode === 0) v.wait = Math.max(1, baseLen / 2);
      else if (mode === 2) v.wait = Math.max(1, -Math.log(1 - rnd() * 0.999999) * sr / Math.max(0.01, P.density));
      else v.wait = Math.max(1, sr / Math.max(0.01, P.density));
      if (mode === 3 && !v.eh.ok) headsInit(v.eh, P.emitDir | 0, rnd);
      if (mode === 4 && !v.sh.ok) headsInit(v.sh, P.bandDir | 0, rnd);
      // Always draw the same numbers, grain or not, so a cap never shifts the random sequence.
      var rSpray = rnd(), rSize = rnd(), rPitch = rnd(), rSpread = rnd(), rPan = rnd(), rLevel = rnd(), rRev = rnd(), rMute = rnd();
      v.alt = !v.alt;
      if (!bufLen || live >= cap) return;
      var slot = -1;
      for (var i = 0; i < MAXG; i++) if (!grains[i].on) { slot = i; break; }
      if (slot < 0) return;
      var len = Math.max(2, Math.round(baseLen * (1 + P.sizeRand * (rSize * 2 - 1))));
      var lfo = P.lfoDepth * 0.5 * Math.sin(2 * Math.PI * lfoPhase);
      var centre = wrap(P.position + v.scan + lfo);
      // Emit: the grain leaves from the next travelling spawn point.
      if (mode === 3) { centre = headAt(v.eh, v.origin, P.emitSpread, v.eh.next); v.eh.next = (v.eh.next + 1) % HEADS; }
      var start = centre * bufLen + (rSpray * 2 - 1) * P.spray * (bufLen / Math.max(1e-9, bufDur));
      var spreadSemis, pan;
      if (mode === 2) { spreadSemis = (rSpread * 2 - 1) * P.spread / 2; pan = (rPan * 2 - 1) * Math.max(P.panRand, P.spread > 0 ? 0.6 : 0); }
      else { spreadSemis = (v.alt ? 1 : -1) * P.spread / 2; pan = (P.spread > 0 ? (v.alt ? -0.6 : 0.6) : 0) + (rPan * 2 - 1) * P.panRand; }
      if (pan < -1) pan = -1; else if (pan > 1) pan = 1;
      var semis = (v.note - P.root) + P.pitch + bend + spreadSemis + (rPitch * 2 - 1) * P.pitchRand;
      var rate = Math.pow(2, semis / 12) * ratio;
      var amp = 1 - P.levelRand * rLevel;
      if (mode === 1 && rMute < P.levelRand * 0.5) amp = 0;
      // Keep the sum near one grain's level however many overlap.
      var overlap = mode === 0 ? 2 : Math.max(1, P.density * len / sr);
      amp *= (mode === 0 ? 1 : 1 / Math.sqrt(overlap)) * (1 - P.velocity + P.velocity * v.vel);
      var g = grains[slot];
      g.np = 0; g.band = 0; g.energy = 0;
      if (mode === 4) {
        // Spectral: the band's strongest peaks at this moment of the sample, played back as sines.
        if (!spec || spec.size !== GR_FFT(P.fftSize) || spec.len !== bufLen) { if (!autoSpec) return; spec = analyse([bufL, bufR], GR_FFT(P.fftSize)); }
        var k = v.sh.next; v.sh.next = (k + 1) % HEADS;
        var u = headAt(v.sh, P.band, P.bandSpread, k) + (rSpread * 2 - 1) * P.bandSpread / HEADS / 2;
        if (u < 0) u = 0; else if (u > 1) u = 1;
        var fr = Math.floor(wrap(start / bufLen) * spec.frames) % spec.frames;
        if (!pickPartials(g, fr, u, semis, v.origin)) return;
        g.band = u;
      }
      g.on = true; g.v = vIndex; g.len = len; g.age = 0; g.amp = amp; g.semis = semis;
      if (rRev < P.reverse) { g.rate = -rate; g.pos = start + len * rate; } else { g.rate = rate; g.pos = start; }
      if (mode === 4) { g.rate = 0; g.pos = start; }
      g.gl = Math.cos((pan + 1) * Math.PI / 4); g.gr = Math.sin((pan + 1) * Math.PI / 4);
      live++;
      if (live > maxCount) maxCount = live;
    }
    // A grain for one thing: its place, pitch, size, level, pan and spray instead of the voice's.
    function spawnPoint(pt) {
      var cap = Math.max(1, Math.min(MAXG, Math.round(P.cap)));
      var mode = P.mode | 0, rate0 = Math.max(0.01, P.fromRate);
      pt.wait = mode === 2 ? Math.max(1, -Math.log(1 - rnd() * 0.999999) * sr / rate0) : Math.max(1, sr / rate0);
      var rSpray = rnd(), rSize = rnd(), rPitch = rnd(), rSpread = rnd(), rPan = rnd(), rLevel = rnd(), rRev = rnd();
      if (!bufLen || live >= cap) return;
      var slot = -1;
      for (var i = 0; i < MAXG; i++) if (!grains[i].on) { slot = i; break; }
      if (slot < 0) return;
      var len = Math.max(2, Math.round(Math.max(2, pt.size) * 0.001 * sr * (1 + P.sizeRand * (rSize * 2 - 1))));
      var start = wrap(pt.pos) * bufLen + (rSpray * 2 - 1) * pt.spray * (bufLen / Math.max(1e-9, bufDur));
      var spreadSemis = mode === 2 ? (rSpread * 2 - 1) * P.spread / 2 : 0;
      var semis = P.pitch + pt.pitch + bend + spreadSemis + (rPitch * 2 - 1) * P.pitchRand;
      var rate = Math.pow(2, semis / 12) * ratio;
      var pan = pt.pan + (rPan * 2 - 1) * P.panRand;
      if (pan < -1) pan = -1; else if (pan > 1) pan = 1;
      var overlap = Math.max(1, rate0 * pts.length * len / sr);
      var g = grains[slot];
      g.on = true; g.v = MAXV; g.len = len; g.age = 0; g.semis = semis; g.np = 0; g.band = 0; g.energy = 0;
      g.amp = Math.max(0, pt.amp) * (1 - P.levelRand * rLevel) / Math.sqrt(overlap);
      if (rRev < P.reverse) { g.rate = -rate; g.pos = start + len * rate; } else { g.rate = rate; g.pos = start; }
      g.gl = Math.cos((pan + 1) * Math.PI / 4); g.gr = Math.sin((pan + 1) * Math.PI / 4);
      live++;
      if (live > maxCount) maxCount = live;
    }
    function coefs() {
      var c = cutS < 20 ? 20 : cutS > sr * 0.45 ? sr * 0.45 : cutS;
      fc.g = Math.tan(Math.PI * c / sr); fc.k = 1 / Math.max(0.1, P.resonance);
      fc.a1 = 1 / (1 + fc.g * (fc.g + fc.k)); fc.a2 = fc.g * fc.a1; fc.a3 = fc.g * fc.a2;
    }
    function droneCheck() {
      var has = -1;
      for (var i = 0; i < MAXV; i++) if (voices[i].on && voices[i].drone && voices[i].stage !== 3) has = i;
      if (P.drone && has < 0) startVoice(Math.round(P.root), 1, true);
      else if (!P.drone && has >= 0) releaseVoice(voices[has]);
    }
    function run(L, R, from, to) {
      var smooth = 1 - Math.exp(-1 / (0.01 * sr));
      var win = P.window | 0, skew = P.skew, filter = P.filter | 0, freeze = !!P.freeze;
      var fmInc = P.fmRate / sr, fmDepth = P.fmAmount / 12, lfoInc = P.lfoRate / sr;
      var scanInc = bufDur > 0 ? P.scan / bufDur / sr : 0;
      var mode = P.mode | 0, emitInc = P.emitSpeed / sr, bandInc = P.bandSpeed / sr, emitEdge = P.emitEdge | 0, emitDir = P.emitDir | 0, bandEdge = P.bandEdge | 0, bandDir = P.bandDir | 0;
      for (var n = from; n < to; n++) {
        gainS += (P.level - gainS) * smooth;
        cutS += ((ptCutoff === ptCutoff ? ptCutoff : P.cutoff) - cutS) * smooth;
        if (!freeze) lfoPhase = wrap(lfoPhase + lfoInc);
        var fm = 1;
        if (fmDepth > 0 && fmInc > 0) { fmPhase = wrap(fmPhase + fmInc); fm = Math.pow(2, fmDepth * Math.sin(2 * Math.PI * fmPhase)); }
        for (var vi = 0; vi < MAXV; vi++) {
          var v = voices[vi];
          if (!v.on) continue;
          if (v.stage === 0) { v.level += v.rate; if (v.level >= 1) { v.level = 1; v.stage = 1; } }
          else if (v.stage === 1) {
            var d = P.decay > 0 ? (1 - P.sustain) / (P.decay * sr) : 1;
            v.level -= d;
            if (v.level <= P.sustain) { v.level = P.sustain; v.stage = 2; }
          } else if (v.stage === 2) v.level = P.sustain;
          else { v.level -= v.relRate; if (v.level <= 0) { v.level = 0; v.on = false; killGrains(vi); continue; } }
          if (!freeze) v.scan += scanInc;
          if (mode === 3) {
            v.origin = wrap(P.position + v.scan + P.lfoDepth * 0.5 * Math.sin(2 * Math.PI * lfoPhase));
            if (v.eh.ok && !freeze) headsStep(v.eh, v.origin, P.emitSpread, emitInc, emitEdge, emitDir, rnd);
          } else if (mode === 4 && v.sh.ok && !freeze) headsStep(v.sh, P.band, P.bandSpread, bandInc, bandEdge, bandDir, rnd);
          v.wait -= 1;
          if (v.wait <= 0 && v.stage !== 3) spawn(vi, v);
        }
        for (var pi = 0; pi < pts.length; pi++) { var pt = pts[pi]; pt.wait -= 1; if (pt.wait <= 0) spawnPoint(pt); }
        var l = 0, r = 0;
        if (live > 0) {
          for (var gi = 0; gi < MAXG; gi++) {
            var g = grains[gi];
            if (!g.on) continue;
            var w = windowAt(win, g.age / g.len, skew) * g.amp * voices[g.v].level;
            if (g.np) {
              // A spectral grain: its partials from the sine table.
              var sv = 0;
              for (var q = 0; q < g.np; q++) {
                var ph = g.pph[q], x = ph * TBL, i0 = x | 0;
                sv += g.pamp[q] * (SINE[i0] + (SINE[i0 + 1] - SINE[i0]) * (x - i0));
                ph += g.pinc[q] * fm;
                g.pph[q] = ph - Math.floor(ph);
              }
              if (w !== 0) { l += sv * w * g.gl; r += sv * w * g.gr; }
            } else if (w !== 0) {
              l += sample(bufL, g.pos) * w * g.gl;
              r += sample(bufR, g.pos) * w * g.gr;
            }
            g.pos += g.rate * fm;
            if (++g.age >= g.len) { g.on = false; live--; }
          }
        }
        l *= gainS; r *= gainS;
        if (filter > 0) {
          if (n - coefAt >= 16 || n < coefAt) { coefs(); coefAt = n; }
          var v3 = l - ic2L, v1 = fc.a1 * ic1L + fc.a2 * v3, v2 = ic2L + fc.a2 * ic1L + fc.a3 * v3;
          ic1L = 2 * v1 - ic1L; ic2L = 2 * v2 - ic2L;
          l = filter === 1 ? v2 : filter === 2 ? l - fc.k * v1 - v2 : filter === 3 ? v1 : l - fc.k * v1;
          v3 = r - ic2R; v1 = fc.a1 * ic1R + fc.a2 * v3; v2 = ic2R + fc.a2 * ic1R + fc.a3 * v3;
          ic1R = 2 * v1 - ic1R; ic2R = 2 * v2 - ic2R;
          r = filter === 1 ? v2 : filter === 2 ? r - fc.k * v1 - v2 : filter === 3 ? v1 : r - fc.k * v1;
        }
        L[n] = l; R[n] = r;
      }
    }
    var e = {
      setBuffer: function (chans, rate) {
        if (!chans || !chans.length || !chans[0].length) { bufL = bufR = null; bufLen = 0; bufDur = 0; }
        else { bufL = chans[0]; bufR = chans[1] || chans[0]; bufLen = bufL.length; ratio = (rate > 0 ? rate : sr) / sr; bufDur = bufLen / (rate > 0 ? rate : sr); bufRate = rate > 0 ? rate : sr; }
        spec = null;
        for (var i = 0; i < MAXG; i++) grains[i].on = false;
        live = 0;
      },
      set: function (s) {
        for (var k in s) if (Object.prototype.hasOwnProperty.call(P, k) && typeof s[k] === 'number' && isFinite(s[k])) P[k] = s[k];
        if (s.seed !== undefined && Math.round(P.seed) !== seedNow) { seedNow = Math.round(P.seed); rnd = mulberry(seedNow); }
        droneCheck();
      },
      noteOn: function (note, vel, at) { push({ t: 1, note: note, vel: vel > 0 ? Math.min(1, vel) : 1, frame: at === undefined ? frame : at }); },
      noteOff: function (note, at) { push({ t: 2, note: note, frame: at === undefined ? frame : at }); },
      allOff: function (at) { push({ t: 3, frame: at === undefined ? frame : at }); },
      bend: function (semis, at) { push({ t: 4, value: semis, frame: at === undefined ? frame : at }); },
      sync: function (f) { frame = f; },
      /** Spectral's analysis of the current sample (analyse()), made elsewhere (the main thread); ignored when it is another sample's. */
      setSpectrum: function (sp) { if (sp && sp.len === bufLen && sp.bins) spec = sp; },
      /** The analysis in use (null until a spectral grain needed one). */
      spectrum: function () { return spec; },
      /**
       * The things a layer drives grains from, now: `data` packs 8 numbers each (id, file position
       * 0..1, pitch in semitones, grain size in ms, amplitude, pan -1..1, spray in seconds, born 0/1),
       * `n` of them; `cutoff` overrides the filter's (NaN: not). A new thing's first grain comes at
       * once when it was just born (so a burst of things is a burst of grains), else somewhere in
       * its first interval; things that left stop. Each makes Grains per thing a second.
       */
      points: function (data, n, cutoff) {
        var next = [], had = {};
        for (var i = 0; i < pts.length; i++) had[pts[i].id] = pts[i];
        var rate0 = Math.max(0.01, P.fromRate);
        for (var j = 0; j < n; j++) {
          var o = j * 8, id = data[o], pt = had[id];
          if (!pt) { pt = { id: id, wait: data[o + 7] > 0 ? 0 : 1 + Math.floor(rnd() * sr / rate0) }; }
          pt.pos = data[o + 1]; pt.pitch = data[o + 2]; pt.size = data[o + 3]; pt.amp = data[o + 4]; pt.pan = data[o + 5]; pt.spray = data[o + 6];
          next.push(pt);
        }
        pts = next;
        ptCutoff = typeof cutoff === 'number' ? cutoff : NaN;
      },
      frame: function () { return frame; },
      process: function (L, R, n) {
        var at = 0;
        while (at < n) {
          while (events.length && events[0].frame <= frame + at) applyEvent(events.shift());
          var until = n;
          if (events.length && events[0].frame - frame < n) until = Math.max(at + 1, events[0].frame - frame);
          run(L, R, at, until);
          at = until;
        }
        frame += n;
      },
      stats: function (o) {
        var c = 0;
        for (var i = 0; i < MAXG; i++) {
          var g = grains[i];
          if (!g.on) continue;
          o.pos[c] = bufLen ? wrap(g.pos / bufLen) : 0;
          o.amp[c] = windowAt(P.window | 0, g.age / g.len, P.skew) * g.amp * voices[g.v].level;
          o.pitch[c] = g.semis;
          if (o.band) { o.band[c] = g.band; o.energy[c] = g.np ? windowAt(P.window | 0, g.age / g.len, P.skew) * g.amp * voices[g.v].level * g.energy : 0; }
          c++;
        }
        o.count = c; o.maxCount = maxCount;
        // The travelling spawn points of the newest sounding voice (Emit: places in the sample; Spectral: bands).
        if (o.heads) {
          var hv = null, mode = P.mode | 0;
          for (var vj = 0; vj < MAXV; vj++) { var vv = voices[vj]; if (vv.on && (mode === 3 ? vv.eh.ok : mode === 4 ? vv.sh.ok : false) && (!hv || vv.order > hv.order)) hv = vv; }
          o.headAxis = hv ? mode - 2 : 0; o.headCount = hv ? HEADS : 0;
          if (hv) for (var hi = 0; hi < HEADS; hi++) o.heads[hi] = mode === 3 ? headAt(hv.eh, hv.origin, P.emitSpread, hi) : headAt(hv.sh, P.band, P.bandSpread, hi);
        }
        return o;
      },
      voicesOn: function () { var c = 0; for (var i = 0; i < MAXV; i++) if (voices[i].on) c++; return c; },
      reset: function (s) {
        for (var i = 0; i < MAXG; i++) grains[i].on = false;
        for (var j = 0; j < MAXV; j++) { voices[j].on = false; voices[j].eh.ok = false; voices[j].sh.ok = false; }
        live = 0; events = []; held = {}; bend = 0; pts = []; ptCutoff = NaN; fmPhase = 0; lfoPhase = 0; maxCount = 0; frame = 0; ic1L = ic2L = ic1R = ic2R = 0;
        gainS = P.level; cutS = P.cutoff;
        seedNow = s !== undefined ? s : Math.round(P.seed); rnd = mulberry(seedNow);
        droneCheck();
      },
    };
    e.reset(seed || Math.round(P.seed));
    return e;
  }
  create.analyse = analyse;
  create.bandHz = bandHz;
  return create;
}

/** The readouts every engine fills (stats()). */
export function grNewStats() {
  return { count: 0, maxCount: 0, pos: new Float32Array(64), amp: new Float32Array(64), pitch: new Float32Array(64), band: new Float32Array(64), energy: new Float32Array(64), heads: new Float32Array(8), headCount: 0, headAxis: 0 };
}

/**
 * The readouts summed up for mappings, all 0..1: grains (count ÷ 64), mean
 * position, spread (the positions' standard deviation × 2), level (mean
 * amplitude), pitch (mean semitones: 0.5 unshifted, 0 / 1 at −48 / +48),
 * band (Spectral: the sounding grains' mean band centre) and energy (their
 * summed energy ×4, capped at 1).
 */
export function grSummary(st) {
  const n = st.count;
  if (!n) return { grains: 0, mean: 0, spread: 0, level: 0, pitch: 0.5, band: 0, energy: 0 };
  let sp = 0, sa = 0, sq = 0, sb = 0, se = 0, nb = 0;
  for (let i = 0; i < n; i++) { sp += st.pos[i]; sa += st.amp[i]; sq += st.pitch[i]; if (st.band && st.energy[i] > 0) { sb += st.band[i]; se += st.energy[i]; nb++; } }
  const mean = sp / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (st.pos[i] - mean) * (st.pos[i] - mean);
  return {
    grains: n / GR_MAX_GRAINS,
    mean: mean,
    spread: Math.min(1, Math.sqrt(v / n) * 2),
    level: Math.min(1, sa / n),
    pitch: Math.max(0, Math.min(1, 0.5 + sq / n / 96)),
    band: nb ? sb / nb : 0,
    energy: Math.min(1, se * 4),
  };
}

// ── Grains from a layer ─────────────────────────────────────────────────────

/** What a thing (a particle, a body, a null, a member) offers, each 0..1. */
export const GR_FROM_PROPS = ['x', 'y', 'speed', 'heading', 'age', 'size', 'bright', 'dist'];
export const GR_FROM_PROP_NAMES = { x: 'X', y: 'Y', speed: 'Speed', heading: 'Heading', age: 'Age', size: 'Size', bright: 'Brightness under it', dist: 'Distance to the centre' };
/** What a thing's number can set on its grains, with the range a link starts from. */
export const GR_FROM_TARGETS = {
  position: { name: 'File position', min: 0, max: 1, unit: '' },
  pitch: { name: 'Pitch', min: -12, max: 12, unit: 'st' },
  size: { name: 'Grain size', min: 40, max: 300, unit: 'ms' },
  amp: { name: 'Amplitude', min: 0, max: 1, unit: '' },
  pan: { name: 'Pan', min: -1, max: 1, unit: '' },
  cutoff: { name: 'Filter cutoff', min: 400, max: 12000, unit: 'Hz' },
  spray: { name: 'Spray', min: 0, max: 0.5, unit: 's' },
};
export const GR_FROM_LINKS_MAX = 6;

/** A new "Grains from": no source yet, and the four links it starts with. */
export function grFromDefaults() {
  return {
    source: '', boundary: '', births: true,
    links: [
      { prop: 'x', target: 'position', on: true, min: 0, max: 1 },
      { prop: 'y', target: 'pitch', on: true, min: -12, max: 12 },
      { prop: 'speed', target: 'size', on: true, min: 40, max: 300 },
      { prop: 'age', target: 'amp', on: true, min: 1, max: 0 },
    ],
  };
}

/** A thing's props, 0..1, from what grainThings reports (`cx`, `cy`: the boundary's centre). */
export function grThingProps(t, cx, cy) {
  const TAU = Math.PI * 2;
  return {
    x: t.x, y: t.y,
    speed: Math.min(1, Math.hypot(t.vx, t.vy) / 0.5),
    heading: ((Math.atan2(t.vy, t.vx) / TAU) % 1 + 1) % 1,
    age: t.age, size: t.size, bright: t.bright,
    dist: Math.min(1, Math.hypot(t.x - cx, t.y - cy) / 0.5),
  };
}

/**
 * The things inside, as the engine's points(): at most the Grain cap (64 at
 * most) of them, the closest to the boundary's centre first. Each link sets
 * one grain setting from one prop (min at 0, max at 1); a setting no link
 * sets keeps the granulator's own (Position, Pitch 0, Grain size, full level,
 * the centre, Spray). Cutoff is one filter for all: the mean of the things'.
 */
export function grFromPoints(things, cx, cy, cfg, settings) {
  const cap = Math.max(1, Math.min(GR_MAX_GRAINS, Math.round(settings.cap || GR_MAX_GRAINS)));
  const list = things.slice().sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy) || a.id - b.id).slice(0, cap);
  const links = (cfg.links || []).filter(l => l.on && GR_FROM_TARGETS[l.target] && GR_FROM_PROPS.indexOf(l.prop) >= 0).slice(0, GR_FROM_LINKS_MAX);
  const data = new Float32Array(list.length * 8);
  let cut = 0, cutN = 0;
  list.forEach((t, i) => {
    const pr = grThingProps(t, cx, cy);
    const g = { position: settings.position, pitch: 0, size: settings.size, amp: 1, pan: 0, spray: settings.spray, cutoff: NaN };
    for (const l of links) g[l.target] = l.min + (l.max - l.min) * Math.max(0, Math.min(1, pr[l.prop]));
    if (g.cutoff === g.cutoff) { cut += g.cutoff; cutN++; }
    const o = i * 8;
    data[o] = t.id; data[o + 1] = g.position; data[o + 2] = g.pitch; data[o + 3] = Math.max(2, g.size); data[o + 4] = Math.max(0, g.amp);
    data[o + 5] = Math.max(-1, Math.min(1, g.pan)); data[o + 6] = Math.max(0, g.spray); data[o + 7] = cfg.births !== false && t.born ? 1 : 0;
  });
  return { data, n: list.length, cutoff: cutN ? cut / cutN : NaN };
}

// ── Offline ─────────────────────────────────────────────────────────────────

/**
 * Render notes with the engine, no Web Audio: o = { channels (Float32Array[]),
 * bufferRate, sampleRate, frames, settings (by key), events [{ t seconds,
 * note, vel (0 = off) }], settingsAt(t) → settings by key (optional, asked
 * every `step` frames: a take's mapped values), seed }. Every note lands on
 * its exact frame. Returns { left, right, maxCount }.
 */
export function grRender(o) {
  const sr = o.sampleRate || 48000, frames = Math.max(0, Math.floor(o.frames || 0)), step = o.step || 128;
  const e = grMakeEngine()(sr, o.seed || (o.settings && o.settings.seed) || 1);
  if (o.settings) e.set(o.settings);
  e.reset(Math.round((o.settings && o.settings.seed) || o.seed || 1));
  e.setBuffer(o.channels || [], o.bufferRate || sr);
  for (const ev of [...(o.events || [])].sort((a, b) => a.t - b.t)) {
    const f = Math.max(0, Math.round(ev.t * sr));
    if (ev.vel > 0) e.noteOn(ev.note, ev.vel, f); else e.noteOff(ev.note, f);
  }
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let at = 0; at < frames; at += step) {
    const n = Math.min(step, frames - at);
    if (o.settingsAt) e.set(o.settingsAt(at / sr));
    if (o.pointsAt) { const pt = o.pointsAt(at / sr); if (pt) e.points(pt.data, pt.n, pt.cutoff); }
    e.process(left.subarray(at, at + n), right.subarray(at, at + n), n);
  }
  return { left: left, right: right, maxCount: e.stats(grNewStats()).maxCount };
}

// ── Live, on a context ──────────────────────────────────────────────────────

const GR_PROC_SOURCE = `
var grCreateEngine = grMakeEngine();
class PfGranulator extends AudioWorkletProcessor {
  constructor(o) {
    super();
    var p = (o && o.processorOptions) || {};
    this.e = grCreateEngine(sampleRate, p.seed || 1, { autoSpectrum: false });
    this.st = { count: 0, maxCount: 0, pos: new Float32Array(64), amp: new Float32Array(64), pitch: new Float32Array(64), band: new Float32Array(64), energy: new Float32Array(64), heads: new Float32Array(8), headCount: 0, headAxis: 0 };
    this.n = 0; this.alive = true;
    var self = this;
    this.port.onmessage = function (ev) { self.msg(ev.data); };
  }
  msg(d) {
    if (!d) return;
    var e = this.e, f = function (at) { return at === undefined || at === null ? undefined : Math.round(at * sampleRate); };
    if (d.t === 'buf') e.setBuffer(d.chans, d.rate);
    else if (d.t === 'set') e.set(d.s);
    else if (d.t === 'on') e.noteOn(d.note, d.vel, f(d.at));
    else if (d.t === 'off') e.noteOff(d.note, f(d.at));
    else if (d.t === 'all') e.allOff(f(d.at));
    else if (d.t === 'bend') e.bend(d.value, f(d.at));
    else if (d.t === 'pts') e.points(d.data, d.n, d.cutoff);
    else if (d.t === 'spec') e.setSpectrum(d.spec);
    else if (d.t === 'stop') this.alive = false;
  }
  process(inputs, outputs) {
    var o = outputs[0];
    if (!o || !o.length) return this.alive;
    var L = o[0], R = o[1] || new Float32Array(L.length);
    this.e.sync(currentFrame);
    this.e.process(L, R, L.length);
    if (++this.n % 6 === 0) {
      var s = this.e.stats(this.st), c = s.count, out = new Float32Array(12 + c * 5);
      out[0] = c; out[1] = s.maxCount; out[2] = s.headCount; out[3] = s.headAxis;
      for (var h = 0; h < 8; h++) out[4 + h] = s.heads[h];
      for (var i = 0; i < c; i++) { out[12 + i] = s.pos[i]; out[12 + c + i] = s.amp[i]; out[12 + 2 * c + i] = s.pitch[i]; out[12 + 3 * c + i] = s.band[i]; out[12 + 4 * c + i] = s.energy[i]; }
      this.port.postMessage(out, [out.buffer]);
    }
    return this.alive;
  }
}
registerProcessor('pf-granulator', PfGranulator);
`;

/** The worklet module's source: the engine's own text, then the processor. */
export function grWorkletSource() {
  return 'var grMakeEngine = ' + grMakeEngine.toString() + ';\n' + GR_PROC_SOURCE;
}

const grWorklets = new WeakMap();
/** Load the processor into a context once (false where AudioWorklet or Blob URLs aren't there). */
export function grLoadWorklet(ctx) {
  let p = grWorklets.get(ctx);
  if (p) return p;
  p = (async () => {
    try {
      if (!ctx.audioWorklet || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
      const url = URL.createObjectURL(new Blob([grWorkletSource()], { type: 'application/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      return true;
    } catch (_) { return false; }
  })();
  grWorklets.set(ctx, p);
  return p;
}

/** The worklet's packed readouts into `st`: count, most, spawn points, then per grain position, level, pitch, band, energy. */
export function grReadStats(d, st) {
  if (!(d instanceof Float32Array) || d.length < 12) return st;
  const c = d[0] | 0;
  st.count = c; st.maxCount = d[1]; st.headCount = d[2] | 0; st.headAxis = d[3] | 0;
  for (let h = 0; h < 8; h++) st.heads[h] = d[4 + h];
  for (let i = 0; i < c; i++) { st.pos[i] = d[12 + i]; st.amp[i] = d[12 + c + i]; st.pitch[i] = d[12 + 2 * c + i]; st.band[i] = d[12 + 3 * c + i]; st.energy[i] = d[12 + 4 * c + i]; }
  return st;
}

/** Spectral's analysis of channels (Float32Arrays) with a window of `size`: the engine's own (pure, the same every time). */
export function grAnalyse(channels, size) {
  return grMakeEngine().analyse(channels, size || 2048);
}

const grSpecCache = new WeakMap();
let grBufSeq = 0;
const grBufIds = new WeakMap();
function grBufferId(b) { let id = grBufIds.get(b); if (!id) { id = ++grBufSeq; grBufIds.set(b, id); } return id; }
/** An AudioBuffer's analysis at `size`, made once and remembered. */
export function grBufferSpectrum(b, size) {
  let m = grSpecCache.get(b);
  if (!m) { m = new Map(); grSpecCache.set(b, m); }
  let sp = m.get(size);
  if (!sp) {
    const chans = [];
    for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) chans.push(b.getChannelData(c));
    sp = grAnalyse(chans, size);
    m.set(size, sp);
  }
  return sp;
}

/**
 * The analysis as a picture: `cols` × `rows` cells (time across, frequency
 * up on the Band axis's log scale), each 0..1 (the loudest peak's level on a
 * dB scale), row 0 at the bottom. For the card's spectrogram.
 */
export function grSpectrumImage(sp, cols, rows, rate) {
  const out = new Float32Array(cols * rows);
  if (!sp || !sp.frames) return out;
  const nyq = (rate || 48000) / 2, lnTop = Math.log(nyq / 20);
  let peak = 1e-9;
  for (let f = 0; f < sp.frames; f++) {
    const col = Math.min(cols - 1, Math.floor(f / sp.frames * cols));
    for (let j = 0; j < sp.count[f]; j++) {
      const hz = sp.bins[f * sp.peaks + j] * (rate || 48000) / sp.size;
      if (hz < 20) continue;
      const row = Math.min(rows - 1, Math.floor(Math.log(hz / 20) / lnTop * rows));
      const a = sp.amps[f * sp.peaks + j], k = col * rows + row;
      if (a > out[k]) out[k] = a;
      if (a > peak) peak = a;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] > 0 ? Math.max(0, 1 + Math.log10(out[i] / peak) / 3) : 0;
  return out;
}

/**
 * A live granulator on `ctx`: `output` (a stereo GainNode, connect it on),
 * `setBuffer(audioBuffer)`, `set(settings)`, `noteOn(note, vel 0..1, when?)`,
 * `noteOff(note, when?)`, `allOff()`, `bend(semitones)` (when: context
 * seconds; now when left out), `stats()` (the latest readouts), `kind`
 * ('worklet', 'script' or '' while loading), `dispose()`. `opts.worklet
 * === false` skips the worklet (the ScriptProcessor at once).
 */
export function grCreate(ctx, opts) {
  const o = opts || {};
  const output = ctx.createGain();
  const st = grNewStats();
  let node = null, eng = null, dead = false, kind = '';
  const queue = [];
  let lastSettings = null, lastBuffer = null;
  const send = msg => {
    if (dead) return;
    if (kind === 'worklet') { try { node.port.postMessage(msg); } catch (_) { /* gone */ } return; }
    if (kind === 'script') { apply(msg); return; }
    queue.push(msg);
  };
  const frameOf = at => (at === undefined || at === null ? undefined : Math.round(at * ctx.sampleRate));
  function apply(d) {
    if (d.t === 'buf') eng.setBuffer(d.chans, d.rate);
    else if (d.t === 'set') eng.set(d.s);
    else if (d.t === 'on') eng.noteOn(d.note, d.vel, frameOf(d.at));
    else if (d.t === 'off') eng.noteOff(d.note, frameOf(d.at));
    else if (d.t === 'all') eng.allOff(frameOf(d.at));
    else if (d.t === 'bend') eng.bend(d.value, frameOf(d.at));
    else if (d.t === 'pts') eng.points(d.data, d.n, d.cutoff);
    else if (d.t === 'spec') eng.setSpectrum(d.spec);
  }
  // Spectral's analysis, made here (not on the audio thread) once per sample and window, when the mode asks for it.
  let specSent = '';
  function sendSpectrum() {
    if (!lastBuffer || !lastSettings || Math.round(lastSettings.mode) !== 4) return;
    const size = GR_FFT_SIZES[Math.max(0, Math.min(2, Math.round(lastSettings.fftSize == null ? 1 : lastSettings.fftSize)))];
    const key = size + ':' + grBufferId(lastBuffer);
    if (specSent === key) return;
    specSent = key;
    send({ t: 'spec', spec: grBufferSpectrum(lastBuffer, size) });
  }
  function useScript() {
    if (dead || kind) return;
    const sp = ctx.createScriptProcessor ? ctx.createScriptProcessor(1024, 1, 2) : null;
    if (!sp) return;
    eng = grMakeEngine()(ctx.sampleRate, o.seed || 1);
    let n = 0;
    sp.onaudioprocess = ev => {
      const out = ev.outputBuffer;
      eng.sync(Math.round(ev.playbackTime * ctx.sampleRate));
      eng.process(out.getChannelData(0), out.getChannelData(1), out.length);
      if (++n % 2 === 0) eng.stats(st);
    };
    sp.connect(output);
    node = sp; kind = 'script';
    for (const m of queue.splice(0)) apply(m);
  }
  if (o.worklet === false) useScript();
  else {
    void grLoadWorklet(ctx).then(ok => {
      if (dead || kind) return;
      if (!ok) { useScript(); return; }
      try {
        node = new AudioWorkletNode(ctx, 'pf-granulator', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { seed: o.seed || 1 } });
      } catch (_) { useScript(); return; }
      node.port.onmessage = ev => grReadStats(ev.data, st);
      node.connect(output);
      kind = 'worklet';
      for (const m of queue.splice(0)) node.port.postMessage(m);
    });
  }
  return {
    output: output,
    get kind() { return kind; },
    setBuffer(b) {
      if (!b || b === lastBuffer) return;
      lastBuffer = b;
      const chans = [];
      for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) chans.push(new Float32Array(b.getChannelData(c)));
      send({ t: 'buf', chans: chans, rate: b.sampleRate });
      specSent = '';
      sendSpectrum();
    },
    set(s) {
      // Only what changed crosses to the audio thread.
      const diff = {};
      let any = false;
      for (const k in s) if (!lastSettings || lastSettings[k] !== s[k]) { diff[k] = s[k]; any = true; }
      lastSettings = Object.assign({}, lastSettings || {}, s);
      if (any) send({ t: 'set', s: diff });
      if (any && ('mode' in diff || 'fftSize' in diff)) sendSpectrum();
    },
    noteOn(note, vel, when) { if (ctx.state === 'suspended' && ctx.resume) void ctx.resume(); send({ t: 'on', note: note, vel: vel, at: when }); },
    noteOff(note, when) { send({ t: 'off', note: note, at: when }); },
    allOff(when) { send({ t: 'all', at: when }); },
    bend(semis, when) { send({ t: 'bend', value: semis, at: when }); },
    /** The things a layer drives grains from (grFromPoints), this frame. */
    points(p) { if (p) send({ t: 'pts', data: p.data, n: p.n, cutoff: p.cutoff }); },
    stats() { return st; },
    /** Spectral's analysis of the current sample at the current window (made once, remembered), or null. */
    spectrum() {
      if (!lastBuffer) return null;
      const size = GR_FFT_SIZES[Math.max(0, Math.min(2, Math.round(lastSettings && lastSettings.fftSize != null ? lastSettings.fftSize : 1)))];
      return grBufferSpectrum(lastBuffer, size);
    },
    dispose() {
      if (dead) return;
      dead = true;
      if (node) {
        try { if (kind === 'worklet') node.port.postMessage({ t: 'stop' }); } catch (_) { /* gone */ }
        try { node.disconnect(); } catch (_) { /* gone */ }
        if (kind === 'script') node.onaudioprocess = null;
      }
      try { output.disconnect(); } catch (_) { /* gone */ }
    },
  };
}

// ── Generated samples ───────────────────────────────────────────────────────

/** Samples the granulator can make without a file (the drum pads' drums too). */
export const GR_SYNTHS = ['pad', 'pluck', 'vowel', 'bell', 'noise', 'sine'].concat(DP_SYNTHS);
export const GR_SYNTH_NAMES = { pad: 'Pad chord', pluck: 'Pluck', vowel: 'Vowel', bell: 'Bell', noise: 'Noise sweep', sine: 'Sine (220 Hz)', kick: 'Kick', snare: 'Snare', hat: 'Hat', openhat: 'Open hat', clap: 'Clap', tom: 'Tom', rim: 'Rim', cowbell: 'Cowbell' };

function grNoise(seed) {
  let a = seed >>> 0 || 1;
  return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) / 4294967296) * 2 - 1; };
}

/** A generated sample, mono, at `rate`. */
export function grSynthData(kind, rate) {
  if (DP_SYNTHS.indexOf(kind) >= 0) return dpSynthData(kind, rate);
  const sr = rate || 44100;
  const secs = kind === 'pluck' ? 2 : kind === 'sine' ? 2 : 3;
  const n = Math.max(1, Math.round(secs * sr));
  const out = new Float32Array(n);
  const rnd = grNoise(GR_SYNTHS.indexOf(kind) * 104729 + 7);
  const TAU = 2 * Math.PI;
  if (kind === 'pluck') {
    // Karplus–Strong at G3.
    const period = Math.round(sr / 196), line = new Float32Array(period);
    for (let i = 0; i < period; i++) line[i] = rnd();
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const a = line[idx], b = line[(idx + 1) % period];
      out[i] = a;
      line[idx] = 0.498 * (a + b);
      idx = (idx + 1) % period;
    }
  } else if (kind === 'vowel') {
    // A saw at A2 through three formants moving from "ah" to "oo".
    let ph = 0;
    const bands = [0, 1, 2].map(() => ({ s1: 0, s2: 0 }));
    for (let i = 0; i < n; i++) {
      const t = i / sr, k = t / secs;
      ph = (ph + 110 * (1 + 0.004 * Math.sin(TAU * 5 * t)) / sr) % 1;
      const saw = 2 * ph - 1;
      const f = [730 + (300 - 730) * k, 1090 + (870 - 1090) * k, 2440 + (2240 - 2440) * k];
      let v = 0;
      for (let b = 0; b < 3; b++) {
        const g = Math.tan(Math.PI * f[b] / sr), q = 8, a1 = 1 / (1 + g * (g + 1 / q)), st = bands[b];
        const v3 = saw - st.s2, v1 = a1 * st.s1 + g * a1 * v3, v2 = st.s2 + g * a1 * st.s1 + g * g * a1 * v3;
        st.s1 = 2 * v1 - st.s1; st.s2 = 2 * v2 - st.s2;
        v += v1 * (b === 0 ? 1 : b === 1 ? 0.6 : 0.3);
      }
      out[i] = v;
    }
  } else if (kind === 'bell') {
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = Math.exp(-t / 0.9);
      out[i] = env * Math.sin(TAU * 440 * t + 3 * env * Math.sin(TAU * 440 * 1.4 * t)) + 0.4 * Math.exp(-t / 0.4) * Math.sin(TAU * 440 * 2.76 * t);
    }
  } else if (kind === 'noise') {
    let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = 200 * Math.pow(40, t / secs), g = Math.tan(Math.PI * Math.min(f, sr * 0.45) / sr), a1 = 1 / (1 + g * (g + 0.2));
      const x = rnd(), v3 = x - s2, v1 = a1 * s1 + g * a1 * v3, v2 = s2 + g * a1 * s1 + g * g * a1 * v3;
      s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
      out[i] = v1;
    }
  } else if (kind === 'sine') {
    for (let i = 0; i < n; i++) out[i] = Math.sin(TAU * 220 * i / sr);
  } else {
    // pad: A minor-ish chord (A3 C4 E4 A4), slightly detuned, a slow swell.
    const fs = [220, 261.63, 329.63, 440];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (let j = 0; j < fs.length; j++) v += Math.sin(TAU * fs[j] * t * (1 + 0.002 * Math.sin(TAU * (0.3 + j * 0.11) * t))) + 0.3 * Math.sin(TAU * fs[j] * 2.001 * t);
      out[i] = v * (0.6 + 0.4 * Math.sin(TAU * 0.5 * t));
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return out;
}

/** A generated sample as an AudioBuffer on `ctx`. */
export function grSynthBuffer(ctx, kind) {
  const data = grSynthData(kind, ctx.sampleRate);
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.getChannelData(0).set(data);
  return b;
}

/** The waveform's peaks in `n` columns (max |sample| each), for drawing. */
export function grPeaks(data, n) {
  const out = new Float32Array(n);
  if (!data || !data.length) return out;
  const per = data.length / n;
  for (let c = 0; c < n; c++) {
    let m = 0;
    const a = Math.floor(c * per), b = Math.min(data.length, Math.floor((c + 1) * per));
    for (let i = a; i < b; i++) { const v = Math.abs(data[i]); if (v > m) m = v; }
    out[c] = m;
  }
  return out;
}
