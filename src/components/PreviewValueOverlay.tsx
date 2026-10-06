/**
 * Over the picture while the eye previews a float / vec2 node in a "Show as" mode
 * (docs/node-previews.md): the value key ("−2.4 … 7.1", "= 3.0 everywhere"), the arrows and the
 * slice plot. The colour maps themselves are drawn by the GPU (lib/nodePreview/previewGlsl.ts);
 * this draws from the asynchronous readback on previewBus, in CSS pixels on a 2D canvas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { findNodeDeep } from '../lib/nodePreview/valuePreviewRunner';
import { previewBus, previewPerf, type PreviewFrame } from '../lib/nodePreview/previewBus';
import { useNodePreviewPrefs, type ShowAsMode } from '../lib/nodePreview/showAs';
import { coverMap, drawArrow, drawArrows, drawRangeBar, drawSlice, drawWheelKey, type Rect } from '../lib/nodePreview/draw2d';
import { niceStep, valueKey, formatValue } from '../lib/nodePreview/valueField';
import { useShowAs } from './NodeGraph/ShowAsControls';
import type { GraphNode } from '../types/nodeGraph';

const EMPTY: GraphNode[] = [];
const FONT = '11.5px ui-monospace, SFMono-Regular, Menlo, monospace';

/** Draw everything the overlay shows for one readback. Shared shape with the node card (ValuePreview). */
export function drawValueOverlay(ctx: CanvasRenderingContext2D, frame: PreviewFrame, mode: ShowAsMode, r: Rect, sliceY: number, opts: { keyAt?: 'bottom' | 'none'; big?: boolean } = {}) {
  const { field, stats } = frame;
  const type = field.type;
  if (stats.constant || stats.finite === 0) {
    const text = valueKey(stats, type, mode);
    ctx.font = `600 ${opts.big === false ? 13 : 18}px ui-sans-serif, system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const ph = opts.big === false ? 26 : 36;
    const px = r.x + (r.w - tw) / 2 - 14, py = r.y + (r.h - ph) / 2;
    ctx.fillStyle = 'rgba(14,15,20,0.82)';
    roundRect(ctx, px, py, tw + 28, ph, 8); ctx.fill();
    ctx.fillStyle = 'rgba(240,242,248,0.98)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, px + 14, py + ph / 2 + 1);
    return;
  }
  const arrows = type === 'vec2' && mode === 'arrows' ? drawArrows(ctx, field, r, opts.big === false ? 22 : 36) : null;
  if (type === 'float' && mode === 'slice') {
    const ph = Math.max(70, Math.min(170, r.h * 0.42));
    drawSlice(ctx, field, r, { x: r.x + 8, y: r.y + r.h - ph - 8, w: r.w - 16, h: ph }, sliceY);
    return; // the plot carries its own axis labels
  }
  if (opts.keyAt === 'none') return;
  // The key: a pill at the bottom left
  ctx.font = FONT;
  let text = valueKey(stats, type, mode);
  if (type === 'float' && mode === 'contours') text += `  · lines every ${formatValue(niceStep(stats.min, stats.max))}`;
  // Arrows: a reference arrow as long as the longest one drawn, and its length
  if (arrows) text = `= ${formatValue(arrows.maxMag)} (longest)`;
  const tw = ctx.measureText(text).width;
  const swatch = arrows ? Math.max(14, Math.min(48, arrows.fullLen)) : type === 'vec2' ? (mode === 'grid' ? 0 : 22) : 70;
  const h = 24, w = tw + 20 + (swatch ? swatch + 8 : 0);
  const x = r.x + 10, y = r.y + r.h - h - 10;
  ctx.fillStyle = 'rgba(14,15,20,0.8)';
  roundRect(ctx, x, y, w, h, 7); ctx.fill();
  let tx = x + 10;
  if (type === 'float') { drawRangeBar(ctx, { x: tx, y: y + 8, w: swatch, h: 8 }, stats); tx += swatch + 8; }
  else if (arrows) { drawArrow(ctx, tx, y + h / 2, tx + swatch, y + h / 2, 6, 'rgba(240,242,248,0.95)'); tx += swatch + 8; }
  else if (swatch) { drawWheelKey(ctx, tx + 9, y + h / 2, 9); tx += swatch + 8; }
  ctx.fillStyle = 'rgba(236,238,246,0.96)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, tx, y + h / 2 + 1);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function PreviewValueOverlay() {
  const previewId = useNodeGraphStore(s => s.previewNodeId);
  const nodes = useNodeGraphStore(s => (s.previewNodeId ? s.nodes : EMPTY));
  const node = useMemo(() => (previewId ? findNodeDeep(nodes, previewId) : null), [nodes, previewId]);
  const sa = useShowAs(node);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The slice line while it's dragged (committed to the node's prefs on release)
  const [dragY, setDragY] = useState<number | null>(null);
  const active = !!(node && sa?.valueType && sa.mode && sa.mode !== 'raw');
  const mode = sa?.mode ?? 'raw';
  const sliceY = dragY ?? sa?.sliceY ?? 0.5;
  const outputKey = sa?.outputKey;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frame = previewBus.get();
      if (!active || !frame || frame.nodeId !== previewId || frame.outputKey !== outputKey || frame.field.type !== sa?.valueType) return;
      const t0 = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawValueOverlay(ctx, frame, mode, { x: 0, y: 0, w: cw, h: ch }, sliceY);
      previewPerf.overlayMs = performance.now() - t0;
    };
    const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };
    ask();
    const unsub = previewBus.subscribe(ask);
    const ro = new ResizeObserver(ask);
    ro.observe(canvas);
    return () => { unsub(); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [active, mode, sliceY, previewId, outputKey, sa?.valueType]);

  const sliceDrag = active && mode === 'slice' && sa?.valueType === 'float';
  const yAt = (e: React.PointerEvent) => {
    const frame = previewBus.get();
    const canvas = canvasRef.current;
    if (!frame || !canvas) return null;
    const b = canvas.getBoundingClientRect();
    const m = coverMap(frame.field, { x: 0, y: 0, w: b.width, h: b.height });
    return Math.max(0, Math.min(1, m.fromY(e.clientY - b.top)));
  };
  return (
    <canvas
      ref={canvasRef}
      data-testid="preview-value-overlay"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: sliceDrag ? 'auto' : 'none', cursor: sliceDrag ? 'ns-resize' : undefined }}
      onPointerDown={sliceDrag ? e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const y = yAt(e); if (y !== null) setDragY(y); } : undefined}
      onPointerMove={sliceDrag ? e => { if (dragY === null) return; const y = yAt(e); if (y !== null) setDragY(y); } : undefined}
      onPointerUp={sliceDrag ? () => { if (dragY !== null && node) useNodePreviewPrefs.getState().set(node, { sliceY: dragY }); setDragY(null); } : undefined}
    />
  );
}
