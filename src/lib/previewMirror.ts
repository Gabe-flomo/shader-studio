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
 * Unlike previewHold.ts this doesn't stop the main loop: the main canvas keeps drawing and the sinks copy it, at the
 * cost of one drawImage a frame. A viewport that has the preview drawn at its own size (the Splat builder,
 * lib/previewSize.ts) takes the canvas itself instead (adoptPreviewCanvas): the preview draws straight into the
 * viewport, with no copy and nothing left drawing under the window; the sinks are then only told a frame came.
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

// ── The canvas itself, lent to a viewport ────────────────────────────────────

let canvas: HTMLCanvasElement | null = null;
let lent: { host: HTMLElement; give: () => void } | null = null;

/** ShaderCanvas: its canvas (null when it goes; a lent canvas comes back first). */
export function setPreviewCanvas(c: HTMLCanvasElement | null): void {
  if (c !== canvas) lent?.give();
  canvas = c;
}

/** Whether the canvas is lent to a viewport now. */
export function previewCanvasLent(): boolean { return lent !== null; }

/**
 * Put the main preview's canvas in `host` (filling it, under whatever else `host` holds; pointer events go through
 * to the viewport) until the returned give-back, which puts it back where it was. Null when there is no canvas, or
 * it is lent already. For a viewport whose size the preview is drawn at (previewSize.ts), so it fits as it is.
 */
export function adoptPreviewCanvas(host: HTMLElement): (() => void) | null {
  const c = canvas;
  if (!c || lent) return null;
  const home = c.parentNode, next = c.nextSibling;
  const was = { position: c.style.position, left: c.style.left, top: c.style.top, pointerEvents: c.style.pointerEvents };
  host.insertBefore(c, host.firstChild);
  c.style.position = 'absolute';
  c.style.left = '0';
  c.style.top = '0';
  c.style.pointerEvents = 'none';
  const give = () => {
    if (lent?.give !== give) return;
    lent = null;
    Object.assign(c.style, was);
    if (home) home.insertBefore(c, next && next.parentNode === home ? next : null);
    else c.remove();
    wake?.();
  };
  lent = { host, give };
  wake?.();
  return give;
}
