/**
 * The preview Overlay: a labelled grid of a chosen space's real values (Grid), a marker where a
 * chosen point lies in that space (Position), an SDF's boundary, box, centre and radius measured in
 * its space (Shape, with the value under the pointer) and click-to-measure lengths and angles
 * (Distance), drawn on a 2D canvas over the picture. Purely DOM:
 * never part of the render or an export. ShaderCanvas reads the values (lib/previewOverlay/
 * overlayRunner.ts) onto overlayBus; this draws them in a rAF, React only for the menu.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { getNodeDefinition } from '../nodes/definitions';
import { useTokens } from '../theme/themeStore';
import { fontFamily } from '../theme/tokens';
import { IconButton } from './ui/Button';
import { Popover } from './ui/Popover';
import { Segmented, Toggle } from './ui/Choice';
import { Select, type SelectOption } from './ui/Select';
import { overlayBus, type OverlayFrame } from '../lib/previewOverlay/overlayBus';
import { blendFields, declutter, edgeLabels, edgePoint, gridLines, locateValue, sampleBilinear, type Field2 } from '../lib/previewOverlay/overlayMath';
import { overlayKey, parseRef, refKey, useOverlay, type OverlayMode, type SocketRef } from '../lib/previewOverlay/overlayStore';
import { sdfOutputs, vec2Outputs } from '../lib/previewOverlay/overlayRunner';
import {
  fromOrigin, measurePair, primitiveBox, primitiveFor, rectOutline, sampleScalar, sdfInputSpace, shapeStats,
  type Box, type PrimitiveInfo, type ShapeStats,
} from '../lib/previewOverlay/shapeMath';

const FONT = '10.5px ui-monospace, SFMono-Regular, Menlo, monospace';

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.replace('-', '−');
};

function nodeName(n: GraphNode): string {
  const own = typeof n.params.label === 'string' ? n.params.label.trim() : '';
  return own || getNodeDefinition(n.type)?.label || n.type;
}

/** Text with a dark halo, legible on any picture. */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function findNode(nodes: readonly GraphNode[], id: string): GraphNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    const f = sg?.nodes ? findNode(sg.nodes, id) : undefined;
    if (f) return f;
  }
  return undefined;
}

/** The pointer over the picture and the Distance clicks, as screen points (u, v in 0…1, v up). */
export interface OverlayPointer { hover: [number, number] | null; points: Array<[number, number]> }

/** Shape measurements per frame read (the drawing runs on every pointer move; this doesn't). */
const shapeCache = new WeakMap<OverlayFrame, { stats: ShapeStats; prim: PrimitiveInfo | null; box: Box | null; exact: boolean; outline: Array<Array<[number, number]>> }>();

function shapeOf(frame: OverlayFrame, field: Field2, sdf: Float32Array, sdfRef: SocketRef | null, space: SocketRef | null) {
  const hit = shapeCache.get(frame);
  if (hit) return hit;
  const stats = shapeStats(field, { data: sdf, w: field.w, h: field.h });
  const node = sdfRef ? findNode(useNodeGraphStore.getState().nodes, sdfRef.nodeId) : undefined;
  const prim = primitiveFor(node, space);
  const exactBox = primitiveBox(prim);
  const box = exactBox ?? stats.box;
  const out = { stats, prim, box, exact: !!exactBox, outline: box ? rectOutline(field, box) : [] };
  shapeCache.set(frame, out);
  return out;
}

function marker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r = 4) {
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = color; ctx.fill();
}

/** A label beside a point, kept inside the picture. */
function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, cw: number, ch: number, fill = '#fff', dx = 10, dy = -12) {
  const w = ctx.measureText(text).width;
  let tx = x + dx;
  if (dx >= 0 ? tx + w > cw - 4 : tx - w < 4) { dx = -dx; tx = x + dx; }
  ctx.textAlign = dx >= 0 ? 'left' : 'right'; ctx.textBaseline = 'middle';
  haloText(ctx, text, tx, Math.max(9, Math.min(ch - 9, y + dy)), fill);
}

function polyline(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, X: (u: number) => number, Y: (v: number) => number) {
  ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
  for (let k = 1; k < pts.length; k++) ctx.lineTo(X(pts[k][0]), Y(pts[k][1]));
}

