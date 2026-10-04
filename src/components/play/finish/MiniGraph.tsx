/**
 * MiniGraph — a Look effect's node graph drawn small and read-only on its
 * stack card: one box per node with its name, and the wires between them.
 * Clicking it opens the editor (the card passes onOpen).
 */
import { useMemo } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { TYPE_COLORS } from '../../NodeGraph/typeColors';
import { FX_IN_TYPE, FX_OUT_TYPE, FX_PICTURE_AT_TYPE, type EffectGraph } from '../../../play/lookGraph';
import { graphWires, HEAD_H, layoutNodes, NODE_W, nodeBox } from './effectGraphLayout';

export function MiniGraph({ graph, height = 64, onOpen }: { graph: EffectGraph; height?: number; onOpen?: () => void }) {
  const tk = useTokens();
  const { boxes, wires, view } = useMemo(() => {
    const boxes = layoutNodes(graph).map(nodeBox);
    const wires = graphWires(graph);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) {
      x0 = Math.min(x0, b.node.x); y0 = Math.min(y0, b.node.y);
      x1 = Math.max(x1, b.node.x + NODE_W); y1 = Math.max(y1, b.node.y + HEAD_H + b.rowsH);
    }
    const pad = 24;
    return { boxes, wires, view: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}` };
  }, [graph]);
  const svg = (
    <svg viewBox={view} preserveAspectRatio="xMidYMid meet" width="100%" height={height} role="img" aria-label={`Node graph: ${boxes.slice(1).map(b => b.label).join(', ')}`} style={{ display: 'block' }}>
      {wires.map(w => {
        const dx = Math.max(40, Math.abs(w.b.x - w.a.x) * 0.5);
        return <path key={`${w.to}:${w.key}`} d={`M ${w.a.x} ${w.a.y} C ${w.a.x + dx} ${w.a.y}, ${w.b.x - dx} ${w.b.y}, ${w.b.x} ${w.b.y}`} fill="none" stroke={TYPE_COLORS[w.type] ?? tk.text.faint} strokeWidth={5} strokeOpacity={0.85} />;
      })}
      {boxes.map(b => {
        const io = b.node.type === FX_IN_TYPE || b.node.type === FX_OUT_TYPE || b.node.type === FX_PICTURE_AT_TYPE;
        const h = HEAD_H + b.rowsH;
        return (
          <g key={b.node.id}>
            <rect x={b.node.x} y={b.node.y} width={NODE_W} height={h} rx={14} fill={io ? alpha(tk.accent.base, 0.18) : tk.bg.head} stroke={io ? alpha(tk.accent.base, 0.7) : tk.border.strong} strokeWidth={3} />
            <text x={b.node.x + NODE_W / 2} y={b.node.y + h / 2} dominantBaseline="central" textAnchor="middle" fill={tk.text.primary} style={{ font: `600 30px ${fontFamily.ui}` }}>
              {b.label.length > 13 ? b.label.slice(0, 12) + '…' : b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
  if (!onOpen) return svg;
  return (
    <button type="button" onClick={onOpen} title="Edit the nodes" style={{ display: 'block', width: '100%', padding: 4, border: `1px solid ${tk.border.subtle}`, borderRadius: radius.sm, background: tk.bg.app, cursor: 'pointer' }}>
      {svg}
    </button>
  );
}
