/** A saved Transform Vec preset that can be reused across graphs. */
export interface TransformPreset {
  /** Unique identifier — format: "tp_<timestamp>" */
  id: string;
  /** Display name in the palette */
  label: string;
  /** Output / input vector type */
  outputType: 'vec2' | 'vec3' | 'vec4';
  /** Per-component GLSL expressions */
  exprX: string;
  exprY: string;
  exprZ: string;
  exprW: string;
  /** Unix timestamp (ms) when saved */
  savedAt: number;
}
