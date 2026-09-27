/**
 * testLoop.ts — a short loop synthesised on the spot (no recorded audio), for
 * trying audio readers without a mic: a kick around 60 Hz on every beat, a
 * snare on 2 and 4, hi-hats around 8 kHz on the offbeats, and a voice-like
 * line in the 300 Hz – 1.2 kHz range. Two bars at 120 BPM.
 */

export const TEST_LOOP_BPM = 120;
const BEAT = 60 / TEST_LOOP_BPM;
export const TEST_LOOP_SECONDS = BEAT * 8;

/** Render the loop into a buffer at `sampleRate` (stereo, so it plays the same in both ears). */
export async function renderTestLoop(sampleRate: number): Promise<AudioBuffer> {
  const len = Math.ceil(TEST_LOOP_SECONDS * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const out = ctx.createDynamicsCompressor();
  out.threshold.value = -10;
  out.connect(ctx.destination);

  const noise = ctx.createBuffer(1, Math.ceil(sampleRate * 0.5), sampleRate);
  const nd = noise.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < nd.length; i++) { seed = (seed * 16807) % 2147483647; nd[i] = (seed / 2147483647) * 2 - 1; }

  const kick = (t: number) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.4);
  };
  const hiss = (t: number, dur: number, type: BiquadFilterType, hz: number, q: number, level: number) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    f.type = type; f.frequency.value = hz; f.Q.value = q;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t); s.stop(t + dur + 0.01);
  };
  const snare = (t: number) => {
    hiss(t, 0.18, 'bandpass', 1800, 0.8, 0.5);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 190;
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.13);
  };
  // A sung "ah": a sawtooth through two formant filters, with a little vibrato.
  const voice = (t: number, dur: number, hz: number) => {
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = hz;
    lfo.frequency.value = 5.5; depth.gain.value = hz * 0.012;
    lfo.connect(depth).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.12);
    g.gain.setValueAtTime(0.22, t + dur - 0.15);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const [f, q, lv] of [[750, 6, 1], [1150, 8, 0.6]] as const) {
      const bp = ctx.createBiquadFilter(), fg = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; fg.gain.value = lv * 3;
      g.connect(bp).connect(fg).connect(out);
    }
    o.connect(g);
    o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
  };

  for (let b = 0; b < 8; b++) {
    const t = b * BEAT;
    kick(t);
    if (b % 2 === 1) snare(t);
    hiss(t + BEAT / 2, 0.05, 'highpass', 7000, 0.7, 0.35);
    hiss(t + BEAT * 0.75, 0.03, 'highpass', 7500, 0.7, 0.18);
  }
  // A phrase that sits out the first beat of each bar, so it comes and goes.
  const notes = [330, 392, 440, 392, 294, 330];
  notes.forEach((hz, i) => voice(BEAT * (1 + i * 1.1), BEAT * 1, hz));

  return ctx.startRendering();
}
