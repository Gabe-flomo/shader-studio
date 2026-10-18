/**
 * dsp.ts — the sums around the stem model (docs/stems.md), in plain JS so the worker, the tests and Node share them.
 *
 * HT-Demucs works on 7.8 s segments (343 980 samples at 44.1 kHz). Its ONNX exports can't hold the STFT (torch.onnx
 * doesn't trace complex numbers), so the split 4-stem export takes the spectrogram from here and gives masks back:
 *
 *   demucsSpec(L, R)        → the CAC spectrogram the model reads ([4, 2048, 336]: L re, L im, R re, R im), exactly
 *                              as htdemucs `_spec` makes it (reflect pad, STFT n_fft 4096, hop 1024, Hann, normalized,
 *                              the Nyquist bin and two frames each side dropped)
 *   demucsISpec(z, …)       → the waveform back from one stem's two complex channels, as `_ispec` (zero pad, iSTFT,
 *                              trim to the segment)
 *   separateTrack(mix, run) → a whole song: normalised as demucs.apply does, cut into segments (25 % overlap by
 *                              default), each through `run`, overlap-added with demucs' triangular weights, scaled back
 *
 * The FFT is a plain radix-2, two real signals packed into one complex transform each way.
 */

export const SAMPLE_RATE = 44100;
/** One model segment: 7.8 s at 44.1 kHz. */
export const SEGMENT = 343980;
export const NFFT = 4096;
export const HOP = 1024;
/** Frequency bins the model sees (the Nyquist bin dropped). */
export const BINS = NFFT / 2;
/** Frames the model sees for one segment: ceil(SEGMENT / HOP). */
export const FRAMES = Math.ceil(SEGMENT / HOP);

// ── FFT ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface FftTables { n: number; rev: Uint32Array; cos: Float64Array; sin: Float64Array }
const tables = new Map<number, FftTables>();

