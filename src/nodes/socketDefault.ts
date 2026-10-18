/**
 * socketDefault.ts — a socket's fallback value from its node's default param of the same key, when the
 * socket has no slider of its own. Only a number or a list of numbers is a value a socket can fall
 * back to: a same-named param that is something else (the Shuffle's `a` / `b` are its alpha and blue
 * slots, 'a4' and 'a3', beside its A and B sockets) is not, and became a literal that broke the compile.
 */
import type { NodeDefinition } from '../types/nodeGraph';

export const isSocketValue = (v: unknown): v is number | number[] =>
  (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'number'));

export function socketDefault(def: NodeDefinition, key: string): number | number[] | undefined {
  if (def.paramDefs?.[key]) return undefined;
  const v = def.defaultParams?.[key];
  return isSocketValue(v) ? v : undefined;
}
