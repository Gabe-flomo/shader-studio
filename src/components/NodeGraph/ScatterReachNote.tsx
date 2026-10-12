/**
 * ScatterReachNote — the Pieces and Balls cards' warning when the pieces can reach further than the
 * search each pixel (or ray step) makes (nodes/definitions/pieces.ts scatterReach, docs/pieces.md),
 * as the Grid builder warns. From the node's own numbers: a wired Scatter can't be known here.
 */
import { useTokens } from '../../theme/themeStore';
import { scatterReach } from '../../nodes/definitions/pieces';
import type { GraphNode } from '../../types/nodeGraph';

export function ScatterReachNote({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const r = scatterReach(node);
  if (!r || r.reach <= r.cap) return null;
  const balls = node.type === 'pieceBalls';
  return (
    <div data-scatter-capped style={{ padding: '4px 12px 6px', fontSize: 11.5, lineHeight: 1.4, color: tk.status.warningText }}>
      {balls
        ? `Scatter reaches about ${Math.ceil(r.reach)} balls sideways, past the ${r.cap} each side a point looks through: some balls may be cut. Lower Scatter (or Instability), or use fewer balls across.`
        : `The pieces reach about ${Math.ceil(r.reach)} cells, past the ${r.cap} each side a pixel looks through: some pieces may be cut. Lower Scatter, use fewer pieces across${node.params.searchMode === 'near' ? ', or Find pieces: Every piece' : ''}.`}
    </div>
  );
}
