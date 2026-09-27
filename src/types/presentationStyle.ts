/**
 * presentationStyle.ts — how a presentation looks: a background per step
 * (with a presentation-wide default each step inherits unless it sets its
 * own), legibility effects over it, and the typography (fonts from Google
 * Fonts, embedded; size, line height, text colours).
 *
 *   Presentation.style       { background?, typography? }
 *   Presentation.images      the image backgrounds, each once. Saved in this
 *                            browser they're references to the backgrounds
 *                            library (IndexedDB) with a tiny blurred preview
 *                            (`thumb`, a few KB); exports and downloaded files
 *                            carry the full picture in `src` (present/presentAssets.ts)
 *   Presentation.fonts       the chosen fonts' faces. Saved here without their
 *                            files (those are in lib/fontCache.ts); exports and
 *                            files embed them in `src`
 *   Step.background          absent: the presentation's; { kind: 'none' }: none
 *
 * A background is flat (kind plus every kind's settings), so switching kinds
 * and back finds what was set before. Effects are one-knob amounts, 0..1:
 *
 *   blur      the image, softened (images only)
 *   falloff   how much the blur fades out toward the sides: 0 = even all over,
 *             1 = full behind the content column, none at the edges
 *   shade     darken under light text, lighten under dark text
 *   vignette  the edges fade to the shade colour
 *
 * Text colours follow the background: light text on dark backgrounds (from
 * the image's average colour, the fill's stops, the colour), unless the
 * typography sets its own. Pure: parsing, the look of a step, sizes.
 */
import { PLAY_FILL_STOPS_MAX, parseFill, fitStops, type BackgroundFill } from './play';

export type RGB = [number, number, number];
export type BackgroundKind = 'none' | 'colour' | 'fill' | 'image';
export type FontCategory = 'sans' | 'serif' | 'display' | 'handwriting' | 'mono';
export type FontRoleName = 'heading' | 'body' | 'code';

export interface PresentBackground {
  kind: BackgroundKind;
  colour?: RGB;
  /** A gradient or palette's stops (at most PLAY_FILL_STOPS_MAX). */
  fill?: BackgroundFill;
  /** An id in Presentation.images. */
  image?: string;
  fit?: 'cover' | 'contain';
  /** Where the image is anchored, 0..1 across and down (0.5, 0.5 = centred). */
  position?: [number, number];
  blur?: number;
  falloff?: number;
  shade?: number;
  vignette?: number;
}

export interface PresentImage {
  id: string;
  name: string;
  /**
   * The picture as a data URL (JPEG, PNG or WebP): only in exported pages,
   * downloaded files, and until an imported one is moved into the library.
   */
  src?: string;
  /** The library's image background it is: where the picture comes from in the app. */
  libraryId?: string;
  width?: number;
  height?: number;
  /** A tiny preview (a JPEG data URL of a few KB), shown blurred while the picture loads or when it's missing. */
  thumb?: string;
  /** Its average colour, 0..1: decides the text colour over it. */
  avg?: RGB;
}

export interface FontRole {
  family: string;
  category: FontCategory;
  /** Headings: the weight they're set in. Body and code: 400. */
  weight: number;
}

export interface PresentTypography {
  heading?: FontRole;
  body?: FontRole;
  code?: FontRole;
  /** Text size, × the default (0.8..1.4). */
  scale?: number;
  /** Body line height (1.2..2.1). */
  lineHeight?: number;
  headingColour?: RGB;
  bodyColour?: RGB;
}

export interface PresentStyle {
  background?: PresentBackground;
  typography?: PresentTypography;
}

/** One @font-face of an embedded font. */
export interface EmbeddedFontFace {
  family: string;
  /** '400', or a range for a variable font: '400 700'. */
  weight: string;
  style: 'normal' | 'italic';
  unicodeRange?: string;
  /** data:font/woff2;base64,… (or woff / ttf): in exports and files; saved here the file is in the font cache. */
  src?: string;
}

// ── Limits and defaults ─────────────────────────────────────────────────────

