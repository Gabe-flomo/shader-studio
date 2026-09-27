/**
 * backgroundLibrary.ts — the Library's backgrounds: still images (captured
 * from a graph, or imported) and palettes, for Play's Background and for
 * anything else that wants a picture or a set of colours behind it (the
 * Present page's steps).
 *
 * ── Image backgrounds ─────────────────────────────────────────────────────
 *
 *   Stored in IndexedDB (`shader-studio-backgrounds`, store `images`), not
 *   localStorage: a 4K PNG is megabytes. Each record keeps the file's bytes
 *   (an ArrayBuffer and its MIME type, which every browser's IndexedDB
 *   stores; Blobs aren't safe everywhere), its size in pixels, a small JPEG
 *   thumbnail (a data URL, ~20 KB, so lists never decode the big file) and,
 *   when it was captured, where from (`source`). Folders live in the shared
 *   folder store (utils/assetFolders.ts, scope IMAGE_FOLDER_SCOPE) like every
 *   other kind, so they travel in library.json; `folderId` is read from it.
 *
 *     listImages()                   → BackgroundImageMeta[] (newest first; cached after the first read)
 *     getImage(id)                   → BackgroundImage | null (with `blob`)
 *     imageUrl(id)                   → an object URL for <img>/drawing (cached; revoked on delete)
 *     addImage(blob, { name, width?, height?, source?, folderId?, thumb?, id?, createdAt? }) → meta
 *     importImageFile(file)          → meta (any image the browser can read, kept as it is)
 *     renameImage(id, name) · moveImage(id, folderId | null)
 *     deleteImage(id)                → an undo function (null when there was nothing to delete)
 *     embedImage(id)                 → { name, src (data URL within BACKGROUND_IMAGE_MAX), libraryId }
 *     relinkUrl({ libraryId, src })  → the library's full-size copy when it's here, else `src`
 *     subscribe(cb)                  → unsubscribe; called after any change (also fires the window
 *                                      event BACKGROUNDS_CHANGED)
 *
 * ── Palettes ──────────────────────────────────────────────────────────────
 *
 *   Small, so kept in localStorage under PALETTES_KEY (part of library.json,
 *   Export everything and the backup folder like any `shader-studio*` key).
 *   Up to LIBRARY_PALETTE_STOPS_MAX stops (the Studio's Palette node's 32);
 *   Play's background uses at most PLAY_FILL_STOPS_MAX (8), resampled by
 *   fitStops when a palette has more. PALETTE_PRESETS are built in (ids
 *   `preset:*`, read-only).
 *
 *     listPalettes() → saved ones · allPalettes() → presets then saved · getPalette(id)
 *     savePalette({ name, stops, style, angle?, folderId? }) → Palette
 *     renamePalette(id, name) · movePalette(id, folderId | null)
 *     deletePalette(id) → undo function
 *     paletteFill(p, max = 8) → a BackgroundFill for PlayDisplay.fill
 *     paletteCss(p)  → a CSS gradient for swatches
 *     sampleFill(fill, u, v, aspect) → [r, g, b], the colour a fill paints at a pixel
 *       (the kit's own function, so a swatch, a sampler and the picture agree)
 *
 * ── Capturing ─────────────────────────────────────────────────────────────
 *
 *   captureSteps(time, { dt, maxSteps }) is the warm-up plan for a capture at
 *   `time`: the clock times to step the layers through first, from 0 at a
 *   fixed dt, the same every time (the runtime's mount.renderAt takes it).
 *   captureName(title, time) names the result. The window itself is
 *   components/backgrounds (openCapture() in backgroundsUi.ts).
 *
 * ── Files ─────────────────────────────────────────────────────────────────
 *
 *   backgroundZipFiles() is what a library ZIP and the backup folder carry:
 *   `backgrounds/images.json` (a manifest: ids, names, sizes, sources,
 *   folders) and each image under `backgrounds/images/<folder>/<name>.png`.
 *   importBackgroundFiles(files) brings them back (ids kept, so setups that
 *   name one relink; an id already here is left alone).
 */
