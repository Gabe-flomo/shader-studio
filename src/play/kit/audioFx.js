/**
 * audioFx.js — built-in audio effects: an ordered chain of Filter, Echo,
 * Reverb, Distortion and Compressor on a sound (an audio layer's song, a
 * Video layer's sound, an Audio Input node's song, the MIDI synth) or on the
 * master bus. Plain Web Audio, so the app (lib/audioFx.ts), offline renders
 * (lib/recordingAudio.ts, an OfflineAudioContext) and website exports
 * (runtime/play-runtime.js, through the inlined kit as SSKit.audioFx) build
 * the same graph from the same record. Every top-level name starts `af`/`AF_`
 * (the kit's files share one scope in exports).
 *
 *   afCreateChain(ctx)   an input and an output GainNode with the chain's
 *                        effects between them. `update(chain, valueOf, when)`
 *                        rebuilds the graph when the order, the kinds or an
 *                        option changed, and otherwise moves the numbers
 *                        (smoothed with setTargetAtTime, so a mapping never clicks)
 *   afCurve(kind, bits)  the distortion's WaveShaper curves (pure, tested)
 *   afImpulse(...)       a reverb's impulse response, generated (room, hall,
 *                        plate), seeded so a render sounds like playback
 *   afLoadWorklet(ctx)   the bitcrusher's sample-rate reducer (an AudioWorklet);
 *                        without it Bitcrush still reduces the bit depth
 */

const AF_P = (key, label, min, max, step, value, unit, hint) => ({ key, label, min, max, step, value, unit: unit || '', hint: hint || '', hidden: false });

/** Note values for a tempo-synced echo, in beats. */
export const AF_SYNC = { off: 0, '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/4d': 1.5, '1/8d': 0.75, '1/4t': 2 / 3, '1/8t': 1 / 3 };

/**
 * Every effect: its label, a one-line summary, its numbers (each one a
 * mapping target) and its options (not numbers: changing one rebuilds the
 * effect). Option lists give the choices, the first being the default.
 */
