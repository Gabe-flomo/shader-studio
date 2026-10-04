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
  return groups.map((g, i) => ({
    heading: g.family.label,
    items: [
      ...(i === 0 && own ? [{ value: where.node.type, label: own.label, description: THIS_NODE }] : []),
      ...g.options.map(o => ({ value: o.type, label: o.label, description: describe(o), disabled: !o.ok, keywords: o.type })),
    ],
  }));
}

/** Whether a card shows the pill (cached per type: the families are static). */
const pillCache = new Map<string, boolean>();
export function showsSwitchPill(node: GraphNode): boolean {
  if (node.params?.subgraph) return false;
  let v = pillCache.get(node.type);
  if (v === undefined) { v = hasSwitchOptions(node); pillCache.set(node.type, v); }
  return v;
}