import { strFromU8, strToU8 } from 'fflate';
import { createFolder, getMembership, loadFolders, moveItemsToFolder, removeItemsFromFolders } from '../utils/assetFolders';
import { BACKGROUND_IMAGE_MAX, BACKGROUND_IMAGE_SIDE, PLAY_FILL_STOPS_MAX, fitStops, type BackgroundFill, type ColourStop } from '../types/play';
import { klFillAt } from '../play/kit/layers.js';

// ── Types ───────────────────────────────────────────────────────────────────

/** Where a captured image came from: the graph, its time and whether the layers were in it. */
export interface CaptureSource {
  /** A saved graph's name, or an example's key. */
  graph: string;
  kind: 'saved' | 'example';
  /** Seconds on the graph clock. */
  time: number;
  /** graph: the shader alone; play: the shader with its Play layers. */
  mode: 'graph' | 'play';
}

export interface BackgroundImageMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  /** MIME type of the stored file (image/png, image/jpeg…). */
  type: string;
  /** File size in bytes. */
  bytes: number;
  createdAt: number;
  /** A small JPEG data URL (at most THUMB_SIDE on its long side); '' when it couldn't be made. */
  thumb: string;
  source?: CaptureSource;
  /** Its folder (from the shared folder store), if any. */
  folderId?: string;
}

export interface BackgroundImage extends BackgroundImageMeta {
  blob: Blob;
}

export interface Palette {
  id: string;
  name: string;
  stops: ColourStop[];
  style: 'gradient' | 'bands';
  /** CSS angle in degrees (180 = top to bottom) when used as a gradient. */
  angle?: number;
  createdAt: number;
  folderId?: string;
  /** Built in (read-only). */
  preset?: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const IMAGE_FOLDER_SCOPE = 'backgrounds:images';
export const PALETTE_FOLDER_SCOPE = 'backgrounds:palettes';
export const PALETTES_KEY = 'shader-studio-backgrounds:palettes';
/** Window event after any change to the backgrounds (images or palettes). */
export const BACKGROUNDS_CHANGED = 'backgrounds-changed';
/** A library palette's stops at most: the Studio's Palette node's limit. */
export const LIBRARY_PALETTE_STOPS_MAX = 32;
export const THUMB_SIDE = 320;
/** The largest capture (either side): 4K. */
export const CAPTURE_MAX_SIDE = 3840;
export const BACKGROUNDS_MANIFEST = 'backgrounds/images.json';
export const BACKGROUNDS_MANIFEST_KIND = 'shader-studio-backgrounds';

const DB_NAME = 'shader-studio-backgrounds';
const STORE = 'images';

// ── Change listeners ────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
function emit(): void {
  for (const cb of [...listeners]) { try { cb(); } catch { /* a listener's problem */ } }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof Event !== 'undefined') window.dispatchEvent(new Event(BACKGROUNDS_CHANGED));
}

export function newBackgroundId(prefix = 'bg'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── IndexedDB ───────────────────────────────────────────────────────────────

interface StoredImage extends Omit<BackgroundImageMeta, 'folderId'> { data: ArrayBuffer }

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('This browser can’t store image backgrounds (no IndexedDB).')); return; }
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'id' }); };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('Couldn’t open the backgrounds store.'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return db().then(d => new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve((req ? req.result : undefined) as T);
    t.onerror = () => reject(t.error ?? new Error('The backgrounds store refused that.'));
    t.onabort = () => reject(t.error ?? new Error('The backgrounds store refused that (full?).'));
  }));
}

let cache: BackgroundImageMeta[] | null = null;

function metaOf(r: StoredImage, membership: Record<string, string>): BackgroundImageMeta {
  const { data: _data, ...m } = r;
  void _data;
  const folderId = membership[r.id];
  return folderId ? { ...m, folderId } : { ...m };
}

function membershipOf(scope: string): Record<string, string> {
  try { return getMembership(scope); } catch { return {}; }
}

