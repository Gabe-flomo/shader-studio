/**
 * palette.ts — everything the two palette nodes share outside the shader:
 *
 *  - parsePaletteText: read a palette pasted from anywhere (hex lists, a
 *    coolors.co link, CSS rgb()/hsl(), GLSL vec3(), JSON, GIMP/Lospec lines).
 *  - cosine ↔ stops: sample a cosine Palette into colour stops.
 *  - user presets: named palettes saved in the browser, usable by both nodes
 *    (a cosine preset applies to a Stops Palette by sampling it).
 *
 * Pure apart from the preset storage, which reads and writes localStorage.
 */
import { safeSetItem, type FileResult } from '../utils/fileIO';

export type RGB = [number, number, number];

export interface CosineCoeffs {
  offset: RGB;
  amplitude: RGB;
  freq: RGB;
  phase: RGB;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

export type ParsedPalette = { ok: true; colors: RGB[]; format: string } | { ok: false; error: string };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function hexToRgb(hex: string): RGB | null {
  let h = hex.replace(/^#|^0x/i, '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  // h in degrees, s and l in 0–1
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Numbers in a comma/space/slash separated argument list; `%` values come back as fractions. */
function argNumbers(args: string): Array<{ v: number; pct: boolean }> {
  return [...args.matchAll(/(-?\d*\.?\d+(?:e-?\d+)?)(%?)/gi)].map(m => ({ v: parseFloat(m[1]), pct: m[2] === '%' }));
}

function fromCssRgb(args: string): RGB | null {
  const n = argNumbers(args);
  if (n.length < 3) return null;
  return [0, 1, 2].map(i => clamp01(n[i].pct ? n[i].v / 100 : n[i].v / 255)) as RGB;
}

function fromCssHsl(args: string): RGB | null {
  const n = argNumbers(args);
  if (n.length < 3) return null;
  const pct = (x: { v: number; pct: boolean }) => (x.pct || x.v > 1 ? x.v / 100 : x.v);
  return hslToRgb(((n[0].v % 360) + 360) % 360, clamp01(pct(n[1])), clamp01(pct(n[2])));
}

function fromVec(args: string): RGB | null {
  const n = argNumbers(args).map(x => x.v);
  if (n.length === 1) return [clamp01(n[0]), clamp01(n[0]), clamp01(n[0])];
  if (n.length < 3) return null;
  return [clamp01(n[0]), clamp01(n[1]), clamp01(n[2])];
}

/** Triples of numbers: 0–255 unless every value fits in 0–1. */
function fromTriples(triples: number[][]): RGB[] {
  const byte = triples.some(t => t.some(v => v > 1));
  return triples.map(t => t.slice(0, 3).map(v => clamp01(byte ? v / 255 : v)) as RGB);
}

function fromJson(value: unknown): RGB[] | null {
  const list = Array.isArray(value) ? value
    : value && typeof value === 'object' && Array.isArray((value as { colors?: unknown }).colors) ? (value as { colors: unknown[] }).colors
    : null;
  if (!list || list.length === 0) return null;
  if (list.every(v => Array.isArray(v) && v.length >= 3 && v.every(n => typeof n === 'number'))) return fromTriples(list as number[][]);
  const out: RGB[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const parsed = parsePaletteText(item);
      if (parsed.ok) out.push(...parsed.colors);
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      if (typeof o.hex === 'string') { const c = hexToRgb(o.hex); if (c) out.push(c); }
      else if (typeof o.r === 'number' && typeof o.g === 'number' && typeof o.b === 'number') out.push(...fromTriples([[o.r, o.g, o.b]]));
    }
  }
  return out.length ? out : null;
}

/** The paste formats, compactly, with an example each (shown as chips in the paste box). */
export const PASTE_FORMATS: ReadonlyArray<{ label: string; example: string }> = [
  { label: '#hex', example: '#264653 2a9d8f #e9c46a — any separators, 3/6/8 digits, 0xff8800' },
  { label: 'coolors', example: 'https://coolors.co/264653-2a9d8f-e9c46a' },
  { label: 'rgb()', example: 'rgb(38, 70, 83)  rgba(0,255,0,.5)  rgb(100% 50% 0%)' },
  { label: 'hsl()', example: 'hsl(200, 40%, 30%)' },
  { label: 'vec3()', example: 'vec3(0.15, 0.27, 0.33)' },
  { label: 'JSON', example: '["#264653", …]  [[38,70,83], …]  {"colors": […]}' },
  { label: 'R G B', example: 'Lines of three numbers, e.g. a GIMP .gpl: 38 70 83 Charcoal' },
];

/** Colour tokens in reading order: CSS functions, vec3(), #hex / 0xhex, then bare 6-digit hex words. */
const TOKEN_RE = /\b(rgba?)\(([^)]*)\)|\b(hsla?)\(([^)]*)\)|\bvec[34]\(([^)]*)\)|(?:#|\b0x)([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?<![\w#-])([0-9a-f]{6})(?![\w-])/gi;

/**
 * Read a palette from pasted text. Tries, in order: a coolors.co link, JSON,
 * colour tokens (hex, rgb(), hsl(), vec3()) in reading order, and finally
 * lines of three numbers (GIMP .gpl, "255 128 0", "0.2, 0.4, 0.9").
 */
export function parsePaletteText(text: string): ParsedPalette {
  const src = text.trim();
  if (!src) return { ok: false, error: 'Nothing to read. Paste hex codes, a coolors.co link, rgb() values or a JSON list.' };

  const coolors = /coolors\.co\/(?:palette\/)?([0-9a-f]{6}(?:-[0-9a-f]{6})+)/i.exec(src);
  if (coolors) return { ok: true, colors: coolors[1].split('-').map(h => hexToRgb(h)!), format: 'coolors.co link' };

  if (/^[[{]/.test(src)) {
    try {
      const colors = fromJson(JSON.parse(src));
      if (colors) return { ok: true, colors, format: 'JSON' };
    } catch { /* not JSON after all: fall through to the token scan */ }
  }

  const colors: RGB[] = [];
  const kinds = new Set<string>();
  for (const m of src.matchAll(TOKEN_RE)) {
    let c: RGB | null = null;
    if (m[1]) { c = fromCssRgb(m[2]); kinds.add('rgb()'); }
    else if (m[3]) { c = fromCssHsl(m[4]); kinds.add('hsl()'); }
    else if (m[5] !== undefined) { c = fromVec(m[5]); kinds.add('vec3()'); }
    else if (m[6]) { c = hexToRgb(m[6]); kinds.add('hex'); }
    else if (m[7]) { c = hexToRgb(m[7]); kinds.add('hex'); }
    if (c) colors.push(c);
  }
  if (colors.length) return { ok: true, colors, format: [...kinds].join(' + ') };

  // Lines of three numbers, e.g. a GIMP palette: "255 128  0\tOrange"
  const triples = src.split(/\r?\n/)
    .map(l => l.replace(/#.*$/, '').trim())
    .map(l => (/^(-?\d*\.?\d+)[\s,;]+(-?\d*\.?\d+)[\s,;]+(-?\d*\.?\d+)/.exec(l) ?? []).slice(1).map(Number))
    .filter(t => t.length === 3 && t.every(Number.isFinite));
  if (triples.length) return { ok: true, colors: fromTriples(triples), format: 'RGB triples' };

  return { ok: false, error: 'No colours found. Supported: #hex lists, a coolors.co link, rgb()/hsl(), vec3(), JSON arrays, or lines of "R G B".' };
}

// ─── Cosine palette ───────────────────────────────────────────────────────────

/** The colour the cosine Palette node produces at `t` (the same formula as its GLSL). */
export function cosineColor(c: CosineCoeffs, t: number): RGB {
  return [0, 1, 2].map(i => c.offset[i] + c.amplitude[i] * Math.cos(6.28318 * (c.freq[i] * t + c.phase[i]))) as RGB;
}

/**
 * Sample a cosine palette into `count` evenly spaced stops over `period`
 * (t = 0 … period·(count-1)/count), for a Stops Palette in Loop mode: when
 * `period` is the palette's true repeat length the last stop blends back into
 * the first exactly where the cosine repeats.
 */
export function cosineToStops(c: CosineCoeffs, count = 8, period = 1): RGB[] {
  return Array.from({ length: count }, (_, i) => cosineColor(c, (i / count) * period).map(clamp01) as RGB);
}

/**
 * The shortest whole-number Angle span after which the cosine palette repeats
 * exactly: every channel's frequency × span is a whole number (a flat channel
 * doesn't count). IQ-style palettes (freq 1) repeat every 1; freq 0.5 needs 2;
 * Sunset's 1 / 0.7 / 0.4 needs 10. Null when nothing up to `maxPeriod` works.
 */
export function cosinePeriod(c: CosineCoeffs, maxPeriod = 10, tol = 0.01): number | null {
  for (let P = 1; P <= maxPeriod; P++) {
    const repeats = [0, 1, 2].every(i => {
      if (Math.abs(c.amplitude[i]) < 1e-6) return true;
      const x = Math.abs(c.freq[i]) * P;
      return Math.abs(x - Math.round(x)) < tol;
    });
    if (repeats) return P;
  }
  return null;
}

// ─── Evaluating a Stops Palette (mirrors its GLSL) ─────────────────────────────

export type StopWrap = 'loop' | 'mirror' | 'clamp';
export type StopBlend = 'smooth' | 'linear' | 'curve' | 'bands';

/** Catmull-Rom through p1 → p2, shaped by the neighbours p0 and p3: passes through every stop with no flat spots. */
function catmull(p0: number, p1: number, p2: number, p3: number, f: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/** The colour a Stops Palette gives at `t`, exactly as its shader computes it. */
export function evalStops(stops: RGB[], t: number, wrap: string = 'loop', blend: string = 'smooth'): RGB {
  const n = stops.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return stops[0];
  const fract = (x: number) => x - Math.floor(x);
  const loop = wrap === 'loop';
  const segs = loop ? n : n - 1;
  const u = loop ? fract(t) : wrap === 'mirror' ? Math.abs(fract(t * 0.5) * 2 - 1) : clamp01(t);
  const x = Math.min(u * segs, segs - 0.0001);
  const k = Math.floor(x), f = x - k;
  const at = (i: number) => stops[loop ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  const a = at(k), b = at(k + 1);
  if (blend === 'curve') {
    const p0 = at(k - 1), p3 = at(k + 2);
    return [0, 1, 2].map(c => catmull(p0[c], a[c], b[c], p3[c], f)) as RGB;
  }
  const w = blend === 'bands' ? 0 : blend === 'linear' ? f : f * f * (3 - 2 * f);
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}

// ─── Fitting a cosine palette with stops ──────────────────────────────────────

/**
 * How far a set of stops strays from the cosine palette: the largest channel
 * difference, 0–1, with the stops spanning `period` of the cosine's Angle.
 * `seamless: false` leaves out the last segment, where a palette that never
 * repeats has to blend back to the start (that seam is unavoidable, not a miss).
 */
export function stopsError(c: CosineCoeffs, stops: RGB[], blend: StopBlend, period = 1, seamless = true, samples = 384): number {
  let worst = 0;
  const end = seamless ? 1 : 1 - 1 / stops.length;
  for (let i = 0; i < samples; i++) {
    const u = (i / samples) * end;
    const want = cosineColor(c, u * period).map(clamp01);
    const got = evalStops(stops, u, 'loop', blend);
    for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(clamp01(got[ch]) - want[ch]));
  }
  return worst;
}

export interface StopsFit {
  stops: RGB[];
  blend: StopBlend;
  /** Largest channel difference from the cosine palette, 0–1. */
  error: number;
  /**
   * Angle span the stops cover. The converted node's Scale and Speed are divided by it,
   * so the stops cycle exactly as fast as the cosine palette did.
   */
  period: number;
  /** False when the palette never repeats: the stops follow one trip and blend back at the seam. */
  seamless: boolean;
}

function bestBlend(c: CosineCoeffs, count: number, period: number, seamless: boolean): StopsFit {
  const stops = cosineToStops(c, count, period);
  const curve = stopsError(c, stops, 'curve', period, seamless);
  const linear = stopsError(c, stops, 'linear', period, seamless);
  return curve <= linear
    ? { stops, blend: 'curve', error: curve, period, seamless }
    : { stops, blend: 'linear', error: linear, period, seamless };
}

/**
 * `count` evenly spaced stops with whichever blend (Curve or Linear) follows the palette more
 * closely. When the palette repeats (see cosinePeriod) the stops span a whole repeat so they
 * loop exactly; if that repeat is too long for `count` stops to follow, one trip is used instead.
 */
export function fitCosineStops(c: CosineCoeffs, count: number): StopsFit {
  const P = cosinePeriod(c);
  if (P === 1) return bestBlend(c, count, 1, true);
  const oneTrip = bestBlend(c, count, 1, false);
  if (P === null) return oneTrip;
  const full = bestBlend(c, count, P, true);
  return full.error <= Math.max(oneTrip.error, 0.02) ? full : oneTrip;
}

/**
 * The fewest evenly spaced stops that reproduce the cosine palette within
 * `tolerance` (largest channel error, 0–1; 0.01 ≈ 2.5/255). Falls back to
 * `maxStops` when even that isn't close enough (e.g. very high frequencies).
 */
export function autoFitCosineStops(c: CosineCoeffs, maxStops: number, tolerance = 0.01): StopsFit {
  let best: StopsFit | null = null;
  for (let n = 3; n <= maxStops; n++) {
    const fit = fitCosineStops(c, n);
    if (!best || fit.error < best.error) best = fit;
    if (fit.error <= tolerance) return fit;
  }
  return best ?? fitCosineStops(c, maxStops);
}

// ─── User presets ─────────────────────────────────────────────────────────────

export interface PalettePresetRecord {
  id: string;
  name: string;
  kind: 'cosine' | 'stops';
  cosine?: CosineCoeffs;
  stops?: RGB[];
  wrap?: string;
  blend?: string;
  savedAt: number;
}

const PRESETS_KEY = 'shader-studio:palette-presets';
/** Fired on window whenever the saved presets change, so every open card refreshes its menu. */
export const PALETTE_PRESETS_CHANGED = 'palette-presets-changed';

export function loadPalettePresets(): PalettePresetRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(p => p && typeof p.name === 'string' && (p.kind === 'cosine' || p.kind === 'stops')) : [];
  } catch {
    return [];
  }
}

function writePresets(list: PalettePresetRecord[]): FileResult {
  const r = safeSetItem(PRESETS_KEY, JSON.stringify(list), 'palette presets');
  if (r.ok && typeof window !== 'undefined') window.dispatchEvent(new Event(PALETTE_PRESETS_CHANGED));
  return r;
}

/** Save a preset; a preset with the same name and kind is replaced. */
export function savePalettePreset(p: Omit<PalettePresetRecord, 'id' | 'savedAt'>): FileResult {
  const list = loadPalettePresets().filter(x => !(x.name === p.name && x.kind === p.kind));
  return writePresets([...list, { ...p, id: `pp_${Date.now()}_${Math.round(Math.random() * 1e6)}`, savedAt: Date.now() }]);
}

export function deletePalettePreset(id: string): FileResult {
  return writePresets(loadPalettePresets().filter(p => p.id !== id));
}
