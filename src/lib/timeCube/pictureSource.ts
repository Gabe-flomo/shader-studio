/**
 * pictureSource.ts — reading and keeping a Time Cube's pictures (docs/time-cube.md, "From pictures";
 * the model is lib/timeCube/pictures.ts).
 *
 * - `picturesFromFiles`: files from a file input (a browser, a phone's photo picker): each is decoded
 *   once for its size and a thumbnail, held at full size for the session, and kept with the graph as a
 *   small data URL (`src`), all of a node's copies sharing EMBED_TOTAL.
 * - `pickPicturesOnDisk`: the desktop app's file dialog: only the paths are kept (`path`); the files
 *   are read from disk when the cube is built. Nothing is copied.
 * - `picturesFromLibrary`: Library pictures by reference (`libraryId`).
 * - `readPicture`: a picture's bytes, wherever it lives (this session's copy first).
 *
 * Nothing here adds to the Library.
 */
import { decodePicture, type Decoded } from '../texture/pictures';
import { embedShare, EMBED_SIDES, fitRect, newPictureId, pictureForTile, type PictureFit, type TcPicture } from './pictures';
import { tileOrigin, type StackPlan } from './plan';
import { TimeCubeCancelled } from './frames';

/** Full-size copies of the pictures picked this session (by picture id). */
const sessionBlobs = new Map<string, Blob>();
/** Small thumbnails (data URLs) for the card's list, by picture id. */
const thumbs = new Map<string, string>();
const listeners = new Set<() => void>();

export function onPictureThumbs(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const pictureThumb = (id: string): string | undefined => thumbs.get(id);
export function setPictureThumb(id: string, url: string): void {
  if (!url || thumbs.get(id) === url) return;
  thumbs.set(id, url);
  for (const fn of listeners) fn();
}
/** Tests: forget this session's copies and thumbnails. */
export function clearPictureSession(): void { sessionBlobs.clear(); thumbs.clear(); }
export const hasSessionCopy = (id: string) => sessionBlobs.has(id);

const inDesktopApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const picturesOnDiskAvailable = inDesktopApp;

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff'];
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff' };
const mimeOf = (name: string) => MIME[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''] ?? 'image/png';
export const isPictureName = (name: string) => IMAGE_EXTS.includes(/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '');

/** A data URL's bytes as a Blob (no fetch: works the same in every host). */
export function dataUrlBlob(url: string): Blob | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  try {
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: m[1] || 'image/png' });
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'image/png' });
  } catch { return null; }
}

/** A file on disk (desktop), through the fs plugin (scoped to the home folder). */
async function readDisk(path: string): Promise<Blob | null> {
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(path);
    return new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeOf(path) });
  } catch { return null; }
}

/** A picture's bytes: this session's full-size copy, the copy kept in the graph, the file on disk, or the Library's. */
export async function readPicture(p: TcPicture): Promise<Blob | null> {
  const s = sessionBlobs.get(p.id);
  if (s) return s;
  if (p.path) { const b = await readDisk(p.path); if (b) return b; }
  if (p.libraryId) {
    try {
      const { getImage } = await import('../backgroundLibrary');
      const got = await getImage(p.libraryId);
      if (got) return got.blob;
    } catch { /* not here */ }
  }
  if (p.src) return dataUrlBlob(p.src);
  return null;
}

function canvasOf(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

function hasAlpha(x: CanvasRenderingContext2D, w: number, h: number): boolean {
  try { const d = x.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 16) if (d[i] < 255) return true; } catch { return false; }
  return false;
}

/** A thumbnail (64 px on its long side) for the card's list. */
export function thumbOf(d: Pick<Decoded, 'el' | 'width' | 'height'>): string {
  const k = Math.min(1, 64 / Math.max(d.width, d.height, 1));
  const c = canvasOf(d.width * k, d.height * k);
  const x = c?.getContext('2d');
  if (!c || !x) return '';
  x.drawImage(d.el, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.7); } catch { return ''; }
}

