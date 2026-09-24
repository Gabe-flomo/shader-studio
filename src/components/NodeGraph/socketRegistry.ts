// ─── Graph layout registry ───────────────────────────────────────────────────
// Everything the wire layer, minimap and drag code need to know about *where
// things are* without asking React or the DOM per render:
//
//   • socket offsets   — each socket dot's centre relative to its card's
//                        top-left, in world units. Measured once when the dot
//                        mounts and again when its card resizes, so a wire's
//                        endpoint is `node.position + offset`: pure data, no
//                        getBoundingClientRect per wire per render, and no
//                        dependence on pan/zoom.
//   • card sizes       — from the same ResizeObserver; used for viewport culling.
//   • drag positions   — the live position of a card being dragged. The store
//                        is only written once, on mouseup, so during the drag
//                        this is the truth the wires follow.
//   • view transform   — pan/zoom applied imperatively during gestures, ahead
//                        of the React state commit, for the minimap.
//
// Consumers subscribe and get one rAF-batched notification per frame, so a
// drag or resize costs one wire-layer render per frame, not one per event.
//
// Kept in its own file so NodeGraph.tsx only exports React components —
// required for Vite Fast Refresh (HMR) to work correctly.

export interface Pt { x: number; y: number }
export interface Size { w: number; h: number }

const socketKey = (nodeId: string, dir: 'in' | 'out', key: string) => `${nodeId}:${dir}:${key}`;

const socketEls     = new Map<string, HTMLElement>();
const socketOffsets = new Map<string, Pt>();
const socketNode    = new Map<string, string>(); // socket key → nodeId, for per-card re-measure
const cardEls       = new Map<string, HTMLElement>();
const cardSizes     = new Map<string, Size>();
const dragPositions = new Map<string, Pt>();

let zoomGetter: () => number = () => 1;
/** NodeGraph tells the registry how to read the live zoom so screen-space
 *  measurements can be converted back to world units. */
export function setLayoutZoomGetter(fn: () => number) { zoomGetter = fn; }

// ── Change notification (rAF-batched) ───────────────────────────────────────
const layoutListeners = new Set<() => void>();
let notifyScheduled = false;
export function subscribeLayout(cb: () => void): () => void {
  layoutListeners.add(cb);
  return () => { layoutListeners.delete(cb); };
}
function scheduleNotify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  requestAnimationFrame(() => {
    notifyScheduled = false;
    for (const cb of layoutListeners) cb();
  });
}

// ── Card size notifications (rAF-batched, separate channel) ─────────────────
// Culling wants to know when a card's *size* becomes known or changes — not
// about every drag frame — so it gets its own subscription.
const sizeListeners = new Set<() => void>();
let sizeNotifyScheduled = false;
export function subscribeCardSizes(cb: () => void): () => void {
  sizeListeners.add(cb);
  return () => { sizeListeners.delete(cb); };
}
function scheduleSizeNotify() {
  if (sizeNotifyScheduled) return;
  sizeNotifyScheduled = true;
  requestAnimationFrame(() => {
    sizeNotifyScheduled = false;
    for (const cb of sizeListeners) cb();
  });
}

// ── Card resize tracking ────────────────────────────────────────────────────
// One observer for every card; a resize re-measures that card's sockets
// (collapsing a section, a param panel opening, fonts loading).
const cardObserver = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(entries => {
      let sizeChanged = false;
      for (const entry of entries) {
        const nodeId = (entry.target as HTMLElement).dataset.nodeId;
        if (!nodeId) continue;
        // contentRect is unaffected by the ancestor scale(), so it's already world units.
        const w = entry.contentRect.width, h = entry.contentRect.height;
        const prev = cardSizes.get(nodeId);
        if (!prev || prev.w !== w || prev.h !== h) {
          cardSizes.set(nodeId, { w, h });
          sizeChanged = true;
        }
        remeasureCard(nodeId);
      }
      scheduleNotify();
      if (sizeChanged) scheduleSizeNotify();
    })
  : null;

function cardOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-node-id]');
}

function measureSocket(k: string, el: HTMLElement, card: HTMLElement) {
  const z = zoomGetter() || 1;
  const cr = card.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  socketOffsets.set(k, {
    x: (er.left + er.width  / 2 - cr.left) / z,
    y: (er.top  + er.height / 2 - cr.top)  / z,
  });
}

