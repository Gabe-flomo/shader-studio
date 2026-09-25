/**
 * spawnPoint — where a node added from a list or a search goes: centred in
 * the part of the graph on screen (inside a group, that group's canvas), and
 * stepped diagonally off any node already sitting there, so the view never
 * has to move to show it.
 */
import { getActiveNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';

/** A typical card, so the node's middle (not its corner) lands in the middle of the view. */
const CARD = { w: 360, h: 180 };

export function spawnPoint(): { x: number; y: number } {
  const st = useNodeGraphStore.getState();
  const c = st._viewportCenterGetter?.() ?? { x: 480, y: 290 };
  const nodes = getActiveNodes(st.nodes, st.activeGroupPath) ?? st.nodes;
  let p = { x: Math.round(c.x - CARD.w / 2), y: Math.round(c.y - CARD.h / 2) };
  for (let i = 0; i < 12 && nodes.some(n => Math.abs(n.position.x - p.x) < 40 && Math.abs(n.position.y - p.y) < 40); i++) p = { x: p.x + 36, y: p.y + 36 };
  return p;
}
