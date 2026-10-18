/**
 * Time Cube from pictures (docs/time-cube.md, "From pictures"): instead of a video, the cube is filled
 * from a set of pictures, one picture a frame, in order.
 *
 * The node keeps them in `params.pictures`, one entry each, in stacking order:
 *
 * - **kept with the graph** (a file picked in a browser, on a phone, or in the desktop app with
 *   "Keep in the graph"): `src`, a small JPEG (PNG with transparency) data URL. All of a node's copies
 *   share EMBED_TOTAL characters, so a graph with 128 pictures still saves (each is then smaller);
 * - **on disk** (the desktop app's default): `path`, an absolute file path, read from disk each time the
 *   graph opens. Nothing is copied;
 * - **in the Library** (picked from it): `libraryId`, by reference, the field Files' Used by and .play
 *   dependencies already follow.
 *
 * None of them adds anything to the Library. A picture picked this session is also held in memory
 * (`sessionBlobs`) at full size, so the cube is built sharp until the page reloads.
 *
 * The frame count is the number of pictures, up to the node's Frames (2–256): pictures past it are
 * refused when picked, with a note. A single picture is stacked twice (a cube needs two frames). The
 * frame shape follows the first picture; the others are fitted into it by `pictureFit` (Fill crops,
 * Fit letterboxes in black, Stretch distorts).
 *
 * Everything here but the `encode*` / `read*` helpers is pure.
 */
import type { StackSettings, VideoMeta } from './plan';
import { MAX_FRAMES, MIN_FRAMES } from './plan';

export interface TcPicture {
  /** Stable id (its tile, its thumbnail, its full-size copy this session). */
  id: string;
  /** File name, extension kept (what the list shows and what Sort by name sorts). */
  name: string;
  /** Its own size in pixels (0 when unknown). */
  w: number;
  h: number;
  /** Kept with the graph: the picture as a data URL. */
  src?: string;
  /** Desktop: the file on disk (absolute path), read when the graph opens. */
  path?: string;
  /** From the Library, by reference. */
  libraryId?: string;
}

export type PictureFit = 'cover' | 'contain' | 'stretch';
export const PICTURE_FITS: readonly PictureFit[] = ['cover', 'contain', 'stretch'];
export const pictureFitOf = (v: unknown): PictureFit => (v === 'contain' || v === 'stretch' ? v : 'cover');

/** All of one node's embedded copies together, in characters of data URL (≈ 1.2 MB of JPEG). */
export const EMBED_TOTAL = 1_600_000;
/** Long sides tried for an embedded copy, largest first. */
export const EMBED_SIDES = [512, 384, 256, 192, 128, 96] as const;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** A node's pictures, cleaned (an old or hand-edited graph can hold anything). */
export function picturesOf(params: Record<string, unknown>): TcPicture[] {
  const raw = Array.isArray(params.pictures) ? params.pictures : [];
  const out: TcPicture[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id);
    const src = str(o.src), path = str(o.path), libraryId = str(o.libraryId);
    if (!id || (!src && !path && !libraryId)) continue;
    out.push({ id, name: str(o.name) || 'picture', w: num(o.w), h: num(o.h), ...(src ? { src } : {}), ...(path ? { path } : {}), ...(libraryId ? { libraryId } : {}) });
  }
  return out;
}

/** The most pictures the node takes: its Frames setting (2–256). */
export function pictureCap(params: Record<string, unknown>): number {
  const f = typeof params.frames === 'number' && Number.isFinite(params.frames) ? params.frames : 128;
  return Math.round(Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, f)));
}

/** The pictures the cube stacks: the first `pictureCap` of them. */
export function usedPictures(params: Record<string, unknown>): TcPicture[] {
  return picturesOf(params).slice(0, pictureCap(params));
}

/** Sort names the way Finder does: case-insensitive, numbers by value ("frame 2" before "frame 10"). */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Pictures in file-name order (natural sort); equal names keep their order. */
export function sortByName<T extends { name: string }>(list: readonly T[]): T[] {
  return list.map((p, i) => ({ p, i })).sort((a, b) => naturalCompare(a.p.name, b.p.name) || a.i - b.i).map(x => x.p);
}

/** Move picture `from` to index `to`. */
export function movePicture<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list.slice();
  const out = list.slice();
  const [p] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, p);
  return out;
}

