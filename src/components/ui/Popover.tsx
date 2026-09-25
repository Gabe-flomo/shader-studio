import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { portalGuard } from './portalGuard';

const GAP = 6;
const MARGIN = 8;

/**
 * Panel anchored under (or above) a trigger element. Closes on outside click and Esc; clicks on
 * the anchor itself are left to the trigger so it can toggle. Kept inside the viewport.
 *
 * `clearRef` names an element the panel must not cover (a node card whose sockets and
 * footer would otherwise disappear under it): the panel then opens beside that element,
 * level with the anchor, and only falls back to below it when neither side has room.
 */
export function Popover({
  anchorRef, clearRef, onClose, align = 'start', width, children, padding = 4,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  clearRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: 'start' | 'center' | 'end';
  width?: number;
  children: ReactNode;
  padding?: number;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useLayoutEffect(() => {
    const a = anchorRef.current?.getBoundingClientRect();
    const p = ref.current?.getBoundingClientRect();
    if (!a || !p) return;
    let left = align === 'start' ? a.left : align === 'end' ? a.right - p.width : a.left + a.width / 2 - p.width / 2;
    let top = a.bottom + GAP;
    const c = clearRef?.current?.getBoundingClientRect();
    if (c) {
      if (c.right + GAP + p.width <= window.innerWidth - MARGIN) { left = c.right + GAP; top = a.top; }
      else if (c.left - GAP - p.width >= MARGIN) { left = c.left - GAP - p.width; top = a.top; }
      else top = c.bottom + GAP;
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - p.height - MARGIN));
    } else if (top + p.height > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, a.top - p.height - GAP);
    }
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - p.width - MARGIN));
    // Measured after render, so place it directly rather than re-rendering.
    ref.current!.style.left = `${left}px`;
    ref.current!.style.top = `${top}px`;
  }, [anchorRef, clearRef, align]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      // A popover opened from inside this one is portaled after it, not inside it: a press
      // there is still "inside" (a saved graph's versions list in the Load menu, say).
      const other = (t as Element).closest?.('[data-popover]');
      if (other && ref.current && other !== ref.current && (ref.current.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      {...portalGuard}
      ref={ref}
      data-popover=""
      style={{
        position: 'fixed', left: -9999, top: -9999, zIndex: 9000, width, padding,
        background: tk.bg.panel, color: tk.text.primary, borderRadius: radius.lg, boxShadow: tk.shadow.popover,
        font: `12.5px ${fontFamily.ui}`,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
