/**
 * runners.ts — one 7.8 s segment through a stem model (docs/stems.md), apart from ONNX Runtime so the tests (and a
 * Node check against the real files) drive it with any backend.
 *
 *   split-cac  HT-Demucs 4 stems, the 21-piece WebGPU export: the spectrogram is made here (dsp.ts demucsSpec), fed with
 *              the waveform to piece 0 (`mag`, `mix`), the pieces run in order (each one's outputs feed the next), then
 *              the frequency branch (`x`: [1, S, 4, 2048, 336]) goes back to a waveform (demucsISpec) and the time
 *              branch (`xt`: [1, S, 2, 343980]) is added.
 *   waveform   a single graph with the STFT inside (HT-Demucs 6 stems): `mix` [1, 2, N] in, `stems` [1, S, 2, N] out.
 */
import { BINS, SEGMENT, demucsISpec, demucsSpec, type ChunkRunner } from './dsp';

/** What a runner needs from a runtime: tensors in, run piece `i`, read a result back, free it. */
export interface ModelBackend<T> {
  tensor(data: Float32Array, dims: number[]): T;
  run(piece: number, feeds: Record<string, T>): Promise<Record<string, T>>;
  read(t: T): Promise<Float32Array>;
  dispose(t: T): void;
}

export interface PieceSpec { inputs: string[]; outputs: string[] }

/**
 * The split 4-stem export: `pieces` in manifest order, the final outputs named by `out`. `onPiece(i, n)` after each
 * piece (for a finer progress bar); `signal` stops between pieces.
 */
export function splitCacRunner<T>(be: ModelBackend<T>, pieces: readonly PieceSpec[], out: { freq: string; time: string }, stems: number,
  o: { onPiece?: (i: number, n: number) => void; signal?: { aborted: boolean } } = {}): ChunkRunner {
  return async (left, right) => {
    const n = left.length;
    const spec = demucsSpec(left, right);
    const mix = new Float32Array(2 * n);
    mix.set(left, 0); mix.set(right, n);
    const map = new Map<string, T>([['mix', be.tensor(mix, [1, 2, n])], ['mag', be.tensor(spec.data, [1, 4, BINS, spec.frames])]]);
    // Free each tensor once no later piece needs it.
    const lastUse = new Map<string, number>();
    pieces.forEach((p, i) => p.inputs.forEach(name => lastUse.set(name, i)));
    lastUse.set(out.freq, Infinity); lastUse.set(out.time, Infinity);
    try {
      for (let i = 0; i < pieces.length; i++) {
        if (o.signal?.aborted) break;
        const p = pieces[i];
        const feeds: Record<string, T> = {};
        for (const name of p.inputs) {
          const t = map.get(name);
          if (t === undefined) throw new Error(`Piece ${i} needs ${name}, which no earlier piece made`);
          feeds[name] = t;
        }
        const res = await be.run(i, feeds);
        for (const [k, t] of Object.entries(res)) map.set(k, t);
        for (const name of p.inputs) if ((lastUse.get(name) ?? -1) <= i) { const t = map.get(name); if (t !== undefined) be.dispose(t); map.delete(name); }
        o.onPiece?.(i + 1, pieces.length);
      }
      if (o.signal?.aborted) return [];
      const xT = map.get(out.freq), xtT = map.get(out.time);
      if (xT === undefined || xtT === undefined) throw new Error('The model gave no output');
      const [x, xt] = await Promise.all([be.read(xT), be.read(xtT)]);
      const block = 4 * BINS * spec.frames;
      const res: Array<[Float32Array, Float32Array]> = [];
      for (let s = 0; s < stems; s++) {
        const [a, b] = demucsISpec(x, s * block, spec.frames, n);
        const t0 = (s * 2) * n, t1 = (s * 2 + 1) * n;
        for (let i = 0; i < n; i++) { a[i] += xt[t0 + i]; b[i] += xt[t1 + i]; }
        res.push([a, b]);
      }
      return res;
    } finally {
      for (const t of map.values()) be.dispose(t);
    }
  };
}

/** A one-graph export with the STFT inside: `mix` [1, 2, N] → `stems` [1, S, 2, N]. */
export function waveformRunner<T>(be: ModelBackend<T>, stems: number, names: { input: string; output: string } = { input: 'mix', output: 'stems' }): ChunkRunner {
  return async (left, right) => {
    const n = left.length;
    const mix = new Float32Array(2 * n);
    mix.set(left, 0); mix.set(right, n);
    const input = be.tensor(mix, [1, 2, n]);
    let res: Record<string, T> | null = null;
    try {
      res = await be.run(0, { [names.input]: input });
      const t = res[names.output];
      if (t === undefined) throw new Error(`The model gave no ${names.output}`);
      const y = await be.read(t);
      const out: Array<[Float32Array, Float32Array]> = [];
      for (let s = 0; s < stems; s++) out.push([y.slice(2 * s * n, (2 * s + 1) * n), y.slice((2 * s + 1) * n, (2 * s + 2) * n)]);
      return out;
    } finally {
      be.dispose(input);
      if (res) for (const t of Object.values(res)) be.dispose(t);
    }
  };
}

export { SEGMENT };
