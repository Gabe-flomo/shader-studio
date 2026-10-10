/**
 * freeSpace.ts — the geometry under node placement (docs/node-browser.md "Where new nodes land"):
 * boxes, their bounds, and the free spot for a block of cards nearest to where it was asked for.
 * No imports, so the placement helpers (placement.ts) and the agent setups (agentSetup.ts) can
 * both use it.
 */

export interface Box { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

/** Whether two boxes come closer than `gap` (touching at exactly `gap` is clear). */
export const boxesHit = (a: Box, b: Box, gap: number): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The box round all of `boxes` (null for none). */
export function boundsOf(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
  const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Where a block of size `size` goes (its top-left): `want` when it clears every obstacle by `gap`,
 * else the clear spot nearest to `want`. The nearest spot always has the block touching an
 * obstacle's edge (plus `gap`) on each axis it moved along, so those edges, and `want` itself, are
 * the only candidates; the nearest clear one wins. Something is always clear (past every
 * obstacle), so the block never ends up on a card, and never further away than it has to be.
 */
export function nearestFree(size: { w: number; h: number }, obstacles: readonly Box[], want: Pt, gap: number): Pt {
  const clear = (x: number, y: number) => {
    const b = { x, y, w: size.w, h: size.h };
    for (const o of obstacles) if (boxesHit(b, o, gap)) return false;
    return true;
  };
  if (clear(want.x, want.y)) return { x: want.x, y: want.y };
  const xs = new Set<number>([want.x]), ys = new Set<number>([want.y]);
  for (const o of obstacles) {
    xs.add(o.x + o.w + gap); xs.add(o.x - gap - size.w);
    ys.add(o.y + o.h + gap); ys.add(o.y - gap - size.h);
  }
  const cands: Array<{ x: number; y: number; d: number }> = [];
  for (const x of xs) for (const y of ys) cands.push({ x, y, d: Math.hypot(x - want.x, y - want.y) });
  cands.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  for (const c of cands) if (clear(c.x, c.y)) return { x: c.x, y: c.y };
  // Unreachable (right of every obstacle is always clear), kept for safety.
  const right = Math.max(...obstacles.map(o => o.x + o.w)) + gap;
  return { x: right, y: want.y };
}
