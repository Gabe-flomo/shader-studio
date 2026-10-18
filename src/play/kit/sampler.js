/**
 * sampler.js — the Sampler layer's engine (docs/sampler.md): voices built
 * after Ableton's Simpler, played by a Drum view (128 pads, each a chain with
 * its own voice settings) and a Keys view (zones across the keyboard, a
 * multisampler). Plain Web Audio and plain math, so the app (play/drumPads.ts),
 * offline renders (lib/recordingAudio.ts, an OfflineAudioContext) and website
 * exports (runtime/play-runtime.js, through the inlined kit as SSKit.sampler)
 * play a hit the same way. Every top-level name starts `sm`/`SM_` (the kit's
 * files share one scope in exports); it builds on drumPads.js (`dp…`).
 *
 * A voice, every stage scheduled on the AudioContext clock at the hit's time:
 *
 *   BufferSource ─▶ filter (0–2 biquads) ─▶ amp envelope ─▶ release ─▶ kill ─▶ volume ─▶ tremolo ─▶ pan ─▶ output
 *     ▲ detune: pitch envelope, LFO, glide      ▲ detune: filter envelope, LFO
 *
 *   - The amp envelope's stages are linear ramps when a slope is 0 (exactly
 *     the old drum pads' sound) or shaped curves (setValueCurveAtTime). It is
 *     never cancelled: Release is its own gain (1 → 0 from wherever the level
 *     is), and a choke, a voice steal or a retrigger is a third gain going
 *     1 → 0 over 4 ms. No cancelAndHold (Firefox lacks it), no jumps, no clicks.
 *   - The pitch and filter envelopes are ConstantSources (0 → 1 → Sustain, then
 *     their own release gain) scaled to cents into `detune`; the LFO is an
 *     Oscillator into pitch, filter, amp (tremolo) or pan; glide is a linear
 *     ramp on `detune` from the last note.
 *   - A loop's crossfade is baked into a copy of the buffer (smLoopBuffer), so
 *     the wrap is continuous.
 *
 * And the pure parts the editor, the hosts and the tests share: the voice
 * numbers (SM_PARAMS), the envelope's shape (smShape, smEnvAt, smEnvSegments),
 * note names, a file name's root key, zero crossings, transient slicing, a
 * hit's voices from a layer record (smHits) and the computer keyboard.
 */
import { DP_PARAMS, dpHash01, dpKey, dpPickPad, dpRate, dpRegion, dpReverse, dpSlots, dpVelGain } from './drumPads.js';

const SM_P = (key, label, min, max, step, value, unit, hint, extra) => Object.assign({ key, label, min, max, step, value, unit: unit || '', hint: hint || '', lo: min, hi: max, hard: true }, extra || {});
const smDp = key => { for (const p of DP_PARAMS) if (p.key === key) return p; return null; };

/** Most pads a Sampler has (one per MIDI note). */
export const SM_PADS = 128;
/** Pads in view at once: a 4 × 4 window over the 128, like Drum Rack's. */
export const SM_WINDOW = 16;
export const SM_CHOKES = 16;
/** Most zones in the Keys view. */
export const SM_ZONES = 64;
/** Voices a Drum view layer holds at once (the oldest is faded out to make room). */
export const SM_DRUM_VOICES = 32;
/** A choke, a steal or a retrigger fades the old voice over this long. */
export const SM_KILL = 0.004;

/**
 * Each voice's numbers. The first ten are the old drum pads' (same keys and
 * defaults, wider ranges), so a pad's `pad3_pitch` means what it always did.
 * `min`/`max` are the slider's range; `lo`/`hi` what a file may hold (a soft
 * slider can be typed past its end, up to these). The defaults reproduce the
 * old drum pads exactly: linear stages, no filter, no pitch envelope, no LFO,
 * a 3 ms fade at a one-shot's end.
 */
