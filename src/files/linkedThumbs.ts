/**
 * linkedThumbs.ts — small pictures of the files in linked folders, for the
 * browser and the pickers: an image's thumbnail, a video's poster frame, a
 * sound's waveform (decoded silently, which also gives its length), a font's
 * "Aa". Kept in IndexedDB (`shader-studio-linked`, store `thumbs`) keyed by
 * folder, path, size and time, so a file is looked at once until it changes.
 * Made one or two at a time, never for very big files.
 */
import { THUMBS, linkedIdb, resolveLinked, type LinkedEntry } from './linkedFolders';
import { linkedRef, mediaKindOf, mimeOf } from './linkedRefs';
import { thumbnailOf, videoPosterOf, wavePeaks, waveThumbOf } from '../lib/backgroundLibrary';

export interface LinkedPreview {
  /** A data URL ('' when nothing could be made). */
  thumb: string;
  width?: number;
  height?: number;
  /** Seconds (sounds and videos). */
  duration?: number;
}

/** Bigger than this, no preview is made (reading it all would take too long). */
const MAX_BYTES: Record<string, number> = { image: 60 * 1024 * 1024, video: 400 * 1024 * 1024, audio: 120 * 1024 * 1024, font: 20 * 1024 * 1024 };

export const previewKey = (folderId: string, e: Pick<LinkedEntry, 'path' | 'size' | 'mtime'>) => `${folderId}/${e.path}|${e.size}|${Math.round(e.mtime)}`;

const memory = new Map<string, LinkedPreview>();
const work = new Map<string, Promise<LinkedPreview | null>>();
let running = 0;
const waiting: Array<() => void> = [];
const slot = async () => { if (running >= 2) await new Promise<void>(r => waiting.push(r)); running++; };
const free = () => { running--; waiting.shift()?.(); };

/** A preview already made (this session or before), without making one. */
export function cachedPreview(folderId: string, e: LinkedEntry): LinkedPreview | null { return memory.get(previewKey(folderId, e)) ?? null; }

/** A file's preview: from the cache, or made now (null when the browser can't, or the file is too big). */
export function linkedPreview(folderId: string, e: LinkedEntry): Promise<LinkedPreview | null> {
  const key = previewKey(folderId, e);
  const had = memory.get(key);
  if (had) return Promise.resolve(had);
  const busy = work.get(key);
  if (busy) return busy;
  const p = (async () => {
    const kept = await linkedIdb<LinkedPreview>(THUMBS, 'readonly', s => s.get(key));
    if (kept) { memory.set(key, kept); return kept; }
    const kind = mediaKindOf(e.name);
    if (!kind || e.dir || e.size > MAX_BYTES[kind]) return null;
    await slot();
    try {
      const got = await resolveLinked(linkedRef(folderId, e.path));
      if (!got.ok) return null;
      const made = await makePreview(kind, got.blob, e.name);
      if (!made) return null;
      memory.set(key, made);
      await linkedIdb(THUMBS, 'readwrite', s => s.put(made, key));
      return made;
    } catch { return null; } finally { free(); }
  })().finally(() => { work.delete(key); });
  work.set(key, p);
  return p;
}

async function makePreview(kind: string, blob: Blob, name: string): Promise<LinkedPreview | null> {
  if (typeof document === 'undefined') return null;
  if (kind === 'image') {
    const typed = blob.type ? blob : new Blob([blob], { type: mimeOf(name) });
    if (typeof createImageBitmap === 'function' && !/svg/.test(typed.type)) {
      try { const b = await createImageBitmap(typed); const thumb = thumbnailOf(b, b.width, b.height); const out = { thumb, width: b.width, height: b.height }; b.close(); return out; } catch { /* try an <img> */ }
    }
    const url = URL.createObjectURL(typed);
    try {
      const img = await new Promise<HTMLImageElement | null>(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
      if (!img) return { thumb: '' };
      const w = img.naturalWidth || 512, h = img.naturalHeight || 512;
      return { thumb: thumbnailOf(img, w, h), width: w, height: h };
    } finally { URL.revokeObjectURL(url); }
  }
  if (kind === 'video') {
    const p = await videoPosterOf(blob.type ? blob : new Blob([blob], { type: mimeOf(name) }));
    return p ? { thumb: p.thumb ?? '', width: p.width, height: p.height, duration: p.duration } : { thumb: '' };
  }
  if (kind === 'audio') {
    // Decoded offline: nothing is heard.
    const Ctx = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null;
    if (!Ctx) return null;
    try {
      const buf = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
      return { thumb: waveThumbOf(wavePeaks(buf.getChannelData(0), 48)), duration: buf.duration };
    } catch { return { thumb: '' }; }
  }
  if (kind === 'font') {
    if (typeof FontFace === 'undefined') return null;
    const family = `lf-preview-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const face = await new FontFace(family, await blob.arrayBuffer()).load();
      document.fonts.add(face);
      const c = document.createElement('canvas');
      c.width = 160; c.height = 90;
      const g = c.getContext('2d');
      if (!g) return null;
      g.fillStyle = '#7d93f0';
      g.font = `48px "${family}"`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Aa', 80, 48);
      document.fonts.delete(face);
      return { thumb: c.toDataURL('image/png') };
    } catch { return { thumb: '' }; }
  }
  return null;
}