export const SCALE_RANGE = [0.8, 1.4] as const;
export const LINE_HEIGHT_RANGE = [1.2, 2.1] as const;
export const DEFAULT_LINE_HEIGHT = 1.62;
/** Blur at 1, in CSS pixels. */
export const BLUR_MAX_PX = 44;
/** Embedded images and fonts over this and the Style panel and the export warn. */
export const STYLE_WARN_BYTES = 10 * 1024 * 1024;
/** An image background in a presentation: a data URL of at most this many characters. */
export const PRESENT_IMAGE_MAX = 4_200_000;
const MAX_FONT_FACES = 48;
const MAX_FONT_SRC = 1_500_000;
/** A preview's size at most, in characters. */
export const THUMB_MAX = 24_000;

/** What a new image background starts with: soft enough to read over, still clearly the picture. */
export const IMAGE_EFFECTS = { blur: 0.35, falloff: 0.65, shade: 0.3, vignette: 0.2 } as const;

// ── Parsing ─────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const unit = (v: unknown): number | undefined => { const n = num(v); return n === null ? undefined : Math.max(0, Math.min(1, n)); };
const rgb = (v: unknown): RGB | undefined =>
  Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v.map(x => Math.max(0, Math.min(1, x))) as RGB : undefined;
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const DATA_FONT = /^data:(font\/(woff2|woff|ttf|otf)|application\/font-woff2?);base64,[A-Za-z0-9+/]+=*$/;
const FAMILY = /^[A-Za-z0-9 ]{1,60}$/;
const CATEGORIES: readonly FontCategory[] = ['sans', 'serif', 'display', 'handwriting', 'mono'];

/** A background from a file; undefined when it isn't one (or names an image that isn't there). */
export function parseBackground(v: unknown, images: ReadonlySet<string>): PresentBackground | undefined {
  if (!isObj(v)) return undefined;
  const kind = v.kind === 'colour' || v.kind === 'fill' || v.kind === 'image' ? v.kind : v.kind === 'none' ? 'none' : null;
  if (!kind) return undefined;
  const out: PresentBackground = { kind };
  const colour = rgb(v.colour);
  if (colour) out.colour = colour;
  const fill = parseFill(v.fill, PLAY_FILL_STOPS_MAX);
  if (fill) out.fill = fill;
  if (idOk(v.image) && images.has(v.image)) out.image = v.image;
  if (v.fit === 'contain' || v.fit === 'cover') out.fit = v.fit;
  if (Array.isArray(v.position) && v.position.length === 2) {
    const x = unit(v.position[0]), y = unit(v.position[1]);
    if (x !== undefined && y !== undefined && (x !== 0.5 || y !== 0.5)) out.position = [x, y];
  }
  for (const k of ['blur', 'falloff', 'shade', 'vignette'] as const) { const n = unit(v[k]); if (n !== undefined) out[k] = n; }
  // A kind with nothing to show isn't a background.
  if ((kind === 'colour' && !out.colour) || (kind === 'fill' && !out.fill) || (kind === 'image' && !out.image)) return undefined;
  return out;
}

export function parseImages(v: unknown): PresentImage[] {
  const out: PresentImage[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(v)) return out;
  for (const x of v.slice(0, 200)) {
    if (!isObj(x) || !idOk(x.id) || seen.has(x.id)) continue;
    const src = typeof x.src === 'string' && x.src.length <= PRESENT_IMAGE_MAX && DATA_IMAGE.test(x.src) ? x.src : undefined;
    const libraryId = typeof x.libraryId === 'string' && x.libraryId && x.libraryId.length <= 80 ? x.libraryId : undefined;
    // A picture, or a library image to find it in.
    if (!src && !libraryId) continue;
    const img: PresentImage = { id: x.id, name: typeof x.name === 'string' ? x.name.slice(0, 200) : 'Image' };
    if (src) img.src = src;
    if (libraryId) img.libraryId = libraryId;
    const w = num(x.width), h = num(x.height);
    if (w && h && w > 0 && h > 0) { img.width = Math.round(w); img.height = Math.round(h); }
    if (typeof x.thumb === 'string' && x.thumb.length <= THUMB_MAX && DATA_IMAGE.test(x.thumb)) img.thumb = x.thumb;
    const avg = rgb(x.avg);
    if (avg) img.avg = avg;
    seen.add(x.id);
    out.push(img);
  }
  return out;
}

