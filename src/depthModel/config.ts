/**
 * config.ts — the depth models the Depth node can run on this device (docs/depth-node.md).
 *
 * Depth Anything V2 Small, the one kept after testing (2026-10-10: Base and MiDaS DPT-Hybrid were dropped; the list
 * stays a list, so another model can be tried the same way later).
 * Each is an opt-in download, offered the first time a Depth node needs it, kept by the browser after that, and
 * nothing is sent anywhere. All are the ONNX exports Transformers.js reads, pinned to a revision. Sizes and
 * licences were checked through the Hugging Face API on 2026-10-09 (`/api/models/<repo>` and `/tree/main/onnx`).
 *
 *   depth-anything-v2-small  Apache-2.0. Fast, sharp edges. The default.
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