/** Every image background, newest first (metadata and thumbnails only). */
export async function listImages(): Promise<BackgroundImageMeta[]> {
  if (!cache) {
    const all = await tx<StoredImage[]>('readonly', s => s.getAll());
    const m = membershipOf(IMAGE_FOLDER_SCOPE);
    cache = (all ?? []).map(r => metaOf(r, m)).sort((a, b) => b.createdAt - a.createdAt);
  } else {
    // Folders can change without us (the folder store is shared): read them fresh.
    const m = membershipOf(IMAGE_FOLDER_SCOPE);
    cache = cache.map(x => { const f = m[x.id]; const { folderId: _f, ...rest } = x; void _f; return f ? { ...rest, folderId: f } : rest; });
  }
  return cache.slice();
}

/** How many image backgrounds there are, as last listed (0 before the first list). */
export function imageCountCached(): number { return cache?.length ?? 0; }

export async function getImage(id: string): Promise<BackgroundImage | null> {
  const r = await tx<StoredImage | undefined>('readonly', s => s.get(id));
  if (!r) return null;
  return { ...metaOf(r, membershipOf(IMAGE_FOLDER_SCOPE)), blob: new Blob([r.data], { type: r.type }) };
}

export async function hasImage(id: string): Promise<boolean> {
  const n = await tx<number>('readonly', s => s.count(id));
  return n > 0;
}

const urls = new Map<string, string>();
/** An object URL of the full image (cached until it's deleted), or null when there's no such image. */
export async function imageUrl(id: string): Promise<string | null> {
  const had = urls.get(id);
  if (had) return had;
  const img = await getImage(id);
  if (!img || typeof URL === 'undefined' || !URL.createObjectURL) return null;
  const u = URL.createObjectURL(img.blob);
  urls.set(id, u);
  return u;
}
function dropUrl(id: string): void {
  const u = urls.get(id);
  if (u) { urls.delete(id); try { URL.revokeObjectURL(u); } catch { /* gone */ } }
}

// ── Pixels (browser only; tests pass sizes and thumbnails in) ──────────────

async function decode(blob: Blob): Promise<{ el: CanvasImageSource; width: number; height: number; close: () => void } | null> {
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(blob); return { el: b, width: b.width, height: b.height, close: () => b.close() }; } catch { /* try an <img> (SVG) */ }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null;
  return new Promise(resolve => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ el: img, width: img.naturalWidth || 1024, height: img.naturalHeight || 1024, close: () => URL.revokeObjectURL(u) });
    img.onerror = () => { URL.revokeObjectURL(u); resolve(null); };
    img.src = u;
  });
}

function canvasOf(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

function hasAlpha(x: CanvasRenderingContext2D, w: number, h: number): boolean {
  try { const d = x.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 16) if (d[i] < 255) return true; } catch { return true; }
  return false;
}

/** A small JPEG of a picture, at most THUMB_SIDE on its long side (a data URL, or '' without a canvas). */
export function thumbnailOf(src: CanvasImageSource, width: number, height: number): string {
  const k = Math.min(1, THUMB_SIDE / Math.max(width, height, 1));
  const c = canvasOf(width * k, height * k);
  const x = c?.getContext('2d');
  if (!c || !x) return '';
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.82); } catch { return ''; }
}

// ── Adding, renaming, deleting ──────────────────────────────────────────────

const cleanName = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Background';

export interface AddImageOptions {
  name: string;
  width?: number;
  height?: number;
  source?: CaptureSource;
  folderId?: string | null;
  thumb?: string;
  /** Keep this id (an import, an undo); a new one otherwise. */
  id?: string;
  createdAt?: number;
}

