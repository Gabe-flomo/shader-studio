/**
 * waterLayer.js — the Water layer's maths (docs/water-layer.md). The surface
 * itself is the Finish stack's Water (finish.js: fnWaterFrame, FN_WATER_STEP,
 * its look): the kit runs one Finish renderer per Water layer with a stack of
 * one Water effect, over what is under the layer, cropped to its region. This
 * file turns a layer into that effect and its numbers (in the region's own
 * units), places things in the region, and reads the surface back: the
 * readings (wave height at a point, energy, area) and the Waves matte.
 *
 * Kept free of the DOM, so the tests and the web page run the same code.
 */
import { FN_EFFECTS, fnWaterSourceOf, fnWaterShapeOf } from './finish.js';

/** A Water layer's readings: the height at its Probe, the energy of the whole surface, the share of it moving. */
export const WL_READS = ['waveHeight', 'energy', 'area'];
/** Where the water is: the whole picture, a box or an ellipse (a pond). */
export const WL_REGIONS = ['all', 'rect', 'ellipse'];
/** How high the read-back surface is, in texels (its width follows the region's shape). */
export const WL_FIELD_ROWS = 90;
/** Readings' scales: a wave this high (a good one: fnWaves reads it as 1) reads Wave height 1 at a crest. */
export const WL_HEIGHT_FULL = 0.4;
/** A cell counts as moving (Area) above this much of fnWaves; Energy is the mean of fnWaves² this many times over. */
export const WL_MOVING = 0.25, WL_ENERGY_GAIN = 6;

// The Water effect's numbers, as the layer keeps them: Source X/Y are sourceX / sourceY (the layer's own x and y are where the pond is).
const WL_RENAME = { x: 'sourceX', y: 'sourceY' };
const WL_BACK = { sourceX: 'x', sourceY: 'y' };
/** The layer's key for one of the Water effect's numbers. */
export function wlLayerKey(effectKey) { return WL_RENAME[effectKey] || effectKey; }
/** The Water effect's key for one of the layer's numbers (or the same key). */
export function wlEffectKey(layerKey) { return WL_BACK[layerKey] || layerKey; }
/** The Water effect's settings, keyed as the layer keeps them (the same ranges, defaults and hints). */
export const WL_PARAMS = FN_EFFECTS.water.params.map(p => Object.assign({}, p, { key: wlLayerKey(p.key) }));
/** Numbers in picture heights (or picture heights a second): the region's own units differ by its height. */
const WL_LENGTHS = { speed: 1, size: 1, length: 1, drop: 1 };

/**
 * The region on the picture, in pixels of a W × H frame (y down): x0, y0 (its top left, whole pixels), w, h
 * (its size, whole pixels, at least 4), `scale` its height in picture heights (1 for the whole picture), and
 * `shape`. A pond can reach past the picture's edges: the water is simulated whole, only what is in view shows.
 */
export function wlRegion(l, v, W, H) {
  const shape = WL_REGIONS.includes(l && l.region) ? l.region : 'all';
  if (shape === 'all') return { shape, x0: 0, y0: 0, w: Math.max(1, Math.round(W)), h: Math.max(1, Math.round(H)), scale: 1 };
  const num = (k, d) => { const x = v(k); return typeof x === 'number' && isFinite(x) ? x : d; };
  const w = Math.max(4, Math.round(Math.max(0.01, num('w', 0.6)) * H)), h = Math.max(4, Math.round(Math.max(0.01, num('h', 0.4)) * H));
  const x0 = Math.round(num('x', 0.5) * W - w / 2), y0 = Math.round((1 - num('y', 0.5)) * H - h / 2);
  return { shape, x0, y0, w, h, scale: h / Math.max(1, H) };
}
/** A point on the picture (0..1, y up) in the region's own 0..1 (y up). */
export function wlToLocal(reg, p, W, H) {
  return { x: (p.x * W - reg.x0) / reg.w, y: 1 - ((1 - p.y) * H - reg.y0) / reg.h };
}
/** A point in the region's own 0..1 (y up) on the picture (0..1, y up). */
export function wlToPicture(reg, p, W, H) {
  return { x: (reg.x0 + p.x * reg.w) / W, y: 1 - (reg.y0 + (1 - p.y) * reg.h) / H };
}

/** The Water effect a layer runs: its Source, Shape and Detail (the numbers come through wlValue). */
export function wlEffect(l) {
  return {
    id: 'water', kind: 'water', enabled: true,
    source: fnWaterSourceOf(l), sourceLayer: (l && l.sourceLayer) || '', shape: fnWaterShapeOf(l), layerId: (l && l.shapeLayer) || '',
    detail: l && (l.detail === 'low' || l.detail === 'high') ? l.detail : 'medium',
  };
}

/**
 * The effect's numbers as the renderer reads them, from the layer's (`value(key)`, a mapping or a Splash may
 * drive them): Source X/Y and a Splash's point in the region's 0..1, and every length in the region's heights,
 * so the waves keep the picture's units (a pond's ripples are the size and speed of the whole picture's).
 */
