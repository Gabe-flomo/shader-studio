import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Kbd } from './Kbd';

const GAP = 6;
const MARGIN = 8;
/** A touch held this long shows the tooltip (there is no hover on a phone). */
export const LONG_PRESS_MS = 500;

/**
 * Hover tooltip: dark, max 280px, shows after `delay` ms and hides on pointer down (so it never
 * sits on top of a drag). `shortcut` renders as a keycap next to the label.
 */
export function Tooltip({
  label, description, shortcut, placement = 'bottom', delay = 400, disabled = false, grow = false, block = false, children,
}: {
  label: ReactNode;
  description?: ReactNode;
  shortcut?: string;
  placement?: 'top' | 'bottom' | 'right';
  delay?: number;
  disabled?: boolean;
  /** Let the anchor fill a flex row (for wide controls like the ruler). */
  grow?: boolean;
  /** The anchor is a full-width block (a list row): the row keeps its width. */
  block?: boolean;
  children: ReactNode;
}) {
  const tk = useTokens();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  // Touch: where a press started, and whether it was held long enough to show the tip.
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const cancel = () => { window.clearTimeout(timer.current); };
  const show = () => {
    if (disabled) return;
    cancel();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => { cancel(); setOpen(false); setPos(null); };

  useEffect(() => cancel, []);

  // Opened by a tap, it closes on a tap anywhere else (no pointer leaves to close it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) { cancel(); setOpen(false); setPos(null); }
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

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
      // An empty title stops the browser's own tooltip from an ancestor's `title` showing next to this one.
      title={disabled ? undefined : ''}
      style={{ display: block ? 'flex' : 'inline-flex', ...(block ? { width: '100%' } : null), ...(grow ? { flex: 1, minWidth: 0 } : null) }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={e => {
        // A touch screen has no hover: a tap on something that has a description opens it (as HintMark's "?" does);
        // otherwise, as with a mouse, pressing hides the tip so it never sits on top of a drag.
        // A second tap closes it.
        if (e.pointerType === 'touch' && description && !disabled && !open) { cancel(); setOpen(true); return; }
        hide();
        // Anything else on a touch screen: a long press shows the label (an icon button's name), and
        // that press then doesn't also count as a tap. Not on wide anchors (sliders, list rows), whose
        // own press-and-hold (a drag, a menu) comes first.
        if (e.pointerType === 'touch' && !disabled && !grow && !block) {
          pressAt.current = { x: e.clientX, y: e.clientY };
          longPressed.current = false;
          timer.current = window.setTimeout(() => { longPressed.current = true; setOpen(true); }, LONG_PRESS_MS);
        }
      }}
      onPointerMove={e => {
        const p = pressAt.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { pressAt.current = null; if (!longPressed.current) cancel(); }
      }}
      onPointerUp={() => { pressAt.current = null; if (!longPressed.current) cancel(); }}
      onPointerCancel={() => { pressAt.current = null; cancel(); }}
      onClickCapture={e => {
        if (longPressed.current) { longPressed.current = false; e.preventDefault(); e.stopPropagation(); }
      }}
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
            maxWidth: 'min(280px, calc(100vw - 16px))', overflowWrap: 'anywhere', padding: description ? '8px 10px' : '5px 6px 5px 10px', borderRadius: 8,
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