/** Keep a picture as an image background. Its size and thumbnail are worked out when not given. */
export async function addImage(blob: Blob, o: AddImageOptions): Promise<BackgroundImageMeta> {
  let { width = 0, height = 0, thumb = '' } = o;
  if (!width || !height || !thumb) {
    const d = await decode(blob);
    if (d) {
      if (!width || !height) { width = d.width; height = d.height; }
      if (!thumb) thumb = thumbnailOf(d.el, d.width, d.height);
      d.close();
    }
  }
  const rec: StoredImage = {
    id: o.id || newBackgroundId('img'), name: cleanName(o.name), width: Math.round(width) || 1, height: Math.round(height) || 1,
    type: blob.type || 'image/png', bytes: blob.size, createdAt: o.createdAt ?? Date.now(), thumb,
    ...(o.source ? { source: { ...o.source } } : {}),
    data: await blob.arrayBuffer(),
  };
  await tx('readwrite', s => s.put(rec));
  if (o.folderId) moveItemsToFolder(IMAGE_FOLDER_SCOPE, [rec.id], o.folderId);
  const meta = metaOf(rec, o.folderId ? { [rec.id]: o.folderId } : {});
  if (cache) cache = [meta, ...cache.filter(x => x.id !== rec.id)].sort((a, b) => b.createdAt - a.createdAt);
  emit();
  return meta;
}

/** Keep a picked image file as a background (as it is: its own format and size). */
export async function importImageFile(file: File, folderId?: string | null): Promise<BackgroundImageMeta> {
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name)) throw new Error('That isn’t an image file.');
  const d = await decode(file);
  if (!d) throw new Error('This browser can’t read that image.');
  const thumb = thumbnailOf(d.el, d.width, d.height);
  const { width, height } = d;
  d.close();
  return addImage(file, { name: file.name.replace(/\.[a-z0-9]{2,5}$/i, ''), width, height, thumb, folderId });
}

async function patchImage(id: string, patch: Partial<Pick<StoredImage, 'name'>>): Promise<void> {
  const r = await tx<StoredImage | undefined>('readonly', s => s.get(id));
  if (!r) return;
  await tx('readwrite', s => s.put({ ...r, ...patch }));
  if (cache) cache = cache.map(x => (x.id === id ? { ...x, ...patch } : x));
  emit();
}

export function renameImage(id: string, name: string): Promise<void> { return patchImage(id, { name: cleanName(name) }); }

export function moveImage(id: string, folderId: string | null): void {
  if (folderId) moveItemsToFolder(IMAGE_FOLDER_SCOPE, [id], folderId); else removeItemsFromFolders(IMAGE_FOLDER_SCOPE, [id]);
  if (cache) cache = cache.map(x => { if (x.id !== id) return x; const { folderId: _f, ...rest } = x; void _f; return folderId ? { ...rest, folderId } : rest; });
  emit();
}

/** Delete an image background. Returns a function that puts it back (same id, folder and all), or null when it wasn't there. */
export async function deleteImage(id: string): Promise<(() => Promise<void>) | null> {
  const r = await tx<StoredImage | undefined>('readonly', s => s.get(id));
  if (!r) return null;
  const folderId = membershipOf(IMAGE_FOLDER_SCOPE)[id] ?? null;
  await tx('readwrite', s => s.delete(id));
  if (folderId) removeItemsFromFolders(IMAGE_FOLDER_SCOPE, [id]);
  dropUrl(id);
  if (cache) cache = cache.filter(x => x.id !== id);
  emit();
  return async () => {
    await tx('readwrite', s => s.put(r));
    if (folderId) moveItemsToFolder(IMAGE_FOLDER_SCOPE, [id], folderId);
    cache = null;
    emit();
  };
}

// ── Using an image elsewhere ────────────────────────────────────────────────

/**
 * An image background as it goes into a Play setup or a presentation: a data
 * URL small enough to keep there (at most BACKGROUND_IMAGE_SIDE on its long
 * side and BACKGROUND_IMAGE_MAX characters; JPEG unless it has transparency),
 * plus its id for relinking. Null when the image is gone.
 */
