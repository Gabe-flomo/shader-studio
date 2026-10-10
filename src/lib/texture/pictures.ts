/**
 * pictures.ts — where a Texture node's picture lives, so a saved graph opens with it
 * (docs/texture-node.md, "Saved graphs keep their pictures").
 *
 * Before, the picture was held only in memory (the store's `nodeTextures`) and the node
 * kept a 96 px thumbnail: a reload, a saved version or a .playfile opened without it.
 * Now a picture is kept twice:
 *
 * - **in the image library** (lib/backgroundLibrary.ts) at full size, its id in
 *   `params.libraryId` (the field Files' Used by and .playfile dependencies already follow);
 * - **in the node** as `params._imageSrc`: a data URL at most EMBED_SIDE on its long side
 *   and EMBED_MAX_CHARS long (JPEG unless it has transparency), so the graph is complete on
 *   its own: in its saved versions, in a .playfile, on another computer.
 *
 * Opening a graph (`createPictureRestorer().sync`) uses the library's full-size copy when
 * this browser has it, and the embedded one otherwise.
 */
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

/** The embedded copy's longest side, in pixels. */
export const EMBED_SIDE = 1024;
/** The embedded copy's largest size, in characters of data URL (≈ 300 KB of JPEG). */
export const EMBED_MAX_CHARS = 400_000;
/** Sides tried, largest first, until the copy fits EMBED_MAX_CHARS. */
const EMBED_STEPS = [EMBED_SIDE, 768, 512, 384];

export interface Decoded { el: CanvasImageSource; width: number; height: number; close: () => void }

/** A blob decoded to something a canvas can draw (null when the browser can't read it). */
export async function decodePicture(blob: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(blob); return { el: b, width: b.width, height: b.height, close: () => b.close() }; } catch { /* try an <img> (SVG) */ }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
  return new Promise(resolve => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ el: img, width: img.naturalWidth || 1024, height: img.naturalHeight || 1024, close: () => URL.revokeObjectURL(u) });
    img.onerror = () => { URL.revokeObjectURL(u); resolve(null); };
    img.src = u;
  });
}

function canvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

function hasAlpha(x: CanvasRenderingContext2D, w: number, h: number): boolean {
  try { const d = x.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 16) if (d[i] < 255) return true; } catch { return false; }
  return false;
}

/** The picture as the node keeps it: the largest of EMBED_STEPS that fits EMBED_MAX_CHARS ('' when none does). */
export function embedPicture(d: Pick<Decoded, 'el' | 'width' | 'height'>, maxChars = EMBED_MAX_CHARS): string {
  let alpha: boolean | null = null;
  for (const side of EMBED_STEPS) {
    const k = Math.min(1, side / Math.max(d.width, d.height, 1));
    const c = canvas(d.width * k, d.height * k);
    const x = c?.getContext('2d');
    if (!c || !x) return '';
    x.imageSmoothingQuality = 'high';
    x.drawImage(d.el, 0, 0, c.width, c.height);
    if (alpha === null) alpha = hasAlpha(x, c.width, c.height);
    let url = '';
    try { url = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85); } catch { return ''; }
    if (url.length <= maxChars) return url;
  }
  return '';
}

/** A small thumbnail for the card (96 px, as before). */
export function thumbPicture(d: Pick<Decoded, 'el' | 'width' | 'height'>): string {
  const k = Math.min(1, 96 / Math.max(d.width, d.height, 1));
  const c = canvas(d.width * k, d.height * k);
  const x = c?.getContext('2d');
  if (!c || !x) return '';
  x.drawImage(d.el, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.7); } catch { return ''; }
}

// ── Loading from a URL ───────────────────────────────────────────────────────

export type UrlProblem = 'invalid' | 'blocked' | 'status' | 'notPicture' | 'notVideo' | 'empty';

export class TextureUrlError extends Error {
  problem: UrlProblem;
  constructor(problem: UrlProblem, message: string) { super(message); this.problem = problem; this.name = 'TextureUrlError'; }
}

