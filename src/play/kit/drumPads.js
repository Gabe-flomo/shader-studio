/**
 * drumPads.js — the Drum pad layer's sampler (docs/drum-pads.md): a grid of
 * pads, each playing a sample Simpler-style. Plain Web Audio and plain math,
 * so the app (play/drumPads.ts), offline renders (lib/recordingAudio.ts, an
 * OfflineAudioContext) and website exports (runtime/play-runtime.js, through
 * the inlined kit as SSKit.drumPads) play a hit the same way. Every top-level
 * name starts `dp`/`DP_` (the kit's files share one scope in exports).
 *
 *   DP_PARAMS          each pad's numbers (a layer property `pad<N>_<key>`, so
 *                      every one is a mapping target)
 *   dpRate / dpRegion  pitch → playback rate; start/end (and reverse) → where
 *                      in the buffer and for how long
 *   dpEnvAt / dpEnvPoints  the amp envelope (linear attack and decay to the
 *                      sustain level, a linear release), pure
 *   dpCreateSampler    voices into one output: hit, release (gate pads), choke
 *                      groups, live pitch / volume / pan on sounding voices
 *   dpSynthData        small generated drums (kick, snare, hats…), so an
 *                      example needs no audio files
 */

const DP_P = (key, label, min, max, step, value, unit, hint) => ({ key, label, min, max, step, value, unit: unit || '', hint: hint || '' });

export const DP_PADS = 16;
export const DP_COLS = 4;

/** Each pad's numbers: range, step, default, unit, hint. */
export const DP_PARAMS = [
  DP_P('start', 'Start', 0, 1, 0.001, 0, '', 'Where the pad starts in its sample (0 = the beginning, 1 = the end). Drag the left edge on the waveform.'),
  DP_P('end', 'End', 0, 1, 0.001, 1, '', 'Where the pad stops in its sample. With Loop, start to end is the loop.'),
  DP_P('pitch', 'Pitch', -24, 24, 0.01, 0, 'st', 'Semitones up or down. It plays faster or slower, like tape.'),
  DP_P('volume', 'Volume', 0, 1.5, 0.01, 0.8, '', 'How loud the pad is (before the layer’s volume).'),
  DP_P('pan', 'Pan', -1, 1, 0.01, 0, '', 'Left (−1) to right (1).'),
  DP_P('attack', 'Attack', 0, 2, 0.001, 0.001, 's', 'Time to rise to full level.'),
  DP_P('decay', 'Decay', 0, 4, 0.001, 0.2, 's', 'Time to fall from full level to Sustain.'),
  DP_P('sustain', 'Sustain', 0, 1, 0.01, 1, '', 'The level held after the decay (1: no decay).'),
  DP_P('release', 'Release', 0, 4, 0.001, 0.05, 's', 'Gate pads: time to fade out once the pad is let go.'),
  DP_P('vel', 'Velocity', 0, 1, 0.01, 1, '', 'How much a hit’s velocity sets its volume: 0 plays every hit the same, 1 a soft hit quietly.'),
];
export const DP_PARAM_KEYS = DP_PARAMS.map(p => p.key);
export const DP_MODES = ['oneshot', 'gate'];
export const DP_CHOKES = 8;
/** Generated sounds a pad can play without a file. */
export const DP_SYNTHS = ['kick', 'snare', 'hat', 'openhat', 'clap', 'tom', 'rim', 'cowbell'];
/** Keys for pads 1–16: the bottom row Z X C V (pads 1–4) up to 1 2 3 4 (pads 13–16), like the pads. */
export const DP_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];
/** Notes 36–51 play pads 1–16 (a drum rack's layout), from the layer's base note. */
export const DP_BASE_NOTE = 36;

