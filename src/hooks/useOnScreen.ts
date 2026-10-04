/**
 * useOnScreen — a ref that says whether an element is on screen (in the
 * viewport and not clipped away by a scrolled parent), for frame loops that
 * can skip drawing what nobody sees. A ref, not state: changing it renders
 * nothing. True until the first report, and always without IntersectionObserver.
 */
import { useEffect, useRef, type RefObject } from 'react';

export function useOnScreen(target: RefObject<Element | null>): RefObject<boolean> {
  const shown = useRef(true);
  useEffect(() => {
    const el = target.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => { for (const e of es) shown.current = e.isIntersecting; });
    io.observe(el);
    return () => { io.disconnect(); shown.current = true; };
  }, [target]);
  return shown;
}
