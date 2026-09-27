/**
 * nowValue — currentValue.ts wired to the app: the preview clock, the graph's
 * Play setup and the Play engine's last writes.
 */
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { playEngine } from './playEngine';
import { clockNow } from './timeTick';
import { currentParamValue, currentVectorValue, type CurrentValueSources } from './currentValue';

export function nowSources(): CurrentValueSources {
  const s = useNodeGraphStore.getState();
  return { time: clockNow() ?? s.currentTime ?? 0, play: s.play, liveValue: id => playEngine.liveValue(id) };
}

/** A float param's value right now (Play mapping, keyframes, or the slider). */
export function nowParamValue(node: GraphNode, key: string, fallback = 0): number {
  return currentParamValue(node, key, nowSources(), fallback);
}

/** A vec3 / colour param's value right now. */
export function nowVectorValue(node: GraphNode, key: string, fallback: number[]): number[] {
  return currentVectorValue(node, key, nowSources(), fallback);
}
