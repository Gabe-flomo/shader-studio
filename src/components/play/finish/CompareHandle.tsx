/**
 * CompareHandle — the before/after wipe's divider on the picture, while the
 * Finish tab is open (the wipe itself is `finish.compare`, drawn by the
 * Finish pass in the preview, renders and exports). On one side is the
 * picture before the Finish stack; drag the grip to move it (`pos`), or use
 * the arrow keys. The line follows the wipe's angle.
 */
import { useRef } from 'react';
import { usePlayUi } from '../playUi';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { fnActive } from '../../../play/kit/finish.js';
import { FINISH_COMPARE_ID, patchFinishEffect, renderableFinish } from '../../../types/playFinish';

/** Where `pos` sits for a point on the picture (x, y in 0..1 from the top left), as the Finish pass measures it. */
export function wipePosAt(x: number, y: number, angle: number, aspect: number): number {
  const a = angle * Math.PI / 180, nx = Math.cos(a), ny = Math.sin(a);
  const vx = (x - 0.5) * aspect, vy = (0.5 - y);
  const e = 0.5 * (Math.abs(nx) * aspect + Math.abs(ny));
  return Math.max(0, Math.min(1, (vx * nx + vy * ny) / Math.max(e, 1e-4) * 0.5 + 0.5));
}

export function CompareHandle() {
  const compare = useNodeGraphStore(s => s.play.finish?.compare);
  const tab = usePlayUi(s => s.tab);
  const performing = usePlayUi(s => s.performing);
  const active = useNodeGraphStore(s => fnActive(renderableFinish(s.play.finish)));
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  if (!compare?.on || !performing || !active || tab !== 'finish') return null;
  const set = (patch: Record<string, number>) => useNodeGraphStore.getState().setPlay(p => ({ ...p, finish: patchFinishEffect(p.finish, FINISH_COMPARE_ID, patch) }));
  const box = () => ref.current?.parentElement?.getBoundingClientRect();
  const at = (clientX: number, clientY: number) => {
    const b = box();
    if (b && b.width > 0 && b.height > 0) set({ pos: wipePosAt((clientX - b.left) / b.width, (clientY - b.top) / b.height, compare.angle, b.width / b.height) });
  };
  // The divider's centre, in 0..1 of the box: along the wipe's direction from the middle.
  const b = box();
  const aspect = b && b.height > 0 ? b.width / b.height : 16 / 9;
  const a = compare.angle * Math.PI / 180, nx = Math.cos(a), ny = Math.sin(a);
  const e = 0.5 * (Math.abs(nx) * aspect + Math.abs(ny));
  const d = (compare.pos - 0.5) * 2 * e;
  const cx = 0.5 + (nx * d) / aspect, cy = 0.5 - ny * d;
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 3 }}>
      <span aria-hidden style={{ position: 'absolute', left: `${cx * 100}%`, top: `${cy * 100}%`, width: 1.5, height: '300%', background: 'rgba(255,255,255,0.85)', boxShadow: '0 0 2px rgba(0,0,0,0.5)', transform: `translate(-50%, -50%) rotate(${-compare.angle}deg)` }} />
      <div
        role="slider"
        aria-label="Before / after divider: on one side is the picture before the Finish stack"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(compare.pos * 100)}
        tabIndex={0}
        onPointerDown={ev => { drag.current = true; (ev.currentTarget as Element).setPointerCapture(ev.pointerId); ev.stopPropagation(); ev.preventDefault(); }}
        onPointerMove={ev => { if (drag.current) { at(ev.clientX, ev.clientY); ev.stopPropagation(); } }}
        onPointerUp={ev => { drag.current = false; ev.stopPropagation(); }}
        onPointerCancel={() => { drag.current = false; }}
        onKeyDown={ev => {
          if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') set({ pos: Math.max(0, compare.pos - 0.02) });
          else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') set({ pos: Math.min(1, compare.pos + 0.02) });
          else return;
          ev.preventDefault();
        }}
        style={{ position: 'absolute', left: `calc(${cx * 100}% - 14px)`, top: `calc(${cy * 100}% - 14px)`, width: 28, height: 28, cursor: 'grab', touchAction: 'none', pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <span aria-hidden style={{ width: 24, height: 24, borderRadius: 12, background: 'rgba(255,255,255,0.92)', boxShadow: '0 1px 4px rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#222', font: '700 11px system-ui', letterSpacing: -1, transform: `rotate(${-compare.angle}deg)` }}>‹›</span>
      </div>
    </div>
  );
}
