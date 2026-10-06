/**
 * longPress.ts — "hold a finger still for half a second" as a small state machine, for the
 * places a mouse uses a right-click (the wire badge's "is this typical?", a function chip's
 * "how is this used?"). Same timing as ContextMenuArea: 500 ms, and moving more than 10 px
 * first (a scroll, a drag) cancels it. Only touch and pen start one; a mouse keeps its
 * right-click. After a hold fires, the click that follows the finger lifting is swallowed
 * (`consumeClick`) so the hold doesn't also count as a tap.
 *
 * `useLongPress` wraps it for React: spread its handlers on the element.
 */
import { useEffect, useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP_PX = 10;

export interface LongPressTimers { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void }
const realTimers: LongPressTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: t => clearTimeout(t as ReturnType<typeof setTimeout>) };

export interface PointerLike { pointerType: string; clientX: number; clientY: number }

export interface LongPress {
  down: (e: PointerLike) => void;
  move: (e: PointerLike) => void;
  up: () => void;
  cancel: () => void;
  /** True once after a hold fired: the click that follows should be ignored. */
  consumeClick: () => boolean;
}

export function createLongPress(onLong: (x: number, y: number) => void, timers: LongPressTimers = realTimers, holdMs = LONG_PRESS_MS, slop = LONG_PRESS_SLOP_PX): LongPress {
  let hold: { t: unknown; x: number; y: number } | null = null;
  let fired = false;
  const cancel = () => { if (hold) { timers.clear(hold.t); hold = null; } };
  return {
    down(e) {
      cancel();
      fired = false;
      if (e.pointerType === 'mouse') return;
      const x = e.clientX, y = e.clientY;
      hold = { x, y, t: timers.set(() => { hold = null; fired = true; onLong(x, y); }, holdMs) };
    },
    move(e) { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > slop) cancel(); },
    up: cancel,
    cancel,
    consumeClick() { const f = fired; fired = false; return f; },
  };
}

/** Pointer handlers for an element that opens something on a long press (touch and pen only). */
export function useLongPress(onLong: (x: number, y: number) => void) {
  const cb = useRef(onLong);
  cb.current = onLong;
  const lp = useRef<LongPress | null>(null);
  if (!lp.current) lp.current = createLongPress((x, y) => cb.current(x, y));
  useEffect(() => () => lp.current?.cancel(), []);
  const l = lp.current;
  return {
    onPointerDown: (e: RPointerEvent) => l.down(e),
    onPointerMove: (e: RPointerEvent) => l.move(e),
    onPointerUp: () => l.up(),
    onPointerCancel: () => l.cancel(),
    /** Call first in onClick: true means the press was a hold, so skip the tap action. */
    consumeClick: () => l.consumeClick(),
    // iOS would otherwise show its own callout or text selection under the finger.
    style: { WebkitTouchCallout: 'none', userSelect: 'none' } as CSSProperties,
  };
}

/**
 * A "?" or similar that opens on hover with a mouse and on a tap with a finger: the next open
 * state after a click. A mouse's click leaves hover in charge (no change).
 */
export function tapToggle(open: boolean, pointerType: string | null): boolean {
  return pointerType === 'mouse' ? open : !open;
}
