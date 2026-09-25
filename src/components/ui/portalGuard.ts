/**
 * portalGuard — spread on the root element of anything rendered through a
 * portal (dialogs, popovers, menus, sheets, toasts).
 *
 * React sends a portal's events up the component tree, not the page: a dialog
 * opened from a node card is drawn over everything, yet its wheel, mouse and
 * touch events would still reach the node and the canvas behind it, which
 * then pan, zoom, drag or deselect. Stopping them at the portal's root keeps
 * whatever sits behind a pop-up still while you use the pop-up.
 * Keys are left alone: nothing behind relies on them, and closing on Esc is
 * handled with window listeners.
 */
import type { SyntheticEvent } from 'react';

const stop = (e: SyntheticEvent) => e.stopPropagation();

export const portalGuard = {
  onWheel: stop,
  onMouseDown: stop, onMouseMove: stop, onMouseUp: stop,
  onPointerDown: stop, onPointerMove: stop, onPointerUp: stop,
  onClick: stop, onDoubleClick: stop, onContextMenu: stop,
  onTouchStart: stop, onTouchMove: stop, onTouchEnd: stop,
} as const;
