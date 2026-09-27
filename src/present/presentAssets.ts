/**
 * presentAssets.ts — where a presentation's pictures and font files live.
 *
 * Saved in this browser (localStorage, a few MB for everything) a
 * presentation only names them: an image background is a reference to the
 * backgrounds library in IndexedDB ({ libraryId, name, width, height, thumb },
 * the thumb a tiny preview of a few KB), and a font face's file is in the
 * font cache (lib/fontCache.ts). The full pictures and files travel only in
 * what leaves the app:
 *
 *   withEmbeddedAssets(p)       the presentation with every picture and font
 *                               file embedded (src), each once, for the
 *                               exported page and a downloaded .present.json;
 *                               what couldn't be found is listed
 *   internPresentation(p)       the other way: embedded pictures move into the
 *                               library (the same picture once: by its library
 *                               id when that's here, else by a hash of its
 *                               bytes) and font files into the font cache;
 *                               the presentation keeps references
 *   internStoredPresentations() the same for every saved presentation that
 *                               still carries embedded data (from before
 *                               this, or restored from a ZIP or backup)
 *   referenceTo(libraryId)      a library image as a presentation's image
 */
import { addImage, embedImage, getImage, hasImage, imageUrl, listImages } from '../lib/backgroundLibrary';
import { faceDataUrl, fontKey, hasFace, putFace } from '../lib/fontCache';
import { newId, parsePresentation, type Presentation } from '../types/presentation';
import { usedImages, type EmbeddedFontFace, type PresentImage, type RGB } from '../types/presentationStyle';
import { PRESENTATION_KEY_PREFIX } from '../utils/library';
import { fetchFontFaces } from './googleFonts';

/** Pictures in exported pages and files: at most this on the long side, and this many characters. */
export const EXPORT_IMAGE = { maxSide: 1920, maxChars: 1_600_000 };
/** The preview a saved presentation keeps: this wide at most. */
const THUMB_W = 64;
/** Content hash → library id, for pictures that came in embedded (so the same one lands once). */
const HASH_INDEX_KEY = 'shader-studio-backgrounds:hashes';

const canDraw = () => typeof document !== 'undefined' && typeof Image !== 'undefined';

/** A tiny JPEG preview of a picture (a few KB) and its average colour. */
export async function previewOf(src: string): Promise<{ thumb?: string; avg?: RGB; width?: number; height?: number }> {
  if (!canDraw()) return {};
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    const tw = Math.min(THUMB_W, w), th = Math.max(1, Math.round(tw * h / Math.max(1, w)));
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return {};
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, tw, th);
    const d = x.getImageData(0, 0, tw, th).data;
    const acc = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) acc[j] += d[i + j];
    const n = d.length / 4;
    return { thumb: c.toDataURL('image/jpeg', 0.6), avg: acc.map(v => Math.round((v / n / 255) * 1000) / 1000) as RGB, width: w, height: h };
  } catch { return {}; }
}

/** A library image as a presentation's image: a reference, with its preview, size and average colour. Null when it's gone. */
export async function referenceTo(libraryId: string): Promise<PresentImage | null> {
  const meta = (await listImages()).find(m => m.id === libraryId);
  if (!meta) return null;
  const from = meta.thumb || (await imageUrl(libraryId)) || '';
  const p = from ? await previewOf(from) : {};
  const img: PresentImage = { id: newId('i'), name: meta.name, libraryId, width: meta.width, height: meta.height };
  if (p.thumb) img.thumb = p.thumb;
  if (p.avg) img.avg = p.avg;
  return img;
}

// ── Out: embedding ──────────────────────────────────────────────────────────

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function blobOf(dataUrl: string): Blob {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('Not a data URL.');
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: m[1] });
}

function readIndex(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(HASH_INDEX_KEY) ?? '{}'); return v && typeof v === 'object' ? v as Record<string, string> : {}; } catch { return {}; }
}
function remember(hash: string, id: string): void {
  const idx = readIndex();
  if (idx[hash] === id) return;
  idx[hash] = id;
  try { localStorage.setItem(HASH_INDEX_KEY, JSON.stringify(idx)); } catch { /* only an index */ }
}

export interface EmbedResult {
  doc: Presentation;
  /** Image backgrounds the library doesn't have (the page shows their preview). */
  missingImages: string[];
  /** Font families whose files couldn't be found or downloaded (system fonts stand in). */
  missingFonts: string[];
}