export const AF_EFFECTS = {
  filter: {
    label: 'Filter', icon: 'wave', summary: 'Low-pass, high-pass, band-pass or notch, with resonance and an LFO',
    params: [
      AF_P('cutoff', 'Cutoff', 20, 20000, 1, 2000, 'Hz', 'Where the filter bites. Map it with an Exp curve for an even sweep.'),
      AF_P('resonance', 'Resonance', 0.1, 20, 0.01, 0.71, 'Q', 'A peak at the cutoff: 0.71 is flat, higher rings and whistles.'),
      AF_P('lfoRate', 'LFO rate', 0, 20, 0.01, 0, 'Hz', 'The cutoff wobbles this many times a second (0: still).'),
      AF_P('lfoDepth', 'LFO depth', 0, 4, 0.01, 1, 'oct', 'How far the LFO moves the cutoff, in octaves either way.'),
    ],
    options: { type: ['lowpass', 'highpass', 'bandpass', 'notch'] },
  },
  echo: {
    label: 'Echo', icon: 'loop', summary: 'A delay with feedback: free time or synced to a tempo, ping-pong, a filter in the loop',
    params: [
      AF_P('time', 'Time', 1, 2000, 1, 375, 'ms', 'Between repeats (when Sync is Off).'),
      AF_P('bpm', 'Tempo', 30, 300, 0.1, 120, 'BPM', 'The tempo a synced echo follows.'),
      AF_P('feedback', 'Feedback', 0, 0.95, 0.01, 0.4, '', 'How much of each repeat comes back: more is longer tails.'),
      AF_P('tone', 'Tone', 200, 16000, 1, 4000, 'Hz', 'A low-pass in the loop: each repeat is darker than the last.'),
      AF_P('mix', 'Mix', 0, 1, 0.01, 0.35, '', 'Dry to wet.'),
    ],
    options: { sync: Object.keys(AF_SYNC), pingpong: [false, true] },
  },
  reverb: {
    label: 'Reverb', icon: 'spark', summary: 'A room, a hall or a plate: size, decay, pre-delay, damping',
    params: [
      AF_P('size', 'Size', 0, 1, 0.01, 0.5, '', 'How big the space is: spreads the early reflections and softens the onset.'),
      AF_P('decay', 'Decay', 0.1, 10, 0.01, 1.8, 's', 'Time for the tail to fall 60 dB.'),
      AF_P('predelay', 'Pre-delay', 0, 250, 1, 12, 'ms', 'A gap before the reverb starts, to keep the dry sound clear.'),
      AF_P('damping', 'Damping', 0, 1, 0.01, 0.4, '', 'Darkens the reverb: soft walls, curtains, an audience.'),
      AF_P('mix', 'Mix', 0, 1, 0.01, 0.3, '', 'Dry to wet.'),
    ],
    options: { type: ['room', 'hall', 'plate'] },
  },
  distortion: {
    label: 'Distortion', icon: 'bolt', summary: 'Soft, hard clip, wavefold, tube or bitcrush: drive, tone, mix, output',
    params: [
      AF_P('drive', 'Drive', 0, 1, 0.01, 0.4, '', 'How hard the sound is pushed into the curve (up to +36 dB).'),
      AF_P('tone', 'Tone', 200, 20000, 1, 9000, 'Hz', 'A low-pass after the curve to tame the fizz.'),
      AF_P('bits', 'Bits', 1, 12, 1, 6, '', 'Bitcrush: the bit depth (fewer is grittier).'),
      AF_P('downsample', 'Downsample', 1, 32, 1, 1, '×', 'Bitcrush: hold each sample this many times (a lower sample rate).'),
      AF_P('mix', 'Mix', 0, 1, 0.01, 1, '', 'Dry to wet.'),
      AF_P('output', 'Output', -24, 12, 0.1, 0, 'dB', 'Level after the effect.'),
    ],
    options: { curve: ['soft', 'hard', 'fold', 'tube', 'bitcrush'] },
  },
  compressor: {
    label: 'Compressor', icon: 'sliders', summary: 'Evens out the level: threshold, ratio, attack, release, makeup',
    params: [
      AF_P('threshold', 'Threshold', -60, 0, 0.1, -24, 'dB', 'Above this level the sound is turned down.'),
      AF_P('ratio', 'Ratio', 1, 20, 0.1, 4, ':1', 'How much: 4 turns 4 dB over the threshold into 1.'),
      AF_P('knee', 'Knee', 0, 40, 0.1, 12, 'dB', 'How gently it starts.'),
      AF_P('attack', 'Attack', 0, 1000, 0.1, 5, 'ms', 'How fast it turns down.'),
      AF_P('release', 'Release', 10, 1000, 1, 250, 'ms', 'How fast it lets go.'),
      AF_P('makeup', 'Makeup', -12, 24, 0.1, 0, 'dB', 'Gain after, to win back the level.'),
    ],
    options: {},
  },
};
export const AF_KINDS = ['filter', 'echo', 'reverb', 'distortion', 'compressor'];

/** Which numbers each kind shows for an option (Bits and Downsample only mean something to Bitcrush). */
export function afShownParams(e) {
  const def = AF_EFFECTS[e.kind];
  if (!def) return [];
  if (e.kind === 'distortion' && e.curve !== 'bitcrush') return def.params.filter(p => p.key !== 'bits' && p.key !== 'downsample');
  if (e.kind === 'echo' && e.sync && e.sync !== 'off') return def.params.filter(p => p.key !== 'time');
  if (e.kind === 'echo') return def.params.filter(p => p.key !== 'bpm');
  return def.params;
}

/** A new effect at its defaults. */
export function afNewEffect(kind, id) {
  const def = AF_EFFECTS[kind];
  const e = { id, kind, enabled: true };
  for (const p of def.params) e[p.key] = p.value;
  for (const [k, list] of Object.entries(def.options)) e[k] = list[0];
  return e;
}

/** A number, clamped to the param's range (non-numbers take the default). */
export function afClamp(p, v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : p.value;
  return Math.min(p.max, Math.max(p.min, n));
}

