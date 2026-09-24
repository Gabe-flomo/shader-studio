import type { GraphNode, SubgraphData } from '../types/nodeGraph';

/**
 * Graph files record `layout: LAYOUT_VERSION`. Version 2 is the redesign's 360px node cards with
 * taller rows; graphs without it (older saves, imports and the built-in examples) were laid out
 * for ~260px cards, so their nodes would overlap. `spreadLegacyLayout` stretches those positions
 * about the top-left node, which keeps the arrangement and opens up the gaps.
 */
export const LAYOUT_VERSION = 2;

const SCALE_Y = 1.3;
/** Spacing wanted between side-by-side columns: a 360px card plus room for the wires. */
const COLUMN_PITCH = 420;

/**
 * Horizontal stretch: enough that the tightest pair of side-by-side nodes (vertically
 * overlapping, horizontally apart) ends up COLUMN_PITCH apart, between 1.4× and 2.2×.
 */
function scaleXFor(nodes: GraphNode[]): number {
  let tightest = Infinity;
  for (const a of nodes) {
    for (const b of nodes) {
      const dx = b.position.x - a.position.x;
      if (dx > 40 && Math.abs(b.position.y - a.position.y) < 160) tightest = Math.min(tightest, dx);
    }
  }
  if (!Number.isFinite(tightest)) return 1.4;
  return Math.min(2.2, Math.max(1.4, COLUMN_PITCH / tightest));
}

export function needsLayoutSpread(parsed: { layout?: unknown } | null | undefined): boolean {
  return !(typeof parsed?.layout === 'number' && parsed.layout >= LAYOUT_VERSION);
}

export function spreadLegacyLayout(nodes: GraphNode[]): GraphNode[] {
  if (nodes.length === 0) return nodes;
  const minX = Math.min(...nodes.map(n => n.position.x));
  const minY = Math.min(...nodes.map(n => n.position.y));
  const scaleX = scaleXFor(nodes);
  return nodes.map(n => {
    const subgraph = n.params?.subgraph as SubgraphData | undefined;
    const spread: GraphNode = {
      ...n,
      position: {
        x: Math.round(minX + (n.position.x - minX) * scaleX),
        y: Math.round(minY + (n.position.y - minY) * SCALE_Y),
      },
    };
    if (subgraph && Array.isArray(subgraph.nodes)) {
      spread.params = { ...n.params, subgraph: { ...subgraph, nodes: spreadLegacyLayout(subgraph.nodes) } };
    }
    return spread;
  });
}
