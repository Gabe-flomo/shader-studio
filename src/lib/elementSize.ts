/**
 * elementSize — an element's clientWidth/clientHeight without a forced layout
 * on every animation frame. Reading clientWidth in a frame loop after anything
 * changed the page makes the browser lay it out there and then (it showed as
 * ~0.4 ms a frame for the Play overlay). The first read is direct; after that
 * one shared ResizeObserver keeps the numbers, refreshed when the box changes
 * (read in its callback, where the layout is already done).
 */

type Size = { w: number; h: number };

const sizes = new WeakMap<Element, Size>();
let ro: ResizeObserver | null = null;

function observer(): ResizeObserver | null {
  if (ro || typeof ResizeObserver === 'undefined') return ro;
  ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const s = sizes.get(e.target);
      if (s) { s.w = e.target.clientWidth; s.h = e.target.clientHeight; }
    }
  });
  return ro;
}

/** clientWidth and clientHeight, as of the last layout (kept by a ResizeObserver). The returned object is live: don't keep it. */
export function clientSize(el: Element): Size {
  let s = sizes.get(el);
  if (s) return s;
  s = { w: el.clientWidth, h: el.clientHeight };
  const o = observer();
  // Without ResizeObserver (old browsers, tests) every read is direct, as before.
  if (!o) return s;
  sizes.set(el, s);
  o.observe(el);
  return s;
}

/** Stop watching an element (it is being dropped). */
export function forgetClientSize(el: Element): void {
  if (!sizes.has(el)) return;
  sizes.delete(el);
  ro?.unobserve(el);
}
