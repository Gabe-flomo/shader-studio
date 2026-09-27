/**
 * CurveEditor — the grade's curves, as in Lightroom and Resolve: pick a
 * curve (RGB master, red, green, blue, or hue vs saturation, hue vs hue,
 * luma vs saturation), click to add a point, drag it, and drag it out of the
 * box, double-click it or press Delete to remove it. The line drawn is the
 * one the picture gets: the same spline as play/kit/finish.js bakes into the
 * lookup texture (monotone for the tone curves, wrapping round for hue).
 */
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Segmented } from '../../ui/Choice';
import { IconButton } from '../../ui/Button';
import { fnCurveEval, fnCurvePoints, fnHueCurveEval } from '../../../play/kit/finish.js';
import type { FinishCurves } from '../../../types/playFinish';

type Channel = keyof FinishCurves;

const CHANNELS: Array<{ value: Channel; label: string; title: string }> = [
  { value: 'rgb', label: 'RGB', title: 'The master curve: every channel at once (brightness and contrast)' },
  { value: 'r', label: 'R', title: 'Red only' },
  { value: 'g', label: 'G', title: 'Green only' },
  { value: 'b', label: 'B', title: 'Blue only' },
  { value: 'hueSat', label: 'Hue·Sat', title: 'Hue vs saturation: raise or lower the saturation of one colour' },
  { value: 'hueHue', label: 'Hue·Hue', title: 'Hue vs hue: turn one colour into its neighbour' },
  { value: 'lumaSat', label: 'Luma·Sat', title: 'Luma vs saturation: less colour in the shadows or highlights' },
];
const HUE: ReadonlySet<Channel> = new Set(['hueSat', 'hueHue', 'lumaSat']);
const LINE: Record<string, string> = { rgb: '#e8e8ee', r: '#ff5a5a', g: '#4ade80', b: '#60a5fa' };
const HIT = 0.05;

