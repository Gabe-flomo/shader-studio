/**
 * spawnPoint — where a node added from a list or a search goes: centred in
 * the part of the graph on screen (inside a group, that group's canvas), or
 * the free spot nearest that when a card is already there, so the view never
 * has to move to show it. `viewNow` and `intoView` are the same for setups a
 * builder or the Do… bar made (store/placement.ts, docs/node-browser.md).
 */
import { getActiveNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { cardHeight } from '../../store/agentSetup';
import { nearestFree } from '../../store/freeSpace';
import { PLACE_GAP, settleAddedInView, type ViewRect } from '../../store/placement';
import type { GraphNode } from '../../types/nodeGraph';

/** A typical card, so the node's middle (not its corner) lands in the middle of the view. */
const CARD = { w: 360, h: 180 };

export function spawnPoint(): { x: number; y: number } {
  const st = useNodeGraphStore.getState();
  const c = st._viewportCenterGetter?.() ?? { x: 480, y: 290 };
  const nodes = getActiveNodes(st.nodes, st.activeGroupPath) ?? st.nodes;
  const want = { x: Math.round(c.x - CARD.w / 2), y: Math.round(c.y - CARD.h / 2) };
  const view = viewNow();
  // Only the cards near the view count: a far-off graph can't push the node out of sight.
  const near = (n: GraphNode) => !view || (n.position.x < view.x + view.w * 2 && n.position.x > view.x - view.w && n.position.y < view.y + view.h * 2 && n.position.y > view.y - view.h);
  const boxes = nodes.filter(near).map(n => ({ x: n.position.x, y: n.position.y, w: CARD.w, h: cardHeight(n) }));
  const p = nearestFree(CARD, boxes, want, PLACE_GAP / 2);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** The part of the graph on screen (graph coordinates), when the canvas is up. */
export const viewNow = (): ViewRect | null => useNodeGraphStore.getState()._viewportRectGetter?.() ?? null;

/** `after` with the nodes it added (over `before`) brought into the visible canvas (store/placement.ts). */
export const intoView = (before: readonly GraphNode[], after: GraphNode[], mode: 'centre' | 'ifOutOfView' = 'centre'): GraphNode[] =>
  settleAddedInView(before, after, viewNow(), { mode });
