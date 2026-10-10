/**
 * The depth models (docs/depth-node.md): the config (repos, pinned revisions, files and sizes, licences), the
 * worker's protocol with a mocked model, and the client: nothing runs until a model is downloaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: () => null, get length() { return mem.size; }, clear: () => mem.clear(),
  };
});

import { DEFAULT_DEPTH_MODEL_ID, DEPTH_MODELS, depthDownloadBytes, depthModelById, formatDepthBytes, licenceLine, modelSide } from '../config';
import { createDepthWorker, normalizeDepth, rgbaToRgb, type DepthLoader, type DepthWorkerConfig, type Estimator } from '../workerCore';
import {
  __setDepthWorkerFactory, depthModelUsable, depthWorkerStarted, downloadDepthModel, ensureDepthModel, estimateDepth, forgetDepthModel, useDepthModels,
} from '../client';
// @ts-expect-error a plain .mjs tool
import { depthModels as toolModels } from '../../../tools/fetch-depth-models.mjs';

const SUFFIX: Record<string, string> = { fp16: '_fp16', q4f16: '_q4f16', q8: '_quantized', uint8: '_uint8' };

describe('depth model config', () => {
  it('keeps one model, Depth Anything V2 Small (Base and MiDaS dropped 2026-10-10)', () => {
    expect(DEPTH_MODELS.map(m => m.repo)).toEqual(['onnx-community/depth-anything-v2-small']);
    expect(DEFAULT_DEPTH_MODEL_ID).toBe('depth-anything-v2-small');
    // Saved graphs that picked a dropped model fall back to it
    expect(depthModelById('depth-anything-v2-base').id).toBe(DEFAULT_DEPTH_MODEL_ID);
    expect(depthModelById('nope').id).toBe(DEFAULT_DEPTH_MODEL_ID);
  });

  it('pins it to a revision (a commit sha, checked 2026-10-09)', () => {
    for (const m of DEPTH_MODELS) expect(m.revision, m.id).toMatch(/^[0-9a-f]{40}$/);
    expect(depthModelById('depth-anything-v2-small').revision).toBe('4472b7362082ad9968fee890ca0f1e5aca36b93d');
  });

  it('runs fp16 maths on WebGPU and 8-bit on WebAssembly, each with its file', () => {
    for (const m of DEPTH_MODELS) {
      expect(['fp16', 'q4f16']).toContain(m.dtype.webgpu);
      expect(['q8', 'uint8']).toContain(m.dtype.wasm);
      for (const b of ['webgpu', 'wasm'] as const) expect(m.weights[b].path, `${m.id} ${b}`).toBe(`onnx/model${SUFFIX[m.dtype[b]]}.onnx`);
      expect(m.files.map(f => f.path).sort()).toEqual(['config.json', 'preprocessor_config.json']);
    }
  });

  it('knows its download size (from the Hugging Face tree) and licence', () => {
    const small = depthModelById('depth-anything-v2-small');
    expect(small.weights.webgpu.bytes).toBe(49642442);
    expect(small.weights.wasm.bytes).toBe(27258801);
    expect(formatDepthBytes(depthDownloadBytes(small, 'webgpu'))).toBe('50 MB');
    expect(small).toMatchObject({ licence: 'Apache-2.0', commercial: true });
    expect(licenceLine(small)).toBe('Licence: Apache-2.0.');
    expect(modelSide(small, 518)).toBe(518);
  });

  it('the fetch tool reads the same repos, revisions and files', () => {
    const t = toolModels() as Array<{ id: string; repo: string; revision: string; files: Array<{ path: string; bytes: number }> }>;
    expect(t.map(m => m.id)).toEqual(DEPTH_MODELS.map(m => m.id));
    for (const m of DEPTH_MODELS) {
      const got = t.find(x => x.id === m.id)!;
      expect(got.repo).toBe(m.repo);
      expect(got.revision).toBe(m.revision);
      expect(got.files.map(f => `${f.path}:${f.bytes}`).sort()).toEqual([...m.files, m.weights.webgpu, m.weights.wasm].map(f => `${f.path}:${f.bytes}`).sort());
    }
  });
});

// ── The worker's protocol, with a mocked model ───────────────────────────────

const cfgOf = (id: string): DepthWorkerConfig => { const m = depthModelById(id); return { model: m.id, repo: m.repo, revision: m.revision, dtype: { ...m.dtype }, local: false, localPath: '/depth-models/', webgpu: true }; };

/** A fake model: depth = the red channel (raw, 0–255), at the frame's size. */
const redModel: Estimator = async (rgb, w, h) => ({ data: Float32Array.from({ length: w * h }, (_, i) => rgb[i * 3] * 3 + 10), w, h });

