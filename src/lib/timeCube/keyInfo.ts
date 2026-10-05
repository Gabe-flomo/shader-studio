/**
 * What a Time Cube View's colour key keeps (docs/time-cube.md, "Colour key"): the share of the
 * video's pixels it matches, and the main colours of a frame to pick one from. Pure maths on RGBA
 * bytes (a scaled-down copy of the atlas), no GL, so the card can say "keeps about 4%" for any video.
 */
import { keyMatch, type KeyMode, type KeySettings } from './plan';
import { hueTurn } from './style';

/** The key the view's settings describe, its colour turned by Shift the colour (GLSL: the view's `_kc`). */
export function keySettingsOf(params: Record<string, unknown>): KeySettings {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const mode = (['color', 'hue', 'luma'] as const).includes(params.keyMode as never) ? params.keyMode as KeyMode : 'off';
  const raw = Array.isArray(params.keyColor) && params.keyColor.length >= 3 ? (params.keyColor as number[]) : [0.85, 0.12, 0.12];
  const shift = num(params.keyHueShift, 0);
  const color = shift !== 0 ? hueTurn(raw, shift) : [raw[0], raw[1], raw[2]];
  return {
    mode, color, tolerance: num(params.keyTolerance, 0.12), softness: num(params.keySoftness, 0.06),
    lumaLo: num(params.lumaLo, 0.6), lumaHi: num(params.lumaHi, 1),
  };
}

/** The share (0–1) of pixels in `px` (RGBA bytes) the key keeps: each pixel's match, averaged. */
export function keyShare(px: Uint8ClampedArray | Uint8Array, key: KeySettings): number {
  if (key.mode === 'off') return 0;
  let sum = 0, n = 0;
  const c = [0, 0, 0];
  for (let i = 0; i + 3 < px.length; i += 4) {
    c[0] = px[i] / 255; c[1] = px[i + 1] / 255; c[2] = px[i + 2] / 255;
    sum += keyMatch(c, key);
    n++;
  }
  return n ? sum / n : 0;
}

/** "about 4%", "under 1%", "none": a share as the card says it. */
export function shareText(share: number): string {
  if (share <= 0.0005) return 'none';
  if (share < 0.01) return 'under 1%';
  return `about ${Math.round(share * 100)}%`;
}

/**
 * The main colours in `px` (RGBA bytes), most common first, up to `max`: pixels counted in buckets
 * of a coarse colour grid, each bucket's mean colour, skipping ones too close to a colour already
 * chosen (so a frame of sky gives one blue, not five). Colourful buckets count six times over: a key is
 * usually after the colourful thing, not the grey road.
 */
export function mainColours(px: Uint8ClampedArray | Uint8Array, max = 6): [number, number, number][] {
  const B = 6, buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const k = (Math.floor(r * B / 256) * B + Math.floor(g * B / 256)) * B + Math.floor(b * B / 256);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    const w = sat > 0.35 && mx > 60 ? 6 : 1;
    const o = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    o.n += w; o.r += r * w; o.g += g * w; o.b += b * w;
    buckets.set(k, o);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).map(o => [o.r / o.n / 255, o.g / o.n / 255, o.b / o.n / 255] as [number, number, number]);
  const out: [number, number, number][] = [];
  for (const c of sorted) {
    if (out.every(o => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 0.18)) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
