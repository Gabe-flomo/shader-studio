import type { Keyframe } from '../compiler/keyframes';

/** A saved keyframe curve that can be reused across sockets/axes. */
export interface KeyframePreset {
  /** Unique identifier — format: "kfp_<timestamp>" */
  id: string;
  /** Display name in the palette */
  label: string;
  /** The saved curve — one socket/axis's worth of keyframes */
  keyframes: Keyframe[];
  /** Unix timestamp (ms) when saved */
  savedAt: number;
}
