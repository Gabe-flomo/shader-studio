/**
 * transform.ts — moving, resizing and turning layers with handles on the
 * picture. Pure geometry: bounds of a layer, where its handles are, and the
 * patch a drag on one of them makes. overlay.ts draws and hit-tests them.
 *
 * Units: a layer's centre (x, y) is 0..1 with y up; its width and height are
 * in picture heights; rotation is degrees, clockwise on screen. Screen maths
 * is in CSS pixels with y down, where a positive angle also turns clockwise.
 */
import type { PlayLayer } from '../types/play';

export interface Bounds {
  /** Centre, 0..1, y up. */
  x: number; y: number;
  /** Size in picture heights. */
  w: number; h: number;
  /** Degrees, clockwise on screen. */
  rot: number;
  /** Width and height only change together (text, images, the lens). */
  uniform: boolean;
  /** Has a rotation handle. */
  turns: boolean;
}

/** Handles: corners and edge middles (sx, sy in -1, 0, 1; y down), or the rotation knob. */
export type Handle = { kind: 'scale'; sx: number; sy: number } | { kind: 'rotate' };

type Value = (l: PlayLayer, k: string) => number;
type Measure = {
  /** Text width in picture heights for a font size of 1 picture height. */
  textWidth: (l: PlayLayer, line: string) => number;
  /** Width / height of an image or camera frame, or 0 while unknown. */
  mediaAspect: (l: PlayLayer) => number;
};

export function layerBounds(l: PlayLayer, v: Value, m: Measure): Bounds | null {
  const x = v(l, 'x'), y = v(l, 'y');
  switch (l.kind) {
    case 'shape':
      if (l.shape === 'layer' || l.shape === 'picture') return null;
      return { x, y, w: v(l, 'w'), h: v(l, 'h'), rot: v(l, 'rotation'), uniform: false, turns: true };
    case 'text': {
      const size = v(l, 'size'), lines = String(l.sequence ? l.text.split('\n')[0] ?? '' : l.text).split('\n');
      const w = Math.max(size * 0.3, ...lines.map(line => m.textWidth(l, line) * size));
      return { x, y, w, h: size * 1.15 * lines.length, rot: v(l, 'rotation'), uniform: true, turns: true };
    }
    case 'image': case 'camera': {
      const a = m.mediaAspect(l), h = v(l, 'scale');
      return a > 0 ? { x, y, w: h * a, h, rot: v(l, 'rotation'), uniform: true, turns: true } : null;
    }
    case 'audio': return { x, y, w: v(l, 'w'), h: v(l, 'h'), rot: 0, uniform: false, turns: false };
    case 'lens': return l.follow === 'none' ? { x, y, w: v(l, 'radius') * 2, h: v(l, 'radius') * 2, rot: 0, uniform: true, turns: false } : null;
    default: return null;
  }
}

