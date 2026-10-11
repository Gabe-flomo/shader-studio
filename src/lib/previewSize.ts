/**
 * previewSize — a builder's own size for the main preview while its viewport mirrors it
 * (components/builders/studio/LiveViewport.tsx `ownSize`). The Splat builder's picture is the main preview's, so
 * without this it would take the preview panel's shape (often a narrow column) and be scaled up into the builder's
 * big viewport. While set, ShaderCanvas draws at this size (CSS pixels) behind the builder window, so the picture
 * fills the viewport sharp. Cleared when the viewport goes.
 */
import { useSyncExternalStore } from 'react';

export interface PreviewSize { width: number; height: number }

let current: PreviewSize | null = null;
const listeners = new Set<() => void>();

/** Draw the main preview at this size (null: the panel's own size again). */
export function setPreviewSizeOverride(size: PreviewSize | null): void {
  const next = size && size.width >= 16 && size.height >= 16 ? { width: Math.round(size.width), height: Math.round(size.height) } : null;
  if (next?.width === current?.width && next?.height === current?.height) return;
  current = next;
  for (const l of listeners) l();
}

export const previewSizeOverride = (): PreviewSize | null => current;

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** The size the main preview is held to now, or null. */
export function usePreviewSizeOverride(): PreviewSize | null {
  return useSyncExternalStore(subscribe, previewSizeOverride, previewSizeOverride);
}
