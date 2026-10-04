/**
 * NodeDragGhost — what follows the pointer while a node is dragged out of the browser
 * (nodeDrop.ts). Over the graph: a dashed card outline exactly where the node will land (scaled
 * with the zoom), saying what the drop does. Anywhere else: a small label that fades, since a
 * release there cancels. Mounted once at the root; draws nothing when no drag is in flight.
 */
import { useNodeDrag, GRAB, GHOST_CARD } from './nodeDrop';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';

export function NodeDragGhost() {
  const drag = useNodeDrag(s => s.drag);
  const tk = useTokens();
  if (!drag) return null;
  const { x, y, zoom, overCanvas, blocked, edge, wireMisfit, label } = drag;
  const hint = blocked ? 'This graph is locked'
    : !overCanvas ? 'Drop on the graph to add'
    : edge ? 'Release to insert into this wire'
    : wireMisfit ? 'Doesn’t fit this wire: adds it here'
    : 'Release to add';
  const chip = (
    <div style={{
      maxWidth: 300, padding: '4px 9px', borderRadius: radius.md, whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis',
      background: blocked ? tk.bg.panel : tk.accent.base, color: blocked ? tk.text.secondary : '#fff',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)', font: `600 12px ${fontFamily.ui}`,
    }}>
      {label}<span style={{ fontWeight: 500, opacity: 0.85 }}> · {hint}</span>
    </div>
  );
  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 100000 }}>
      {overCanvas ? (
        <div data-node-drop-ghost style={{
          position: 'absolute', left: x - GRAB.x * zoom, top: y - GRAB.y * zoom,
          width: GHOST_CARD.w * zoom, height: GHOST_CARD.h * zoom, boxSizing: 'border-box',
          borderRadius: Math.max(4, 10 * zoom), border: `1.5px dashed ${blocked ? tk.text.faint : tk.accent.base}`,
          background: alpha(blocked ? tk.text.faint : tk.accent.base, 0.1),
        }}>
          <div style={{ position: 'absolute', left: 0, bottom: '100%', marginBottom: 6 }}>{chip}</div>
        </div>
      ) : (
        <div style={{ position: 'absolute', left: x + 14, top: y + 14, opacity: 0.8 }}>{chip}</div>
      )}
    </div>
  );
}
