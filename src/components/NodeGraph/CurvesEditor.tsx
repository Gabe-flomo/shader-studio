/**
 * The Curves card's editor (nodes/definitions/curves.ts, docs/curves.md): a square graph with a faint
 * grid and the diagonal, channel tabs (Master, Red, Green, Blue, Alpha), and the curve's points.
 *
 *  - drag a point to move it (it stays between its neighbours);
 *  - click on the curve to add a point there (up to MAX_CURVE_POINTS), and keep dragging it;
 *  - drag a point out of the box, right-click it or double-click it to remove it (a curve keeps two);
 *  - Linear joins the points with straight lines; Reset curve makes it the diagonal again;
 *  - Presets set every curve at once; Open ↗ shows the same editor large.
 *
 * A drag draws straight onto the canvas and writes the curve's points at most once a frame through
 * updateNodeParams(…, { immediate: true }): every point is a live vec3 uniform, so that is a uniform
 * write and the picture follows with no recompile. Adding or removing a point recompiles (a new uniform).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import {
  CURVE_CHANNELS, CURVES_PRESETS, MAX_CURVE_POINTS, IDENTITY_CURVE, bakeCurveLut, curveIsLinear, curvePatch, curvePointCount,
  curvePoints, curvesPresetParams, type CurveChannel, type CurvePoint,
} from '../../nodes/definitions/curves';
import { getVizScale } from './vizKit';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';

const PAD = 6;           // room round the 0–1 box for points on the edge
const HIT = 10;          // how near (CSS px) a press must be to grab a point
const ADD_NEAR = 14;     // how near the curve a press must be to add a point
const REMOVE_OUT = 22;   // how far out of the box a dragged point is removed

type Drag = { idx: number; pts: CurvePoint[]; out: boolean; oldCount: number };

function CurveGraph({ node, channel, size }: { node: GraphNode; channel: CurveChannel; size: number }) {
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const raf = useRef(0);
  const P = node.params;
  const linear = curveIsLinear(P, channel);
  const colourOf = (c: CurveChannel) => CURVE_CHANNELS.find(x => x.key === c)!.colour;

  const draw = useCallback((livePts?: CurvePoint[], out = false, dragIdx = -1) => {
    const c = ref.current;
    if (!c) return;
    const k = (window.devicePixelRatio || 1) * getVizScale();
    if (c.width !== Math.round(size * k)) { c.width = Math.round(size * k); c.height = Math.round(size * k); }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(k, 0, 0, k, 0, 0);
    const w = size - PAD * 2;
    const X = (x: number) => PAD + x * w, Y = (y: number) => PAD + (1 - y) * w;
    g.clearRect(0, 0, size, size);
    g.fillStyle = '#121218';
    g.fillRect(PAD, PAD, w, w);
    // Grid in quarters, and the diagonal (no change)
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo(X(i / 4), Y(0)); g.lineTo(X(i / 4), Y(1)); g.stroke();
      g.beginPath(); g.moveTo(X(0), Y(i / 4)); g.lineTo(X(1), Y(i / 4)); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(1), Y(1)); g.stroke(); g.setLineDash([]);
    const curve = (pts: CurvePoint[], lin: boolean, colour: string, width: number, alpha: number) => {
      const lut = bakeCurveLut(pts, lin, Math.max(64, Math.round(w)));
      g.globalAlpha = alpha; g.strokeStyle = colour; g.lineWidth = width;
      g.beginPath();
      lut.forEach((y, i) => { const px = X(i / (lut.length - 1)), py = Y(Math.max(-0.02, Math.min(1.02, y))); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke(); g.globalAlpha = 1;
    };
    // The other channels' curves, faint, where they are not the diagonal
    for (const { key } of CURVE_CHANNELS) {
      if (key === channel) continue;
      const pts = curvePoints(P, key);
      const isId = pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;
      if (!isId) curve(pts, curveIsLinear(P, key), colourOf(key), 1, 0.35);
    }
    const pts = livePts ?? curvePoints(P, channel);
    const shown = out && dragIdx >= 0 ? pts.filter((_, i) => i !== dragIdx) : pts;
    curve(shown, linear, colourOf(channel), 1.75, 1);
    pts.forEach(([x, y], i) => {
      const gone = out && i === dragIdx;
      g.beginPath(); g.arc(X(x), Y(y), i === dragIdx ? 4.5 : 3.5, 0, Math.PI * 2);
      g.fillStyle = gone ? 'rgba(255,255,255,0.15)' : i === dragIdx ? '#ffffff' : '#121218';
      g.fill(); g.lineWidth = 1.5; g.strokeStyle = gone ? 'rgba(255,255,255,0.3)' : colourOf(channel); g.stroke();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [P, channel, size, linear]);

  // Store changes (undo, a preset, another editor) redraw; a drag draws itself
  useEffect(() => { if (!drag.current) draw(); }, [draw]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const s = r.width / size; // the canvas may be zoomed with the graph
    const w = size - PAD * 2;
    const cx = (e.clientX - r.left) / s, cy = (e.clientY - r.top) / s;
    return { x: (cx - PAD) / w, y: 1 - (cy - PAD) / w, cx, cy, w };
  };
  const nearest = (pts: CurvePoint[], cx: number, cy: number, w: number) => {
    let best = -1, bd = HIT;
    pts.forEach(([x, y], i) => { const d = Math.hypot(PAD + x * w - cx, PAD + (1 - y) * w - cy); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const write = (pts: CurvePoint[], oldCount: number) => update(node.id, curvePatch(channel, pts, linear, oldCount), { immediate: true });
  const removeAt = (idx: number) => {
    const pts = curvePoints(P, channel);
    if (pts.length <= 2 || idx < 0) return;
    write(pts.filter((_, i) => i !== idx), curvePointCount(P, channel));
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const { x, y, cx, cy, w } = local(e);
    let pts = curvePoints(P, channel);
    const oldCount = curvePointCount(P, channel);
    let idx = nearest(pts, cx, cy, w);
    if (idx < 0) {
      // A press on the curve adds a point there
      if (x <= 0 || x >= 1 || pts.length >= MAX_CURVE_POINTS) return;
      const lut = bakeCurveLut(pts, linear, 512);
      const onCurve = lut[Math.round(x * 511)];
      if (Math.abs((onCurve - y) * w) > ADD_NEAR) return;
      pts = [...pts, [x, onCurve] as CurvePoint].sort((a, b) => a[0] - b[0]);
      idx = pts.findIndex(q => q[0] === x);
      write(pts, oldCount); // a new point: one recompile
    }
    drag.current = { idx, pts: pts.map(q => [...q] as CurvePoint), out: false, oldCount: Math.max(oldCount, pts.length) };
    e.currentTarget.setPointerCapture(e.pointerId);
    draw(drag.current.pts, false, idx);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const { x, y, cx, cy, w } = local(e);
    const pts = d.pts;
    const lo = d.idx > 0 ? pts[d.idx - 1][0] + 0.002 : 0;
    const hi = d.idx < pts.length - 1 ? pts[d.idx + 1][0] - 0.002 : 1;
    d.out = pts.length > 2 && (cx < PAD - REMOVE_OUT || cx > PAD + w + REMOVE_OUT || cy < PAD - REMOVE_OUT || cy > PAD + w + REMOVE_OUT);
    pts[d.idx] = [Math.max(lo, Math.min(hi, x)), Math.max(0, Math.min(1, y))];
    draw(pts, d.out, d.idx);
    if (d.out) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => write(pts, d.oldCount));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(raf.current);
    if (!d) return;
    if (d.out) write(d.pts.filter((_, i) => i !== d.idx), d.oldCount);
    else write(d.pts, d.oldCount);
  };
  const onContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy, w } = local(e);
    const idx = nearest(curvePoints(P, channel), cx, cy, w);
    if (idx < 0) return; // not on a point: the card's own menu
    e.preventDefault(); e.stopPropagation();
    removeAt(idx);
  };
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const { cx, cy, w } = local(e);
    removeAt(nearest(curvePoints(P, channel), cx, cy, w));
  };

  return (
    <canvas ref={ref} data-curves-graph={channel} width={size} height={size}
      style={{ width: size, height: size, display: 'block', cursor: 'crosshair', touchAction: 'none' }}
      title="Drag a point to move it. Click the curve to add one. Drag a point out, right-click or double-click it to remove it."
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onMouseDown={e => e.stopPropagation()} onContextMenu={onContext} onDoubleClick={onDouble} />
  );
}

/** Channel tabs, the graph, Linear / Reset curve, and Presets. */
export function CurvesEditor({ node, size, onOpen }: { node: GraphNode; size: number; onOpen?: () => void }) {
  const tk = useTokens();
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const [channel, setChannel] = useState<CurveChannel>('m');
  const P = node.params;
  const linear = curveIsLinear(P, channel);
  const small = size < 300;
  const chip = (on: boolean, colour?: string): React.CSSProperties => ({
    padding: small ? '2px 7px' : '4px 10px', borderRadius: radius.sm, border: 0, cursor: 'pointer',
    background: on ? tk.bg.selected : tk.bg.field, color: on ? (colour ? tk.text.primary : tk.accent.text) : tk.text.muted,
    font: `600 ${small ? 10 : 11.5}px ${fontFamily.ui}`, boxShadow: on && colour ? `inset 0 -2px 0 ${colour}` : undefined,
  });
  const reset = () => update(node.id, curvePatch(channel, IDENTITY_CURVE, false, curvePointCount(P, channel)), { immediate: true });
  const applyPreset = (v: string) => {
    const next = curvesPresetParams(v);
    if (!next) return;
    // Clear points the preset's curves don't have
    for (const { key } of CURVE_CHANNELS) {
      const have = curvePointCount(P, key);
      for (let i = 0; i < have; i++) if (!(`c${key}${i}` in next)) next[`c${key}${i}`] = undefined;
    }
    update(node.id, next, { immediate: true });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'stretch' }} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {CURVE_CHANNELS.map(c => (
          <button key={c.key} type="button" aria-pressed={c.key === channel} style={chip(c.key === channel, c.colour)}
            title={c.key === 'm' ? 'Master: all three colours, before each one\'s own curve' : `${c.label}: this channel only, after Master`}
            onClick={() => setChannel(c.key)}>{c.label}</button>
        ))}
      </div>
      <div style={{ alignSelf: 'center' }}><CurveGraph node={node} channel={channel} size={size} /></div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button type="button" aria-pressed={linear} style={chip(linear)} title="Join this curve's points with straight lines instead of a smooth curve"
          onClick={() => {
            const pts = curvePoints(P, channel);
            update(node.id, curvePatch(channel, pts, !linear, curvePointCount(P, channel)), { immediate: true });
          }}>Linear</button>
        <button type="button" style={chip(false)} title="Make this curve the straight diagonal again (no change)" onClick={reset}>Reset curve</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Select ariaLabel="Curves presets" value="" height={small ? 22 : 28}
            options={[{ value: '', label: 'Presets…' }, ...CURVES_PRESETS.map(pr => ({ value: pr.value, label: pr.label }))]}
            onChange={applyPreset} />
        </div>
        {onOpen && (
          <button type="button" style={{ ...chip(false), color: tk.text.primary, whiteSpace: 'nowrap' }} title="Open a bigger editor" onClick={onOpen}>Open ↗</button>
        )}
      </div>
    </div>
  );
}

/** On the card: the editor at card size, and the big window it opens. */
export function CurvesCardViz({ node }: { node: GraphNode }) {
  const [open, setOpen] = useState(false);
  const live = useNodeGraphStore(s => s.nodes.find(n => n.id === node.id)) ?? node;
  return (
    <div style={{ padding: '6px 10px 8px' }}>
      <CurvesEditor node={live} size={220} onOpen={() => setOpen(true)} />
      {open && createPortal(<CurvesWindow nodeId={node.id} fallback={live} onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}

function CurvesWindow({ nodeId, fallback, onClose }: { nodeId: string; fallback: GraphNode; onClose: () => void }) {
  const node = useNodeGraphStore(s => s.nodes.find(n => n.id === nodeId)) ?? fallback;
  return (
    <Modal title="Curves" subtitle="Drag points to reshape the tones · Master first, then each channel" icon="curve" width={520} onClose={onClose}
      headerActions={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 440 }}><CurvesEditor node={node} size={440} /></div>
      </div>
    </Modal>
  );
}
