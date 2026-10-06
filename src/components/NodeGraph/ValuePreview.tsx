/**
 * The node card's preview while the eye is on it (docs/node-previews.md), and the one place its
 * controls live: the output picker, Show as, Detail, the Diagram toggle, the ⓘ "how to read it"
 * and the caption's notes (clipping, black, flat).
 *
 * The picture is the node's real value or colour, painted from the eye preview's asynchronous
 * readback (lib/nodePreview/previewBus.ts), so it works for any upstream chain, Passes and
 * textures included. Painting is on the CPU from the small field (valueField.paintField); nothing
 * extra is rendered for it on the GPU. With `diagramOnly` (a node with no picture output) the
 * body is the node's own diagram.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { explainPreview } from '../../lib/previewExplain';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { Tooltip } from '../ui/Tooltip';
import { Icon } from '../ui/Icon';
import { previewBus, previewPerf } from '../../lib/nodePreview/previewBus';
import { DEFAULT_DETAIL, DETAIL_LEVELS, gridDensity, modeHint, prefOf, useNodePreviewPrefs } from '../../lib/nodePreview/showAs';
import { isColourType, paintField, valueKey, niceStep, formatValue } from '../../lib/nodePreview/valueField';
import { coverMap, drawSlice, fitContain, previewLayout, previewMaxHeight } from '../../lib/nodePreview/draw2d';
import { drawValueOverlay } from '../PreviewValueOverlay';
import { ShowAsControls, useShowAs } from './ShowAsControls';

/** How long the card waits for the first readback before saying why there is none. */
const NO_FRAME_MS = 2500;
const COLOUR_HINT = 'Its colour as the picture draws it, clipped to 0–1. A note under it says when parts clip to white or are black.';
const DIAGRAM_HINT = 'The node’s own diagram of what it does, from its settings.';
/** Behind a picture narrower than the panel (and the slice plot's strip). */
const LETTERBOX = '#0b0c10';
/** Most canvas pixels the card paints per readback. */
const MAX_PAINT_PX = 90_000;