/** A pad number's layer property: dpKey(0, 'pitch') → 'pad1_pitch'. */
export function dpKey(i, key) { return 'pad' + (i + 1) + '_' + key; }
/** A layer property's pad and number, or null: 'pad3_pitch' → { pad: 2, key: 'pitch' }. */
export function dpKeyParts(k) {
  const m = /^pad(\d{1,2})_([a-z]+)$/.exec(k);
  if (!m) return null;
  const pad = Number(m[1]) - 1;
  return pad >= 0 && pad < DP_PADS && DP_PARAM_KEYS.indexOf(m[2]) >= 0 ? { pad: pad, key: m[2] } : null;
}
export function dpParam(key) { for (const p of DP_PARAMS) if (p.key === key) return p; return null; }
export function dpClamp(key, v) {
  const p = dpParam(key);
  if (!p) return v;
  return typeof v === 'number' && isFinite(v) ? Math.max(p.min, Math.min(p.max, v)) : p.value;
}

/** The pad a key plays (0-based), or -1. */
export function dpPadOfKey(code) { return DP_KEYS.indexOf(code); }
/** The pad a note plays from `base` (0-based), or -1 outside the pads. */
export function dpPadOfNote(note, base) { const i = note - base; return i >= 0 && i < DP_PADS ? i : -1; }
/** The pad under a grid cell (col, row from the bottom left), for the lower-left 4 × 4 of a pad grid; -1 outside. */
export function dpPadOfCell(col, row) { return col >= 0 && col < DP_COLS && row >= 0 && row < DP_PADS / DP_COLS ? row * DP_COLS + col : -1; }

/** Semitones → playback rate. */
export function dpRate(pitch) { return Math.pow(2, (pitch || 0) / 12); }
/** A hit's gain from its velocity (0..1): `amount` 0 ignores it, 1 follows it all the way. */
export function dpVelGain(vel, amount) {
  const v = Math.max(0, Math.min(1, typeof vel === 'number' ? vel : 1)), a = Math.max(0, Math.min(1, amount));
  return 1 - a + a * v;
}

/**
 * Where a pad plays in a sample `duration` seconds long: `offset` into the
 * buffer it plays (the reversed copy when `reverse`) and `length` of it, both
 * in buffer seconds. Start and end are 0..1 either way round, at least 1 ms apart.
 */
export function dpRegion(duration, start, end, reverse) {
  const d = Math.max(0, duration || 0);
  let s = Math.max(0, Math.min(1, Math.min(start, end))) * d, e = Math.max(0, Math.min(1, Math.max(start, end))) * d;
  if (e - s < 0.001) { e = Math.min(d, s + 0.001); s = Math.max(0, e - 0.001); }
  return { offset: reverse ? d - e : s, length: e - s };
}

/** The envelope's level `t` seconds after the hit (before any release), peak 1. */
export function dpEnvAt(t, attack, decay, sustain) {
  const a = Math.max(0.001, attack), d = Math.max(0, decay), s = Math.max(0, Math.min(1, sustain));
  if (t <= 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * (t - a) / d;
  return s;
}

/**
 * The envelope as points [seconds after the hit, level], joined by straight
 * lines, up to `until` (a one-shot's end: the level there, then 0 over 3 ms,
 * so it never clicks).
 */
export function dpEnvPoints(attack, decay, sustain, until) {
  const a = Math.max(0.001, attack), d = Math.max(0, decay), s = Math.max(0, Math.min(1, sustain));
  const pts = [[0, 0], [a, 1], [a + d, s]];
  if (!(until > 0) || !isFinite(until)) return pts;
  const fade = Math.min(0.003, until / 2), cut = until - fade;
  const out = pts.filter(p => p[0] < cut);
  out.push([cut, dpEnvAt(cut, a, d, s)], [until, 0]);
  return out;
}

const dpReversed = new WeakMap();
/** A buffer played backwards (made once per buffer). */
export function dpReverse(ctx, buffer) {
  let r = dpReversed.get(buffer);
  if (r) return r;
  r = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const from = buffer.getChannelData(c), to = r.getChannelData(c), n = from.length;
    for (let i = 0; i < n; i++) to[i] = from[n - 1 - i];
  }
  dpReversed.set(buffer, r);
  return r;
}

/** The numbers a hit reads, with defaults for any missing. */
export function dpHitNumbers(get) {
  const o = {};
  for (const p of DP_PARAMS) { const v = get(p.key); o[p.key] = typeof v === 'number' && isFinite(v) ? Math.max(p.min, Math.min(p.max, v)) : p.value; }
  return o;
}