/** The picture as the graph keeps it: the largest of EMBED_SIDES whose copy fits `maxChars` ('' when none does). */
export function embedCopy(d: Pick<Decoded, 'el' | 'width' | 'height'>, maxChars: number): string {
  let alpha: boolean | null = null;
  let last = '';
  for (const side of EMBED_SIDES) {
    const k = Math.min(1, side / Math.max(d.width, d.height, 1));
    const c = canvasOf(d.width * k, d.height * k);
    const x = c?.getContext('2d');
    if (!c || !x) return '';
    x.imageSmoothingQuality = 'high';
    x.drawImage(d.el, 0, 0, c.width, c.height);
    if (alpha === null) alpha = hasAlpha(x, c.width, c.height);
    try { last = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.82); } catch { return ''; }
    if (last.length <= maxChars) return last;
  }
  // Even the smallest is over its share (a big PNG with transparency): a JPEG of it.
  const k = Math.min(1, EMBED_SIDES[EMBED_SIDES.length - 1] / Math.max(d.width, d.height, 1));
  const c = canvasOf(d.width * k, d.height * k);
  const x = c?.getContext('2d');
  if (!c || !x) return last;
  x.drawImage(d.el, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.7); } catch { return last; }
}

export interface PictureIO {
  decode(blob: Blob): Promise<Pick<Decoded, 'el' | 'width' | 'height' | 'close'> | null>;
  embed(d: Pick<Decoded, 'el' | 'width' | 'height'>, maxChars: number): string;
  thumb(d: Pick<Decoded, 'el' | 'width' | 'height'>): string;
}
const defaultIO: PictureIO = { decode: decodePicture, embed: embedCopy, thumb: thumbOf };

/**
 * Pictures from files (a file input): each decoded for its size and thumbnail, held at full size for
 * the session and kept with the graph as a copy within its share of EMBED_TOTAL (`total` is how
 * many pictures the node will hold, so the share is the same for all). Files that can't be read are
 * skipped and counted.
 */
export async function picturesFromFiles(files: ReadonlyArray<Blob & { name?: string }>, total: number, io: PictureIO = defaultIO): Promise<{ pictures: TcPicture[]; unreadable: number }> {
  const share = embedShare(total);
  const out: TcPicture[] = [];
  let unreadable = 0;
  for (const f of files) {
    const d = await io.decode(f).catch(() => null);
    if (!d) { unreadable++; continue; }
    try {
      const id = newPictureId();
      const src = io.embed(d, share);
      if (!src) { unreadable++; continue; }
      sessionBlobs.set(id, f);
      setPictureThumb(id, io.thumb(d));
      out.push({ id, name: f.name || 'picture', w: d.width, h: d.height, src });
    } finally { d.close(); }
  }
  return { pictures: out, unreadable };
}

/**
 * Keep every embedded copy within its share after the list grew: copies over it are made again,
 * smaller (from this session's full-size copy when there is one).
 */
export async function fitEmbedded(list: readonly TcPicture[], io: PictureIO = defaultIO): Promise<TcPicture[]> {
  const share = embedShare(list.filter(p => p.src).length);
  const out: TcPicture[] = [];
  for (const p of list) {
    if (!p.src || p.src.length <= share) { out.push(p); continue; }
    const blob = sessionBlobs.get(p.id) ?? dataUrlBlob(p.src);
    const d = blob ? await io.decode(blob).catch(() => null) : null;
    if (!d) { out.push(p); continue; }
    try { out.push({ ...p, src: io.embed(d, share) || p.src }); } finally { d.close(); }
  }
  return out;
}

/** Pictures on disk (desktop): keep their paths, and copies in the graph when `embed` (then they travel with it). */
export async function picturesFromPaths(paths: readonly string[], o: { embed?: boolean; total?: number } = {}, io: PictureIO = defaultIO): Promise<{ pictures: TcPicture[]; unreadable: number }> {
  const share = embedShare(o.total ?? paths.length);
  const out: TcPicture[] = [];
  let unreadable = 0;
  for (const path of paths) {
    const blob = await readDisk(path);
    const d = blob ? await io.decode(blob).catch(() => null) : null;
    if (!blob || !d) { unreadable++; continue; }
    try {
      const id = newPictureId();
      setPictureThumb(id, io.thumb(d));
      const name = path.split(/[\\/]/).pop() || path;
      const src = o.embed ? io.embed(d, share) : '';
      out.push({ id, name, w: d.width, h: d.height, ...(src ? { src } : { path }) });
    } finally { d.close(); }
  }
  return { pictures: out, unreadable };
}