export async function embedImage(id: string, o: { maxSide?: number; maxChars?: number } = {}): Promise<{ name: string; src: string; libraryId: string } | null> {
  const img = await getImage(id);
  if (!img) return null;
  const maxSide = o.maxSide ?? BACKGROUND_IMAGE_SIDE, maxChars = o.maxChars ?? BACKGROUND_IMAGE_MAX;
  const d = await decode(img.blob);
  if (!d) throw new Error('This browser can’t read that image.');
  try {
    const encode = (side: number, quality: number) => {
      const k = Math.min(1, side / Math.max(d.width, d.height));
      const c = canvasOf(d.width * k, d.height * k);
      const x = c?.getContext('2d');
      if (!c || !x) return '';
      x.imageSmoothingQuality = 'high';
      x.drawImage(d.el, 0, 0, c.width, c.height);
      const png = img.type !== 'image/jpeg' && hasAlpha(x, c.width, c.height);
      return png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality);
    };
    let src = encode(maxSide, 0.9);
    if (src.length > maxChars) src = encode(Math.round(maxSide * 0.625), 0.85);
    if (!src || src.length > maxChars) throw new Error('The image is too big to keep in a setup, even scaled down.');
    return { name: img.name, src, libraryId: id };
  } finally { d.close(); }
}

/** For a stored reference ({ libraryId, src }): the library's full-size copy when this browser has it, else the embedded `src`. */
export async function relinkUrl(ref: { libraryId?: string; src: string }): Promise<string> {
  if (!ref.libraryId) return ref.src;
  try { return (await imageUrl(ref.libraryId)) ?? ref.src; } catch { return ref.src; }
}

// ── Palettes ────────────────────────────────────────────────────────────────

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const even = (cols: string[]): ColourStop[] => cols.map((c, i) => ({ pos: cols.length > 1 ? i / (cols.length - 1) : 0, color: hex(c) }));
const preset = (id: string, name: string, cols: string[], angle = 180, style: Palette['style'] = 'gradient'): Palette => ({ id: `preset:${id}`, name, stops: even(cols), style, angle, createdAt: 0, preset: true });

/** Built-in palettes: read-only, always offered first. */
export const PALETTE_PRESETS: readonly Palette[] = [
  preset('dusk', 'Dusk', ['#1b1a3a', '#46306b', '#a0507f', '#e38476', '#f6c28b']),
  preset('ocean', 'Ocean', ['#021526', '#0b3d5c', '#15738a', '#4fb0ac', '#b9e4d4']),
  preset('ink', 'Ink', ['#07080c', '#11141c', '#1d2230', '#2b3242'], 160),
  preset('paper', 'Paper', ['#fbf7ef', '#f2eadb', '#e6dac3'], 160),
  preset('neon', 'Neon', ['#0b0221', '#3b0a6e', '#c2187a', '#ff5e7e', '#29e5ff'], 135),
  preset('forest', 'Forest', ['#0b1a12', '#173623', '#2f5a36', '#6d8b4a', '#c8c07a']),
  preset('ember', 'Ember', ['#0f0504', '#431008', '#9c2a0c', '#e0621a', '#f7b54a'], 0),
  preset('aurora', 'Aurora', ['#04141a', '#0a4b4a', '#2fb58c', '#8cf0b5', '#b9a3ff'], 200),
  preset('mono', 'Mono', ['#0a0a0a', '#f2f2f2'], 180),
  preset('riso', 'Riso bands', ['#f3e9d2', '#ffb4a2', '#e5566f', '#2d6a6e', '#1f2a44'], 90, 'bands'),
  preset('shore', 'Shore bands', ['#e9dcc1', '#c9b28d', '#7fb7be', '#3f7f93', '#1c3d52'], 180, 'bands'),
];

function readPalettes(): Palette[] {
  let raw: unknown;
  try { raw = JSON.parse(localStorage.getItem(PALETTES_KEY) ?? '[]'); } catch { raw = []; }
  if (!Array.isArray(raw)) return [];
  const m = membershipOf(PALETTE_FOLDER_SCOPE);
  const out: Palette[] = [];
  for (const p of raw as Array<Partial<Palette>>) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.stops)) continue;
    const stops = fitStops(p.stops as ColourStop[], LIBRARY_PALETTE_STOPS_MAX);
    if (!stops.length) continue;
    const pal: Palette = { id: p.id, name: p.name, stops, style: p.style === 'bands' ? 'bands' : 'gradient', createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0 };
    if (typeof p.angle === 'number' && Number.isFinite(p.angle)) pal.angle = p.angle;
    if (m[p.id]) pal.folderId = m[p.id];
    out.push(pal);
  }
  return out;
}

