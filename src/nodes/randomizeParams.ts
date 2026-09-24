import type { GraphNode, NodeDefinition, ParamDef, SubgraphData, SurfacedParam } from '../types/nodeGraph';
import { getNodeDefinition } from './definitions';
import { isParamVisible } from '../compiler/uniformPatcher';
import { isKeyframeBypassed, socketHasKeyframes } from '../compiler/keyframes';

/**
 * New random values for a node's sliders (the node card's 🎲 Randomize).
 *
 * - Every visible float/int slider not driven by a wire or by keyframes gets a value in the
 *   range the card shows: min → max, the typed max if there is one, and −max → max when the
 *   slider runs both ways. A slider with no declared range (Constant, matrix cells, …) uses −1 → 1.
 * - vec3 params: each unwired component in the param's range, or −1 → 1; colours 0 → 1.
 * - Values snap to the slider's step (whole numbers stay whole).
 * - Keys listed in `node.params.__randExclude` (unticked in the die's right-click list) are left alone.
 */
export function randomizedParams(node: GraphNode, def: NodeDefinition, rand: () => number = Math.random): Record<string, unknown> {
  if (node.type === 'group') return randomizedGroupOverrides(node, rand);
  const out: Record<string, unknown> = {};
  const wired = (key: string) => !!node.inputs[key]?.connection || !!node.inputs[`__param_${key}`]?.connection;
  const keyframed = (key: string) => socketHasKeyframes(node, key) && !isKeyframeBypassed(node, key);
  const between = (lo: number, hi: number, pd: ParamDef) => snap(lo + rand() * (hi - lo), pd);

  const excluded = new Set(randomizeExcluded(node));
  for (const [key, pd] of Object.entries(def.paramDefs ?? {})) {
    if (!isParamVisible(pd, node.params) || wired(key) || keyframed(key) || excluded.has(key)) continue;
    if (pd.type === 'float' || pd.type === 'int') {
      const [lo, hi] = floatRange(node, key, pd);
      out[key] = between(lo, hi, pd);
    } else if (pd.type === 'vec3' || pd.type === 'vec3color') {
      const cur = Array.isArray(node.params[key]) ? node.params[key] as number[] : [0, 0, 0];
      const [lo, hi] = pd.type === 'vec3color' ? [0, 1] : pd.min !== undefined || pd.max !== undefined ? [pd.min ?? -1, pd.max ?? 1] : [-1, 1];
      out[key] = ['r', 'g', 'b'].map((c, i) => (wired(`${key}_${c}`) ? cur[i] ?? 0 : between(lo, hi, pd)));
    }
  }
  return out;
}

/** Same effective range as the card's ruler (NodeComponent's float row) */
function floatRange(node: GraphNode, key: string, pd: ParamDef): [number, number] {
  const customMax = typeof node.params[`__scMax_${key}`] === 'number' ? node.params[`__scMax_${key}`] as number : null;
  const bidir = node.params[`__scBidir_${key}`] === true;
  if (customMax === null && pd.min === undefined && pd.max === undefined) return [-1, 1];
  const max = customMax ?? pd.max ?? 1;
  const min = bidir ? -max : customMax !== null ? 0 : pd.min ?? 0;
  return [min, max];
}

function snap(v: number, pd: ParamDef): number {
  const step = pd.type === 'int' ? Math.max(1, pd.step ?? 1) : pd.step ?? 0.01;
  const snapped = Math.round(v / step) * step;
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
  return Number(snapped.toFixed(decimals));
}

/** Whether the node has anything Randomize would change (to show the button) */
export function canRandomize(node: GraphNode, def: NodeDefinition): boolean {
  return randomizableParams(node, def).length > 0;
}

/** Keys the user unticked in the die's right-click list */
export function randomizeExcluded(node: GraphNode): string[] {
  return Array.isArray(node.params.__randExclude) ? (node.params.__randExclude as unknown[]).filter((k): k is string => typeof k === 'string') : [];
}

/** Every slider Randomize could change, excluded or not, for the right-click list */
export function randomizableParams(node: GraphNode, def: NodeDefinition): Array<{ key: string; label: string }> {
  if (node.type === 'group') return groupRandomRows(node).map(r => ({ key: r.key, label: r.label }));
  const all = randomizedParams({ ...node, params: { ...node.params, __randExclude: [] } }, def, () => 0.5);
  return Object.keys(all).map(key => ({ key, label: def.paramDefs?.[key]?.label ?? key }));
}

// ── Groups ──────────────────────────────────────────────────────────────────
// A group randomizes the values shown on its card (the group's override keys), never the
// nodes inside it. The rows mirror NodeComponent's group card: inner nodes' float sliders that
// aren't hidden or wired, plus params surfaced from nested groups.

interface GroupRow { key: string; label: string; lo: number; hi: number; pd: ParamDef }

function groupRandomRows(group: GraphNode): GroupRow[] {
  const sg = group.params.subgraph as SubgraphData | undefined;
  if (!sg || !Array.isArray(sg.nodes)) return [];
  const hidden = Array.isArray(group.params.hiddenParams) ? group.params.hiddenParams as string[] : [];
  const surfaced = Array.isArray(group.params.surfacedParams) ? group.params.surfacedParams as SurfacedParam[] : [];
  const sectionLabel = (inner: GraphNode) => {
    const custom = group.params[`__sectionLabel_${inner.id}`];
    if (typeof custom === 'string') return custom;
    return typeof inner.params.label === 'string' ? inner.params.label : getNodeDefinition(inner.type)?.label ?? inner.type;
  };
  const rows: GroupRow[] = [];
  for (const inner of sg.nodes) {
    if (inner.type === 'group') {
      const innerSub = inner.params.subgraph as SubgraphData | undefined;
      for (const sp of surfaced.filter(x => x.innerGroupId === inner.id)) {
        const innNode = innerSub?.nodes.find(n => n.id === sp.nodeId);
        const pd = innNode ? getNodeDefinition(innNode.type)?.paramDefs?.[sp.paramKey] : undefined;
        if (!innNode || !pd || group.inputs[`ps_${inner.id}_${sp.nodeId}_${sp.paramKey}`]?.connection) continue;
        rows.push({ key: `${inner.id}::${sp.nodeId}::${sp.paramKey}`, label: `${sectionLabel(inner)} · ${sp.label ?? pd.label}`, lo: pd.min ?? 0, hi: pd.max ?? 1, pd });
      }
      continue;
    }
    const def = getNodeDefinition(inner.type);
    for (const [key, pd] of Object.entries(def?.paramDefs ?? {})) {
      if (pd.type !== 'float' || pd.step === 1 || !isParamVisible(pd, inner.params)) continue;
      if (inner.inputs[`__param_${key}`]?.connection) continue;
      if (Object.entries(inner.inputs).some(([k, inp]) => k.toLowerCase() === key.toLowerCase() && inp.connection)) continue;
      if (hidden.includes(`${inner.id}::${key}`) || group.inputs[`ps_${inner.id}_${key}`]?.connection) continue;
      const [lo, hi] = floatRange(inner, key, pd);
      rows.push({ key: `${inner.id}::${key}`, label: `${sectionLabel(inner)} · ${pd.label}`, lo, hi, pd });
    }
  }
  return rows;
}

function randomizedGroupOverrides(group: GraphNode, rand: () => number): Record<string, unknown> {
  const excluded = new Set(randomizeExcluded(group));
  const out: Record<string, unknown> = {};
  for (const r of groupRandomRows(group)) {
    if (!excluded.has(r.key)) out[r.key] = snap(r.lo + rand() * (r.hi - r.lo), r.pd);
  }
  return out;
}
