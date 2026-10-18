/**
 * Stem separation (docs/stems.md): the sums (STFT / iSTFT, HT-Demucs' spectrogram, chunking and overlap-add), the
 * runners with a mocked model, the registry's pins, the WebM / WAV encoders, the worker's protocol with a mocked
 * runtime, the client's consent rule (no network, no worker, until the person says yes) and the Separate run's states
 * (the picture held from start to end, whatever the end).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: () => null, get length() { return mem.size; }, clear: () => mem.clear(),
  };
});

import {
  BINS, FRAMES, HOP, NFFT, SEGMENT, chunkOffsets, demucsISpec, demucsSpec, fft, istftPair, reflectPad, separateTrack, stftPair, triangleWeight, type ChunkRunner,
} from '../dsp';
import { splitCacRunner, waveformRunner, type ModelBackend } from '../runners';
import { DEFAULT_STEM_MODEL_ID, STEM_MODELS, segmentsFor, stemDownloadBytes, stemFileUrl, stemModelById, stemModelFiles } from '../config';
import { encodeStem, encodeWav, muxWebmOpus, opusHead, preSkipOf, readEbml, vint } from '../encode';
import { assertFinite, createStemWorker, fetchChecked, sha256Hex, type StemRuntime, type StemWorkerConfig } from '../workerCore';
import { __setStemWorkerFactory, downloadStemModel, forgetStemModel, separateStems, stemModelUsable, stemWorkerStarted, useStemModels, workerConfig } from '../client';
import { cancelStemJob, jobFraction, jobRemaining, runStemJob, useStemJob, type StemJobDeps } from '../job';
import { backendLine, stepLine } from '../../components/audio/StemProgressScreen';

const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>, from = 0, to = a.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};
const noise = (n: number, seed = 1) => { let s = seed; return Float32Array.from({ length: n }, () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; }); };

describe('the sums', () => {
  it('FFT: forward then inverse gives the signal back; a cosine lands in its bin', () => {
    const n = 64, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    fft(re, im);
    expect(re[5]).toBeCloseTo(n / 2, 9);
    expect(re[n - 5]).toBeCloseTo(n / 2, 9);
    expect(Math.abs(re[4]) + Math.abs(im[6])).toBeLessThan(1e-9);
    fft(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i] / n).toBeCloseTo(Math.cos((2 * Math.PI * 5 * i) / n), 9);
  });

  it('reflect padding is torch\'s (the edge sample isn\'t repeated)', () => {
    expect([...reflectPad([1, 2, 3, 4], 2, 3)]).toEqual([3, 2, 1, 2, 3, 4, 3, 2, 1]);
  });

  it('STFT → iSTFT round trip is exact (two signals packed in one transform)', () => {
    const a = noise(9000, 3), b = noise(9000, 7);
    const [A, B] = stftPair(a, b, 1024, 256);
    const [ya, yb] = istftPair(A, B, 1024, 256, a.length);
    expect(maxAbs(ya, a)).toBeLessThan(1e-5);
    expect(maxAbs(yb, b)).toBeLessThan(1e-5);
    // Normalised (1/√n): Parseval holds per frame on average, so a unit sine's bin is ~√n·(Σw/n)/2
    expect(A.bins).toBe(513);
  });

  it('HT-Demucs\' spectrogram has the model\'s shape, and back gives the segment (away from its very ends)', () => {
    const L = noise(SEGMENT, 11), R = noise(SEGMENT, 13);
    const spec = demucsSpec(L, R);
    expect(spec.frames).toBe(FRAMES);
    expect(FRAMES).toBe(336);
    expect(spec.data.length).toBe(4 * BINS * FRAMES);
    const [a, b] = demucsISpec(spec.data, 0, spec.frames, SEGMENT);
    expect(a.length).toBe(SEGMENT);
    // _spec drops the Nyquist bin and two frames at each end: the middle comes back to float precision
    expect(maxAbs(a, L, 4 * NFFT, SEGMENT - 4 * NFFT)).toBeLessThan(0.02);
    expect(maxAbs(b, R, 4 * NFFT, SEGMENT - 4 * NFFT)).toBeLessThan(0.02);
    // and nearly all of the energy everywhere
    let e = 0, r = 0;
    for (let i = 0; i < SEGMENT; i++) { e += (a[i] - L[i]) ** 2; r += L[i] ** 2; }
    expect(e / r).toBeLessThan(1e-3);
    expect(HOP).toBe(1024);
  }, 30_000);

  it('cuts a song into 7.8 s segments with 25 % overlap that cover it', () => {
    expect(chunkOffsets(10, 4, 0.25)).toEqual([0, 3, 6, 9]);
    const offs = chunkOffsets(44100 * 180);
    expect(offs.length).toBe(31);
    expect(offs[offs.length - 1] + SEGMENT).toBeGreaterThanOrEqual(44100 * 180);
    expect(segmentsFor(180)).toBe(31);
    const w = triangleWeight(8);
    expect([...w]).toEqual([0.25, 0.5, 0.75, 1, 1, 0.75, 0.5, 0.25]);
  });

  it('an identity "model" through chunking and overlap-add gives the mix back exactly', async () => {
    const len = 23_456, seg = 4096;
    const L = noise(len, 5), R = noise(len, 6);
    for (let i = 0; i < len; i++) { L[i] += 0.2; R[i] -= 0.1; } // a DC offset: normalised away and back
    const identity: ChunkRunner = async (l, r) => [[l.slice(), r.slice()]];
    const seen: number[] = [];
    const [[a, b]] = await separateTrack(L, R, identity, { stems: 1, segment: seg, onChunk: (i, n) => seen.push(i, n) });
    expect(maxAbs(a, L)).toBeLessThan(1e-5);
    expect(maxAbs(b, R)).toBeLessThan(1e-5);
    expect(seen.at(-2)).toBe(seen.at(-1)); // the last call says it's done
    // Two "stems" that split the sound 30 / 70 add back up to it
    const split: ChunkRunner = async (l, r) => [[l.map(v => v * 0.3), r.map(v => v * 0.3)], [l.map(v => v * 0.7), r.map(v => v * 0.7)]];
    const [s1, s2] = await separateTrack(L, R, split, { stems: 2, segment: seg, normalise: false });
    const sum = s1[0].map((v, i) => v + s2[0][i]);
    expect(maxAbs(sum, L)).toBeLessThan(1e-5);
  });

  it('stops between segments when cancelled', async () => {
    const signal = { aborted: false };
    let calls = 0;
    const run: ChunkRunner = async (l, r) => { calls++; if (calls === 2) signal.aborted = true; return [[l, r]]; };
    await expect(separateTrack(noise(20_000), noise(20_000), run, { stems: 1, segment: 4096, signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(2);
  });
});

/** A mock backend whose tensors are plain arrays; `run` is the "model". */
function mockBackend(run: (i: number, feeds: Record<string, { data: Float32Array; dims: number[] }>) => Record<string, { data: Float32Array; dims: number[] }>) {
  const disposed: string[] = [];
  const be: ModelBackend<{ data: Float32Array; dims: number[]; name?: string }> = {
    tensor: (data, dims) => ({ data, dims }),
    run: async (i, feeds) => run(i, feeds),
    read: async t => t.data,
    dispose: t => { if (t.name) disposed.push(t.name); },
  };
  return { be, disposed };
}