/** Every picture and font file the presentation shows, embedded (each once), for a page or a file. */
export async function withEmbeddedAssets(p: Presentation): Promise<EmbedResult> {
  const used = usedImages(p.style, p.steps);
  const missingImages: string[] = [];
  const images = await Promise.all((p.images ?? []).filter(i => used.has(i.id)).map(async img => {
    if (img.src) return img;
    try {
      const e = img.libraryId ? await embedImage(img.libraryId, EXPORT_IMAGE) : null;
      if (!e) { missingImages.push(img.name); return img; }
      // The same picture coming back in (this file imported here again) finds its library image.
      try { remember(await sha256(await blobOf(e.src).arrayBuffer()), img.libraryId!); } catch { /* only an index */ }
      return { ...img, src: e.src };
    } catch { missingImages.push(img.name); return img; }
  }));
  const missing = new Set<string>();
  let fonts = await Promise.all((p.fonts ?? []).map(async f => {
    if (f.src) return f;
    const src = await faceDataUrl(fontKey(f));
    if (!src) missing.add(f.family);
    return src ? { ...f, src } : f;
  }));
  // Not in this browser's cache (another machine): fetch the family again.
  for (const family of missing) {
    try {
      const weights = [...new Set(fonts.filter(f => f.family === family).flatMap(f => f.weight.split(' ').map(Number)))];
      const got = await fetchFontFaces(family, weights);
      for (const g of got) void putFace(g).catch(() => {});
      fonts = [...fonts.filter(f => f.family !== family), ...got];
      missing.delete(family);
    } catch { /* offline: left out */ }
  }
  const doc: Presentation = { ...p };
  if (images.length) doc.images = images; else delete doc.images;
  if (fonts.length) doc.fonts = fonts.filter(f => f.src); else delete doc.fonts;
  if (!doc.fonts?.length) delete doc.fonts;
  return { doc, missingImages, missingFonts: [...missing] };
}

// ── In: into the library and the font cache ────────────────────────────────

/** A picture that came in embedded, as a library reference. */
async function internImage(img: PresentImage): Promise<PresentImage> {
  if (!img.src) return img;
  const src = img.src;
  const { src: _drop, ...rest } = img;
  void _drop;
  let id: string | undefined;
  // Its own library image, when this is the browser it came from (or it was restored with the library).
  if (img.libraryId && await hasImage(img.libraryId)) id = img.libraryId;
  if (!id) {
    const blob = blobOf(src);
    const hash = await sha256(await blob.arrayBuffer());
    const known = readIndex()[hash];
    if (known && await hasImage(known)) id = known;
    if (!id) {
      const taken = img.libraryId ? !!(await getImage(img.libraryId)) : false;
      const meta = await addImage(blob, { name: img.name, ...(img.libraryId && !taken ? { id: img.libraryId } : {}) });
      id = meta.id;
    }
    remember(hash, id);
  }
  const out: PresentImage = { ...rest, libraryId: id };
  if (!out.thumb || !out.avg || !out.width) {
    const p = await previewOf(src);
    if (!out.thumb && p.thumb) out.thumb = p.thumb;
    if (!out.avg && p.avg) out.avg = p.avg;
    if (!out.width && p.width && p.height) { out.width = p.width; out.height = p.height; }
  }
  return out;
}

async function internFace(f: EmbeddedFontFace): Promise<EmbeddedFontFace> {
  if (!f.src) return f;
  const key = fontKey(f);
  if (!(await hasFace(key))) await putFace(f);
  const { src: _drop, ...rest } = f;
  void _drop;
  return rest;
}

/** The presentation with embedded pictures and font files moved out (null when there were none). */
export async function internPresentation(p: Presentation): Promise<Presentation | null> {
  const has = (p.images ?? []).some(i => i.src) || (p.fonts ?? []).some(f => f.src);
  if (!has || typeof indexedDB === 'undefined') return null;
  const images = await Promise.all((p.images ?? []).map(internImage));
  const fonts = await Promise.all((p.fonts ?? []).map(internFace));
  const next: Presentation = { ...p };
  if (images.length) next.images = images;
  if (fonts.length) next.fonts = fonts;
  return next;
}

/** Is there embedded data in a stored presentation's text worth moving out? A cheap look before parsing. */
export function carriesEmbedded(raw: string): boolean {
  return (raw.includes('"images":') && /"src":\s*"data:image/.test(raw.slice(raw.indexOf('"images":'))))
    || (raw.includes('"fonts":') && /"src":\s*"data:(font|application)/.test(raw.slice(raw.indexOf('"fonts":'))));
}

/**
 * Move embedded pictures and font files out of every saved presentation that
 * still has them. `save` writes one back (storage.ts's savePresentation).
 * Returns the names changed.
 */
export async function internStoredPresentations(save: (name: string, p: Presentation) => unknown): Promise<string[]> {
  if (typeof localStorage === 'undefined' || typeof indexedDB === 'undefined') return [];
  const found: Array<[string, string]> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(PRESENTATION_KEY_PREFIX)) continue;
    const v = localStorage.getItem(k);
    if (v && carriesEmbedded(v)) found.push([k.slice(PRESENTATION_KEY_PREFIX.length), v]);
  }
  const done: string[] = [];
  for (const [name, raw] of found) {
    try {
      const p = parsePresentation(JSON.parse(raw));
      const next = p && await internPresentation(p);
      if (next) { save(name, next); done.push(name); }
    } catch { /* left as it is; tried again next time */ }
  }
  return done;
}