function drawShape(ctx: CanvasRenderingContext2D, frame: OverlayFrame, field: Field2, cw: number, ch: number, accent: string, ptr: OverlayPointer) {
  const st = useOverlay.getState();
  const X = (u: number) => u * cw, Y = (v: number) => (1 - v) * ch;
  const note = (t: string, row = 0) => { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; haloText(ctx, t, 10, 10 + row * 15, 'rgba(255,255,255,0.92)'); };
  if (!frame.sdf) { note('Reading…'); return; }
  const { stats, prim, box, exact, outline } = shapeOf(frame, field, frame.sdf, st.sdf, st.space);

  // The boundary (d = 0)
  for (const pass of [0, 1]) {
    ctx.beginPath();
    for (let k = 0; k < stats.segs.length; k += 4) { ctx.moveTo(X(stats.segs[k]), Y(stats.segs[k + 1])); ctx.lineTo(X(stats.segs[k + 2]), Y(stats.segs[k + 3])); }
    ctx.strokeStyle = pass ? accent : 'rgba(0,0,0,0.55)'; ctx.lineWidth = pass ? 2 : 4.5; ctx.stroke();
  }
  note(`${prim?.name ?? 'Shape'}: ${exact ? 'its own params' : 'measured from the picture'}`);
  if (!box) { note('Nothing inside (d ≤ 0) in view', 1); }
  else {
    // The bounding box, dashed (curved where the space is warped)
    ctx.setLineDash([5, 4]);
    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (const run of outline) polyline(ctx, run, X, Y);
      ctx.strokeStyle = pass ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.5)'; ctx.lineWidth = pass ? 1.2 : 3; ctx.stroke();
    }
    ctx.setLineDash([]);
    const lo = locateValue(field, [box.minX, box.minY]), hi = locateValue(field, [box.maxX, box.maxY]);
    if (lo.found) { marker(ctx, X(lo.u), Y(lo.v), '#fff', 3); tag(ctx, `min (${fmt(box.minX)}, ${fmt(box.minY)})`, X(lo.u), Y(lo.v), cw, ch, '#fff', -8, 12); }
    if (hi.found) { marker(ctx, X(hi.u), Y(hi.v), '#fff', 3); tag(ctx, `max (${fmt(box.maxX)}, ${fmt(box.maxY)})`, X(hi.u), Y(hi.v), cw, ch, '#fff', 8, -12); }
    // The size, stacked over the max corner's label (w × h in the space's units)
    const size = `w × h ${exact ? '=' : '≈'} ${fmt(box.maxX - box.minX)} × ${fmt(box.maxY - box.minY)}${stats.clipped && !exact ? ' (in view)' : ''}`;
    ctx.font = `600 ${FONT}`;
    if (hi.found) tag(ctx, size, X(hi.u), Y(hi.v), cw, ch, '#fff', 8, -27);
    else note(size, 1);
    ctx.font = FONT;

    // The centre and the radius
    const centre = prim?.centre ?? stats.centre;
    if (centre) {
      const c = locateValue(field, centre);
      const radius = prim?.radius ?? (stats.circleLike ? stats.inscribed : undefined);
      if (c.found) {
        const cx = X(c.u), cy = Y(c.v);
        if (radius !== undefined) {
          const e = locateValue(field, [centre[0] + radius, centre[1]]);
          if (e.found) {
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(X(e.u), Y(e.v));
            ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
            ctx.lineWidth = 1.5; ctx.strokeStyle = accent; ctx.stroke();
            const label = prim?.radius !== undefined ? `${prim.radiusLabel ?? 'r'} = ${fmt(radius)}` : `r ≈ ${fmt(radius)}`;
            ctx.font = `600 ${FONT}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            haloText(ctx, label, (cx + X(e.u)) / 2, Math.min(cy, Y(e.v)) - 4, accent);
            ctx.font = FONT;
          }
        }
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        tag(ctx, `centre (${fmt(centre[0])}, ${fmt(centre[1])})`, cx, cy, cw, ch, '#fff', -8, 14);
      }
    }
  }

  // Under the pointer: the space's value there (warped values in a warped space) and the distance
  if (ptr.hover) {
    const [u, v] = ptr.hover;
    const p = sampleBilinear(field, u, v), d = sampleScalar({ data: frame.sdf, w: field.w, h: field.h }, u, v);
    const x = X(u), y = Y(v);
    ctx.font = `600 ${FONT}`;
    tag(ctx, `(${fmt(p[0])}, ${fmt(p[1])})  d = ${fmt(d)}`, x, y, cw, ch, d <= 0 ? accent : '#fff', 14, 16);
    ctx.font = FONT;
  }
}

function drawDistance(ctx: CanvasRenderingContext2D, field: Field2, cw: number, ch: number, accent: string, ptr: OverlayPointer) {
  const st = useOverlay.getState();
  const X = (u: number) => u * cw, Y = (v: number) => (1 - v) * ch;
  const note = (t: string, row = 0) => { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; haloText(ctx, t, 10, 10 + row * 15, 'rgba(255,255,255,0.92)'); };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
    ctx.lineWidth = 1.8; ctx.strokeStyle = accent; ctx.stroke();
  };
  const pts = ptr.points;
  if (st.fromCentre) {
    const o = locateValue(field, [0, 0]);
    const p = pts[pts.length - 1];
    let row = 0;
    if (!o.found) note('The origin (0, 0) is not in view of this space', row++);
    else if (!o.onScreen) note('The origin (0, 0) is off-screen', row++);
    if (!p) { note('Click a point: its distance and angle from (0, 0)', row); return; }
    const val = sampleBilinear(field, p[0], p[1]);
    const { dist, angle } = fromOrigin(val);
    const px = X(p[0]), py = Y(p[1]);
    const text = `d = ${fmt(dist)}   θ = ${angle.toFixed(1)}°`;
    if (o.found) {
      const ox = X(o.u), oy = Y(o.v);
      line(ox, oy, px, py);
      // The angle: an arc from +x (as the space points it on screen) round to the point, counter-clockwise
      const R = Math.min(36, Math.hypot(px - ox, py - oy) * 0.45);
      const ax = locateValue(field, [Math.max(1e-6, dist * 0.5), 0]);
      if (R > 6 && ax.found) {
        const a0 = Math.atan2(Y(ax.v) - oy, X(ax.u) - ox), a1 = Math.atan2(py - oy, px - ox);
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a0) * (R + 8), oy + Math.sin(a0) * (R + 8));
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
        ctx.beginPath(); ctx.arc(ox, oy, R, a0, a1, true);
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      marker(ctx, ox, oy, '#fff', 3);
      ctx.font = `600 ${FONT}`;
      tag(ctx, text, (ox + px) / 2, (oy + py) / 2, cw, ch, accent, 10, -10);
    } else {
      ctx.font = `600 ${FONT}`;
      tag(ctx, text, px, py, cw, ch, accent, 10, 14);
    }
    ctx.font = FONT;
    marker(ctx, px, py, accent);
    tag(ctx, `(${fmt(val[0])}, ${fmt(val[1])})`, px, py, cw, ch);
    return;
  }
  if (pts.length < 2) note(pts.length ? 'Click a second point' : 'Click two points to measure between them');
  const vals = pts.map(p => sampleBilinear(field, p[0], p[1]));
  if (pts.length === 2) {
    const m = measurePair(field, pts[0], pts[1]);
    const ax = X(pts[0][0]), ay = Y(pts[0][1]), bx = X(pts[1][0]), by = Y(pts[1][1]);
    line(ax, ay, bx, by);
    ctx.font = `600 ${FONT}`;
    tag(ctx, `d = ${fmt(m.dist)}`, (ax + bx) / 2, (ay + by) / 2, cw, ch, accent, 10, -10);
    ctx.font = FONT;
  }
  pts.forEach((p, k) => {
    const x = X(p[0]), y = Y(p[1]);
    marker(ctx, x, y, accent);
    tag(ctx, `${k ? 'B' : 'A'} (${fmt(vals[k][0])}, ${fmt(vals[k][1])})`, x, y, cw, ch);
  });
}

export function drawOverlay(ctx: CanvasRenderingContext2D, frame: OverlayFrame, cw: number, ch: number, accent: string,
  ptr: OverlayPointer = { hover: null, points: [] }) {
  const st = useOverlay.getState();
  ctx.font = FONT;
  if (frame.error || !frame.space) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    haloText(ctx, frame.error ?? 'Reading…', 10, 10, 'rgba(255,255,255,0.9)');
    return;
  }
  // Measuring reads the space itself (the Warp blend is for looking at grids)
  const measuring = st.mode === 'shape' || st.mode === 'distance';
  const field: Field2 = !measuring && st.space && st.blend < 1 ? blendFields(frame.plain, frame.space, st.blend) : frame.space;
  if (st.mode === 'shape') { drawShape(ctx, frame, field, cw, ch, accent, ptr); return; }
  if (st.mode === 'distance') { drawDistance(ctx, field, cw, ch, accent, ptr); return; }
  const X = (u: number) => u * cw, Y = (v: number) => (1 - v) * ch;

  if (st.mode === 'grid' || st.gridInPosition) {
    const target = Math.max(4, Math.min(12, Math.round(Math.max(cw, ch) / 70)));
    const { lines, sx, sy } = gridLines(field, target);
    // Halo under every line first, then the lines: minor faint white, the 0 lines in the accent
    for (const pass of [0, 1]) {
      for (const ln of lines) {
        ctx.beginPath();
        for (let k = 0; k < ln.segs.length; k += 4) {
          ctx.moveTo(X(ln.segs[k]), Y(ln.segs[k + 1]));
          ctx.lineTo(X(ln.segs[k + 2]), Y(ln.segs[k + 3]));
        }
        if (pass === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = ln.major ? 3.5 : 2.5; }
        else { ctx.strokeStyle = ln.major ? accent : 'rgba(255,255,255,0.55)'; ctx.lineWidth = ln.major ? 1.6 : 0.8; }
        ctx.stroke();
      }
    }
    const labels = edgeLabels(lines, sx, sy)
      .sort((a, b) => Number(b.major) - Number(a.major))
      .map(l => {
        const w = ctx.measureText(l.text).width + 6, h = 14;
        let x = X(l.u), y = Y(l.v);
        if (l.edge === 'bottom') { x -= w / 2; y = ch - h - 2; }
        else if (l.edge === 'top') { x -= w / 2; y = 2; }
        else if (l.edge === 'left') { x = 2; y -= h / 2; }
        else if (l.edge === 'right') { x = cw - w - 2; y -= h / 2; }
        else { x -= w / 2; y -= h / 2; }
        x = Math.max(2, Math.min(cw - w - 2, x)); y = Math.max(2, Math.min(ch - h - 2, y));
        return { ...l, box: [x, y, w, h] as [number, number, number, number] };
      });
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of declutter(labels)) {
      const [x, y, w, h] = l.box;
      haloText(ctx, l.text, x + w / 2, y + h / 2, l.major ? accent : l.axis === 'x' ? 'rgba(255,255,255,0.95)' : 'rgba(214,226,255,0.95)');
    }
  }

  if (st.mode === 'position' && frame.pos) {
    const p = frame.pos;
    const loc = locateValue(field, p);
    const text = `(${fmt(p[0])}, ${fmt(p[1])})`;
    ctx.textBaseline = 'middle';
    if (!loc.found) {
      ctx.textAlign = 'left';
      haloText(ctx, `${text}: not in view of this space`, 10, 12, '#fff');
    } else if (loc.onScreen) {
      const x = X(loc.u), y = Y(loc.v);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, y);
      ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 12); ctx.stroke();
      const w = ctx.measureText(text).width;
      const right = x + 16 + w < cw - 4;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.font = `600 ${FONT}`;
      haloText(ctx, text, right ? x + 16 : x - 16, Math.max(10, Math.min(ch - 10, y - 12)), '#fff');
    } else {
      const e = edgePoint(loc.u, loc.v, 0.05);
      const x = X(e.u), y = Y(e.v), a = -e.angle;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      ctx.fillStyle = accent; ctx.fill();
      ctx.restore();
      ctx.textAlign = x > cw / 2 ? 'right' : 'left';
      ctx.font = `600 ${FONT}`;
      haloText(ctx, `${text} off-screen`, x + (x > cw / 2 ? -14 : 14), Math.max(10, Math.min(ch - 10, y + (y > ch / 2 ? -16 : 16))), '#fff');
    }
  }
}

/** The overlay canvas, mounted over the picture (ShaderCanvas). */
export function PreviewOverlay() {
  const mode = useOverlay(s => s.mode);
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accent = tk.accent.base;

  useEffect(() => {
    if (mode === 'off') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    // The pointer and Distance's clicks live here (never React state: a move only asks for a draw)
    const ptr: OverlayPointer = { hover: null, points: [] };
    const draw = () => {
      raf = 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frame = overlayBus.get();
      const st = useOverlay.getState();
      if (!frame || frame.key !== overlayKey(st) || !cw || !ch) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOverlay(ctx, frame, cw, ch, accent, ptr);
    };
    const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };
    ask();
    const unsubBus = overlayBus.subscribe(ask);
    const unsubStore = useOverlay.subscribe((s, prev) => {
      if (s.fromCentre !== prev.fromCentre || s.space !== prev.space) ptr.points = [];
      ask();
    });
    const toUv = (e: PointerEvent): [number, number] | null => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height || e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return null;
      return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
    };
    // Hover: on the window (the canvas lets the pointer through in Shape mode)
    const onMove = (e: PointerEvent) => {
      const h = toUv(e);
      if (!h && !ptr.hover) return;
      ptr.hover = h; ask();
    };
    if (mode === 'shape') window.addEventListener('pointermove', onMove, { passive: true });
    // Distance: the canvas takes the clicks (pointer-events on only in this mode), so the shader's
    // mouse button never sees them (ShaderCanvas skips presses on [data-overlay-capture]).
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = toUv(e);
      if (!p) return;
      e.preventDefault(); e.stopPropagation();
      ptr.points = useOverlay.getState().fromCentre || ptr.points.length >= 2 ? [p] : [...ptr.points, p];
      ask();
    };
    if (mode === 'distance') canvas.addEventListener('pointerdown', onDown);
    const ro = new ResizeObserver(ask);
    ro.observe(canvas);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      useOverlay.getState().setMode('off');
    };
    // Distance: Esc first clears the points (capture, ahead of anything else that takes Esc)
    const onClearKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !ptr.points.length) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      ptr.points = []; e.preventDefault(); e.stopPropagation(); ask();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onClearKey, true);
    return () => {
      unsubBus(); unsubStore(); ro.disconnect(); window.removeEventListener('keydown', onKey); window.removeEventListener('keydown', onClearKey, true);
      window.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mode, accent]);

  if (mode === 'off') return null;
  const capture = mode === 'distance';
  return <canvas ref={canvasRef} data-testid="preview-overlay" data-overlay-capture={capture ? '' : undefined}
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: capture ? 'auto' : 'none', cursor: capture ? 'crosshair' : undefined, touchAction: capture ? 'none' : undefined }} />;
}

const MODES: { value: OverlayMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'grid', label: 'Grid' },
  { value: 'position', label: 'Position' },
  { value: 'shape', label: 'Shape' },
  { value: 'distance', label: 'Distance' },
];

const isSdfNode = (n: GraphNode) => {
  const d = getNodeDefinition(n.type);
  return d?.category === '2D Primitives' || d?.category === 'SDF' || /sdf/i.test(n.type) || /^sd[A-Z]/.test(n.type);
};

function OverlayMenu() {
  const tk = useTokens();
  const st = useOverlay();
  const nodes = useNodeGraphStore(s => s.nodes);
  const outs = useMemo(() => vec2Outputs(nodes, nodeName), [nodes]);
  const sdfs = useMemo(() => (st.mode === 'shape' ? sdfOutputs(nodes, nodeName, isSdfNode) : []), [nodes, st.mode]);
  const sdfOpts: SelectOption[] = [
    { value: '', label: 'Pick an SDF…' },
    ...sdfs.map(o => ({ value: refKey(o.ref), label: o.label, group: o.sdf ? 'SDF nodes' : `Other floats${o.group ? ` · ${o.group}` : ''}` })),
    ...(st.sdf && !sdfs.some(o => refKey(o.ref) === refKey(st.sdf)) ? [{ value: refKey(st.sdf), label: 'Missing node', disabled: true }] : []),
  ];
  // Picking an SDF also picks its space: what's wired into its UV (unwired = plain UV)
  const pickSdf = (r: SocketRef | null) => {
    st.setSdf(r);
    const n = r ? findNode(nodes, r.nodeId) : undefined;
    const sp = n ? sdfInputSpace(n) : undefined;
    if (sp !== undefined) st.setSpace(sp);
  };
  // Shape mode starts on the first SDF node
  useEffect(() => {
    if (st.mode !== 'shape' || st.sdf) return;
    const first = sdfs.find(o => o.sdf);
    if (first) pickSdf(first.ref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.mode, st.sdf, sdfs]);
  const opts = (none: string, cur: string): SelectOption[] => [
    { value: '', label: none },
    ...outs.map(o => ({ value: refKey(o.ref), label: o.label, group: o.group || undefined })),
    // A pick whose node has gone (another graph loaded): still shown, as missing
    ...(cur && !outs.some(o => refKey(o.ref) === cur) ? [{ value: cur, label: 'Missing node', disabled: true }] : []),
  ];
  // Position mode starts on the Mouse node when there is one
  useEffect(() => {
    if (st.mode !== 'position' || st.position) return;
    const m = outs.find(o => o.type === 'mouse' && o.ref.outputKey === 'uv');
    if (m) st.setPosition(m.ref);
  }, [st.mode, st.position, outs, st]);
  const row = { display: 'flex', flexDirection: 'column', gap: 4 } as const;
  const cap = { font: `600 11px ${fontFamily.ui}`, color: tk.text.muted } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 6 }}>
      <Segmented options={MODES} value={st.mode} onChange={st.setMode} fill wrap size="sm" ariaLabel="Overlay mode" />
      {st.mode !== 'off' && (
        <>
          {st.mode === 'position' && (
            <div style={row}>
              <span style={cap}>Position (a vec2 point)</span>
              <Select ariaLabel="Position" value={refKey(st.position)} options={opts('Pick a vec2 output…', refKey(st.position))} onChange={v => st.setPosition(parseRef(v))} />
            </div>
          )}
          {st.mode === 'shape' && (
            <div style={row}>
              <span style={cap}>Shape (an SDF's distance)</span>
              <Select ariaLabel="SDF" value={refKey(st.sdf)} options={sdfOpts} onChange={v => pickSdf(parseRef(v))} />
            </div>
          )}
          <div style={row}>
            <span style={cap}>{st.mode === 'shape' ? 'Space it lives in (set from its UV when picked)' : 'Space'}</span>
            <Select ariaLabel="Space" value={refKey(st.space)} options={opts('Plain UV (the UV node)', refKey(st.space))} onChange={v => st.setSpace(parseRef(v))} />
          </div>
          {st.space && (st.mode === 'grid' || st.mode === 'position') && (
            <div style={row}>
              <span style={{ ...cap, display: 'flex' }}><span style={{ flex: 1 }}>Warp blend</span><span style={{ fontFamily: fontFamily.mono }}>{st.blend.toFixed(2)}</span></span>
              <input type="range" aria-label="Warp blend" min={0} max={1} step={0.01} value={st.blend}
                onChange={e => st.setBlend(Number(e.target.value))} style={{ width: '100%', accentColor: tk.accent.base }} />
            </div>
          )}
          {st.mode === 'position' && <Toggle checked={st.gridInPosition} onChange={st.setGridInPosition} label="Show the grid" />}
          {st.mode === 'distance' && <Toggle checked={st.fromCentre} onChange={st.setFromCentre} label="From centre (0, 0), with the angle" />}
          <span style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.faint }}>
            {st.mode === 'shape' ? 'Hover the picture for the value and distance there. ' : ''}
            {st.mode === 'distance' ? (st.fromCentre ? 'Click a point on the picture. ' : 'Click two points on the picture; a third starts again. ') + 'Esc clears. ' : ''}
            Drawn over the picture only; never in exports. Esc turns it off.
          </span>
        </>
      )}
    </div>
  );
}

/** The Overlay button in the preview's header. */
export function OverlayButton() {
  const on = useOverlay(s => s.mode !== 'off');
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={ref} style={{ display: 'inline-flex' }}>
        <IconButton icon="grid" label="Overlay: a labelled grid of a space, where a point lies in it, a shape's size, or distances" size="sm" active={on || open} onClick={() => setOpen(o => !o)} />
      </span>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} width={290} align="end">
          <OverlayMenu />
        </Popover>
      )}
    </>
  );
}
