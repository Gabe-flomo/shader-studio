/**
 * DrawnPathPad — the Motion section's pad for a Drawn path (docs/grid-builder.md "Drawn paths"):
 *
 *  - drag on the pad to draw a stroke (one undo step when the pointer lifts; Auto smooth thins and
 *    fairs it then);
 *  - drag a point's handle to move it; right-click (or Alt-click) a handle to delete it;
 *  - the path the shape follows (rounded by Smooth, arc-length spaced) is drawn over it, turned by
 *    the Angle when one is set, with its start marked;
 *  - below: closed or open, the open path's end (snap back, ease back, ping-pong), Back, Ease,
 *    Smooth, Auto smooth, and Generate (a random path from a seed, wiggle and points: one undo).
 *
 * Redrawing changes only numbers on the built nodes: no rebuild.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { NumRow, Row } from '../sceneBuilder/controls';
import { BuilderNote } from '../builders/BuilderWindow';
import { newSeed } from '../../lib/surprise';
import { drawnPoints, motionTheta, rotate2, type GShape, type Vec2 } from '../../gridScene/spec';
import {
  PATH_ENDS, PATH_END_LABELS, cleanStroke, clampBack, defaultDrawnPath, generatePath, type DrawnPath, type PathEnd,
} from '../../gridScene/paths';
import { rgb } from './glyphs';
import { gridPlay } from './playParam';

const SIZE = 132;
const M = 8;
const toPx = (v: Vec2): Vec2 => [SIZE / 2 + v[0] * (SIZE / 2 - M), SIZE / 2 - v[1] * (SIZE / 2 - M)];
const fromPx = (x: number, y: number): Vec2 => [(x - SIZE / 2) / (SIZE / 2 - M), -(y - SIZE / 2) / (SIZE / 2 - M)];

export function DrawnPathPad({ shape, onEdit }: { shape: GShape; onEdit: (fn: (d: DrawnPath) => void, key?: string) => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const path = shape.motion.drawn ?? defaultDrawnPath();
  const [live, setLive] = useState<Vec2[] | null>(null);
  const drag = useRef<{ kind: 'stroke'; pts: Vec2[] } | { kind: 'point'; i: number } | null>(null);
  const th = motionTheta(shape.motion, 0);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = SIZE * dpr; cv.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tk.bg.field; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = tk.border.default; ctx.lineWidth = 1;
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      const [a] = toPx([v, 0]);
      ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(a, SIZE); ctx.moveTo(0, a); ctx.lineTo(SIZE, a); ctx.stroke();
    }
    const line = (pts: Vec2[], closed: boolean) => {
      ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = toPx(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (closed) ctx.closePath();
      ctx.stroke();
    };
    const q = drawnPoints(path);
    // Turned by the Angle: where the shape really goes (faint when it differs from the drawing).
    if (Math.abs(th) > 1e-4) {
      ctx.strokeStyle = alpha(tk.accent.base, 0.5); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      line(q.map(p => rotate2(p, th)), path.closed);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = rgb(shape.color, 0.9); ctx.lineWidth = 1.5;
    line(q, path.closed);
    if (!path.closed && path.ends === 'ease') {
      ctx.strokeStyle = rgb(shape.color, 0.35); ctx.setLineDash([2, 3]);
      line([q[q.length - 1], q[0]], false);
      ctx.setLineDash([]);
    }
    // The stroke's points (handles), the start bigger.
    ctx.fillStyle = tk.accent.base;
    path.pts.forEach((p, i) => { const [x, y] = toPx(p); ctx.beginPath(); ctx.arc(x, y, i === 0 ? 4 : 2.5, 0, Math.PI * 2); ctx.fill(); });
    if (live) { ctx.strokeStyle = tk.text.primary; ctx.lineWidth = 1; line(live, false); }
  }, [path, live, shape.color, tk, th]);

  const at = (e: React.PointerEvent): Vec2 => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return fromPx((e.clientX - r.left) * (SIZE / r.width), (e.clientY - r.top) * (SIZE / r.height));
  };
  const handleAt = (p: Vec2) => {
    const [x, y] = toPx(p);
    let best = -1, bd = 7;
    path.pts.forEach((h, i) => { const [hx, hy] = toPx(h); const d = Math.hypot(hx - x, hy - y); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

  return (
    <canvas ref={ref} data-drawn-pad aria-label="Drawn path: drag to draw; drag a point to move it; right-click a point to delete it"
      style={{ width: SIZE, height: SIZE, borderRadius: radius.md, cursor: 'crosshair', touchAction: 'none', flexShrink: 0 }}
      onContextMenu={e => {
        e.preventDefault();
        const i = handleAt(at(e as unknown as React.PointerEvent));
        if (i >= 0 && path.pts.length > 2) onEdit(d => { d.pts.splice(i, 1); });
      }}
      onPointerDown={e => {
        if (e.button === 2) return;
        const p = at(e);
        const i = handleAt(p);
        if (i >= 0 && e.altKey) { if (path.pts.length > 2) onEdit(d => { d.pts.splice(i, 1); }); return; }
        (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
        if (i >= 0) { drag.current = { kind: 'point', i }; return; }
        drag.current = { kind: 'stroke', pts: [p] };
        setLive([p]);
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d || !e.buttons) return;
        const p = at(e);
        if (d.kind === 'point') onEdit(x => { x.pts[d.i] = [clamp1(p[0]), clamp1(p[1])]; }, `drawnpt${shape.id}${d.i}`);
        else { d.pts.push(p); setLive([...d.pts]); }
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        setLive(null);
        if (d?.kind !== 'stroke') return;
        const pts = cleanStroke(d.pts, path.auto);
        if (pts.length >= 2) onEdit(x => { x.pts = pts; });
      }} />
  );
}

/** The drawn path's settings under the pad. */
export function DrawnPathControls({ shape, onEdit }: { shape: GShape; onEdit: (fn: (d: DrawnPath) => void, key?: string) => void }) {
  const path = shape.motion.drawn ?? defaultDrawnPath();
  const [wiggle, setWiggle] = useState(0.5);
  const [points, setPoints] = useState(10);
  return (
    <>
      <BuilderNote>Drag on the pad to draw the path; drag a point to move it, right-click a point to delete it. X and Y stretch it (in cells), Angle turns it.</BuilderNote>
      <Row label="Closed" hint="A loop: the end joins the start and it goes round and round.">
        <Toggle checked={path.closed} onChange={v => onEdit(d => { d.closed = v; })} label={path.closed ? 'Loop' : 'Open'} />
      </Row>
      {!path.closed && (
        <Row label="At the end" hint={PATH_ENDS.map(k => `${PATH_END_LABELS[k].label}: ${PATH_END_LABELS[k].blurb}`).join('\n')}>
          <Select ariaLabel="Open path end" value={path.ends} options={PATH_ENDS.map(k => ({ value: k, label: PATH_END_LABELS[k].label }))} onChange={v => onEdit(d => { d.ends = v as PathEnd; })} />
        </Row>
      )}
      {!path.closed && path.ends === 'ease' && (
        <NumRow label="Back" hint="The share of each cycle the glide home takes." value={clampBack(path.back)} min={0.05} max={0.9} defaultValue={0.3}
          onChange={v => onEdit(d => { d.back = v; }, `back${shape.id}`)} lazyParam={gridPlay(shape.id, 'back')} />
      )}
      <NumRow label="Ease" hint="Eases in and out along the path each cycle (0: an even speed)." value={path.ease} min={0} max={1} defaultValue={0}
        onChange={v => onEdit(d => { d.ease = v; }, `ease${shape.id}`)} lazyParam={gridPlay(shape.id, 'ease')} />
      <NumRow label="Smooth" hint="Rounds the corners of the stroke before it is spaced evenly along its length." value={path.smooth} min={0} max={1} defaultValue={0.5}
        onChange={v => onEdit(d => { d.smooth = v; }, `smooth${shape.id}`)} />
      <Row label="Auto smooth" hint="When you lift the pointer, the stroke is thinned to its turning points and faired.">
        <Toggle checked={path.auto} onChange={v => onEdit(d => { d.auto = v; })} label={path.auto ? 'On' : 'Off'} />
      </Row>
      <Row label="Generate" hint="A random path from a new seed: a wobbly loop when Closed, else a meander. One undo step.">
        <Button size="sm" variant="ghost" icon="dice" data-generate-path onClick={() => {
          const pts = generatePath(newSeed(), { closed: path.closed, wiggle, points });
          onEdit(d => { d.pts = pts; });
        }}>New path</Button>
      </Row>
      <NumRow label="Wiggle" hint="How wobbly Generate makes it." value={wiggle} min={0} max={1} defaultValue={0.5} onChange={setWiggle} />
      <NumRow label="Points" hint="How many points Generate draws." value={points} min={3} max={32} integer defaultValue={10} onChange={setPoints} />
    </>
  );
}