function parseRole(v: unknown): FontRole | undefined {
  if (!isObj(v) || typeof v.family !== 'string' || !FAMILY.test(v.family)) return undefined;
  const category = CATEGORIES.includes(v.category as FontCategory) ? v.category as FontCategory : 'sans';
  const w = num(v.weight);
  return { family: v.family, category, weight: w === null ? 400 : Math.max(100, Math.min(1000, Math.round(w / 100) * 100)) };
}

export function parseTypography(v: unknown): PresentTypography | undefined {
  if (!isObj(v)) return undefined;
  const out: PresentTypography = {};
  for (const r of ['heading', 'body', 'code'] as const) { const x = parseRole(v[r]); if (x) out[r] = x; }
  const scale = num(v.scale);
  if (scale !== null && scale !== 1) out.scale = Math.max(SCALE_RANGE[0], Math.min(SCALE_RANGE[1], scale));
  const lh = num(v.lineHeight);
  if (lh !== null) out.lineHeight = Math.max(LINE_HEIGHT_RANGE[0], Math.min(LINE_HEIGHT_RANGE[1], lh));
  const hc = rgb(v.headingColour), bc = rgb(v.bodyColour);
  if (hc) out.headingColour = hc;
  if (bc) out.bodyColour = bc;
  return Object.keys(out).length ? out : undefined;
}

export function parseFontFaces(v: unknown): EmbeddedFontFace[] {
  const out: EmbeddedFontFace[] = [];
  if (!Array.isArray(v)) return out;
  for (const x of v.slice(0, MAX_FONT_FACES)) {
    if (!isObj(x) || typeof x.family !== 'string' || !FAMILY.test(x.family)) continue;
    // No file is fine (it's in the font cache); a file that isn't a font isn't.
    if (x.src !== undefined && (typeof x.src !== 'string' || x.src.length > MAX_FONT_SRC || !DATA_FONT.test(x.src))) continue;
    const weight = typeof x.weight === 'string' && /^\d{3,4}( \d{3,4})?$/.test(x.weight) ? x.weight : '400';
    const face: EmbeddedFontFace = { family: x.family, weight, style: x.style === 'italic' ? 'italic' : 'normal' };
    if (typeof x.src === 'string') face.src = x.src;
    if (typeof x.unicodeRange === 'string' && /^[U+0-9A-Fa-f?, -]{1,2000}$/.test(x.unicodeRange)) face.unicodeRange = x.unicodeRange;
    out.push(face);
  }
  return out;
}

export function parseStyle(v: unknown, images: ReadonlySet<string>): PresentStyle | undefined {
  if (!isObj(v)) return undefined;
  const out: PresentStyle = {};
  const bg = parseBackground(v.background, images);
  if (bg) out.background = bg;
  const t = parseTypography(v.typography);
  if (t) out.typography = t;
  return Object.keys(out).length ? out : undefined;
}

/** Image ids a style and the steps' backgrounds use. */
export function usedImages(style: PresentStyle | undefined, steps: ReadonlyArray<{ background?: PresentBackground }>): Set<string> {
  const out = new Set<string>();
  if (style?.background?.image) out.add(style.background.image);
  for (const s of steps) if (s.background?.image) out.add(s.background.image);
  return out;
}

// ── A step's look ───────────────────────────────────────────────────────────

/** The background a step shows: its own, else the presentation's; null for none. */
export function resolveBackground(style: PresentStyle | undefined, step: { background?: PresentBackground } | undefined): PresentBackground | null {
  const bg = step?.background ?? style?.background;
  return !bg || bg.kind === 'none' ? null : bg;
}

/** Relative luminance (sRGB, 0..1). */
export function luminance(c: readonly number[]): number {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** A fill's average colour: its stops, each weighted by the stretch it paints. */
export function fillAverage(fill: Pick<BackgroundFill, 'stops'>): RGB {
  const s = fitStops(fill.stops, 32);
  if (!s.length) return [0, 0, 0];
  if (s.length === 1) return [...s[0].color];
  const acc: RGB = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const lo = i === 0 ? 0 : (s[i - 1].pos + s[i].pos) / 2, hi = i === s.length - 1 ? 1 : (s[i].pos + s[i + 1].pos) / 2;
    const w = Math.max(0.0001, hi - lo);
    for (let j = 0; j < 3; j++) acc[j] += s[i].color[j] * w;
    total += w;
  }
  return acc.map(x => x / total) as RGB;
}

