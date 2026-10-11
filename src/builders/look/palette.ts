/**
 * palette.ts — a scene's palette and its slots (docs/builder-look.md, "Palette").
 *
 * A scene builder's Look has one palette: a library palette (PALETTES: the Palette node's cosine
 * presets and the Color Ramp stop sets) or the scene's own colours (`custom`), made right there
 * and saved to the palette library (lib/palette.ts) when wanted. Its swatches are the palette's
 * SLOTS: the background and each shape can take a slot instead of a free colour, so changing the
 * palette recolours everything that uses its slots. The built graph keeps that: one Color node per
 * slot in use, wired to every part that takes it.
 *
 * Pure data and maths: the builders' specs, recipes, graph builders and forms read it.
 */
import { PALETTE_PRESETS } from '../../nodes/definitions/color';
import { PALETTE_BY_KEY, PALETTES, type PaletteDef } from '../../sceneBuilder/output';
import { cosineColor, type PalettePresetRecord } from '../../lib/palette';

export type Vec3 = [number, number, number];

/** The key of a scene's own palette. */
export const CUSTOM_PALETTE = 'custom';
/** The most colours a palette holds (a Color Ramp's stops). */
export const MAX_SWATCHES = 8;
/** How many swatches a cosine palette offers as slots. */
export const COSINE_SLOTS = 5;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const c01 = (n: number) => Math.max(0, Math.min(1, n));
const rgb = (c: readonly number[]): Vec3 => [r3(c01(c[0])), r3(c01(c[1])), r3(c01(c[2]))];

/** The colours a library palette offers as slots: a ramp's stops, or a cosine palette sampled evenly round its loop. */
export function librarySwatches(def: PaletteDef): Vec3[] {
  if (def.kind === 'ramp') return (def.stops ?? [[0, 0, 0], [1, 1, 1]]).map(rgb);
  const p = PALETTE_PRESETS[def.preset ?? 0] ?? PALETTE_PRESETS[0];
  return Array.from({ length: COSINE_SLOTS }, (_, i) => rgb(cosineColor(p, i / COSINE_SLOTS)));
}

/** The swatches (slots) of a palette: `key` from the library, or the scene's own colours. */
export function paletteSwatches(key: string, custom?: readonly Vec3[] | null): Vec3[] {
  if (key === CUSTOM_PALETTE && custom && custom.length >= 2) return custom.map(c => [...c] as Vec3);
  return librarySwatches(PALETTE_BY_KEY[key] ?? PALETTE_BY_KEY.sunset);
}

/** A slot's colour; a slot past the end wraps round (a palette shortened under it still colours). */
export function slotColour(swatches: readonly Vec3[], slot: number): Vec3 {
  const n = Math.max(1, swatches.length);
  const i = ((Math.round(slot) % n) + n) % n;
  return [...(swatches[i] ?? [1, 1, 1])] as Vec3;
}

/** The palette's name for a summary. */
export function paletteLabel(key: string, customName?: string | null): string {
  if (key === CUSTOM_PALETTE) return customName || 'Your palette';
  return PALETTE_BY_KEY[key]?.label ?? key;
}

/** Every library palette, for a picker (swatch strips). */
export const LIBRARY_PALETTES = PALETTES;

/** A saved palette (the palette library) as colours a scene can take: its stops, or a cosine sampled. */
export function savedSwatches(p: PalettePresetRecord): Vec3[] {
  if (p.kind === 'stops' && p.stops?.length) return p.stops.slice(0, MAX_SWATCHES).map(rgb);
  if (p.kind === 'cosine' && p.cosine) {
    const c = p.cosine;
    return Array.from({ length: COSINE_SLOTS }, (_, i) => rgb(cosineColor(c, i / COSINE_SLOTS)));
  }
  return [[0, 0, 0], [1, 1, 1]];
}

/** A CSS gradient of swatches, evenly spaced (how a Color Ramp reads them). */
export function swatchGradient(sw: readonly Vec3[]): string {
  const css = (c: Vec3) => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})`;
  if (sw.length === 1) return css(sw[0]);
  return `linear-gradient(90deg, ${sw.map((c, i) => `${css(c)} ${Math.round(i / (sw.length - 1) * 100)}%`).join(', ')})`;
}
