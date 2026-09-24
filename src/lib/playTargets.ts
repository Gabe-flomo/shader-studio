/**
 * playTargets.ts — which params of the current graph the Play page can drive.
 * A param is a target exactly when the compiler gave it a uniform (it's in
 * paramBindings); everything else is baked into the shader and would need a
 * recompile. Top-level nodes only for now (group overrides come later).
 */

import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { paramBindingKey } from '../compiler/uniformPatcher';

export interface PlayTargetInfo {
  nodeId: string;
  paramKey: string;
  /** "Node · Param" for pickers. */
  label: string;
  nodeLabel: string;
  paramLabel: string;
  min: number;
  max: number;
  step?: number;
  value: number;
}

const SKIP_TYPES = new Set(['output', 'vec4Output', 'midiInput', 'audioInput', 'videoInput']);

export function nodeDisplayLabel(node: GraphNode): string {
  const def = getNodeDefinition(node.type);
  const custom = typeof node.params.label === 'string' ? node.params.label.trim() : '';
  return custom || def?.label || node.type;
}

export function collectPlayTargets(nodes: GraphNode[], paramBindings: Record<string, string>): PlayTargetInfo[] {
  const out: PlayTargetInfo[] = [];
  for (const node of nodes) {
    if (SKIP_TYPES.has(node.type)) continue;
    const def = getNodeDefinition(node.type);
    if (!def?.paramDefs) continue;
    const nodeLabel = nodeDisplayLabel(node);
    for (const [key, pd] of Object.entries(def.paramDefs)) {
      if (pd.type !== 'float') continue;
      if (!paramBindings[paramBindingKey(node.id, key)]) continue;
      const raw = node.params[key];
      const value = typeof raw === 'number' ? raw : typeof def.defaultParams?.[key] === 'number' ? (def.defaultParams[key] as number) : 0;
      out.push({
        nodeId: node.id, paramKey: key,
        label: `${nodeLabel} · ${pd.label}`, nodeLabel, paramLabel: pd.label,
        min: pd.min ?? 0, max: pd.max ?? 1, ...(pd.step ? { step: pd.step } : {}),
        value,
      });
    }
  }
  return out;
}
