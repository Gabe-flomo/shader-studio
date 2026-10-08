/**
 * looks.ts — pictures of graphs for the image model (docs/image-model.md).
 *
 *   lookFrame(nodes)        draw a graph once, square, at the model's input size (null without WebGL2)
 *   lookOf(frame)           its embedding: the full 512-d vector
 *   thumbOf(frame)          a small JPEG of a frame
 */
import type { GraphNode } from '../types/nodeGraph';
import { compileGraph } from '../compiler/graphCompiler';
import { programPixels } from '../components/sceneBuilder/surpriseActions';
import { embedImage, imageModelUsable } from './client';

export interface Frame { rgba: Uint8Array; w: number; h: number }
export interface Look { full: Float32Array }

/** The side a graph is drawn at for the model (it resizes to 256 and centre-crops). */
export const LOOK_SIDE = 192;
/** The moment it's drawn at (after the first second, when most animations have started). */
export const LOOK_TIME = 1.7;

/** Draw a graph once for the model (rows bottom-up, as WebGL reads them). */
export function lookFrame(nodes: readonly GraphNode[], t = LOOK_TIME, side = LOOK_SIDE): Frame | null {
  const r = compileGraph({ nodes: nodes as GraphNode[] });
  if (!r.success) return null;
  return lookFrameOf(r.vertexShader, r.fragmentShader, r.paramUniforms, t, side);
}

/** The same, from a compiled program. */
export function lookFrameOf(vs: string, fs: string, uniforms: Record<string, number | number[]>, t = LOOK_TIME, side = LOOK_SIDE): Frame | null {
  const px = programPixels(vs, fs, uniforms, [t], side, side);
  if (!px || px === 'error') return null;
  return { rgba: px[0], w: side, h: side };
}

/** A frame's look (null when the model is off or failed). */
export async function lookOf(frame: Frame | null): Promise<Look | null> {
  if (!frame || !imageModelUsable()) return null;
  const full = await embedImage(frame);
  return full ? { full } : null;
}

/** A graph's look: drawn, then embedded. */
export const graphLook = (nodes: readonly GraphNode[]): Promise<Look | null> => (imageModelUsable() ? lookOf(lookFrame(nodes)) : Promise.resolve(null));

/** A small JPEG of a frame (flipped upright), or null without a 2D canvas. */
export function thumbOf(f: Frame, w = 96, h = 96): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const src = document.createElement('canvas');
    src.width = f.w; src.height = f.h;
    const sctx = src.getContext('2d');
    if (!sctx) return null;
    const img = sctx.createImageData(f.w, f.h);
    for (let y = 0; y < f.h; y++) img.data.set(f.rgba.subarray((f.h - 1 - y) * f.w * 4, (f.h - y) * f.w * 4), y * f.w * 4);
    sctx.putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d')!.drawImage(src, 0, 0, w, h);
    return out.toDataURL('image/jpeg', 0.8);
  } catch { return null; }
}

/** Wait for a promise, but not longer than `ms` (then null). */
export function withinMs<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);
}