export const SM_PARAMS = [
  SM_P('start', 'Start', 0, 1, 0.001, 0, '', smDp('start').hint),
  SM_P('end', 'End', 0, 1, 0.001, 1, '', smDp('end').hint),
  SM_P('pitch', 'Transpose', -48, 48, 0.01, 0, 'st', 'Semitones up or down. It plays faster or slower, like tape.', { hard: false, lo: -96, hi: 96 }),
  SM_P('volume', 'Gain', 0, 1.5, 0.01, 0.8, '', 'How loud this sound is (before the layer’s volume).', { hard: false, hi: 4 }),
  SM_P('pan', 'Pan', -1, 1, 0.01, 0, '', 'Left (−1) to right (1).'),
  SM_P('attack', 'Attack', 0, 5, 0.001, 0.001, 's', 'Time to rise to full level.', { hard: false, hi: 60 }),
  SM_P('decay', 'Decay', 0, 5, 0.001, 0.2, 's', 'Time to fall from full level to Sustain.', { hard: false, hi: 60 }),
  SM_P('sustain', 'Sustain', 0, 1, 0.01, 1, '', 'The level held after the decay (1: no decay).'),
  SM_P('release', 'Release', 0, 10, 0.001, 0.05, 's', 'Classic: time to fade out once the note is let go.', { hard: false, hi: 60 }),
  SM_P('vel', 'Vel → Vol', 0, 1, 0.01, 1, '', 'How much a hit’s velocity sets its volume: 0 plays every hit the same, 1 a soft hit quietly.'),
  SM_P('velCurve', 'Vel curve', -1, 1, 0.01, 0, '', 'Bends velocity before it sets the volume: up makes soft hits louder, down quieter.'),
  SM_P('detune', 'Detune', -50, 50, 0.1, 0, 'ct', 'Cents up or down.'),
  SM_P('loopStart', 'Loop start', 0, 1, 0.001, 0, '', 'Where the loop starts in the sample (inside Start…End). Drag the loop brace on the waveform.'),
  SM_P('loopEnd', 'Loop end', 0, 1, 0.001, 1, '', 'Where the loop ends (inside Start…End).'),
  SM_P('xfade', 'Crossfade', 0, 1, 0.001, 0, 's', 'Blends the end of the loop into its start so the wrap doesn’t click.', { hard: false, hi: 10 }),
  SM_P('fadeOut', 'Fade out', 0, 2, 0.001, 0.003, 's', 'One-shot: the fade at the end of the sound, so it never clicks.', { hard: false, hi: 30 }),
  SM_P('aSlope', 'A slope', -1, 1, 0.01, 0, '', 'Attack’s curve: up rises fast then eases in, down starts slow.'),
  SM_P('dSlope', 'D slope', -1, 1, 0.01, 0, '', 'Decay’s curve: up falls fast then eases (natural), down holds then drops.'),
  SM_P('rSlope', 'R slope', -1, 1, 0.01, 0, '', 'Release’s curve: up falls fast then tails off, down holds then drops.'),
  SM_P('cutoff', 'Frequency', 20, 20000, 1, 20000, 'Hz', 'The filter’s cutoff (or centre for band-pass).', { log: true }),
  SM_P('res', 'Res', 0, 1, 0.01, 0, '', 'Resonance: a peak at the cutoff.'),
  SM_P('fEnv', 'Env amount', -72, 72, 0.1, 0, 'st', 'How far the filter envelope moves the cutoff, in semitones.', { hard: false, lo: -120, hi: 120 }),
  SM_P('fA', 'F attack', 0, 5, 0.001, 0.001, 's', 'Filter envelope: time to reach its peak.', { hard: false, hi: 60 }),
  SM_P('fD', 'F decay', 0, 5, 0.001, 0.3, 's', 'Filter envelope: time to fall to its sustain.', { hard: false, hi: 60 }),
  SM_P('fS', 'F sustain', 0, 1, 0.01, 0, '', 'Filter envelope: the level held while the note is.'),
  SM_P('fR', 'F release', 0, 10, 0.001, 0.3, 's', 'Filter envelope: time back to 0 once the note is let go.', { hard: false, hi: 60 }),
  SM_P('fVel', 'Vel → Freq', 0, 72, 0.1, 0, 'st', 'A hard hit opens the filter by up to this many semitones.', { hard: false, hi: 120 }),
  SM_P('pEnv', 'Pitch env', -48, 48, 0.1, 0, 'st', 'How far the pitch envelope bends the pitch, in semitones (a kick’s drop).', { hard: false, lo: -96, hi: 96 }),
  SM_P('pA', 'P attack', 0, 5, 0.001, 0.001, 's', 'Pitch envelope: time to reach its peak.', { hard: false, hi: 60 }),
  SM_P('pD', 'P decay', 0, 5, 0.001, 0.2, 's', 'Pitch envelope: time to fall to its sustain.', { hard: false, hi: 60 }),
  SM_P('pS', 'P sustain', 0, 1, 0.01, 0, '', 'Pitch envelope: the level held while the note is.'),
  SM_P('pR', 'P release', 0, 10, 0.001, 0.1, 's', 'Pitch envelope: time back to 0 once the note is let go.', { hard: false, hi: 60 }),
  SM_P('lfoRate', 'LFO rate', 0.01, 30, 0.01, 4, 'Hz', 'How fast the LFO swings.', { hard: false, hi: 200, log: true }),
  SM_P('lfoAmt', 'LFO amount', 0, 1, 0.01, 0, '', 'How far the LFO swings its target (pitch ±1 octave, filter ±4 octaves, amp, pan).'),
  SM_P('glide', 'Glide', 0, 2, 0.001, 0, 's', 'Keys: time the pitch slides from the last note to this one.', { hard: false, hi: 20 }),
];
export const SM_PARAM_KEYS = SM_PARAMS.map(p => p.key);
/** The Keys view's instrument numbers (`k_<key>`): every voice number but the sample's own (each zone has those). */
export const SM_KEYS_PARAMS = SM_PARAMS.filter(p => ['start', 'end', 'loopStart', 'loopEnd', 'xfade'].indexOf(p.key) < 0);
export const SM_FILTERS = ['off', 'lp12', 'lp24', 'hp12', 'hp24', 'bp12', 'bp24'];
export const SM_LFO_SHAPES = ['sine', 'triangle', 'square', 'sawtooth'];
export const SM_LFO_TO = ['pitch', 'filter', 'amp', 'pan'];
export const SM_MODES = ['classic', 'oneshot', 'slice'];
export const SM_SELECT = ['all', 'cycle', 'random'];

export function smParam(key) { for (const p of SM_PARAMS) if (p.key === key) return p; return null; }
/** A Keys view instrument number's layer property: smKeyProp('cutoff') → 'k_cutoff'. */
export function smKeyProp(key) { return 'k_' + key; }
/** A layer property's pad and number, or null: 'pad3_cutoff' → { pad: 2, key: 'cutoff' }. */
export function smPadKeyParts(k) {
  const m = /^pad(\d{1,3})_([A-Za-z]+)$/.exec(k);
  if (!m) return null;
  const pad = Number(m[1]) - 1;
  return pad >= 0 && pad < SM_PADS && SM_PARAM_KEYS.indexOf(m[2]) >= 0 ? { pad: pad, key: m[2] } : null;
}
/** A number from a file, kept inside what a file may hold, else its default. */
export function smClamp(key, v) {
  const p = smParam(key);
  if (!p) return v;
  return typeof v === 'number' && isFinite(v) ? Math.max(p.lo, Math.min(p.hi, v)) : p.value;
}
/** The numbers a voice reads, with defaults for any missing. */
export function smNumbers(get) {
  const o = {};
  for (const p of SM_PARAMS) { const v = get(p.key); o[p.key] = typeof v === 'number' && isFinite(v) ? Math.max(p.lo, Math.min(p.hi, v)) : p.value; }
  return o;
}

