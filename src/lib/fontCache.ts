/**
 * fontCache.ts — the font files presentations use, kept in IndexedDB
 * (`shader-studio-fonts`, store `faces`) rather than in the presentation:
 * a set of three families is ~250 KB of woff2, too much to repeat in every
 * saved presentation in localStorage. A saved presentation lists its faces
 * (family, weight, style, unicode range) and the files come from here; the
 * exported page and a downloaded .present.json embed them again.
 *
 * Keyed by fontKey(face): family, weight, style and the subset's unicode range.
 *
 *   putFace(face with src)   keep its file (a data URL)
 *   faceUrl(key)             an object URL for @font-face (cached), or null
 *   faceDataUrl(key)         the file as a data URL (for exports), or null
 */
import type { EmbeddedFontFace } from '../types/presentationStyle';

const DB_NAME = 'shader-studio-fonts';
const STORE = 'faces';

interface StoredFace { key: string; family: string; type: string; data: ArrayBuffer; savedAt: number }

/** A face's key: family, weight, style and a short hash of its unicode range. */
export function fontKey(f: Pick<EmbeddedFontFace, 'family' | 'weight' | 'style' | 'unicodeRange'>): string {
  let h = 0x811c9dc5;
  for (const ch of f.unicodeRange ?? '') { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${f.family}|${f.weight}|${f.style}|${f.unicodeRange ? h.toString(36) : 'all'}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('No IndexedDB here.')); return; }
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'key' }); };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('Couldn’t open the font cache.'));
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
    t.onerror = () => reject(t.error ?? new Error('The font cache refused that.'));
    t.onabort = () => reject(t.error ?? new Error('The font cache refused that (full?).'));
  }));
}

function bytesOf(dataUrl: string): { type: string; data: ArrayBuffer } {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('Not a font data URL.');
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { type: m[1], data: out.buffer };
}

function dataUrlOf(type: string, data: ArrayBuffer): string {
  const b = new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/** Keep a face's file; returns its key. */
export async function putFace(face: EmbeddedFontFace): Promise<string> {
  if (!face.src) throw new Error('That face has no file.');
  const key = fontKey(face);
  const { type, data } = bytesOf(face.src);
  await tx('readwrite', s => s.put({ key, family: face.family, type, data, savedAt: Date.now() } satisfies StoredFace));
  return key;
}

export async function hasFace(key: string): Promise<boolean> {
  try { return (await tx<number>('readonly', s => s.count(key))) > 0; } catch { return false; }
}

const urls = new Map<string, string>();
/** An object URL of a face's file for @font-face, or null when it isn't cached here. */
export async function faceUrl(key: string): Promise<string | null> {
  const had = urls.get(key);
  if (had) return had;
  try {
    const r = await tx<StoredFace | undefined>('readonly', s => s.get(key));
    if (!r || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    const u = URL.createObjectURL(new Blob([r.data], { type: r.type }));
    urls.set(key, u);
    return u;
  } catch { return null; }
}

/** A face's file as a data URL (what exports embed), or null. */
export async function faceDataUrl(key: string): Promise<string | null> {
  try {
    const r = await tx<StoredFace | undefined>('readonly', s => s.get(key));
    return r ? dataUrlOf(r.type, r.data) : null;
  } catch { return null; }
}