function writePalettes(list: Palette[]): void {
  // Folders live in the folder store, not in the list.
  const plain = list.map(({ folderId: _f, preset: _p, ...p }) => { void _f; void _p; return p; });
  try { localStorage.setItem(PALETTES_KEY, JSON.stringify(plain)); } catch (e) { throw new Error(`Couldn’t save the palette: ${e instanceof Error ? e.message : String(e)}`); }
  emit();
}

/** Your saved palettes, newest first. */
export function listPalettes(): Palette[] { return readPalettes().sort((a, b) => b.createdAt - a.createdAt); }
/** The built-in presets, then yours. */
export function allPalettes(): Palette[] { return [...PALETTE_PRESETS, ...listPalettes()]; }
export function getPalette(id: string): Palette | null { return allPalettes().find(p => p.id === id) ?? null; }

/** A name no saved palette has: `name`, or `name (2)`… */
export function freePaletteName(name: string): string {
  const taken = new Set(allPalettes().map(p => p.name));
  const b = cleanName(name);
  if (!taken.has(b)) return b;
  let i = 2;
  while (taken.has(`${b} (${i})`)) i++;
  return `${b} (${i})`;
}

export function savePalette(p: { name: string; stops: readonly ColourStop[]; style: Palette['style']; angle?: number; folderId?: string | null; id?: string; createdAt?: number }): Palette {
  const stops = fitStops(p.stops, LIBRARY_PALETTE_STOPS_MAX);
  if (!stops.length) throw new Error('A palette needs at least one colour.');
  const pal: Palette = { id: p.id || newBackgroundId('pal'), name: cleanName(p.name), stops, style: p.style === 'bands' ? 'bands' : 'gradient', createdAt: p.createdAt ?? Date.now() };
  if (typeof p.angle === 'number' && Number.isFinite(p.angle)) pal.angle = p.angle;
  writePalettes([...readPalettes().filter(x => x.id !== pal.id), pal]);
  if (p.folderId) { moveItemsToFolder(PALETTE_FOLDER_SCOPE, [pal.id], p.folderId); pal.folderId = p.folderId; }
  return pal;
}

export function renamePalette(id: string, name: string): void {
  writePalettes(readPalettes().map(p => (p.id === id ? { ...p, name: cleanName(name) } : p)));
}

export function movePalette(id: string, folderId: string | null): void {
  if (folderId) moveItemsToFolder(PALETTE_FOLDER_SCOPE, [id], folderId); else removeItemsFromFolders(PALETTE_FOLDER_SCOPE, [id]);
  emit();
}

/** Delete a saved palette (presets can't be). Returns a function that puts it back, or null. */
export function deletePalette(id: string): (() => void) | null {
  const list = readPalettes();
  const gone = list.find(p => p.id === id);
  if (!gone) return null;
  writePalettes(list.filter(p => p.id !== id));
  if (gone.folderId) removeItemsFromFolders(PALETTE_FOLDER_SCOPE, [id]);
  return () => {
    writePalettes([...readPalettes().filter(p => p.id !== id), gone]);
    if (gone.folderId) moveItemsToFolder(PALETTE_FOLDER_SCOPE, [id], gone.folderId);
  };
}

/** A palette as Play's background fill: at most `max` stops (resampled), its style and angle, and where it came from. */
export function paletteFill(p: Palette, max = PLAY_FILL_STOPS_MAX): BackgroundFill {
  return { style: p.style, stops: fitStops(p.stops, max), angle: p.angle ?? 180, paletteId: p.id, name: p.name };
}

