/**
 * Guided Convert: an outline in each step's colour around the cards it made, over the read-only canvas,
 * following its pan and zoom. The remainder's cards get a dashed outline ("not converted yet").
 */
import { useEffect, useState } from 'react';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { estimateNodeHeight } from '../../../store/graphLayout';
import { getCardSize, getView, subscribeCardSizes, subscribeView } from '../../NodeGraph/socketRegistry';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';

export interface CardTint { hue: number | null; label: string; dashed?: boolean; active?: boolean }

export function CanvasTints({ tintOf }: { tintOf: (nodeId: string) => CardTint | null }) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  const nodes = useNodeGraphStore(s => s.nodes);
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    const a = subscribeView(bump), b = subscribeCardSizes(bump);
    return () => { a(); b(); };
  }, []);
  const { pan, zoom } = getView();
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 4 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {nodes.map(n => {
          const t = tintOf(n.id);
          if (!t) return null;
          const size = getCardSize(n.id);
          const w = size?.w ?? 360, h = size?.h ?? estimateNodeHeight(n);
          const colour = t.hue === null ? tk.text.faint : `hsl(${t.hue}, 70%, ${dark ? 58 : 48}%)`;
          return (
            <div key={n.id} style={{ position: 'absolute', left: n.position.x - 6, top: n.position.y - 6, width: w + 12, height: h + 12, borderRadius: 16, border: `${t.active ? 3 : 2}px ${t.dashed ? 'dashed' : 'solid'} ${colour}`, opacity: t.active ? 1 : 0.85 }}>
              <span style={{ position: 'absolute', left: 10, top: -22, padding: '2px 8px', borderRadius: 8, background: colour, color: '#fff', font: `650 11px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{t.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