/**
 * A sampler: its voices sum into `output`. `hit(pad, o, when)` plays
 * o.buffer with the pad's numbers (o.start, o.end, o.pitch, o.volume, o.pan,
 * o.attack, o.decay, o.sustain, o.release, o.vel), o.mode ('oneshot' plays to
 * the end; 'gate' until `release`), o.loop (gate: start to end, round and
 * round while held), o.reverse, o.choke (1..8: a hit cuts every voice in its
 * group) and o.velocity (the hit's, 0..1).
 */
export function dpCreateSampler(ctx) {
  const output = ctx.createGain();
  const voices = [];
  const drop = v => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); };
  function fadeOut(v, when, secs) {
    if (v.released) return;
    v.released = true;
    const t = Math.max(when, v.start);
    const level = dpEnvAt(t - v.start, v.a, v.d, v.s);
    const g = v.env.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(level, t);
    g.linearRampToValueAtTime(0, t + Math.max(0.002, secs));
    try { v.src.stop(t + Math.max(0.002, secs) + 0.005); } catch (e) { /* already stopped */ }
  }
  return {
    output,
    hit(pad, o, when) {
      const buffer = o && o.buffer;
      if (!buffer) return null;
      const at = Math.max(ctx.currentTime, typeof when === 'number' ? when : ctx.currentTime);
      const gate = o.mode === 'gate';
      // A choke group cuts every voice in it; a gate pad is one voice at a time.
      for (const v of voices.slice()) if ((o.choke > 0 && v.choke === o.choke) || (gate && v.pad === pad)) fadeOut(v, at, 0.004);
      const buf = o.reverse ? dpReverse(ctx, buffer) : buffer;
      const region = dpRegion(buffer.duration, o.start ?? 0, o.end ?? 1, !!o.reverse);
      const rate = dpRate(o.pitch);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const env = ctx.createGain(), vol = ctx.createGain();
      vol.gain.value = Math.max(0, o.volume ?? 0.8) * dpVelGain(o.velocity, o.vel ?? 1);
      const a = o.attack ?? 0.001, d = o.decay ?? 0.2, s = o.sustain ?? 1;
      const looping = gate && !!o.loop;
      const playLen = region.length / rate;
      const pts = dpEnvPoints(a, d, s, looping ? Infinity : playLen);
      env.gain.setValueAtTime(0, at);
      for (let i = 1; i < pts.length; i++) env.gain.linearRampToValueAtTime(pts[i][1], at + pts[i][0]);
      src.connect(env);
      env.connect(vol);
      let pan = null;
      // Stereo in (a mono sample copied to both sides), so the middle is as loud as the sample.
      if (ctx.createStereoPanner) { pan = ctx.createStereoPanner(); pan.channelCount = 2; pan.channelCountMode = 'explicit'; pan.pan.value = Math.max(-1, Math.min(1, o.pan || 0)); vol.connect(pan); pan.connect(output); } else vol.connect(output);
      if (looping) { src.loop = true; src.loopStart = region.offset; src.loopEnd = region.offset + region.length; src.start(at, region.offset); }
      else { src.start(at, region.offset, region.length); src.stop(at + playLen + 0.01); }
      const v = { pad, choke: o.choke || 0, gate, src, env, vol, pan, start: at, a, d, s, r: o.release ?? 0.05, released: false };
      voices.push(v);
      src.onended = () => { drop(v); try { src.disconnect(); env.disconnect(); vol.disconnect(); if (pan) pan.disconnect(); } catch (e) { /* gone */ } };
      return v;
    },
    /** A gate pad let go: its voices fade over their release. */
    release(pad, when) {
      const at = Math.max(ctx.currentTime, typeof when === 'number' ? when : ctx.currentTime);
      for (const v of voices.slice()) if (v.pad === pad && v.gate) fadeOut(v, at, v.r);
    },
    /** Pitch, volume and pan of a pad's sounding voices, gliding (a mapping moving them). */
    setLive(pad, o, when) {
      const at = typeof when === 'number' ? when : ctx.currentTime;
      for (const v of voices) {
        if (v.pad !== pad || v.released) continue;
        if (typeof o.pitch === 'number') v.src.playbackRate.setTargetAtTime(dpRate(o.pitch), at, 0.01);
        if (typeof o.volume === 'number') v.vol.gain.setTargetAtTime(Math.max(0, o.volume) * dpVelGain(o.velocity, o.vel ?? 1), at, 0.01);
        if (v.pan && typeof o.pan === 'number') v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, o.pan)), at, 0.01);
      }
    },
    stopAll(when) { const at = typeof when === 'number' ? when : ctx.currentTime; for (const v of voices.slice()) fadeOut(v, at, 0.004); },
    /** Sounding voices (a pad's, or all). */
    playing(pad) { let n = 0; for (const v of voices) if (!v.released && (pad === undefined || v.pad === pad)) n++; return n; },
  };
}

