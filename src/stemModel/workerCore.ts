/**
 * workerCore.ts — the stem worker's messages (docs/stems.md), apart from ONNX Runtime so the tests drive it with a
 * mocked runtime. worker.ts plugs the real one in.
 *
 * Messages in:
 *   { type: 'load', id, cfg }                                  fetch (or take from the cache) and check every file, then
 *                                                              open the model: WebGPU when it has shader-f16, else WebAssembly
 *   { type: 'separate', id, model, left, right, sampleRate }   a whole song (44.1 kHz stereo) → its stems, each encoded
 *   { type: 'cancel', id, job }                                stop job `job` at the next piece / segment
 *   { type: 'unload', id, model }
 * Messages out:
 *   { type: 'progress', id, phase: 'download', loaded, total }
 *   { type: 'progress', id, phase: 'separate', chunk, chunks, piece, pieces }
 *   { type: 'progress', id, phase: 'encode', stem, stems }
 *   { type: 'ready', id, model, backend, threads, ms }
 *   { type: 'stems', id, stems: [{ name, bytes, type, codec }], backend, threads, ms }
 *   { type: 'error', id, message, cancelled? }
 */
import type { StemBackend, StemFile, StemLayout, StemName } from './config';
import { SAMPLE_RATE, separateTrack, StemCancelled } from './dsp';
import type { EncodedStem } from './encode';
import { splitCacRunner, waveformRunner, type ModelBackend, type PieceSpec } from './runners';

export interface StemWorkerConfig {
  model: string;
  layout: StemLayout;
  stems: StemName[];
  /** The manifest (split-cac) first, then the model files, each with its URL. */
  manifest?: { url: string; file: StemFile };
  files: Array<{ url: string; file: StemFile }>;
  cpuNodes?: string[];
  /** Read from the app's own files (a local check): no cache. */
  local: boolean;
  /** Try WebGPU first. */
  webgpu: boolean;
}

/** A loaded model on one backend: the runner's backend plus a way to free it. */
export type LoadedBackend<T> = ModelBackend<T> & { release(): Promise<void> | void };

export interface StemRuntime<T = unknown> {
  hasWebGpuF16(): Promise<boolean>;
  /** One file's bytes: from the cache, else fetched (reporting bytes as they come) and kept; checked against its SHA-256. */
  fetchFile(url: string, f: StemFile, onBytes: (loaded: number) => void, cache: boolean): Promise<Uint8Array>;
  /** Open the model files on a backend. */
  open(files: Uint8Array[], backend: StemBackend, o: { cpuNodes?: string[]; layout: StemLayout }): Promise<LoadedBackend<T>>;
  /** WebAssembly threads in use (1 without cross-origin isolation). */
  threads(): number;
  encode(left: Float32Array, right: Float32Array, sampleRate: number): Promise<EncodedStem>;
}

type Post = (m: unknown, transfer?: Transferable[]) => void;

interface Loaded<T> {
  cfg: StemWorkerConfig; backend: StemBackend; be: LoadedBackend<T>; pieces: PieceSpec[]; out: { freq: string; time: string };
  /** The files, kept on WebGPU until a first result came out finite (to reopen on WebAssembly if it didn't). */
  files: Uint8Array[];
  verified: boolean;
}

/** Throws when a result holds NaN or ∞ (fp16 overflow on a GPU): the caller falls back to WebAssembly. */
export function assertFinite(stems: ReadonlyArray<[Float32Array, Float32Array]>): void {
  for (const [a, b] of stems) {
    for (let i = 0; i < a.length; i += 97) if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new NonFinite();
  }
}
class NonFinite extends Error { constructor() { super('The model gave NaN on this GPU'); } }

