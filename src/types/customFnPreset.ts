import type { DataType } from './nodeGraph';

/** A saved custom-function preset that can be reused across graphs. */
export interface CustomFnPreset {
  /** Unique identifier — format: "cfp_<timestamp>" */
  id: string;
  /** Display name in the palette */
  label: string;
  /** Input definitions (same shape as customFn node params.inputs) */
  inputs: Array<{
    name: string;
    type: DataType;
    slider?: { min: number; max: number } | null;
  }>;
  /** Return type */
  outputType: DataType;
  /** GLSL body expression / block */
  body: string;
  /** Optional helper GLSL functions injected before main() */
  glslFunctions: string;
  /** Unix timestamp (ms) when saved */
  savedAt: number;
}

/** Shape of the JSON export file for custom-fn presets */
export interface CustomFnPresetExport {
  version: 1;
  presets: CustomFnPreset[];
}
