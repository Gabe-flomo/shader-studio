/**
 * FinishOverPreview — the graph's Finish drawn over a builder's own preview canvas, so the
 * builder shows the picture as the Studio will (the same kit renderer, play/kit/finish.js, as the
 * main preview and exports). The preview canvas keeps its drawing buffer, so it is read every
 * animation frame from here. Nothing is drawn (and nothing costs) while the Finish is off or empty,
 * or on Free, where the Finish doesn't play.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useCan } from '../../lib/plan';
import { fnActive, fnCreate, type FnRenderer } from '../../play/kit/finish.js';
import { renderableFinish } from '../../types/playFinish';

/** The most pixels the builder's Finish draws a frame (the preview is small). */
const MAX_PIXELS = 1280 * 720;

export function FinishOverPreview({ source }: { source: RefObject<HTMLCanvasElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const finish = useNodeGraphStore(s => s.play.finish);
  const ok = useCan('play.finish');
  const active = ok && fnActive(finish);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let r: FnRenderer | null = fnCreate(el);
    if (!r.ok) { r.dispose(); return; }
    let raf = 0;
    const t0 = performance.now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const src = source.current, f = renderableFinish(finishRef.current);
      if (!src || !f || !r || src.width < 2 || src.height < 2) return;
      const k = Math.min(1, Math.sqrt(MAX_PIXELS / (src.width * src.height)));
      const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
      r.draw({ finish: f, picture: src, width: w, height: h, time: (performance.now() - t0) / 1000 });
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); r?.dispose(); r = null; };
  }, [active, source]);
  if (!active) return null;
  return <canvas ref={ref} data-builder-finish aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