function remeasureCard(nodeId: string) {
  const card = cardEls.get(nodeId);
  if (!card) return;
  for (const [k, id] of socketNode) {
    if (id !== nodeId) continue;
    const el = socketEls.get(k);
    if (el) measureSocket(k, el, card);
  }
}

/**
 * Called from each socket dot's ref callback. On mount, measures the dot's
 * offset inside its card and starts watching that card for resizes. On
 * unmount the *offset is kept*: a card that scrolled out of view (culled) or
 * is mid-remount still has wires, and those wires need an endpoint.
 */
export function registerSocket(nodeId: string, dir: 'in' | 'out', key: string, el: HTMLElement | null) {
  const k = socketKey(nodeId, dir, key);
  if (el) {
    socketEls.set(k, el);
    socketNode.set(k, nodeId);
    const card = cardOf(el);
    if (card) {
      if (cardEls.get(nodeId) !== card) {
        const prev = cardEls.get(nodeId);
        if (prev) cardObserver?.unobserve(prev);
        cardEls.set(nodeId, card);
        cardObserver?.observe(card);
      }
      measureSocket(k, el, card);
    }
  } else {
    socketEls.delete(k);
    // Last socket of this card gone → stop observing the (now detached) card.
    let stillMounted = false;
    for (const [sk, id] of socketNode) {
      if (id === nodeId && sk !== k && socketEls.has(sk)) { stillMounted = true; break; }
    }
    if (!stillMounted) {
      const card = cardEls.get(nodeId);
      if (card) cardObserver?.unobserve(card);
      cardEls.delete(nodeId);
    }
  }
  scheduleNotify();
}

/** Socket centre relative to its card origin (world units), if ever measured. */
export function getSocketOffset(nodeId: string, dir: 'in' | 'out', key: string): Pt | undefined {
  return socketOffsets.get(socketKey(nodeId, dir, key));
}

/** The socket's DOM element while its card is mounted (hit-testing helpers). */
export function getSocketElement(nodeId: string, dir: 'in' | 'out', key: string): HTMLElement | undefined {
  return socketEls.get(socketKey(nodeId, dir, key));
}

/** Last observed card size in world units; undefined until the card has mounted once. */
export function getCardSize(nodeId: string): Size | undefined {
  return cardSizes.get(nodeId);
}

/** Drop everything remembered about a node (call when it is deleted). */
export function forgetNodeLayout(nodeId: string) {
  for (const [k, id] of socketNode) {
    if (id !== nodeId) continue;
    socketNode.delete(k); socketEls.delete(k); socketOffsets.delete(k);
  }
  const card = cardEls.get(nodeId);
  if (card) cardObserver?.unobserve(card);
  cardEls.delete(nodeId);
  cardSizes.delete(nodeId);
  dragPositions.delete(nodeId);
}

// ── Live drag positions ─────────────────────────────────────────────────────
/** Set while a card is being dragged; null when the drag ends (the store then owns the position). */
export function setDragPosition(nodeId: string, pos: Pt | null) {
  if (pos) dragPositions.set(nodeId, pos); else dragPositions.delete(nodeId);
  scheduleNotify();
}
export function getDragPosition(nodeId: string): Pt | undefined {
  return dragPositions.get(nodeId);
}
export function isDragging(nodeId: string): boolean {
  return dragPositions.has(nodeId);
}

// ── View transform (pan / zoom) ─────────────────────────────────────────────
// NodeGraph applies pan/zoom to the DOM directly during a gesture and only
// commits React state at the end; anything that wants to follow the gesture
// live (the minimap) subscribes here.
let view = { pan: { x: 0, y: 0 }, zoom: 1 };
const viewListeners = new Set<(v: { pan: Pt; zoom: number }) => void>();
export function publishView(pan: Pt, zoom: number) {
  view = { pan, zoom };
  for (const cb of viewListeners) cb(view);
}
export function getView() { return view; }
export function subscribeView(cb: (v: { pan: Pt; zoom: number }) => void): () => void {
  viewListeners.add(cb);
  return () => { viewListeners.delete(cb); };
}
