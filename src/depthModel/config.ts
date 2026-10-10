/**
 * config.ts — the depth models the Depth node can run on this device (docs/depth-node.md).
 *
 * Depth Anything V2 Small is the one the node shows (2026-10-10: Base and MiDaS DPT-Hybrid were tried and dropped).
 * The others are **experimental**: hidden unless "Experimental depth models" is on (experimental.ts), then the Depth
 * node gets a model picker and Compare. Sizes, revisions and licences checked 2026-10-10 through the HF API.
 * Each is an opt-in download, offered the first time a Depth node needs it, kept by the browser after that, and
 * nothing is sent anywhere. All are the ONNX exports Transformers.js reads, pinned to a revision. Sizes and
 * licences were checked through the Hugging Face API on 2026-10-09 (`/api/models/<repo>` and `/tree/main/onnx`).
 *
 *   depth-anything-v2-small  Apache-2.0. Fast, sharp edges. The default.
 *   experimental:
 *   depth-anything-v2-base   CC-BY-NC-4.0: testing only, never in a paid release (the node says so).
 *   dpt-hybrid-midas         Apache-2.0 on the Hugging Face card (Intel/dpt-hybrid-midas); the MiDaS code is MIT.
 *   depth-anything-v3-small  Apache-2.0. Gives depth (not inverse depth), relative. One fp32 file with external data,
 *                            no preprocessor config: the worker resizes and normalises itself (ImageNet, multiple of 14).
 *   depth-pro                Apple's Depth Pro: metric (metres). The ONNX repo is tagged apple-ascl; the original
 *                            weights (apple/DepthPro) are under the Apple ML Research licence: research only.
 *   zoedepth-nyu-kitti       MIT. Metric (metres). One self-contained fp16 file at the repo's root (no onnx/
 *                            folder), not a Transformers.js model type: run as a plain DPT-style session.
 *
 * Not here (docs/depth-node.md "Models tried"): YOLO26-depth (AGPL-3.0, no ONNX on Hugging Face) and DepthFM (a
 * flow-matching model: many network passes a frame, too heavy for a browser).
 *
 * Per backend one weights file: WebGPU runs fp16 maths (fp16, or q4f16: 4-bit weights with fp16 maths),
 * WebAssembly 8-bit (q8 / uint8). tools/fetch-depth-models.mjs reads this file to fetch the same files.
 */
export interface ModelFile { path: string; bytes: number }

export type DepthBackend = 'webgpu' | 'wasm';
export type DepthDtype = 'fp32' | 'fp16' | 'q4f16' | 'q4' | 'q8' | 'uint8';

/**
 * What the model's output is: `inverse` relative inverse depth (Depth Anything V2, MiDaS: big is near), `depth` relative
 * depth (big is far: Depth Anything V3), `metric` depth in metres (Depth Pro, ZoeDepth).
 */
export type DepthOutput = 'inverse' | 'depth' | 'metric';

/**
 * How a frame is prepared: the repo's own processor, or the worker's for repos without a usable one
 * (`imagenet14`: ImageNet mean/std, sides a multiple of 14, a 5D [1, 1, 3, h, w] input as Depth Anything V3 takes;
 * `half32`: mean/std 0.5, sides a multiple of 32, as ZoeDepth's processor would).
 */
export type DepthPreprocess = 'processor' | 'imagenet14' | 'half32';

export interface DepthModelSpec {
  id: string;
  name: string;
  /** Short name for tight places (the compare view's headings). */
  short: string;
  repo: string;
  revision: string;
  /** The SPDX id from the model card. */
  licence: string;
  /** May ship in a paid release. False: testing only. */
  commercial: boolean;
  /** One line for the picker. */
  note: string;
  /** The model's own input side (its preprocessor config). */
  nativeSide: number;
  /**
   * The model only runs at its own side (fixed position embeddings: MiDaS DPT-Hybrid's ViT fails at any other size).
   * The node's Resolution then sets only the grab; the model always sees nativeSide.
   */
  fixedSide?: boolean;
  dtype: Record<DepthBackend, DepthDtype>;
  /** The small files every backend fetches. */
  files: ModelFile[];
  /** The weights, per backend. */
  weights: Record<DepthBackend, ModelFile>;
  /** External weights beside the .onnx (`<file>_data`), the same for every backend. */
  data?: ModelFile;
  /** Hidden unless "Experimental depth models" is on. */
  experimental?: boolean;
  /** What the output means (default `inverse`). */
  output?: DepthOutput;
  /** How a frame is prepared (default the repo's processor). */
  preprocess?: DepthPreprocess;
  /** The folder the .onnx files are in (default `onnx`; '' for the repo's root). */
  subfolder?: string;
  /** The Transformers.js class to load it with, when its model_type has none (ZoeDepth: a plain DPT-style session). */
  modelClass?: 'DPTForDepthEstimation';
}

