/**
 * The lens's reference distance (agentBuilder/diagram.ts lensFor): the feelers' length when the
 * section was picked, kept while a slider moves within reach (keepRef), so the diagram's feelers
 * grow and shrink as you drag; past reach the lens zooms smoothly with the value (never a jump).
 * A big jump in one go (a typed value, a preset: more than 1.6× either way) zooms over a third of
 * a second, so you see the ring grow (or shrink) before the lens re-fits round it.
 */
import { useEffect, useRef, useState } from 'react';
import { keepRef } from '../../agentBuilder/diagram';

const JUMP = 1.6;
const ZOOM_MS = 320;

export function useLensRef(distance: number, section: string, lo?: number, hi?: number): number {
  const [s, setS] = useState({ ref: distance, section });
  let next = s;
  if (s.section !== section) next = { ref: distance, section };
  else {
    const r = keepRef(s.ref, distance, lo, hi);
    if (r !== s.ref) next = { ref: r, section };
  }
  // Adjusting state while rendering (React's "storing information from previous renders").
  if (next !== s) setS(next);
  // The zoom shown: eased toward the reference after a jump.
  const [shown, setShown] = useState(next.ref);
  const anim = useRef<{ from: number; to: number; t0: number; raf: number } | null>(null);
  const target = next.ref;
  const sameSection = useRef(section);
  useEffect(() => {
    const jump = Math.max(target / Math.max(shown, 1e-9), shown / Math.max(target, 1e-9)) > JUMP;
    if (sameSection.current !== section || !jump || typeof requestAnimationFrame === 'undefined') {
      sameSection.current = section;
      if (anim.current) cancelAnimationFrame(anim.current.raf);
      anim.current = null;
      setShown(target);
      return;
    }
    const from = shown, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ZOOM_MS);
      const e = 1 - (1 - k) ** 3;
      setShown(from * Math.pow(target / from, e));
      if (k < 1 && anim.current) anim.current.raf = requestAnimationFrame(step);
      else anim.current = null;
    };
    if (anim.current) cancelAnimationFrame(anim.current.raf);
    anim.current = { from, to: target, t0, raf: requestAnimationFrame(step) };
    return () => { if (anim.current) cancelAnimationFrame(anim.current.raf); anim.current = null; };
  }, [target, section]); // eslint-disable-line react-hooks/exhaustive-deps
  return anim.current ? shown : target;
}
