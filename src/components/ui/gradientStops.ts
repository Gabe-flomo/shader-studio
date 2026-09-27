/**
 * gradientStops.ts — the pure logic behind GradientStopsEditor: adding,
 * moving, recolouring and removing the colour stops of a gradient bar, with a
 * cap on how many there can be. No React, no DOM, so it is easy to test.
 *
 * Two layouts share it:
 *  - free stops (Play and Present backgrounds): each stop keeps its own place
 *    along the bar (`pos`, 0..1), and dragging moves it between its neighbours;
 *  - evenly spaced stops (the Studio's Stops Palette node): the place comes from
 *    the order alone (stop i of n sits at i / (n - 1)), so dragging reorders
 *    them and adding puts the new stop between the two it fell between.
 */

export type RGB = [number, number, number];
export interface GradientStop { pos: number; color: RGB }
/** How the bar paints between stops: blended, or each colour held until the next stop. */
export type GradientStyle = 'gradient' | 'bands';

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

const rgb = (c: readonly number[]): RGB => [clamp01(c[0] ?? 0), clamp01(c[1] ?? 0), clamp01(c[2] ?? 0)];

/** Stops sorted by place (stable, so equal places keep their order), clamped to 0..1. */
export function sortStops(stops: readonly GradientStop[]): GradientStop[] {
  return stops
    .map((s, i) => ({ s: { pos: clamp01(s.pos), color: rgb(s.color) }, i }))
    .sort((a, b) => a.s.pos - b.s.pos || a.i - b.i)
    .map(x => x.s);
}

/** Where evenly spaced stops sit: n places from 0 to 1 (one stop sits at 0). */
export function evenPositions(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (n > 1 ? i / (n - 1) : 0));
}

/** Colours as evenly spaced stops. */
export function evenStops(colors: readonly RGB[]): GradientStop[] {
  const pos = evenPositions(colors.length);
  return colors.map((c, i) => ({ pos: pos[i], color: rgb(c) }));
}

/**
 * The colour of the bar at `t` (0..1): a blend of the two stops around it, or
 * with bands the colour of the stop before it. The stops must be sorted.
 */
export function colourAt(stops: readonly GradientStop[], t: number, style: GradientStyle = 'gradient'): RGB {
  if (stops.length === 0) return [0, 0, 0];
  if (t <= stops[0].pos) return [...stops[0].color];
  if (style === 'bands') {
    let c = stops[0].color;
    for (const s of stops) if (s.pos <= t) c = s.color;
    return [...c];
  }
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (t <= b.pos) {
      const k = b.pos > a.pos ? (t - a.pos) / (b.pos - a.pos) : 1;
      return [0, 1, 2].map(j => a.color[j] + (b.color[j] - a.color[j]) * k) as RGB;
    }
  }
  return [...stops[stops.length - 1].color];
}

export interface StopsChange { stops: GradientStop[]; /** The stop to show as selected afterwards. */ index: number }

/**
 * Add a stop at `pos`, in the colour the bar already has there, unless the bar
 * is full (`max`): then nothing changes and null comes back.
 */
export function addStop(stops: readonly GradientStop[], pos: number, max: number, style: GradientStyle = 'gradient', color?: RGB): StopsChange | null {
  if (stops.length >= max) return null;
  const sorted = sortStops(stops);
  const s: GradientStop = { pos: clamp01(pos), color: color ? rgb(color) : colourAt(sorted, clamp01(pos), style) };
  const next = sortStops([...sorted, s]);
  return { stops: next, index: next.indexOf(s) };
}

/** Add a stop halfway between stop `i` and its next neighbour (or the one before it, at the end). */
export function addStopBeside(stops: readonly GradientStop[], i: number, max: number, style: GradientStyle = 'gradient'): StopsChange | null {
  const sorted = sortStops(stops);
  const a = sorted[i] ?? sorted[0];
  if (!a) return addStop(sorted, 0.5, max, style);
  const b = sorted[i + 1] ?? sorted[i - 1] ?? a;
  const pos = a === b ? (a.pos < 0.5 ? (a.pos + 1) / 2 : a.pos / 2) : (a.pos + b.pos) / 2;
  return addStop(sorted, pos, max, style);
}

/**
 * Drag stop `i` to `pos`, kept between its neighbours so the order (and which
 * handle is which) holds while the pointer moves.
 */
