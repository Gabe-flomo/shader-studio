/**
 * viewportThumb.ts — a picture of a builder's viewport, for a preset saved from it (builders/
 * userPresets.ts): the biggest canvas in the studio's viewport ([data-studio-viewport]), scaled to
 * cover a 264 × 152 card and kept as a JPEG data URL.
 *
 * A WebGL canvas that doesn't keep its drawing buffer can read back empty between frames; a picture
 * with nothing in it (every pixel the same, or see-through) gives way to the builder's own picture
 * of the spec (`fallback`) when it has one.
 */

export const THUMB_W = 264;
export const THUMB_H = 152;

/** The canvas the viewport shows: the biggest one drawn in it. */
export function viewportCanvas(from: Element | null): HTMLCanvasElement | null {
  const root = (from?.closest('[data-studio]') ?? from?.ownerDocument ?? (typeof document !== 'undefined' ? document : null)) as ParentNode | null;
  if (!root) return null;
  const view = root.querySelector('[data-studio-viewport]') ?? root;
  let best: HTMLCanvasElement | null = null;
  let area = 0;
  for (const c of Array.from(view.querySelectorAll('canvas'))) {
    if (c.closest('[data-studio-panel]')) continue; // a picture in a side panel, not the view
    const a = (c.clientWidth || c.width) * (c.clientHeight || c.height);
    if (a > area && c.width > 0 && c.height > 0) { best = c; area = a; }
  }
  return best;
}

/** Whether a picture has nothing in it: see-through, or every pixel the same colour. */
export function blankPixels(data: Uint8ClampedArray): boolean {
  if (data.length < 4) return true;
  let opaque = false;
  const [r, g, b] = [data[0], data[1], data[2]];
  let same = true;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) opaque = true;
    if (same && (Math.abs(data[i] - r) > 2 || Math.abs(data[i + 1] - g) > 2 || Math.abs(data[i + 2] - b) > 2)) same = false;
    if (opaque && !same) return false;
  }
  return true;
}

/** A canvas drawn to cover a w × h card, as a JPEG data URL; null when it can't be read or is blank. */
export function canvasThumb(src: HTMLCanvasElement, w = THUMB_W, h = THUMB_H): string | null {
  try {
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    const s = Math.max(w / src.width, h / src.height);
    const dw = src.width * s, dh = src.height * s;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    // Blank test on the drawn picture, before the black fill shows through: read the source's own pixels.
    const probe = document.createElement('canvas');
    probe.width = 32; probe.height = 18;
    const pc = probe.getContext('2d');
    if (pc) {
      pc.drawImage(src, 0, 0, 32, 18);
      if (blankPixels(pc.getImageData(0, 0, 32, 18).data)) return null;
    }
    return out.toDataURL('image/jpeg', 0.82);
  } catch { return null; }
}

/**
 * The viewport's picture now, else the builder's own picture of its spec, else null. `selector` names
 * the canvas outright, for a builder whose preview isn't in a studio viewport (the 2D builder's panel).
 */
export function captureViewportThumb(from: Element | null, fallback?: () => string | null, selector?: string): string | null {
  const named = selector && typeof document !== 'undefined' ? document.querySelector(selector) : null;
  // A named canvas that isn't on screen (its panel folded) is the builder's own picture's turn, not
  // whatever other canvas is biggest on the page.
  const c = named instanceof HTMLCanvasElement ? named : selector ? null : viewportCanvas(from);
  const pic = c ? canvasThumb(c) : null;
  if (pic) return pic;
  try { return fallback?.() ?? null; } catch { return null; }
}