/** An effect read from a file: a known kind, every number in range, every option one of its choices. Null for an unknown kind. */
export function afNormaliseEffect(raw, fallbackId) {
  if (!raw || typeof raw !== 'object' || !AF_EFFECTS[raw.kind]) return null;
  const def = AF_EFFECTS[raw.kind];
  const e = { id: typeof raw.id === 'string' && raw.id ? raw.id.replace(/[:\s]/g, '_') : fallbackId, kind: raw.kind, enabled: raw.enabled !== false };
  for (const p of def.params) e[p.key] = afClamp(p, raw[p.key]);
  for (const [k, list] of Object.entries(def.options)) e[k] = list.includes(raw[k]) ? raw[k] : list[0];
  return e;
}

// ── Distortion curves ────────────────────────────────────────────────────────

/**
 * The shaper's input spans ±AF_SPAN of the signal: the drive gain goes in
 * before it divided by AF_SPAN, so up to +18 dB of drive stays on the curve
 * (beyond it the WaveShaper holds the curve's ends).
 */
export const AF_SPAN = 8;

/** One curve, evaluated at x (the signal after the drive). */
export function afShape(kind, x, bits) {
  switch (kind) {
    case 'hard': return Math.max(-1, Math.min(1, x));
    case 'fold': {
      // Reflect back into ±1 each time it passes an edge (a triangle fold).
      const t = (((x + 1) % 4) + 4) % 4;
      return t < 2 ? t - 1 : 3 - t;
    }
    case 'tube': {
      // Asymmetric: the positive half saturates early, the negative half late (even harmonics).
      return x >= 0 ? Math.tanh(x * 1.2) : Math.tanh(x * 0.7) * 0.9;
    }
    case 'bitcrush': {
      const levels = Math.pow(2, Math.max(1, Math.min(16, Math.round(bits || 8))) - 1);
      const c = Math.max(-1, Math.min(1, x));
      return Math.round(c * levels) / levels;
    }
    default: return Math.tanh(x);
  }
}

/** The WaveShaper curve for a kind, across ±AF_SPAN (finer for bitcrush so its steps stay steps). */
export function afCurve(kind, bits) {
  const n = kind === 'bitcrush' ? (bits > 8 ? 65537 : 16385) : 8193;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = afShape(kind, ((i / (n - 1)) * 2 - 1) * AF_SPAN, bits);
  return out;
}

/** Drive (0..1) as a gain: 0 dB to +36 dB. */
export const afDriveGain = drive => Math.pow(10, (Math.max(0, Math.min(1, drive)) * 36) / 20);
/** dB to gain. */
export const afDb = db => Math.pow(10, db / 20);
/** Equal-power dry and wet for a mix 0..1. */
export const afMix = mix => { const m = Math.max(0, Math.min(1, mix)); return [Math.cos(m * Math.PI / 2), Math.sin(m * Math.PI / 2)]; };
/** Damping 0..1 as the reverb's low-pass: 20 kHz down to about 600 Hz. */
export const afDampHz = d => 20000 * Math.pow(0.03, Math.max(0, Math.min(1, d)));

/** An echo's time in seconds: its own, or a note value at its tempo. */
export function afEchoSeconds(e) {
  const beats = AF_SYNC[e.sync] || 0;
  const s = beats > 0 ? (60 / Math.max(1, e.bpm || 120)) * beats : (e.time || 0) / 1000;
  return Math.max(0.001, Math.min(AF_MAX_DELAY - 0.01, s));
}
export const AF_MAX_DELAY = 5;

// ── Reverb impulse responses ────────────────────────────────────────────────

const AF_ROOMS = {
  room: { attack: 0.002, early: 14, spread: 0.035, bright: 0.55, width: 0.6 },
  hall: { attack: 0.02, early: 10, spread: 0.08, bright: 0.35, width: 0.9 },
  plate: { attack: 0.0005, early: 0, spread: 0, bright: 0.8, width: 1 },
};

/** A small seeded random (so the same settings give the same reverb everywhere). */
function afRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * A reverb's impulse response as two channels of samples: noise under an
 * exponential decay (−60 dB at `decay` seconds) that darkens as it goes, with
 * a room's early reflections in front and a gentle onset (both grow with size).
 */