describe('the runners', () => {
  it('split-cac: spectrogram and waveform in, pieces in order, masks back to waveforms plus the time branch', async () => {
    const pieces = [{ inputs: ['mag', 'mix'], outputs: ['a'] }, { inputs: ['a', 'mix'], outputs: ['x', 'xt'] }];
    const order: number[] = [];
    // "Model": stem s gets (s+1)/10 of the spectrogram, and a time branch of 0.01.
    type Tn = { data: Float32Array; dims: number[] };
    const { be, disposed } = mockBackend((i, f): Record<string, Tn> => {
      order.push(i);
      if (i === 0) return { a: { ...f.mag, name: 'a' } as Tn };
      const mag = f.a.data, n = f.mix.dims[2];
      const x = new Float32Array(4 * mag.length);
      for (let s = 0; s < 4; s++) for (let k = 0; k < mag.length; k++) x[s * mag.length + k] = mag[k] * (s + 1) / 10;
      return { x: { data: x, dims: [1, 4, 4, BINS, FRAMES], name: 'x' } as Tn, xt: { data: new Float32Array(8 * n).fill(0.01), dims: [1, 4, 2, n], name: 'xt' } as Tn };
    });
    const run = splitCacRunner(be, pieces, { freq: 'x', time: 'xt' }, 4);
    const L = noise(SEGMENT, 21), R = noise(SEGMENT, 22);
    const out = await run(L, R, { index: 0, count: 1 });
    expect(order).toEqual([0, 1]);
    expect(out).toHaveLength(4);
    const mid = SEGMENT >> 1;
    for (let s = 0; s < 4; s++) expect(out[s][0][mid]).toBeCloseTo(L[mid] * (s + 1) / 10 + 0.01, 2);
    // Every tensor between pieces was let go
    expect(disposed).toEqual(expect.arrayContaining(['a', 'x', 'xt']));
  }, 30_000);

  it('split-cac: a piece that needs a tensor nobody made is an error', async () => {
    const { be } = mockBackend(() => ({}));
    const run = splitCacRunner(be, [{ inputs: ['nope'], outputs: [] }], { freq: 'x', time: 'xt' }, 4);
    await expect(run(noise(SEGMENT), noise(SEGMENT), { index: 0, count: 1 })).rejects.toThrow(/nope/);
  }, 30_000);

  it('waveform: mix [1, 2, N] in, stems [1, S, 2, N] out', async () => {
    const { be } = mockBackend((_i, f) => {
      const n = f.mix.dims[2], y = new Float32Array(6 * 2 * n);
      for (let s = 0; s < 6; s++) for (let c = 0; c < 2; c++) for (let k = 0; k < n; k++) y[(s * 2 + c) * n + k] = f.mix.data[c * n + k] * s;
      return { stems: { data: y, dims: [1, 6, 2, n] } };
    });
    const out = await waveformRunner(be, 6)(Float32Array.of(1, 2), Float32Array.of(3, 4), { index: 0, count: 1 });
    expect(out.map(([a, b]) => [...a, ...b])).toEqual([0, 1, 2, 3, 4, 5].map(s => [1 * s, 2 * s, 3 * s, 4 * s]));
  });
});

