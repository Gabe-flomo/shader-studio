/**
 * Thumbnails for saved Custom Function presets (the Functions library).
 *
 * Each is rendered once, offscreen, by the node-preview renderer from the
 * preset's preview shader (glsl/presetPreview.ts) and kept as a data URL
 * under `thumbnailKey`, so a renamed preset keeps its picture and an edited
 * one gets a new one. Renders are queued and run one per idle slot: a list of
 * forty functions fills in over a few frames instead of stalling one (each
 * render compiles a shader).
 */
import { nodePreviewRenderer } from './nodePreviewRenderer';
import { presetPreviewShader, thumbnailKey, type PresetLike } from '../glsl/presetPreview';

/** Data URLs by key; '' when the preset can't be drawn. */
const done = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const MAX_KEPT = 300;
/** A still frame, a little way in, so a time-driven function isn't caught at zero. */
const THUMB_TIME = 1.7;

type Task = () => Promise<void>;
const queue: Task[] = [];
let running = false;

const idle = (cb: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 500 }); else window.setTimeout(cb, 16);
};

function pump(): void {
  if (running) return;
  const task = queue.shift();
  if (!task) return;
  running = true;
  idle(() => { task().finally(() => { running = false; pump(); }); });
}

/** The pixel size a thumbnail of `cssSize` is rendered at on this screen. */
export const thumbPixels = (cssSize: number) => Math.round(cssSize * Math.min(2, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)));

/** The cached thumbnail, if it has been rendered: a data URL, '' for one that can't be drawn, undefined when not yet. */
export function cachedFnThumbnail(p: PresetLike, cssSize: number): string | undefined {
  return done.get(thumbnailKey(p, thumbPixels(cssSize)));
}

/** The thumbnail, rendering it (queued) when it isn't cached. Resolves to '' when the preset can't be drawn. */
export function fnThumbnail(p: PresetLike, cssSize: number): Promise<string> {
  const px = thumbPixels(cssSize);
  const key = thumbnailKey(p, px);
  const hit = done.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const job = new Promise<string>(resolve => {
    queue.push(async () => {
      let url = '';
      try {
        const src = presetPreviewShader(p);
        if (src) url = await nodePreviewRenderer.renderNodePreview(`fnthumb:${key}`, src, { u_time: { value: THUMB_TIME } }, px, { quiet: true });
        nodePreviewRenderer.invalidatePreview(`fnthumb:${key}`); // kept here instead, by content
      } catch { url = ''; }
      done.set(key, url);
      while (done.size > MAX_KEPT) { const oldest = done.keys().next().value; if (oldest === undefined) break; done.delete(oldest); }
      pending.delete(key);
      resolve(url);
    });
    pump();
  });
  pending.set(key, job);
  return job;
}
