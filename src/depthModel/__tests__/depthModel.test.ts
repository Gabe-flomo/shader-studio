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

import { DEFAULT_DEPTH_MODEL_ID, DEPTH_MODELS, depthDownloadBytes, depthModelById, depthModelFiles, formatDepthBytes, isMetricModel, licenceLine, modelSide, visibleDepthModels } from '../config';
import { DEPTH_EXPERIMENTAL_KEY, depthExperimentalOn, depthModelOptions, effectiveDepthModel, setDepthExperimental } from '../experimental';
import { createDepthWorker, inputSize, invertDepth, metricDistance, normalizeDepth, preprocessFrame, rgbaToRgb, type DepthLoader, type DepthWorkerConfig, type Estimator } from '../workerCore';
import {
  __setDepthWorkerFactory, depthModelUsable, depthWorkerStarted, downloadDepthModel, ensureDepthModel, estimateDepth, forgetDepthModel, useDepthModels,
} from '../client';
// @ts-expect-error a plain .mjs tool
import { depthModels as toolModels } from '../../../tools/fetch-depth-models.mjs';

const SUFFIX: Record<string, string> = { fp32: '', fp16: '_fp16', q4f16: '_q4f16', q4: '_q4', q8: '_quantized', uint8: '_uint8' };

describe('depth model config', () => {
  it('shows Depth Anything V2 Small only, unless experimental models are on', () => {
    expect(DEPTH_MODELS[0].repo).toBe('onnx-community/depth-anything-v2-small');
    expect(DEFAULT_DEPTH_MODEL_ID).toBe('depth-anything-v2-small');
    expect(DEPTH_MODELS.filter(m => !m.experimental).map(m => m.id)).toEqual(['depth-anything-v2-small']);
    expect(visibleDepthModels(false).map(m => m.id)).toEqual(['depth-anything-v2-small']);
    expect(visibleDepthModels(true).map(m => m.id)).toEqual(['depth-anything-v2-small', 'depth-anything-v2-base', 'dpt-hybrid-midas', 'depth-anything-v3-small', 'depth-pro', 'zoedepth-nyu-kitti']);
    // An experimental pick plays with Small while the setting is off
    expect(depthModelById('depth-anything-v2-base', false).id).toBe(DEFAULT_DEPTH_MODEL_ID);
    expect(depthModelById('depth-anything-v2-base', true).id).toBe('depth-anything-v2-base');
    expect(depthModelById('nope').id).toBe(DEFAULT_DEPTH_MODEL_ID);
  });

  it('pins every model to a revision (commit shas checked through the HF API, 2026-10-09/10)', () => {
    for (const m of DEPTH_MODELS) expect(m.revision, m.id).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.fromEntries(DEPTH_MODELS.map(m => [m.id, `${m.repo}@${m.revision}`]))).toEqual({
      'depth-anything-v2-small': 'onnx-community/depth-anything-v2-small@4472b7362082ad9968fee890ca0f1e5aca36b93d',
      'depth-anything-v2-base': 'onnx-community/depth-anything-v2-base@dd4557d492cd7b563738ac8d9ccff9094620983c',
      'dpt-hybrid-midas': 'Xenova/dpt-hybrid-midas@8af5a62e326ba3e842759aa27e13008c1c758db5',
      'depth-anything-v3-small': 'onnx-community/depth-anything-v3-small@0b6a7f3bf5595f9950b91389e0da3a0de130324c',
      'depth-pro': 'onnx-community/DepthPro-ONNX@feefb662b967b477367485dc4f133aeecd638ba4',
      'zoedepth-nyu-kitti': 'Heliosoph/zoedepth-nyu-kitti-onnx@181dcea7dfa1bc7ca7daaec094e0562446ca11fb',
    });
  });

  it('names each backend\'s weights file after its dtype (Transformers.js\' suffixes), in its folder', () => {
    for (const m of DEPTH_MODELS) {
      const folder = m.subfolder === undefined ? 'onnx/' : m.subfolder ? `${m.subfolder}/` : '';
      for (const b of ['webgpu', 'wasm'] as const) expect(m.weights[b].path, `${m.id} ${b}`).toBe(`${folder}model${SUFFIX[m.dtype[b]]}.onnx`);
      expect(m.files.some(f => f.path === 'config.json'), m.id).toBe(true);
    }
    // Small: fp16 maths on WebGPU, 8-bit on WebAssembly
    expect(depthModelById('depth-anything-v2-small').dtype).toEqual({ webgpu: 'fp16', wasm: 'q8' });
    // DA3 Small is one fp32 file with its weights beside it; ZoeDepth one fp16 file at the repo's root
    expect(depthModelById('depth-anything-v3-small').data).toEqual({ path: 'onnx/model.onnx_data', bytes: 104702464 });
    expect(depthModelById('zoedepth-nyu-kitti')).toMatchObject({ subfolder: '', modelClass: 'DPTForDepthEstimation', preprocess: 'half32' });
  });

  it('knows each download\'s size (from the Hugging Face tree)', () => {
    const size = (id: string, b: 'webgpu' | 'wasm' = 'webgpu') => formatDepthBytes(depthDownloadBytes(depthModelById(id), b));
    expect(depthModelById('depth-anything-v2-small').weights.webgpu.bytes).toBe(49642442);
    expect(depthModelById('depth-anything-v2-small').weights.wasm.bytes).toBe(27258801);
    expect(size('depth-anything-v2-small')).toBe('50 MB');
    expect(size('depth-anything-v2-base')).toBe('72 MB');
    expect(size('dpt-hybrid-midas')).toBe('118 MB');
    expect(size('depth-anything-v3-small')).toBe('105 MB');
    expect(size('depth-pro')).toBe('600 MB');
    expect(size('depth-pro', 'wasm')).toBe('746 MB');
    expect(size('zoedepth-nyu-kitti')).toBe('693 MB');
  });

  it('carries each licence; non-commercial ones say "testing only"', () => {
    const lic = Object.fromEntries(DEPTH_MODELS.map(m => [m.id, [m.licence, m.commercial]]));
    expect(lic).toEqual({
      'depth-anything-v2-small': ['Apache-2.0', true],
      'depth-anything-v2-base': ['CC-BY-NC-4.0', false],
      'dpt-hybrid-midas': ['Apache-2.0', true],
      'depth-anything-v3-small': ['Apache-2.0', true],
      'depth-pro': ['apple-ascl', false],
      'zoedepth-nyu-kitti': ['MIT', true],
    });
    expect(licenceLine(depthModelById('depth-anything-v2-small'))).toBe('Licence: Apache-2.0.');
    for (const id of ['depth-anything-v2-base', 'depth-pro']) {
      expect(licenceLine(depthModelById(id))).toMatch(/testing only, not for paid releases/i);
      expect(depthModelById(id).note).toMatch(/testing only/i);
    }
  });

  it('knows which give real distances, and which run only at their own size', () => {
    expect(DEPTH_MODELS.filter(isMetricModel).map(m => m.id)).toEqual(['depth-pro', 'zoedepth-nyu-kitti']);
    expect(depthModelById('depth-anything-v3-small').output).toBe('depth');
    expect(modelSide(depthModelById('dpt-hybrid-midas'), 518)).toBe(384);
    expect(modelSide(depthModelById('depth-pro'), 384)).toBe(1536);
    expect(modelSide(depthModelById('depth-anything-v2-small'), 518)).toBe(518);
  });

  it('the fetch tool reads the same repos, revisions and files (each once)', () => {
    const t = toolModels() as Array<{ id: string; repo: string; revision: string; files: Array<{ path: string; bytes: number }> }>;
    expect(t.map(m => m.id)).toEqual(DEPTH_MODELS.map(m => m.id));
    for (const m of DEPTH_MODELS) {
      const got = t.find(x => x.id === m.id)!;
      expect(got.repo).toBe(m.repo);
      expect(got.revision).toBe(m.revision);
      expect(got.files.map(f => `${f.path}:${f.bytes}`).sort()).toEqual(depthModelFiles(m).map(f => `${f.path}:${f.bytes}`).sort());
    }
  });
});

