/**
 * specThumbs.ts — pictures of whole scenes for the 3D Scene Builder's presets strip and its Mode
 * cards: each spec built and compiled as the preview does (previewGl.ts), drawn once on a small
 * WebGL2 canvas (surpriseActions.ts programPixels) and kept as an image for the session. One is
 * drawn per frame, so opening the window never stalls. Without WebGL2 (a test) there are no
 * pictures and the cards show their names alone.
 */
import { useEffect, useState } from 'react';
import type { SceneSpec } from '../../sceneBuilder/spec';
import { compileSpec, type Compiled } from './previewGl';
import { programPixels } from './surpriseActions';

const cache = new Map<string, string | null>();
const queue: Array<{ key: string; spec: SceneSpec; w: number; h: number }> = [];
const listeners = new Set<() => void>();
let pumping = false;

function draw(spec: SceneSpec, w: number, h: number, type: 'image/png' | 'image/jpeg' = 'image/png'): string | null {
  return compiledPicture(compileSpec(spec), w, h, type);
}

/** One frame of a compiled builder preview (previewGl's Compiled), drawn offscreen, as a data URL; null when it can't be drawn. */
export function compiledPicture(c: Compiled, w = 264, h = 152, type: 'image/png' | 'image/jpeg' = 'image/jpeg'): string | null {
  if (c.error) return null;
  const px = programPixels(c.vs, c.fs, c.uniforms, [0.5], w, h, c.textures);
  if (!px || px === 'error') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  // GL rows run bottom up.
  for (let y = 0; y < h; y++) img.data.set(px[0].subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL(type, 0.85);
}

/** A picture of a scene as it is now, through its own camera (a saved preset's picture): a JPEG data URL, or null. */
export function snapshotSpec(spec: SceneSpec, w = 264, h = 152): string | null {
  try { return draw(spec, w, h, 'image/jpeg'); } catch { return null; }
}

function pump() {
  if (pumping) return;
  pumping = true;
  const next = () => {
    const job = queue.shift();
    if (!job) { pumping = false; return; }
    if (!cache.has(job.key)) {
      try { cache.set(job.key, draw(job.spec, job.w, job.h)); } catch { cache.set(job.key, null); }
      for (const l of listeners) l();
    }
    setTimeout(next, 16);
  };
  setTimeout(next, 0);
}

/** Pictures of `entries` (by key), drawn in the background; null until each is ready (or when it can't be drawn). */
export function useSpecThumbs(entries: Array<{ key: string; spec: () => SceneSpec }>, w = 264, h = 152): Record<string, string | null> {
  const [, bump] = useState(0);
  const keys = entries.map(e => e.key).join('|');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const l = () => bump(n => n + 1);
    listeners.add(l);
    for (const e of entries) if (!cache.has(e.key) && !queue.some(q => q.key === e.key)) queue.push({ key: e.key, spec: e.spec(), w, h });
    pump();
    return () => { listeners.delete(l); };
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  return Object.fromEntries(entries.map(e => [e.key, cache.get(e.key) ?? null]));
}
