/**
 * vizKit — shared plumbing for the inline node visuals (NodeInlineViz and vizGeneric).
 */
import type React from 'react';
import { ctp } from '../../theme/palette';
import type { CtpPalette } from '../../theme/nodePalette';
import { fontFamily } from '../../theme/tokens';

/**
 * The palette the drawings use. NodeInlineViz sets it from the theme on every
 * render (and remounts its children when the theme flips), so the many effects
 * below follow light/dark without each one subscribing.
 */
export let pal: CtpPalette = ctp;
export function setVizPalette(p: CtpPalette): void { pal = p; }
export const MONO = fontFamily.mono;

export const vizContainer = (): React.CSSProperties => ({
  borderBottom: `1px solid ${pal.surface0}`,
  overflow: 'hidden',
});

/**
 * Size a viz canvas to the box it is shown in, at device resolution, and hand
 * back a context in CSS pixels. Drawing code keeps its W×H maths; nothing is
 * stretched to the card any more and lines and text are crisp on Retina.
 * `bw`/`bh` are the bitmap size for ImageData work.
 */
export function setupViz(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; W: number; H: number; bw: number; bh: number; dpr: number } | null {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const W = Math.max(1, canvas.clientWidth || canvas.width);
  const H = Math.max(1, canvas.clientHeight || canvas.height);
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H, bw, bh, dpr };
}
export type Viz = NonNullable<ReturnType<typeof setupViz>>;

/**
 * Per-pixel JS visuals (noise patches, shaded spheres, Chladni fields) are
 * computed at a small size and scaled up, so they stay cheap on Retina and in
 * their live loops. `maxW` caps the computed width; height follows the box.
 */
export function imageSize(viz: { W: number; H: number }, maxW = 180): { IW: number; IH: number } {
  const IW = Math.max(1, Math.min(maxW, Math.round(viz.W)));
  const IH = Math.max(1, Math.round(IW * viz.H / viz.W));
  return { IW, IH };
}
const blitCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
/** Draw a small ImageData scaled to fill W×H CSS pixels (bilinear unless `smooth` is false). */
export function blitImage(ctx: CanvasRenderingContext2D, img: ImageData, W: number, H: number, smooth = true): void {
  if (!blitCanvas) return;
  if (blitCanvas.width !== img.width || blitCanvas.height !== img.height) { blitCanvas.width = img.width; blitCanvas.height = img.height; }
  blitCanvas.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(blitCanvas, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
}