/** Desktop: the system dialog, several pictures at once. Null when cancelled. */
export async function pickPicturePaths(): Promise<string[] | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const got = await open({ multiple: true, directory: false, title: 'Choose pictures for the Time Cube', filters: [{ name: 'Pictures', extensions: IMAGE_EXTS }] });
  if (!got) return null;
  return (Array.isArray(got) ? got : [got]).filter((p): p is string => typeof p === 'string');
}

/** Library pictures by reference (nothing is copied). */
export function picturesFromLibrary(metas: ReadonlyArray<{ id: string; name: string; width: number; height: number; thumb?: string; type?: string }>): TcPicture[] {
  return metas.map(m => {
    const id = newPictureId();
    if (m.thumb) setPictureThumb(id, m.thumb);
    const ext = m.type?.split('/')[1];
    const name = /\.[a-z0-9]{2,5}$/i.test(m.name) || !ext ? m.name : `${m.name}.${ext === 'jpeg' ? 'jpg' : ext}`;
    return { id, name, w: m.width, h: m.height, libraryId: m.id };
  });
}

/** Keep copies of on-disk and Library pictures with the graph, so it opens anywhere. */
export async function keepInGraph(list: readonly TcPicture[], io: PictureIO = defaultIO): Promise<{ pictures: TcPicture[]; unreadable: number }> {
  const share = embedShare(list.length);
  const out: TcPicture[] = [];
  let unreadable = 0;
  for (const p of list) {
    if (p.src) { out.push(p); continue; }
    const blob = await readPicture(p);
    const d = blob ? await io.decode(blob).catch(() => null) : null;
    if (!d) { unreadable++; out.push(p); continue; }
    try {
      const src = io.embed(d, share);
      // The path goes (the copy replaces it); a Library id stays, as a Texture node keeps both.
      const { path: _p, ...rest } = p;
      void _p;
      out.push(src ? { ...rest, src } : p);
    } finally { d.close(); }
  }
  return { pictures: await fitEmbedded(out, io), unreadable };
}

/**
 * Draw each tile of a pictures stack: tile i is picture i (a single picture fills both tiles), fitted
 * into the tile by `fit`. Returns how many pictures couldn't be read (their tiles stay black).
 */
export async function drawPictures(pics: readonly TcPicture[], plan: StackPlan, ctx: CanvasRenderingContext2D, fit: PictureFit, onFrame: (done: number) => void, signal: AbortSignal, io: Pick<PictureIO, 'decode' | 'thumb'> = defaultIO): Promise<number> {
  let unread = 0;
  type Held = { id: string; d: Pick<Decoded, 'el' | 'width' | 'height' | 'close'> | null };
  let last = null as Held | null;
  try {
    for (let i = 0; i < plan.frames; i++) {
      if (signal.aborted) throw new TimeCubeCancelled();
      const p = pics[pictureForTile(i, pics.length)];
      if (!p) break;
      if (last?.id !== p.id) {
        last?.d?.close();
        const blob = await readPicture(p);
        const d = blob ? await io.decode(blob).catch(() => null) : null;
        if (!d) unread++;
        else if (!thumbs.has(p.id)) setPictureThumb(p.id, io.thumb(d));
        last = { id: p.id, d };
      }
      if (signal.aborted) throw new TimeCubeCancelled();
      const { x, y } = tileOrigin(plan, i);
      const d = last.d;
      if (d) {
        const r = fitRect(d.width, d.height, plan.tileW, plan.tileH, fit);
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, plan.tileW, plan.tileH); ctx.clip();
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(d.el, r.sx, r.sy, r.sw, r.sh, x + r.dx, y + r.dy, r.dw, r.dh);
        ctx.restore();
      }
      onFrame(i + 1);
      if (i % 4 === 3) await new Promise(res => setTimeout(res, 0));
    }
  } finally { last?.d?.close(); }
  return unread;
}
