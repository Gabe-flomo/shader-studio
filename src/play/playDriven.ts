/**
 * playDriven.ts — which graph sliders the Play page is driving.
 *
 * A slider that is a Play control keeps working in the Studio while nothing
 * drives it: its value is the control's resting value. Once an enabled
 * mapping drives the control (MIDI, an LFO, audio, the mouse…), the mapping
 * writes over that value every frame, so moving the slider in the Studio
 * does nothing you can see. Node cards use this to say so, and to offer the
 * way back: pause those mappings, or take the slider off the Play panel.
 */
import type { PlayRecord } from '../types/play';
import { parseActionTarget, parseLayerTarget } from '../types/play';
import { sourceLabel } from './playSources';

export interface PlayDrive {
  controlId: string;
  controlLabel: string;
  /** "MIDI CC 21", "LFO sine 0.5 Hz"… one per enabled mapping. */
  sources: string[];
}

/** `nodeId::paramKey`, the last two segments of a target: what a node card knows its slider by. */
export const driveKey = (target: string): string => target.split('::').slice(-2).join('::');

const cache = new WeakMap<PlayRecord, Map<string, PlayDrive>>();

/** Driven sliders by `nodeId::paramKey`. Cached per Play record, so cards can ask every render. */
export function playDrivenMap(play: PlayRecord): Map<string, PlayDrive> {
  const hit = cache.get(play);
  if (hit) return hit;
  const out = new Map<string, PlayDrive>();
  for (const c of play.controls) {
    if (c.kind === 'action' || parseLayerTarget(c.target) || parseActionTarget(c.target)) continue;
    const sources = play.mappings.filter(m => m.enabled && m.controlId === c.id).map(m => sourceLabel(m.source, play.controls, play.layers));
    if (sources.length) out.set(driveKey(c.target), { controlId: c.id, controlLabel: c.label, sources });
  }
  cache.set(play, out);
  return out;
}

/** Pause every mapping that drives a control: the Studio slider takes over again. */
export function pauseDrive(play: PlayRecord, controlId: string): PlayRecord {
  return { ...play, mappings: play.mappings.map(m => (m.controlId === controlId && m.enabled ? { ...m, enabled: false } : m)) };
}

/** Take a control off the Play panel, with the mappings that drive it. */
export function removeFromPlay(play: PlayRecord, controlId: string): PlayRecord {
  return { ...play, controls: play.controls.filter(c => c.id !== controlId), mappings: play.mappings.filter(m => m.controlId !== controlId) };
}
