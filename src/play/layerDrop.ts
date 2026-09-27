/**
 * layerDrop.ts — image and video files dropped on the picture become Image
 * and Video layers where they land. The picture (ShaderCanvas) is shared by
 * every page, so it only takes drops while the Play page says what to do
 * with them (setLayerDropHandler); the Layers panel takes them too (it adds
 * to its list, components/play/dropLayers.ts). While files are dragged over
 * the picture an overlay says what a drop does, with a mark where it lands.
 */

/** Where on the picture, as layers place things: 0..1 across, 0..1 up. */
export interface DropPoint { x: number; y: number }

export interface LayerDropHandler {
  /** Add these files as layers (at this point on the picture; null: the middle). */
  drop(files: File[], at: DropPoint | null): void;
  /** What a drop would do, for the overlay ("Drop to add 2 layers"), or null to not take the drop. */
  label(count: number): string | null;
}

let handler: LayerDropHandler | null = null;

/** The Play page says what drops do while it's shown; returns the undo. */
export function setLayerDropHandler(h: LayerDropHandler): () => void {
  handler = h;
  return () => { if (handler === h) handler = null; };
}

export function layerDropHandler(): LayerDropHandler | null { return handler; }

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv)$/i;

/** 'image', 'video', or null for any other file. */
export function mediaKind(f: { type: string; name: string }): 'image' | 'video' | null {
  if (/^image\//.test(f.type) || (!f.type && IMAGE_EXT.test(f.name))) return 'image';
  if (/^video\//.test(f.type) || ((!f.type || f.type === 'application/octet-stream') && VIDEO_EXT.test(f.name))) return 'video';
  return null;
}

/** The image and video files in a drop, in order. */
export function mediaFiles(list: ArrayLike<File> | null | undefined): File[] {
  return Array.from(list ?? []).filter(f => mediaKind(f) !== null);
}

/** Does a drag carry files (not a row being reordered or text)? */
export const dragHasFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types ?? []).includes('Files');

/**
 * How many images and videos a drag carries, while it's still over (names
 * aren't readable yet, types are; a file without one counts): 0 when it can't say.
 */
export function dragFileCount(dt: DataTransfer | null): number {
  if (!dt?.items) return 0;
  return Array.from(dt.items).filter(i => i.kind === 'file' && (!i.type || /^(image|video)\//.test(i.type))).length;
}

/**
 * Where each of `n` dropped files goes: the first at the drop point, the rest
 * stepped down and to the right a little, so they can be told apart. Kept
 * inside the picture.
 */
export function dropPlaces(n: number, at: DropPoint | null): DropPoint[] {
  const base = at ?? { x: 0.5, y: 0.5 };
  const c = (v: number) => Math.round(Math.max(0.02, Math.min(0.98, v)) * 1e4) / 1e4;
  return Array.from({ length: Math.max(0, n) }, (_, i) => ({ x: c(base.x + i * 0.04), y: c(base.y - i * 0.04) }));
}

/** A drop's point on an element: 0..1 across, 0..1 up. */
export function pointIn(el: HTMLElement, clientX: number, clientY: number): DropPoint {
  const r = el.getBoundingClientRect();
  const c = (v: number) => Math.max(0, Math.min(1, v));
  return { x: c((clientX - r.left) / Math.max(1, r.width)), y: c(1 - (clientY - r.top) / Math.max(1, r.height)) };
}

/** Take drops on the picture while a handler is set: an overlay while files are over it, the layers on drop. */
export function attachLayerDrop(el: HTMLElement): () => void {
  let overlay: HTMLDivElement | null = null;
  let mark: HTMLDivElement | null = null;
  let text: HTMLDivElement | null = null;
  let depth = 0;
  const show = (e: DragEvent, label: string) => {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-layer-drop', '');
      overlay.style.cssText = 'position:absolute;inset:0;z-index:30;pointer-events:none;background:rgba(10,12,18,0.42);box-shadow:inset 0 0 0 2px rgba(255,255,255,0.85);border-radius:4px;display:flex;align-items:center;justify-content:center;';
      text = document.createElement('div');
      text.style.cssText = 'padding:8px 14px;border-radius:999px;background:rgba(0,0,0,0.72);color:#fff;font:600 13px system-ui,-apple-system,sans-serif;max-width:80%;text-align:center;';
      mark = document.createElement('div');
      mark.style.cssText = 'position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,0.5);';
      overlay.append(text, mark);
      el.appendChild(overlay);
    }
    if (text && text.textContent !== label) text.textContent = label;
    if (mark) {
      const r = el.getBoundingClientRect();
      mark.style.left = `${Math.max(0, Math.min(r.width, e.clientX - r.left))}px`;
      mark.style.top = `${Math.max(0, Math.min(r.height, e.clientY - r.top))}px`;
    }
  };
  const hide = () => { depth = 0; overlay?.remove(); overlay = null; mark = null; text = null; };
  const over = (e: DragEvent) => {
    const h = handler;
    if (!h || !dragHasFiles(e.dataTransfer)) return;
    const label = h.label(dragFileCount(e.dataTransfer));
    if (label === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    show(e, label);
  };
  const enter = (e: DragEvent) => { if (handler && dragHasFiles(e.dataTransfer)) { depth++; over(e); } };
  const leave = (e: DragEvent) => { if (!overlay) return; depth = Math.max(0, depth - 1); if (depth === 0 || !el.contains(e.relatedTarget as Node | null)) hide(); };
  const drop = (e: DragEvent) => {
    const h = handler;
    if (!h || !dragHasFiles(e.dataTransfer)) { hide(); return; }
    e.preventDefault();
    // Every file: the handler says when some weren't images or videos.
    const files = Array.from(e.dataTransfer?.files ?? []);
    const at = pointIn(el, e.clientX, e.clientY);
    hide();
    h.drop(files, at);
  };
  el.addEventListener('dragenter', enter);
  el.addEventListener('dragover', over);
  el.addEventListener('dragleave', leave);
  el.addEventListener('drop', drop);
  window.addEventListener('dragend', hide);
  return () => {
    hide();
    el.removeEventListener('dragenter', enter);
    el.removeEventListener('dragover', over);
    el.removeEventListener('dragleave', leave);
    el.removeEventListener('drop', drop);
    window.removeEventListener('dragend', hide);
  };
}
