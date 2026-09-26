/** How the outline (and the detail panel) reads a converted node: its kind and the words on its box. */
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';

const SOURCES = new Set(['fragCoord', 'resolution', 'time', 'mouse', 'pixelUV', 'uv', 'constant']);

export type OutlineKind = 'source' | 'node' | 'block' | 'region' | 'output' | 'warned' | 'loop';

export function kindOf(n: GraphNode): OutlineKind {
  if (n.params.__importWarning) return 'warned';
  if (n.type === 'group' && (n.params.iterations as number) > 1) return 'loop';
  if (n.type === 'exprNode') return 'block';
  if (n.type === 'customFn') return 'region';
  if (n.type === 'output' || n.type === 'vec4Output') return 'output';
  if (SOURCES.has(n.type)) return 'source';
  return 'node';
}

/** What the box says: the node's name, or the code it holds. */
export function labelOf(n: GraphNode): string {
  if (n.type === 'exprNode') return String(n.params.expr ?? n.params.result ?? 'expression');
  if (n.type === 'customFn') return String(n.params.label ?? 'function');
  if (n.type === 'constant') return `${n.params.value}`;
  if (n.type === 'group') return String(n.params.label ?? 'Group');
  const def = getNodeDefinition(n.type);
  const base = def?.label ?? n.type;
  // Sliders the converter set: show the number, the way the card will.
  const b = n.params.b, e0 = n.params.edge0, e1 = n.params.edge1;
  if (['add', 'subtract', 'multiply', 'divide'].includes(n.type) && !n.inputs.b?.connection && typeof b === 'number') return `${base} ${fmt(b)}`;
  if (n.type === 'smoothstep' && typeof e0 === 'number' && typeof e1 === 'number') return `${base} ${fmt(e0)} → ${fmt(e1)}`;
  return base;
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(3) + '');
