/**
 * bandFilter.ts — the filters an Audio Source band is heard through (engine.auditionBand: Solo, Hear hovered) and
 * drawn as (components/audio/BandEqEditor.tsx), so the curve on screen is exactly what plays.
 *
 * Each band is a cascade of biquads (the Audio EQ Cookbook's, which is what WebAudio's BiquadFilterNode runs):
 *
 * - **Band**: band-passes whose −3 dB points are the band's lo and hi exactly. Its Q (shown in the panel) is the usual
 *   one for a width of N octaves, Q = √(2^N) / (2^N − 1). The slope sets how many sections: 12 dB/oct is one (a
 *   second-order band-pass, skirts falling 6 dB/oct each side far out), 24 two, 48 four; each section's Q is set so
 *   the cascade is still −3 dB at lo and hi.
 * - **Low cut / High cut**: a Butterworth high-pass at lo / low-pass at hi of order slope / 6 (12 dB/oct one section,
 *   24 two, 48 four): −3 dB at the corner, flat in the passband, falling at the slope beyond.
 *
 * The bilinear transform squeezes frequencies near Nyquist; the band-pass is pre-warped so lo / hi stay the −3 dB
 * points at any frequency. Pure, so it can be tested.
 */

export type BandShapeLike = 'band' | 'lowcut' | 'highcut';
export interface BandFilterSpec { lo: number; hi: number; shape?: BandShapeLike; slope?: number }

/** One biquad section: its WebAudio type, frequency (Hz) and Q as a plain ratio (not WebAudio's dB for lp / hp). */
export interface BiquadSection { type: 'bandpass' | 'highpass' | 'lowpass'; freq: number; q: number }

/** The sample rate assumed when none is known (most interfaces run at 48 kHz). */
export const DEFAULT_SAMPLE_RATE = 48000;

/** Biquad sections for a slope: 12 dB/oct → 1, 24 → 2, 48 → 4. */
export const sectionsFor = (slope: number | undefined): number => Math.max(1, Math.min(4, Math.round((slope ?? 12) / 12)));

/** A width in octaves as the standard Q (1 octave is Q 1.414), and back. */
export const widthToQ = (oct: number): number => Math.sqrt(2 ** oct) / (2 ** oct - 1);
export function qToWidth(q: number): number {
  // Solve √(2^N) / (2^N − 1) = q for 2^N.
  const a = 1 / (2 * q), r = a + Math.sqrt(a * a + 1);
  return 2 * Math.log2(r);
}

/** The section Qs of an n-section Butterworth (order 2n): 1/(2·cos((2k−1)π/4n)). One section: 0.7071. */
export const butterworthQs = (n: number): number[] => Array.from({ length: n }, (_, k) => 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (4 * n))));

/** The sections a band runs through at `sampleRate`. */
export function bandSections(b: BandFilterSpec, sampleRate = DEFAULT_SAMPLE_RATE): BiquadSection[] {
  const n = sectionsFor(b.slope), shape = b.shape ?? 'band';
  const nyq = sampleRate / 2, top = nyq * 0.98;
  const lo = Math.max(1, Math.min(b.lo, b.hi)), hi = Math.max(lo + 1e-3, Math.max(b.lo, b.hi));
  if (shape === 'lowcut') return butterworthQs(n).map(q => ({ type: 'highpass' as const, freq: Math.min(lo, top), q }));
  if (shape === 'highcut') return butterworthQs(n).map(q => ({ type: 'lowpass' as const, freq: Math.min(hi, top), q }));
  // Pre-warp: the cookbook band-pass is the analogue one at Ω = tan(πf/fs) / tan(πf0/fs).
  const tl = Math.tan((Math.PI * Math.min(lo, top * 0.999)) / sampleRate), th = Math.tan((Math.PI * Math.min(hi, top)) / sampleRate);
  const t0 = Math.sqrt(tl * th);
  const qBand = t0 / Math.max(1e-9, th - tl);
  // n equal sections, each −3/n dB at lo / hi: 1 + (Qs·u)² = 2^(1/n) where Q·u = 1 there.
  const qs = qBand * Math.sqrt(2 ** (1 / n) - 1);
  const f0 = (Math.atan(t0) * sampleRate) / Math.PI;
  return Array.from({ length: n }, () => ({ type: 'bandpass' as const, freq: f0, q: qs }));
}

/** What to set a BiquadFilterNode's Q to: WebAudio reads a low- / high-pass's Q in dB, a band-pass's as a ratio. */
export const webAudioQ = (s: BiquadSection): number => (s.type === 'bandpass' ? s.q : 20 * Math.log10(s.q));

/** A section's normalised coefficients (Audio EQ Cookbook, as the WebAudio spec computes them). */
export function sectionCoefs(s: BiquadSection, sampleRate = DEFAULT_SAMPLE_RATE): { b0: number; b1: number; b2: number; a1: number; a2: number } {
  const w0 = (2 * Math.PI * Math.min(s.freq, sampleRate / 2)) / sampleRate, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * s.q);
  let b0: number, b1: number, b2: number;
  if (s.type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (s.type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
}

/** |H| of one section at `hz`. */
function sectionMag(c: ReturnType<typeof sectionCoefs>, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di));
}

/** A band's gain at each frequency in `hz` (linear, 1 = 0 dB), as the filters it is heard through give it. */
export function bandGains(b: BandFilterSpec, hz: ArrayLike<number>, sampleRate = DEFAULT_SAMPLE_RATE, out = new Float32Array(hz.length)): Float32Array {
  const cs = bandSections(b, sampleRate).map(s => sectionCoefs(s, sampleRate));
  const nyq = sampleRate / 2;
  for (let i = 0; i < hz.length; i++) {
    const f = Math.max(0.01, Math.min(hz[i], nyq * 0.9999));
    let g = 1;
    for (const c of cs) g *= sectionMag(c, f, sampleRate);
    out[i] = g;
  }
  return out;
}

/** A band's gain at one frequency (linear). */
export const bandGain = (b: BandFilterSpec, hz: number, sampleRate = DEFAULT_SAMPLE_RATE): number => bandGains(b, [hz], sampleRate)[0];

/** Linear gain → dB (silence floored at −120). */
export const gainDb = (g: number): number => (g > 1e-6 ? 20 * Math.log10(g) : -120);
