/**
 * ColourWheel — one of the grade's lift / gamma / gain wheels (Resolve's
 * colour wheels, Lumetri's shadows / midtones / highlights): drag the puck
 * toward a hue to push that range of tones toward it (further out is
 * stronger), double-click to centre it. The level slider under it raises or
 * lowers the same range's brightness.
 */
import { useRef, type PointerEvent as RPointerEvent } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily } from '../../../theme/tokens';
import { RulerSlider } from '../../ui/RulerSlider';
import { Tooltip } from '../../ui/Tooltip';
import { fnWheel } from '../../../play/kit/finish.js';

export function ColourWheel({ title, hint, x, y, level, onMove, onLevel, touch, size = 118 }: {
  title: string;
  hint: string;
  x: number; y: number; level: number;
  onMove: (x: number, y: number) => void;
  onLevel: (v: number) => void;
  touch?: boolean;
  size?: number;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const at = (e: { clientX: number; clientY: number }, fine: boolean) => {
    const r = ref.current!.getBoundingClientRect();
    let px = ((e.clientX - r.left) / r.width) * 2 - 1, py = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const d = Math.hypot(px, py);
    if (d > 1) { px /= d; py /= d; }
    // Shift: finer, a quarter as far.
    if (fine) { px *= 0.25; py *= 0.25; }
    onMove(Math.round(px * 1000) / 1000, Math.round(py * 1000) / 1000);
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => { if (e.button !== 0) return; dragging.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); at(e, e.shiftKey); e.preventDefault(); };
  const move = (e: RPointerEvent<HTMLDivElement>) => { if (dragging.current) at(e, e.shiftKey); };
  const up = () => { dragging.current = false; };
  const push = fnWheel(x, y);
  const pushCss = `rgb(${push.map(v => Math.round(Math.max(0, Math.min(1, 0.5 + v)) * 255)).join(',')})`;
  const s = touch ? Math.max(size, 132) : size;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <Tooltip label={title} description={hint} placement="top">
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'help' }}>{title}</span>
      </Tooltip>
      <div
        ref={ref}
        role="slider"
        aria-label={`${title} colour: drag toward a hue, double-click to centre`}
        aria-valuetext={x || y ? `pushed ${Math.round(Math.hypot(x, y) * 100)}% toward ${Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)}°` : 'neutral'}
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => onMove(0, 0)}
        onKeyDown={e => {
          const k = 0.02;
          if (e.key === 'ArrowLeft') onMove(Math.max(-1, x - k), y);
          else if (e.key === 'ArrowRight') onMove(Math.min(1, x + k), y);
          else if (e.key === 'ArrowUp') onMove(x, Math.min(1, y + k));
          else if (e.key === 'ArrowDown') onMove(x, Math.max(-1, y - k));
          else if (e.key === 'Home' || e.key === 'Escape') onMove(0, 0);
          else return;
          e.preventDefault();
        }}
        style={{
          width: s, height: s, borderRadius: '50%', position: 'relative', cursor: 'crosshair', touchAction: 'none', flexShrink: 0,
          // The hue at each angle is the push that way (0° = red to the right, as fnWheel reads it); grey in the middle.
          background: 'radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128,0.55) 38%, rgba(128,128,128,0) 72%), conic-gradient(from 90deg, #f00, #f0f, #00f, #0ff, #0f0, #ff0, #f00)',
          boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.25)}, 0 0 0 3px ${pushCss}`,
        }}
      >
        <span aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', width: 1, height: 1, boxShadow: `0 0 0 3px ${alpha('#fff', 0.5)}` }} />
        <span aria-hidden style={{
          position: 'absolute', width: 14, height: 14, borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          left: `calc(${50 + x * 50}% - 7px)`, top: `calc(${50 - y * 50}% - 7px)`, background: pushCss,
        }} />
      </div>
      <div style={{ width: '100%' }}>
        <RulerSlider value={level} min={-1} max={1} step={0.01} defaultValue={0} hard onChange={onLevel} ariaLabel={`${title} level`} touch={touch} />
      </div>
    </div>
  );
}
