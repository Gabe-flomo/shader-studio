/**
 * config.ts — which small language model explains code on this device (docs/explain-model.md).
 *
 * Qwen2.5-Coder-1.5B-Instruct (Apache-2.0) in the ONNX export Transformers.js reads
 * (onnx-community/Qwen2.5-Coder-1.5B-Instruct, pinned to a revision), 4-bit weights with fp16 maths
 * (q4f16) on WebGPU, plain 4-bit (q4) on WebAssembly. Optional: nothing downloads until the user asks,
 * and it never ships inside the app. The 3B model is not used: its licence is research-only.
 */
export interface ModelFile { path: string; bytes: number }

export interface ExplainModelSpec {
  id: string;
  name: string;
  repo: string;
  revision: string;
  licence: string;
  /** Per backend: the weights file's dtype. */
  dtype: { webgpu: 'q4f16'; wasm: 'q4' };
  /** The small files every backend fetches. */
  files: ModelFile[];
  /** The weights, per backend. */
  weights: { webgpu: ModelFile; wasm: ModelFile };
}

export const EXPLAIN_MODEL: ExplainModelSpec = {
  id: 'qwen2.5-coder-1.5b-instruct',
  name: 'Qwen2.5-Coder 1.5B Instruct',
  repo: 'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
  revision: '774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf',
  licence: 'Apache-2.0',
  dtype: { webgpu: 'q4f16', wasm: 'q4' },
  files: [
    { path: 'config.json', bytes: 948 },
    { path: 'generation_config.json', bytes: 242 },
    { path: 'tokenizer.json', bytes: 11421896 },
    { path: 'tokenizer_config.json', bytes: 7849 },
  ],
  weights: {
    webgpu: { path: 'onnx/model_q4f16.onnx', bytes: 1344237070 },
    wasm: { path: 'onnx/model_q4.onnx', bytes: 1915754790 },
  },
};

export type Backend = 'webgpu' | 'wasm';

/** The download for a backend, in bytes. */
export const downloadBytes = (backend: Backend = 'webgpu'): number =>
  EXPLAIN_MODEL.files.reduce((s, f) => s + f.bytes, 0) + EXPLAIN_MODEL.weights[backend].bytes;

/** "1.3 GB", "640 MB". */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Answers stay short: a few sentences. A whole block gets a paragraph and a list. */
export const MAX_TOKENS = { line: 90, block: 480 } as const;
/** A block's list stops at this many lines (the rest are left to the rule-based explainer). */
export const MAX_BLOCK_LINES = 12;
/** A block's answer: a summary and a sentence a line, capped. */
export const blockTokens = (lines: number): number => Math.min(MAX_TOKENS.block, 70 + 40 * Math.min(lines, MAX_BLOCK_LINES));
