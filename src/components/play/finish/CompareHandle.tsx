/**
 * CompareHandle — the before/after divider's grip on the picture (the
 * Finish tab's Before / after). Left of it is the picture before the Finish
 * stack, right of it after; drag it anywhere across. The line itself is drawn
 * by the Finish pass, so it is in step with the picture.
 */
import { useRef } from 'react';
import { usePlayUi } from '../playUi';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { fnActive } from '../../../play/kit/finish.js';

export function CompareHandle() {
  const compare = usePlayUi(s => s.compare);
  const performing = usePlayUi(s => s.performing);
  const active = useNodeGraphStore(s => fnActive(s.play.finish));
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  if (compare === null || !performing || !active) return null;
  const at = (clientX: number) => {
    const box = ref.current?.parentElement?.getBoundingClientRect();
    if (box && box.width > 0) usePlayUi.getState().setCompare((clientX - box.left) / box.width);
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Before / after divider: left is the picture before the Finish stack"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(compare * 100)}
      tabIndex={0}
      onPointerDown={e => { drag.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); e.stopPropagation(); e.preventDefault(); }}
      onPointerMove={e => { if (drag.current) { at(e.clientX); e.stopPropagation(); } }}
      onPointerUp={e => { drag.current = false; e.stopPropagation(); }}
      onPointerCancel={() => { drag.current = false; }}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') usePlayUi.getState().setCompare(compare - 0.02);
        else if (e.key === 'ArrowRight') usePlayUi.getState().setCompare(compare + 0.02);
        else if (e.key === 'Escape') usePlayUi.getState().setCompare(null);
        else return;
        e.preventDefault();
      }}
      style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${compare * 100}% - 14px)`, width: 28, cursor: 'ew-resize', touchAction: 'none', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span aria-hidden style={{ width: 24, height: 24, borderRadius: 12, background: 'rgba(255,255,255,0.92)', boxShadow: '0 1px 4px rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#222', font: '700 11px system-ui', letterSpacing: -1 }}>‹›</span>
      <span aria-hidden style={{ position: 'absolute', top: 8, left: -40, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', font: '600 10px system-ui' }}>Before</span>
      <span aria-hidden style={{ position: 'absolute', top: 8, left: 32, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', font: '600 10px system-ui' }}>After</span>
    </div>
  );
}