export function afImpulseData(sampleRate, type, size, decay) {
  const r = AF_ROOMS[type] || AF_ROOMS.room;
  const d = Math.max(0.1, Math.min(10, decay));
  const sz = Math.max(0, Math.min(1, size));
  const len = Math.max(64, Math.floor(Math.min(12, d * 1.2 + 0.05) * sampleRate));
  const attack = r.attack + sz * 0.03;
  const out = [];
  for (let ch = 0; ch < 2; ch++) {
    const rnd = afRandom(1234 + ch * 777);
    const data = new Float32Array(len);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const env = Math.exp((-6.907755 * t) / d) * Math.min(1, t / attack);
      // Darker as it goes: the one-pole's coefficient falls with time.
      const a = Math.max(0.02, r.bright * Math.exp(-t * 2 / d));
      lp += a * ((rnd() * 2 - 1) - lp);
      data[i] = lp * env * (1 + (1 - a));
    }
    // Early reflections: a few taps inside the first 3 + (spread × size × 1000) ms.
    for (let k = 0; k < r.early; k++) {
      const at = Math.floor((0.003 + rnd() * r.spread * (0.3 + sz)) * sampleRate);
      if (at < len) data[at] += (rnd() < 0.5 ? -1 : 1) * (0.9 - (k / r.early) * 0.6) * (1 - r.width * 0.3 * ch);
    }
    out.push(data);
  }
  return out;
}

export function afImpulse(ctx, type, size, decay) {
  const [l, r] = afImpulseData(ctx.sampleRate, type, size, decay);
  const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
  buf.getChannelData(0).set(l);
  buf.getChannelData(1).set(r);
  return buf;
}

// ── The bitcrusher's sample-rate reducer (an AudioWorklet) ───────────────────

export const AF_HOLD_SOURCE = `class AfHold extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'hold', defaultValue: 1, minValue: 1, maxValue: 64, automationRate: 'k-rate' }]; }
  constructor() { super(); this.n = 0; this.v = [0, 0, 0, 0, 0, 0, 0, 0]; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], h = Math.max(1, Math.round(params.hold[0]));
    const len = out[0] ? out[0].length : 128;
    for (let i = 0; i < len; i++) {
      if (this.n <= 0) { for (let c = 0; c < out.length; c++) this.v[c] = inp[c] ? inp[c][i] : (inp[0] ? inp[0][i] : 0); this.n = h; }
      this.n--;
      for (let c = 0; c < out.length; c++) out[c][i] = this.v[c];
    }
    return true;
  }
}
registerProcessor('af-hold', AfHold);`;