export const reversePictures = <T>(list: readonly T[]): T[] => list.slice().reverse();
export const removePicture = <T extends { id: string }>(list: readonly T[], id: string): T[] => list.filter(p => p.id !== id);

/**
 * Pictures just picked, added to what the node has: the new ones in file-name order after the old
 * (or, with `replace`, instead of them). Past `cap` they are refused, and `note` says how many and why.
 */
export function takePictures<T extends { name: string }>(have: readonly T[], picked: readonly T[], cap: number, o: { replace?: boolean } = {}): { list: T[]; refused: number; note: string } {
  const base = o.replace ? [] : have.slice();
  const incoming = sortByName(picked);
  const room = Math.max(0, cap - base.length);
  const kept = incoming.slice(0, room);
  const refused = incoming.length - kept.length;
  const note = refused > 0
    ? `${refused} ${refused === 1 ? 'picture was' : 'pictures were'} left out: the cube holds ${cap} frames (Frames). Raise Frames (up to ${MAX_FRAMES}) to take more.`
    : '';
  return { list: [...base, ...kept], refused, note };
}

/** The frame shape: the first picture's size (a 16:9 frame until its size is known). */
export function picturesMeta(params: Record<string, unknown>): VideoMeta {
  const first = usedPictures(params).find(p => p.w > 0 && p.h > 0);
  const n = Math.max(1, usedPictures(params).length);
  return { width: first?.w ?? 1600, height: first?.h ?? 900, duration: n };
}

/** The stack settings a pictures source plans with: one frame a picture, no clip, picked not combined. */
export function picturesStackSettings(params: Record<string, unknown>, base: StackSettings): StackSettings {
  const n = usedPictures(params).length;
  return {
    ...base, frames: Math.max(MIN_FRAMES, n), spacing: 'count', start: 0, end: 0, deep: false,
    clip: { segments: [{ in: 0, out: 0 }], distribute: 'proportional', ramp: 'none', xf: { crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, flipX: false, flipY: false } },
  };
}

/** Which picture tile `i` of a stack of `frames` shows (a single picture fills both frames). */
export const pictureForTile = (i: number, count: number) => Math.min(i, Math.max(0, count - 1));

/** A short key of the pictures a volume holds (their ids in order, and the fit). */
export function picturesKey(params: Record<string, unknown>): string {
  const ids = usedPictures(params).map(p => p.id).join(',');
  let h = 2166136261;
  for (let i = 0; i < ids.length; i++) { h ^= ids.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `pics:${usedPictures(params).length}:${(h >>> 0).toString(36)}:${pictureFitOf(params.pictureFit)}`;
}

/** Where a picture w × h goes in a tile tw × th: the source rectangle and the destination rectangle. */
export function fitRect(w: number, h: number, tw: number, th: number, fit: PictureFit): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  if (fit === 'stretch' || w <= 0 || h <= 0) return { sx: 0, sy: 0, sw: w, sh: h, dx: 0, dy: 0, dw: tw, dh: th };
  const k = fit === 'cover' ? Math.max(tw / w, th / h) : Math.min(tw / w, th / h);
  if (fit === 'cover') {
    const sw = tw / k, sh = th / k;
    return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh, dx: 0, dy: 0, dw: tw, dh: th };
  }
  const dw = w * k, dh = h * k;
  return { sx: 0, sy: 0, sw: w, sh: h, dx: (tw - dw) / 2, dy: (th - dh) / 2, dw, dh };
}

/** Where the node's pictures live, in a few words (the card's line). */
export function picturesWhere(list: readonly TcPicture[]): string {
  const n = (f: (p: TcPicture) => boolean) => list.filter(f).length;
  const parts = [
    n(p => !!p.src) ? `${n(p => !!p.src)} kept in the graph` : '',
    n(p => !p.src && !!p.path) ? `${n(p => !p.src && !!p.path)} on disk` : '',
    n(p => !p.src && !p.path && !!p.libraryId) ? `${n(p => !p.src && !p.path && !!p.libraryId)} from the Library` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/** How many characters of data URL each of `count` embedded copies may take, so all of them fit EMBED_TOTAL. */
export const embedShare = (count: number, total = EMBED_TOTAL) => Math.floor(total / Math.max(1, count));

let seq = 0;
export const newPictureId = () => `pic_${Date.now().toString(36)}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
