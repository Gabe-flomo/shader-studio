/**
 * socketsOnDemand.ts — inputs a node keeps hidden until they're wanted
 * (NodeDefinition.socketsOnDemand). A setting with many sliders (the Particles
 * node) would otherwise list a socket for each one: instead the socket shows
 * once its slider is right-clicked → "Control from outside" (the key goes in
 * `params.__sockets`), or while something is wired into it (so saved graphs
 * keep theirs). "Back to slider" takes the wire out and hides it again.
 * Display only: the compiler sees the same inputs either way.
 */
import type { GraphNode, NodeDefinition } from '../types/nodeGraph';

/** The node's own list of sockets asked for. */
export function shownSockets(node: GraphNode): string[] {
  const v = node.params.__sockets;
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
}

/** Does the card show input `key`? (Always, unless the definition keeps it on demand.) */
export function socketVisible(node: GraphNode, def: NodeDefinition | null | undefined, key: string): boolean {
  if (!def?.socketsOnDemand || !(key in def.socketsOnDemand)) return true;
  return !!node.inputs[key]?.connection || shownSockets(node).includes(key);
}

/** The on-demand sockets a slider (param `paramKey`) can bring out: its own first, then any others it owns. */
export function socketsForParam(def: NodeDefinition | null | undefined, paramKey: string): string[] {
  const map = def?.socketsOnDemand;
  if (!map) return [];
  const keys = Object.keys(map).filter(k => map[k].includes(paramKey));
  return keys.sort((a, b) => (a === paramKey ? -1 : b === paramKey ? 1 : 0));
}

/** The params patch that shows (or hides) socket `key`. */
export function showSocketPatch(node: GraphNode, key: string, on: boolean): Record<string, unknown> {
  const now = shownSockets(node).filter(k => k !== key);
  return { __sockets: on ? [...now, key] : now };
}