const DA_FILES: ModelFile[] = [
  { path: 'config.json', bytes: 38 },
  { path: 'preprocessor_config.json', bytes: 461 },
];

export const DEPTH_MODELS: readonly DepthModelSpec[] = [
  {
    id: 'depth-anything-v2-small',
    name: 'Depth Anything V2 Small',
    short: 'DA2 Small',
    repo: 'onnx-community/depth-anything-v2-small',
    revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d',
    licence: 'Apache-2.0',
    commercial: true,
    note: 'Fast, sharp edges. The default.',
    nativeSide: 518,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
    files: DA_FILES,
    weights: {
      webgpu: { path: 'onnx/model_fp16.onnx', bytes: 49642442 },
      wasm: { path: 'onnx/model_quantized.onnx', bytes: 27258801 },
    },
  },
  {
    id: 'depth-anything-v2-base',
    name: 'Depth Anything V2 Base',
    short: 'DA2 Base',
    repo: 'onnx-community/depth-anything-v2-base',
    revision: 'dd4557d492cd7b563738ac8d9ccff9094620983c',
    licence: 'CC-BY-NC-4.0',
    commercial: false,
    note: 'Cleaner surfaces and finer detail, slower. Testing only: its licence is non-commercial.',
    nativeSide: 518,
    experimental: true,
    dtype: { webgpu: 'q4f16', wasm: 'q8' },
    files: DA_FILES,
    weights: {
      webgpu: { path: 'onnx/model_q4f16.onnx', bytes: 72484282 },
      wasm: { path: 'onnx/model_quantized.onnx', bytes: 102391398 },
    },
  },
  {
    id: 'dpt-hybrid-midas',
    name: 'MiDaS DPT-Hybrid',
    short: 'MiDaS',
    repo: 'Xenova/dpt-hybrid-midas',
    revision: '8af5a62e326ba3e842759aa27e13008c1c758db5',
    licence: 'Apache-2.0',
    commercial: true,
    note: 'The classic model: smoother, softer edges.',
    nativeSide: 384,
    fixedSide: true,
    experimental: true,
    dtype: { webgpu: 'q4f16', wasm: 'uint8' },
    files: [
      { path: 'config.json', bytes: 9985 },
      { path: 'preprocessor_config.json', bytes: 384 },
    ],
    weights: {
      webgpu: { path: 'onnx/model_q4f16.onnx', bytes: 118219625 },
      wasm: { path: 'onnx/model_uint8.onnx', bytes: 123702011 },
    },
  },
  {
    id: 'depth-anything-v3-small',
    name: 'Depth Anything V3 Small',
    short: 'DA3 Small',
    repo: 'onnx-community/depth-anything-v3-small',
    revision: '0b6a7f3bf5595f9950b91389e0da3a0de130324c',
    licence: 'Apache-2.0',
    commercial: true,
    note: 'The newer Depth Anything: relative depth, full precision (105 MB).',
    nativeSide: 504,
    experimental: true,
    output: 'depth',
    preprocess: 'imagenet14',
    dtype: { webgpu: 'fp32', wasm: 'fp32' },
    files: [
      { path: 'config.json', bytes: 129 },
    ],
    weights: {
      webgpu: { path: 'onnx/model.onnx', bytes: 640691 },
      wasm: { path: 'onnx/model.onnx', bytes: 640691 },
    },
    data: { path: 'onnx/model.onnx_data', bytes: 104702464 },
  },
  {
    id: 'depth-pro',
    name: 'Depth Pro (Apple)',
    short: 'Depth Pro',
    repo: 'onnx-community/DepthPro-ONNX',
    revision: 'feefb662b967b477367485dc4f133aeecd638ba4',
    licence: 'apple-ascl',
    commercial: false,
    note: 'Metric: real distances in metres, sharp. Big (600 MB) and slow. Research licence: testing only.',
    nativeSide: 1536,
    fixedSide: true,
    experimental: true,
    output: 'metric',
    dtype: { webgpu: 'q4f16', wasm: 'q4' },
    files: [
      { path: 'config.json', bytes: 131 },
      { path: 'preprocessor_config.json', bytes: 274 },
    ],
    weights: {
      webgpu: { path: 'onnx/model_q4f16.onnx', bytes: 600274893 },
      wasm: { path: 'onnx/model_q4.onnx', bytes: 746124207 },
    },
  },
  {
    id: 'zoedepth-nyu-kitti',
    name: 'ZoeDepth (NYU + KITTI)',
    short: 'ZoeDepth',
    repo: 'Heliosoph/zoedepth-nyu-kitti-onnx',
    revision: '181dcea7dfa1bc7ca7daaec094e0562446ca11fb',
    licence: 'MIT',
    commercial: true,
    note: 'Metric: real distances in metres, indoors and out. Big (693 MB) and slow.',
    nativeSide: 384,
    fixedSide: true,
    experimental: true,
    output: 'metric',
    preprocess: 'half32',
    subfolder: '',
    modelClass: 'DPTForDepthEstimation',
    dtype: { webgpu: 'fp16', wasm: 'fp16' },
    files: [
      { path: 'config.json', bytes: 2382 },
      { path: 'preprocessor_config.json', bytes: 430 },
    ],
    weights: {
      webgpu: { path: 'model_fp16.onnx', bytes: 693145502 },
      wasm: { path: 'model_fp16.onnx', bytes: 693145502 },
    },
  },
];