export function wlValue(reg, value, W, H) {
  const s = reg.scale > 0 ? reg.scale : 1;
  const local = (k, raw) => (k === 'x' ? (raw * W - reg.x0) / reg.w : 1 - ((1 - raw) * H - reg.y0) / reg.h);
  return (e, k) => {
    const raw = value(wlLayerKey(k));
    if (typeof raw !== 'number' || !isFinite(raw)) return raw;
    if (k === 'x' || k === 'y') return local(k, raw);
    // A Splash: its point (negative: at the source, random, under the pointer) and its size.
    if (k === 'splashX' || k === 'splashY') return raw >= 0 ? local(k === 'splashX' ? 'x' : 'y', raw) : raw;
    if (k === 'splashSize') return raw / s;
    return WL_LENGTHS[k] ? raw / s : raw;
  };
}

/** Is a point of the region (0..1, y up) inside its shape? */
export function wlInside(shape, u, v) {
  if (shape !== 'ellipse') return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  const a = (u - 0.5) * 2, b = (v - 0.5) * 2;
  return a * a + b * b <= 1;
}
/**
 * How solid the water is at a point of the region (0..1, y up): 1 inside, fading to 0 over `soft` picture heights
 * at its edge (a box's sides, an ellipse's rim). `pw`, `ph`: the region's size, `H` the picture's height, in pixels.
 */
export function wlEdgeAlpha(shape, u, v, pw, ph, H, soft) {
  if (shape === 'all') return 1;
  let d; // inside the edge, in picture heights
  if (shape === 'ellipse') {
    const a = (u - 0.5) * 2, b = (v - 0.5) * 2, r = Math.sqrt(a * a + b * b);
    d = (1 - r) * Math.min(pw, ph) / 2 / H;
  } else d = Math.min(u * pw, (1 - u) * pw, v * ph, (1 - v) * ph) / H;
  if (d <= 0) return 0;
  const s = Math.max(0, +soft || 0);
  if (s <= 1e-6) return 1;
  const t = Math.min(1, d / s);
  return t * t * (3 - 2 * t);
}

/** A height field's value at a point of the region (0..1, y up), between texels (row 0 at the bottom). */
export function wlSample(f, u, v) {
  const x = Math.max(0, Math.min(f.w - 1, u * f.w - 0.5)), y = Math.max(0, Math.min(f.h - 1, v * f.h - 0.5));
  const i = Math.floor(x), j = Math.floor(y), i1 = Math.min(f.w - 1, i + 1), j1 = Math.min(f.h - 1, j + 1), a = x - i, b = y - j;
  const h = f.height;
  return (h[j * f.w + i] * (1 - a) + h[j * f.w + i1] * a) * (1 - b) + (h[j1 * f.w + i] * (1 - a) + h[j1 * f.w + i1] * a) * b;
}

/**
 * The readings from the read-back surface (fnWaterUnpack: heights and waves, row 0 at the bottom), all 0..1:
 * Wave height at `probe` (the region's 0..1; 0.5 flat or outside, 1 a good crest, 0 as deep a trough), Energy
 * (how much the whole surface moves) and Area (the share of it moving). Only the region's shape counts.
 */
export function wlReadings(f, shape, probe) {
  if (!f || !f.w || !f.h) return { waveHeight: 0.5, energy: 0, area: 0 };
  let n = 0, e = 0, moving = 0;
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
    if (shape === 'ellipse' && !wlInside(shape, (i + 0.5) / f.w, (j + 0.5) / f.h)) continue;
    const w = f.waves[j * f.w + i];
    n++; e += w * w; if (w > WL_MOVING) moving++;
  }
  const inside = probe && wlInside(shape === 'ellipse' ? 'ellipse' : 'rect', probe.x, probe.y);
  const h = inside ? wlSample(f, probe.x, probe.y) : 0;
  return {
    waveHeight: Math.max(0, Math.min(1, 0.5 + 0.5 * h / WL_HEIGHT_FULL)),
    energy: n ? Math.max(0, Math.min(1, Math.sqrt(e / n * WL_ENERGY_GAIN))) : 0,
    area: n ? moving / n : 0,
  };
}

/** Box blur, two passes of radius r cells (the Motion layer's feather, here for the Waves matte). */
function wlBlur(a, cols, rows, r) {
  const R = Math.round(r);
  if (!(R > 0)) return a;
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  let src = a;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let s = 0, c = 0;
      for (let k = -R; k <= R; k++) { const xx = x + k; if (xx >= 0 && xx < cols) { s += src[y * cols + xx]; c++; } }
      tmp[y * cols + x] = s / c;
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let s = 0, c = 0;
      for (let k = -R; k <= R; k++) { const yy = y + k; if (yy >= 0 && yy < rows) { s += tmp[yy * cols + x]; c++; } }
      out[y * cols + x] = s / c;
    }
    src = out.slice();
  }
  return src;
}

/**
 * The Waves matte's alpha per texel of the read-back surface, row 0 at the TOP (as a canvas wants it): solid on a
 * good wave (fnWaves × 1.5), nothing on still water, softened by `feather` picture heights and cut by the region's
 * edge (its Soft edge too). `scale`: the region's height in picture heights.
 */
export function wlMatteAlpha(f, reg, H, feather, soft) {
  const n = f.w * f.h, a = new Float32Array(n);
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) a[(f.h - 1 - j) * f.w + i] = Math.min(1, f.waves[j * f.w + i] * 1.5);
  const r = (+feather || 0) / Math.max(1e-6, reg.scale / f.h);
  const b = wlBlur(a, f.w, f.h, Math.min(f.h / 2, r));
  if (reg.shape !== 'all') for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) b[j * f.w + i] *= wlEdgeAlpha(reg.shape, (i + 0.5) / f.w, 1 - (j + 0.5) / f.h, reg.w, reg.h, H, soft);
  return b;
}
