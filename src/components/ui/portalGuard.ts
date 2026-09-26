/**
 * portalGuard — spread on the root element of anything rendered through a
 * portal (dialogs, popovers, menus, sheets, toasts).
 *
 * React sends a portal's events up the component tree, not the page: a dialog
 * opened from a node card is drawn over everything, yet its wheel and presses
 * would still reach the node and the canvas behind it, which then pan, zoom,
 * start a drag or deselect. Stopping them at the portal's root keeps whatever
 * sits behind a pop-up still while you use the pop-up.
 *
 * Only events that *start* something are stopped. React's stopPropagation also
 * stops the browser event, and drags inside pop-ups (the colour square, the
 * keyframe graph, curve pads) follow the pointer with window listeners: moves
 * and releases must reach the window. A drag started behind a pop-up ignores
 * them, so letting them through is safe. Keys are left alone too: Esc and
 * shortcuts are handled with window listeners.
 */
import type { SyntheticEvent } from 'react';

const stop = (e: SyntheticEvent) => e.stopPropagation();

export const portalGuard = {
  onWheel: stop,
  onMouseDown: stop,
  onPointerDown: stop,
  onDoubleClick: stop,
  onContextMenu: stop,
  onTouchStart: stop,
} as const;