describe('experimental depth models setting', () => {
  afterEach(() => setDepthExperimental(false));

  it('off by default: no picker, Small runs whatever a node picked', () => {
    setDepthExperimental(false);
    expect(depthExperimentalOn()).toBe(false);
    expect(depthModelOptions()).toEqual([]);
    expect(effectiveDepthModel('depth-pro').id).toBe('depth-anything-v2-small');
  });

  it('on: the picker lists every model (marked) and a node runs its pick; remembered in this browser', () => {
    setDepthExperimental(true);
    expect(localStorage.getItem(DEPTH_EXPERIMENTAL_KEY)).toBe('1');
    const opts = depthModelOptions();
    expect(opts.map(o => o.value)).toEqual(DEPTH_MODELS.map(m => m.id));
    expect(opts.find(o => o.value === 'depth-pro')!.label).toMatch(/experimental.*testing only/);
    expect(opts[0].label).toBe('Depth Anything V2 Small');
    expect(effectiveDepthModel('depth-pro').id).toBe('depth-pro');
    setDepthExperimental(false);
    expect(localStorage.getItem(DEPTH_EXPERIMENTAL_KEY)).toBeNull();
  });
});

// ── The worker's protocol, with a mocked model ───────────────────────────────

const cfgOf = (id: string): DepthWorkerConfig => { const m = depthModelById(id); return { model: m.id, repo: m.repo, revision: m.revision, dtype: { ...m.dtype }, local: false, localPath: '/depth-models/', webgpu: true, output: m.output, preprocess: m.preprocess, subfolder: m.subfolder, externalData: !!m.data, modelClass: m.modelClass }; };

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

  it('turns depth (big is far) over before stretching, and a metric model answers its range in metres', async () => {
    // A fake metric model: depth in metres = 1 + red / 100 (red 0 → 1 m, red 200 → 3 m)
    const metres: Estimator = async (rgb, w, h) => ({ data: Float32Array.from({ length: w * h }, (_, i) => 1 + rgb[i * 3] / 100), w, h });
    const loader: DepthLoader = { hasWebGpuF16: async () => true, load: async () => metres };
    const out: Array<Record<string, unknown>> = [];
    const on = createDepthWorker(loader, m => out.push(m as Record<string, unknown>));
    await on({ type: 'load', id: 1, cfg: cfgOf('zoedepth-nyu-kitti') });
    await on({ type: 'depth', id: 2, model: 'zoedepth-nyu-kitti', rgba: new Uint8Array([0, 0, 0, 255, 200, 0, 0, 255]), w: 2, h: 1, flipY: false, side: 384 });
    const d = out.at(-1)!;
    expect([...(d.depth as Float32Array)]).toEqual([1, 0]); // the 1 m pixel is the nearest
    expect(d.range).toEqual([1, 3]);
    // Each pixel's distance comes back exactly
    const [near, far] = d.range as [number, number];
    expect(metricDistance(1, near, far)).toBeCloseTo(1, 6);
    expect(metricDistance(0, near, far)).toBeCloseTo(3, 6);
    // Relative depth (DA3): turned over the same way, no range
    await on({ type: 'load', id: 3, cfg: cfgOf('depth-anything-v3-small') });
    await on({ type: 'depth', id: 4, model: 'depth-anything-v3-small', rgba: new Uint8Array([0, 0, 0, 255, 200, 0, 0, 255]), w: 2, h: 1, flipY: false, side: 504 });
    expect([...(out.at(-1)!.depth as Float32Array)]).toEqual([1, 0]);
    expect(out.at(-1)!.range).toBeUndefined();
    expect(invertDepth([2, 4]).inv[0]).toBe(0.5);
  });

  it('passes each new model\'s loading options to the loader (folder, external data, class, preparation)', async () => {
    const seen: DepthWorkerConfig[] = [];
    const loader: DepthLoader = { hasWebGpuF16: async () => true, load: async cfg => { seen.push(cfg); return redModel; } };
    const on = createDepthWorker(loader, () => {});
    for (const id of ['depth-anything-v3-small', 'depth-pro', 'zoedepth-nyu-kitti']) await on({ type: 'load', id: 1, cfg: cfgOf(id) });
    expect(seen.map(c => [c.repo, c.output, c.preprocess, c.subfolder, c.externalData, c.modelClass])).toEqual([
      ['onnx-community/depth-anything-v3-small', 'depth', 'imagenet14', undefined, true, undefined],
      ['onnx-community/DepthPro-ONNX', 'metric', undefined, undefined, false, undefined],
      ['Heliosoph/zoedepth-nyu-kitti-onnx', 'metric', 'half32', '', false, 'DPTForDepthEstimation'],
    ]);
  });

  it('prepares frames itself for repos without a processor: size, normalisation, layout', () => {
    expect(inputSize(640, 480, 504, 14)).toEqual({ w: 504, h: 378 });
    expect(inputSize(480, 640, 384, 32)).toEqual({ w: 288, h: 384 });
    // A flat mid-grey 4 × 2 frame
    const rgb = new Uint8ClampedArray(4 * 2 * 3).fill(128);
    const a = preprocessFrame(rgb, 4, 2, 28, 'imagenet14');
    expect(a.dims).toEqual([1, 1, 3, 14, 28]);
    expect(a.data[0]).toBeCloseTo((128 / 255 - 0.485) / 0.229, 4);
    expect(a.data[a.data.length - 1]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 4);
    const b = preprocessFrame(rgb, 4, 2, 64, 'half32');
    expect(b.dims).toEqual([1, 3, 32, 64]);
    expect(b.data[5]).toBeCloseTo((128 / 255 - 0.5) / 0.5, 4);
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