// ── Notes ─────────────────────────────────────────────────────────────────────

const SM_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Live's note names: 60 is C3, 36 C1, 0 C-2. */
export function smNoteName(n) { const k = Math.round(n); return SM_NAMES[((k % 12) + 12) % 12] + (Math.floor(k / 12) - 2); }
/** A note name to its number ('C3' → 60, 'F#1' → 42, 'Bb-1' → 22), or -1. */
export function smNoteOf(name) {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(String(name).trim());
  if (!m) return -1;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const n = base + acc + (Number(m[3]) + 2) * 12;
  return n >= 0 && n <= 127 ? n : -1;
}
/**
 * A sample's root key from its file name ("Cello_A2.wav" → 45, "piano-c#3" →
 * 61, "Pad 60.wav" → 60), else `fallback` (C3, 60). A note name must stand
 * on its own (not inside a word), and a bare number counts only 0–127 at the end.
 */
export function smRootFromName(fileName, fallback) {
  const fb = typeof fallback === 'number' ? fallback : 60;
  const stem = String(fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const re = /(?:^|[^A-Za-z0-9#])([A-Ga-g][#b]?-?\d)(?=$|[^A-Za-z0-9])/g;
  let m, last = -1;
  while ((m = re.exec(stem))) { const n = smNoteOf(m[1]); if (n >= 0) last = n; }
  if (last >= 0) return last;
  const num = /(?:^|[^0-9])(\d{1,3})$/.exec(stem);
  if (num && Number(num[1]) <= 127 && Number(num[1]) >= 12) return Number(num[1]);
  return fb;
}

/** The note a pad plays: pad i (0-based) is note (base + i) mod 128, so pads 1–16 are the old drum pads. */
export function smNoteOfPad(pad, base) { return (((base + pad) % SM_PADS) + SM_PADS) % SM_PADS; }
/** The pad (0-based) a note plays. */
export function smPadOfNote(note, base) { return (((note - base) % SM_PADS) + SM_PADS) % SM_PADS; }

/** The Keys view's computer keyboard, after Live's: A W S E D F T G Y H U J K O L P ; ' from C. */
export const SM_PIANO_KEYS = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
/** The semitone above the octave's C a key plays, or -1. */
export function smPianoOffset(code) { return SM_PIANO_KEYS.indexOf(code); }

// ── The envelope's shape ──────────────────────────────────────────────────────

/**
 * A stage's shape: 0..1 through it → 0..1 of the way from its start level to
 * its end. Slope 0 is a straight line; up (to 1) moves fast first and eases
 * in (a natural decay), down (to −1) starts slowly and rushes at the end.
 */
export function smShape(u, slope) {
  const x = Math.max(0, Math.min(1, u));
  const k = (Math.max(-1, Math.min(1, slope || 0))) * 6;
  if (Math.abs(k) < 1e-4) return x;
  return (1 - Math.exp(-k * x)) / (1 - Math.exp(-k));
}

/**
 * The envelope (attack to 1, decay to sustain, hold) as stages
 * { t0, t1, v0, v1, slope, u0, u1 }: from t0 to t1 seconds after the hit the
 * level goes v0 + (v1 − v0)·smShape(u, slope) for u from u0 to u1. `until`
 * (a one-shot's length) cuts it there, fading to 0 over the last `fade` s.
 */
export function smEnvSegments(attack, decay, sustain, aSlope, dSlope, until, fade) {
  const a = Math.max(0.001, attack || 0), d = Math.max(0, decay || 0), s = Math.max(0, Math.min(1, sustain));
  const segs = [{ t0: 0, t1: a, v0: 0, v1: 1, slope: aSlope || 0, u0: 0, u1: 1 }, { t0: a, t1: a + d, v0: 1, v1: s, slope: dSlope || 0, u0: 0, u1: 1 }];
  if (!(until > 0) || !isFinite(until)) return segs;
  const f = Math.min(typeof fade === 'number' && fade >= 0 ? Math.max(0.0005, fade) : 0.003, until / 2), cut = until - f;
  const out = [];
  for (const g of segs) {
    if (g.t0 >= cut) break;
    if (g.t1 <= cut) { out.push(g); continue; }
    const dur = g.t1 - g.t0;
    out.push(Object.assign({}, g, { t1: cut, u1: dur > 0 ? (cut - g.t0) / dur : 1 }));
  }
  const L = smEnvAt(cut, a, d, s, aSlope, dSlope);
  out.push({ t0: cut, t1: until, v0: L, v1: 0, slope: 0, u0: 0, u1: 1 });
  return out;
}
/** A stage's level at u (0..1 of its own length). */
export function smSegAt(g, u) { return g.v0 + (g.v1 - g.v0) * smShape(u, g.slope); }

/** The envelope's level `t` seconds after the hit (before any release), peak 1. */
export function smEnvAt(t, attack, decay, sustain, aSlope, dSlope) {
  const a = Math.max(0.001, attack || 0), d = Math.max(0, decay || 0), s = Math.max(0, Math.min(1, sustain));
  if (t <= 0) return 0;
  if (t < a) return smShape(t / a, aSlope);
  if (t < a + d) return 1 + (s - 1) * smShape((t - a) / d, dSlope);
  return s;
}
/** The release's level `t` seconds into it (1 → 0 over `release`). */
export function smReleaseAt(t, release, rSlope) {
  const r = Math.max(0.001, release || 0);
  return t <= 0 ? 1 : t >= r ? 0 : 1 - smShape(t / r, rSlope);
}

/** Schedule stages on a param from `at`: straight ramps when flat, shaped curves when not, scaled by `scale`. */
export function smSchedule(param, at, segs, scale, sampleRate) {
  const k = typeof scale === 'number' ? scale : 1;
  const eps = 1 / (sampleRate || 44100);
  param.setValueAtTime(segs.length ? smSegAt(segs[0], segs[0].u0) * k : 0, at);
  let last = at;
  for (const g of segs) {
    const t0 = at + g.t0, t1 = at + g.t1, dur = t1 - t0;
    // A gap (the sustain held until a one-shot's fade): hold the level up to this stage.
    if (t0 > last + eps) { param.linearRampToValueAtTime(smSegAt(g, g.u0) * k, t0); last = t0; }
    if (!g.slope || dur < eps * 8) { param.linearRampToValueAtTime(smSegAt(g, g.u1) * k, t1); last = t1; continue; }
    const n = Math.max(8, Math.min(512, Math.ceil(dur * 600)));
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = smSegAt(g, g.u0 + (g.u1 - g.u0) * (i / (n - 1))) * k;
    // A curve may not start at another event's time: half a sample later (the level is already there).
    const st = Math.max(t0, last) + eps * 0.5;
    param.setValueCurveAtTime(c, st, Math.max(eps, t1 - st));
    last = t1;
  }
}
/** A release (1 → 0 over `secs`, shaped) on a gain from `t`. */
function smScheduleRelease(param, t, secs, slope, sampleRate) {
  smSchedule(param, t, [{ t0: 0, t1: Math.max(0.001, secs), v0: 1, v1: 0, slope: slope || 0, u0: 0, u1: 1 }], 1, sampleRate);
}

/** Velocity bent by a curve (0 straight; up louder soft hits, down quieter), then its gain. */
export function smVelGain(vel, amount, curve) {
  const v = Math.max(0, Math.min(1, typeof vel === 'number' ? vel : 1));
  const c = Math.max(-1, Math.min(1, curve || 0));
  const bent = c === 0 ? v : Math.pow(v, Math.pow(4, -c));
  return dpVelGain(bent, amount);
}

// ── Samples: zero crossings, slices, loops ────────────────────────────────────

/** The zero crossing nearest `i` (a sample index) within `reach` samples, else `i`. */
export function smZeroCrossing(data, i, reach) {
  const n = data.length, r = Math.max(1, reach || 2048), at = Math.max(0, Math.min(n - 1, Math.round(i)));
  for (let d = 0; d <= r; d++) {
    for (const j of d ? [at - d, at + d] : [at]) {
      if (j < 1 || j >= n) continue;
      const a = data[j - 1], b = data[j];
      if (b === 0 || (a < 0) !== (b < 0)) return j;
    }
  }
  return at;
}
/** A 0..1 position snapped to the nearest zero crossing of `data` (within ~20 ms at 44.1 kHz). */
export function smSnap(data, x) {
  if (!data || !data.length) return x;
  return smZeroCrossing(data, x * (data.length - 1), Math.round(data.length > 4000 ? 900 : data.length / 4)) / Math.max(1, data.length - 1);
}

/**
 * Where a sample's hits begin (0..1 of it), for Slice mode: an onset is a
 * frame whose energy jumps well above the frames just before it. `sens`
 * (0..1) lowers the bar as it rises; slices are at least `minGap` s apart.
 * Always starts with 0.
 */
export function smTransients(data, sampleRate, sens, minGap) {
  const sr = sampleRate || 44100, n = data.length;
  if (!n) return [0];
  const hop = Math.max(32, Math.round(sr * 0.005)), frames = Math.floor(n / hop);
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = f * hop, end = i + hop; i < end; i++) s += data[i] * data[i]; e[f] = Math.sqrt(s / hop); }
  let peak = 0;
  for (let f = 0; f < frames; f++) if (e[f] > peak) peak = e[f];
  if (!(peak > 0)) return [0];
  const s01 = Math.max(0, Math.min(1, typeof sens === 'number' ? sens : 0.5));
  const ratio = 1.5 + (1 - s01) * 6, floor = peak * (0.02 + (1 - s01) * 0.18);
  const gap = Math.max(1, Math.round((typeof minGap === 'number' ? minGap : 0.05) * sr / hop));
  const out = [0];
  let lastF = -gap;
  for (let f = 1; f < frames; f++) {
    let before = 0;
    for (let j = Math.max(0, f - 4); j < f; j++) before = Math.max(before, e[j]);
    if (e[f] > floor && e[f] > before * ratio + 1e-6 && f - lastF >= gap) {
      // Back up to where the hit starts inside its frame (the first sample over a tenth of its frame's level).
      let i = f * hop;
      const thr = e[f] * 0.1;
      for (let k = (f - 1) * hop; k < f * hop + hop; k++) if (Math.abs(data[k]) > thr) { i = k; break; }
      const x = i / n;
      if (x - out[out.length - 1] > 0.5 * gap * hop / n) out.push(x);
      lastF = f;
    }
  }
  return out;
}

const smLoops = new WeakMap();
/**
 * `buffer` with its loop's crossfade baked in: the `xfade` seconds before
 * the loop end blend (equal power) into the audio leading up to the loop
 * start, so playing past the end and back to the start is continuous. The
 * same buffer when there's nothing to blend. Cached per buffer (the last 6 loops).
 */
export function smLoopBuffer(ctx, buffer, loopStart, loopEnd, xfade) {
  const sr = buffer.sampleRate, ls = Math.round(loopStart * sr), le = Math.round(loopEnd * sr);
  const F = Math.min(Math.round(Math.max(0, xfade || 0) * sr), le - ls, ls);
  if (!(F >= 2)) return buffer;
  let cache = smLoops.get(buffer);
  if (!cache) { cache = new Map(); smLoops.set(buffer, cache); }
  const key = ls + ':' + le + ':' + F;
  const had = cache.get(key);
  if (had) return had;
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const from = buffer.getChannelData(c), to = out.getChannelData(c);
    to.set(from);
    for (let i = 0; i < F; i++) {
      const w = (i + 1) / F, a = from[le - F + i], b = from[ls - F + i];
      to[le - F + i] = a * Math.cos(w * Math.PI / 2) + b * Math.sin(w * Math.PI / 2);
    }
  }
  cache.set(key, out);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return out;
}

