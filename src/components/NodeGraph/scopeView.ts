/**
 * Framing the graph view: fit a set of cards to the canvas, and what the view does when the open
 * scope changes (entering or leaving a group, a Shader Texture, a Pass, an Agents group...).
 *
 * Entering frames the inside's cards. Leaving goes back to the view the outer level had when you
 * went in, or frames it when there is none (docs/texture-builder.md).
 */
import type { GraphNode } from '../../types/nodeGraph';
import type { Pt } from './socketRegistry';

export interface View { pan: Pt; zoom: number }
export interface Size { w: number; h: number }

export const FIT_PAD = 60;
const FALLBACK: Size = { w: 360, h: 200 };

/**
 * The pan and zoom that centre `nodes` in a `cw` × `ch` canvas. `sizeOf` gives each card's measured
 * size (unmeasured cards count as 360 × 200). `maxZoom` caps the zoom (framing two cards stops at
 * 100% rather than blowing them up); `insetRight` keeps a strip on the right free (a floating panel).
 */
export function frameNodes(
  nodes: ReadonlyArray<GraphNode>, cw: number, ch: number,
  opts: { sizeOf?: (id: string) => Size | undefined; minZoom: number; maxZoom: number; insetRight?: number },
): View | null {
  if (!nodes.length || cw <= 0 || ch <= 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const s = opts.sizeOf?.(n.id) ?? FALLBACK;
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + s.w); maxY = Math.max(maxY, n.position.y + s.h);
  }
  minX -= FIT_PAD; minY -= FIT_PAD; maxX += FIT_PAD; maxY += FIT_PAD;
  const inset = Math.min(opts.insetRight ?? 0, cw / 2);
  const w = cw - inset;
  const zoom = Math.min(opts.maxZoom, Math.max(opts.minZoom, Math.min(w / (maxX - minX), ch / (maxY - minY))));
  return { pan: { x: (w - (maxX + minX) * zoom) / 2, y: (ch - (maxY + minY) * zoom) / 2 }, zoom };
}

export function scopeKey(path: ReadonlyArray<string>): string { return path.join('/'); }

/**
 * What the view does when the open scope goes from `prev` to `next`: back to a view saved for the
 * outer level (leaving), or frame the new level's cards (entering, or leaving with nothing saved).
 */
export function scopeChange(prev: ReadonlyArray<string>, next: ReadonlyArray<string>, saved: ReadonlyMap<string, View>): { restore: View } | { frame: true } | null {
  const a = scopeKey(prev), b = scopeKey(next);
  if (a === b) return null;
  const leaving = next.length < prev.length && next.every((id, i) => prev[i] === id);
  const back = leaving ? saved.get(b) : undefined;
  return back ? { restore: back } : { frame: true };
}

/**
 * The views the canvas had when it went away (switching to Play, Files… unmounts it), so coming back
 * shows the graph as it was left: its zoom and pan, and inside a group the views of the levels
 * outside it. Kept for the graph that is open (`epoch`, the store's graphEpoch, which every load
 * bumps): another graph opened meanwhile starts fresh.
 */
let remembered: { epoch: number; views: Map<string, View> } | null = null;

export function rememberViews(epoch: number, views: ReadonlyMap<string, View>): void {
  remembered = { epoch, views: new Map(views) };
}

/** The views remembered for the graph `epoch` names, or null when it isn't the one they were left on. */
export function recallViews(epoch: number): Map<string, View> | null {
  return remembered && remembered.epoch === epoch ? new Map(remembered.views) : null;
}

/** Tests. */
export function forgetViews(): void { remembered = null; }
