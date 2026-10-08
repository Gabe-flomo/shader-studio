/**
 * config.ts — which small language models can explain code on this device (docs/explain-model.md).
 *
 * Several, each downloaded on demand and optional: nothing downloads until the user asks, and none ships inside
 * the app. All are Apache-2.0 ONNX exports that Transformers.js reads (pinned to a revision), 4-bit weights with
 * fp16 maths (q4f16) on WebGPU, plain 4-bit (q4) on WebAssembly where the repo has one.
 *
 *   qwen2.5-coder-1.5b  the default: fast, no reasoning pass
 *   qwen3-4b            thinks first (a <think> pass); better at maths; 2.8 GB, WebGPU only
 *
 * Considered and dropped, each tried in the browser (docs/reports/explain-model-trial.md):
 *   - Qwen3-1.7B: its ONNX q4f16 is one 1.43 GB file; ONNX Runtime's WebAssembly heap runs out creating the session
 *     (std::bad_alloc) and the WebAssembly fallback (a single 2.1 GB file) exceeds the browser's array-buffer limit.
 *     (The 1.34 GB coder just fits. The 4B loads because its weights are split into external-data files.)
 *   - Phi-4-mini-reasoning (3.8B, MIT): there is no ONNX build of it for the web (only Phi-4-mini-instruct has one).
 * The 3B Qwen2.5-Coder is not used: its licence is research-only.
 */
export interface ModelFile { path: string; bytes: number }

export interface ExplainModelSpec {
  id: string;
  name: string;
  repo: string;
  revision: string;
  licence: string;
  /** Reasons in a <think>…</think> pass before answering. */
  thinks: boolean;
  /** One line for the picker. */
  note: string;
  /** Per backend: the weights file's dtype. `wasm` is absent when the repo has no plain-q4 build. */
  dtype: { webgpu: 'q4f16'; wasm?: 'q4' };
  /** The small files every backend fetches. */
  files: ModelFile[];
  /** The weights, per backend (a model can be several files). */
  weights: { webgpu: ModelFile[]; wasm?: ModelFile[] };
  /** Larger than most browsers like: warn before downloading or loading. */
  large?: boolean;
}

const QWEN3_FILES: ModelFile[] = [
  { path: 'config.json', bytes: 943 }, { path: 'generation_config.json', bytes: 219 },
  { path: 'tokenizer.json', bytes: 9117040 }, { path: 'tokenizer_config.json', bytes: 10360 },
  { path: 'vocab.json', bytes: 2776833 }, { path: 'merges.txt', bytes: 1671853 },
];

export const EXPLAIN_MODELS: readonly ExplainModelSpec[] = [
  {
    id: 'qwen2.5-coder-1.5b-instruct',
    name: 'Qwen2.5-Coder 1.5B',
    repo: 'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
    revision: '774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf',
    licence: 'Apache-2.0',
    thinks: false,
    note: 'Fast. Answers straight away. The default.',
    dtype: { webgpu: 'q4f16', wasm: 'q4' },
    files: [
      { path: 'config.json', bytes: 948 },
      { path: 'generation_config.json', bytes: 242 },
      { path: 'tokenizer.json', bytes: 11421896 },
      { path: 'tokenizer_config.json', bytes: 7849 },
    ],
    weights: {
      webgpu: [{ path: 'onnx/model_q4f16.onnx', bytes: 1344237070 }],
      wasm: [{ path: 'onnx/model_q4.onnx', bytes: 1915754790 }],
    },
  },
  {
    id: 'qwen3-4b',
    name: 'Qwen3 4B',
    repo: 'onnx-community/Qwen3-4B-ONNX',
    revision: '5cbfbcacd84ed9e54cea017a4cbddb67cc45337f',
    licence: 'Apache-2.0',
    thinks: true,
    note: 'Thinks first. The strongest at maths here, and the heaviest: needs WebGPU and plenty of memory.',
    dtype: { webgpu: 'q4f16' },
    files: QWEN3_FILES,
    weights: {
      webgpu: [
        { path: 'onnx/model_q4f16.onnx', bytes: 59762833 },
        { path: 'onnx/model_q4f16.onnx_data', bytes: 2096005120 },
        { path: 'onnx/model_q4f16.onnx_data_1', bytes: 677150720 },
      ],
    },
    large: true,
  },
];

/** The default model (and what the older single-model settings meant). */
export const EXPLAIN_MODEL: ExplainModelSpec = EXPLAIN_MODELS[0];
export const DEFAULT_MODEL_ID = EXPLAIN_MODEL.id;

export const modelById = (id: string | null | undefined): ExplainModelSpec => EXPLAIN_MODELS.find(m => m.id === id) ?? EXPLAIN_MODEL;

export type Backend = 'webgpu' | 'wasm';

/** A model can run on this backend. */
export const supportsBackend = (m: ExplainModelSpec, b: Backend): boolean => b === 'webgpu' || !!m.weights.wasm;

/** The download for a backend, in bytes (WebAssembly falls back to the WebGPU files for a model with no plain-q4 build). */
export const downloadBytes = (backend: Backend = 'webgpu', m: ExplainModelSpec = EXPLAIN_MODEL): number =>
  m.files.reduce((s, f) => s + f.bytes, 0) + (m.weights[backend] ?? m.weights.webgpu).reduce((s, f) => s + f.bytes, 0);

/** Every file a model may fetch (for matching progress events). */
export const allFiles = (m: ExplainModelSpec): ModelFile[] => [...m.files, ...m.weights.webgpu, ...(m.weights.wasm ?? [])];

/** "1.3 GB", "640 MB". */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Answers stay short: a few sentences as JSON. A whole block gets a summary and a small object per line. */
export const MAX_TOKENS = { line: 130, block: 1000 } as const;
/** A block's list stops at this many lines (the rest are left to the rule-based explainer). */
export const MAX_BLOCK_LINES = 12;
/** A block's answer: a summary and a small JSON object a line, capped. */
export const blockTokens = (lines: number): number => Math.min(MAX_TOKENS.block, 90 + 80 * Math.min(lines, MAX_BLOCK_LINES));
/** A thinking model reasons first: its budget includes the <think> pass. */
export const THINK_BUDGET = 1024;
export const maxTokensFor = (m: ExplainModelSpec, base: number): number => (m.thinks ? base + THINK_BUDGET : base);

/** The memory a model needs on the GPU is about its WebGPU download plus working space; above this, warn. */
export const LARGE_MODEL_BYTES = 2.0e9;
