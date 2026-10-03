/**
 * FloatingPanel — the detail window kept open (its "Keep open" button): the
 * same header and body as the Modal shell, but no scrim and no Esc, so the
 * board behind stays usable (drag a slider, drop a source on a control,
 * follow a chip) while it shows what it shows. It sits at the bottom right
 * to start with; its header drags it anywhere on screen. Its X closes it.
 */
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { portalGuard } from '../../ui/portalGuard';

const WIDTH = 440;
const MARGIN = 16;

/** Keep a panel w wide at (x, y) on a screen vw×vh with some of its header always on screen to grab. */
function clampPanel(x: number, y: number, w: number, vw: number, vh: number): { x: number; y: number } {
  return { x: Math.max(MARGIN - w + 80, Math.min(vw - 80, x)), y: Math.max(0, Math.min(vh - 48, y)) };
}

export function FloatingPanel({ title, subtitle, icon, headerActions, onClose, children }: {
  title: ReactNode; subtitle?: ReactNode; icon?: IconName; headerActions?: ReactNode; onClose: () => void; children: ReactNode;
}) {
  const tk = useTokens();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Buttons in the header stay buttons.
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const r = panel.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setPos(clampPanel(e.clientX - d.dx, e.clientY - d.dy, WIDTH, window.innerWidth, window.innerHeight));
  };
  const end = () => { drag.current = null; };
  return createPortal(
    <div
      {...portalGuard}
      ref={panel}
      role="dialog"
      aria-modal="false"
      data-detail-floating=""
      style={{
        position: 'fixed', zIndex: 1200, width: WIDTH, maxWidth: `calc(100vw - ${MARGIN * 2}px)`, height: 'min(600px, calc(100vh - 32px))',
        ...(pos ? { left: pos.x, top: pos.y } : { right: MARGIN, bottom: MARGIN }),
        display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
        background: tk.bg.panel, color: tk.text.primary, borderRadius: radius.modal, boxShadow: `${tk.shadow.modal}, 0 0 0 1px ${tk.border.default}`,
        font: `12.5px ${fontFamily.ui}`,
      }}
    >
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end} title="Drag to move"
        style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 12px', borderBottom: `1px solid ${tk.border.subtle}`, cursor: 'move', touchAction: 'none', userSelect: 'none' }}>
        {icon && (
          <span style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}>
            <Icon name={icon} size={14} />
          </span>
        )}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
          <b style={{ fontSize: 13.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
          {subtitle && <span style={{ fontSize: 11, color: tk.text.muted }}>{subtitle}</span>}
        </span>
        {headerActions}
        <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>,
    document.body,
  );
}
