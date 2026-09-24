// ─── Ref-based node drag ─────────────────────────────────────────────────────
// One implementation behind every card header's mousedown / touchstart.
//
// During the drag nothing is written to the store: the card is moved by
// setting its `left`/`top` directly, and the live position goes into the
// layout registry so the wire layer can follow it (one rAF-batched redraw per
// frame, touching only the affected wires). The store is written exactly once,
// on release, through `commit` — which is also what makes a whole drag a
// single undo step instead of one per mousemove.
//
// React re-renders mid-drag are safe: the card's `left`/`top` props still hold
// the pre-drag position, so React sees no change and doesn't touch the DOM
// style we set. On commit the props catch up to the value already applied.

import { setDragPosition, type Pt } from './socketRegistry';

export interface NodeDragOptions {
  nodeId: string;
  /** The card root (`[data-node-id]`) — usually `event.currentTarget.closest(...)`. */
  cardEl: HTMLElement | null;
  /** Pointer position in screen px at drag start. */
  startClient: Pt;
  /** Card position at drag start (world units). */
  startPosition: Pt;
  /** Live zoom, read at each move so a zoom mid-drag doesn't skew the card. */
  getZoom: () => number;
  /** Screen-px movement before the gesture counts as a drag (default 3). */
  threshold?: number;
  /** Write the final position to the store — called once, only if the card moved. */
  commit: (position: Pt) => void;
  /** After release; `dragged` is false for a plain click. */
  onSettle?: (dragged: boolean) => void;
}

function applyCardPosition(cardEl: HTMLElement | null, pos: Pt) {
  if (!cardEl) return;
  cardEl.style.left = `${pos.x}px`;
  cardEl.style.top  = `${pos.y}px`;
}

function positionFor(o: NodeDragOptions, client: Pt): Pt {
  const z = o.getZoom() || 1;
  return {
    x: o.startPosition.x + (client.x - o.startClient.x) / z,
    y: o.startPosition.y + (client.y - o.startClient.y) / z,
  };
}

/** Start a mouse drag; listeners are attached to `window` and removed on mouseup. */
export function startNodeMouseDrag(o: NodeDragOptions) {
  const threshold = o.threshold ?? 3;
  let dragged = false;
  let last: Pt = o.startPosition;

  document.body.style.userSelect = 'none';
  (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';
  const suppressSelect = (ev: Event) => ev.preventDefault();

  const onMove = (ev: MouseEvent) => {
    if (!dragged && (Math.abs(ev.clientX - o.startClient.x) > threshold || Math.abs(ev.clientY - o.startClient.y) > threshold)) {
      dragged = true;
    }
    if (!dragged) return;
    last = positionFor(o, { x: ev.clientX, y: ev.clientY });
    applyCardPosition(o.cardEl, last);
    setDragPosition(o.nodeId, last);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('selectstart', suppressSelect);
    document.body.style.userSelect = '';
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
    setDragPosition(o.nodeId, null);
    if (dragged) o.commit(last);
    o.onSettle?.(dragged);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('selectstart', suppressSelect);
}

/** Touch counterpart; `preventDefault` is called on moves once the gesture is a drag. */
export function startNodeTouchDrag(o: NodeDragOptions) {
  const threshold = o.threshold ?? 5;
  let dragged = false;
  let last: Pt = o.startPosition;

  const onMove = (ev: TouchEvent) => {
    const t = ev.touches[0];
    if (!t) return;
    if (!dragged && (Math.abs(t.clientX - o.startClient.x) > threshold || Math.abs(t.clientY - o.startClient.y) > threshold)) {
      dragged = true;
    }
    if (!dragged) return;
    ev.preventDefault();
    last = positionFor(o, { x: t.clientX, y: t.clientY });
    applyCardPosition(o.cardEl, last);
    setDragPosition(o.nodeId, last);
  };
  const onEnd = () => {
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
    window.removeEventListener('touchcancel', onEnd);
    setDragPosition(o.nodeId, null);
    if (dragged) o.commit(last);
    o.onSettle?.(dragged);
  };
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd);
  window.addEventListener('touchcancel', onEnd);
}
