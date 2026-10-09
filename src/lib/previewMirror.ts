/**
 * previewMirror — the main preview's frames, handed to a builder's viewport while it is open
 * (components/builders/studio/LiveViewport.tsx). The builder holds the picture: it shows the main
 * preview's own frames (the real result, agents and passes included) instead of a copy compiled
 * on the side, because an Agents group's simulation (state textures, deposits, trails) only runs
 * in the main preview's pipeline.
 *
 * ShaderCanvas calls sendPreviewFrame(canvas) right after each frame is drawn, while the drawing
 * buffer still holds it, so a sink can drawImage() it whatever the context's
 * preserveDrawingBuffer. Nothing is copied while no one mirrors. A new sink asks for one frame
 * (so a paused clock still shows the picture).
 *
 * Unlike previewHold.ts this doesn't stop the main loop: the main canvas keeps drawing (under the
 * builder window) and the sinks copy it, at the cost of one drawImage a frame.
 */
type Sink = (src: HTMLCanvasElement) => void;

const sinks = new Set<Sink>();
let wake: (() => void) | null = null;

/** Mirror the main preview into `sink` (called after every drawn frame); returns the stop. */
export function mirrorPreview(sink: Sink): () => void {
  sinks.add(sink);
  wake?.();
  return () => { sinks.delete(sink); };
}

/** Whether a builder mirrors the preview now (ShaderCanvas skips the call when not). */
export function previewMirrored(): boolean { return sinks.size > 0; }

/** ShaderCanvas: the frame just drawn, still in the drawing buffer. */
export function sendPreviewFrame(src: HTMLCanvasElement): void {
  for (const s of sinks) {
    try { s(src); } catch { /* a sink that fails (a closed viewport) doesn't stop the frame */ }
  }
}

/** ShaderCanvas: how to ask for a frame (its requestRender); null when it goes. */
export function setPreviewWake(fn: (() => void) | null): void { wake = fn; }

/** Ask the main preview for one frame (a paused clock draws one), e.g. for a builder's read of the live state. */
export function wakePreview(): void { wake?.(); }
