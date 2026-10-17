/**
 * useOrbitGestures — a builder viewport's 3D camera gestures on one element (the Agents builder's 3D viewport):
 *
 *  - drag: turn round the point looked at (`orbit`, with the pixels moved since the drag began);
 *  - right-drag, middle-drag, Shift+drag or a two-finger touch drag: move that point (`pan`);
 *  - wheel or a trackpad pinch (ctrl + wheel): closer or further (`zoom`);
 *  - two fingers on a touch screen: pan and pinch together (`pinch`);
 *  - double-click: back to the view a new group starts with (`reset`).
 *
 * The numbers each gesture writes come from builders/orbitMath.ts, shared with the 3D Scene Builder's viewport.
 * `begin` / `end` bracket a drag or a pinch (one undo step). Returns the element's handlers and a ref for it
 * (the wheel needs a listener that may prevent the page scrolling).
 */
import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';

export interface OrbitHandlers {
  /** A drag that turns: `dx`, `dy` pixels since it began. */
  orbit: (dx: number, dy: number) => void;
  /** A pan: `dx`, `dy` pixels since it began. */
  pan: (dx: number, dy: number) => void;
  /** Zoom by a wheel step (deltaY; `pinch` for a trackpad pinch: the wheel with ctrl). */
  zoom: (z: { deltaY: number; pinch: boolean }) => void;
  /** Two fingers: the middle moved `dx`, `dy` pixels and the spread grew by `ratio` (now / then), since they came down. */
  pinch: (dx: number, dy: number, ratio: number) => void;
  reset: () => void;
  /** A drag or pinch starts (`kind`), or ends. */
  begin?: (kind: 'orbit' | 'pan' | 'pinch') => void;
  end?: () => void;
}

type Gesture =
  | { kind: 'orbit' | 'pan'; id: number; x: number; y: number; moved: boolean }
  | { kind: 'pinch'; cx: number; cy: number; spread: number };

/** Which gesture a pointer press starts: right or middle button, or Shift, pans; the left button turns. */
export function gestureFor(e: { button: number; shiftKey: boolean }): 'orbit' | 'pan' | null {
  if (e.button === 1 || e.button === 2) return 'pan';
  if (e.button === 0) return e.shiftKey ? 'pan' : 'orbit';
  return null;
}

export function useOrbitGestures<T extends HTMLElement>(handlers: OrbitHandlers) {
  const ref = useRef<T>(null);
  // The latest handlers, for the listeners (set after each render).
  const h = useRef(handlers);
  useEffect(() => { h.current = handlers; });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      h.current.zoom({ deltaY: e.deltaY, pinch: e.ctrlKey });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const twoFinger = (): Gesture | null => {
    const ps = [...pointers.current.values()];
    if (ps.length < 2) return null;
    const [a, b] = ps;
    return { kind: 'pinch', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, spread: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  };
  const finish = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g && (g.kind === 'pinch' || g.moved)) h.current.end?.();
  };

  const onPointerDown = (e: RPointerEvent<T>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2 && e.pointerType === 'touch') {
      // A second finger: the one-finger turn becomes a two-finger pan and pinch.
      finish();
      gesture.current = twoFinger();
      h.current.begin?.('pinch');
      return;
    }
    if (pointers.current.size > 1) return;
    const kind = gestureFor(e);
    if (!kind) return;
    e.preventDefault();
    gesture.current = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: RPointerEvent<T>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      const now = twoFinger();
      if (!now || now.kind !== 'pinch') return;
      h.current.pinch(now.cx - g.cx, now.cy - g.cy, now.spread / g.spread);
      return;
    }
    if (e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      gesture.current = { ...g, moved: true };
      h.current.begin?.(g.kind);
    }
    if (g.kind === 'orbit') h.current.orbit(dx, dy);
    else h.current.pan(dx, dy);
  };

  const onPointerUp = (e: RPointerEvent<T>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' ? pointers.current.size < 2 : e.pointerId === g.id) finish();
  };

  return {
    ref,
    handlers: {
      onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
      onDoubleClick: () => h.current.reset(),
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    },
  };
}
