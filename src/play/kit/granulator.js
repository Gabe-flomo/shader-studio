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
export const GR_MODES = ['Classic', 'Flux', 'Cloud'];
export const GR_FILTERS = ['Off', 'Low-pass', 'High-pass', 'Band-pass', 'Notch'];
export const GR_WINDOWS = ['Hann', 'Triangle', 'Tukey', 'Rectangle'];

/**
 * Every setting. `addr` is its address for good (records and controls keep
 * it): never renumber, only add. Lists count from 0; toggles are 0 / 1.
 */
export const GR_PARAMS = [
  GR_P(0, 'mode', 'Mode', 0, 2, 0, '', { kind: 'list', step: 1, values: GR_MODES, hint: 'Classic: two overlapping grains per voice, a new one every half grain. Flux: a regular stream at Density with flickering levels. Cloud: grains at random moments, each at its own pitch and place.' }),
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
  return function create(sampleRate, seed) {
    var sr = sampleRate > 0 ? sampleRate : 48000;
    var P = {
      mode: 0, position: 0.3, spray: 0.05, size: 120, sizeRand: 0, density: 20, pitch: 0, spread: 0, pitchRand: 0, panRand: 0.3, levelRand: 0, reverse: 0,
      fmRate: 0, fmAmount: 0, filter: 0, cutoff: 6000, resonance: 0.71, attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.8, window: 0, skew: 0.5,
      scan: 0, lfoRate: 0, lfoDepth: 0.2, freeze: 0, hold: 0, drone: 0, cap: 64, voices: 8, root: 60, velocity: 1, level: 0.8, seed: 1,
    };
    var rnd = mulberry(seed || 1), seedNow = seed || 1;
    var bufL = null, bufR = null, bufLen = 0, ratio = 1, bufDur = 0;
    var frame = 0, events = [], held = {}, bend = 0, fmPhase = 0, lfoPhase = 0, seq = 0, maxCount = 0, voiceSeq = 0;
    var gainS = P.level, cutS = P.cutoff, fc = { g: 0, k: 0, a1: 0, a2: 0, a3: 0 }, ic1L = 0, ic2L = 0, ic1R = 0, ic2R = 0, coefAt = -1;
    var voices = [];
    for (var vi = 0; vi < MAXV; vi++) voices.push({ on: false, note: 60, vel: 1, stage: 0, level: 0, rate: 0, relRate: 0, scan: 0, wait: 0, alt: false, drone: false, latched: false, keyUp: false, order: 0 });
    var grains = [];
    for (var gi = 0; gi < MAXG; gi++) grains.push({ on: false, v: 0, pos: 0, rate: 1, len: 1, age: 0, amp: 0, gl: 0, gr: 0, semis: 0 });
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
    function spawn(vIndex, v) {
      var cap = Math.max(1, Math.min(MAXG, Math.round(P.cap)));
      var mode = P.mode | 0;
      var baseLen = Math.max(2, P.size) * 0.001 * sr;
      // When the next grain comes.
      if (mode === 0) v.wait = Math.max(1, baseLen / 2);
      else if (mode === 1) v.wait = Math.max(1, sr / Math.max(0.01, P.density));
      else v.wait = Math.max(1, -Math.log(1 - rnd() * 0.999999) * sr / Math.max(0.01, P.density));
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
      g.on = true; g.v = vIndex; g.len = len; g.age = 0; g.amp = amp; g.semis = semis;
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
      for (var n = from; n < to; n++) {
        gainS += (P.level - gainS) * smooth;
        cutS += (P.cutoff - cutS) * smooth;
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
          v.wait -= 1;
          if (v.wait <= 0 && v.stage !== 3) spawn(vi, v);
        }
        var l = 0, r = 0;
        if (live > 0) {
          for (var gi = 0; gi < MAXG; gi++) {
            var g = grains[gi];
            if (!g.on) continue;
            var w = windowAt(win, g.age / g.len, skew) * g.amp * voices[g.v].level;
            if (w !== 0) {
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
        else { bufL = chans[0]; bufR = chans[1] || chans[0]; bufLen = bufL.length; ratio = (rate > 0 ? rate : sr) / sr; bufDur = bufLen / (rate > 0 ? rate : sr); }
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
          c++;
        }
        o.count = c; o.maxCount = maxCount;
        return o;
      },
      voicesOn: function () { var c = 0; for (var i = 0; i < MAXV; i++) if (voices[i].on) c++; return c; },
      reset: function (s) {
        for (var i = 0; i < MAXG; i++) grains[i].on = false;
        for (var j = 0; j < MAXV; j++) voices[j].on = false;
        live = 0; events = []; held = {}; bend = 0; fmPhase = 0; lfoPhase = 0; maxCount = 0; frame = 0; ic1L = ic2L = ic1R = ic2R = 0;
        gainS = P.level; cutS = P.cutoff;
        seedNow = s !== undefined ? s : Math.round(P.seed); rnd = mulberry(seedNow);
        droneCheck();
      },
    };
    e.reset(seed || Math.round(P.seed));
    return e;
  };
}

/** The readouts every engine fills (stats()). */
export function grNewStats() {
  return { count: 0, maxCount: 0, pos: new Float32Array(64), amp: new Float32Array(64), pitch: new Float32Array(64) };
}

/**
 * The readouts summed up for mappings, all 0..1: grains (count ÷ 64), mean
 * position, spread (the positions' standard deviation × 2), level (mean
 * amplitude), pitch (mean semitones: 0.5 unshifted, 0 / 1 at −48 / +48).
 */
export function grSummary(st) {
  const n = st.count;
  if (!n) return { grains: 0, mean: 0, spread: 0, level: 0, pitch: 0.5 };
  let sp = 0, sa = 0, sq = 0;
  for (let i = 0; i < n; i++) { sp += st.pos[i]; sa += st.amp[i]; sq += st.pitch[i]; }
  const mean = sp / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (st.pos[i] - mean) * (st.pos[i] - mean);
  return {
    grains: n / GR_MAX_GRAINS,
    mean: mean,
    spread: Math.min(1, Math.sqrt(v / n) * 2),
    level: Math.min(1, sa / n),
    pitch: Math.max(0, Math.min(1, 0.5 + sq / n / 96)),
  };
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
    this.e = grCreateEngine(sampleRate, p.seed || 1);
    this.st = { count: 0, maxCount: 0, pos: new Float32Array(64), amp: new Float32Array(64), pitch: new Float32Array(64) };
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
    else if (d.t === 'stop') this.alive = false;
  }
  process(inputs, outputs) {
    var o = outputs[0];
    if (!o || !o.length) return this.alive;
    var L = o[0], R = o[1] || new Float32Array(L.length);
    this.e.sync(currentFrame);
    this.e.process(L, R, L.length);
    if (++this.n % 6 === 0) {
      var s = this.e.stats(this.st), c = s.count, out = new Float32Array(2 + c * 3);
      out[0] = c; out[1] = s.maxCount;
      for (var i = 0; i < c; i++) { out[2 + i] = s.pos[i]; out[2 + c + i] = s.amp[i]; out[2 + 2 * c + i] = s.pitch[i]; }
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
      node.port.onmessage = ev => {
        const d = ev.data;
        if (!(d instanceof Float32Array)) return;
        const c = d[0] | 0;
        st.count = c; st.maxCount = d[1];
        for (let i = 0; i < c; i++) { st.pos[i] = d[2 + i]; st.amp[i] = d[2 + c + i]; st.pitch[i] = d[2 + 2 * c + i]; }
      };
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
    },
    set(s) {
      // Only what changed crosses to the audio thread.
      const diff = {};
      let any = false;
      for (const k in s) if (!lastSettings || lastSettings[k] !== s[k]) { diff[k] = s[k]; any = true; }
      lastSettings = Object.assign({}, lastSettings || {}, s);
      if (any) send({ t: 'set', s: diff });
    },
    noteOn(note, vel, when) { if (ctx.state === 'suspended' && ctx.resume) void ctx.resume(); send({ t: 'on', note: note, vel: vel, at: when }); },
    noteOff(note, when) { send({ t: 'off', note: note, at: when }); },
    allOff(when) { send({ t: 'all', at: when }); },
    bend(semis, when) { send({ t: 'bend', value: semis, at: when }); },
    stats() { return st; },
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
