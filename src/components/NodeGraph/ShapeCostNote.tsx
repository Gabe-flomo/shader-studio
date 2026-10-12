/**
 * The note under Draw agents' Shape (docs/particle-shapes.md "Cost"): roughly how many shapes a frame
 * draws (the wired group's count, after Draw every and Max shapes), what they cost, and the tip; amber
 * when it is a lot (lib/agentShapes.ts shapeCost). Nothing for Dot.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, radius } from '../../theme/tokens';
import { AGENT_TIERS } from '../../nodes/definitions/agents';
import { SHAPE_COST_TIP, shadingOf, shapeCost, shapeOf, sphereDetailOf } from '../../lib/agentShapes';

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

export function ShapeCostNote({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const groupId = node.inputs.agents?.connection?.nodeId;
  // The wired group's count tier only (a string), so the card redraws when that changes and not otherwise.
  const tier = useNodeGraphStore(s => (groupId ? String(s.nodes.find(x => x.id === groupId)?.params.tier ?? '256k') : null));
  const shape = shapeOf(node.params.shape);
  if (shape === 'dot' || node.params.agentSpace !== '3d') return null;
  const side = AGENT_TIERS[tier ?? '256k'] ?? 512;
  const cost = shapeCost({
    count: side * side, shape, shading: shadingOf(node.params.shading), sphereDetail: sphereDetailOf(node.params.sphereDetail),
    every: num(node.params.every, 1), maxShapes: num(node.params.maxShapes, 0), halfRes: node.params.halfRes === 'on',
  });
  if (!cost) return null;
  const high = cost.level === 'high';
  return (
    <div data-shape-cost={cost.level} role="note"
      style={{
        margin: '2px 12px 6px 16px', padding: '6px 9px', borderRadius: radius.md, fontSize: 11.5, lineHeight: 1.45,
        color: high ? tk.status.warningText : tk.text.muted,
        background: high ? alpha(tk.status.warning, 0.14) : tk.bg.field,
        boxShadow: high ? `inset 0 0 0 1px ${alpha(tk.status.warning, 0.5)}` : undefined,
      }}>
      {cost.text} {SHAPE_COST_TIP}
    </div>
  );
}