/** The background's average colour, before effects. Images without a measured colour count as dark (most stills are). */
export function backgroundAverage(bg: PresentBackground, images: ReadonlyMap<string, PresentImage>): RGB {
  if (bg.kind === 'colour') return bg.colour ?? [0, 0, 0];
  if (bg.kind === 'fill') return bg.fill ? fillAverage(bg.fill) : [0, 0, 0];
  if (bg.kind === 'image') return (bg.image && images.get(bg.image)?.avg) || [0.12, 0.12, 0.14];
  return [1, 1, 1];
}

export interface TextColours {
  heading: string; body: string; muted: string; accent: string;
  /** Inline code's backing and rules, over the background. */
  wash: string; rule: string;
  /** A soft halo behind text on pictures; '' on flat backgrounds. */
  shadow: string;
}

export const LIGHT_TEXT: TextColours = { heading: '#f7f7fa', body: '#e3e5ec', muted: '#b3b7c4', accent: '#a9c1ff', wash: 'rgba(255,255,255,0.13)', rule: 'rgba(255,255,255,0.22)', shadow: '' };
export const DARK_TEXT: TextColours = { heading: '#14151b', body: '#2c2f38', muted: '#5b5f6b', accent: '#2553d6', wash: 'rgba(10,12,20,0.07)', rule: 'rgba(10,12,20,0.16)', shadow: '' };
/** What the shade and the vignette mix toward, under light or dark text. */
export const SHADE_DARK: RGB = [0.027, 0.03, 0.043];
export const SHADE_LIGHT: RGB = [0.965, 0.96, 0.945];

/** Below this relative luminance a background counts as dark (where white and black text have equal contrast). */
export const DARK_BELOW = 0.2;

