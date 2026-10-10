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

/** A card's width on the canvas. */
const CARD_W = 360;

/**
 * Columns by data-flow rank (the Studio's auto layout and the converter's),
 * each column stacked top to bottom with `gap` between cards. `heightOf`
 * gives a card's height (measured when it has rendered, estimated before);
 * `order` sorts a column (by id when omitted).
 *
 * Kept compact (docs/structure-hints.md "Auto layout"):
 * - ranks are pulled toward what a node feeds (`compactRanks`), so a Time or a constant that only
 *   the end of a long chain reads sits one column before it, not alone in the first column;
 * - each connected piece of the graph is laid out on its own and the pieces are packed in rows
 *   (`packPieces`): the piece with the Output first, the rest beside it while they fit within its
 *   width, else on a row below, with the usual gaps between them. Nothing is left stranded.
 */
export function layoutByRank(
  nodes: GraphNode[],
  opts: { heightOf?: (n: GraphNode) => number; order?: (a: GraphNode, b: GraphNode) => number; startX?: number; startY?: number; colW?: number; gap?: number } = {},
): Map<string, { x: number; y: number }> {
  const { heightOf = estimateNodeHeight, order, startX = 40, startY = 60, colW = 440, gap = 32 } = opts;
  const rank = compactRanks(nodes);
  const byId = (a: GraphNode, b: GraphNode) => a.id.localeCompare(b.id);
  const pieces = connectedPieces(nodes).map(list => {
    const min = Math.min(...list.map(n => rank.get(n.id)!));
    const cols = new Map<number, GraphNode[]>();
    for (const n of list) { const c = rank.get(n.id)! - min; cols.set(c, [...(cols.get(c) ?? []), n]); }
    const at = new Map<string, { x: number; y: number }>();
    let w = 0, h = 0;
    for (const [c, column] of cols) {
      let y = 0;
      for (const n of [...column].sort(order ?? byId)) {
        at.set(n.id, { x: c * colW, y });
        y += heightOf(n) + gap;
      }
      w = Math.max(w, c * colW + CARD_W);
      h = Math.max(h, y - gap);
    }
    return { at, w, h };
  });
  const out = new Map<string, { x: number; y: number }>();
  for (const { piece, x, y } of packPieces(pieces, { startX, startY, gapX: colW - CARD_W, gapY: gap * 3 })) {
    for (const [id, p] of piece.at) out.set(id, { x: x + p.x, y: y + p.y });
  }
  return out;
}

/**
 * Pieces (each with its own width and height) placed in rows: the first at the start, each next
 * one right of the one before with `gapX` between them while the row stays within the widest
 * piece's width (at least three columns), else at the start of a new row `gapY` below the tallest
 * piece of the row above. Returns each piece's top-left.
 */
export function packPieces<T extends { w: number; h: number }>(pieces: readonly T[], opts: { startX: number; startY: number; gapX: number; gapY: number }): Array<{ piece: T; x: number; y: number }> {
  const { startX, startY, gapX, gapY } = opts;
  const limit = Math.max(3 * (CARD_W + gapX) - gapX, ...pieces.map(p => p.w));
  const out: Array<{ piece: T; x: number; y: number }> = [];
  let x = startX, rowY = startY, rowH = 0;
  for (const piece of pieces) {
    if (x > startX && x - startX + piece.w > limit) { rowY += rowH + gapY; x = startX; rowH = 0; }
    out.push({ piece, x, y: rowY });
    x += piece.w + gapX;
    rowH = Math.max(rowH, piece.h);
  }
  return out;
}

/** In-scope wires as [from, to], a Loop Carry's feedback `next` left out (it points back upstream). */
function wiresOf(nodes: GraphNode[]): Array<[string, string]> {
  const ids = new Set(nodes.map(n => n.id));
  const out: Array<[string, string]> = [];
  for (const n of nodes) for (const [key, input] of Object.entries(n.inputs)) {
    if (n.type === 'loopCarry' && key === 'next') continue;
    if (input.connection && ids.has(input.connection.nodeId) && input.connection.nodeId !== n.id) out.push([input.connection.nodeId, n.id]);
  }
  return out;
}

/**
 * The graph's connected pieces (nodes joined by wires either way): the piece holding an Output
 * first, then the biggest, ties in the order the nodes come in.
 */
export function connectedPieces(nodes: GraphNode[]): GraphNode[][] {
  const parent = new Map(nodes.map(n => [n.id, n.id]));
  const find = (id: string): string => { let r = id; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(id, r); return r; };
  for (const [a, b] of wiresOf(nodes)) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); }
  const groups = new Map<string, GraphNode[]>();
  for (const n of nodes) { const r = find(n.id); groups.set(r, [...(groups.get(r) ?? []), n]); }
  const first = new Map(nodes.map((n, i) => [n.id, i]));
  const hasOutput = (g: GraphNode[]) => g.some(n => n.type === 'output' || n.type === 'vec4Output');
  return [...groups.values()].sort((a, b) =>
    Number(hasOutput(b)) - Number(hasOutput(a)) || b.length - a.length || first.get(a[0].id)! - first.get(b[0].id)!);
}

/**
 * Ranks for the layout: the data-flow ranks (`computeNodeRanks`), then every node that feeds
 * something moved right to just before the earliest node it feeds. Without it a Time or a
 * constant read only at the end of a long chain stayed in the first column, many columns from
 * what it feeds (Convert's "lone column on the left"). Wires still run left to right.
 */
export function compactRanks(nodes: GraphNode[]): Map<string, number> {
  const rank = computeNodeRanks(nodes);
  const consumers = new Map<string, string[]>();
  for (const [from, to] of wiresOf(nodes)) consumers.set(from, [...(consumers.get(from) ?? []), to]);
  const byRankDown = [...nodes].sort((a, b) => rank.get(b.id)! - rank.get(a.id)!);
  for (const n of byRankDown) {
    const cs = consumers.get(n.id);
    if (!cs?.length) continue;
    const before = Math.min(...cs.map(c => rank.get(c)!)) - 1;
    if (before > rank.get(n.id)!) rank.set(n.id, before);
  }
  return rank;
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
