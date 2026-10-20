/**
 * LiveViewport — a builder's centre: the main preview, live (lib/previewMirror.ts), drawn to fit,
 * with an overlay drawn over it (a diagram) that knows where the picture sits. While it is open
 * the builder holds the picture: every frame the main preview draws is copied here. When no frame
 * comes (the preview is hidden in this layout) it says so.
 *
 * With `ownSize` (the Splat builder) the preview draws at this viewport's size, so the viewport takes the preview's
 * canvas itself (adoptPreviewCanvas) rather than copying it: one draw a frame, straight to the screen, and nothing
 * drawn under the window. It gives it back when it closes. Without a canvas to take (none yet, or another viewport has
 * it) it copies, as before.
 *
 * With `ownSize` and an `aspect` (Texture Lab: the source picture's width / height) the preview is drawn at the
 * largest rect of that shape inside the viewport (lib/previewSize.ts ownSizeRect), letterboxed and centred, so a 16:9 photo stays 16:9
 * in a near-square window instead of being stretched to it. The overlay's `image` is that same rect.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { adoptPreviewCanvas, mirrorPreview, placeLentCanvas, wakePreview } from '../../../lib/previewMirror';
import { ownSizeRect, setPreviewSizeOverride } from '../../../lib/previewSize';
import { useTokens } from '../../../theme/themeStore';
import { containRect } from '../../../agentBuilder/diagram';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { PreviewClock } from '../PreviewClock';

export interface ViewRect { x: number; y: number; w: number; h: number }

export function LiveViewport({ overlay, emptyNote = 'The preview is hidden: show it to see the walkers here.', ownSize = false, aspect = null, clock = false }: {
  overlay?: (box: { w: number; h: number; image: ViewRect }) => ReactNode;
  emptyNote?: string;
  /** Draw the main preview at this viewport's size while it is open (lib/previewSize.ts), not the panel's shape. */
  ownSize?: boolean;
  /**
   * With `ownSize`: the picture's shape (width / height). The preview is drawn at the largest rect of that shape in the
   * viewport, letterboxed, instead of at the whole viewport. Null: the whole viewport (the Splat builder's).
   */
  aspect?: number | null;
  /**
   * Pause / Play and ↺ over the picture (PreviewClock), as the builders with their own preview canvas have. The picture
   * is the main preview's, so Pause is the app's clock (the Time strip's) and ↺ the app's one true reset.
   */
  clock?: boolean;
}) {
  const tk = useTokens();
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [src, setSrc] = useState({ w: 16, h: 9 });
  const [frames, setFrames] = useState<'waiting' | 'live' | 'none'>('waiting');
  const lentRef = useRef(false);
  const ownRef = useRef<ViewRect | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => { const r = el.getBoundingClientRect(); setBox(b => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height })); };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let got = false;
    // Its own size: the canvas itself, drawn into this box (no copy a frame).
    const copy = canvasRef.current;
    let giveBack: (() => void) | null = null;
    // Take it when it is free. It can still be lent to the viewport this one replaces (the window's layout changed and
    // its centre mounted again before the old one let go), so a frame that arrives while copying tries again.
    const take = () => {
      if (!ownSize || giveBack || !boxRef.current) return;
      giveBack = adoptPreviewCanvas(boxRef.current);
      if (!giveBack) return;
      lentRef.current = true;
      if (copy) copy.style.display = 'none';
      const at = ownRef.current;
      if (at) placeLentCanvas(boxRef.current, at.x, at.y);
    };
    take();
    const none = setTimeout(() => { if (!got) setFrames('none'); }, 1500);
    // A paused clock draws only when asked. The first ask (mirrorPreview's) can land while the preview is still held
    // by the window it opened from (the Scene builder's kind page) and draw nothing, so ask again until a frame comes:
    // a paused preview then shows its last frame instead of "hidden". One frame each, only until the first arrives.
    const retry = setInterval(() => { if (got) clearInterval(retry); else wakePreview(); }, 250);
    const stop = mirrorPreview(frame => {
      const c = canvasRef.current, el = boxRef.current;
      if (!c || !el) return;
      if (!got) { got = true; setFrames('live'); clearInterval(retry); }
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h || !frame.width || !frame.height) return;
      take();
      if (giveBack) { setSrc(s => (s.w === frame.width && s.h === frame.height ? s : { w: frame.width, h: frame.height })); return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      setSrc(s => (s.w === frame.width && s.h === frame.height ? s : { w: frame.width, h: frame.height }));
      const r = containRect(w, h, frame.width, frame.height);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(frame, r.x, r.y, r.w, r.h);
    });
    return () => {
      clearTimeout(none); clearInterval(retry); stop();
      lentRef.current = false;
      giveBack?.();
      if (copy) copy.style.display = 'block';
    };
    // ownSize is fixed for a viewport's life (a builder passes it or not).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Its own size: the main preview draws at the viewport's size, or the picture's shape inside it (and goes back to
  // its panel's when it closes). The lent canvas sits at that rect.
  const own = ownSize ? ownSizeRect(box, aspect) : null;
  ownRef.current = own;
  useEffect(() => {
    if (!own || !own.w || !own.h) return;
    setPreviewSizeOverride({ width: own.w, height: own.h });
    if (lentRef.current && boxRef.current) placeLentCanvas(boxRef.current, own.x, own.y);
  }, [own?.x, own?.y, own?.w, own?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (ownSize ? () => setPreviewSizeOverride(null) : undefined), [ownSize]);

  // With a shape of its own the picture is that rect; otherwise where the frames' shape fits.
  const image = own && aspect ? own : containRect(box.w, box.h, src.w, src.h);
  return (
    <div ref={boxRef} data-live-viewport={frames} style={{ position: 'relative', flex: 1, minHeight: 0, background: tk.bg.render, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      {frames === 'none' && (
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 12.5, color: tk.text.faint, textAlign: 'center', maxWidth: 320 }}>{emptyNote}</span>
      )}
      {box.w > 0 && overlay?.({ w: box.w, h: box.h, image })}
      {clock && <ClockOverMain />}
    </div>
  );
}

/** The app's clock as a builder viewport's Pause / Play and ↺. */
function ClockOverMain() {
  const playing = useNodeGraphStore(s => s.timePlaying);
  const setPlaying = useNodeGraphStore(s => s.setTimePlaying);
  return <PreviewClock paused={!playing} onPause={() => setPlaying(!playing)} style={{ position: 'absolute', right: 10, bottom: 10, zIndex: 2 }} />;
}