const hex = (c: readonly number[]) => `#${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
const mixRgb = (a: readonly number[], b: readonly number[], t: number): RGB => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t) as RGB;

export interface StepLook {
  /** The background shown (null: none, the page's own). */
  bg: PresentBackground | null;
  /** Light text over it? null when the page's theme decides (no background, no colours set). */
  lightText: boolean | null;
  /** The text colours, null when the page's theme decides. */
  text: TextColours | null;
  /** What the shade and vignette mix toward. */
  tone: RGB;
}

/**
 * A step's look: its background, and the text colours over it. Light text
 * when the background (after its shade) is dark; set colours win, and then
 * the shade goes the way that keeps them readable.
 */
export function stepLook(style: PresentStyle | undefined, images: ReadonlyMap<string, PresentImage>, step: { background?: PresentBackground } | undefined): StepLook {
  const bg = resolveBackground(style, step);
  const t = style?.typography;
  const set = !!(t?.headingColour || t?.bodyColour);
  if (!bg && !set) return { bg: null, lightText: null, text: null, tone: SHADE_DARK };
  let lightText: boolean;
  if (t?.bodyColour || t?.headingColour) lightText = luminance((t.bodyColour ?? t.headingColour)!) > DARK_BELOW;
  else lightText = luminance(backgroundAverage(bg!, images)) < DARK_BELOW;
  const base = lightText ? LIGHT_TEXT : DARK_TEXT;
  const text: TextColours = { ...base };
  if (t?.headingColour) text.heading = hex(t.headingColour);
  if (t?.bodyColour) {
    text.body = hex(t.bodyColour);
    // Captions and numbers: the body colour, a step toward the background.
    text.muted = hex(mixRgb(t.bodyColour, lightText ? SHADE_DARK : SHADE_LIGHT, 0.3));
  }
  if (bg?.kind === 'image') text.shadow = lightText ? '0 1px 2px rgba(0,0,0,0.35), 0 0 18px rgba(0,0,0,0.25)' : '0 0 14px rgba(255,255,255,0.45)';
  return { bg, lightText, text, tone: lightText ? SHADE_DARK : SHADE_LIGHT };
}

/** The CSS custom properties a step's text reads (see presentCss / the export's stylesheet). */
export function textVars(text: TextColours | null): Record<string, string> {
  if (!text) return {};
  return {
    '--pp-heading': text.heading, '--pp-body': text.body, '--pp-muted': text.muted, '--pp-accent': text.accent,
    '--pp-wash': text.wash, '--pp-rule': text.rule, '--pp-shadow': text.shadow || 'none',
  };
}

// ── Typography ──────────────────────────────────────────────────────────────

const FALLBACKS: Record<FontCategory, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  display: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  handwriting: '"Comic Sans MS", "Segoe Print", cursive',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

/** A CSS font-family: the family, then the system fonts of its kind. */
export function fontStack(role: Pick<FontRole, 'family' | 'category'>): string {
  return `"${role.family}", ${FALLBACKS[role.category]}`;
}

/** The typography's CSS custom properties (fonts, size, line height); unset ones fall back in the stylesheet. */
export function typeVars(t: PresentTypography | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!t) return out;
  if (t.heading) { out['--pp-font-heading'] = fontStack(t.heading); out['--pp-hw'] = String(t.heading.weight); }
  if (t.body) out['--pp-font-body'] = fontStack(t.body);
  if (t.code) out['--pp-font-code'] = fontStack(t.code);
  if (t.scale && t.scale !== 1) out['--pp-scale'] = String(Number(t.scale.toFixed(3)));
  if (t.lineHeight) out['--pp-lh'] = String(Number(t.lineHeight.toFixed(3)));
  return out;
}

/** The weights a role needs of its family: a heading its weight; body text regular and bold; code regular. */
export function roleWeights(role: FontRoleName, r: FontRole): number[] {
  return role === 'heading' ? [r.weight] : role === 'body' ? [400, 700] : [400];
}

/** Each family the typography uses, with the weights it needs. */
export function neededFonts(t: PresentTypography | undefined): Map<string, { category: FontCategory; weights: Set<number> }> {
  const out = new Map<string, { category: FontCategory; weights: Set<number> }>();
  for (const name of ['heading', 'body', 'code'] as const) {
    const r = t?.[name];
    if (!r) continue;
    const e = out.get(r.family) ?? { category: r.category, weights: new Set<number>() };
    for (const w of roleWeights(name, r)) e.weights.add(w);
    out.set(r.family, e);
  }
  return out;
}

/** Does a face (weight '400' or '300 800') cover a weight? */
export function faceCovers(face: Pick<EmbeddedFontFace, 'weight'>, w: number): boolean {
  const [a, b] = face.weight.split(' ').map(Number);
  return b === undefined ? a === w : w >= a && w <= b;
}

/** The @font-face rules for faces with files (data or object URLs), each once. */
export function fontFaceCss(faces: readonly EmbeddedFontFace[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of faces) {
    if (!f.src) continue;
    const key = `${f.family}|${f.weight}|${f.style}|${f.unicodeRange ?? ''}|${f.src.length}|${f.src.slice(-40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fmt = /^blob:/.test(f.src) ? 'woff2' : /^data:font\/woff2|font-woff2/.test(f.src) ? 'woff2' : /^data:font\/woff|font-woff/.test(f.src) ? 'woff' : /^data:font\/otf/.test(f.src) ? 'opentype' : 'truetype';
    out.push(`@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${f.src}) format("${fmt}")${f.unicodeRange ? `;unicode-range:${f.unicodeRange}` : ''}}`);
  }
  return out.join('\n');
}

// ── Size ────────────────────────────────────────────────────────────────────

/** What the embedded images and fonts weigh (characters of their data URLs, which is what files and pages carry; previews included). */
export function styleBytes(p: { images?: readonly PresentImage[]; fonts?: readonly EmbeddedFontFace[] }): { images: number; fonts: number; total: number } {
  const images = (p.images ?? []).reduce((n, i) => n + (i.src?.length ?? 0) + (i.thumb?.length ?? 0), 0);
  const fonts = (p.fonts ?? []).reduce((n, f) => n + (f.src?.length ?? 0), 0);
  return { images, fonts, total: images + fonts };
}

/** 1.2 MB, 340 KB. */
export function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