/** A point in screen pixels (y down) for a point in the layer's own frame (picture heights, y down). */
function toScreen(b: Bounds, lx: number, ly: number, W: number, H: number): [number, number] {
  const t = (b.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const px = lx * H, py = ly * H;
  return [b.x * W + px * c - py * s, (1 - b.y) * H + px * s + py * c];
}

/** A screen point in the layer's own frame (picture heights, y down). */
function toLocal(b: Bounds, sx: number, sy: number, W: number, H: number): [number, number] {
  const t = (b.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = sx - b.x * W, dy = sy - (1 - b.y) * H;
  return [(dx * c + dy * s) / H, (-dx * s + dy * c) / H];
}

const ROTATE_GAP = 22;

/** Where each handle sits on screen. */
export function handlePoints(b: Bounds, W: number, H: number): Array<{ handle: Handle; x: number; y: number }> {
  const out: Array<{ handle: Handle; x: number; y: number }> = [];
  for (const sy of [-1, 0, 1]) for (const sx of [-1, 0, 1]) {
    if (!sx && !sy) continue;
    if (b.uniform && (!sx || !sy)) continue;
    const [x, y] = toScreen(b, (sx * b.w) / 2, (sy * b.h) / 2, W, H);
    out.push({ handle: { kind: 'scale', sx, sy }, x, y });
  }
  if (b.turns) { const [x, y] = toScreen(b, 0, -b.h / 2 - ROTATE_GAP / H, W, H); out.push({ handle: { kind: 'rotate' }, x, y }); }
  return out;
}

/** The outline's four corners on screen, clockwise from top-left. */
export function outlinePoints(b: Bounds, W: number, H: number): Array<[number, number]> {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => toScreen(b, (sx * b.w) / 2, (sy * b.h) / 2, W, H));
}

export function handleAt(b: Bounds, px: number, py: number, W: number, H: number, radius = 9): Handle | null {
  let best: Handle | null = null, bestD = radius;
  for (const p of handlePoints(b, W, H)) { const d = Math.hypot(p.x - px, p.y - py); if (d <= bestD) { best = p.handle; bestD = d; } }
  return best;
}

/** Is the screen point inside the layer's box? */
export function insideBounds(b: Bounds, px: number, py: number, W: number, H: number): boolean {
  const [lx, ly] = toLocal(b, px, py, W, H);
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

/**
 * The bounds after dragging `handle` (grabbed on bounds `start`) to the
 * screen point. Corners and edges keep the opposite side still; `centred`
 * (Alt) keeps the centre still instead; `proportional` (Shift, and always
 * for uniform layers) keeps the shape.
 */
export function dragHandle(start: Bounds, handle: Handle, px: number, py: number, W: number, H: number, mods: { proportional: boolean; centred: boolean; snap: boolean }): Bounds {
  if (handle.kind === 'rotate') {
    const cx = start.x * W, cy = (1 - start.y) * H;
    let rot = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
    if (rot > 180) rot -= 360;
    if (mods.snap) rot = Math.round(rot / 15) * 15;
    return { ...start, rot: Math.round(rot * 10) / 10 };
  }
  const { sx, sy } = handle;
  const [lx, ly] = toLocal(start, px, py, W, H);
  // The still point, in the layer's frame.
  const ax = mods.centred ? 0 : (-sx * start.w) / 2, ay = mods.centred ? 0 : (-sy * start.h) / 2;
  const span = mods.centred ? 2 : 1;
  let w = sx ? Math.abs(lx - ax) * span : start.w;
  let h = sy ? Math.abs(ly - ay) * span : start.h;
  if (mods.proportional || start.uniform) {
    // One scale for both: from the axis being dragged, or the larger change at a corner.
    const k = sx && sy ? Math.max(w / start.w, h / start.h) : sx ? w / start.w : h / start.h;
    w = start.w * k; h = start.h * k;
  }
  w = Math.max(0.005, w); h = Math.max(0.005, h);
  // The new centre: the still point plus half the new size toward the handle.
  const cx = mods.centred ? 0 : ax + (sx * w) / 2, cy = mods.centred ? 0 : ay + (sy * h) / 2;
  const t = (start.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = (cx * c - cy * s) * H, dy = (cx * s + cy * c) * H;
  return { ...start, w, h, x: start.x + dx / W, y: start.y - dy / H };
}

/** The layer patch that gives it bounds `b` (grabbed at `start`). */
export function patchFor(l: PlayLayer, start: Bounds, b: Bounds, v: Value): Record<string, unknown> {
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const out: Record<string, unknown> = { x: r4(b.x), y: r4(b.y) };
  if (b.rot !== start.rot) out.rotation = b.rot;
  const kx = b.w / start.w, ky = b.h / start.h;
  switch (l.kind) {
    case 'shape':
      out.w = r4(b.w); out.h = r4(b.h);
      if (l.shape === 'polygon' && (kx !== 1 || ky !== 1)) out.points = l.points.map((p, i) => r4(p * (i % 2 ? ky : kx)));
      break;
    case 'text': out.size = r4(v(l, 'size') * ky); break;
    case 'image': case 'camera': out.scale = r4(v(l, 'scale') * ky); break;
    case 'audio': out.w = r4(b.w); out.h = r4(b.h); break;
    case 'lens': out.radius = r4(v(l, 'radius') * kx); break;
  }
  return out;
}