function fftTables(n: number): FftTables {
  let t = tables.get(n);
  if (t) return t;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size ${n} is not a power of two`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  t = { n, rev, cos, sin };
  tables.set(n, t);
  return t;
}

/** In-place complex FFT (forward: e^{-i…}; inverse: e^{+i…}, unscaled). */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length, t = fftTables(n), rev = t.rev;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const c = t.cos[w], s = sgn * t.sin[w];
        const a = start + k, b = a + half;
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>();
/** A periodic Hann window (torch.hann_window's default). */
export function hann(n: number): Float64Array {
  let w = hannCache.get(n);
  if (!w) { w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); hannCache.set(n, w); }
  return w;
}

/** Reflect padding (torch's `reflect`: the edge sample isn't repeated). */
export function reflectPad(x: ArrayLike<number>, left: number, right: number): Float64Array {
  const n = x.length;
  if (n < 2 && (left || right)) throw new Error('Too short to reflect');
  const out = new Float64Array(n + left + right);
  const at = (i: number): number => {
    // Fold i into [0, n) by reflection about 0 and n − 1.
    const p = 2 * (n - 1);
    let j = ((i % p) + p) % p;
    if (j >= n) j = p - j;
    return x[j];
  };
  for (let i = 0; i < out.length; i++) out[i] = at(i - left);
  return out;
}

export interface Spectrum {
  /** Bins × frames, bin-major ([f * frames + t]). */
  re: Float32Array;
  im: Float32Array;
  bins: number;
  frames: number;
}

/**
 * torch.stft(x, n_fft, hop, window=hann, center=True, pad_mode='reflect', normalized=True, onesided) of two real
 * signals at once (packed as a + ib). Bins n_fft/2 + 1.
 */
export function stftPair(a: ArrayLike<number>, b: ArrayLike<number>, nfft: number, hop: number): [Spectrum, Spectrum] {
  const pa = reflectPad(a, nfft / 2, nfft / 2), pb = reflectPad(b, nfft / 2, nfft / 2);
  const frames = 1 + Math.floor((pa.length - nfft) / hop), bins = nfft / 2 + 1;
  const w = hann(nfft), scale = 1 / Math.sqrt(nfft);
  const A: Spectrum = { re: new Float32Array(bins * frames), im: new Float32Array(bins * frames), bins, frames };
  const B: Spectrum = { re: new Float32Array(bins * frames), im: new Float32Array(bins * frames), bins, frames };
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let t = 0; t < frames; t++) {
    const o = t * hop;
    for (let i = 0; i < nfft; i++) { re[i] = pa[o + i] * w[i]; im[i] = pb[o + i] * w[i]; }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      const nk = (nfft - k) % nfft;
      // A_k = (Z_k + conj Z_{N−k}) / 2, B_k = (Z_k − conj Z_{N−k}) / 2i
      const zr = re[k], zi = im[k], cr = re[nk], ci = -im[nk];
      const idx = k * frames + t;
      A.re[idx] = 0.5 * (zr + cr) * scale; A.im[idx] = 0.5 * (zi + ci) * scale;
      B.re[idx] = 0.5 * (zi - ci) * scale; B.im[idx] = -0.5 * (zr - cr) * scale;
    }
  }
  return [A, B];
}

/**
 * torch.istft(z, n_fft, hop, window=hann, center=True, normalized=True, length) of two onesided spectra at once
 * (each a real signal): windowed overlap-add divided by the summed squared window.
 */
export function istftPair(A: Spectrum, B: Spectrum, nfft: number, hop: number, length: number): [Float32Array, Float32Array] {
  const frames = A.frames, bins = A.bins;
  const total = nfft + hop * (frames - 1);
  const ya = new Float64Array(total), yb = new Float64Array(total), env = new Float64Array(total);
  const w = hann(nfft), scale = Math.sqrt(nfft) / nfft;
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let t = 0; t < frames; t++) {
    // C_k = A_k + i B_k over the full spectrum (A, B Hermitian): ifft gives a + ib.
    for (let k = 0; k < nfft; k++) {
      let ar: number, ai: number, br: number, bi: number;
      if (k < bins) { const idx = k * frames + t; ar = A.re[idx]; ai = A.im[idx]; br = B.re[idx]; bi = B.im[idx]; }
      else { const idx = (nfft - k) * frames + t; ar = A.re[idx]; ai = -A.im[idx]; br = B.re[idx]; bi = -B.im[idx]; }
      // The DC and Nyquist bins of a real signal are real: what the model leaves there is dropped, as irfft does.
      if (k === 0 || k === nfft / 2) { ai = 0; bi = 0; }
      re[k] = ar - bi; im[k] = ai + br;
    }
    fft(re, im, true);
    const o = t * hop;
    for (let i = 0; i < nfft; i++) { ya[o + i] += re[i] * scale * w[i]; yb[o + i] += im[i] * scale * w[i]; env[o + i] += w[i] * w[i]; }
  }
  const outA = new Float32Array(length), outB = new Float32Array(length), start = nfft / 2;
  for (let i = 0; i < length; i++) {
    const j = start + i;
    if (j >= total) break;
    const e = env[j] > 1e-11 ? env[j] : 1;
    outA[i] = ya[j] / e; outB[i] = yb[j] / e;
  }
  return [outA, outB];
}

// ── HT-Demucs' spectrogram ───────────────────────────────────────────────────────────────────────────────────

const demucsPad = (length: number) => {
  const le = Math.ceil(length / HOP), pad = (HOP / 2) * 3;
  return { le, pad, right: pad + le * HOP - length };
};

/** htdemucs `_spec` of a stereo segment, as the model's `mag` input: [4, BINS, frames] (L re, L im, R re, R im). */
export function demucsSpec(left: ArrayLike<number>, right: ArrayLike<number>): { data: Float32Array; frames: number } {
  const length = left.length;
  const { le, pad, right: rp } = demucsPad(length);
  const [A, B] = stftPair(reflectPad(left, pad, rp), reflectPad(right, pad, rp), NFFT, HOP);
  // Drop the Nyquist bin and the two frames each side.
  const plane = BINS * le, data = new Float32Array(4 * plane);
  for (let f = 0; f < BINS; f++) {
    for (let t = 0; t < le; t++) {
      const src = f * A.frames + t + 2, dst = f * le + t;
      data[dst] = A.re[src]; data[plane + dst] = A.im[src];
      data[2 * plane + dst] = B.re[src]; data[3 * plane + dst] = B.im[src];
    }
  }
  return { data, frames: le };
}

/**
 * htdemucs `_ispec` of one stem: its CAC block ([4, BINS, frames] at `offset` in `z`: L re, L im, R re, R im) back to
 * a stereo waveform of `length` samples.
 */
export function demucsISpec(z: ArrayLike<number>, offset: number, frames: number, length: number): [Float32Array, Float32Array] {
  const { le, pad } = demucsPad(length);
  if (le !== frames) throw new Error(`Expected ${le} frames, got ${frames}`);
  const F = BINS + 1, T = frames + 4, plane = BINS * frames;
  const mk = (): Spectrum => ({ re: new Float32Array(F * T), im: new Float32Array(F * T), bins: F, frames: T });
  const A = mk(), B = mk();
  for (let f = 0; f < BINS; f++) {
    for (let t = 0; t < frames; t++) {
      const src = offset + f * frames + t, dst = f * T + t + 2;
      A.re[dst] = z[src]; A.im[dst] = z[src + plane];
      B.re[dst] = z[src + 2 * plane]; B.im[dst] = z[src + 3 * plane];
    }
  }
  const full = HOP * le + 2 * pad;
  const [a, b] = istftPair(A, B, NFFT, HOP, full);
  return [a.slice(pad, pad + length), b.slice(pad, pad + length)];
}

// ── A whole song ─────────────────────────────────────────────────────────────────────────────────────────────

/** Where each segment starts: every (1 − overlap) × segment samples, until the song is covered. */
export function chunkOffsets(length: number, segment = SEGMENT, overlap = 0.25): number[] {
  const stride = Math.max(1, Math.floor((1 - overlap) * segment));
  const out: number[] = [];
  for (let o = 0; o < Math.max(1, length); o += stride) out.push(o);
  return out;
}

/** demucs.apply's segment weight: a triangle rising from 1 to the middle and back (max 1). */
export function triangleWeight(segment: number): Float32Array {
  const w = new Float32Array(segment), half = Math.floor(segment / 2);
  for (let i = 0; i < half; i++) w[i] = i + 1;
  for (let i = half; i < segment; i++) w[i] = segment - i;
  let max = 0;
  for (let i = 0; i < segment; i++) if (w[i] > max) max = w[i];
  for (let i = 0; i < segment; i++) w[i] /= max;
  return w;
}

/** One segment through the model: stereo in (each `segment` samples), per stem a stereo pair out. */
export type ChunkRunner = (left: Float32Array, right: Float32Array, at: { index: number; count: number }) => Promise<Array<[Float32Array, Float32Array]>>;

export interface SeparateOptions {
  stems: number;
  segment?: number;
  overlap?: number;
  /** Called before each segment and once at the end (index === count). */
  onChunk?: (index: number, count: number) => void;
  /** Stops between segments (throws an AbortError). */
  signal?: { aborted: boolean };
  /** Normalise by the mix's mean and spread first, as demucs.apply does (default true). */
  normalise?: boolean;
}

export class StemCancelled extends Error {
  constructor() { super('Separation cancelled'); this.name = 'AbortError'; }
}

/**
 * A whole song through `run`, segment by segment with overlap, into one stereo pair per stem (the song's length).
 * The weights and the normalisation are demucs.apply's: an identity "model" gives the mix back exactly.
 */
export async function separateTrack(left: Float32Array, right: Float32Array, run: ChunkRunner, o: SeparateOptions): Promise<Array<[Float32Array, Float32Array]>> {
  const length = left.length, segment = o.segment ?? SEGMENT;
  // The mono mix's mean and standard deviation.
  let mean = 0;
  for (let i = 0; i < length; i++) mean += (left[i] + right[i]) / 2;
  mean = length ? mean / length : 0;
  let v = 0;
  for (let i = 0; i < length; i++) { const d = (left[i] + right[i]) / 2 - mean; v += d * d; }
  const std = o.normalise === false ? 1 : Math.sqrt(length > 1 ? v / (length - 1) : 0) || 1;
  const m = o.normalise === false ? 0 : mean;
  const out: Array<[Float32Array, Float32Array]> = Array.from({ length: o.stems }, () => [new Float32Array(length), new Float32Array(length)]);
  const sum = new Float32Array(length);
  const weight = triangleWeight(segment);
  const offsets = chunkOffsets(length, segment, o.overlap ?? 0.25);
  const L = new Float32Array(segment), R = new Float32Array(segment);
  for (let c = 0; c < offsets.length; c++) {
    if (o.signal?.aborted) throw new StemCancelled();
    o.onChunk?.(c, offsets.length);
    const off = offsets[c], n = Math.min(segment, length - off);
    L.fill(0); R.fill(0);
    for (let i = 0; i < n; i++) { L[i] = (left[off + i] - m) / std; R[i] = (right[off + i] - m) / std; }
    const res = await run(L, R, { index: c, count: offsets.length });
    if (o.signal?.aborted) throw new StemCancelled();
    if (res.length < o.stems) throw new Error(`The model gave ${res.length} stems, expected ${o.stems}`);
    for (let s = 0; s < o.stems; s++) {
      const [a, b] = res[s], [oa, ob] = out[s];
      for (let i = 0; i < n; i++) { oa[off + i] += a[i] * weight[i]; ob[off + i] += b[i] * weight[i]; }
    }
    for (let i = 0; i < n; i++) sum[off + i] += weight[i];
  }
  o.onChunk?.(offsets.length, offsets.length);
  for (const [oa, ob] of out) {
    for (let i = 0; i < length; i++) {
      const k = sum[i] > 0 ? std / sum[i] : 0;
      oa[i] = oa[i] * k + m; ob[i] = ob[i] * k + m;
    }
  }
  return out;
}

/** Energy (sum of squares) of a stereo pair between two sample indices: for checks. */
export function energy(pair: [ArrayLike<number>, ArrayLike<number>], from = 0, to = pair[0].length): number {
  let e = 0;
  for (let i = from; i < to; i++) e += pair[0][i] * pair[0][i] + pair[1][i] * pair[1][i];
  return e;
}
