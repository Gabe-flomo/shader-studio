/**
 * useNarrow — whether an element is narrower than `below` px, kept up to date
 * with a ResizeObserver: a card that lays itself out differently when its
 * column is narrow (not the window: a sidebar can be narrow on a wide screen).
 * False until measured, and where there is no layout (tests).
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

export function useNarrow(ref: RefObject<HTMLElement | null>, below: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => { const w = el.clientWidth; if (w > 0) setNarrow(w < below); };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return narrow;
}