const afWorklets = new WeakMap();
/** Load the reducer into a context once (resolves false where AudioWorklet or Blob URLs aren't there). */
export function afLoadWorklet(ctx) {
  let p = afWorklets.get(ctx);
  if (p) return p.promise;
  p = { ready: false, promise: null };
  afWorklets.set(ctx, p);
  const entry = p;
  p.promise = (async () => {
    try {
      if (!ctx.audioWorklet || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
      const url = URL.createObjectURL(new Blob([AF_HOLD_SOURCE], { type: 'application/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      entry.ready = true;
      return true;
    } catch { return false; }
  })();
  return p.promise;
}
export function afWorkletReady(ctx) { return !!afWorklets.get(ctx)?.ready; }
/** Does any enabled effect in these chains want the reducer? */
export function afNeedsWorklet(chains) {
  return (chains || []).some(c => c && c.on !== false && (c.effects || []).some(e => e.enabled && e.kind === 'distortion' && e.curve === 'bitcrush'));
}

// ── Building ────────────────────────────────────────────────────────────────

/** Smoothing for moving numbers (s): a mapping never clicks. */
export const AF_TAU = 0.015;

function afParam(param, v, when, ctx) {
  if (when === null || when === undefined) { param.value = v; return; }
  const t = Math.max(when, ctx.currentTime);
  param.setTargetAtTime(v, t, AF_TAU);
}

/** The nodes of one effect: input, output, set(key, value, when), stop. */
function afBuild(ctx, e) {
  const input = ctx.createGain(), output = ctx.createGain();
  const vals = {};
  for (const p of AF_EFFECTS[e.kind].params) vals[p.key] = afClamp(p, e[p.key]);
  const extra = [];
  let set = () => {};
  let stop = () => {};
  switch (e.kind) {
    case 'filter': {
      const f = ctx.createBiquadFilter();
      f.type = e.type || 'lowpass';
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = vals.lfoRate;
      depth.gain.value = vals.lfoDepth * 1200 * (vals.lfoRate > 0 ? 1 : 0);
      f.frequency.value = vals.cutoff;
      // Low- and high-pass read Q in dB (the peak's height); band-pass and notch as a quality factor.
      const qOf = v => (f.type === 'lowpass' || f.type === 'highpass' ? 20 * Math.log10(Math.max(1e-4, v)) : v);
      f.Q.value = qOf(vals.resonance);
      lfo.connect(depth).connect(f.detune);
      lfo.start(0);
      input.connect(f).connect(output);
      extra.push(f, lfo, depth);
      set = (k, v, when) => {
        vals[k] = v;
        if (k === 'cutoff') afParam(f.frequency, v, when, ctx);
        else if (k === 'resonance') afParam(f.Q, qOf(v), when, ctx);
        else if (k === 'lfoRate') { afParam(lfo.frequency, v, when, ctx); afParam(depth.gain, vals.lfoDepth * 1200 * (v > 0 ? 1 : 0), when, ctx); }
        else if (k === 'lfoDepth') afParam(depth.gain, v * 1200 * (vals.lfoRate > 0 ? 1 : 0), when, ctx);
      };
      stop = () => { try { lfo.stop(); } catch { /* already */ } };
      break;
    }
    case 'echo': {
      const [dg, wg] = afMix(vals.mix);
      const dry = ctx.createGain(), wet = ctx.createGain();
      dry.gain.value = dg; wet.gain.value = wg;
      input.connect(dry).connect(output);
      const secs = afEchoSeconds(Object.assign({}, e, vals));
      const loop = [];
      const mk = () => {
        const d = ctx.createDelay(AF_MAX_DELAY), f = ctx.createBiquadFilter(), fb = ctx.createGain();
        d.delayTime.value = secs; f.type = 'lowpass'; f.frequency.value = vals.tone; f.Q.value = 0.5; fb.gain.value = vals.feedback;
        d.connect(f).connect(fb);
        loop.push({ d, f, fb });
        extra.push(d, f, fb);
        return { d, f, fb };
      };
      if (e.pingpong) {
        const mono = ctx.createGain();
        mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
        const L = mk(), R = mk();
        // The first repeat on the left, then back and forth, each hop at the feedback's level: L → R → L…
        input.connect(mono).connect(L.d);
        L.fb.connect(R.d);
        R.fb.connect(L.d);
        const merge = ctx.createChannelMerger(2);
        L.f.connect(merge, 0, 0);
        R.f.connect(merge, 0, 1);
        merge.connect(wet).connect(output);
        extra.push(mono, merge);
      } else {
        const A = mk();
        input.connect(A.d);
        A.fb.connect(A.d);
        A.f.connect(wet).connect(output);
      }
      extra.push(dry, wet);
      set = (k, v, when) => {
        vals[k] = v;
        if (k === 'time' || k === 'bpm') { const s = afEchoSeconds(Object.assign({}, e, vals)); for (const x of loop) afParam(x.d.delayTime, s, when, ctx); }
        else if (k === 'feedback') for (const x of loop) afParam(x.fb.gain, v, when, ctx);
        else if (k === 'tone') for (const x of loop) afParam(x.f.frequency, v, when, ctx);
        else if (k === 'mix') { const [a, b] = afMix(v); afParam(dry.gain, a, when, ctx); afParam(wet.gain, b, when, ctx); }
      };
      break;
    }
    case 'reverb': {
      const [dg, wg] = afMix(vals.mix);
      const dry = ctx.createGain(), wet = ctx.createGain(), pre = ctx.createDelay(1), damp = ctx.createBiquadFilter();
      dry.gain.value = dg; wet.gain.value = wg;
      pre.delayTime.value = vals.predelay / 1000;
      damp.type = 'lowpass'; damp.frequency.value = afDampHz(vals.damping); damp.Q.value = 0.5;
      input.connect(dry).connect(output);
      input.connect(pre);
      // Two convolvers, crossfaded when size or decay moves (a new impulse response can't be swapped in silently).
      const conv = [ctx.createConvolver(), ctx.createConvolver()], cg = [ctx.createGain(), ctx.createGain()];
      let cur = 0, irKey = '', lastIr = -1;
      const irOf = (size, decay) => `${Math.round(size * 50)}:${Math.round(decay * 20)}`;
      conv[0].buffer = afImpulse(ctx, e.type, vals.size, vals.decay);
      irKey = irOf(vals.size, vals.decay);
      cg[0].gain.value = 1; cg[1].gain.value = 0;
      for (let i = 0; i < 2; i++) { pre.connect(conv[i]); conv[i].connect(cg[i]).connect(damp); }
      damp.connect(wet).connect(output);
      extra.push(dry, wet, pre, damp, ...conv, ...cg);
      const reIr = (when) => {
        const key = irOf(vals.size, vals.decay);
        if (key === irKey) return;
        // Live: at most every 120 ms. A render (when in the future) keeps the first one.
        if (when !== null && when !== undefined && when > ctx.currentTime + 0.05) return;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - lastIr < 120) return;
        lastIr = now; irKey = key;
        const next = 1 - cur;
        const fresh = ctx.createConvolver();
        fresh.buffer = afImpulse(ctx, e.type, vals.size, vals.decay);
        try { pre.disconnect(conv[next]); conv[next].disconnect(); } catch { /* already */ }
        conv[next] = fresh;
        pre.connect(fresh); fresh.connect(cg[next]);
        afParam(cg[next].gain, 1, when, ctx);
        afParam(cg[cur].gain, 0, when, ctx);
        cur = next;
      };
      set = (k, v, when) => {
        vals[k] = v;
        if (k === 'mix') { const [a, b] = afMix(v); afParam(dry.gain, a, when, ctx); afParam(wet.gain, b, when, ctx); }
        else if (k === 'predelay') afParam(pre.delayTime, v / 1000, when, ctx);
        else if (k === 'damping') afParam(damp.frequency, afDampHz(v), when, ctx);
        else if (k === 'size' || k === 'decay') reIr(when);
      };
      break;
    }
    case 'distortion': {
      const kind = e.curve || 'soft';
      const [dg, wg] = afMix(vals.mix);
      const dry = ctx.createGain(), wet = ctx.createGain(), pre = ctx.createGain(), sh = ctx.createWaveShaper(), dc = ctx.createBiquadFilter(), tone = ctx.createBiquadFilter(), out = ctx.createGain();
      dry.gain.value = dg; wet.gain.value = wg;
      pre.gain.value = afDriveGain(vals.drive) / AF_SPAN;
      let bits = Math.round(vals.bits);
      sh.curve = afCurve(kind, bits);
      if (kind !== 'bitcrush') sh.oversample = '4x';
      dc.type = 'highpass'; dc.frequency.value = 15; dc.Q.value = 0.5;
      tone.type = 'lowpass'; tone.frequency.value = vals.tone; tone.Q.value = 0.5;
      out.gain.value = afDb(vals.output);
      input.connect(dry).connect(out);
      input.connect(pre).connect(sh);
      let hold = null;
      if (kind === 'bitcrush' && afWorkletReady(ctx)) {
        try { hold = new AudioWorkletNode(ctx, 'af-hold', { outputChannelCount: [2] }); } catch { hold = null; }
      }
      if (hold) { hold.parameters.get('hold').value = Math.round(vals.downsample); sh.connect(hold).connect(dc); extra.push(hold); }
      else sh.connect(dc);
      dc.connect(tone).connect(wet).connect(out);
      out.connect(output);
      extra.push(dry, wet, pre, sh, dc, tone, out);
      set = (k, v, when) => {
        vals[k] = v;
        if (k === 'drive') afParam(pre.gain, afDriveGain(v) / AF_SPAN, when, ctx);
        else if (k === 'tone') afParam(tone.frequency, v, when, ctx);
        else if (k === 'mix') { const [a, b] = afMix(v); afParam(dry.gain, a, when, ctx); afParam(wet.gain, b, when, ctx); }
        else if (k === 'output') afParam(out.gain, afDb(v), when, ctx);
        else if (k === 'downsample' && hold) afParam(hold.parameters.get('hold'), Math.round(v), when, ctx);
        else if (k === 'bits' && kind === 'bitcrush' && Math.round(v) !== bits && !(when !== null && when !== undefined && when > ctx.currentTime + 0.05)) { bits = Math.round(v); sh.curve = afCurve(kind, bits); }
      };
      break;
    }
    case 'compressor': {
      const c = ctx.createDynamicsCompressor(), mk = ctx.createGain();
      c.threshold.value = vals.threshold; c.ratio.value = vals.ratio; c.knee.value = vals.knee;
      c.attack.value = vals.attack / 1000; c.release.value = vals.release / 1000;
      mk.gain.value = afDb(vals.makeup);
      input.connect(c).connect(mk).connect(output);
      extra.push(c, mk);
      set = (k, v, when) => {
        vals[k] = v;
        if (k === 'threshold') afParam(c.threshold, v, when, ctx);
        else if (k === 'ratio') afParam(c.ratio, v, when, ctx);
        else if (k === 'knee') afParam(c.knee, v, when, ctx);
        else if (k === 'attack') afParam(c.attack, v / 1000, when, ctx);
        else if (k === 'release') afParam(c.release, v / 1000, when, ctx);
        else if (k === 'makeup') afParam(mk.gain, afDb(v), when, ctx);
      };
      break;
    }
  }
  return {
    input, output, vals, nodes: extra, set,
    dispose() {
      stop();
      for (const n of [input, output, ...extra]) { try { n.disconnect(); } catch { /* already */ } }
    },
  };
}

/** What makes a chain's graph: on or off, and each enabled effect's id, kind and options, in order. */
export function afSignature(chain, workletOk) {
  if (!chain || chain.on === false) return 'off';
  const parts = [];
  for (const e of chain.effects || []) {
    if (!e.enabled || !AF_EFFECTS[e.kind]) continue;
    const opts = Object.keys(AF_EFFECTS[e.kind].options).map(k => `${k}=${e[k]}`).join(',');
    parts.push(`${e.id}/${e.kind}/${opts}${e.kind === 'distortion' && e.curve === 'bitcrush' && workletOk ? '/w' : ''}`);
  }
  return parts.join('|') || 'off';
}

/**
 * A chain on a context: sound in at `input`, out of `output`. Call `update`
 * with the chain's record (null or off: straight through) and `valueOf(e,
 * key)` for each number as it is driven now (a mapping's value, else the
 * effect's own); `when` null sets the numbers at once, else from that time,
 * smoothed. Returns whether it rebuilt.
 */
export function afCreateChain(ctx) {
  const input = ctx.createGain(), output = ctx.createGain();
  let sig = null;
  let built = [];
  const self = {
    input, output,
    /** The effects as built (id, kind, their nodes and last numbers), for tests and meters. */
    get built() { return built; },
    update(chain, valueOf, when) {
      const s = afSignature(chain, afWorkletReady(ctx));
      let rebuilt = false;
      if (s !== sig) {
        sig = s;
        rebuilt = true;
        try { input.disconnect(); } catch { /* none */ }
        for (const b of built) b.fx.dispose();
        built = [];
        if (s !== 'off') {
          for (const e of chain.effects) {
            if (!e.enabled || !AF_EFFECTS[e.kind]) continue;
            const init = Object.assign({}, e);
            if (valueOf) for (const p of AF_EFFECTS[e.kind].params) init[p.key] = afClamp(p, valueOf(e, p.key));
            built.push({ id: e.id, kind: e.kind, fx: afBuild(ctx, init) });
          }
        }
        let at = input;
        for (const b of built) { at.connect(b.fx.input); at = b.fx.output; }
        at.connect(output);
        if (when === null || when === undefined) return rebuilt;
      }
      if (!chain || !valueOf) return rebuilt;
      for (const b of built) {
        const e = chain.effects.find(x => x.id === b.id);
        if (!e) continue;
        for (const p of AF_EFFECTS[b.kind].params) {
          const v = afClamp(p, valueOf(e, p.key));
          if (b.fx.vals[p.key] !== v) b.fx.set(p.key, v, when);
        }
      }
      return rebuilt;
    },
    dispose() {
      for (const b of built) b.fx.dispose();
      built = [];
      sig = null;
      try { input.disconnect(); } catch { /* none */ }
      try { output.disconnect(); } catch { /* none */ }
    },
  };
  return self;
}
