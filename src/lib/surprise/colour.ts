/**
 * colour.ts — random colours that go together (docs/surprise.md).
 *
 * Uniform random RGB is mostly mud. These pick a base hue and a scheme (analogous, complementary,
 * triadic, split, one hue), then keep saturation and lightness inside bands that read well on a
 * dark background. All colours are linear-ish 0–1 RGB triples, as the app's vec3 colours are.
 */
import type { Rng } from './rng';

export type RGB = [number, number, number];
export type Scheme = 'analogous' | 'complementary' | 'triadic' | 'split' | 'mono';

/** h 0–1 (wraps), s and l 0–1 → RGB 0–1. */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hh * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map(v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000) as RGB;
}

/** The hue offsets (in turns) of each scheme. */
const SCHEME_HUES: Record<Scheme, number[]> = {
  analogous: [0, 0.08, -0.08, 0.16],
  complementary: [0, 0.5, 0.04, 0.54],
  triadic: [0, 1 / 3, 2 / 3, 0.08],
  split: [0, 0.42, 0.58, 0.04],
  mono: [0, 0.02, -0.02, 0.01],
};

export interface PaletteOptions {
  scheme?: Scheme;
  /** Saturation band (default 0.45–0.85). */
  sat?: [number, number];
  /** Lightness band (default 0.42–0.68). */
  light?: [number, number];
  /** A fixed base hue 0–1 (default random). */
  hue?: number;
}

/** `n` colours that go together. */
export function harmoniousPalette(rng: Rng, n: number, o: PaletteOptions = {}): RGB[] {
  const scheme = o.scheme ?? rng.weighted<Scheme>([['analogous', 3], ['complementary', 3], ['triadic', 2], ['split', 2], ['mono', 1]]);
  const base = o.hue ?? rng.next();
  const [s0, s1] = o.sat ?? [0.45, 0.85];
  const [l0, l1] = o.light ?? [0.42, 0.68];
  const offs = SCHEME_HUES[scheme];
  return Array.from({ length: n }, (_, i) => hslToRgb(base + offs[i % offs.length] + rng.float(-0.025, 0.025), rng.float(s0, s1), rng.float(l0, l1)));
}

/** One pleasant colour. */
export function randomColour(rng: Rng, o: Omit<PaletteOptions, 'scheme'> = {}): RGB {
  return harmoniousPalette(rng, 1, { ...o, scheme: 'mono' })[0];
}

/** A dark background near a hue (lightness 0.02–0.1): shapes and glows read on it. */
export function darkBackground(rng: Rng, hue = rng.next()): RGB {
  return hslToRgb(hue + rng.float(-0.05, 0.05), rng.float(0.2, 0.55), rng.float(0.025, 0.09));
}

/** A light sky or backdrop (lightness 0.55–0.85). */
export function lightBackground(rng: Rng, hue = rng.next()): RGB {
  return hslToRgb(hue, rng.float(0.15, 0.45), rng.float(0.55, 0.82));
}

/**
 * A ramp from dark to light through one scheme: `n` stops, the first near black and the last
 * near white-tinted, for palettes that colour a number (a trail, a field, a state's age).
 */
export function rampPalette(rng: Rng, n: number, o: Omit<PaletteOptions, 'light'> = {}): RGB[] {
  const cols = harmoniousPalette(rng, Math.max(1, n), o);
  return cols.map((c, i) => {
    const t = n <= 1 ? 1 : i / (n - 1);
    if (i === 0) return darkBackground(rng);
    const l = 0.18 + t * 0.7;
    // Re-light each colour along the ramp, keeping its hue.
    const max = Math.max(...c), min = Math.min(...c);
    const mid = (max + min) / 2 || 0.5;
    return c.map(v => Math.min(1, Math.max(0, (v - mid) * (1 - t * 0.4) + l))) as RGB;
  });
}
