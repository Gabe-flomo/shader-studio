import type { DataType } from './nodeGraph';

/** A saved ExprBlock preset that can be reused across graphs. */
export interface ExprPreset {
  /** Unique identifier — format: "ep_<timestamp>" */
  id: string;
  /** Display name in the palette */
  label: string;
  /** Input definitions (same shape as exprNode params.inputs) */
  inputs: Array<{
    name: string;
    type: DataType;
    slider: { min: number; max: number } | null;
  }>;
  /** Return type */
  outputType: DataType;
  /** Warp lines */
  lines: Array<{ lhs: string; op: string; rhs: string }>;
  /** Return expression */
  result: string;
  /** Unix timestamp (ms) when saved */
  savedAt: number;
}