/** What the card says when a link can't be read (and what to do instead). */
export const URL_MESSAGES = {
  invalid: 'That isn’t a web address. Paste a link that starts with https://.',
  blocked: 'The site didn’t let this page read it. Many sites block other pages from downloading their files (CORS), or the link can’t be reached. Download the file and drop it on the card instead, or use a link from a site that allows it (Wikimedia upload links, picsum.photos, GitHub raw files).',
  notPicture: 'That link isn’t a picture: it leads to a web page. Right-click the picture itself and choose Copy Image Address.',
  notVideo: 'That link isn’t a video file (an .mp4 or .webm). Video pages (YouTube, Vimeo) can’t be read: download the video and drop it on the card.',
  empty: 'That link gave an empty file.',
} as const;

/**
 * Fetch a picture or video by URL on the CPU (it is then decoded and uploaded as a texture).
 * The browser only hands the bytes over when the site allows other pages to read them (CORS);
 * otherwise this throws a TextureUrlError that says so.
 */
export async function fetchMedia(url: string, want: 'image' | 'video', fetchFn: typeof fetch = fetch): Promise<{ blob: Blob; name: string }> {
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new TextureUrlError('invalid', URL_MESSAGES.invalid); }
  if (!/^(https?|data|blob):$/.test(u.protocol)) throw new TextureUrlError('invalid', URL_MESSAGES.invalid);
  let res: Response;
  try { res = await fetchFn(u.href, { mode: 'cors', credentials: 'omit' }); } catch {
    // A CORS refusal and an unreachable host look the same from here (a TypeError).
    throw new TextureUrlError('blocked', URL_MESSAGES.blocked);
  }
  if (!res.ok) throw new TextureUrlError('status', `The site answered ${res.status}${res.statusText ? ` (${res.statusText})` : ''}. Check the link opens in a new tab.`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const okType = want === 'image' ? /^image\//.test(type) : /^video\//.test(type);
  const ext = want === 'image' ? /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i : /\.(mp4|webm|mov|m4v|ogv)$/i;
  if (!okType && !(type === '' || type === 'application/octet-stream' || type === 'binary/octet-stream') ) {
    throw new TextureUrlError(want === 'image' ? 'notPicture' : 'notVideo', want === 'image' ? URL_MESSAGES.notPicture : URL_MESSAGES.notVideo);
  }
  if (!okType && !ext.test(u.pathname) && u.protocol !== 'data:') {
    throw new TextureUrlError(want === 'image' ? 'notPicture' : 'notVideo', want === 'image' ? URL_MESSAGES.notPicture : URL_MESSAGES.notVideo);
  }
  const blob = await res.blob();
  if (!blob.size) throw new TextureUrlError('empty', URL_MESSAGES.empty);
  const last = u.protocol === 'data:' ? '' : decodeURIComponent(u.pathname.split('/').pop() ?? '');
  let name = (last || (want === 'image' ? 'picture' : 'video')).replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 120) || 'picture';
  // A link like picsum.photos/id/1015/640/400 ends in a size: name it after the site.
  if (/^[\d\s_-]+$/.test(name) && u.hostname) name = u.hostname.replace(/^www\./, '');
  return { blob: okType || !blob.type ? new Blob([blob], { type: okType ? type : (want === 'image' ? 'image/png' : 'video/mp4') }) : blob, name };
}

// ── Opening a graph ─────────────────────────────────────────────────────────

/** Which picture a node names: its library id, else its embedded copy (by length and a sample), else none. */
export function pictureKey(p: Record<string, unknown>): string {
  const lib = typeof p.libraryId === 'string' ? p.libraryId : '';
  const src = typeof p._imageSrc === 'string' ? p._imageSrc : '';
  if (lib) return `lib:${lib}`;
  if (src) return `src:${src.length}:${src.slice(-48)}`;
  return '';
}

