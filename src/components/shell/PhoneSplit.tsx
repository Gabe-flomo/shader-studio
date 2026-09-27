/**
 * PhoneSplit — the drag handle between the picture and what sits under it on
 * phones (the Studio's preview and graph, the Play page's picture and panels).
 * The size, its limits, snap points and memory are in splitSize.ts.
 */
import { useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import type { PhoneSplit } from './splitSize';

/**
 * A grab bar over the seam, 18px tall and overlapping both sides by 9px, so it takes no room of
 * its own. The seam follows the finger; letting go snaps and remembers the size; a double-tap
 * goes back to the default.
 */
export function SplitHandle({ split, label = 'Resize' }: { split: PhoneSplit; label?: string }) {
  const tk = useTokens();
  // Where the press started, and the size then: the seam follows the finger from there.
  const start = useRef<{ y: number; vh: number } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef(0);
  const [active, setActive] = useState(false);
  const end = () => { start.current = null; setActive(false); };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={Math.round(split.vh)}
      data-phone-split=""
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, vh: split.vh };
        moved.current = false;
        setActive(true);
      }}
      onPointerMove={e => {
        if (start.current === null) return;
        const dy = e.clientY - start.current.y;
        if (!moved.current && Math.abs(dy) < 4) return;
        moved.current = true;
        split.drag(start.current.vh + (dy / window.innerHeight) * 100);
      }}
      onPointerUp={e => {
        if (start.current === null) return;
        end();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (moved.current) { lastTap.current = 0; split.settle(); return; }
        // A tap: two in a row reset it (by hand, as iOS Safari doesn't reliably send dblclick).
        const now = Date.now();
        if (now - lastTap.current < 400) { lastTap.current = 0; split.reset(); } else lastTap.current = now;
      }}
      onPointerCancel={() => { if (start.current === null) return; end(); if (moved.current) split.settle(); }}
      onDoubleClick={split.reset}
      title="Drag to resize. Double-tap to reset"
      style={{
        flexShrink: 0, height: 18, margin: '-9px 0', zIndex: 23, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'ns-resize', touchAction: 'none',
      }}
    >
      <div style={{ width: active ? 56 : 40, height: 4, borderRadius: 2, background: active ? tk.accent.base : tk.border.strong, transition: 'width 120ms ease, background 120ms ease' }} />
    </div>
  );
}
