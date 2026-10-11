/**
 * The Where picker's drawing over the live picture (docs/agent-builder.md "Where"): the region a
 * card reads, with the part where it does nothing shaded; a shape made here as its outline with
 * handles to drag (its middle moves it, its edge or corner sizes it, a polygon's corners and the
 * "+" on each side's middle); and drawing a new shape by dragging on the picture (a polygon by
 * clicking its corners). A region of the graph is shaded from its values on the GPU
 * (lib/regionValues.ts); a texture says so in words.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { picToView } from '../../agentBuilder/diagram';
import { type MadeShape, newMadeShape, readMadeShape, textBoxes, textHalfWidth } from '../../agentBuilder/madeShapes';
import { DEFAULT_WEIGHT, strokesPath } from '../../agentBuilder/strokeFont';
import { setMadeShape } from '../../agentBuilder/whereActions';
import { regionEdge, regionField, regionImage, slopeArrows } from '../../lib/regionValues';
import type { ViewRect } from '../builders/studio/LiveViewport';
import type { WhereDrawing, WhereShown } from './WherePicker';

type P = { x: number; y: number };
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** A point of the shown picture back to picture units (x ±aspect, y ±1). */
export function viewToPic(rect: ViewRect, p: P): P {
  const aspect = rect.w / Math.max(rect.h, 1);
  return { x: r4(((p.x - rect.x) / rect.w - 0.5) * 2 * aspect), y: r4((0.5 - (p.y - rect.y) / rect.h) * 2) };
}

/** Text in the stroke font: its strokes as a path, drawn with a round line this wide (px). Null for any other shape. */
export function textStrokes(s: MadeShape, im: ViewRect): { d: string; width: number } | null {
  if (s.shape !== 'text' || s.font !== 'stroke') return null;
  const d = strokesPath(s.text ?? 'A', (x, y) => picToView(im, { x: s.x + x * s.size, y: s.y + y * s.size }));
  return { d, width: Math.max(1, 2 * (s.weight ?? DEFAULT_WEIGHT) * s.size * im.h / 2) };
}

/**
 * A made shape drawn over the picture: an outline, or text in the stroke font as its strokes. `shade`
 * darkens where it doesn't act (the outside, or the inside for "outside"), `fill` tints the shape.
 */
function ShapeDrawing({ shape, im, stroke, fill, shade, dash = '8 5' }: { shape: MadeShape; im: ViewRect; stroke: string; fill: string; shade: 'outside' | 'inside' | null; dash?: string }) {
  const t = textStrokes(shape, im);
  const id = useMemo(() => `ab-text-${Math.random().toString(36).slice(2, 8)}`, []);
  if (t) {
    return (
      <g data-text-strokes={shape.text}>
        {shade && <>
          <defs>
            <mask id={id} maskUnits="userSpaceOnUse" x={im.x} y={im.y} width={im.w} height={im.h}>
              <rect x={im.x} y={im.y} width={im.w} height={im.h} fill={shade === 'outside' ? '#fff' : '#000'} />
              <path d={t.d} fill="none" stroke={shade === 'outside' ? '#000' : '#fff'} strokeWidth={t.width} strokeLinecap="round" strokeLinejoin="round" />
            </mask>
          </defs>
          <rect x={im.x} y={im.y} width={im.w} height={im.h} fill="rgba(8,8,12,0.55)" mask={`url(#${id})`} />
        </>}
        <path d={t.d} fill="none" stroke={fill === 'none' ? 'rgba(91,140,255,0.22)' : fill} strokeWidth={t.width} strokeLinecap="round" strokeLinejoin="round" />
        <path d={t.d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} opacity={0.9} />
      </g>
    );
  }
  const path = shapePath(shape, im);
  const outside = `M ${im.x} ${im.y} h ${im.w} v ${im.h} h ${-im.w} Z`;
  return <>
    {shade && <path d={shade === 'outside' ? `${outside} ${path}` : path} fill="rgba(8,8,12,0.55)" fillRule="evenodd" />}
    <path d={path} fill={fill} fillRule="evenodd" stroke={stroke} strokeWidth={2.5} strokeDasharray={dash} />
  </>;
}

