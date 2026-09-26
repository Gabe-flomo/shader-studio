/**
 * OutlineCanvas — the graph a shader would become, before it exists: nodes as
 * labelled boxes in the converter's columns (sources left, Output right),
 * wires between them. Blocks and regions (code the converter kept as code) and
 * warned nodes (not quite GLSL) are marked, and clicking one selects it for
 * the detail panel. Read-only: the real canvas takes over after Materialize.
 */
import { useMemo } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { kindOf, labelOf, type OutlineKind } from './outlineKinds';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';

const W = 236, H = 44, S = 0.62; // box size in graph units, and the scale down to the outline

export function OutlineCanvas({ nodes, selected, onSelect }: { nodes: GraphNode[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const tk = useTokens();
  const colour: Record<OutlineKind, string> = { source: tk.accent.base, node: tk.text.muted, block: tk.kind.expr, region: tk.kind.fn, output: tk.status.success, warned: tk.status.warningText };
  const { box, wires } = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) { minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y); maxX = Math.max(maxX, n.position.x + W); maxY = Math.max(maxY, n.position.y + H); }
    const wires: { d: string; type: string }[] = [];
    for (const n of nodes) for (const s of Object.values(n.inputs)) {
      if (!s.connection) continue;
      const src = byId.get(s.connection.nodeId); if (!src) continue;
      const x1 = src.position.x + W, y1 = src.position.y + H / 2, x2 = n.position.x, y2 = n.position.y + H / 2;
      const c = Math.max(40, (x2 - x1) / 2);
      wires.push({ d: `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`, type: s.type });
    }
    return { box: nodes.length ? { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 } : { x: 0, y: 0, w: 10, h: 10 }, wires };
  }, [nodes]);
  const wireColour = (t: string) => t === 'float' ? alpha(tk.text.primary, 0.35) : t === 'vec2' ? alpha(tk.accent.base, 0.6) : t === 'vec3' ? alpha(tk.status.success, 0.6) : alpha(tk.kind.expr, 0.6);
  if (!nodes.length) return null;
  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', font: `${13 / S}px ${fontFamily.ui}` }} onClick={() => onSelect(null)}>
      {wires.map((w, i) => <path key={i} d={w.d} fill="none" stroke={wireColour(w.type)} strokeWidth={2.2} />)}
      {nodes.map(n => {
        const k = kindOf(n); const c = colour[k]; const on = n.id === selected;
        const code = k === 'block' || k === 'region';
        return (
          <g key={n.id} transform={`translate(${n.position.x} ${n.position.y})`} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onSelect(n.id); }}>
            <rect width={W} height={H} rx={10} fill={on ? alpha(c, 0.22) : code ? alpha(c, 0.1) : tk.bg.panel} stroke={c} strokeWidth={on ? 3 : k === 'node' ? 1.2 : 2} strokeDasharray={code ? '6 4' : undefined} />
            <rect x={0} y={0} width={6} height={H} rx={3} fill={c} />
            <text x={16} y={H / 2 + 5} fill={tk.text.primary} style={{ fontFamily: code ? fontFamily.mono : fontFamily.ui, fontSize: code ? 12.5 : 13.5, fontWeight: code ? 500 : 600 }}>
              {truncate(labelOf(n), code ? 26 : 24)}
            </text>
            {k === 'warned' && <text x={W - 20} y={H / 2 + 5} fill={c} style={{ fontSize: 15, fontWeight: 700 }}>≈</text>}
            {k === 'block' && <text x={W - 44} y={H / 2 + 4} fill={c} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>EXPR</text>}
            {k === 'region' && <text x={W - 34} y={H / 2 + 4} fill={c} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>FN</text>}
          </g>
        );
      })}
    </svg>
  );
}
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
