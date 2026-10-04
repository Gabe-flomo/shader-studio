/**
 * motionLayers.ts — record edits and choices for Motion layers (the kit
 * measures and draws them: play/kit/motion.js). Pure, so tests cover them.
 *
 *   motionSourceStart     what a new Motion layer watches: the camera when the
 *                         setup has one, else its first Video layer, else the camera
 *   newMotionLayer        a Motion layer set up that way
 *   motionSourceChoices   the layers one can watch (not nulls, not other Motion layers…)
 *   motionLayers          the Motion layers particles can be born in
 *   dropMotionRefs        a removed layer: Motion layers watching it and particles born in it let go
 */
import { defaultLayer, type MotionLayer, type PlayLayer } from '../types/play';

/** Kinds a Motion layer can't watch: they draw nothing (nulls, drum pads, relationships), or are Motion layers themselves. */
const UNWATCHABLE = new Set(['null', 'drumpad', 'relationship', 'motion']);

export function motionSourceStart(layers: readonly PlayLayer[]): Pick<MotionLayer, 'readFrom' | 'sourceId'> {
  if (layers.some(l => l.kind === 'camera')) return { readFrom: 'camera', sourceId: '' };
  const video = layers.find(l => l.kind === 'video');
  if (video) return { readFrom: 'layer', sourceId: video.id };
  return { readFrom: 'camera', sourceId: '' };
}

export function newMotionLayer(layers: readonly PlayLayer[], id: string, label: string, over: Partial<MotionLayer> = {}): MotionLayer {
  return { ...(defaultLayer('motion', id, label) as MotionLayer), ...motionSourceStart(layers), ...over };
}

export function motionSourceChoices(layers: readonly PlayLayer[], selfId: string): PlayLayer[] {
  return layers.filter(l => l.id !== selfId && !UNWATCHABLE.has(l.kind));
}

export function motionLayers(layers: readonly PlayLayer[]): MotionLayer[] {
  return layers.filter((l): l is MotionLayer => l.kind === 'motion');
}

/** After removing layer `id`: Motion layers watching it watch nothing, particles born in it go back to the camera's motion. */
export function dropMotionRefs(layers: PlayLayer[], id: string): PlayLayer[] {
  return layers.map(l => (l.kind === 'motion' && l.sourceId === id ? { ...l, sourceId: '' }
    : l.kind === 'particles' && l.motionId === id ? { ...l, motionId: '' } : l));
}
