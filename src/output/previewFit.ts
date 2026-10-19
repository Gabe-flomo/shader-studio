/**
 * previewFit.ts — the Output dialog's preview keeps the picture's shape (Play audit P23).
 *
 * The output's own player draws its picture at the picture's shape (a fixed shape, or the
 * output's for Free), and a mapping that changes nothing lays a quad of that shape on the
 * output. The preview's source is the app's picture, whose shape is the Play area's: drawn
 * straight onto that quad, a round glow came out as an ellipse. So the preview first fits the
 * app's picture, whole and unstretched (letterboxed), into a canvas of the output picture's shape.
 */

/** A box of `aspect` (width ÷ height) holding a `srcW × srcH` picture at its own size, centred. */
export function containBox(srcW: number, srcH: number, aspect: number): { w: number; h: number; x: number; y: number } {
  if (!(srcW > 0) || !(srcH > 0) || !(aspect > 0)) return { w: Math.max(1, srcW), h: Math.max(1, srcH), x: 0, y: 0 };
  const w = Math.max(srcW, Math.round(srcH * aspect));
  const h = Math.max(srcH, Math.round(w / aspect));
  return { w, h, x: Math.round((w - srcW) / 2), y: Math.round((h - srcH) / 2) };
}

/** Within 1 %: the picture already has the shape, so it is used as it is. */
export function sameShape(srcW: number, srcH: number, aspect: number): boolean {
  return srcW > 0 && srcH > 0 && aspect > 0 && Math.abs(srcW / srcH / aspect - 1) < 0.01;
}

/** The app's picture fitted into `aspect` on `scratch` (letterboxed in black); the picture itself when it already fits. */
export function fitPicture(pic: HTMLCanvasElement, aspect: number, scratch: HTMLCanvasElement): HTMLCanvasElement {
  if (sameShape(pic.width, pic.height, aspect)) return pic;
  const b = containBox(pic.width, pic.height, aspect);
  if (scratch.width !== b.w || scratch.height !== b.h) { scratch.width = b.w; scratch.height = b.h; }
  const x = scratch.getContext('2d');
  if (!x) return pic;
  x.fillStyle = '#000';
  x.fillRect(0, 0, b.w, b.h);
  x.drawImage(pic, b.x, b.y);
  return scratch;
}
