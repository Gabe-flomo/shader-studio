/**
 * colorMath.ts — tiny colour conversions shared by the colour picker and the
 * Color node. Everything works on [0, 1] floats, the way the shader wants them.
 */

export type RGB = [number, number, number];
export type HSV = [number, number, number];

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Accepts #rgb, #rrggbb, with or without the hash; null when it is not a colour. */
export function hexToRgb(hex: string): RGB | null {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHsv([r, g, b]: RGB): HSV {
  r = clamp01(r); g = clamp01(g); b = clamp01(b);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max > 1e-6 ? d / max : 0, max];
}

export function hsvToRgb([h, s, v]: HSV): RGB {
  h = ((h % 1) + 1) % 1; s = clamp01(s); v = clamp01(v);
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/** Coerce whatever a param holds into an RGB triple. */
export function toRgb(v: unknown, fallback: RGB = [0, 0, 0]): RGB {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(n => typeof n === 'number')
    ? [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])]
    : fallback;
}

/** `vec3(0.96, 0.55, 0.20)` — what the shader will see. */
export function rgbToGlsl([r, g, b]: RGB): string {
  return `vec3(${[r, g, b].map(v => clamp01(v).toFixed(2)).join(', ')})`;
}