/** A shape's outline as an SVG path on the shown picture (every part a closed loop: even-odd fills it). */
export function shapePath(s: MadeShape, im: ViewRect): string {
  const v = (x: number, y: number) => picToView(im, { x, y });
  const k = im.h / 2;
  const circle = (r: number) => { const c = v(s.x, s.y), R = Math.max(1, r * k); return `M ${c.x - R} ${c.y} a ${R} ${R} 0 1 0 ${2 * R} 0 a ${R} ${R} 0 1 0 ${-2 * R} 0 Z`; };
  const rect = (x0: number, y0: number, x1: number, y1: number) => { const a = v(x0, y1), b = v(x1, y0); return `M ${a.x} ${a.y} H ${b.x} V ${b.y} H ${a.x} Z`; };
  switch (s.shape) {
    case 'circle': return circle(s.size);
    case 'ring': { const t = s.thickness ?? 0.05; return `${circle(s.size + t)} ${circle(Math.max(0, s.size - t))}`; }
    case 'box': return rect(s.x - s.size, s.y - (s.h ?? s.size), s.x + s.size, s.y + (s.h ?? s.size));
    case 'polygon': return (s.points ?? []).map((p, i) => { const q = v(p[0], p[1]); return `${i ? 'L' : 'M'} ${q.x} ${q.y}`; }).join(' ') + ' Z';
    case 'text': return textBoxes(s.text ?? 'A').map(b => rect(s.x + (b.x - b.hx) * s.size, s.y + (b.y - b.hy) * s.size, s.x + (b.x + b.hx) * s.size, s.y + (b.y + b.hy) * s.size)).join(' ');
  }
}

/** The handles a shape has: id, where (picture units). */
function handlesOf(s: MadeShape): Array<{ id: string; at: P; kind: 'move' | 'size' | 'corner' | 'add' | 'thick' }> {
  const out: Array<{ id: string; at: P; kind: 'move' | 'size' | 'corner' | 'add' | 'thick' }> = [{ id: 'move', at: { x: s.x, y: s.y }, kind: 'move' }];
  if (s.shape === 'circle' || s.shape === 'ring') out.push({ id: 'size', at: { x: s.x + s.size, y: s.y }, kind: 'size' });
  if (s.shape === 'ring') out.push({ id: 'thick', at: { x: s.x - s.size - (s.thickness ?? 0.05), y: s.y }, kind: 'thick' });
  if (s.shape === 'box') out.push({ id: 'size', at: { x: s.x + s.size, y: s.y + (s.h ?? s.size) }, kind: 'size' });
  if (s.shape === 'text') out.push({ id: 'size', at: { x: s.x + textHalfWidth(s), y: s.y + s.size }, kind: 'size' });
  if (s.shape === 'polygon') {
    const pts = s.points ?? [];
    pts.forEach((p, i) => out.push({ id: `p${i}`, at: { x: p[0], y: p[1] }, kind: 'corner' }));
    if (pts.length < 8) pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; out.push({ id: `a${i}`, at: { x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 }, kind: 'add' }); });
  }
  return out;
}

/** A shape dragged by one of its handles to `to` (picture units), from where it was (`from`) at the press. */
function dragged(s: MadeShape, handle: string, from: P, to: P, start: MadeShape): MadeShape {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (handle === 'move') return { ...start, x: r4(start.x + dx), y: r4(start.y + dy), ...(start.points ? { points: start.points.map(p => [r4(p[0] + dx), r4(p[1] + dy)] as [number, number]) } : {}) };
  if (handle === 'size') {
    if (s.shape === 'box') return { ...s, size: r4(Math.max(0.01, Math.abs(to.x - s.x))), h: r4(Math.max(0.01, Math.abs(to.y - s.y))) };
    if (s.shape === 'text') return { ...s, size: r4(Math.max(0.02, Math.abs(to.y - s.y))) };
    return { ...s, size: r4(Math.max(0.01, Math.hypot(to.x - s.x, to.y - s.y))) };
  }
  if (handle === 'thick') return { ...s, thickness: r4(Math.max(0.005, Math.abs(Math.hypot(to.x - s.x, to.y - s.y) - s.size))) };
  if (handle.startsWith('p')) {
    const i = Number(handle.slice(1));
    return { ...s, points: (s.points ?? []).map((p, k) => (k === i ? [r4(to.x), r4(to.y)] as [number, number] : p)) };
  }
  return s;
}

