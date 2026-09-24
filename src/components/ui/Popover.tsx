import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

const GAP = 6;
const MARGIN = 8;

/**
 * Panel anchored under (or above) a trigger element. Closes on outside click and Esc; clicks on
 * the anchor itself are left to the trigger so it can toggle. Kept inside the viewport.
 */
export function Popover({
  anchorRef, onClose, align = 'start', width, children, padding = 4,
}: {
  anchorRef: RefObject<HTMLElement | null>;
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
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - p.width - MARGIN));
    let top = a.bottom + GAP;
    if (top + p.height > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - p.height - GAP);
    // Measured after render, so place it directly rather than re-rendering.
    ref.current!.style.left = `${left}px`;
    ref.current!.style.top = `${top}px`;
  }, [anchorRef, align]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
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
      ref={ref}
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
