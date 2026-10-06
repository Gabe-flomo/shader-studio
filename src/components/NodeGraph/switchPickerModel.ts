/**
 * The non-React half of the card's Switch picker (SwitchNodePicker.tsx): its
 * sections, whether a card shows the pill, and opening a card's picker from
 * its right-click menu.
 */
import { useNodeGraphStore, switchScopeFor } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import type { PickerSection } from '../ui/GroupedPicker';
import { getNodeDefinition } from '../../nodes/definitions';
import { hasSwitchOptions, switchOptions, type SwitchOption } from '../../nodes/switchNode';
import { rankTables } from '../../suggestions';
import { strength } from '../../suggestions/usage';

/** Open pickers by node id, so the context menu can open the card's own. */
export const switchOpeners = new Map<string, () => void>();

/** Open the Switch list on a node's card (from its right-click menu). False when it has none. */
export function openSwitchPicker(nodeId: string): boolean {
  const open = switchOpeners.get(nodeId);
  if (!open) return false;
  open();
  return true;
}

export const THIS_NODE = 'This node';

const describe = (o: SwitchOption): string => {
  if (!o.ok) return o.reason ?? 'Its sockets don’t fit these wires';
  const w = `${o.keptWires} wire${o.keptWires === 1 ? '' : 's'} kept`;
  return o.lostLabels.length ? `${w} · drops ${o.lostLabels.slice(0, 3).join(', ')}` : w;
};

/** The picker's sections for a node in the scope being edited, the node itself listed first. */
export function switchSections(nodeId: string): PickerSection[] {
  const where = switchScopeFor(useNodeGraphStore.getState(), nodeId);
  if (!where) return [];
  const groups = switchOptions(where.scope, where.node, where.ctx);
  const own = getNodeDefinition(where.node.type);
  // Within a family, what you use in this spot (between these neighbours) comes first (suggestions).
  const fit = spotScorer(where.scope, where.node);
  return groups.map((g, i) => ({
    heading: g.family.label,
    items: [
      ...(i === 0 && own ? [{ value: where.node.type, label: own.label, description: THIS_NODE }] : []),
      ...byFit(g.options, fit).map(o => ({ value: o.type, label: o.label, description: describe(o), disabled: !o.ok, keywords: o.type })),
    ],
  }));
}

/** The compatible options reordered by `fit` in the places they had; the others stay put. */
function byFit(options: SwitchOption[], fit: (type: string) => number): SwitchOption[] {
  const ok = options.filter(o => o.ok);
  const sorted = ok.map((o, i) => ({ o, i, f: fit(o.type) })).sort((a, b) => b.f - a.f || a.i - b.i).map(x => x.o);
  let k = 0;
  return options.map(o => (o.ok ? sorted[k++] : o));
}

/** How often a node type sits between this node's neighbours in your graphs (0 when unknown). */
function spotScorer(scope: readonly GraphNode[], node: GraphNode): (type: string) => number {
  const byId = new Map(scope.map(n => [n.id, n]));
  const before = Object.values(node.inputs).flatMap(i => (i.connection ? [byId.get(i.connection.nodeId)?.type] : [])).filter((t): t is string => !!t);
  const after = scope.filter(n => Object.values(n.inputs).some(i => i.connection?.nodeId === node.id)).map(n => n.type);
  if (!before.length && !after.length) return () => 0;
  let tables: ReturnType<typeof rankTables> | null = null;
  try { tables = rankTables(); } catch { return () => 0; }
  const t = tables.table;
  return type => before.reduce((s, b) => s + strength(t.typeStat(b, type)), 0) + after.reduce((s, a) => s + strength(t.typeStat(type, a)), 0);
}

/** Whether a card shows the pill (cached per type: the families are static). */
const pillCache = new Map<string, boolean>();
export function showsSwitchPill(node: GraphNode): boolean {
  if (node.params?.subgraph) return false;
  let v = pillCache.get(node.type);
  if (v === undefined) { v = hasSwitchOptions(node); pillCache.set(node.type, v); }
  return v;
}
