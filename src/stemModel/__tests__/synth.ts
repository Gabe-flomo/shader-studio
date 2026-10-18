/**
 * A synthetic song for the stem checks: a kick + snare loop at 120 BPM, a low bass line (a filtered saw) and a sine
 * "voice" with vibrato, stereo at 44.1 kHz, and each part on its own (mono) to compare the stems with.
 */
export interface SynthMix { left: Float32Array; right: Float32Array; kick: Float32Array; bass: Float32Array; voice: Float32Array; sampleRate: number }

export function synthMix(seconds: number, sampleRate = 44100): SynthMix {
  const n = Math.round(seconds * sampleRate);
  const kick = new Float32Array(n), bass = new Float32Array(n), voice = new Float32Array(n);
  const beat = 0.5;
  // Pseudo-random noise for the snare (fixed seed).
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beatT = t % beat, bar = Math.floor(t / beat);
    // Kick on every beat: a pitch sweep 150 → 45 Hz with a fast decay and a click. Snare (noise) on the off beats.
    const f = 45 + 105 * Math.exp(-beatT * 30);
    const phase = 2 * Math.PI * (45 * beatT + (105 / 30) * (1 - Math.exp(-beatT * 30)));
    let k = Math.sin(phase) * Math.exp(-beatT * 9) * 0.9;
    if (beatT < 0.003) k += 0.3 * (1 - beatT / 0.003);
    if (bar % 2 === 1) k += rnd() * Math.exp(-beatT * 25) * 0.35;
    void f;
    kick[i] = k;
    // Bass: a saw an octave below the root, low-passed by summing 6 harmonics; notes change every two beats.
    const notes = [55, 55, 65.41, 73.42, 49, 49, 61.74, 73.42];
    const nf = notes[Math.floor(t / (2 * beat)) % notes.length];
    let b = 0;
    for (let h = 1; h <= 6; h++) b += Math.sin(2 * Math.PI * nf * h * t) / h;
    const env = Math.min(1, ((t % (2 * beat)) / 0.02)) * 0.9;
    bass[i] = b * 0.35 * env;
    // Voice: a sine around A4 with vibrato and a slow melody, plus a soft second harmonic.
    const mel = [440, 494, 523, 587, 523, 494][Math.floor(t / 1) % 6];
    const vib = mel * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t));
    const vp = 2 * Math.PI * vib * t;
    voice[i] = (Math.sin(vp) + 0.3 * Math.sin(2 * vp)) * 0.25 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t) ** 2);
  }
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = 0.5 * (kick[i] + bass[i]) + 0.55 * voice[i];
    right[i] = 0.5 * (kick[i] + bass[i]) + 0.45 * voice[i];
  }
  return { left, right, kick, bass, voice, sampleRate };
}

/** A 16-bit PCM WAV of a stereo pair. */
export function wavBytes(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const n = left.length, data = n * 4, buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, data, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return new Uint8Array(buf);
}
