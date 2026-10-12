import type { DataType } from './nodeGraph';
import type { ExprLoop } from '../nodes/exprLoop';

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
  /** Loop mode: its Before / After lines, Break when and Max iterations (nodes/exprLoop.ts) */
  loop?: ExprLoop;
  /** Loop mode: Iterations */
  loopN?: number;
  /** The node's comment when it was saved; restored on the node when placed */
  comment?: string;
  /** Slider inputs' starting values, by input name (presets made with "Make a node from this") */
  values?: Record<string, number>;
  /** The shape it was made from, with its inputs as `$holes`: "Where else is this used?" looks for it */
  pattern?: string;
  /** Unix timestamp (ms) when saved */
  savedAt: number;
}