/** Every Texture node showing a picture, top level and inside groups (their samplers are bound by the inner node's id). */
export function pictureNodes(nodes: readonly GraphNode[]): GraphNode[] {
  const out: GraphNode[] = [];
  const walk = (list: readonly GraphNode[], depth: number) => {
    for (const n of list) {
      if (n.type === 'textureInput') out.push(n);
      const sub = n.params?.subgraph as SubgraphData | undefined;
      if (depth < 6 && sub && Array.isArray(sub.nodes)) walk(sub.nodes, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

export interface PictureTexture {
  /** THREE's filters, set from `params.filter` (nearest / linear). */
  magFilter: number; minFilter: number; needsUpdate: boolean;
  dispose(): void;
}

export interface RestoreHost<T extends PictureTexture = PictureTexture> {
  getTexture(nodeId: string): T | null | undefined;
  setTexture(nodeId: string, tex: T | null): void;
  /** The library's full-size file, or null when this browser doesn't have it. */
  libraryBlob(id: string): Promise<Blob | null>;
  /** A blob (or a data URL) to a texture; null when it can't be read. */
  toTexture(src: Blob | string): Promise<T | null>;
  /** A picture came back (the card's aspect, when it was missing). */
  restored?(nodeId: string, from: 'library' | 'embedded'): void;
  /** Neither copy could be read. */
  missing?(nodeId: string): void;
  /** Nearest / linear: THREE's constants. */
  filters?: { nearest: number; linear: number; linearMipmap: number };
}

/**
 * Keeps the store's picture textures in step with the graph: a graph opened (or a version, an
 * import, an undo) gets its pictures back; a node with no picture of its own drops one left
 * from another graph under the same id. Pure apart from the host.
 */
export function createPictureRestorer<T extends PictureTexture>(host: RestoreHost<T>) {
  const loaded = new Map<string, string>();
  const pending = new Map<string, string>();

  const applyFilter = (tex: T, p: Record<string, unknown>) => {
    const f = host.filters;
    if (!f) return;
    const nearest = p.filter === 'nearest';
    const mag = nearest ? f.nearest : f.linear, min = nearest ? f.nearest : f.linearMipmap;
    if (tex.magFilter !== mag || tex.minFilter !== min) { tex.magFilter = mag; tex.minFilter = min; tex.needsUpdate = true; }
  };

  async function load(n: GraphNode, key: string): Promise<void> {
    pending.set(n.id, key);
    try {
      const p = n.params;
      let tex: T | null = null, from: 'library' | 'embedded' = 'library';
      const lib = typeof p.libraryId === 'string' ? p.libraryId : '';
      if (lib) {
        const blob = await host.libraryBlob(lib).catch(() => null);
        if (blob) tex = await host.toTexture(blob).catch(() => null);
      }
      if (!tex && typeof p._imageSrc === 'string' && p._imageSrc) { tex = await host.toTexture(p._imageSrc).catch(() => null); from = 'embedded'; }
      if (pending.get(n.id) !== key) { tex?.dispose(); return; }
      if (!tex) { host.missing?.(n.id); return; }
      applyFilter(tex, p);
      host.setTexture(n.id, tex);
      loaded.set(n.id, key);
      host.restored?.(n.id, from);
    } finally {
      if (pending.get(n.id) === key) pending.delete(n.id);
    }
  }

  return {
    /** The card loaded this picture itself (an upload, a URL, a library pick): don't load it again. */
    markLoaded(nodeId: string, params: Record<string, unknown>): void {
      const key = pictureKey(params);
      pending.delete(nodeId);
      if (key) loaded.set(nodeId, key); else loaded.delete(nodeId);
    },
    /**
     * The graph as it is now. `opened`: a different graph was opened (its node ids may
     * repeat the last one's), so a texture a node didn't name is dropped.
     */
    sync(nodes: readonly GraphNode[], opened: boolean): Promise<void> {
      const jobs: Promise<void>[] = [];
      if (opened) loaded.clear();
      for (const n of pictureNodes(nodes)) {
        const key = pictureKey(n.params);
        const have = host.getTexture(n.id);
        if (!key) {
          if (opened && have) host.setTexture(n.id, null);
          continue;
        }
        if (loaded.get(n.id) === key && have) { applyFilter(have, n.params); continue; }
        if (pending.get(n.id) === key) continue;
        jobs.push(load(n, key));
      }
      return Promise.all(jobs).then(() => undefined);
    },
  };
}