export function RegionOverlay({ shown, drawing, box, readOnly = false, onClose }: {
  shown: WhereShown | null; drawing: WhereDrawing | null;
  box: { w: number; h: number; image: ViewRect };
  readOnly?: boolean;
  /** Stop showing it (the Done pill; Esc does the same). */
  onClose?: () => void;
}) {
  const tk = useTokens();
  if (drawing) return <DrawLayer drawing={drawing} box={box} />;
  if (!shown?.region) return null;
  return <>
    <ShownRegion shown={shown} box={box} readOnly={readOnly} />
    {onClose && (
      <button type="button" data-where-done onClick={onClose} title="Stop showing the region (Esc)"
        style={{ position: 'absolute', right: 12, top: 12, height: 26, padding: '0 12px', border: 0, borderRadius: 13, background: 'rgba(13,13,18,0.82)', color: '#fff', cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}`, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
        Done
      </button>
    )}
  </>;
}

/**
 * A slope layer's arrows (Follow a field): the field wired into the group's Field ƒ, evaluated on
 * the GPU at the picture's points (lib/regionValues.ts), its slope at a grid of points: downhill
 * (uphill when flipped), or round its contour lines.
 */
export function SlopeArrows({ groupId, box, flip, around }: { groupId: string; box: { w: number; h: number; image: ViewRect }; flip: boolean; around: boolean }) {
  const im = box.image;
  const src = useNodeGraphStore(s => { const c = s.nodes.find(x => x.id === groupId)?.inputs.field?.connection; return c ? `${c.nodeId}|${c.outputKey}` : ''; });
  const nodeKey = useNodeGraphStore(s => { const id = src.split('|')[0]; const nd = id ? s.nodes.find(x => x.id === id) : undefined; return nd ? JSON.stringify(nd.params) : ''; });
  const [arrows, setArrows] = useState<ReturnType<typeof slopeArrows>>([]);
  const aspect = im.w / Math.max(im.h, 1);
  useEffect(() => {
    if (!src) { setArrows([]); return; }
    const [nodeId, outputKey] = src.split('|');
    let alive = true;
    const h = 90, w = Math.max(8, Math.round(h * aspect));
    const t = setTimeout(() => {
      regionField(useNodeGraphStore.getState().nodes, nodeId, outputKey, w, h).then(f => { if (alive) setArrows(f ? slopeArrows(f, aspect, 18) : []); }, () => {});
    }, 80);
    return () => { alive = false; clearTimeout(t); };
  }, [src, nodeKey, Math.round(aspect * 100)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!src) return null;
  const L = (im.w / 18) * 0.42;
  return (
    <svg data-slope-arrows={arrows.length} width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {arrows.map((a, i) => {
        let dx = a.dx, dy = a.dy;
        if (flip) { dx = -dx; dy = -dy; }
        if (around) { const t = dx; dx = -dy; dy = t; }
        const p = picToView(im, { x: a.x, y: a.y });
        const len = L * (0.35 + 0.65 * a.k);
        const q = { x: p.x + dx * len, y: p.y - dy * len };
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        const hd = 4.5;
        return a.k > 0.02 ? (
          <g key={i} opacity={0.35 + 0.6 * a.k}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#7ee0ff" strokeWidth={1.6} />
            <path d={`M ${q.x} ${q.y} L ${q.x - hd * Math.cos(ang - 0.5)} ${q.y - hd * Math.sin(ang - 0.5)} M ${q.x} ${q.y} L ${q.x - hd * Math.cos(ang + 0.5)} ${q.y - hd * Math.sin(ang + 0.5)}`} stroke="#7ee0ff" strokeWidth={1.6} />
          </g>
        ) : null;
      })}
      <Badge x={im.x + im.w / 2} y={im.y + im.h - 18} text={`the slope of the graph's field (Field ƒ)${around ? ', round its contours' : flip ? ', uphill' : ', downhill'}`} />
    </svg>
  );
}

function Badge({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.min(360, 14 + text.length * 6.4);
  return (
    <g data-where-badge pointerEvents="none">
      <rect x={x - w / 2} y={y - 11} width={w} height={22} rx={11} fill="rgba(13,13,18,0.82)" stroke="rgba(255,255,255,0.25)" />
      <text x={x} y={y + 4} textAnchor="middle" fill="#fff" style={{ font: `600 11.5px ${fontFamily.ui}` }}>{text}</text>
    </g>
  );
}

function ShownRegion({ shown, box, readOnly }: { shown: WhereShown; box: { w: number; h: number; image: ViewRect }; readOnly: boolean }) {
  const tk = useTokens();
  const r = shown.region!;
  const im = box.image;
  // A made shape: read live from its node, so undo and the sliders move it too.
  const liveKey = useNodeGraphStore(s => (r.made ? JSON.stringify(readMadeShape(s.nodes.find(x => x.id === r.nodeId))) : 'null'));
  const live = useMemo(() => JSON.parse(liveKey) as MadeShape | null, [liveKey]);
  const [drag, setDrag] = useState<{ handle: string; from: P; start: MadeShape; now: MadeShape } | null>(null);
  const sent = useRef(0);
  const shape = drag?.now ?? live;
  const svgRef = useRef<SVGSVGElement>(null);
  const toPic = (e: { clientX: number; clientY: number }) => {
    const b = svgRef.current?.getBoundingClientRect();
    return viewToPic(im, { x: e.clientX - (b?.left ?? 0), y: e.clientY - (b?.top ?? 0) });
  };
  const verb = shown.use === 'obstacle' ? (shown.outside ? 'walls outside' : 'a wall') : shown.use === 'born' ? (shown.outside ? 'born outside' : 'born inside') : shown.use === 'slope' ? 'the field followed' : shown.use === 'food' ? (shown.outside ? 'food outside' : 'food') : (shown.outside ? 'acts outside' : 'acts inside');
  const label = `${verb} · ${r.label}`;
  if (shape) {
    const shade = shown.use === 'slope' ? null : shown.outside ? 'inside' as const : 'outside' as const;
    const top = picToView(im, { x: shape.x, y: shape.y + (shape.shape === 'box' ? shape.h ?? shape.size : shape.size) });
    const handles = readOnly ? [] : handlesOf(shape);
    const down = (id: string) => (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      if (id.startsWith('a')) {
        // A corner added on that side's middle (a new outline: its own undo step).
        const i = Number(id.slice(1)), pts = (shape.points ?? []).slice();
        const p = pts[i], q = pts[(i + 1) % pts.length];
        pts.splice(i + 1, 0, [r4((p[0] + q[0]) / 2), r4((p[1] + q[1]) / 2)]);
        setMadeShape(r.nodeId, { ...shape, points: pts });
        return;
      }
      const from = toPic(e);
      setDrag({ handle: id, from, start: shape, now: shape });
    };
    const move = (e: React.PointerEvent) => {
      if (!drag) return;
      const now = dragged(drag.now, drag.handle, drag.from, toPic(e), drag.start);
      setDrag({ ...drag, now });
      const t = performance.now();
      if (t - sent.current > 50) { sent.current = t; setMadeShape(r.nodeId, now); }
    };
    const up = () => { if (drag) setMadeShape(r.nodeId, drag.now); setDrag(null); };
    return (
      <svg ref={svgRef} data-region-overlay="made" data-region-shape={shape.shape} data-region-x={shape.x} data-region-y={shape.y} data-region-size={shape.size}
        width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} onPointerMove={move} onPointerUp={up}>
        <ShapeDrawing shape={shape} im={im} shade={shade} stroke={tk.accent.base}
          fill={shown.use === 'obstacle' && !shown.outside ? 'rgba(255,120,90,0.32)' : shown.use === 'food' && !shown.outside ? 'rgba(255,210,122,0.3)' : 'none'} />
        {handles.map(hd => {
          const p = picToView(im, hd.at);
          const big = hd.kind === 'move';
          return (
            <g key={hd.id} data-where-handle={hd.id} style={{ pointerEvents: 'all', cursor: drag?.handle === hd.id ? 'grabbing' : big ? 'move' : hd.kind === 'add' ? 'copy' : 'nwse-resize' }} onPointerDown={down(hd.id)}>
              <title>{big ? 'Drag to move it' : hd.kind === 'add' ? 'Add a corner here' : hd.kind === 'corner' ? 'Drag this corner' : hd.kind === 'thick' ? 'Drag for its width' : 'Drag to size it'}</title>
              <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
              {hd.kind === 'add'
                ? <><circle cx={p.x} cy={p.y} r={5.5} fill="rgba(13,13,18,0.85)" stroke="#fff" strokeWidth={1.2} /><path d={`M ${p.x - 3} ${p.y} h 6 M ${p.x} ${p.y - 3} v 6`} stroke="#fff" strokeWidth={1.3} /></>
                : <circle cx={p.x} cy={p.y} r={big ? 7 : 6} fill={big ? tk.accent.base : '#fff'} stroke={big ? '#fff' : tk.accent.base} strokeWidth={2} />}
            </g>
          );
        })}
        <Badge x={top.x} y={Math.max(im.y + 16, top.y - 22)} text={label} />
      </svg>
    );
  }
  return <GraphRegion shown={shown} box={box} label={label} />;
}

/** A region of the graph: shaded from its values (a texture can't be: it says so). */
function GraphRegion({ shown, box, label }: { shown: WhereShown; box: { w: number; h: number; image: ViewRect }; label: string }) {
  const r = shown.region!;
  const im = box.image;
  const nodeKey = useNodeGraphStore(s => { const nd = s.nodes.find(x => x.id === r.nodeId); return nd ? JSON.stringify(nd.params) : ''; });
  const [url, setUrl] = useState('');
  const [segs, setSegs] = useState<Array<[number, number, number, number]>>([]);
  const edge = segs.map(([x0, y0, x1, y1]) => `M ${(im.x + x0 * im.w).toFixed(1)} ${(im.y + y0 * im.h).toFixed(1)} L ${(im.x + x1 * im.w).toFixed(1)} ${(im.y + y1 * im.h).toFixed(1)}`).join(' ');
  useEffect(() => {
    setUrl('');
    setSegs([]);
    if (r.kind !== 'shape' && r.kind !== 'mask') return;
    let alive = true;
    const aspect = im.w / Math.max(im.h, 1);
    const h = 216, w = Math.max(8, Math.round(h * aspect));
    const t = setTimeout(() => {
      regionField(useNodeGraphStore.getState().nodes, r.nodeId, r.outputKey, w, h).then(f => {
        if (!alive || !f) return;
        setUrl(regionImage(f, r.kind as 'shape' | 'mask', 'shade', { outside: shown.use === 'obstacle' ? !shown.outside : shown.outside }));
        setSegs(regionEdge(f, r.kind as 'shape' | 'mask'));
      }, () => {});
    }, 80);
    return () => { alive = false; clearTimeout(t); };
  }, [r.nodeId, r.outputKey, r.kind, shown.outside, shown.use, nodeKey, Math.round(im.w / Math.max(im.h, 1) * 100)]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = r.kind === 'texture' ? `${label} (inside where it is bright)` : r.kind === 'scene' ? `${label} (3D: they flow round it)` : label;
  return (
    <svg data-region-overlay="graph" data-region-kind={r.kind} data-region-shaded={url ? 'yes' : 'no'} width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {url && <image href={url} x={im.x} y={im.y} width={im.w} height={im.h} preserveAspectRatio="none" style={{ imageRendering: 'auto' }} />}
      <defs><clipPath id="ab-region-clip"><rect x={im.x} y={im.y} width={im.w} height={im.h} /></clipPath></defs>
      {edge && <path data-region-edge d={edge} clipPath="url(#ab-region-clip)" fill="none" stroke="#5b8cff" strokeWidth={2.2} strokeLinecap="round" />}
      <Badge x={im.x + im.w / 2} y={im.y + 20} text={words} />
    </svg>
  );
}

/** Drawing a new shape: drag on the picture (a polygon: click its corners). */
function DrawLayer({ drawing, box }: { drawing: WhereDrawing; box: { w: number; h: number; image: ViewRect } }) {
  const tk = useTokens();
  const im = box.image;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: P; b: P } | null>(null);
  const [pts, setPts] = useState<P[]>([]);
  const [hover, setHover] = useState<P | null>(null);
  const at = (e: { clientX: number; clientY: number }) => {
    const b = ref.current?.getBoundingClientRect();
    return viewToPic(im, { x: e.clientX - (b?.left ?? 0), y: e.clientY - (b?.top ?? 0) });
  };
  const finishPoly = (list: P[]) => {
    if (list.length < 3) return;
    const cx = list.reduce((s, p) => s + p.x, 0) / list.length, cy = list.reduce((s, p) => s + p.y, 0) / list.length;
    drawing.onDone({ shape: 'polygon', x: r4(cx), y: r4(cy), size: 0.3, points: list.slice(0, 8).map(p => [p.x, p.y]) });
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); drawing.onCancel(); }
      if (e.key === 'Enter' && drawing.kind === 'polygon') finishPoly(pts);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
  const shapeOf = (a: P, b: P): MadeShape => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 0.02) return newMadeShape(drawing.kind, a.x, a.y, 0.3);
    switch (drawing.kind) {
      case 'circle': return { shape: 'circle', x: a.x, y: a.y, size: r4(d) };
      case 'ring': return { shape: 'ring', x: a.x, y: a.y, size: r4(d), thickness: r4(Math.max(0.01, d * 0.15)) };
      case 'box': return { shape: 'box', x: r4((a.x + b.x) / 2), y: r4((a.y + b.y) / 2), size: r4(Math.max(0.01, Math.abs(b.x - a.x) / 2)), h: r4(Math.max(0.01, Math.abs(b.y - a.y) / 2)) };
      case 'text': {
        // The words fit the box dragged: as tall as it, unless that makes them wider than it.
        const t = newMadeShape('text');
        const perUnit = textHalfWidth({ ...t, size: 1 });
        return { ...t, x: r4((a.x + b.x) / 2), y: r4((a.y + b.y) / 2), size: r4(Math.max(0.03, Math.min(Math.abs(b.y - a.y) / 2, Math.abs(b.x - a.x) / 2 / Math.max(perUnit, 1e-3)))) };
      }
      default: return newMadeShape(drawing.kind, a.x, a.y, 0.3);
    }
  };
  const preview = drawing.kind === 'polygon'
    ? (pts.length ? [...pts, ...(hover ? [hover] : [])].map((p, i) => { const q = picToView(im, p); return `${i ? 'L' : 'M'} ${q.x} ${q.y}`; }).join(' ') : '')
    : '';
  const previewShape = drawing.kind !== 'polygon' && drag ? shapeOf(drag.a, drag.b) : null;
  return (
    <div ref={ref} data-where-draw={drawing.kind} style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={e => {
        e.preventDefault();
        const p = at(e);
        if (drawing.kind === 'polygon') {
          const first = pts[0] && picToView(im, pts[0]), q = picToView(im, p);
          if (pts.length >= 3 && first && Math.hypot(first.x - q.x, first.y - q.y) < 12) { finishPoly(pts); return; }
          setPts(v => [...v, p]);
          return;
        }
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        setDrag({ a: p, b: p });
      }}
      onPointerMove={e => { const p = at(e); if (drag) setDrag({ ...drag, b: p }); else setHover(p); }}
      onPointerUp={() => { if (drag) { drawing.onDone(shapeOf(drag.a, drag.b)); setDrag(null); } }}
      onDoubleClick={() => { if (drawing.kind === 'polygon') finishPoly(pts); }}>
      <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <rect x={im.x} y={im.y} width={im.w} height={im.h} fill="rgba(8,8,12,0.25)" />
        {preview && <path d={preview} fill={alphaFill} fillRule="evenodd" stroke={tk.accent.base} strokeWidth={2.5} strokeDasharray="8 5" />}
        {previewShape && <ShapeDrawing shape={previewShape} im={im} shade={null} fill={alphaFill} stroke={tk.accent.base} />}
        {pts.map((p, i) => { const q = picToView(im, p); return <circle key={i} cx={q.x} cy={q.y} r={i === 0 && pts.length >= 3 ? 8 : 5} fill={i === 0 ? tk.accent.base : '#fff'} stroke={tk.accent.base} strokeWidth={2} />; })}
        <Badge x={im.x + im.w / 2} y={im.y + 20} text={drawing.kind === 'polygon' ? 'Click its corners · the first again (or Enter) closes it' : `Drag to draw the ${drawing.kind} · Esc stops`} />
      </svg>
    </div>
  );
}
const alphaFill = 'rgba(91,140,255,0.18)';
