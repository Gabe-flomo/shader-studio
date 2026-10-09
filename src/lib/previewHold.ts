/**
 * previewHold — the main preview paused by an overlay. While something holds it (the Expression
 * Block's explain view, which draws its own live picture of one line), ShaderCanvas stops drawing,
 * so that picture gets the GPU; the canvas keeps its last frame on screen. Letting go wakes it.
 *
 * Like usePreviewQuality.hold(): a counter, and each hold returns its own release (safe to call
 * twice). An output window or a recording still keeps full speed (backgroundFrame's fullSpeed):
 * those must not stall because an editor is open. The clock doesn't run while held, and Auto
 * resolution doesn't count the held time as cost (ShaderCanvas resets its frame counters).
 *
 * Not a zustand store: nothing renders from it, the frame loop asks previewHeld() each frame.
 */
let holds = 0;
const listeners = new Set<(held: boolean) => void>();

const emit = () => { const held = holds > 0; for (const cb of listeners) cb(held); };

/** Hold the main preview; returns the release. */
export function holdPreview(): () => void {
  holds += 1;
  if (holds === 1) emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) emit();
  };
}

/** Whether something holds the main preview now. */
export function previewHeld(): boolean { return holds > 0; }

/** Called when the preview becomes held or free again; returns the unsubscribe. */
export function onPreviewHold(cb: (held: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
