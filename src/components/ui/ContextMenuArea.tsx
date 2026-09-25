/**
 * ContextMenuArea — a right-click menu for any row, which touch screens open
 * with a long press (half a second without moving: a drag, like scrubbing a
 * ruler, never opens it). `children` can be a function that gets `open`, so
 * a visible button can open the same menu (phones have no right-click to
 * discover).
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Menu, type MenuItem } from './Menu';

const HOLD_MS = 500;
const SLOP_PX = 10;

export function ContextMenuArea({ items, children, style, minWidth = 220 }: {
  /** Built when the menu opens, so it reads the latest state. */
  items: () => readonly MenuItem[];
  children: ReactNode | ((open: (x: number, y: number) => void) => ReactNode);
  style?: CSSProperties;
  minWidth?: number;
}) {
  const [at, setAt] = useState<{ x: number; y: number; items: readonly MenuItem[] } | null>(null);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const open = (x: number, y: number) => setAt({ x, y, items: items() });
  const cancel = () => { if (hold.current) { window.clearTimeout(hold.current.timer); hold.current = null; } };
  return (
    <div
      style={{ ...style, WebkitTouchCallout: 'none' } as CSSProperties}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (!hold.current && !at) open(e.clientX, e.clientY); }}
      onPointerDown={e => {
        if (e.pointerType !== 'touch') return;
        cancel();
        const x = e.clientX, y = e.clientY;
        hold.current = { x, y, timer: window.setTimeout(() => { hold.current = null; open(x, y); }, HOLD_MS) };
      }}
      onPointerMove={e => { const h = hold.current; if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > SLOP_PX) cancel(); }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
    >
      {typeof children === 'function' ? children(open) : children}
      {at && <Menu x={at.x} y={at.y} items={at.items} minWidth={minWidth} onClose={() => setAt(null)} />}
    </div>
  );
}
