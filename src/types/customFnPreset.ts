import type { DataType } from './nodeGraph';
import type { Binding } from '../glsl/previewShader';
import type { ValueRole } from '../glsl/roles';

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
  /** The node's comment when it was saved; restored on the node when placed */
  comment?: string;
  /** Unix timestamp (ms) when saved */
  savedAt: number;
  /**
   * How to draw its thumbnail: what feeds each input and how the result is
   * painted. Saved by function discovery (the bindings its preview used);
   * absent on presets saved from a node, whose thumbnails guess from names.
   */
  preview?: CustomFnPreview;
}

/** The discovery preview's choices, kept with a saved function for its thumbnail. */
export interface CustomFnPreview {
  /** One per input, in order. */
  bindings: Binding[];
  /** The role each input played (for the thumbnail to re-derive a binding if an input changes). */
  roles?: ValueRole[];
  /** How the result is painted: a distance as a signed field, a colour as itself… */
  returnRole: ValueRole;
}

/** Shape of the JSON export file for custom-fn presets */
export interface CustomFnPresetExport {
  version: 1;
  presets: CustomFnPreset[];
}