/** The loudest and quietest sample in each of `n` columns of data[from..to), for a zoomed waveform. */
export function smMinMax(data, from, to, n) {
  const out = new Float32Array(n * 2), a = Math.max(0, Math.floor(from)), b = Math.min(data.length, Math.ceil(to));
  const per = (b - a) / n;
  for (let i = 0; i < n; i++) {
    const s = Math.floor(a + i * per), e = Math.max(s + 1, Math.floor(a + (i + 1) * per));
    let lo = 0, hi = 0;
    for (let j = s; j < e && j < b; j++) { const v = data[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    out[i * 2] = lo; out[i * 2 + 1] = hi;
  }
  return out;
}

// ── The sampler ───────────────────────────────────────────────────────────────

const SM_FILTER_TYPE = { lp: 'lowpass', hp: 'highpass', bp: 'bandpass' };

/**
 * A sampler: its voices sum into `output`. `hit(group, o, when)` starts a
 * voice of o.buffer with o's numbers (SM_PARAMS keys) and choices:
 *   mode       'oneshot' plays the region to its end; 'gate' (Classic) until release
 *   loop       Classic: loop between the loop markers while held
 *   reverse, choke (1..16: cuts every voice in its group), retrigger (cuts the group's own voices)
 *   filter     SM_FILTERS; lfoShape, lfoTo
 *   velocity   the hit's (0..1)
 *   glideFrom  semitones the pitch starts away from (slides to 0 over o.glide)
 *   legato     a held voice of the same sample in this sampler glides to the new pitch instead
 *   region     { start, end } overriding o.start / o.end (a slice)
 * `group` is what release / setLive / choke address (a pad, a note).
 */
export function smCreateSampler(ctx, opts) {
  const output = ctx.createGain();
  const voices = [];
  let maxVoices = Math.max(1, Math.min(64, (opts && opts.voices) || SM_DRUM_VOICES));
  const sr = ctx.sampleRate || 44100;
  const drop = v => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); };
  const now = when => Math.max(ctx.currentTime, typeof when === 'number' ? when : ctx.currentTime);

  function stopAt(v, t) {
    if (v.stopAt <= t) return;
    v.stopAt = t;
    try { v.src.stop(t); } catch (e) { /* already stopped */ }
    for (const s of v.extra) { try { s.stop(t); } catch (e) { /* stopped */ } }
  }
  /** Fade a voice out fast (a choke, a steal, a retrigger) and stop it. */
  function kill(v, when, secs) {
    if (v.killed) return;
    v.killed = true; v.released = true;
    const t = Math.max(now(when), v.start);
    const g = v.kill.gain, f = Math.max(0.001, typeof secs === 'number' ? secs : SM_KILL);
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(0, t + f);
    stopAt(v, t + f + 0.002);
  }
  function release(v, when) {
    if (v.released) return;
    v.released = true;
    const t = Math.max(now(when), v.start);
    smScheduleRelease(v.rel.gain, t, v.r, v.rSlope, sr);
    if (v.relF) smScheduleRelease(v.relF.gain, t, v.fR, 0, sr);
    if (v.relP) smScheduleRelease(v.relP.gain, t, v.pR, 0, sr);
    stopAt(v, t + Math.max(0.002, v.r) + 0.005);
  }
  function live() { let n = 0; for (const v of voices) if (!v.killed) n++; return n; }

  function hit(group, o, when) {
    const buffer = o && o.buffer;
    if (!buffer) return null;
    const at = now(when);
    const gate = o.mode === 'gate';
    // Legato: a held voice of this sample takes the new pitch (gliding) instead of a new attack.
    if (o.legato) {
      for (const v of voices) {
        if (v.released || v.buffer !== buffer || !v.src.detune) continue;
        const cents = ((o.pitch || 0) - v.pitch) * 100;
        const d = v.src.detune, gl = Math.max(0.003, o.glide || 0);
        d.cancelScheduledValues(at);
        d.setValueAtTime(v.bend, at);
        d.linearRampToValueAtTime(cents, at + gl);
        v.bend = cents;
        v.group = group;
        return v;
      }
    }
    // A choke group cuts every voice in it; a Classic (gate) pad or a retriggering note is one voice at a time.
    for (const v of voices.slice()) if (!v.killed && ((o.choke > 0 && v.choke === o.choke) || ((gate || o.retrigger) && v.group === group))) kill(v, at);
    // Room: the oldest voice goes (a released one first).
    while (live() >= maxVoices) {
      let pick = null;
      for (const v of voices) if (!v.killed && v.released) { pick = v; break; }
      if (!pick) for (const v of voices) if (!v.killed) { pick = v; break; }
      if (!pick) break;
      kill(pick, at);
    }
    const rev = !!o.reverse;
    const d = buffer.duration;
    const st = o.region ? o.region.start : (o.start ?? 0), en = o.region ? o.region.end : (o.end ?? 1);
    const region = dpRegion(d, st, en, rev);
    const looping = gate && !!o.loop;
    let buf = rev ? dpReverse(ctx, buffer) : buffer;
    // The loop: inside start…end, the reversed copy's own seconds when reversed.
    let loopFrom = region.offset, loopTo = region.offset + region.length;
    if (looping) {
      const lo = Math.max(Math.min(st, en), Math.min(1, Math.max(0, o.loopStart ?? 0)));
      // (hi below: the loop end, inside the region.)
      const hi = Math.min(Math.max(st, en), Math.max(0, Math.min(1, o.loopEnd ?? 1)));
      if (hi - lo > 0.0005) { loopFrom = rev ? d - hi * d : lo * d; loopTo = rev ? d - lo * d : hi * d; }
      buf = smLoopBuffer(ctx, buf, loopFrom, loopTo, o.xfade || 0);
    }
    const pitch = (o.pitch || 0) + (o.detune || 0) / 100;
    const rate = dpRate(pitch);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const extra = [];
    let node = src;
    // The filter: 12 dB one biquad, 24 dB two.
    const ft = o.filter && o.filter !== 'off' ? SM_FILTER_TYPE[o.filter.slice(0, 2)] : null;
    const filters = [];
    if (ft) {
      const n = o.filter.slice(2) === '24' ? 2 : 1;
      const res = Math.max(0, Math.min(1, o.res || 0));
      const vel = Math.max(0, Math.min(1, o.velocity ?? 1));
      const f0 = Math.max(20, Math.min(sr / 2 - 100, (o.cutoff || 20000) * Math.pow(2, (o.fVel || 0) * vel / 12)));
      for (let i = 0; i < n; i++) {
        const bq = ctx.createBiquadFilter();
        bq.type = ft;
        bq.frequency.value = f0;
        // Low- and high-pass Q is in dB; band-pass Q is a ratio.
        bq.Q.value = ft === 'bandpass' ? 0.7 + res * 14 : -3 + res * (n === 2 ? 15 : 24);
        node.connect(bq);
        node = bq;
        filters.push(bq);
      }
    }
    const env = ctx.createGain(), rel = ctx.createGain(), killG = ctx.createGain(), vol = ctx.createGain();
    vol.gain.value = Math.max(0, o.volume ?? 0.8) * smVelGain(o.velocity, o.vel ?? 1, o.velCurve || 0);
    const a = o.attack ?? 0.001, dd = o.decay ?? 0.2, s = o.sustain ?? 1;
    const playLen = region.length / rate;
    smSchedule(env.gain, at, smEnvSegments(a, dd, s, o.aSlope || 0, o.dSlope || 0, looping ? Infinity : playLen, o.fadeOut ?? 0.003), 1, sr);
    node.connect(env);
    env.connect(rel);
    rel.connect(killG);
    killG.connect(vol);
    let tail = vol, trem = null, pan = null;
    // The LFO: an oscillator per voice, started with it (so every note swings from the same phase).
    const lfoAmt = Math.max(0, Math.min(1, o.lfoAmt || 0));
    let lfo = null, lfoGain = null;
    if (lfoAmt > 0) {
      lfo = ctx.createOscillator();
      lfo.type = SM_LFO_SHAPES.indexOf(o.lfoShape) >= 0 ? o.lfoShape : 'sine';
      lfo.frequency.value = Math.max(0.01, o.lfoRate || 4);
      lfoGain = ctx.createGain();
      lfo.connect(lfoGain);
      extra.push(lfo);
    }
    const lfoTo = o.lfoTo || 'pitch';
    if (lfo && lfoTo === 'amp') {
      trem = ctx.createGain();
      trem.gain.value = 1 - lfoAmt / 2;
      lfoGain.gain.value = lfoAmt / 2;
      lfoGain.connect(trem.gain);
      tail.connect(trem);
      tail = trem;
    }
    // Stereo in (a mono sample copied to both sides), so the middle is as loud as the sample.
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner(); pan.channelCount = 2; pan.channelCountMode = 'explicit';
      pan.pan.value = Math.max(-1, Math.min(1, o.pan || 0));
      tail.connect(pan); pan.connect(output);
      if (lfo && lfoTo === 'pan') { lfoGain.gain.value = lfoAmt; lfoGain.connect(pan.pan); }
    } else tail.connect(output);
    if (lfo && lfoTo === 'pitch' && src.detune) { lfoGain.gain.value = lfoAmt * 1200; lfoGain.connect(src.detune); }
    if (lfo && lfoTo === 'filter' && filters.length) { lfoGain.gain.value = lfoAmt * 4800; for (const f of filters) lfoGain.connect(f.detune); }
    // The filter envelope, in cents on the filters' detune.
    let relF = null, relP = null;
    if (filters.length && o.fEnv) {
      const c = ctx.createConstantSource();
      smSchedule(c.offset, at, smEnvSegments(o.fA ?? 0.001, o.fD ?? 0.3, o.fS ?? 0, 0, 0, Infinity), 1, sr);
      relF = ctx.createGain();
      const amt = ctx.createGain();
      amt.gain.value = o.fEnv * 100;
      c.connect(relF); relF.connect(amt);
      for (const f of filters) amt.connect(f.detune);
      extra.push(c);
    }
    // The pitch envelope, in cents on the source's detune.
    if (o.pEnv && src.detune) {
      const c = ctx.createConstantSource();
      smSchedule(c.offset, at, smEnvSegments(o.pA ?? 0.001, o.pD ?? 0.2, o.pS ?? 0, 0, 0, Infinity), 1, sr);
      relP = ctx.createGain();
      const amt = ctx.createGain();
      amt.gain.value = o.pEnv * 100;
      c.connect(relP); relP.connect(amt); amt.connect(src.detune);
      extra.push(c);
    }
    // Glide: from the last note's pitch to this one, a straight line in cents.
    if (o.glideFrom && o.glide > 0 && src.detune) {
      src.detune.setValueAtTime(o.glideFrom * 100, at);
      src.detune.linearRampToValueAtTime(0, at + o.glide);
    }
    for (const x of extra) x.start(at);
    const v = {
      group, choke: o.choke || 0, gate, src, env, rel, kill: killG, vol, pan, filters, relF, relP, lfoGain, lfoTo, extra, buffer,
      start: at, r: o.release ?? 0.05, rSlope: o.rSlope || 0, fR: o.fR ?? 0.3, pR: o.pR ?? 0.1, pitch: o.pitch || 0, bend: 0,
      velocity: o.velocity, live: { pitch: o.pitch || 0, detune: o.detune || 0, volume: o.volume ?? 0.8, vel: o.vel ?? 1, velCurve: o.velCurve || 0, pan: o.pan || 0, cutoff: o.cutoff, lfoAmt: lfoAmt },
      released: false, killed: false, stopAt: Infinity,
    };
    // Looping: round and round until let go. Otherwise the region to its end (a Classic voice let go sooner fades over its release).
    if (looping) { src.loop = true; src.loopStart = loopFrom; src.loopEnd = loopTo; src.start(at, region.offset); }
    else { src.start(at, region.offset, region.length); stopAt(v, at + playLen + 0.01); }
    voices.push(v);
    src.onended = () => {
      drop(v);
      for (const x of extra) { try { x.stop(); } catch (e) { /* stopped */ } }
      try { src.disconnect(); env.disconnect(); rel.disconnect(); killG.disconnect(); vol.disconnect(); if (trem) trem.disconnect(); if (pan) pan.disconnect(); for (const f of filters) f.disconnect(); for (const x of extra) x.disconnect(); if (lfoGain) lfoGain.disconnect(); } catch (e) { /* gone */ }
    };
    return v;
  }

  return {
    output,
    hit,
    /** A held group let go: its Classic voices go into their release. */
    release(group, when) { for (const v of voices.slice()) if (v.group === group && v.gate) release(v, when); },
    /**
     * Live numbers on a group's sounding voices, gliding over 10 ms (a mapping
     * moving them): pitch (+ detune), volume (with the voice's own velocity),
     * pan, cutoff, LFO amount. Only what changed is sent.
     */
    setLive(group, o, when) {
      const at = typeof when === 'number' ? when : ctx.currentTime;
      const num = (k, v) => typeof o[k] === 'number' && o[k] !== v.live[k];
      for (const v of voices) {
        if (v.group !== group || v.released) continue;
        const L = v.live;
        if (num('pitch', v) || num('detune', v)) {
          if (typeof o.pitch === 'number') L.pitch = o.pitch;
          if (typeof o.detune === 'number') L.detune = o.detune;
          v.src.playbackRate.setTargetAtTime(dpRate(L.pitch + L.detune / 100), at, 0.01);
        }
        if (num('volume', v) || num('vel', v) || num('velCurve', v)) {
          for (const k of ['volume', 'vel', 'velCurve']) if (typeof o[k] === 'number') L[k] = o[k];
          v.vol.gain.setTargetAtTime(Math.max(0, L.volume) * smVelGain(v.velocity, L.vel, L.velCurve), at, 0.01);
        }
        if (v.pan && num('pan', v)) { L.pan = o.pan; v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, o.pan)), at, 0.01); }
        if (v.filters.length && num('cutoff', v)) { L.cutoff = o.cutoff; for (const f of v.filters) f.frequency.setTargetAtTime(Math.max(20, Math.min(sr / 2 - 100, o.cutoff)), at, 0.01); }
        if (v.lfoGain && num('lfoAmt', v)) {
          const amt = Math.max(0, Math.min(1, o.lfoAmt));
          L.lfoAmt = o.lfoAmt;
          v.lfoGain.gain.setTargetAtTime(v.lfoTo === 'pitch' ? amt * 1200 : v.lfoTo === 'filter' ? amt * 4800 : v.lfoTo === 'amp' ? amt / 2 : amt, at, 0.01);
        }
      }
    },
    /** Cut every voice in a choke group now (or at `when`). */
    choke(group, when) { for (const v of voices.slice()) if (v.choke === group) kill(v, when); },
    stopAll(when) { for (const v of voices.slice()) kill(v, when); },
    /** Voices sounding (a group's, or all). */
    playing(group) { let n = 0; for (const v of voices) if (!v.released && (group === undefined || v.group === group)) n++; return n; },
    setVoices(n) { maxVoices = Math.max(1, Math.min(64, Math.round(n) || 1)); },
  };
}

