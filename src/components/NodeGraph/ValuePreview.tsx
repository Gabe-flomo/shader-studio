/**
 * The node card's preview of a float / vec2 output while the eye is on it
 * (docs/node-previews.md): the same "Show as" modes as the eye preview, painted from the same
 * asynchronous readback of the node's real value (lib/nodePreview/previewBus.ts), so it works for
 * any upstream chain. Painting is on the CPU from the small value field (valueField.paintField);
 * nothing extra is rendered for it on the GPU.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { Tooltip } from '../ui/Tooltip';
import { Icon } from '../ui/Icon';
import { previewBus, previewPerf } from '../../lib/nodePreview/previewBus';
import { modeHint, prefOf, useNodePreviewPrefs } from '../../lib/nodePreview/showAs';
import { paintField, valueKey, niceStep, formatValue } from '../../lib/nodePreview/valueField';
import { coverMap } from '../../lib/nodePreview/draw2d';
import { drawValueOverlay } from '../PreviewValueOverlay';
import { ShowAsControls, useShowAs } from './ShowAsControls';

const HEIGHT = 150;
/** Most canvas pixels the card paints per readback. */
const MAX_PAINT_PX = 90_000;

export function ValuePreview({ node, diagram }: { node: GraphNode; /** The node's own diagram (inline viz), offered as another view. */ diagram?: ReactNode }) {
  const tk = useTokens();
  const sa = useShowAs(node);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keyRef = useRef<HTMLSpanElement>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  const showDiagram = useNodePreviewPrefs(s => !!(diagram && prefOf(node, s.prefs).diagram));
  const mode = sa?.mode ?? 'raw';
  const sliceY = dragY ?? sa?.sliceY ?? 0.5;
  const outputKey = sa?.outputKey;
  const valueType = sa?.valueType ?? null;

  useEffect(() => {
    if (showDiagram) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let painted = -1;
    let img: ImageData | null = null;
    const draw = () => {
      raf = 0;
      const frame = previewBus.get();
      const cw = canvas.clientWidth || 300, ch = HEIGHT;
      // Painted on the CPU at each readback: capped at ~90k pixels (about 1.4× on a 2× screen) to keep it a few ms
      const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PAINT_PX / (cw * ch)));
      const dw = Math.round(cw * dpr), dh = Math.round(ch * dpr);
      if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; img = null; painted = -1; }
      if (!frame || frame.nodeId !== node.id || frame.outputKey !== outputKey || frame.field.type !== valueType) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#111217'; ctx.fillRect(0, 0, dw, dh);
        if (keyRef.current) keyRef.current.textContent = 'waiting for the preview…';
        return;
      }
      const t0 = performance.now();
      // The picture: repainted only for a new readback or a new mode (the slice drag reuses it)
      const sig = frame.seq * 8 + ['grid', 'arrows', 'wheel', 'raw', 'auto', 'slice', 'contours'].indexOf(mode);
      if (painted !== sig || !img) {
        img = img ?? ctx.createImageData(dw, dh);
        paintField(img.data, dw, dh, frame.field, { mode, stats: frame.stats });
        painted = sig;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(img, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (mode !== 'raw') drawValueOverlay(ctx, frame, mode, { x: 0, y: 0, w: cw, h: ch }, sliceY, { keyAt: 'none', big: false });
      previewPerf.cardPaintMs = performance.now() - t0;
      if (keyRef.current) {
        let text = valueKey(frame.stats, frame.field.type, mode);
        if (mode === 'contours' && !frame.stats.constant) text += ` · lines every ${formatValue(niceStep(frame.stats.min, frame.stats.max))}`;
        if (keyRef.current.textContent !== text) keyRef.current.textContent = text;
      }
    };
    const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };
    ask();
    const unsub = previewBus.subscribe(ask);
    const ro = new ResizeObserver(ask);
    ro.observe(canvas);
    return () => { unsub(); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [node.id, outputKey, valueType, mode, sliceY, showDiagram]);

  if (!sa) return null;
  const sliceDrag = mode === 'slice' && valueType === 'float';
  const yAt = (e: React.PointerEvent) => {
    const frame = previewBus.get();
    const canvas = canvasRef.current;
    if (!frame || !canvas) return null;
    const b = canvas.getBoundingClientRect();
    // The card is scaled with the graph's zoom: work in its own CSS pixels
    const k = canvas.clientHeight / Math.max(1, b.height);
    const m = coverMap(frame.field, { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight });
    return Math.max(0, Math.min(1, m.fromY((e.clientY - b.top) * k)));
  };
  const hint = valueType ? modeHint(valueType, mode) : '';
  return (
    <div style={{ width: '100%', borderBottom: `1px solid ${tk.border.subtle}` }} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, color: tk.text.faint, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>Show as</span>
        <ShowAsControls node={node} state={sa} compact />
        {diagram && (
          <button
            type="button"
            onClick={() => useNodePreviewPrefs.getState().set(node, { diagram: !showDiagram })}
            style={{ border: 0, borderRadius: 6, padding: '2px 7px', fontSize: 11, cursor: 'pointer', background: showDiagram ? tk.accent.base : tk.bg.field, color: showDiagram ? '#fff' : tk.text.secondary }}
          >Diagram</button>
        )}
        <span style={{ flex: 1 }} />
        <Tooltip label="How to read this preview" description={showDiagram ? 'The node’s own diagram of what it does, from its settings.' : hint} placement="top">
          <span aria-label="How to read this preview" style={{ display: 'inline-flex', color: tk.text.faint, cursor: 'help' }}><Icon name="info" size={14} /></span>
        </Tooltip>
      </div>
      {showDiagram ? diagram : (
        <>
          <canvas
            ref={canvasRef}
            data-testid="value-preview"
            style={{ display: 'block', width: '100%', height: HEIGHT, cursor: sliceDrag ? 'ns-resize' : undefined, touchAction: sliceDrag ? 'none' : undefined }}
            onPointerDown={sliceDrag ? e => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); const y = yAt(e); if (y !== null) setDragY(y); } : undefined}
            onPointerMove={sliceDrag ? e => { if (dragY === null) return; const y = yAt(e); if (y !== null) setDragY(y); } : undefined}
            onPointerUp={sliceDrag ? () => { if (dragY !== null) useNodePreviewPrefs.getState().set(node, { sliceY: dragY }); setDragY(null); } : undefined}
          />
          <div style={{ padding: '4px 10px 5px', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: tk.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span ref={keyRef} data-testid="value-preview-key" />
          </div>
        </>
      )}
    </div>
  );
}
