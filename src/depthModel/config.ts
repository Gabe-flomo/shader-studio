/**
 * config.ts — the depth models the Depth node can run on this device (docs/depth-node.md).
 *
 * Three, side by side for testing (docs/depth-and-splats-plan.md section 1): once one proves best the others go.
 * Each is an opt-in download, offered the first time a Depth node needs it, kept by the browser after that, and
 * nothing is sent anywhere. All are the ONNX exports Transformers.js reads, pinned to a revision. Sizes and
 * licences were checked through the Hugging Face API on 2026-10-09 (`/api/models/<repo>` and `/tree/main/onnx`).
 *
 *   depth-anything-v2-small  Apache-2.0. Fast, sharp edges. The default.
 *   depth-anything-v2-base   CC-BY-NC-4.0: testing only, never in a paid release (the node says so).
 *   dpt-hybrid-midas         Apache-2.0 on the Hugging Face card (Intel/dpt-hybrid-midas); the MiDaS code is MIT.
 *
 * Per backend one weights file: WebGPU runs fp16 maths (fp16, or q4f16: 4-bit weights with fp16 maths),
 * WebAssembly 8-bit (q8 / uint8). tools/fetch-depth-models.mjs reads this file to fetch the same files.
 */
export interface ModelFile { path: string; bytes: number }

export type DepthBackend = 'webgpu' | 'wasm';
export type DepthDtype = 'fp16' | 'q4f16' | 'q8' | 'uint8';

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
];

export const DEFAULT_DEPTH_MODEL_ID = DEPTH_MODELS[0].id;

export const depthModelById = (id: unknown): DepthModelSpec =>
  DEPTH_MODELS.find(m => m.id === id) ?? DEPTH_MODELS[0];

/** The download for a backend, in bytes. */
export const depthDownloadBytes = (m: DepthModelSpec, backend: DepthBackend): number =>
  m.files.reduce((s, f) => s + f.bytes, 0) + m.weights[backend].bytes;

/** Every file a model may fetch (for matching progress events). */
export const depthModelFiles = (m: DepthModelSpec): ModelFile[] => [...m.files, m.weights.webgpu, m.weights.wasm];

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