function mockLoader(o: { gpu?: boolean; failGpu?: boolean } = {}) {
  const calls: Array<{ repo: string; revision: string; backend: string; dtype: string }> = [];
  const loader: DepthLoader = {
    hasWebGpuF16: async () => o.gpu ?? true,
    load: async (cfg, backend, onProgress) => {
      calls.push({ repo: cfg.repo, revision: cfg.revision, backend, dtype: cfg.dtype[backend] });
      if (backend === 'webgpu' && o.failGpu) throw new Error('no adapter');
      onProgress({ file: 'onnx/model_fp16.onnx', loaded: 10, total: 20 });
      onProgress({ file: 'onnx/model_fp16.onnx', done: true });
      return redModel;
    },
  };
  return { loader, calls };
}

describe('depth worker protocol', () => {
  it('turns RGBA into top-down RGB (flipping WebGL rows)', () => {
    const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]); // 1 × 2: bottom row first
    expect([...rgbaToRgb(rgba, 1, 2, false)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...rgbaToRgb(rgba, 1, 2, true)]).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it('stretches raw depth to 0–1; a flat frame reads 0', () => {
    expect([...normalizeDepth([10, 20, 30])]).toEqual([0, 0.5, 1]);
    expect([...normalizeDepth([5, 5])]).toEqual([0, 0]);
  });

  it('loads (pinned revision, WebGPU dtype), reports progress, then answers a frame with 0–1 depth', async () => {
    const out: Array<Record<string, unknown>> = [];
    const { loader, calls } = mockLoader();
    const on = createDepthWorker(loader, m => out.push(m as Record<string, unknown>));
    await on({ type: 'load', id: 1, cfg: cfgOf('depth-anything-v2-small') });
    expect(calls).toEqual([{ repo: 'onnx-community/depth-anything-v2-small', revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d', backend: 'webgpu', dtype: 'fp16' }]);
    expect(out.filter(m => m.type === 'progress')).toHaveLength(2);
    expect(out.at(-1)).toMatchObject({ type: 'ready', id: 1, model: 'depth-anything-v2-small', backend: 'webgpu' });
    // 2 × 1 frame: red 0 and 255
    await on({ type: 'depth', id: 2, model: 'depth-anything-v2-small', rgba: new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255]), w: 2, h: 1, flipY: false, side: 384 });
    const d = out.at(-1)!;
    expect(d).toMatchObject({ type: 'depth', id: 2, w: 2, h: 1 });
    expect([...(d.depth as Float32Array)]).toEqual([0, 1]);
    expect(typeof d.ms).toBe('number');
  });

  it('falls back to WebAssembly (8-bit) when WebGPU fails or lacks shader-f16', async () => {
    const out: Array<Record<string, unknown>> = [];
    const a = mockLoader({ failGpu: true });
    await createDepthWorker(a.loader, m => out.push(m as Record<string, unknown>))({ type: 'load', id: 1, cfg: cfgOf('depth-anything-v2-small') });
    expect(a.calls.map(c => `${c.backend}:${c.dtype}`)).toEqual(['webgpu:fp16', 'wasm:q8']);
    expect(out.at(-1)).toMatchObject({ type: 'ready', backend: 'wasm' });
    const b = mockLoader({ gpu: false });
    await createDepthWorker(b.loader, () => {})({ type: 'load', id: 1, cfg: cfgOf('depth-anything-v2-small') });
    expect(b.calls.map(c => `${c.backend}:${c.dtype}`)).toEqual(['wasm:q8']);
  });

  it('answers an error for a model that isn’t loaded, and loads each model once', async () => {
    const out: Array<Record<string, unknown>> = [];
    const { loader, calls } = mockLoader();
    const on = createDepthWorker(loader, m => out.push(m as Record<string, unknown>));
    await on({ type: 'depth', id: 1, model: 'depth-anything-v2-small', rgba: new Uint8Array(4), w: 1, h: 1 });
    expect(out.at(-1)).toMatchObject({ type: 'error', id: 1 });
    await Promise.all([on({ type: 'load', id: 2, cfg: cfgOf('depth-anything-v2-small') }), on({ type: 'load', id: 3, cfg: cfgOf('depth-anything-v2-small') })]);
    expect(calls).toHaveLength(1);
    expect(out.filter(m => m.type === 'ready')).toHaveLength(2);
  });
});

// ── The client: nothing runs until downloaded ────────────────────────────────

/** A fake Worker running the real protocol over a mocked model, asynchronously like a worker. */
function fakeWorkerFactory(started: { n: number; msgs: Array<Record<string, unknown>> }) {
  return () => {
    started.n++;
    const w = {
      onmessage: null as ((ev: MessageEvent) => void) | null,
      onerror: null as ((ev: ErrorEvent) => void) | null,
      terminate: () => {},
      postMessage: (m: Record<string, unknown>) => { started.msgs.push(m); setTimeout(() => void on(m as never), 0); },
    };
    const on = createDepthWorker(mockLoader().loader, (m) => w.onmessage?.({ data: m } as MessageEvent));
    return w;
  };
}

describe('depth client', () => {
  let started: { n: number; msgs: Array<Record<string, unknown>> };
  beforeEach(() => {
    localStorage.clear();
    started = { n: 0, msgs: [] };
    __setDepthWorkerFactory(fakeWorkerFactory(started));
    for (const m of DEPTH_MODELS) forgetDepthModel(m.id);
  });
  afterEach(() => __setDepthWorkerFactory(null));

  const frame = () => ({ rgba: new Uint8Array([0, 0, 0, 255, 200, 0, 0, 255]), w: 2, h: 1, flipY: false });

  it('nothing runs until the model is downloaded: no worker, no depth', async () => {
    expect(depthModelUsable('depth-anything-v2-small')).toBe(false);
    expect(await ensureDepthModel('depth-anything-v2-small')).toBe(false);
    expect(await estimateDepth('depth-anything-v2-small', frame(), 384)).toBeNull();
    expect(depthWorkerStarted()).toBe(false);
    expect(started.n).toBe(0);
  });

  it('the opt-in download starts the worker, loads the pinned model and remembers it', async () => {
    expect(await downloadDepthModel('depth-anything-v2-small')).toBe(true);
    expect(started.n).toBe(1);
    expect(started.msgs[0]).toMatchObject({ type: 'load', cfg: { repo: 'onnx-community/depth-anything-v2-small', revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d' } });
    expect(useDepthModels.getState().models['depth-anything-v2-small']).toMatchObject({ downloaded: true, status: 'ready', backend: 'webgpu' });
    expect(localStorage.getItem('shader-studio:depthModel:depth-anything-v2-small:downloaded')).toBe('1');
    const r = await estimateDepth('depth-anything-v2-small', frame(), 384);
    expect(r && [...r.depth]).toEqual([0, 1]);
    expect(useDepthModels.getState().models['depth-anything-v2-small'].runs).toBe(1);
    // Another model still isn't downloaded: it doesn't run.
    expect(await estimateDepth('dpt-hybrid-midas', frame(), 384)).toBeNull();
    expect(started.msgs.filter(m => m.type === 'load')).toHaveLength(1);
  });

  it('forgetting a model offers the download again', async () => {
    await downloadDepthModel('dpt-hybrid-midas');
    forgetDepthModel('dpt-hybrid-midas');
    expect(depthModelUsable('dpt-hybrid-midas')).toBe(false);
    expect(await estimateDepth('dpt-hybrid-midas', frame(), 384)).toBeNull();
  });
});
