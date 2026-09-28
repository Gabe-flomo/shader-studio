/**
 * pageCanvasStore.ts — the page canvas: pages other than the Studio and Play (the
 * Convert and GLSL pages) can host the main preview, with its toolbar, inside
 * their own layout instead of the app's fixed preview column.
 *
 * Per page: whether the canvas is hosted full size ('full') or the page shows
 * its small previews and the app's column ('small'), and how wide the hosted
 * canvas is. For Convert: what the canvas shows (the source shader, the
 * converted graph, or both under an A|B wipe) and where the wipe sits. All of
 * it is remembered on this device. PageCanvas.tsx is the host component.
 */
import { create } from 'zustand';

export type PageCanvasPage = 'convert' | 'glsl';
export type PageCanvasLayout = 'small' | 'full';
/** What the Convert page's canvas shows. */
export type ConvertView = 'source' | 'converted' | 'split';

export interface PageCanvasPrefs {
  layout: Record<PageCanvasPage, PageCanvasLayout>;
  /** The hosted canvas's width in px per page (0: half the room). */
  width: Record<PageCanvasPage, number>;
  view: ConvertView;
  /** The A|B wipe's position, 0..1 of the picture's width (the source shows left of it). */
  split: number;
}

export const PAGE_CANVAS_KEY = 'shader-studio:pageCanvas';
export const DEFAULT_PAGE_CANVAS: PageCanvasPrefs = { layout: { convert: 'small', glsl: 'small' }, width: { convert: 0, glsl: 0 }, view: 'converted', split: 0.5 };
/** The wipe never sits at the very edge, so both sides stay reachable. */
export const SPLIT_MIN = 0.05;
export const SPLIT_MAX = 0.95;
/** The hosted canvas and what sits beside it never get narrower than these. */
export const MIN_CANVAS_PX = 320;
export const MIN_BESIDE_PX = 240;

const PAGES: readonly PageCanvasPage[] = ['convert', 'glsl'];
const VIEWS: readonly ConvertView[] = ['source', 'converted', 'split'];

export function clampSplit(x: number): number {
  const v = Number.isFinite(x) ? x : 0.5;
  return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, v));
}

/**
 * The hosted canvas's width for a room `total` px wide: what was asked for,
 * kept so the canvas and what sits beside it both have their minimum; 0 (no
 * preference yet) is `share` of the room (half by default). A room too small
 * for both gives half.
 */
export function clampCanvasWidth(width: number, total: number, share = 0.5): number {
  if (!(total > 0)) return Math.max(MIN_CANVAS_PX, width || MIN_CANVAS_PX);
  if (MIN_CANVAS_PX + MIN_BESIDE_PX > total) return Math.round(total / 2);
  const w = width > 0 && Number.isFinite(width) ? width : total * share;
  return Math.round(Math.max(MIN_CANVAS_PX, Math.min(total - MIN_BESIDE_PX, w)));
}

/** Remembered prefs from storage text; anything missing or odd falls back to the default. */
export function parsePageCanvasPrefs(raw: string | null): PageCanvasPrefs {
  const d = (): PageCanvasPrefs => ({ layout: { ...DEFAULT_PAGE_CANVAS.layout }, width: { ...DEFAULT_PAGE_CANVAS.width }, view: DEFAULT_PAGE_CANVAS.view, split: DEFAULT_PAGE_CANVAS.split });
  if (!raw) return d();
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return d(); }
  if (!v || typeof v !== 'object') return d();
  const o = v as Record<string, unknown>;
  const out = d();
  const layout = o.layout as Record<string, unknown> | undefined;
  const width = o.width as Record<string, unknown> | undefined;
  for (const p of PAGES) {
    const l = layout && typeof layout === 'object' ? layout[p] : undefined;
    if (l === 'small' || l === 'full') out.layout[p] = l;
    const w = width && typeof width === 'object' ? width[p] : undefined;
    if (typeof w === 'number' && Number.isFinite(w) && w >= 0) out.width[p] = Math.round(w);
  }
  if (VIEWS.includes(o.view as ConvertView)) out.view = o.view as ConvertView;
  if (typeof o.split === 'number') out.split = clampSplit(o.split);
  return out;
}

function load(): PageCanvasPrefs {
  try { return parsePageCanvasPrefs(localStorage.getItem(PAGE_CANVAS_KEY)); } catch { return parsePageCanvasPrefs(null); }
}

function save(p: PageCanvasPrefs): void {
  try { localStorage.setItem(PAGE_CANVAS_KEY, JSON.stringify({ layout: p.layout, width: p.width, view: p.view, split: Math.round(p.split * 1000) / 1000 })); } catch { /* preference only */ }
}

interface PageCanvasStore extends PageCanvasPrefs {
  setLayout: (page: PageCanvasPage, layout: PageCanvasLayout) => void;
  toggleLayout: (page: PageCanvasPage) => void;
  setWidth: (page: PageCanvasPage, px: number) => void;
  setView: (view: ConvertView) => void;
  setSplit: (x: number) => void;
}

export const usePageCanvas = create<PageCanvasStore>((set, get) => {
  const prefs = (s: PageCanvasStore): PageCanvasPrefs => ({ layout: s.layout, width: s.width, view: s.view, split: s.split });
  const keep = (patch: Partial<PageCanvasPrefs>) => { set(patch); save(prefs(get())); };
  return {
    ...load(),
    setLayout: (page, layout) => { if (get().layout[page] !== layout) keep({ layout: { ...get().layout, [page]: layout } }); },
    toggleLayout: page => keep({ layout: { ...get().layout, [page]: get().layout[page] === 'full' ? 'small' : 'full' } }),
    setWidth: (page, px) => keep({ width: { ...get().width, [page]: Math.max(0, Math.round(px)) } }),
    setView: view => { if (get().view !== view) keep({ view }); },
    setSplit: x => { const s = clampSplit(x); if (s !== get().split) keep({ split: s }); },
  };
});

/** Whether `page` hosts the canvas itself right now (so the app's own preview column steps aside). */
export function hostsCanvas(page: string, layout: Record<PageCanvasPage, PageCanvasLayout>): page is PageCanvasPage {
  return (page === 'convert' || page === 'glsl') && layout[page] === 'full';
}
