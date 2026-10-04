/**
 * agentPins.ts — an Agents group card's pinned sliders (docs/agents-plan.md §6, P4).
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from './definitions';
import { paramSliderRange } from './sliderRange';

/**
 * The Agents group card's pinned sliders (P4, docs/agents-plan.md §6): `params.pinned` lists
 * `innerId::paramKey` paths of float sliders inside the group. Rows for those that still exist
 * with the inner node's value and range.
 */
export interface AgentPinnedRow {
  path: string; innerId: string; key: string; label: string; nodeLabel: string;
  value: number; min: number; max: number; step: number; defaultValue?: number;
}
export function agentPinnedRows(group: GraphNode): AgentPinnedRow[] {
  const list = Array.isArray(group.params.pinned) ? (group.params.pinned as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  const inside = (group.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes ?? [];
  const out: AgentPinnedRow[] = [];
  for (const path of list) {
    const [innerId, key] = path.split('::');
    const n = inside.find(x => x.id === innerId);
    const def = n ? getNodeDefinition(n.type) : undefined;
    const pd = def?.paramDefs?.[key];
    if (!n || !def || !pd || pd.type !== 'float') continue;
    const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
    const value = num(n.params[key], num(def.defaultParams?.[key], 0));
    const { min, max } = paramSliderRange(n.params, key, pd);
    const nodeLabel = (typeof n.params.label === 'string' && n.params.label.trim()) || def.label;
    out.push({
      path, innerId, key, label: pd.label, nodeLabel, value, min: Math.min(min, value), max: Math.max(max, value), step: pd.step ?? 0.01,
      ...(typeof def.defaultParams?.[key] === 'number' ? { defaultValue: def.defaultParams[key] as number } : {}),
    });
  }
  return out;
}
/** Can this inner slider be pinned to its Agents group's card (a float slider of a node inside)? */
export function canPinAgentParam(n: GraphNode | undefined, key: string): boolean {
  const pd = n ? getNodeDefinition(n.type)?.paramDefs?.[key] : undefined;
  return !!pd && pd.type === 'float' && !pd.compileTime;
}