const css = (c: readonly number[]) => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(' ')})`;

/** A CSS linear-gradient drawing a palette or fill (bands as hard edges), for swatches. `angle` overrides its own. */
export function paletteCss(p: { stops: readonly ColourStop[]; style: 'gradient' | 'bands'; angle?: number }, angle?: number): string {
  const stops = fitStops(p.stops, LIBRARY_PALETTE_STOPS_MAX);
  if (!stops.length) return 'transparent';
  const a = angle ?? p.angle ?? 180;
  if (stops.length === 1) return css(stops[0].color);
  const parts = p.style === 'bands'
    ? stops.map((s, i) => `${css(s.color)} ${i === 0 ? 0 : s.pos * 100}% ${(i + 1 < stops.length ? stops[i + 1].pos : 1) * 100}%`)
    : stops.map(s => `${css(s.color)} ${s.pos * 100}%`);
  return `linear-gradient(${a}deg, ${parts.join(', ')})`;
}

/** The colour a fill paints at a pixel (u, v from the top left, 0..1) of a picture `aspect` wide per unit high: the kit's own sampler. */
export function sampleFill(fill: Pick<BackgroundFill, 'stops' | 'style' | 'angle'>, u: number, v: number, aspect = 16 / 9): [number, number, number] {
  return klFillAt(fill, u, v, aspect);
}

// ── Capturing ───────────────────────────────────────────────────────────────

/**
 * The warm-up before a capture at `time`: the clock times to step through
 * first, from 0 up to (not including) `time`, `dt` apart. More than
 * `maxSteps` and dt grows to fit, so a late time costs no more than that.
 * Pure: the same time always gives the same plan (and so the same picture).
 */
export function captureSteps(time: number, o: { dt?: number; maxSteps?: number } = {}): { dt: number; steps: number[] } {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  let dt = o.dt && o.dt > 0 ? o.dt : 1 / 60;
  const max = Math.max(1, Math.floor(o.maxSteps ?? 1800));
  let n = Math.floor(t / dt + 1e-9);
  if (n > max) { dt = t / max; n = max; }
  const steps: number[] = [];
  for (let i = 0; i < n; i++) { const at = i * dt; if (at < t - 1e-9) steps.push(at); }
  return { dt, steps };
}

/** "Sunset · 12.5 s" */
export function captureName(title: string, time: number): string {
  const t = Math.max(0, time);
  const s = t < 10 ? t.toFixed(2).replace(/0$/, '') : t < 100 ? t.toFixed(1) : Math.round(t).toString();
  return `${cleanName(title)} · ${s.replace(/\.0$/, '')} s`;
}

/** A capture size: whole pixels, at most CAPTURE_MAX_SIDE either way, and at least 16. */
export function clampCaptureSize(w: number, h: number): { w: number; h: number } {
  const c = (v: number) => Math.max(16, Math.min(CAPTURE_MAX_SIDE, Math.round(Number.isFinite(v) ? v : 16)));
  return { w: c(w), h: c(h) };
}

/** The size for an aspect (w / h) with 1080 pixels on the short side (1920 × 1080 for 16:9). */
export function sizeForAspect(aspect: number): { w: number; h: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9;
  return a >= 1 ? clampCaptureSize(1080 * a, 1080) : clampCaptureSize(1080, 1080 / a);
}

// ── Files: library ZIPs and the backup folder ───────────────────────────────

export interface BackgroundsManifest {
  kind: typeof BACKGROUNDS_MANIFEST_KIND;
  version: 1;
  images: Array<{ id: string; name: string; file: string; type: string; width: number; height: number; createdAt: number; thumb?: string; source?: CaptureSource; folder?: string }>;
}

const safeFile = (s: string) => s.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'background';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** The manifest and each image's file (paths from the ZIP's root), for a library ZIP or the backup folder. Empty without images. */
export async function backgroundZipFiles(): Promise<Record<string, Uint8Array>> {
  let metas: BackgroundImageMeta[];
  try { metas = await listImages(); } catch { return {}; }
  if (!metas.length) return {};
  const folders = (() => { try { return loadFolders(IMAGE_FOLDER_SCOPE); } catch { return []; } })();
  const out: Record<string, Uint8Array> = {};
  const manifest: BackgroundsManifest = { kind: BACKGROUNDS_MANIFEST_KIND, version: 1, images: [] };
  for (const m of [...metas].reverse()) {
    const r = await tx<StoredImage | undefined>('readonly', s => s.get(m.id));
    if (!r) continue;
    const folder = m.folderId ? folders.find(f => f.id === m.folderId)?.label : undefined;
    const base = `backgrounds/images/${folder ? `${safeFile(folder)}/` : ''}${safeFile(m.name)}`;
    let path = `${base}.${EXT[r.type] ?? 'png'}`, n = 2;
    while (path in out) path = `${base} (${n++}).${EXT[r.type] ?? 'png'}`;
    out[path] = new Uint8Array(r.data);
    manifest.images.push({
      id: m.id, name: m.name, file: path.slice('backgrounds/'.length), type: r.type, width: m.width, height: m.height, createdAt: m.createdAt,
      ...(m.thumb ? { thumb: m.thumb } : {}), ...(m.source ? { source: m.source } : {}), ...(folder ? { folder } : {}),
    });
  }
  out[BACKGROUNDS_MANIFEST] = strToU8(JSON.stringify(manifest, null, 1));
  return out;
}

/** Just the manifest's text (what changed, for the backup folder). */
export async function backgroundsSignature(): Promise<string> {
  try { return JSON.stringify((await listImages()).map(m => [m.id, m.name, m.folderId ?? '', m.bytes])); } catch { return '[]'; }
}

function parseManifest(bytes: Uint8Array | undefined): BackgroundsManifest | null {
  if (!bytes) return null;
  try {
    const v = JSON.parse(strFromU8(bytes)) as BackgroundsManifest;
    return v && v.kind === BACKGROUNDS_MANIFEST_KIND && Array.isArray(v.images) ? v : null;
  } catch { return null; }
}

/**
 * Bring image backgrounds back from a ZIP's (or folder's) files: `files` maps
 * paths to bytes, and the manifest may sit under any folder (a ZIP's root
 * folder). Ids are kept; one already here is counted as `same` and left.
 * A folder the manifest names is made when there's none by that name.
 */
export async function importBackgroundFiles(files: Record<string, Uint8Array>): Promise<{ added: number; same: number; skipped: number }> {
  const r = { added: 0, same: 0, skipped: 0 };
  const mPath = Object.keys(files).find(p => p === BACKGROUNDS_MANIFEST || p.endsWith(`/${BACKGROUNDS_MANIFEST}`));
  const manifest = parseManifest(mPath ? files[mPath] : undefined);
  if (!manifest || !mPath) return r;
  const root = mPath.slice(0, mPath.length - 'images.json'.length); // "…/backgrounds/"
  let folders = (() => { try { return loadFolders(IMAGE_FOLDER_SCOPE); } catch { return []; } })();
  for (const e of manifest.images) {
    if (!e || typeof e.id !== 'string' || typeof e.file !== 'string') { r.skipped++; continue; }
    const data = files[root + e.file];
    if (!data) { r.skipped++; continue; }
    if (await hasImage(e.id)) { r.same++; continue; }
    // A library.json import brought the folder store (and this id's folder) already.
    const known = membershipOf(IMAGE_FOLDER_SCOPE)[e.id];
    let folderId: string | null = known && folders.some(f => f.id === known) ? known : null;
    if (!folderId && e.folder) {
      const f = folders.find(x => x.label === e.folder) ?? createFolder(IMAGE_FOLDER_SCOPE, e.folder);
      folders = [...folders.filter(x => x.id !== f.id), f];
      folderId = f.id;
    }
    const copy = new Uint8Array(data.byteLength); copy.set(data);
    await addImage(new Blob([copy.buffer], { type: e.type || 'image/png' }), {
      id: e.id, name: e.name, width: e.width, height: e.height, createdAt: e.createdAt, thumb: e.thumb, source: e.source, folderId,
    });
    r.added++;
  }
  return r;
}

/** For tests: forget the cached list and the open database. */
export function resetBackgroundCache(): void { cache = null; dbPromise = null; }
