/**
 * linkedRefs.ts — how a setup names a file it uses straight from a linked
 * folder (docs/linked-folders.md), and what kind of file a name is. Pure: no
 * IndexedDB, no DOM, so everything that stores an asset id can use it.
 *
 *   linked:<folderId>/<path inside the folder>
 *
 * e.g. `linked:lf_m1x2k_ab12/Kicks/808 kick.wav`. It sits where a library id
 * sits (a Video layer's `videoId`, a drum pad's `sampleId`, a background
 * image's `libraryId`), so the places that load by id learn one new kind.
 * The folder id is this app's (random, per install); on another computer the
 * reference is "missing" unless the export carried the file (then the library
 * has a copy under the same id, and that copy is used).
 */

export const LINKED_PREFIX = 'linked:';
/** Longest reference kept in a setup. */
export const LINKED_REF_MAX = 400;

/** What a linked folder is mostly for: only a hint (the browser's first filter). */
export type LinkedKindHint = 'any' | 'samples' | 'images' | 'videos' | 'fonts';
/** What a file is, by its name. */
export type MediaFileKind = 'image' | 'video' | 'audio' | 'font';
/** What a picker takes. */
export type LinkedFilter = MediaFileKind | 'any';

export const KIND_HINTS: { value: LinkedKindHint; label: string }[] = [
  { value: 'any', label: 'Anything' },
  { value: 'samples', label: 'Samples' },
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'fonts', label: 'Fonts' },
];

export const hintFilter = (h: LinkedKindHint): LinkedFilter =>
  h === 'samples' ? 'audio' : h === 'images' ? 'image' : h === 'videos' ? 'video' : h === 'fonts' ? 'font' : 'any';

const EXT: Record<string, MediaFileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image', bmp: 'image',
  mp4: 'video', m4v: 'video', webm: 'video', mov: 'video', ogv: 'video',
  wav: 'audio', wave: 'audio', mp3: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', aif: 'audio', aiff: 'audio', opus: 'audio', weba: 'audio',
  woff2: 'font', woff: 'font', ttf: 'font', otf: 'font',
};
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  wav: 'audio/wav', wave: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff', opus: 'audio/ogg', weba: 'audio/webm',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};
const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/** What a file is by its extension, or null for anything the app doesn't use. */
export const mediaKindOf = (name: string): MediaFileKind | null => EXT[extOf(name)] ?? null;
/** A file's MIME type by its extension ('' when unknown). */
export const mimeOf = (name: string): string => MIME[extOf(name)] ?? '';
/** Does a file belong in a picker that takes `filter`? */
export const matchesFilter = (name: string, filter: LinkedFilter): boolean => {
  const k = mediaKindOf(name);
  return !!k && (filter === 'any' || k === filter);
};

/** A clean path inside a folder: '/'-separated names, none empty, "." or ".."; null otherwise. */
export function cleanPath(path: string): string | null {
  if (typeof path !== 'string' || !path || path.length > LINKED_REF_MAX) return null;
  const parts = path.normalize('NFC').split('/');
  for (const p of parts) if (!p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0')) return null;
  return parts.join('/');
}

const FOLDER_ID = /^[A-Za-z0-9_-]{1,40}$/;

export function isLinkedRef(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(LINKED_PREFIX);
}

/** `linked:<folderId>/<path>`; throws on a bad folder id or path. */
export function linkedRef(folderId: string, path: string): string {
  const p = cleanPath(path);
  if (!FOLDER_ID.test(folderId) || !p) throw new Error(`Not a linked file: ${folderId}/${path}`);
  const ref = `${LINKED_PREFIX}${folderId}/${p}`;
  if (ref.length > LINKED_REF_MAX) throw new Error('That file’s path is too long to keep.');
  return ref;
}

/** The folder and path a reference names, or null when it isn't a (well-formed) linked reference. */
export function parseLinkedRef(ref: unknown): { folderId: string; path: string } | null {
  if (!isLinkedRef(ref) || ref.length > LINKED_REF_MAX) return null;
  const rest = ref.slice(LINKED_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const folderId = rest.slice(0, slash), path = cleanPath(rest.slice(slash + 1));
  return FOLDER_ID.test(folderId) && path ? { folderId, path } : null;
}

/** The file's name (the last part of its path). */
export const baseNameOf = (path: string) => path.split('/').pop() ?? path;
/** A linked reference's file name, for labels ('' when it isn't one). */
export const linkedName = (ref: string) => { const p = parseLinkedRef(ref); return p ? baseNameOf(p.path) : ''; };

/** Sort names the way Finder does: case-insensitive, numbers by value ("kick 2" before "kick 10"). */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** The first `n` files of a folder that take `filter`, alphabetically (a folder onto the pads). */
export function firstFiles<T extends { name: string; dir: boolean }>(entries: readonly T[], filter: LinkedFilter, n: number): T[] {
  return entries.filter(e => !e.dir && matchesFilter(e.name, filter)).sort((a, b) => naturalCompare(a.name, b.name)).slice(0, n);
}

/** What a picker shows of a folder: its folders, and the files it takes whose name has `query` (any case). */
export function pickerEntries<T extends { name: string; dir: boolean }>(entries: readonly T[], filter: LinkedFilter, query = ''): T[] {
  const q = query.trim().toLowerCase();
  return entries.filter(e => (e.dir ? !q : matchesFilter(e.name, filter) && (!q || e.name.toLowerCase().includes(q))));
}
