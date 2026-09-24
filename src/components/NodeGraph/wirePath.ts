// Wire geometry shared by the canvas wires (ConnectionLine) and the phone's graph overlay.

interface Point { x: number; y: number }

const RADIUS = 8;
/** How far a backward wire runs out of the output (and into the input) before turning. */
const LEAD = 18;

/** One rounded corner: arrive along the current axis, turn through `corner`, leave toward `next`. */
function corner(prev: Point, c: Point, next: Point, r: number): string {
  const d1 = Math.hypot(c.x - prev.x, c.y - prev.y);
  const d2 = Math.hypot(next.x - c.x, next.y - c.y);
  const rr = Math.min(r, d1 / 2, d2 / 2);
  if (rr < 0.5) return `L ${c.x} ${c.y}`;
  const a = { x: c.x - ((c.x - prev.x) / d1) * rr, y: c.y - ((c.y - prev.y) / d1) * rr };
  const b = { x: c.x + ((next.x - c.x) / d2) * rr, y: c.y + ((next.y - c.y) / d2) * rr };
  return `L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
}

/** Polyline through `pts` with rounded corners. */
function rounded(pts: Point[]): string {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) d += ` ${corner(pts[i - 1], pts[i], pts[i + 1], RADIUS)}`;
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/**
 * Geometric wire: horizontal out of the output, one vertical run, horizontal into the input, with
 * rounded elbows. When the input is behind the output, the wire leaves forward, crosses back
 * through a horizontal channel between the two sockets (or below both when they are level), and
 * enters the input from its left.
 */
export function wirePath(from: Point, to: Point): string {
  if (Math.abs(to.y - from.y) < 1 && to.x >= from.x) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  if (to.x - from.x >= LEAD) {
    const midX = (from.x + to.x) / 2;
    return rounded([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]);
  }
  const outX = from.x + LEAD;
  const inX = to.x - LEAD;
  const channelY = Math.abs(to.y - from.y) > 4 * RADIUS
    ? (from.y + to.y) / 2
    : Math.max(from.y, to.y) + 60;
  return rounded([
    from,
    { x: outX, y: from.y },
    { x: outX, y: channelY },
    { x: inX, y: channelY },
    { x: inX, y: to.y },
    to,
  ]);
}