export function createStemWorker<T>(rt: StemRuntime<T>, post: Post) {
  const models = new Map<string, Loaded<T>>();
  const loading = new Map<string, Promise<Loaded<T>>>();
  const jobs = new Map<number, { aborted: boolean }>();

  async function fetchAll(id: number, cfg: StemWorkerConfig): Promise<{ manifest: { pieces: PieceSpec[]; outputs: { freq: string; time: string } } | null; files: Uint8Array[] }> {
    const all = [...(cfg.manifest ? [cfg.manifest] : []), ...cfg.files];
    const total = all.reduce((s, f) => s + f.file.bytes, 0);
    const done = new Array<number>(all.length).fill(0);
    let last = 0;
    const report = (force = false) => {
      const loaded = done.reduce((s, v) => s + v, 0), now = Date.now();
      if (!force && now - last < 100) return;
      last = now;
      post({ type: 'progress', id, phase: 'download', loaded: Math.min(loaded, total), total });
    };
    const bytes: Uint8Array[] = [];
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      bytes.push(await rt.fetchFile(f.url, f.file, n => { done[i] = n; report(); }, !cfg.local));
      done[i] = f.file.bytes;
      report(true);
    }
    let manifest = null;
    if (cfg.manifest) {
      const m = JSON.parse(new TextDecoder().decode(bytes.shift())) as { pieces: Array<{ file: string; inputs: string[]; outputs: string[] }>; outputs: { freq: string; time: string } };
      if (m.pieces.length !== cfg.files.length || m.pieces.some((p, i) => !cfg.files[i].file.path.endsWith(p.file))) throw new Error('The model\'s pieces don\'t match its manifest');
      manifest = { pieces: m.pieces.map(p => ({ inputs: p.inputs, outputs: p.outputs })), outputs: m.outputs };
    }
    return { manifest, files: bytes };
  }

  async function open(cfg: StemWorkerConfig, files: Uint8Array[], wantGpu: boolean): Promise<{ backend: StemBackend; be: LoadedBackend<T> }> {
    let backend: StemBackend = wantGpu && (await rt.hasWebGpuF16()) ? 'webgpu' : 'wasm';
    try {
      return { backend, be: await rt.open(files, backend, { cpuNodes: cfg.cpuNodes, layout: cfg.layout }) };
    } catch (e) {
      if (backend !== 'webgpu') throw e;
      console.warn('[stems] WebGPU failed, using WebAssembly', e);
      backend = 'wasm';
      return { backend, be: await rt.open(files, backend, { cpuNodes: cfg.cpuNodes, layout: cfg.layout }) };
    }
  }

  async function load(id: number, cfg: StemWorkerConfig): Promise<Loaded<T>> {
    const { manifest, files } = await fetchAll(id, cfg);
    const { backend, be } = await open(cfg, files, cfg.webgpu);
    return { cfg, backend, be, pieces: manifest?.pieces ?? [], out: manifest?.outputs ?? { freq: 'x', time: 'xt' }, files: backend === 'webgpu' ? files : [], verified: backend !== 'webgpu' };
  }

  async function separate(id: number, m: Loaded<T>, left: Float32Array, right: Float32Array, sampleRate: number, job: { aborted: boolean }) {
    if (sampleRate !== SAMPLE_RATE) throw new Error(`Stems need ${SAMPLE_RATE} Hz audio, got ${sampleRate}`);
    const n = m.cfg.stems.length;
    let chunk = 0, chunks = 1;
    const pieces = m.cfg.layout === 'split-cac' ? m.pieces.length : 1;
    const runnerFor = (be: LoadedBackend<T>) => (m.cfg.layout === 'split-cac'
      ? splitCacRunner(be, m.pieces, m.out, n, { signal: job, onPiece: (p, of) => post({ type: 'progress', id, phase: 'separate', chunk, chunks, piece: p, pieces: of }) })
      : waveformRunner(be, n));
    let run = runnerFor(m.be);
    let checked = m.verified;
    const stems = await separateTrack(left, right, async (l, r, at) => {
      let res = await run(l, r, at);
      if (!checked && !job.aborted) {
        checked = true;
        try { assertFinite(res); m.verified = true; m.files = []; } catch (e) {
          if (!(e instanceof NonFinite)) throw e;
          // fp16 overflowed on this GPU: the rest (and this segment again) on WebAssembly.
          console.warn('[stems] NaN on WebGPU, using WebAssembly');
          await m.be.release();
          const w = await rt.open(m.files, 'wasm', { cpuNodes: m.cfg.cpuNodes, layout: m.cfg.layout });
          m.be = w; m.backend = 'wasm'; m.verified = true; m.files = [];
          run = runnerFor(w);
          res = await run(l, r, at);
        }
      }
      return res;
    }, { stems: n, signal: job, onChunk: (c, of) => { chunk = c; chunks = of; post({ type: 'progress', id, phase: 'separate', chunk: c, chunks: of, piece: 0, pieces }); } });
    if (job.aborted) throw new StemCancelled();
    const out: Array<{ name: StemName } & EncodedStem> = [];
    for (let s = 0; s < n; s++) {
      if (job.aborted) throw new StemCancelled();
      post({ type: 'progress', id, phase: 'encode', stem: s, stems: n });
      const enc = await rt.encode(stems[s][0], stems[s][1], sampleRate);
      out.push({ name: m.cfg.stems[s], ...enc });
      // Let go of the raw stem as soon as it's encoded.
      stems[s] = [new Float32Array(0), new Float32Array(0)];
    }
    return out;
  }

  return async function onMessage(msg: { type: string; id: number; cfg?: StemWorkerConfig; model?: string; left?: Float32Array; right?: Float32Array; sampleRate?: number; job?: number }): Promise<void> {
    try {
      if (msg.type === 'cancel') {
        const j = jobs.get(msg.job!);
        if (j) j.aborted = true;
        return;
      }
      if (msg.type === 'load') {
        const cfg = msg.cfg!;
        const t0 = performance.now();
        let p = loading.get(cfg.model);
        if (!p) { p = load(msg.id, cfg).then(l => { models.set(cfg.model, l); return l; }, e => { loading.delete(cfg.model); throw e; }); loading.set(cfg.model, p); }
        const l = await p;
        post({ type: 'ready', id: msg.id, model: cfg.model, backend: l.backend, threads: rt.threads(), ms: Math.round(performance.now() - t0) });
        return;
      }
      if (msg.type === 'unload') {
        const l = models.get(msg.model!);
        models.delete(msg.model!); loading.delete(msg.model!);
        await l?.be.release();
        post({ type: 'unloaded', id: msg.id, model: msg.model });
        return;
      }
      if (msg.type === 'separate') {
        const m = models.get(msg.model!);
        if (!m) throw new Error('That stem model isn’t loaded');
        const job = { aborted: false };
        jobs.set(msg.id, job);
        const t0 = performance.now();
        try {
          const stems = await separate(msg.id, m, msg.left!, msg.right!, msg.sampleRate!, job);
          post({ type: 'stems', id: msg.id, stems, backend: m.backend, threads: rt.threads(), ms: Math.round(performance.now() - t0) }, stems.map(s => s.bytes.buffer as ArrayBuffer));
        } finally { jobs.delete(msg.id); }
        return;
      }
      throw new Error(`Unknown message ${msg.type}`);
    } catch (e) {
      const cancelled = e instanceof StemCancelled || (e instanceof Error && e.name === 'AbortError');
      post({ type: 'error', id: msg.id, message: cancelled ? 'Cancelled' : e instanceof Error ? e.message : String(e), ...(cancelled ? { cancelled: true } : {}) });
    }
  };
}

