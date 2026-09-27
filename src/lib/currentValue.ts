/**
 * currentValue — what a slider's value is right now, whatever is moving it.
 *
 * A float param can be moved by three things besides the slider itself:
 * keyframes (evaluated on the preview clock), a Play mapping (MIDI, an LFO,
 * audio… writing the uniform every frame) and the Play control's own value.
 * Turning a slider off freezes it at this value, so the picture doesn't jump.
 *
 * Pure: the clock and the Play lookups are passed in (see nowValue.ts for the
 * app's wiring), so tests can drive it directly.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';
import { evaluateKeyframes, getKeyframeConfig, isKeyframeBypassed } from '../compiler/keyframes';
import { driveKey } from '../play/playDriven';

export interface CurrentValueSources {
  /** The preview clock (s), for keyframes. */
  time: number;
  /** The Play setup, to find a control on this param. */
  play?: Pick<PlayRecord, 'controls'> | null;
  /** The value a Play mapping wrote last frame for a control (undefined when nothing drives it). */
  liveValue?: (controlId: string) => number | number[] | undefined;
}

/**
 * The value a float param shows right now: a Play mapping's last write if one
 * drives it, else its keyframe curve at `time`, else the stored value.
 * `fallback` answers for a param that has none of these.
 */
export function currentParamValue(node: GraphNode, key: string, src: CurrentValueSources, fallback = 0): number {
  const k = `${node.id}::${key}`;
  if (src.play && src.liveValue) {
    for (const c of src.play.controls) {
      if (driveKey(c.target) !== k) continue;
      const v = src.liveValue(c.id);
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  if (!isKeyframeBypassed(node, key)) {
    const cfg = getKeyframeConfig(node, key);
    if (cfg) return evaluateKeyframes(cfg, src.time);
  }
  const v = node.params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Colour / vec3 params: a Play control's last write, else the stored value. */
export function currentVectorValue(node: GraphNode, key: string, src: CurrentValueSources, fallback: number[]): number[] {
  const k = `${node.id}::${key}`;
  if (src.play && src.liveValue) {
    for (const c of src.play.controls) {
      if (driveKey(c.target) !== k) continue;
      const v = src.liveValue(c.id);
      if (Array.isArray(v) && v.length >= fallback.length) return v.slice(0, fallback.length);
    }
  }
  const v = node.params[key];
  return Array.isArray(v) && v.length >= fallback.length && v.every(n => typeof n === 'number') ? (v as number[]).slice(0, fallback.length) : fallback;
}
