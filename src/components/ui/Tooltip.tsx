import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Kbd } from './Kbd';

const GAP = 6;
const MARGIN = 8;

/**
 * Hover tooltip: dark, max 280px, shows after `delay` ms and hides on pointer down (so it never
 * sits on top of a drag). `shortcut` renders as a keycap next to the label.
 */
export function Tooltip({
  label, description, shortcut, placement = 'bottom', delay = 400, disabled = false, grow = false, children,
}: {
  label: ReactNode;
  description?: ReactNode;
  shortcut?: string;
  placement?: 'top' | 'bottom' | 'right';
  delay?: number;
  disabled?: boolean;
  /** Let the anchor fill a flex row (for wide controls like the ruler). */
  grow?: boolean;
  children: ReactNode;
}) {
  const tk = useTokens();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const cancel = () => { window.clearTimeout(timer.current); };
  const show = () => {
    if (disabled) return;
    cancel();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => { cancel(); setOpen(false); setPos(null); };

  useEffect(() => cancel, []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    if (placement === 'right') {
      const top = Math.min(Math.max(MARGIN, a.top + a.height / 2 - t.height / 2), window.innerHeight - t.height - MARGIN);
      setPos({ left: a.right + GAP, top });
      return;
    }
    let top = placement === 'top' ? a.top - t.height - GAP : a.bottom + GAP;
    if (top + t.height > window.innerHeight - MARGIN) top = a.top - t.height - GAP;
    if (top < MARGIN) top = a.bottom + GAP;
    const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - t.width / 2), window.innerWidth - t.width - MARGIN);
    setPos({ left, top });
  }, [open, placement]);

  return (
    <span
      ref={anchorRef}
      style={{ display: 'inline-flex', ...(grow ? { flex: 1, minWidth: 0 } : null) }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && !disabled && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          style={{
            position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 10000, pointerEvents: 'none',
            maxWidth: 280, padding: description ? '8px 10px' : '5px 6px 5px 10px', borderRadius: 8,
            background: tk.tooltip.bg, color: tk.tooltip.text, boxShadow: tk.shadow.popover,
            font: `12px/1.45 ${fontFamily.ui}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: tk.tooltip.strong, fontWeight: description ? 600 : 400 }}>
            <span style={{ flex: 1 }}>{label}</span>
            {shortcut && <Kbd combo={shortcut} onDark />}
          </div>
          {description && <div style={{ marginTop: 3 }}>{description}</div>}
        </div>,
        document.body,
      )}
    </span>
  );
}