export function ValuePreview({ node, diagram, diagramOnly = false }: {
  node: GraphNode;
  /** The node's own diagram (inline viz), offered as another view. */
  diagram?: ReactNode;
  /** No picture output: the diagram is the body (the row still carries ⓘ and the output picker). */
  diagramOnly?: boolean;
}) {
  const tk = useTokens();
  const sa = useShowAs(node);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keyRef = useRef<HTMLSpanElement>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  // The caption's frame stats (from the same readback): also say when the output is one flat colour
  const stats = useNodeGraphStore(s => (s.previewNodeId === node.id ? s.previewStats : null));
  // Diagram: the node's pick, else on its own while the output is the same everywhere (a Palette or a
  // Tone Map with nothing wired yet says more as its diagram than as a flat square)
  const pickedDiagram = useNodePreviewPrefs(s => prefOf(node, s.prefs).diagram);
  const autoDiagram = !!diagram && pickedDiagram === undefined && !!stats?.flat;
  const showDiagram = diagramOnly || (!!diagram && (pickedDiagram ?? autoDiagram));
  const mode = sa?.mode ?? 'raw';
  const sliceY = dragY ?? sa?.sliceY ?? 0.5;
  const outputKey = sa?.outputKey;
  const valueType = sa?.valueType ?? null;
  const fieldType = sa?.type ?? null;
  const detail = sa?.detail ?? DEFAULT_DETAIL;
  // The caption's notes (clipping, black, flat): for Raw and colours
  const explained = !showDiagram && (mode === 'raw' || (fieldType && isColourType(fieldType)))
    ? explainPreview(node, getNodeDefinitionFor(node), stats) : null;
  // Only the notes that ask for something (clipping, black, flat); "all within 0–1" goes without saying
  const note = explained && !explained.startsWith('Values stay within') ? explained : null;
  // No readback after a while: the output isn't in the picture's program (only a Pass draws it)
  const [noFrame, setNoFrame] = useState(false);

  // The picture at its real aspect (the readback follows the main picture's), "contain"-fitted:
  // the full width of the panel, or less when that would be taller than ~40% of the window (or,
  // on a narrow card, 1.2× its width).
  // Drawn at exactly that aspect the cover mapping is the whole picture: nothing cropped or stretched.
  const boxRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(300);
  const [winH, setWinH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  const [aspect, setAspect] = useState(16 / 9);
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth > 0) setAvailW(el.clientWidth); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const onWin = () => setWinH(window.innerHeight);
    window.addEventListener('resize', onWin);
    return () => { ro.disconnect(); window.removeEventListener('resize', onWin); };
  }, [showDiagram, noFrame]);
  const box = fitContain(aspect, availW, previewMaxHeight(availW, winH));
  const sliceOn = mode === 'slice' && valueType === 'float' && !showDiagram;
  const layout = previewLayout(availW, box, sliceOn);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

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
      const L = layoutRef.current;
      const cw = L.w, ch = L.h, pic = L.picture;
      // Painted on the CPU at each readback: the picture capped at ~90k pixels (about 1.4× on a 2× screen) to keep it a few ms
      const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PAINT_PX / (pic.w * pic.h)));
      const dw = Math.round(cw * dpr), dh = Math.round(ch * dpr);
      const pw = Math.max(1, Math.round(pic.w * dpr)), ph = Math.max(1, Math.round(pic.h * dpr));
      if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }
      if (img && (img.width !== pw || img.height !== ph)) { img = null; painted = -1; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = LETTERBOX; ctx.fillRect(0, 0, dw, dh);
      if (!frame || frame.nodeId !== node.id || frame.outputKey !== outputKey || frame.field.type !== fieldType) {
        ctx.fillStyle = '#111217'; ctx.fillRect(Math.round(pic.x * dpr), 0, pw, ph);
        if (keyRef.current) keyRef.current.textContent = 'starting…';
        return;
      }
      setNoFrame(false);
      // Follow the picture's aspect (a resized or re-shaped main picture)
      const fa = frame.field.w / Math.max(1, frame.field.h);
      if (Math.abs(fa - aspectRef.current) > 0.01 * fa) setAspect(fa);
      const t0 = performance.now();
      // The picture: repainted only for a new readback or a new mode (the slice drag reuses it)
      const sig = (frame.seq * 8 + ['grid', 'arrows', 'wheel', 'raw', 'auto', 'slice', 'contours'].indexOf(mode)) * 4 + DETAIL_LEVELS.findIndex(l => l.value === detail);
      if (painted !== sig || !img) {
        img = img ?? ctx.createImageData(pw, ph);
        // The field drawn into a box of its own aspect: the whole picture, nothing cropped
        paintField(img.data, pw, ph, frame.field, { mode, stats: frame.stats, grid: gridDensity(detail) });
        painted = sig;
      }
      ctx.putImageData(img, Math.round(pic.x * dpr), 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Overlays use the picture's rect, so arrows and the slice line sit on the fitted image
      if (L.plot && frame.field.type === 'float' && !frame.stats.constant && frame.stats.finite > 0) drawSlice(ctx, frame.field, pic, L.plot, sliceY);
      else if (mode !== 'raw') drawValueOverlay(ctx, frame, mode, pic, sliceY, { keyAt: 'none', big: false, detail });
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
    const timer = setTimeout(() => {
      const f = previewBus.get();
      if (!f || f.nodeId !== node.id || f.outputKey !== outputKey) setNoFrame(true);
    }, NO_FRAME_MS);
    return () => { unsub(); ro.disconnect(); clearTimeout(timer); if (raf) cancelAnimationFrame(raf); };
  }, [node.id, outputKey, fieldType, mode, sliceY, showDiagram, detail, layout.w, layout.h]);

  if (!sa) return null;
  const sliceDrag = mode === 'slice' && valueType === 'float';
  const yAt = (e: React.PointerEvent) => {
    const frame = previewBus.get();
    const canvas = canvasRef.current;
    if (!frame || !canvas) return null;
    const b = canvas.getBoundingClientRect();
    // The card is scaled with the graph's zoom: work in its own CSS pixels
    const k = canvas.clientHeight / Math.max(1, b.height);
    const m = coverMap(frame.field, layoutRef.current.picture);
    return Math.max(0, Math.min(1, m.fromY((e.clientY - b.top) * k)));
  };
  const hint = showDiagram ? DIAGRAM_HINT : valueType ? modeHint(valueType, mode) : COLOUR_HINT;
  return (
    <div data-preview-kind={diagramOnly ? 'diagram' : 'field'} style={{ width: '100%', borderBottom: `1px solid ${tk.border.subtle}` }} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, color: tk.text.faint, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{valueType && !showDiagram ? 'Show as' : 'Preview'}</span>
        {!diagramOnly && <ShowAsControls node={node} state={sa} compact />}
        {diagram && !diagramOnly && (
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
      {showDiagram ? (
        <>
          {diagram}
          {autoDiagram && (
            <div style={{ padding: '2px 10px 6px', fontSize: 11, lineHeight: 1.4, color: tk.text.faint }}>
              Its output is the same everywhere until something is wired, so this shows its diagram.
            </div>
          )}
        </>
      ) : noFrame ? (
        <div style={{ padding: '6px 10px 8px', fontSize: 11.5, lineHeight: 1.4, color: tk.text.faint }}>
          This output isn’t part of the picture’s program (only a Pass draws it), so it can’t be read here. Preview the Pass after it instead.
        </div>
      ) : (
        <>
          <div ref={boxRef} data-preview-box="" style={{ width: '100%' }}>
          <canvas
            ref={canvasRef}
            data-testid="value-preview"
            style={{ display: 'block', width: layout.w, height: layout.h, cursor: sliceDrag ? 'ns-resize' : undefined, touchAction: sliceDrag ? 'none' : undefined }}
            onPointerDown={sliceDrag ? e => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); const y = yAt(e); if (y !== null) setDragY(y); } : undefined}
            onPointerMove={sliceDrag ? e => { if (dragY === null) return; const y = yAt(e); if (y !== null) setDragY(y); } : undefined}
            onPointerUp={sliceDrag ? () => { if (dragY !== null) useNodePreviewPrefs.getState().set(node, { sliceY: dragY }); setDragY(null); } : undefined}
          />
          </div>
          <div style={{ padding: '4px 10px 5px', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: tk.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span ref={keyRef} data-testid="value-preview-key" />
          </div>
          {note && (
            <div data-testid="value-preview-note" style={{ padding: '0 10px 6px', fontSize: 11, lineHeight: 1.4, color: tk.status.warningText }}>{note}</div>
          )}
        </>
      )}
    </div>
  );
}
