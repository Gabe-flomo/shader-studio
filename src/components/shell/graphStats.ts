// Numbers behind the canvas toolbar's node count and its stats panel. Pure functions over a list
// of nodes (the current context: the whole graph at the top level, a group's subgraph inside one).
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';

const OUTPUT_TYPES = new Set(['output', 'vec4Output']);

function subgraphOf(n: GraphNode): SubgraphData | undefined {
  return n.params?.subgraph as SubgraphData | undefined;
}

/** Real nodes in `nodes`, counting what's inside groups (at any depth) instead of the group boxes. */
export function countNodes(nodes: readonly GraphNode[]): { total: number; insideGroups: number } {
  let total = 0;
  let insideGroups = 0;
  for (const n of nodes) {
    const sg = subgraphOf(n);
    if (sg) {
      const inner = countNodes(sg.nodes).total;
      total += inner;
      insideGroups += inner;
    } else {
      total += 1;
    }
  }
  return { total, insideGroups };
}

function walk(nodes: readonly GraphNode[], visit: (n: GraphNode) => void) {
  for (const n of nodes) {
    visit(n);
    const sg = subgraphOf(n);
    if (sg) walk(sg.nodes, visit);
  }
}

export interface GraphStats {
  nodes: number;
  insideGroups: number;
  wires: number;
  groups: number;
  keyframed: number;
  byCategory: { category: string; count: number }[];
  mostUsed: { type: string; label: string; category: string; count: number; ids: string[] }[];
  mostConnected: { id: string; label: string; wires: number }[];
  /** Nodes in this scope whose output never reaches an Output node. Only computed at the top level. */
  deadEnds: string[];
  bypassed: string[];
}

export function computeGraphStats(nodes: readonly GraphNode[], topLevel: boolean): GraphStats {
  const { total, insideGroups } = countNodes(nodes);
  let wires = 0;
  let groups = 0;
  let keyframed = 0;
  const bypassed: string[] = [];
  const byCat = new Map<string, number>();
  const byType = new Map<string, { label: string; category: string; ids: string[] }>();

  walk(nodes, n => {
    for (const input of Object.values(n.inputs ?? {})) if (input?.connection) wires++;
    for (const [k, v] of Object.entries(n.params ?? {})) if (k.startsWith('__keyframes_') && Array.isArray(v) && v.length > 0) keyframed++;
    if (subgraphOf(n)) { groups++; return; }
    if (n.bypassed) bypassed.push(n.id);
    const def = getNodeDefinition(n.type);
    const category = def?.category ?? 'Other';
    byCat.set(category, (byCat.get(category) ?? 0) + 1);
    const entry = byType.get(n.type) ?? { label: def?.label ?? n.type, category, ids: [] };
    entry.ids.push(n.id);
    byType.set(n.type, entry);
  });

  // Degree within this scope: wires into a node plus wires out of it.
  const degree = new Map<string, number>();
  for (const n of nodes) {
    for (const input of Object.values(n.inputs ?? {})) {
      const from = input?.connection?.nodeId;
      if (!from) continue;
      degree.set(n.id, (degree.get(n.id) ?? 0) + 1);
      degree.set(from, (degree.get(from) ?? 0) + 1);
    }
  }
  const labelOf = (id: string) => {
    const n = nodes.find(x => x.id === id);
    return n ? (getNodeDefinition(n.type)?.label ?? n.type) : id;
  };

  let deadEnds: string[] = [];
  if (topLevel) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const reaches = new Set<string>();
    const stack = nodes.filter(n => OUTPUT_TYPES.has(n.type)).map(n => n.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (reaches.has(id)) continue;
      reaches.add(id);
      for (const input of Object.values(byId.get(id)?.inputs ?? {})) {
        const from = input?.connection?.nodeId;
        if (from && !reaches.has(from)) stack.push(from);
      }
    }
    // Without an Output node everything would count as a dead end, which isn't useful.
    if (reaches.size > 0) deadEnds = nodes.filter(n => !reaches.has(n.id)).map(n => n.id);
  }

  return {
    nodes: total,
    insideGroups,
    wires,
    groups,
    keyframed,
    byCategory: [...byCat].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    mostUsed: [...byType].map(([type, e]) => ({ type, ...e, count: e.ids.length }))
      .filter(e => e.count > 1).sort((a, b) => b.count - a.count).slice(0, 5),
    mostConnected: [...degree].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, w]) => ({ id, label: labelOf(id), wires: w })),
    deadEnds,
    bypassed,
  };
}