export function CurveEditor({ curves, onChange, touch }: { curves: FinishCurves; onChange: (c: FinishCurves) => void; touch?: boolean }) {
  const tk = useTokens();
  const [ch, setCh] = useState<Channel>('rgb');
  const [active, setActive] = useState(-1);
  const box = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; out: boolean } | null>(null);
  const hue = HUE.has(ch);
  const flat = useMemo(() => curves[ch] ?? [], [curves, ch]);
  const pts = useMemo(() => fnCurvePoints(flat), [flat]);
  const S = 256;

  const setPts = (next: Array<[number, number]>) => onChange({ ...curves, [ch]: next.flatMap(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]) });
  const toUnit = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  };
  const nearest = (u: { x: number; y: number }) => {
    let best = -1, bd = touch ? HIT * 1.8 : HIT;
    pts.forEach(([x, y], i) => { const d = Math.hypot(x - u.x, y - u.y); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  // The tone curves keep their end points (they can move up and down, not away); hue curves have none.
  const endPoint = (i: number) => !hue && (i === 0 || i === pts.length - 1) && pts.length >= 2;

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const u = toUnit(e);
    let i = nearest(u);
    if (i < 0) {
      // A new point on the curve where you clicked (at the pointer's height).
      const next = [...pts, [clamp(u.x), clamp(u.y)] as [number, number]].sort((a, b) => a[0] - b[0]);
      i = next.findIndex(p => p[0] === clamp(u.x) && p[1] === clamp(u.y));
      setPts(next);
    }
    setActive(i);
    drag.current = { index: i, out: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const u = toUnit(e);
    const cur = fnCurvePoints(curves[ch] ?? []);
    if (d.index < 0 || d.index >= cur.length) return;
    // Dragged well outside the box: the point goes (unless it's an end point).
    const out = u.x < -0.12 || u.x > 1.12 || u.y < -0.12 || u.y > 1.12;
    d.out = out && !endPointOf(cur, d.index, hue);
    const lo = d.index > 0 ? cur[d.index - 1][0] + 0.005 : 0;
    const hi = d.index < cur.length - 1 ? cur[d.index + 1][0] - 0.005 : 1;
    let x = Math.max(lo, Math.min(hi, u.x));
    if (endPointOf(cur, d.index, hue)) x = cur[d.index][0];
    const next = cur.map((p, i) => (i === d.index ? [x, clamp(u.y)] as [number, number] : p));
    onChange({ ...curves, [ch]: next.flatMap(([px, py]) => [Math.round(px * 1e4) / 1e4, Math.round(py * 1e4) / 1e4]) });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.out) { remove(d.index); }
  };
  const remove = (i: number) => {
    if (i < 0 || endPoint(i)) return;
    setPts(pts.filter((_, k) => k !== i));
    setActive(-1);
  };

  // The line itself, sampled from the same spline the lookup is baked from.
  const path = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= 128; i++) {
      const x = i / 128;
      const y = hue ? fnHueCurveEval(flat, x, ch !== 'lumaSat') : fnCurveEval(flat, x);
      out.push(`${i ? 'L' : 'M'}${(x * S).toFixed(1)},${((1 - y) * S).toFixed(1)}`);
    }
    return out.join('');
  }, [flat, hue, ch]);
  const stroke = hue ? '#ffffff' : LINE[ch];
  const bgHue = ch === 'hueSat' || ch === 'hueHue';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Segmented<Channel> size="sm" wrap ariaLabel="Curve" value={ch} onChange={c => { setCh(c); setActive(-1); }} options={CHANNELS.map(c => ({ ...c, label: c.label }))} />
        </div>
        <IconButton icon="resetParams" size="sm" label="Reset this curve" onClick={() => onChange({ ...curves, [ch]: hue ? [] : [0, 0, 1, 1] })} />
      </div>
      <div style={{ position: 'relative', marginTop: 8, borderRadius: radius.md, overflow: 'hidden', background: '#101016', aspectRatio: '1 / 1', maxWidth: touch ? '100%' : 300, boxShadow: `inset 0 0 0 1px ${alpha('#ffffff', 0.08)}` }}>
        {bgHue && <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, background: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', opacity: 0.85 }} />}
        {ch === 'lumaSat' && <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, background: 'linear-gradient(90deg,#000,#fff)', opacity: 0.85 }} />}
        <svg
          ref={box}
          viewBox={`0 0 ${S} ${S}`}
          role="img"
          aria-label={`${CHANNELS.find(c => c.value === ch)?.title}. Click to add a point, drag to move it, drag it out or double-click to remove it.`}
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={e => remove(nearest(toUnit(e)))}
          onKeyDown={e => { if ((e.key === 'Delete' || e.key === 'Backspace') && active >= 0) { e.preventDefault(); remove(active); } }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
        >
          {[0.25, 0.5, 0.75].map(g => (
            <g key={g} stroke={alpha('#ffffff', 0.08)} strokeWidth={1}>
              <line x1={g * S} y1={0} x2={g * S} y2={S} />
              <line x1={0} y1={g * S} x2={S} y2={g * S} />
            </g>
          ))}
          {hue ? <line x1={0} y1={S / 2} x2={S} y2={S / 2} stroke={alpha('#ffffff', 0.25)} strokeDasharray="4 4" /> : <line x1={0} y1={S} x2={S} y2={0} stroke={alpha('#ffffff', 0.18)} strokeDasharray="4 4" />}
          <path d={path} fill="none" stroke={stroke} strokeWidth={2} />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={x * S} cy={(1 - y) * S} r={touch ? 8 : 5.5} fill={i === active ? stroke : '#101016'} stroke={stroke} strokeWidth={2} />
          ))}
        </svg>
      </div>
      <div style={{ marginTop: 5, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
        {hue
          ? ch === 'hueHue' ? 'Raise a point to turn that colour toward the next hue, lower it to turn it back. The middle line is no change.' : 'Raise a point for more saturation there, lower it for less. The middle line is no change.'
          : 'Click to add a point, drag to shape. Drag a point out or double-click it to remove it.'}
      </div>
    </div>
  );
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const endPointOf = (pts: Array<[number, number]>, i: number, hue: boolean) => !hue && (i === 0 || i === pts.length - 1) && pts.length >= 2;