// ── Generated drums ─────────────────────────────────────────────────────────

function dpNoise(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return (x / 4294967296) * 2 - 1; };
}

/** A generated drum (one of DP_SYNTHS) as mono samples at `rate`: short, seeded, the same every time. */
export function dpSynthData(kind, rate) {
  const sr = rate || 44100;
  const secs = { kick: 0.5, snare: 0.35, hat: 0.1, openhat: 0.5, clap: 0.4, tom: 0.45, rim: 0.08, cowbell: 0.35 }[kind] || 0.3;
  const n = Math.max(1, Math.round(secs * sr));
  const out = new Float32Array(n);
  const rnd = dpNoise(DP_SYNTHS.indexOf(kind) * 7919 + 17);
  let ph = 0, ph2 = 0, prev = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    const white = rnd(), hp = white - prev; prev = white;
    if (kind === 'kick') {
      const f = 45 + 110 * Math.exp(-t / 0.035);
      ph += (2 * Math.PI * f) / sr;
      v = Math.sin(ph) * Math.exp(-t / 0.16) + 0.3 * white * Math.exp(-t / 0.003);
    } else if (kind === 'snare') {
      ph += (2 * Math.PI * 185) / sr;
      v = 0.55 * Math.sin(ph) * Math.exp(-t / 0.05) + 0.6 * hp * Math.exp(-t / 0.09);
    } else if (kind === 'hat' || kind === 'openhat') {
      v = 0.7 * hp * Math.exp(-t / (kind === 'hat' ? 0.025 : 0.16));
    } else if (kind === 'clap') {
      lp += 0.35 * (hp - lp);
      const burst = t < 0.03 ? Math.exp(-((t % 0.01) / 0.003)) : Math.exp(-(t - 0.03) / 0.09);
      v = 1.4 * lp * burst;
    } else if (kind === 'tom') {
      const f = 95 + 45 * Math.exp(-t / 0.08);
      ph += (2 * Math.PI * f) / sr;
      v = Math.sin(ph) * Math.exp(-t / 0.14);
    } else if (kind === 'rim') {
      ph += (2 * Math.PI * 820) / sr;
      v = (Math.sin(ph) * 0.8 + 0.3 * hp) * Math.exp(-t / 0.012);
    } else if (kind === 'cowbell') {
      ph += (2 * Math.PI * 545) / sr; ph2 += (2 * Math.PI * 815) / sr;
      v = 0.35 * (Math.sign(Math.sin(ph)) + Math.sign(Math.sin(ph2))) * Math.exp(-t / 0.08);
    }
    out[i] = v;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  // Fade the last 2 ms so it never ends with a click.
  const f = Math.min(n, Math.round(0.002 * sr));
  for (let i = 0; i < f; i++) out[n - 1 - i] *= i / f;
  return out;
}

/** A generated drum as an AudioBuffer in `ctx` (mono). */
export function dpSynthBuffer(ctx, kind) {
  const data = dpSynthData(kind, ctx.sampleRate);
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.getChannelData(0).set(data);
  return b;
}

/** The loudest sample in each of `n` slices (0..1), for a waveform. */
export function dpPeaks(data, n) {
  const out = new Float32Array(n), per = Math.max(1, Math.floor(data.length / n));
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(data.length, (i + 1) * per);
    for (let j = i * per; j < end; j++) { const a = Math.abs(data[j]); if (a > m) m = a; }
    out[i] = m;
  }
  return out;
}
