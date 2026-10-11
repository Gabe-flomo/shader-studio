/**
 * builderFocus — while a builder whose picture IS the main preview is open (the Splat builder, the Agent Builder:
 * components/builders/studio/LiveViewport.tsx), everything that isn't needed for that picture waits
 * (docs/scene-builder.md, "The builder's picture comes first"):
 *
 *  - the graph behind the window doesn't re-render: its cards, wires, minimap and inline previews, the node browser
 *    (components/builders/FreezeBehindBuilder.tsx);
 *  - the main preview skips its readbacks and side drawings: the pixel under the pointer, the histogram, the selected
 *    node's probe, Scope and LFO cards, the eye preview's readouts, Pass and Agents thumbnails (ShaderCanvas);
 *  - with its own size (the Splat builder) the preview canvas is drawn straight into the builder's viewport, so there
 *    is no copy a frame (lib/previewMirror.ts adoptPreviewCanvas).
 *
 * The 2D and 3D builders don't need this: they hold the main preview altogether (previewPriority.ts).
 * Set by watchBuilderPreview (previewPriority.ts) while BuilderWindowsHost is mounted.
 */
import { useSyncExternalStore } from 'react';

let focused = false;
const listeners = new Set<() => void>();

/** Whether a mirroring builder has the app's attention now. */
export function builderFocused(): boolean { return focused; }

export function setBuilderFocus(on: boolean): void {
  if (on === focused) return;
  focused = on;
  for (const l of listeners) l();
}

/** Called when the focus comes or goes; returns the unsubscribe. */
export function onBuilderFocus(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React: whether a mirroring builder is open (the graph behind it freezes on it). */
export function useBuilderFocus(): boolean {
  return useSyncExternalStore(onBuilderFocus, builderFocused, builderFocused);
}
