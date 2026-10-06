/**
 * The clip editor's helpers (components/media/ClipEditor.tsx), apart from the
 * component: explicit segment outs, the remembered Source / Result choice per
 * host, the kept filmstrips, and reading a playing <video>'s file.
 */
import type { ClipHost, ClipSegment } from '../../lib/media/clip';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const STRIP_THUMBS = 28;
export const STRIP_H = 58;

export type ClipPreviewMode = 'source' | 'result';

/** Segments with explicit outs (an out at or before its in: the end of the video). */
export function explicitSegments(segs: readonly ClipSegment[], duration: number): ClipSegment[] {
  const out = segs.map(s => {
    const a = clamp(s.in, 0, Math.max(0, duration - 0.05));
    const b = s.out > a ? Math.min(s.out, duration) : duration;
    return { in: a, out: Math.max(b, Math.min(duration, a + 0.05)), ...(s.reverse ? { reverse: true } : {}) };
  });
  return out.length ? out : [{ in: 0, out: duration }];
}

// ── Remembered choices (per viewer: a convenience, so storage may fail) ──────

const MODE_KEY = (host: ClipHost) => `shader-studio:clip-editor:preview:${host}`;
export function rememberedMode(host: ClipHost): ClipPreviewMode {
  try { return localStorage.getItem(MODE_KEY(host)) === 'result' ? 'result' : 'source'; } catch { return 'source'; }
}
export function rememberMode(host: ClipHost, m: ClipPreviewMode) {
  try { localStorage.setItem(MODE_KEY(host), m); } catch { /* private window */ }
}

// ── Filmstrip thumbnails: made once per video, kept for the session ──────────

interface StripCache { canvas: HTMLCanvasElement; done: Set<number> }
const strips = new WeakMap<object, Map<string, StripCache>>();
/** The kept strip for a source (a Blob, or a painted clip's paint function) at this aspect. */
export function stripFor(key: object, aspect: number): StripCache {
  let byAspect = strips.get(key);
  if (!byAspect) { byAspect = new Map(); strips.set(key, byAspect); }
  const k = aspect.toFixed(4);
  let s = byAspect.get(k);
  if (!s) {
    const c = document.createElement('canvas');
    c.height = STRIP_H * 2; c.width = Math.round(STRIP_THUMBS * c.height * aspect);
    const g = c.getContext('2d');
    if (g) { g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height); }
    s = { canvas: c, done: new Set() };
    byAspect.set(k, s);
  }
  return s;
}
/** Which thumbnails to read, the ones in view first (then outwards). */
export function thumbOrder(n: number, from: number, to: number, done: ReadonlySet<number>): number[] {
  const mid = (from + to) / 2;
  const inView = (i: number) => (i + 1) / n > from && i / n < to;
  return Array.from({ length: n }, (_, i) => i).filter(i => !done.has(i))
    .sort((a, b) => Number(inView(b)) - Number(inView(a)) || Math.abs((a + 0.5) / n - mid) - Math.abs((b + 0.5) / n - mid));
}

/** The file behind a playing <video> (its data: or blob: URL), or null. */
export async function blobOfElement(el: HTMLVideoElement | null): Promise<Blob | null> {
  const url = el?.currentSrc || el?.src || '';
  if (!url) return null;
  try { return await (await fetch(url)).blob(); } catch { return null; }
}

/**
 * How far from a trim handle a press still grabs it, in CSS px: `grabIn` into the segment from
 * its edge, `outside` past the edge, and `slackY` above and below the strip. A finger gets more
 * room than a mouse (Apple's 44 pt guidance, halved either side of the edge).
 */
export function trimHandleGrab(touch: boolean, handleW: number): { grabIn: number; outside: number; slackY: number } {
  return touch ? { grabIn: Math.max(handleW + 2, 22), outside: 18, slackY: 14 } : { grabIn: handleW + 2, outside: 4, slackY: 4 };
}

/** A touch screen as the main pointer (the hint under the trimmer talks about fingers there). */
export function coarsePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}