/** SHA-256 of bytes as hex (Web Crypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch one file with progress, through a cache: a cached copy is used as it is (it was checked when it came in); a
 * fetched one is checked against its size and SHA-256, then kept.
 */
export async function fetchChecked(url: string, f: StemFile, onBytes: (n: number) => void, o: { cache: Cache | null; fetch?: typeof fetch }): Promise<Uint8Array> {
  const hit = o.cache ? await o.cache.match(url).catch(() => undefined) : undefined;
  if (hit) {
    const b = new Uint8Array(await hit.arrayBuffer());
    if (b.length === f.bytes) { onBytes(b.length); return b; }
    await o.cache?.delete(url).catch(() => false);
  }
  const res = await (o.fetch ?? fetch)(url);
  if (!res.ok) throw new Error(`Couldn't download ${f.path} (${res.status})`);
  let bytes: Uint8Array;
  if (res.body) {
    const reader = res.body.getReader();
    const buf = new Uint8Array(f.bytes);
    let n = 0, extra: Uint8Array[] | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length <= buf.length && !extra) buf.set(value, n);
      else (extra ??= [buf.subarray(0, n)]).push(value);
      n += value.length;
      onBytes(n);
    }
    if (extra) { bytes = new Uint8Array(n); let o2 = 0; for (const p of extra) { bytes.set(p, o2); o2 += p.length; } }
    else bytes = n === buf.length ? buf : buf.slice(0, n);
  } else bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length !== f.bytes) throw new Error(`${f.path}: expected ${f.bytes} bytes, got ${bytes.length}`);
  const sha = await sha256Hex(bytes);
  if (sha !== f.sha256) throw new Error(`${f.path} didn't match its checksum`);
  if (o.cache) await o.cache.put(url, new Response(bytes as BufferSource, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) } })).catch(() => {});
  return bytes;
}
