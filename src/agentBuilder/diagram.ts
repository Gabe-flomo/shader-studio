/**
 * diagram.ts — the geometry of the Agent Builder's viewport diagrams (docs/agent-builder.md): one
 * walker shown up close in a lens over the live picture, facing up, with its three feelers
 * (figure 2.4 of the field guide: Distance ahead, at +Angle on the left and −Angle on the right),
 * the turn arc, the wobble fan, the step length, and the edges. Pure: the SVG draws these.
 */
export type DiagramSection = 'born' | 'senses' | 'turning' | 'moving' | 'trail';

/** What is drawn: the selected section, and the setting under the pointer or being dragged. */
export interface DiagramFocus { section: DiagramSection; setting?: string }

export interface Pt { x: number; y: number }

/** Sections drawn on one walker up close in the lens (the rest draw on the whole picture). */
export const usesLens = (f: DiagramFocus) => f.section === 'senses' || f.section === 'turning' || f.section === 'trail' || (f.section === 'moving' && f.setting !== 'edges');

export interface Lens {
  /** Centre and radius (CSS pixels, in the viewport). */
  cx: number; cy: number; r: number;
  /** Lens pixels per picture unit. */
  scale: number;
  /** Where the walker stands (a little below the centre, facing up so its feelers fill the lens). */
  walker: Pt;
}

/**
 * The lens in a viewport of `w` × `h`, magnified so a feeler `ref` long is half the lens radius.
 * `ref` should stay put while a slider moves (the section's value when it was picked), so the
 * feelers visibly grow and shrink with the slider.
 */
export function lensFor(w: number, h: number, ref: number): Lens {
  const r = Math.max(60, Math.min(w, h) * 0.34);
  const cx = w / 2, cy = h / 2;
  const scale = (r * 0.5) / Math.max(ref, 1e-4);
  return { cx, cy, r, scale, walker: { x: cx, y: cy + r * 0.42 } };
}

const DEG = Math.PI / 180;

/** A point `len` pixels from `from`, `deg` degrees left of straight up (negative: right). */
export const along = (from: Pt, len: number, deg: number): Pt => ({ x: from.x - Math.sin(deg * DEG) * len, y: from.y - Math.cos(deg * DEG) * len });

/** The three feelers: left (+angle), centre and right (−angle), `distance` ahead. */
export function feelers(lens: Lens, distance: number, angle: number): { left: Pt; centre: Pt; right: Pt; length: number } {
  const length = distance * lens.scale;
  return { left: along(lens.walker, length, angle), centre: along(lens.walker, length, 0), right: along(lens.walker, length, -angle), length };
}

/** An SVG arc path round `c` at radius `r` from `a0` to `a1` degrees (left of up is positive). */
export function arcPath(c: Pt, r: number, a0: number, a1: number): string {
  const p0 = along(c, r, a0), p1 = along(c, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  // Increasing angle turns left (counter-clockwise on screen): sweep flag 0.
  const sweep = a1 > a0 ? 0 : 1;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** A wedge (pie slice) from `c`: the wobble's fan of ±deg. */
export function wedgePath(c: Pt, r: number, deg: number): string {
  const d = Math.min(Math.max(deg, 0), 179);
  const p0 = along(c, r, d), p1 = along(c, r, -d);
  return `M ${c.x} ${c.y} L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z`;
}

/** Positions of the last `n` steps behind the walker (one step = speed ÷ 60 picture units). */
export function stepsBehind(lens: Lens, speed: number, n = 5): Pt[] {
  const step = (speed / 60) * lens.scale;
  return Array.from({ length: n }, (_, i) => ({ x: lens.walker.x, y: lens.walker.y + step * (i + 1) }));
}

/** How many steps it takes to reach its feelers (the field guide's 9 : 1 for slime). */
export const stepsToFeelers = (distance: number, speed: number) => (speed > 0 ? distance / (speed / 60) : Infinity);

/** Keep the lens' magnification while the value stays within this share of the reference; else re-fit. */
export function keepRef(ref: number, value: number): number {
  if (!(ref > 0)) return Math.max(value, 1e-4);
  const k = value / ref;
  return k < 0.25 || k > 2.6 ? Math.max(value, 1e-4) : ref;
}

/** A picture point (x across ±aspect, y up ±1) on the shown image rect. */
export function picToView(rect: { x: number; y: number; w: number; h: number }, p: Pt): Pt {
  const aspect = rect.w / Math.max(rect.h, 1);
  return { x: rect.x + (p.x / aspect * 0.5 + 0.5) * rect.w, y: rect.y + (0.5 - p.y * 0.5) * rect.h };
}

/** Image rect for a `sw` × `sh` picture shown "contain" in a `w` × `h` box. */
export function containRect(w: number, h: number, sw: number, sh: number): { x: number; y: number; w: number; h: number } {
  if (!(sw > 0 && sh > 0)) return { x: 0, y: 0, w, h };
  const k = Math.min(w / sw, h / sh);
  return { x: (w - sw * k) / 2, y: (h - sh * k) / 2, w: sw * k, h: sh * k };
}
