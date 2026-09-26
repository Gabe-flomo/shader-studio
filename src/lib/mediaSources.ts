/**
 * mediaSources.ts — the files behind Video Input and Audio Input nodes, kept
 * so "Put it on a website" can put them in the page. The app itself holds
 * only decoded forms (a <video>, an AudioBuffer), none of which are saved
 * with the graph, and the export has to be built synchronously, so each file
 * is turned into a data URL once, when it is loaded.
 *
 * Images need no copy here: a Texture Input's texture keeps the decoded
 * canvas, which the export encodes (see imageDataUrl).
 *
 * Files over the limit are remembered by name and size only, so the export
 * can say what it left out and why.
 */

export type MediaKind = 'video' | 'audio';

export interface MediaSource {
  kind: MediaKind;
  name: string;
  /** The file's size in bytes. */
  bytes: number;
  /** The file as a data URL; null while it is being read, or when it is over the limit. */
  dataUrl: string | null;
  /** True when the file is over EMBED_LIMIT for its kind. */
  tooBig: boolean;
}

const MB = 1024 * 1024;
/** The largest file of each kind a web export carries (base64 makes it a third bigger in the page). */
export const EMBED_LIMIT: Record<MediaKind, number> = { video: 4 * MB, audio: 6 * MB };

const sources = new Map<string, MediaSource>();

/** The remembered file for a node id (or layer key), if any. */
export function mediaSource(key: string): MediaSource | null {
  return sources.get(key) ?? null;
}

export function forgetMedia(key: string): void {
  sources.delete(key);
}

/** Put back what `mediaSource(key)` returned before a load that failed. */
export function restoreMedia(key: string, previous: MediaSource | null): void {
  if (previous) sources.set(key, previous); else sources.delete(key);
}

const EXT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska',
};

/** A file's media type: its own, or one from its extension. */
export function mediaType(name: string, type: string, kind: MediaKind): string {
  if (type) return type;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TYPES[ext] ?? (kind === 'video' ? 'video/mp4' : 'audio/mpeg');
}

function base64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * Remember a loaded file. An ArrayBuffer is copied now (call this before
 * decodeAudioData, which detaches it); a Blob is read in the background.
 */
export function rememberMedia(key: string, kind: MediaKind, name: string, type: string, data: ArrayBuffer | Blob): void {
  const bytes = data instanceof ArrayBuffer ? data.byteLength : data.size;
  const tooBig = bytes > EMBED_LIMIT[kind];
  const entry: MediaSource = { kind, name, bytes, dataUrl: null, tooBig };
  sources.set(key, entry);
  if (tooBig) return;
  const mime = mediaType(name, type, kind);
  if (data instanceof ArrayBuffer) {
    entry.dataUrl = `data:${mime};base64,${base64(new Uint8Array(data))}`;
    return;
  }
  if (typeof FileReader === 'undefined') return;
  const reader = new FileReader();
  reader.onload = () => {
    // A newer file for the same key replaced this one meanwhile.
    if (sources.get(key) !== entry || typeof reader.result !== 'string') return;
    entry.dataUrl = reader.result.replace(/^data:[^;,]*;/, `data:${mime};`);
  };
  reader.readAsDataURL(data);
}

// ── Images ───────────────────────────────────────────────────────────────────

/** The largest encoded image a web export carries before it is scaled down. */
export const IMAGE_LIMIT = 3 * MB;
/** The longest side an image is scaled to when it is over IMAGE_LIMIT. */
export const IMAGE_MAX_SIDE = 2048;

export interface EncodedImage { dataUrl: string; scaledTo: number | null }

const encoded = new WeakMap<object, EncodedImage>();

/** Does the picture have any transparency? Checked on a small copy, which is cheap and catches any real cut-out. */
function hasAlpha(src: HTMLCanvasElement | HTMLImageElement | ImageBitmap): boolean {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return false;
  x.drawImage(src, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

/**
 * A texture's picture as a data URL for the web export: JPEG (0.92) when it
 * is opaque, PNG when it has transparency, at full size unless that is over
 * IMAGE_LIMIT, then scaled to IMAGE_MAX_SIDE. Cached per picture, since the
 * export dialog rebuilds its input on every keystroke of the title.
 */
export function imageDataUrl(src: unknown): EncodedImage | null {
  if (typeof document === 'undefined' || !src || typeof src !== 'object') return null;
  const img = src as HTMLCanvasElement | HTMLImageElement | ImageBitmap;
  const w = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const h = 'naturalHeight' in img ? img.naturalHeight : img.height;
  if (!w || !h) return null;
  const hit = encoded.get(img);
  if (hit) return hit;
  const alpha = hasAlpha(img);
  const encode = (scale: number) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    return alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
  };
  let dataUrl = encode(1);
  let scaledTo: number | null = null;
  const longest = Math.max(w, h);
  if (dataUrl.length * 0.75 > IMAGE_LIMIT && longest > IMAGE_MAX_SIDE) {
    dataUrl = encode(IMAGE_MAX_SIDE / longest);
    scaledTo = IMAGE_MAX_SIDE;
  }
  const out = { dataUrl, scaledTo };
  encoded.set(img, out);
  return out;
}
