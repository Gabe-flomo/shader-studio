import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';

/** Roughly how tall a card renders (header, socket rows, param rows, footer), for layouts done before it's measured. */
export function estimateNodeHeight(node: GraphNode): number {
  const def = getNodeDefinitionFor(node);
  const inputCount  = Object.keys(node.inputs).length;
  const outputCount = Object.keys(node.outputs).length;
  // Count only visible param defs (float or select — things that render sliders/dropdowns)
  const paramCount = def ? Object.values(def.paramDefs ?? {}).filter(
    pd => pd.type === 'float' || pd.type === 'select' || pd.type === 'vec3'
  ).length : 0;
  // Header 43px, socket rows 26px, param rows 36px, body padding 12px, footer 37px
  return 43 + (inputCount + outputCount) * 26 + paramCount * 36 + 12 + 37 + codeCardExtra(node, inputCount);
}

/**
 * What an Expression Block or Custom Function card shows beyond its sockets
 * (measured on the real cards): the block's line editor (label, the return
 * row, a 23px row per line) and a 36px row per slider input; the function's
 * code strip. Without it a converted graph's code cards overlapped the card
 * below them.
 */
function codeCardExtra(node: GraphNode, inputCount: number): number {
  if (node.type === 'exprNode') {
    const lines = Array.isArray(node.params.lines) ? node.params.lines.length : 0;
    const inputs = Array.isArray(node.params.inputs) ? (node.params.inputs as Array<{ type?: string; slider?: unknown }>) : [];
    const sliders = inputs.filter(i => i.type === 'float' && i.slider != null).length;
    return (inputCount ? 80 : 67) + lines * 23 + sliders * 36;
  }
  if (node.type === 'customFn') {
    const inputs = Array.isArray(node.params.inputs) ? (node.params.inputs as Array<{ type?: string; slider?: unknown }>) : [];
    return 13 + inputs.filter(i => i.type === 'float' && i.slider != null).length * 36;
  }
  return 0;
}

/**
 * Columns by data-flow rank (the Studio's auto layout and the converter's),
 * each column stacked top to bottom with `gap` between cards. `heightOf`
 * gives a card's height (measured when it has rendered, estimated before);
 * `order` sorts a column (by id when omitted).
 */
export function layoutByRank(
  nodes: GraphNode[],
  opts: { heightOf?: (n: GraphNode) => number; order?: (a: GraphNode, b: GraphNode) => number; startX?: number; startY?: number; colW?: number; gap?: number } = {},
): Map<string, { x: number; y: number }> {
  const { heightOf = estimateNodeHeight, order, startX = 40, startY = 60, colW = 440, gap = 32 } = opts;
  const out = new Map<string, { x: number; y: number }>();
  for (const { rank, nodes: column } of groupNodesByRank(nodes)) {
    let y = startY;
    for (const n of order ? [...column].sort(order) : column) {
      out.set(n.id, { x: startX + rank * colW, y });
      y += heightOf(n) + gap;
    }
  }
  return out;
}

/**
 * BFS rank assignment: rank(node) = max(rank(upstream nodes feeding it)) + 1,
 * with source nodes (no connected inputs) at rank 0. This is the same
 * left-to-right "column" a node would land in under the desktop auto-layout
 * — pulled out here as a pure, reusable function so the desktop auto-layout
 * (spatial x position) and the mobile drill-down browser's home grid (row
 * index) always agree on "what depth is this node at" instead of each
 * computing their own notion of it.
 */
export function computeNodeRanks(nodes: GraphNode[]): Map<string, number> {
  const ids = new Set(nodes.map(n => n.id));
  const upstreamOf: Map<string, Set<string>> = new Map();
  for (const node of nodes) {
    if (!upstreamOf.has(node.id)) upstreamOf.set(node.id, new Set());
    for (const [key, input] of Object.entries(node.inputs)) {
      // A Loop Carry's `next` is the feedback edge of an iterated group: it points back
      // upstream, and following it would make the ranks below climb forever.
      if (node.type === 'loopCarry' && key === 'next') continue;
      // Only wires from nodes in this list count: a group's port sentinel (or a node
      // outside the scope) isn't upstream here, and a node fed by one is a source.
      if (input.connection && ids.has(input.connection.nodeId)) upstreamOf.get(node.id)!.add(input.connection.nodeId);
    }
  }

  const rank: Map<string, number> = new Map();
  const queue: string[] = [];

  for (const node of nodes) {
    if (upstreamOf.get(node.id)!.size === 0) {
      rank.set(node.id, 0);
      queue.push(node.id);
    }
  }

  // No rank can exceed the node count in a graph without cycles; any other cycle
  // (a malformed graph) stops there instead of spinning.
  const maxRank = nodes.length;
  while (queue.length > 0) {
    const id = queue.shift()!;
    const r = rank.get(id)!;
    if (r >= maxRank) continue;
    for (const node of nodes) {
      if (upstreamOf.get(node.id)?.has(id)) {
        const prev = rank.get(node.id) ?? -1;
        if (r + 1 > prev) {
          rank.set(node.id, r + 1);
          queue.push(node.id);
        }
      }
    }
  }

  // Any node the BFS above never touched (shouldn't happen outside of a
  // malformed graph) still needs a rank.
  for (const node of nodes) {
    if (!rank.has(node.id)) rank.set(node.id, 0);
  }

  return rank;
}

/** Group nodes by rank (ascending), each group sorted by id for stable ordering. */
export function groupNodesByRank(nodes: GraphNode[]): Array<{ rank: number; nodes: GraphNode[] }> {
  const rank = computeNodeRanks(nodes);
  const byRank = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const r = rank.get(node.id)!;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(node);
  }
  for (const arr of byRank.values()) arr.sort((a, b) => a.id.localeCompare(b.id));
  return [...byRank.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, rankNodes]) => ({ rank, nodes: rankNodes }));
}
