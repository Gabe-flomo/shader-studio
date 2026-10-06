/**
 * arrange.ts — Auto layout's "by stage" option (docs/structure-hints.md): nodes in left-to-right
 * columns by their stage in the graph's flow (Space, Bend space, Shape, Shape it, Colour, Post…),
 * then the Output. Nodes that go anywhere (maths, time, constants) sit in the column of the stage
 * they feed; a loose group's members stay together in one column. Columns with nothing in them
 * are left out, and each column is stacked top to bottom, so cards never overlap.
 *
 * Pure: positions out; the store applies them as one undo step.
 */
import type { GraphNode, LooseGroup } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { computeNodeRanks, estimateNodeHeight } from '../store/graphLayout';
import { detectFlow, stageOfNode } from './flow';
import { FLOWS, inFlow, type FlowId } from './stages';

const OUTPUTS = new Set(['output', 'vec4Output']);

export interface ArrangeOptions {
  flow?: FlowId;
  /** The scope's loose groups: each one's members are kept together. */
  looseGroups?: readonly LooseGroup[];
  heightOf?: (n: GraphNode) => number;
  startX?: number;
  startY?: number;
  colW?: number;
  gap?: number;
}

/** Each node's column: 0 for inputs that feed nothing staged, 1… the flow's stages, last the Output. */
export function stageColumns(nodes: readonly GraphNode[], flow: FlowId): Map<string, number> {
  const stages = FLOWS[flow].stages;
  const outCol = stages.length + 1;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const consumers = new Map<string, GraphNode[]>();
  for (const n of nodes) for (const inp of Object.values(n.inputs ?? {})) {
    const c = inp?.connection;
    if (!c || c.nodeId === GROUP_PORT_SENTINEL || !byId.has(c.nodeId)) continue;
    consumers.set(c.nodeId, [...(consumers.get(c.nodeId) ?? []), n]);
  }
  const own = (n: GraphNode): number | null => {
    if (OUTPUTS.has(n.type)) return outCol;
    const s = inFlow(stageOfNode(n, flow), flow);
    return s ? s.index + 1 : null;
  };
  const col = new Map<string, number>();
  for (const n of nodes) { const c = own(n); if (c !== null) col.set(n.id, c); }

  // Unstaged nodes: the column of the nearest staged node they feed (the earliest when several).
  const feedsInto = (n: GraphNode): number | null => {
    let best: number | null = null;
    const seen = new Set<string>([n.id]);
    const stack = [...(consumers.get(n.id) ?? [])];
    while (stack.length) {
      const m = stack.pop()!;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const c = own(m);
      if (c !== null) { if (best === null || c < best) best = c; continue; }
      stack.push(...(consumers.get(m.id) ?? []));
    }
    return best;
  };
  // …else the column of what feeds them (the latest), else the inputs column.
  const fedBy = (n: GraphNode): number | null => {
    let best: number | null = null;
    const seen = new Set<string>([n.id]);
    const stack = Object.values(n.inputs ?? {}).map(i => i?.connection?.nodeId).filter((id): id is string => !!id && byId.has(id)).map(id => byId.get(id)!);
    while (stack.length) {
      const m = stack.pop()!;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const c = own(m);
      if (c !== null) { if (best === null || c > best) best = c; continue; }
      stack.push(...Object.values(m.inputs ?? {}).map(i => i?.connection?.nodeId).filter((id): id is string => !!id && byId.has(id)).map(id => byId.get(id)!));
    }
    return best;
  };
  for (const n of nodes) {
    if (col.has(n.id)) continue;
    col.set(n.id, feedsInto(n) ?? fedBy(n) ?? 0);
  }
  return col;
}

/** New positions for every node of one level, in stage columns. */
export function arrangeByStage(nodes: readonly GraphNode[], opts: ArrangeOptions = {}): Map<string, { x: number; y: number }> {
  const { heightOf = estimateNodeHeight, startX = 40, startY = 60, colW = 440, gap = 32 } = opts;
  const flow = opts.flow ?? detectFlow(nodes);
  const col = stageColumns(nodes, flow);
  const rank = computeNodeRanks([...nodes]);

  // Loose groups: one unit each, in the column most of its members are in (the earliest on a tie).
  const unitOf = new Map<string, string>();
  for (const g of opts.looseGroups ?? []) {
    const members = g.memberIds.filter(id => col.has(id) && !unitOf.has(id));
    if (!members.length) continue;
    const votes = new Map<number, number>();
    for (const id of members) votes.set(col.get(id)!, (votes.get(col.get(id)!) ?? 0) + 1);
    const c = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    for (const id of members) { unitOf.set(id, g.id); col.set(id, c); }
  }

  // Columns, left to right, empty ones dropped.
  const used = [...new Set(col.values())].sort((a, b) => a - b);
  const x = new Map(used.map((c, i) => [c, startX + i * colW]));
  const byCol = new Map<number, GraphNode[]>();
  for (const n of nodes) { const c = col.get(n.id)!; byCol.set(c, [...(byCol.get(c) ?? []), n]); }

  const out = new Map<string, { x: number; y: number }>();
  for (const c of used) {
    const list = byCol.get(c)!;
    const sortKey = (n: GraphNode) => (rank.get(n.id) ?? 0) * 1e6 + n.position.y;
    // A unit sorts by its first member; members stay next to each other.
    const key = (n: GraphNode) => {
      const u = unitOf.get(n.id);
      const lead = u ? list.filter(m => unitOf.get(m.id) === u).reduce((a, b) => (sortKey(a) <= sortKey(b) ? a : b)) : n;
      return [sortKey(lead), u ?? '', sortKey(n)] as const;
    };
    list.sort((a, b) => {
      const ka = key(a), kb = key(b);
      return ka[0] - kb[0] || ka[1].localeCompare(kb[1]) || ka[2] - kb[2] || a.id.localeCompare(b.id);
    });
    let y = startY;
    for (const n of list) {
      out.set(n.id, { x: x.get(c)!, y });
      y += heightOf(n) + gap;
    }
  }
  return out;
}
