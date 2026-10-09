/**
 * How a build-up row's values become a picture (BuildUpView.tsx): pure, so it is tested without
 * a canvas.
 *
 *  - float: grey, its own range mapped to black…white (the range is labelled next to it);
 *  - vec2: red and green, both components over their shared range;
 *  - vec3 / vec4: the colour itself (clamped to 0…1).
 *
 * A field that is the same everywhere is a constant: a swatch or a number instead.
 */
import { isFlat, spanOf, type Value } from '../../lib/glslPatterns';
import type { RowField } from './buildUpHost';

const comps = (type: string) => (type === 'vec2' ? 2 : type === 'vec3' || type === 'vec4' ? 3 : 1);

/** A strip of CPU values as a field (one row, left to right). */
export function stripField(values: readonly Value[]): RowField {
  const w = values.length;
  const data = new Float32Array(w * 4);
  values.forEach((v, i) => {
    const f = Array.isArray(v) ? v : [v];
    for (let c = 0; c < 4; c++) data[i * 4 + c] = c === 3 ? 1 : f[c] ?? 0;
  });
  return { data, w, h: 1 };
}

/** What a field says: its range (over the components the type uses) and whether it's flat. */
export function fieldSummary(f: RowField, type: string): { range: [number, number] | null; flat: boolean; value: Value | null } {
  const n = comps(type);
  const range = spanOf(f.data, 4, n);
  let flat = true;
  for (let c = 0; c < n && flat; c++) flat = isFlat(spanOf(f.data.subarray(c), 4, 1));
  // A constant's value: the middle texel
  const mid = (Math.floor(f.h / 2) * f.w + Math.floor(f.w / 2)) * 4;
  const value: Value | null = range ? (n === 1 ? f.data[mid] : Array.from(f.data.subarray(mid, mid + (type === 'vec4' ? 4 : n)))) : null;
  return { range, flat, value };
}

/**
 * The field as 8-bit RGBA, top row first (a field's row 0 is the bottom of the picture).
 * `range` maps a float / vec2 to 0…1; colours are drawn as they are.
 */
export function fieldPixels(f: RowField, type: string, range: [number, number] | null): Uint8ClampedArray {
  const out = new Uint8ClampedArray(f.w * f.h * 4);
  const [lo, hi] = range ?? [0, 1];
  const k = hi > lo ? 1 / (hi - lo) : 0;
  const norm = (x: number) => (k ? (x - lo) * k : 0.5);
  const n = comps(type);
  for (let y = 0; y < f.h; y++) {
    const src = (f.h - 1 - y) * f.w * 4, dst = y * f.w * 4;
    for (let x = 0; x < f.w; x++) {
      const i = src + x * 4, o = dst + x * 4;
      const r = f.data[i], g = f.data[i + 1], b = f.data[i + 2];
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) { out[o] = 128; out[o + 1] = 0; out[o + 2] = 128; out[o + 3] = 255; continue; }
      if (n === 1) { const v = norm(r) * 255; out[o] = v; out[o + 1] = v; out[o + 2] = v; }
      else if (n === 2) { out[o] = norm(r) * 255; out[o + 1] = norm(g) * 255; out[o + 2] = 0; }
      else { out[o] = r * 255; out[o + 1] = g * 255; out[o + 2] = b * 255; }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** A constant colour for a swatch (vec3 / vec4), as CSS. */
export function swatchCss(v: Value): string {
  const f = Array.isArray(v) ? v : [v, v, v];
  const c = (x: number) => Math.round(Math.min(1, Math.max(0, x ?? 0)) * 255);
  return `rgb(${c(f[0])}, ${c(f[1])}, ${c(f[2])})`;
}
