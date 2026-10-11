/**
 * diagramDrag.ts — direct manipulation on the Agent Builder's diagrams (docs/agent-builder.md
 * "Dragging the diagrams"): from where the pointer is to the value a slider would write. Pure.
 *
 * Screen points are viewport pixels (y down); picture points are picture units (x ±aspect, y ±1 up),
 * as diagram.ts draws them. Each function returns the setting's new value, rounded to its slider's
 * step and kept in the range the slider would accept (typing past a slider's end widens it, so only
 * the ends that make no sense are kept: a feeler longer than nothing, a turn of at most 90°).
 */
import type { Pt } from './diagram';

const RAD = 180 / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Rounded to `step` (and clear of float dust: 0.1 + 0.2). */
export const snap = (v: number, step: number) => { const k = Math.round(v / step) * step; return Math.round(k * 1e6) / 1e6; };

/** The angle of `p` seen from `from`, in degrees left of straight up (diagram.ts `along`'s convention). */
export const angleLeftOfUp = (from: Pt, p: Pt) => Math.atan2(-(p.x - from.x), -(p.y - from.y)) * RAD;
/** The angle of `p` seen from `from`, in degrees, 0 right and 90 up (the forces' Angle). */
export const angleOnScreen = (from: Pt, p: Pt) => Math.atan2(-(p.y - from.y), p.x - from.x) * RAD;

/**
 * Senses: a feeler dragged to `p` in the lens (`walker` where the walker stands, `scale` lens pixels
 * per picture unit). Out or in sets How far ahead; the left or right feeler dragged sideways sets How
 * wide (the angle either side of straight ahead, 0–90°). The centre feeler sets only the distance.
 */
export function dragSensor(walker: Pt, scale: number, p: Pt, which: 'left' | 'centre' | 'right'): { distance: number; angle?: number } {
  const distance = Math.max(0.001, snap(Math.hypot(p.x - walker.x, p.y - walker.y) / Math.max(scale, 1e-9), 0.0005));
  if (which === 'centre') return { distance };
  const a = angleLeftOfUp(walker, p);
  return { distance, angle: snap(clamp(which === 'left' ? a : -a, 0, 90), 0.5) };
}

/** Turning: the new heading's end dragged round the walker: How sharply (0–90°, to the left as drawn). */
export const dragTurn = (walker: Pt, p: Pt) => snap(clamp(angleLeftOfUp(walker, p), 0, 90), 0.5);

/** Wobble: either edge of its fan dragged round the walker: ± how far (0–45°). */
export const dragWobble = (walker: Pt, p: Pt) => snap(clamp(Math.abs(angleLeftOfUp(walker, p)), 0, 45), 0.5);

/** A ring dragged out or in round `centre` (the view radius in its lens): its radius in picture units. */
export const dragRadius = (centre: Pt, p: Pt, scale: number, min = 0.005) => Math.max(min, snap(Math.hypot(p.x - centre.x, p.y - centre.y) / Math.max(scale, 1e-9), 0.0005));

/**
 * A force's arrow (gravity, wind) dragged by its tip from the particle at `from`: its Angle (0 right,
 * 90 up) and its Strength, from the arrow's length as KindDiagram draws it (18 px + 70 px a unit). A
 * force pointing the other way (negative) keeps its sign.
 */
export function dragForce(from: Pt, p: Pt, sign = 1): { angle: number; strength: number } {
  const len = Math.hypot(p.x - from.x, p.y - from.y);
  const angle = snap(angleOnScreen(from, p), 1);
  return { angle: angle === -180 ? 180 : angle, strength: snap(Math.max(0, (len - 18) / 70), 0.01) * (sign < 0 ? -1 : 1) };
}

/** A screen point on the shown picture back to picture units. */
export function toPicture(rect: { x: number; y: number; w: number; h: number }, p: Pt): Pt {
  const aspect = rect.w / Math.max(rect.h, 1);
  return { x: snap(((p.x - rect.x) / rect.w - 0.5) * 2 * aspect, 0.001), y: snap((0.5 - (p.y - rect.y) / rect.h) * 2, 0.001) };
}

/** A point moved by a drag: where it was (picture units) plus the pointer's travel since the press. */
export function moved(rect: { x: number; y: number; w: number; h: number }, was: Pt, start: Pt, p: Pt): Pt {
  const k = 2 / Math.max(rect.h, 1);
  return { x: snap(was.x + (p.x - start.x) * k, 0.001), y: snap(was.y - (p.y - start.y) * k, 0.001) };
}

/**
 * Born: its shape's size handle dragged to `p` (screen) from its centre `c` (screen): a disc or a
 * ring's radius, a box's half-side (the further of across and up), a line's half-length; picture units.
 */
export function dragBornSize(shape: string, c: Pt, p: Pt, imageH: number): number {
  const k = 2 / Math.max(imageH, 1);
  const dx = Math.abs(p.x - c.x) * k, dy = Math.abs(p.y - c.y) * k;
  const v = shape === 'box' ? Math.max(dx, dy) : shape === 'line' ? dx : Math.hypot(dx, dy);
  return Math.max(0.01, snap(v, 0.005));
}

/** A circle on the picture (an orbit, a field layer's size or mask) dragged by its edge: its radius in picture units. */
export const dragPictureRadius = (c: Pt, p: Pt, imageH: number, min = 0.01) => Math.max(min, snap(Math.hypot(p.x - c.x, p.y - c.y) * 2 / Math.max(imageH, 1), 0.005));

/** Avoid edges: its band's inner edge dragged in from the picture's right edge: the margin in picture units. */
export const dragMargin = (rightEdge: number, p: Pt, imageH: number) => clamp(snap((rightEdge - p.x) * 2 / Math.max(imageH, 1), 0.005), 0.005, 1);
