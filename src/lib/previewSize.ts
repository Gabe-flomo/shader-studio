/**
 * previewSize — a builder's own size for the main preview while its viewport mirrors it
 * (components/builders/studio/LiveViewport.tsx `ownSize`). The Splat builder's picture is the main preview's, so
 * without this it would take the preview panel's shape (often a narrow column) and be scaled up into the builder's
 * big viewport. While set, ShaderCanvas draws at this size (CSS pixels) behind the builder window, so the picture
 * fills the viewport sharp. Cleared when the viewport goes.
 */
import { useSyncExternalStore } from 'react';
import { containRect } from '../agentBuilder/diagram';

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

/**
 * Where an `ownSize` viewport draws the preview in a `box`: all of it with no `aspect`; with one, the largest rect of
 * that shape inside it, centred, in whole CSS pixels (the size the preview is held to and where its canvas sits). Pure.
 */
export function ownSizeRect(box: { w: number; h: number }, aspect?: number | null): { x: number; y: number; w: number; h: number } {
  if (!(box.w > 0 && box.h > 0)) return { x: 0, y: 0, w: box.w, h: box.h };
  if (!(typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0)) return { x: 0, y: 0, w: box.w, h: box.h };
  const r = containRect(box.w, box.h, aspect, 1);
  const w = Math.max(1, Math.min(Math.round(box.w), Math.round(r.w)));
  const h = Math.max(1, Math.min(Math.round(box.h), Math.round(r.h)));
  return { x: Math.round((box.w - w) / 2), y: Math.round((box.h - h) / 2), w, h };
}