describe('the registry', () => {
  it('pins each model to one Hugging Face revision, every file with its size and SHA-256', () => {
    expect(Object.fromEntries(STEM_MODELS.map(m => [m.id, `${m.repo}@${m.revision}`]))).toEqual({
      htdemucs: 'monteslu/htdemucs-web-onnx@a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1',
      htdemucs_6s: 'StemSplitio/htdemucs-6s-onnx@49df9b6989cf2150840ea65b0bef77a2e471b678',
    });
    for (const m of STEM_MODELS) {
      expect(m.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(m.licence).toBe('MIT');
      expect(m.commercial).toBe(true);
      for (const f of stemModelFiles(m)) { expect(f.sha256, f.path).toMatch(/^[0-9a-f]{64}$/); expect(f.bytes).toBeGreaterThan(0); }
      for (const f of stemModelFiles(m)) expect(stemFileUrl(m, f)).toBe(`https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.path}`);
    }
  });

  it('4 stems by default (21 pieces, 126 MB); 6 stems is the optional second download, with its warning', () => {
    const four = stemModelById(DEFAULT_STEM_MODEL_ID);
    expect(four.stems).toEqual(['drums', 'bass', 'other', 'vocals']);
    expect(four.files.map(f => f.path)).toEqual(Array.from({ length: 21 }, (_, i) => `htdemucs_p${String(i).padStart(2, '0')}.onnx`));
    expect(stemDownloadBytes(four)).toBe(125_886_563);
    expect(four.cpuNodes).toContain('/ReduceMean');
    const six = stemModelById('htdemucs_6s');
    expect(six.optional).toBe(true);
    expect(six.stems).toEqual(['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']);
    expect(six.warning).toMatch(/piano/i);
    expect(stemDownloadBytes(six)).toBe(136_428_532);
    expect(stemModelById('nope').id).toBe('htdemucs');
  });
});

describe('encoding', () => {
  it('writes a 16-bit stereo WAV', () => {
    const w = encodeWav(Float32Array.of(0, 1, -1), Float32Array.of(0.5, 0, 2), 44100);
    const v = new DataView(w.buffer);
    expect(new TextDecoder().decode(w.subarray(0, 4))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(12);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(52, true), v.getInt16(54, true)]).toEqual([0, 16384, 32767, -32767, 32767]);
  });

  it('EBML sizes: the shortest variable-length integer', () => {
    expect([...vint(5)]).toEqual([0x85]);
    expect([...vint(200)]).toEqual([0x40, 200]);
    expect(vint(1e6).length).toBe(3);
  });

  it('muxes Opus packets into a WebM: header, info, one Opus track with its delay, clusters of ≤ 5 s', () => {
    const head = opusHead(2, 312, 44100);
    expect(preSkipOf(head)).toBe(312);
    const packets = Array.from({ length: 600 }, (_, i) => ({ data: new Uint8Array([i & 0xff, 1, 2]), timestamp: i * 20_000 }));
    const webm = muxWebmOpus(packets, { opusHead: head, channels: 2, durationMs: 12_000, preSkip: 312 });
    const top = readEbml(webm);
    expect(top.map(e => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
    const seg = top[1].children!;
    expect(seg[0].id).toBe(0x1549a966); // Info
    expect(seg[1].id).toBe(0x1654ae6b); // Tracks
    const track = seg[1].children![0].children!;
    const codec = track.find(e => e.id === 0x86)!;
    expect(new TextDecoder().decode(webm.subarray(codec.start, codec.start + codec.size))).toBe('A_OPUS');
    expect(track.some(e => e.id === 0x56aa)).toBe(true); // CodecDelay
    const clusters = seg.filter(e => e.id === 0x1f43b675);
    expect(clusters.length).toBe(3); // 12 s in clusters of ≤ 5 s
    const blocks = clusters.flatMap(c => c.children!.filter(e => e.id === 0xa3));
    expect(blocks.length).toBe(600);
  });

  it('keeps a WAV where the browser can\'t encode Opus (no WebCodecs here)', async () => {
    const r = await encodeStem(new Float32Array(10), new Float32Array(10), 44100);
    expect(r.codec).toBe('wav');
    expect(r.type).toBe('audio/wav');
  });
});

describe('the worker (mocked runtime)', () => {
  const cfg = (o: Partial<StemWorkerConfig> = {}): StemWorkerConfig => ({
    model: 'm', layout: 'waveform', stems: ['drums', 'bass'], local: false, webgpu: true,
    files: [{ url: 'https://hf/x.onnx', file: { path: 'x.onnx', bytes: 10, sha256: 'a'.repeat(64) } }], ...o,
  });
  function rig(o: { gpu?: boolean; nanOnGpu?: boolean; failGpu?: boolean } = {}) {
    const posts: Array<Record<string, unknown>> = [];
    const opened: string[] = [];
    const rt: StemRuntime<{ data: Float32Array; dims: number[] }> = {
      hasWebGpuF16: async () => o.gpu ?? true,
      fetchFile: async (_u, f, on) => { on(f.bytes / 2); on(f.bytes); return new Uint8Array(f.bytes); },
      open: async (_f, backend) => {
        if (backend === 'webgpu' && o.failGpu) throw new Error('no gpu');
        opened.push(backend);
        return {
          tensor: (data, dims) => ({ data, dims }),
          run: async (_i, f) => {
            const n = f.mix.dims[2], y = new Float32Array(2 * 2 * n);
            y.set(f.mix.data, 0); y.set(f.mix.data, 2 * n);
            if (backend === 'webgpu' && o.nanOnGpu) y.fill(NaN);
            return { stems: { data: y, dims: [1, 2, 2, n] } };
          },
          read: async t => t.data, dispose: () => {}, release: () => {},
        };
      },
      threads: () => 4,
      encode: async l => ({ bytes: new Uint8Array(l.length), type: 'audio/wav', codec: 'wav' }),
    };
    const on = createStemWorker(rt, m => posts.push(m as Record<string, unknown>));
    return { on, posts, opened };
  }

  it('load: download progress, then ready on WebGPU with the threads count', async () => {
    const { on, posts } = rig();
    await on({ type: 'load', id: 1, cfg: cfg() });
    expect(posts.filter(p => p.type === 'progress').at(-1)).toMatchObject({ phase: 'download', loaded: 10, total: 10 });
    expect(posts.at(-1)).toMatchObject({ type: 'ready', id: 1, model: 'm', backend: 'webgpu', threads: 4 });
  });

  it('falls back to WebAssembly when WebGPU won\'t open', async () => {
    const { on, posts } = rig({ failGpu: true });
    await on({ type: 'load', id: 1, cfg: cfg() });
    expect(posts.at(-1)).toMatchObject({ type: 'ready', backend: 'wasm' });
  });

  it('separate: segments, encoding, then the stems (and NaN on the GPU switches to WebAssembly)', async () => {
    const { on, posts, opened } = rig({ nanOnGpu: true });
    await on({ type: 'load', id: 1, cfg: cfg() });
    await on({ type: 'separate', id: 2, model: 'm', left: new Float32Array(1000).fill(0.1), right: new Float32Array(1000), sampleRate: 44100 });
    const done = posts.at(-1)!;
    expect(done).toMatchObject({ type: 'stems', id: 2, backend: 'wasm' });
    expect((done.stems as Array<{ name: string }>).map(s => s.name)).toEqual(['drums', 'bass']);
    expect(opened).toEqual(['webgpu', 'wasm']);
    expect(posts.some(p => p.phase === 'separate')).toBe(true);
    expect(posts.filter(p => p.phase === 'encode').map(p => p.stem)).toEqual([0, 1]);
  });

  it('refuses audio that isn\'t 44.1 kHz, and a model that isn\'t loaded', async () => {
    const { on, posts } = rig();
    await on({ type: 'separate', id: 3, model: 'm', left: new Float32Array(10), right: new Float32Array(10), sampleRate: 44100 });
    expect(posts.at(-1)).toMatchObject({ type: 'error', id: 3, message: expect.stringMatching(/isn’t loaded/) });
    await on({ type: 'load', id: 4, cfg: cfg() });
    await on({ type: 'separate', id: 5, model: 'm', left: new Float32Array(10), right: new Float32Array(10), sampleRate: 48000 });
    expect(posts.at(-1)).toMatchObject({ type: 'error', id: 5, message: expect.stringMatching(/44100/) });
  });

  it('cancel stops the job and says so', async () => {
    const { on, posts } = rig();
    await on({ type: 'load', id: 1, cfg: cfg() });
    const job = on({ type: 'separate', id: 6, model: 'm', left: new Float32Array(SEGMENT * 3), right: new Float32Array(SEGMENT * 3), sampleRate: 44100 });
    await on({ type: 'cancel', id: 7, job: 6 });
    await job;
    expect(posts.at(-1)).toMatchObject({ type: 'error', id: 6, cancelled: true });
  });

  it('assertFinite throws on NaN', () => {
    expect(() => assertFinite([[Float32Array.of(NaN), Float32Array.of(0)]])).toThrow(/NaN/);
    expect(() => assertFinite([[Float32Array.of(1), Float32Array.of(0)]])).not.toThrow();
  });

  it('fetchChecked: checks size and SHA-256, keeps the file, then serves it from the cache', async () => {
    const bytes = new TextEncoder().encode('hello stems');
    const f = { path: 'a.onnx', bytes: bytes.length, sha256: await sha256Hex(bytes) };
    const store = new Map<string, Response>();
    const cache = { match: async (u: string) => store.get(u)?.clone(), put: async (u: string, r: Response) => { store.set(u, r); }, delete: async (u: string) => store.delete(u) } as unknown as Cache;
    const fetchFn = vi.fn(async () => new Response(bytes));
    const seen: number[] = [];
    expect([...await fetchChecked('u', f, n => seen.push(n), { cache, fetch: fetchFn as unknown as typeof fetch })]).toEqual([...bytes]);
    expect(seen.at(-1)).toBe(bytes.length);
    await fetchChecked('u', f, () => {}, { cache, fetch: fetchFn as unknown as typeof fetch });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(fetchChecked('v', { ...f, sha256: '0'.repeat(64) }, () => {}, { cache: null, fetch: fetchFn as unknown as typeof fetch })).rejects.toThrow(/checksum/);
    await expect(fetchChecked('w', { ...f, bytes: 3 }, () => {}, { cache: null, fetch: fetchFn as unknown as typeof fetch })).rejects.toThrow(/expected 3 bytes/);
  });
});

describe('the client: nothing downloads until the person says yes', () => {
  let posted: Array<Record<string, unknown>>;
  let w: { postMessage: (m: unknown) => void; terminate: () => void; onmessage: ((ev: MessageEvent) => void) | null; onerror: null };
  beforeEach(() => {
    posted = [];
    localStorage.clear();
    w = {
      postMessage: (m: unknown) => {
        const msg = m as Record<string, unknown>;
        posted.push(msg);
        const reply = (d: unknown) => queueMicrotask(() => w.onmessage?.({ data: d } as MessageEvent));
        if (msg.type === 'load') { reply({ type: 'progress', id: msg.id, phase: 'download', loaded: 5, total: 10 }); reply({ type: 'ready', id: msg.id, model: 'htdemucs', backend: 'webgpu', threads: 1 }); }
        if (msg.type === 'separate') { reply({ type: 'progress', id: msg.id, phase: 'separate', chunk: 0, chunks: 1, piece: 0, pieces: 21 }); reply({ type: 'stems', id: msg.id, stems: [], backend: 'webgpu', threads: 1, ms: 5 }); }
      },
      terminate: () => {}, onmessage: null, onerror: null,
    };
    __setStemWorkerFactory(() => w as never);
    useStemModels.setState({ models: Object.fromEntries(STEM_MODELS.map(m => [m.id, { downloaded: false, status: 'idle', progress: null, backend: null, threads: 1, error: null }])) });
  });
  afterEach(() => __setStemWorkerFactory(null));

  it('separate refuses a model that isn\'t downloaded, without starting the worker', async () => {
    expect(stemModelUsable('htdemucs')).toBe(false);
    await expect(separateStems('htdemucs', new Float32Array(4), new Float32Array(4), 44100)).rejects.toThrow(/Download/);
    expect(stemWorkerStarted()).toBe(false);
    expect(posted).toEqual([]);
  });

  it('the download (after yes) loads the pinned files; then separate runs; forget offers it again', async () => {
    expect(await downloadStemModel('htdemucs')).toBe(true);
    expect(stemWorkerStarted()).toBe(true);
    const load = posted[0];
    expect(load.type).toBe('load');
    const cfg = load.cfg as StemWorkerConfig;
    expect(cfg.files).toHaveLength(21);
    expect(cfg.files[0].url).toBe('https://huggingface.co/monteslu/htdemucs-web-onnx/resolve/a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1/htdemucs_p00.onnx');
    expect(cfg.manifest?.file.path).toBe('htdemucs_split_manifest.json');
    expect(localStorage.getItem('shader-studio:stemModel:htdemucs:downloaded')).toBe('1');
    const progress: unknown[] = [];
    const r = await separateStems('htdemucs', new Float32Array(4), new Float32Array(4), 44100, { onProgress: m => progress.push(m) });
    expect(r.backend).toBe('webgpu');
    expect(progress).toEqual([{ type: 'progress', id: expect.any(Number), phase: 'separate', chunk: 0, chunks: 1, piece: 0, pieces: 21 }]);
    forgetStemModel('htdemucs');
    expect(stemModelUsable('htdemucs')).toBe(false);
  });

  it('workerConfig names the 6-stem model as one waveform graph', () => {
    const c = workerConfig('htdemucs_6s');
    expect(c.layout).toBe('waveform');
    expect(c.manifest).toBeUndefined();
    expect(c.files.map(f => f.file.path)).toEqual(['htdemucs_6s_fp16weights.onnx']);
  });
});

describe('a Separate run (the progress screen\'s states)', () => {
  const result = { stems: [], backend: 'webgpu' as const, threads: 1, ms: 10 };
  function deps(o: Partial<StemJobDeps> = {}) {
    const calls: string[] = [];
    let holds = 0;
    const d: StemJobDeps = {
      hold: () => { holds++; calls.push('hold'); return () => { holds--; calls.push('release'); }; },
      getSong: async () => new Blob([new Uint8Array(4)]),
      decode: async () => { calls.push('decode'); return { left: new Float32Array(44100 * 10), right: new Float32Array(44100 * 10) }; },
      separate: async (_m, _l, _r, _sr, x) => {
        x.onProgress({ phase: 'download', loaded: 5, total: 10 });
        expect(useStemJob.getState().job).toMatchObject({ phase: 'load', loaded: 5, total: 10, seconds: 10 });
        x.onProgress({ phase: 'separate', chunk: 1, chunks: 2, piece: 10, pieces: 20 });
        expect(useStemJob.getState().job).toMatchObject({ phase: 'separate', chunk: 1.5, chunks: 2 });
        x.onProgress({ phase: 'encode', stem: 1, stems: 4 });
        calls.push('separate');
        return result;
      },
      save: async () => { calls.push('save'); return { model: 'htdemucs', revision: 'r', of: 'song', tracks: [{ stem: 'drums', sampleId: 'stem_new', type: 'audio/webm', bytes: 1 }], at: 1 }; },
      remove: async b => { calls.push(`remove:${b?.tracks.map(t => t.sampleId).join(',')}`); },
      apply: () => { calls.push('apply'); },
      now: () => 0,
      ...o,
    };
    return { d, calls, holds: () => holds };
  }
  const input = { nodeId: 'a', songId: 'song', songName: 'Song.mp3', model: 'htdemucs', previous: { model: 'htdemucs', revision: 'r', of: 'song', tracks: [{ stem: 'bass' as const, sampleId: 'stem_old', type: 'audio/webm', bytes: 1 }], at: 0 } };

  it('done: holds the picture, steps through, keeps the stems, removes the old ones, lets the picture go', async () => {
    const { d, calls, holds } = deps();
    const end = await runStemJob(input, d);
    expect(end.kind).toBe('done');
    expect(calls).toEqual(['hold', 'decode', 'separate', 'save', 'apply', 'remove:stem_old', 'release']);
    expect(holds()).toBe(0);
    expect(useStemJob.getState()).toMatchObject({ job: null, held: false, last: { kind: 'done', nodeId: 'a' } });
  });

  it('cancelled: the picture plays again and nothing changes on the node', async () => {
    const { d, calls, holds } = deps({
      separate: async (_m, _l, _r, _sr, x) => {
        cancelStemJob();
        expect(x.signal.aborted).toBe(true);
        const e = new Error('Cancelled'); e.name = 'AbortError'; throw e;
      },
    });
    const end = await runStemJob(input, d);
    expect(end.kind).toBe('cancelled');
    expect(calls).toEqual(['hold', 'decode', 'release']);
    expect(holds()).toBe(0);
    expect(useStemJob.getState().job).toBeNull();
  });

  it('error: the picture plays again and the message is kept', async () => {
    const { d, holds } = deps({ decode: async () => { throw new Error('Could not decode'); } });
    const end = await runStemJob(input, d);
    expect(end).toMatchObject({ kind: 'error', message: 'Could not decode' });
    expect(holds()).toBe(0);
    expect(useStemJob.getState().last?.kind).toBe('error');
  });

  it('one run at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { d } = deps({ decode: async () => { await gate; return { left: new Float32Array(441000), right: new Float32Array(441000) }; } });
    const first = runStemJob(input, d);
    expect((await runStemJob(input, deps().d)).message).toMatch(/Already/);
    release();
    expect((await first).kind).toBe('done');
  });

  it('the screen\'s lines: the step, the estimate and where it runs', () => {
    const j = { nodeId: 'a', song: 'S', model: 'htdemucs', phase: 'separate' as const, chunk: 2, chunks: 8, stem: 0, stems: 4, loaded: 0, total: 0, startedAt: 0, separateAt: 1000, seconds: 60, backend: 'wasm' as const, threads: 8 };
    expect(stepLine(j, null)).toBe('Separating: segment 3 of 8 (7.8 s each)');
    expect(stepLine({ ...j, phase: 'load', loaded: 0, total: 0 }, { loaded: 63e6, total: 126e6 })).toMatch(/63 MB of 126 MB/);
    expect(stepLine({ ...j, phase: 'encode', stem: 3 }, null)).toMatch(/Vocals \(4 of 4\)/);
    expect(backendLine(j)).toMatch(/8 threads/);
    expect(backendLine({ backend: 'wasm', threads: 1 })).toMatch(/one thread/);
    expect(backendLine({ backend: 'webgpu', threads: 1 })).toMatch(/WebGPU/);
    // 2 segments in 4 s: 6 more take 12 s, plus encoding
    expect(jobRemaining(j, 5000)).toBe(16);
    expect(jobFraction(j)).toBeCloseTo(0.05 + 0.85 * 0.25);
    expect(jobRemaining({ ...j, chunk: 0 }, 5000)).toBeNull();
  });
});