export const DEFAULT_DEPTH_MODEL_ID = DEPTH_MODELS[0].id;

/**
 * The model a node's `params.model` names. With `experimental` false, an experimental id gives the default: a saved
 * graph that picked one plays with Small while the setting is off.
 */
export const depthModelById = (id: unknown, experimental = true): DepthModelSpec =>
  DEPTH_MODELS.find(m => m.id === id && (experimental || !m.experimental)) ?? DEPTH_MODELS[0];

/** The models a picker lists: the default only, or every model with experimental models on. */
export const visibleDepthModels = (experimental: boolean): DepthModelSpec[] => DEPTH_MODELS.filter(m => experimental || !m.experimental);

/** Gives distances in metres (Depth Pro, ZoeDepth): the Depth node's Distance output, no calibration needed. */
export const isMetricModel = (m: DepthModelSpec): boolean => m.output === 'metric';

/** The download for a backend, in bytes. */
export const depthDownloadBytes = (m: DepthModelSpec, backend: DepthBackend): number =>
  m.files.reduce((s, f) => s + f.bytes, 0) + m.weights[backend].bytes + (m.data?.bytes ?? 0);

/** Every file a model may fetch (for matching progress events), each once. */
export const depthModelFiles = (m: DepthModelSpec): ModelFile[] => {
  const all = [...m.files, m.weights.webgpu, m.weights.wasm, ...(m.data ? [m.data] : [])];
  return all.filter((f, i) => all.findIndex(g => g.path === f.path) === i);
};

/** "50 MB", "640 KB". */
export function formatDepthBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** What the node and docs say about a model's licence. */
export const licenceLine = (m: DepthModelSpec): string =>
  m.commercial ? `Licence: ${m.licence}.` : `Licence: ${m.licence}. Testing only, not for paid releases.`;

/** The side a model actually runs at for the node's Resolution. */
export const modelSide = (m: DepthModelSpec, side: number): number => (m.fixedSide ? m.nativeSide : side);

/** Where a local check (`?depthModel=local`) serves the files: `<base>depth-models/<repo>/…`. */
export const LOCAL_DEPTH_DIR = 'depth-models/';

/** The input sides the node offers (the long side of the frame the model sees). */
export const DEPTH_SIDES = [256, 384, 518, 768] as const;
