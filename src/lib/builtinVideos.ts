/**
 * builtinVideos.ts — videos that ship with the app, as static files under
 * `public/media/` (served at `<base>media/…` on the web build and from the
 * desktop app's bundle alike).
 *
 * Today there is one: **Ball action**, 10.4 s of glowing balls swirling
 * into mandala patterns (960 × 540, H.264, no sound). Examples that need a
 * moving picture use it: Time Cube and Frame Stack (Time Cube source
 * `ball`), and Video Input nodes and Video layers by its id, which
 * `getVideo` (lib/backgroundLibrary.ts) resolves here like a Library video.
 *
 * Fetched once and kept. Where a video can't be decoded (node and jsdom
 * tests) `canDecodeVideo()` is false, and the Time Cube paints its built-in
 * test clip instead (lib/timeCube/frames.ts).
 */
import type { VideoMeta } from './timeCube/plan';

/** The Ball action clip's id, wherever a Library video id goes (Video Input `videoId`, a Video layer's video). */
export const BALL_VIDEO_ID = 'builtin:ball-action';

export interface BuiltinVideo extends VideoMeta {
  id: string;
  name: string;
  /** Path under the app's base URL. */
  path: string;
  type: string;
  bytes: number;
}

export const BUILTIN_VIDEOS: Record<string, BuiltinVideo> = {
  [BALL_VIDEO_ID]: {
    id: BALL_VIDEO_ID, name: 'Ball action', path: 'media/ball-action.mp4', type: 'video/mp4',
    bytes: 5_790_398, width: 960, height: 540, duration: 10.4,
  },
};

export const BALL_VIDEO = BUILTIN_VIDEOS[BALL_VIDEO_ID];

export const isBuiltinVideo = (id: string): boolean => Object.prototype.hasOwnProperty.call(BUILTIN_VIDEOS, id);

/** A built-in video's URL in this build ('/shader-studio/media/…' on the web, '/media/…' on the desktop). */
export function builtinVideoUrl(id: string): string {
  const v = BUILTIN_VIDEOS[id];
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return v ? `${base}${v.path}` : '';
}

/** Can this page decode an MP4 at all? False in node / jsdom (tests), where videos never load. */
export function canDecodeVideo(): boolean {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return false;
  try { return document.createElement('video').canPlayType?.('video/mp4; codecs="avc1.42E01E"') !== ''; }
  catch { return false; }
}

const cache = new Map<string, Promise<Blob | null>>();

/** A built-in video's file, fetched once; null when it can't be had here (offline, tests, a missing file). */
export function builtinVideoBlob(id: string): Promise<Blob | null> {
  if (!isBuiltinVideo(id) || !canDecodeVideo()) return Promise.resolve(null);
  let p = cache.get(id);
  if (!p) {
    p = fetch(builtinVideoUrl(id))
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b && b.size > 0 ? (b.type ? b : new Blob([b], { type: BUILTIN_VIDEOS[id].type })) : null))
      .catch(() => null);
    // A failed fetch is tried again next time (it may have been the network).
    void p.then(b => { if (!b) cache.delete(id); });
    cache.set(id, p);
  }
  return p;
}
