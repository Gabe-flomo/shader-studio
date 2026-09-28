/**
 * posters.ts — a small picture of a saved thing for the Files home and item
 * pages: a graph or Play drawn offline by the web runtime (the same path the
 * Present page's posters and Capture a background use), a GLSL shader drawn
 * by the snippet renderer when it compiles, a presentation's first step's
 * picture. Drawn one at a time, only while the tab is visible, and kept in
 * the poster cache (posterCache.ts) under the item's content hash.
 *
 * Loaded lazily by the hook in useItemPosters.ts: the runtime is heavy.
 */
import type { FileNode } from './inventory';
import { GLSL_KEY, GRAPH_PREFIX, parseJson } from './inventory';
import { posterCache, posterId } from './posterCache';
import { APP_VERSION } from './appVersion';

export const POSTER_W = 384, POSTER_H = 216;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** A hidden tab draws nothing: a still that came out all black is a failed one, not a picture. */
async function isBlank(src: string): Promise<boolean> {
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('still')); img.src = src; });
  const c = document.createElement('canvas');
  c.width = 16; c.height = 9;
  const g = c.getContext('2d');
  if (!g) return false;
  g.drawImage(img, 0, 0, 16, 9);
  const d = g.getImageData(0, 0, 16, 9).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 6 || d[i + 1] > 6 || d[i + 2] > 6) return false;
  return true;
}

const visible = () => (typeof document === 'undefined' || document.visibilityState === 'visible' ? Promise.resolve() : new Promise<void>(res => {
  const on = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', on); res(); } };
  document.addEventListener('visibilitychange', on);
}));

async function drawSavedGraph(name: string): Promise<string | null> {
  const [{ snapshotSaved }, { renderPoster }, { captureInput, hasPlayPicture }] = await Promise.all([import('../present/snapshot'), import('../present/runtimeHost'), import('../lib/backgroundCapture')]);
  const r = snapshotSaved(name);
  if (!r.ok) return null;
  const input = captureInput(r.source.bundle, hasPlayPicture(r.source.bundle) ? 'play' : 'graph');
  const png = await renderPoster(input, 1.5, POSTER_W, POSTER_H);
  return png && !(await isBlank(png).catch(() => true)) ? png : null;
}

/** An example graph's poster (for a node page's "examples that use it"). */
async function drawExample(key: string): Promise<string | null> {
  const [{ snapshotExample }, { renderPoster }] = await Promise.all([import('../present/snapshot'), import('../present/runtimeHost')]);
  const r = await snapshotExample(key);
  if (!r.ok) return null;
  const png = await renderPoster(r.source.bundle, 1.5, POSTER_W, POSTER_H);
  return png && !(await isBlank(png).catch(() => true)) ? png : null;
}

/** A GLSL shader drawn by the snippet renderer, when it compiles there (no textures, no buffers). */
async function drawShader(code: string): Promise<string | null> {
  const [{ translateToStudio }, { compileLog, renderStill }] = await Promise.all([import('../glsl/dialects'), import('../present/snippetRenderer')]);
  let source: string;
  try { source = translateToStudio(code).code; } catch { return null; }
  if (compileLog(source)) return null;
  const png = renderStill({ source, width: POSTER_W, height: POSTER_H, uniforms: {}, time: 1.5, dpr: 1 });
  return png && !(await isBlank(png).catch(() => true)) ? png : null;
}

/** A presentation's first step's picture: the poster of the first Play it shows, else of any Play in it. */
export function presentationPoster(stored: string | null): string | null {
  const p = obj(parseJson(stored));
  if (!p) return null;
  const sources = arr(p.sources).map(obj).filter((s): s is Obj => !!s);
  const posterOf = (id: string | undefined) => { const s = sources.find(x => x.id === id); const u = str(s?.poster); return u && /^data:image\//.test(u) ? u : null; };
  for (const st of arr(p.steps).map(obj)) {
    for (const b of arr(st?.blocks).map(obj)) {
      const id = str(b?.source) ?? str(obj(b?.from)?.source);
      const u = posterOf(id);
      if (u) return u;
    }
    break; // the first step only; below, any Play
  }
  for (const s of sources) { const u = posterOf(str(s.id)); if (u) return u; }
  return null;
}

/** Whether a Files item can have a poster, and what makes its cache key change. */
export function posterable(n: FileNode): boolean {
  return (n.kind === 'graph' || n.kind === 'shader' || n.kind === 'presentation') && !!n.hash;
}

/** The content hash a poster is drawn from: the item's, plus the app's version (the renderer changes with it). */
export const posterHash = (n: Pick<FileNode, 'hash'>) => `${n.hash ?? ''}@${APP_VERSION}`;

const readStored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

/** Draw an item's poster now (no cache): null when it can't be drawn. */
export async function drawItemPoster(n: FileNode): Promise<string | null> {
  if (n.kind === 'graph') return drawSavedGraph(n.label);
  if (n.kind === 'presentation' && n.ref?.t === 'key') return presentationPoster(readStored(n.ref.key));
  if (n.kind === 'shader' && n.ref?.t === 'part') {
    const list = arr(parseJson(readStored(GLSL_KEY))).map(obj);
    const m = n.ref.match;
    const sh = list.find(x => x && m && x[m.field] === m.value);
    const code = str(sh?.code);
    return code ? drawShader(code) : null;
  }
  return null;
}

let queue: Promise<void> = Promise.resolve();
const inFlight = new Map<string, Promise<string | null>>();

/** One poster, from the cache or drawn (one at a time, tab visible), then cached. */
export function itemPoster(n: FileNode): Promise<string | null> {
  const id = posterId('item', n.id), hash = posterHash(n);
  const key = `${id}#${hash}`;
  const hit = inFlight.get(key);
  if (hit) return hit;
  const p = (async () => {
    const cache = posterCache();
    const cached = await cache.get(id, hash);
    if (cached) return cached;
    let url: string | null = null;
    await (queue = queue.then(async () => {
      await visible();
      url = await drawItemPoster(n).catch(() => null);
    }));
    if (url) await cache.put(id, hash, url);
    return url;
  })();
  inFlight.set(key, p);
  void p.finally(() => inFlight.delete(key));
  return p;
}

/** An example's poster, cached by its key and the app's version. */
export function examplePoster(key: string): Promise<string | null> {
  const id = posterId('example', key), hash = `@${APP_VERSION}`;
  const hit = inFlight.get(id);
  if (hit) return hit;
  const p = (async () => {
    const cache = posterCache();
    const cached = await cache.get(id, hash);
    if (cached) return cached;
    let url: string | null = null;
    await (queue = queue.then(async () => { await visible(); url = await drawExample(key).catch(() => null); }));
    if (url) await cache.put(id, hash, url);
    return url;
  })();
  inFlight.set(id, p);
  void p.finally(() => inFlight.delete(id));
  return p;
}

/** The saved graph JSON behind a graph node (for the item page's code and the most-used counts). */
export function storedGraph(name: string): string | null { return readStored(GRAPH_PREFIX + name); }
