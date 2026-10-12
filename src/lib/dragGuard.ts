/**
 * dragGuard — keeps HTML5 drag-and-drop (reordering cards and rows) from starting where it shouldn't.
 *
 * WebKit (the desktop app's WKWebView, Safari) starts a native drag of a `draggable` ancestor when a
 * mouse press inside it moves far enough, even when the press landed on a slider whose pointerdown
 * captured the pointer. Chrome suppresses that; WebKit doesn't, so dragging a slider past its edge
 * pulled the whole card away as a ghost image. Two rules, for every platform:
 *
 * 1. Handle-only cards. An element marked `data-drag-by-handle` is draggable only while a press began
 *    on one of its own `data-drag-handle` elements: this sets its `draggable` attribute at each
 *    pointerdown (so don't pass `draggable` from React on such an element), and its dragstart is
 *    cancelled unless the press began on its handle.
 * 2. Controls never drag their row. A dragstart is cancelled when the press began on a control
 *    (field, slider, select, editable text, `data-no-drag`) inside the element being dragged.
 */

export const DRAG_HANDLE = 'data-drag-handle';
export const DRAG_BY_HANDLE = 'data-drag-by-handle';

/** Spread on a handle-only card (rule 1). */
export const dragByHandle = { [DRAG_BY_HANDLE]: '' } as const;
/** Spread on that card's grip. */
export const dragHandle = { [DRAG_HANDLE]: '' } as const;

const CONTROL = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="spinbutton"], [data-no-drag]';

/** The handle-only card a handle (or any element) belongs to: its nearest marked ancestor. */
const ownerOf = (el: Element): Element | null => el.closest(`[${DRAG_BY_HANDLE}]`);

/** Did the press at `pressed` land on a handle of `owner` (not of a card nested inside it)? */
function onHandleOf(owner: Element, pressed: Element): boolean {
  for (let h = pressed.closest(`[${DRAG_HANDLE}]`); h; h = h.parentElement?.closest(`[${DRAG_HANDLE}]`) ?? null) {
    if (!owner.contains(h)) return false;
    if (ownerOf(h) === owner) return true;
  }
  return false;
}

/** May a drag of `source` start, given the press began on `pressed`? */
export function dragStartAllowed(source: Element, pressed: Element | null): boolean {
  if (source.hasAttribute(DRAG_BY_HANDLE)) return !!pressed && source.contains(pressed) && onHandleOf(source, pressed);
  if (!pressed || !source.contains(pressed)) return true;
  const control = pressed.closest(CONTROL);
  return !(control && control !== source && source.contains(control));
}

/** Rule 1 at pointerdown: each handle-only card around the press is draggable only from its handle. */
export function armHandleCards(pressed: Element | null): void {
  for (let owner = pressed && ownerOf(pressed); owner; owner = owner.parentElement ? ownerOf(owner.parentElement) : null) {
    owner.setAttribute('draggable', onHandleOf(owner, pressed!) ? 'true' : 'false');
  }
}

let installed = false;

export function installDragGuard(target: Window = window): () => void {
  if (installed && target === window) return () => {};
  if (target === window) installed = true;
  let pressed: Element | null = null;
  const down = (e: Event) => {
    pressed = e.target instanceof Element ? e.target : null;
    armHandleCards(pressed);
  };
  const start = (e: DragEvent) => {
    const source = e.target instanceof Element ? e.target : null;
    if (!source || dragStartAllowed(source, pressed)) return;
    e.preventDefault();
    // Before React's root listener: the card's own onDragStart (drag state, drop targets) never runs.
    e.stopPropagation();
  };
  // Capture on the window: before any element's own handlers, so none can hide the press from it.
  target.addEventListener('pointerdown', down, true);
  target.addEventListener('dragstart', start, true);
  return () => {
    target.removeEventListener('pointerdown', down, true);
    target.removeEventListener('dragstart', start, true);
    if (target === window) installed = false;
  };
}