export function moveStop(stops: readonly GradientStop[], i: number, pos: number): GradientStop[] {
  if (i < 0 || i >= stops.length) return [...stops];
  const lo = i > 0 ? stops[i - 1].pos : 0, hi = i + 1 < stops.length ? stops[i + 1].pos : 1;
  const p = Math.max(lo, Math.min(hi, clamp01(pos)));
  return stops.map((s, j) => (j === i ? { ...s, pos: p } : s));
}

/** Put stop `i` at an exact place (typed, or nudged), re-sorting; the change says where it went. */
export function setStopPos(stops: readonly GradientStop[], i: number, pos: number): StopsChange {
  if (i < 0 || i >= stops.length) return { stops: sortStops(stops), index: Math.max(0, Math.min(i, stops.length - 1)) };
  const moved: GradientStop = { ...stops[i], pos: clamp01(pos) };
  const next = sortStops(stops.map((s, j) => (j === i ? moved : s)));
  return { stops: next, index: next.indexOf(moved) };
}

/** Nudge stop `i` by `delta` (1% a step, 10% with Shift). */
export function nudgeStop(stops: readonly GradientStop[], i: number, delta: number): StopsChange {
  return setStopPos(stops, i, (stops[i]?.pos ?? 0) + delta);
}

export function setStopColour(stops: readonly GradientStop[], i: number, color: RGB): GradientStop[] {
  return stops.map((s, j) => (j === i ? { ...s, color: rgb(color) } : s));
}

/** Remove stop `i`, never below `min` stops (then null); the change selects its neighbour before it. */
export function removeStop(stops: readonly GradientStop[], i: number, min = 2): StopsChange | null {
  if (stops.length <= min || i < 0 || i >= stops.length) return null;
  return { stops: stops.filter((_, j) => j !== i), index: Math.max(0, Math.min(i, stops.length - 2)) };
}

/** The same colours, mirrored end to end. */
export function reverseStops(stops: readonly GradientStop[]): GradientStop[] {
  return sortStops(stops.map(s => ({ pos: 1 - s.pos, color: s.color })));
}

/** The same colours in the same order, spread evenly from 0 to 1. */
export function distributeStops(stops: readonly GradientStop[]): GradientStop[] {
  return evenStops(sortStops(stops).map(s => s.color));
}

/**
 * At most `max` stops. More are resampled evenly along the same colours (so a
 * 32-stop palette keeps its look in 8 stops); fewer come back sorted as they are.
 */
export function limitStops(stops: readonly GradientStop[], max: number, style: GradientStyle = 'gradient'): GradientStop[] {
  const sorted = sortStops(stops);
  if (sorted.length <= max) return sorted;
  const lo = sorted[0].pos, hi = sorted[sorted.length - 1].pos;
  return Array.from({ length: max }, (_, i) => {
    const pos = lo + ((hi - lo) * i) / Math.max(1, max - 1);
    return { pos, color: colourAt(sorted, pos, style) };
  });
}

// ─── Evenly spaced stops (the order is the place) ─────────────────────────────

/** The slot an evenly spaced stop dragged to `t` lands in: the nearest of n places. */
export function slotAt(n: number, t: number): number {
  return Math.max(0, Math.min(n - 1, Math.round(clamp01(t) * (n - 1))));
}

/** Move colour `from` to slot `to`, the others closing up (a drag along the bar). */
export function reorderColours<T>(colors: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= colors.length) return [...colors];
  const t = Math.max(0, Math.min(colors.length - 1, to));
  const next = [...colors];
  const [c] = next.splice(from, 1);
  next.splice(t, 0, c);
  return next;
}

/**
 * A new evenly spaced stop where `t` fell: between the two stops around it, in
 * the colour the bar had there. Null when the palette is full.
 */
export function insertColourAt(colors: readonly RGB[], t: number, max: number, style: GradientStyle = 'gradient'): { colors: RGB[]; index: number } | null {
  if (colors.length >= max) return null;
  if (colors.length === 0) return { colors: [[0.5, 0.5, 0.5]], index: 0 };
  const stops = evenStops(colors);
  const c = colourAt(stops, t, style);
  const n = colors.length;
  // Between k and k + 1 (past the last stop: after it; before the first: before it).
  const k = n > 1 ? Math.floor(clamp01(t) * (n - 1)) : (t > 0.5 ? 0 : -1);
  const index = Math.max(0, Math.min(n, k + 1));
  const next = [...colors];
  next.splice(index, 0, c);
  return { colors: next, index };
}
