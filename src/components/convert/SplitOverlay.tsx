/**
 * SplitOverlay — the Convert page's A|B wipe on the hosted canvas: the source
 * shader drawn in a canvas of its own (sideRender.ts) over the main canvas,
 * clipped to the left of a divider you drag; the converted graph (what the
 * main canvas renders) shows to the right. Same clock (lib/timeTick), same
 * drawing-buffer size and the same mouse as the main canvas, so the two
 * halves line up pixel for pixel. The overlay takes no pointer input except
 * on the divider: the hover readout still reads the main canvas.
 */
import { useEffect, useRef, useState } from 'react';
import { clockNow } from '../../lib/timeTick';
import { usePreviewHost } from '../../lib/previewHost';
import { fontFamily } from '../../theme/tokens';
import { clampSplit, usePageCanvas } from '../shell/pageCanvasStore';
import { context, draw, program, type Side } from './sideRender';

const MAX_PX = 2048;

export function SplitOverlay({ source, uniforms }: { source: string; uniforms: Record<string, number | number[]> }) {
  const split = usePageCanvas(s => s.split);
  const setSplit = usePageCanvas(s => s.setSplit);
  const host = usePreviewHost(s => s.canvas);
  const ref = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const side = useRef<Side | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  // One context for the overlay's life; made again if the browser takes it away and gives it back.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    side.current = context(c);
    const lost = (e: Event) => { e.preventDefault(); if (side.current) { side.current.prog = null; side.current.buf = null; } };
    const restored = () => { side.current = context(c); setGeneration(g => g + 1); };
    c.addEventListener('webglcontextlost', lost); c.addEventListener('webglcontextrestored', restored);
    return () => {
      c.removeEventListener('webglcontextlost', lost); c.removeEventListener('webglcontextrestored', restored);
      if (side.current) { program(side.current, null); side.current.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
      side.current = null;
    };
  }, []);

  // The program follows the source; the frame loop follows the main canvas (its place, size, clock and mouse).
  useEffect(() => {
    const s = side.current, c = ref.current, box = boxRef.current;
    if (!s || !c || !box) { setError('WebGL isn’t available here'); return; }
    program(s, source);
    setError(s.error ? 'The source doesn’t compile here' : null);
    if (!s.prog || !host) return;
    let mouse: [number, number] | null = null;
    const onMove = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) mouse = [(e.clientX - r.left) / r.width * c.width, (1 - (e.clientY - r.top) / r.height) * c.height];
    };
    const onLeave = () => { mouse = null; };
    host.addEventListener('mousemove', onMove); host.addEventListener('mouseleave', onLeave);
    let raf = 0, placed = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = host.getBoundingClientRect(), p = box.parentElement?.getBoundingClientRect();
      if (!p || r.width === 0 || r.height === 0) return;
      // Sit exactly over the main canvas (it may be letterboxed for the chosen shape), at its drawing-buffer size.
      const key = `${r.left - p.left},${r.top - p.top},${r.width},${r.height},${host.width},${host.height}`;
      if (key !== placed) {
        placed = key;
        box.style.left = `${r.left - p.left}px`; box.style.top = `${r.top - p.top}px`; box.style.width = `${r.width}px`; box.style.height = `${r.height}px`;
        const scale = Math.min(1, MAX_PX / Math.max(1, host.width, host.height));
        c.width = Math.max(1, Math.round(host.width * scale)); c.height = Math.max(1, Math.round(host.height * scale));
      }
      draw(s, c.width, c.height, clockNow() ?? 0, uniforms, mouse ?? [0.3 * c.width, 0.6 * c.height]);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); host.removeEventListener('mousemove', onMove); host.removeEventListener('mouseleave', onLeave); };
  }, [source, uniforms, host, generation]);

  const drag = useRef(false);
  const at = (clientX: number) => { const b = boxRef.current?.getBoundingClientRect(); if (b && b.width > 0) setSplit(clampSplit((clientX - b.left) / b.width)); };
  const chip = { position: 'absolute' as const, top: 8, padding: '3px 8px', borderRadius: 6, background: 'rgba(13,13,18,0.7)', color: '#e8e9ef', font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' as const, pointerEvents: 'none' as const };
  return (
    <div ref={boxRef} data-split-overlay="" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 4, overflow: 'hidden' }}>
      <canvas ref={ref} width={1} height={1} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', clipPath: `inset(0 ${(1 - split) * 100}% 0 0)`, opacity: error ? 0.3 : 1 }} />
      {error && <div style={{ position: 'absolute', left: 0, top: 0, width: `${split * 100}%`, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', font: `600 12px ${fontFamily.ui}`, textAlign: 'center', padding: 12, background: 'rgba(0,0,0,0.35)' }}>{error}</div>}
      <span style={{ ...chip, left: 8 }}>Source</span>
      <span style={{ ...chip, right: 8 }}>Converted</span>
      <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: `${split * 100}%`, width: 1.5, marginLeft: -0.75, background: 'rgba(255,255,255,0.85)', boxShadow: '0 0 2px rgba(0,0,0,0.6)' }} />
      <div
        role="slider"
        aria-label="Source / converted divider: the source shows to its left, the converted graph to its right"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split * 100)}
        tabIndex={0}
        title="Drag: the source is left of the divider, the converted graph right of it"
        onPointerDown={e => { if (e.button !== 0) return; drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); e.stopPropagation(); e.preventDefault(); }}
        onPointerMove={e => { if (drag.current) { at(e.clientX); e.stopPropagation(); } }}
        onPointerUp={e => { drag.current = false; e.stopPropagation(); }}
        onPointerCancel={() => { drag.current = false; }}
        onKeyDown={e => { const step = e.shiftKey ? 0.1 : 0.02; if (e.key === 'ArrowLeft') { setSplit(split - step); e.preventDefault(); } else if (e.key === 'ArrowRight') { setSplit(split + step); e.preventDefault(); } }}
        style={{ position: 'absolute', top: 0, bottom: 0, left: `${split * 100}%`, width: 18, marginLeft: -9, cursor: 'col-resize', pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}
      >
        <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#f2f2f7', boxShadow: '0 1px 4px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#101016', font: `700 11px ${fontFamily.ui}` }}>⇔</span>
      </div>
    </div>
  );
}