// ── A hit's voices, from a layer record ───────────────────────────────────────

/**
 * What a hit on pad `pad` (0-based) with velocity `vel` plays, from a Sampler
 * layer record `l` (types/playLayers.ts SamplerLayer; plain JSON, so web
 * exports use it as is):
 *
 *   env.num(key)       a layer number now (mappings applied), or undefined
 *   env.buffer(sound)  a pad's or zone's decoded sample, or null
 *   env.state          per-layer memory: { hits, lastPitch } (round robin, random picks, glide)
 *   slot               a take's record of what played (1-based pad or zone), so a render repeats it
 *
 * Returns { voices: [{ group, o }], slot }: each voice for smCreateSampler's
 * hit, and the slot to record.
 */
export function smHits(l, pad, vel, env, slot) {
  const st = env.state || (env.state = { hits: 0, lastPitch: null });
  // A take's slot says what played: no new pick, so the count only moves on a fresh pick.
  if (!(slot >= 1)) st.hits = (st.hits || 0) + 1;
  const n = st.hits || 1;
  const out = { voices: [], slot: 0 };
  if (l.view === 'keys') return smKeyHits(l, pad, vel, env, slot, st, n, out);
  // Drum view: the Sample index picks which pad's sound plays (docs/drum-pads.md "Sample index").
  const pads = l.pads || [];
  const has = i => { const p = pads[i]; return !!p && (!!p.sampleId || !!p.synth); };
  let src = pad;
  if (slot >= 1 && slot <= SM_PADS) src = slot - 1;
  else {
    const slots = dpSlots(has, Math.max(pads.length, 16));
    const index = env.num('sampleIndex');
    const spread = env.num('indexSpread');
    src = dpPickPad(slots, pad, typeof index === 'number' ? index : 0, l.indexMode || 'index', typeof spread === 'number' ? spread : 0, dpHash01(l.indexSeed || 0, n));
  }
  const p = pads[src] || pads[pad];
  out.slot = src + 1;
  if (!p) return out;
  const buffer = env.buffer(p);
  if (!buffer) return out;
  const o = smNumbers(k => env.num(dpKey(src, k)));
  Object.assign(o, { buffer, mode: p.mode, loop: !!p.loop, reverse: !!p.reverse, choke: p.choke || 0, filter: p.filter || 'off', lfoShape: p.lfoShape || 'sine', lfoTo: p.lfoTo || 'pitch', velocity: vel });
  out.voices.push({ group: pad, o });
  return out;
}

