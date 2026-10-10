/**
 * placement.ts — where nodes added to the graph land (docs/node-browser.md "Where new nodes land"):
 * in the part of the canvas you are looking at, not wherever the graph happens to end.
 *
 * - `placeSetupInView`: a group of new cards (a builder's setup, a preset, a recipe) keeps its own
 *   layout, its cards untangled, and is centred in the visible canvas; when something is already
 *   there it moves to the free spot nearest the view's centre (freeSpace.ts), never far off.
 * - `settleAddedInView`: the same for nodes a pure planner has already placed (the Do… bar, the
 *   scene builders, Grid Rules…): what it added is found by id and, as one block, centred in view
 *   (`mode: 'centre'`) or only brought back when it can't be found on screen (`mode: 'ifOutOfView'`).
 *   A plan that removed nodes rewrote the graph in place, so it is left alone.
 *
 * Pure; the store and the actions read the view (`_viewportRectGetter`) and apply the result.
 */
import type { GraphNode } from '../types/nodeGraph';
import { cardHeight, untangle } from './agentSetup';
import { boundsOf, nearestFree, type Box, type Pt } from './freeSpace';

/** The part of the graph on screen, in graph coordinates. */
export interface ViewRect { x: number; y: number; w: number; h: number }

const CARD_W = 360;
/** Space kept between a new block and the cards already there. */
export const PLACE_GAP = 60;
/** Space kept between a block taller or wider than the view and the view's edge. */
const VIEW_PAD = 40;

const boxOf = (nd: GraphNode, heightOf: (nd: GraphNode) => number): Box => ({ x: nd.position.x, y: nd.position.y, w: CARD_W, h: heightOf(nd) });

/** The middle of a card whose top-left is `p` (what a click or drop position names). */
export const cardCentre = (p: Pt): Pt => ({ x: p.x + CARD_W / 2, y: p.y + 90 });

/**
 * Where a block of `size` starts (top-left) to sit centred on `centre`, or, when it is bigger than
 * the view on an axis, starting at the view's edge on that axis (so its beginning is on screen).
 */
function centredStart(size: { w: number; h: number }, centre: Pt, view: ViewRect | null): Pt {
  let x = centre.x - size.w / 2, y = centre.y - size.h / 2;
  if (view) {
    if (size.w > view.w - 2 * VIEW_PAD) x = view.x + VIEW_PAD;
    if (size.h > view.h - 2 * VIEW_PAD) y = view.y + VIEW_PAD;
  }
  return { x, y };
}

export interface PlaceOptions {
  /** Where the block's middle should go; the view's centre when omitted. */
  at?: Pt | null;
  heightOf?: (nd: GraphNode) => number;
  gap?: number;
}

/**
 * `added` (laid out among themselves, any absolute position) moved as one block to the middle of
 * `view`, or to the free spot nearest it when cards of `existing` are there. Without a view (tests,
 * no canvas) the block centres on `at`, else beside the graph's middle. Returns the moved cards.
 */
export function placeSetupInView(existing: readonly GraphNode[], added: GraphNode[], view: ViewRect | null, opts: PlaceOptions = {}): GraphNode[] {
  const heightOf = opts.heightOf ?? cardHeight;
  const tidy = untangle(added, heightOf);
  const block = boundsOf(tidy.map(nd => boxOf(nd, heightOf)));
  if (!block) return tidy;
  const there = existing.map(nd => boxOf(nd, heightOf));
  const graph = boundsOf(there);
  const centre = opts.at
    ?? (view ? { x: view.x + view.w / 2, y: view.y + view.h / 2 } : graph ? { x: graph.x + graph.w / 2, y: graph.y + graph.h / 2 } : { x: block.x + block.w / 2, y: block.y + block.h / 2 });
  const start = centredStart(block, centre, view);
  const at = nearestFree(block, there, start, opts.gap ?? PLACE_GAP);
  const dx = at.x - block.x, dy = at.y - block.y;
  return tidy.map(nd => ({ ...nd, position: { x: Math.round(nd.position.x + dx), y: Math.round(nd.position.y + dy) } }));
}

/** Whether `b` is findable in `view`: its middle is on screen, or at least a quarter of it is. */
function seenIn(b: Box, view: ViewRect): boolean {
  const mx = b.x + b.w / 2, my = b.y + b.h / 2;
  if (mx >= view.x && mx <= view.x + view.w && my >= view.y && my <= view.y + view.h) return true;
  const ix = Math.max(0, Math.min(b.x + b.w, view.x + view.w) - Math.max(b.x, view.x));
  const iy = Math.max(0, Math.min(b.y + b.h, view.y + view.h) - Math.max(b.y, view.y));
  return ix * iy >= 0.25 * b.w * b.h;
}

/**
 * The graph `after` (a planner's result from `before`) with the nodes it added brought into view as
 * one block: `centre` always centres them (nudged off cards), `ifOutOfView` only moves them when
 * they can't be found on screen (their middle is off it and less than a quarter shows). Nothing changes without a view, when nothing was added, or when the
 * plan removed nodes (a rewrite in place keeps its positions).
 */
export function settleAddedInView(before: readonly GraphNode[], after: GraphNode[], view: ViewRect | null,
  opts: { mode?: 'centre' | 'ifOutOfView'; heightOf?: (nd: GraphNode) => number } = {}): GraphNode[] {
  if (!view) return after;
  const heightOf = opts.heightOf ?? cardHeight;
  const was = new Set(before.map(nd => nd.id));
  const now = new Set(after.map(nd => nd.id));
  if (before.some(nd => !now.has(nd.id))) return after;
  const added = after.filter(nd => !was.has(nd.id));
  if (!added.length) return after;
  if ((opts.mode ?? 'ifOutOfView') === 'ifOutOfView') {
    const block = boundsOf(added.map(nd => boxOf(nd, heightOf)))!;
    if (seenIn(block, view)) return after;
  }
  const rest = after.filter(nd => was.has(nd.id));
  const moved = new Map(placeSetupInView(rest, added, view, { heightOf }).map(nd => [nd.id, nd.position]));
  return after.map(nd => (moved.has(nd.id) ? { ...nd, position: moved.get(nd.id)! } : nd));
}

