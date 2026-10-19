/**
 * dsp.ts — the Audio nodes' sums (docs/audio-tools.md), pure so they can be tested on synthetic sound.
 *
 * Every function reads one analysis frame: a spectrum in dB per FFT bin (what AnalyserNode.getFloatFrequencyData
 * gives: `fftSize / 2` bins from 0 Hz to half the sample rate) and/or the last `fftSize` samples. The engine
 * (engine.ts) calls them once per rendered frame per node.
 *
 * The per-frame sums live in play/kit/audioTools.js, so an exported page (runtime/play-runtime.js) runs exactly the
 * same code as the app; they are re-exported here under their app names. Only the offline FFT (for tests and learning
 * from a file) is kept here.
 */
export {
  atDbToUnit as dbToUnit, AT_DB_FLOOR as DB_FLOOR, atBinHz as binHz, atBandLevel as bandLevel, atRmsLevel as rmsLevel,
  atFollow as follow, atNewBandState as newBandState, AT_PEAK_HOLD as PEAK_HOLD, AT_PEAK_FALL as PEAK_FALL, atStepBand as stepBand,
  AT_HIT_HISTORY as HIT_HISTORY, atHitThreshold as hitThreshold, atBandFlux as bandFlux,
  AT_SPECTRUM_MIN_HZ as SPECTRUM_MIN_HZ, atHzAt as hzAt, atXOfHz as xOfHz, atSpectrumMaxHz as spectrumMaxHz, atSpectrumBins as spectrumBins,
  atScrollRows as scrollRows, atWriteRow as writeRow, atWaveRow as waveRow,
} from '../../play/kit/audioTools.js';
export type { AtBandState as BandState, AtLayout as SpectrumLayout } from '../../play/kit/audioTools.js';

// ── An FFT like AnalyserNode's, for tests and offline use ─────────────────────────────────────────────────────

/**
 * The dB spectrum of `block` (length a power of two) as AnalyserNode computes it: a Blackman window, an FFT,
 * magnitude ÷ length, 20·log10. Returns `block.length / 2` bins.
 */
export function spectrumDb(block: Float32Array): Float32Array {
  const n = block.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  const a0 = 0.42, a1 = 0.5, a2 = 0.08;
  for (let i = 0; i < n; i++) {
    const w = a0 - a1 * Math.cos((2 * Math.PI * i) / n) + a2 * Math.cos((4 * Math.PI * i) / n);
    re[i] = block[i] * w;
  }
  // Bit-reversed order, then butterflies.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = 20 * Math.log10(Math.max(1e-12, Math.hypot(re[i], im[i]) / n));
  return out;
}