/** Does zone z cover note and velocity (1..127)? */
export function smZoneHas(z, note, v127) { return note >= z.lo && note <= z.hi && v127 >= (z.vlo ?? 1) && v127 <= (z.vhi ?? 127); }

function smKeyHits(l, pad, vel, env, slot, st, n, out) {
  const zones = l.zones || [];
  const inst = l.inst || {};
  const note = smNoteOfPad(pad, typeof l.baseNote === 'number' ? l.baseNote : 36);
  const k = key => env.num(smKeyProp(key));
  const g = smNumbers(k);
  const v127 = Math.max(1, Math.min(127, Math.round(vel * 127)));
  const base = { volume: g.volume, pan: g.pan, attack: g.attack, decay: g.decay, sustain: g.sustain, release: g.release, vel: g.vel, velCurve: g.velCurve,
    fadeOut: g.fadeOut, aSlope: g.aSlope, dSlope: g.dSlope, rSlope: g.rSlope, cutoff: g.cutoff, res: g.res, fEnv: g.fEnv, fA: g.fA, fD: g.fD, fS: g.fS, fR: g.fR, fVel: g.fVel,
    pEnv: g.pEnv, pA: g.pA, pD: g.pD, pS: g.pS, pR: g.pR, lfoRate: g.lfoRate, lfoAmt: g.lfoAmt, glide: g.glide,
    filter: inst.filter || 'off', lfoShape: inst.lfoShape || 'sine', lfoTo: inst.lfoTo || 'pitch', velocity: vel,
    retrigger: inst.retrigger !== false, legato: !!inst.legato && (inst.voices || 8) === 1 };
  const voice = (z, pitch, region, mode) => {
    const buffer = env.buffer(z);
    if (!buffer) return;
    const o = Object.assign({}, base, {
      buffer, pitch, detune: g.detune + (z.detune || 0), volume: g.volume * (typeof z.gain === 'number' ? z.gain : 1), pan: Math.max(-1, Math.min(1, g.pan + (z.pan || 0))),
      start: z.start ?? 0, end: z.end ?? 1, loopStart: z.loopStart ?? 0, loopEnd: z.loopEnd ?? 1, xfade: z.xfade || 0, loop: !!z.loop, reverse: !!z.reverse,
      mode: mode === 'oneshot' ? 'oneshot' : 'gate', region,
    });
    if (o.glide > 0 && typeof st.lastPitch === 'number' && st.lastPitch !== pitch) o.glideFrom = st.lastPitch - pitch;
    out.voices.push({ group: pad, o });
  };
  if (inst.mode === 'slice') {
    const z = zones[0];
    if (!z) return out;
    const cuts = (z.slices && z.slices.length ? z.slices : [z.start ?? 0]).filter(x => x >= (z.start ?? 0) && x < (z.end ?? 1));
    if (pad >= cuts.length) return out;
    const region = { start: cuts[pad], end: pad + 1 < cuts.length ? cuts[pad + 1] : (z.end ?? 1) };
    voice(z, g.pitch + (z.tune || 0), region, inst.sliceGate ? 'gate' : 'oneshot');
    out.slot = 1;
    return out;
  }
  const hits = [];
  zones.forEach((z, i) => { if (smZoneHas(z, note, v127)) hits.push(i); });
  let chosen = hits;
  if (slot >= 1) chosen = zones[slot - 1] ? [slot - 1] : [];
  else if (hits.length > 1 && inst.select === 'cycle') chosen = [hits[(n - 1) % hits.length]];
  else if (hits.length > 1 && inst.select === 'random') chosen = [hits[Math.floor(dpHash01(inst.seed || 0, n) * hits.length) % hits.length]];
  if (inst.select === 'cycle' || inst.select === 'random') out.slot = chosen.length ? chosen[0] + 1 : 0;
  let pitch = g.pitch;
  for (const i of chosen) {
    const z = zones[i];
    pitch = g.pitch + (z.track === false ? 0 : note - z.root) + (z.tune || 0);
    voice(z, pitch, null, inst.mode);
  }
  // A dry run (a pick made before the hit is recorded) leaves glide's memory alone.
  if (chosen.length && !env.dry) st.lastPitch = pitch;
  return out;
}
