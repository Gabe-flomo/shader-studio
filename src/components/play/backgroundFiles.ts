/**
 * backgroundFiles.ts — picking the files a background uses (the header's
 * Background and a Background layer's queue): images scaled and encoded to
 * fit a setup, videos kept as data URLs when small enough, and saved graphs
 * copied into a source.
 */
import { readVersion } from '../../store/graphVersions';
import { BACKGROUND_IMAGE_MAX, BACKGROUND_IMAGE_SIDE, BACKGROUND_VIDEO_KEEP, type BackgroundItem } from '../../types/play';
import { BACKGROUND_GRAPH_MAX } from '../../types/playLayers';
import { mediaType } from '../../lib/mediaSources';
import { newSourceId } from '../../play/backgroundQueue';
import { playBackground } from '../../play/background';

const MB = 1024 * 1024;
export const sizeText = (bytes: number) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.svg,.png,.jpg,.jpeg,.webp';
export const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov';

/** A picked image as a data URL: at most BACKGROUND_IMAGE_SIDE on its longest side (SVGs drawn at that size), JPEG unless it has transparency. */
export function loadBackgroundImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
      const w0 = img.naturalWidth || BACKGROUND_IMAGE_SIDE, h0 = img.naturalHeight || BACKGROUND_IMAGE_SIDE;
      const encode = (side: number) => {
        const k = isSvg ? side / Math.max(w0, h0) : Math.min(1, side / Math.max(w0, h0));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
        const x = c.getContext('2d');
        if (!x) return '';
        x.drawImage(img, 0, 0, c.width, c.height);
        // Transparency only matters for PNG, WebP and SVG; photos go as JPEG.
        const png = (isSvg || file.type === 'image/png' || file.type === 'image/webp') && hasAlpha(x, c.width, c.height);
        return png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
      };
      let src = encode(BACKGROUND_IMAGE_SIDE);
      if (src.length > BACKGROUND_IMAGE_MAX) src = encode(1280);
      if (!src || src.length > BACKGROUND_IMAGE_MAX) reject(new Error('The image is too big to keep, even scaled down.'));
      else resolve(src);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser can’t read that image.')); };
    img.src = url;
  });
}

function hasAlpha(x: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const d = x.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] < 255) return true;
  } catch { /* unreadable: keep it as PNG */ return true; }
  return false;
}

export function readDataUrl(file: File, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === 'string' ? resolve(r.result.replace(/^data:[^;,]*;/, `data:${mime};`)) : reject(new Error('Couldn’t read the file.')));
    r.onerror = () => reject(r.error ?? new Error('Couldn’t read the file.'));
    r.readAsDataURL(file);
  });
}

/** A file name without its extension, for a source's name. */
export const baseName = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 120) || name.slice(0, 120);

/** An image source from a picked file. */
export async function imageSource(file: File): Promise<BackgroundItem> {
  return { id: newSourceId(), kind: 'image', name: baseName(file.name), src: await loadBackgroundImage(file) };
}

/**
 * A video source from a picked file: kept in the setup when small enough,
 * otherwise it plays from a session copy (the source keeps its name and size
 * so the panel can ask for it again after a reload).
 */
export async function videoSource(file: File, prev?: Pick<BackgroundItem, 'loop' | 'muted' | 'rate'>): Promise<BackgroundItem> {
  const opts = { loop: prev?.loop ?? true, muted: prev?.muted ?? true, rate: prev?.rate ?? 1 };
  const name = file.name.slice(0, 120);
  if (file.size <= BACKGROUND_VIDEO_KEEP) return { id: newSourceId(), kind: 'video', name, src: await readDataUrl(file, mediaType(file.name, file.type, 'video')), bytes: file.size, ...opts };
  playBackground.setSessionVideo(file);
  return { id: newSourceId(), kind: 'video', name, src: '', bytes: file.size, ...opts };
}

/** A saved graph as a source: a copy of its nodes, so the setup carries it. Throws when it's missing or too big. */
export function savedGraphSource(name: string): BackgroundItem {
  let parsed: { nodes?: unknown } | null = null;
  try { parsed = JSON.parse(localStorage.getItem(`shader-studio:${name}`) ?? 'null'); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.nodes)) throw new Error(`There is no saved graph named “${name}”.`);
  if (JSON.stringify(parsed.nodes).length > BACKGROUND_GRAPH_MAX) throw new Error(`“${name}” is too big to copy into a setup (over ${sizeText(BACKGROUND_GRAPH_MAX)}).`);
  return { id: newSourceId(), kind: 'graph', name, graph: `saved:${name}`, nodes: parsed.nodes };
}

/**
 * One version of a saved graph's series as a source ("Curves 2.3"), copied like a saved graph
 * (docs/graph-series-plan.md): a queue of these steps through iterations of one idea.
 */
export function savedVersionSource(name: string, version: number, label: string): BackgroundItem {
  let parsed: { nodes?: unknown } | null = null;
  try { parsed = JSON.parse(readVersion(name, version) ?? 'null'); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.nodes)) throw new Error(`“${name}” has no version ${label}.`);
  if (JSON.stringify(parsed.nodes).length > BACKGROUND_GRAPH_MAX) throw new Error(`“${name}” ${label} is too big to copy into a setup (over ${sizeText(BACKGROUND_GRAPH_MAX)}).`);
  return { id: newSourceId(), kind: 'graph', name: `${name} ${label}`, graph: `saved:${name}@${label}`, nodes: parsed.nodes };
}

/** A bundled example as a source (compiled when it first shows). */
export function exampleGraphSource(key: string, label: string): BackgroundItem {
  return { id: newSourceId(), kind: 'graph', name: label, graph: `example:${key}` };
}
