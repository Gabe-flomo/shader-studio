/**
 * The latest read of the Overlay's space (and position), from ShaderCanvas (overlayRunner.ts) to
 * the overlay drawing. Plain pub/sub, no React state.
 */
import type { Field2 } from './overlayMath';

export interface OverlayFrame {
  /** The chosen space's values over the picture (null with an error). */
  space: Field2 | null;
  /** The app's plain UV at the same texels (for the Warp blend). */
  plain: Field2;
  /** Position mode: the point's value, else null. */
  pos: [number, number] | null;
  /** Why nothing could be read ("not in the picture's shader", "compiling"…). */
  error: string | null;
  /** Key of what was read (mode, space, position) so a stale frame is never drawn. */
  key: string;
  seq: number;
}

let latest: OverlayFrame | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export const overlayBus = {
  get: (): OverlayFrame | null => latest,
  publish(f: Omit<OverlayFrame, 'seq'>) {
    latest = { ...f, seq: ++seq };
    for (const fn of listeners) fn();
  },
  clear() {
    if (!latest) return;
    latest = null;
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
