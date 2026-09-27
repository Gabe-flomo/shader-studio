/**
 * googleFonts.ts — fonts for presentations, from Google Fonts.
 *
 * GOOGLE_FONTS is a curated list (families that read well on screen, by
 * kind, with the weights each has). Choosing one fetches its stylesheet from
 * Google's CSS API once, keeps the Latin subsets' faces, downloads those font
 * files and embeds them as data URLs (fetchFontFaces), so the presentation,
 * its .present.json file and its exported page work offline and never ask
 * Google again. A variable font's weights share one file: they're merged into
 * one face with a weight range, so each file is carried once.
 *
 * previewCssUrl() is a tiny stylesheet with just the letters of the list's
 * names, for showing each family in itself in the picker.
 */
import type { EmbeddedFontFace, FontCategory } from '../types/presentationStyle';
import { klParseFontUrl } from '../play/kit/fonts.js';

export interface GoogleFont { family: string; category: FontCategory; weights: number[] }

const range = (a: number, b: number) => Array.from({ length: (b - a) / 100 + 1 }, (_, i) => a + i * 100);
const f = (family: string, category: FontCategory, weights: number[]): GoogleFont => ({ family, category, weights });

export const GOOGLE_FONTS: readonly GoogleFont[] = [
  // Sans
  f('Inter', 'sans', range(100, 900)),
  f('Source Sans 3', 'sans', range(200, 900)),
  f('IBM Plex Sans', 'sans', range(100, 700)),
  f('DM Sans', 'sans', range(100, 900)),
  f('Work Sans', 'sans', range(100, 900)),
  f('Manrope', 'sans', range(200, 800)),
  f('Plus Jakarta Sans', 'sans', range(200, 800)),
  f('Space Grotesk', 'sans', range(300, 700)),
  f('Instrument Sans', 'sans', range(400, 700)),
  f('Figtree', 'sans', range(300, 900)),
  f('Outfit', 'sans', range(100, 900)),
  f('Public Sans', 'sans', range(100, 900)),
  f('Atkinson Hyperlegible', 'sans', [400, 700]),
  f('Lexend', 'sans', range(100, 900)),
  f('Roboto', 'sans', range(100, 900)),
  f('Open Sans', 'sans', range(300, 800)),
  f('Lato', 'sans', [100, 300, 400, 700, 900]),
  f('Montserrat', 'sans', range(100, 900)),
  f('Poppins', 'sans', range(100, 900)),
  f('Nunito', 'sans', range(200, 900)),
  f('Rubik', 'sans', range(300, 900)),
  f('Karla', 'sans', range(200, 800)),
  f('Fira Sans', 'sans', range(100, 900)),
  f('Noto Sans', 'sans', range(100, 900)),
  f('Archivo', 'sans', range(100, 900)),
  f('Mulish', 'sans', range(200, 900)),
  f('Sora', 'sans', range(100, 800)),
  // Serif
  f('Fraunces', 'serif', range(100, 900)),
  f('Newsreader', 'serif', range(200, 800)),
  f('Source Serif 4', 'serif', range(200, 900)),
  f('Literata', 'serif', range(200, 900)),
  f('Lora', 'serif', range(400, 700)),
  f('Merriweather', 'serif', range(300, 900)),
  f('Playfair Display', 'serif', range(400, 900)),
  f('EB Garamond', 'serif', range(400, 800)),
  f('Cormorant Garamond', 'serif', range(300, 700)),
  f('Crimson Pro', 'serif', range(200, 900)),
  f('Libre Baskerville', 'serif', [400, 700]),
  f('Spectral', 'serif', range(200, 800)),
  f('IBM Plex Serif', 'serif', range(100, 700)),
  f('Noto Serif', 'serif', range(100, 900)),
  f('Bitter', 'serif', range(100, 900)),
  f('Roboto Slab', 'serif', range(100, 900)),
  f('DM Serif Display', 'serif', [400]),
  f('Instrument Serif', 'serif', [400]),
  f('Young Serif', 'serif', [400]),
  // Display
  f('Bricolage Grotesque', 'display', range(200, 800)),
  f('Syne', 'display', range(400, 800)),
  f('Unbounded', 'display', range(200, 900)),
  f('Big Shoulders Display', 'display', range(100, 900)),
  f('Oswald', 'display', range(200, 700)),
  f('Bebas Neue', 'display', [400]),
  f('Anton', 'display', [400]),
  f('Archivo Black', 'display', [400]),
  f('Abril Fatface', 'display', [400]),
  // Handwriting
  f('Caveat', 'handwriting', range(400, 700)),
  f('Kalam', 'handwriting', [300, 400, 700]),
  f('Patrick Hand', 'handwriting', [400]),
  f('Architects Daughter', 'handwriting', [400]),
  // Mono
  f('JetBrains Mono', 'mono', range(100, 800)),
  f('Fira Code', 'mono', range(300, 700)),
  f('IBM Plex Mono', 'mono', range(100, 700)),
  f('Source Code Pro', 'mono', range(200, 900)),
  f('Roboto Mono', 'mono', range(100, 700)),
  f('Space Mono', 'mono', [400, 700]),
  f('DM Mono', 'mono', [300, 400, 500]),
  f('Inconsolata', 'mono', range(200, 900)),
  f('Red Hat Mono', 'mono', range(300, 700)),
  f('Martian Mono', 'mono', range(100, 800)),
];

export const FONT_CATEGORIES: ReadonlyArray<{ id: FontCategory; label: string }> = [
  { id: 'sans', label: 'Sans' }, { id: 'serif', label: 'Serif' }, { id: 'display', label: 'Display' },
  { id: 'handwriting', label: 'Handwriting' }, { id: 'mono', label: 'Mono' },
];

export function findFont(family: string): GoogleFont | undefined {
  return GOOGLE_FONTS.find(x => x.family === family);
}

/** The family's weight nearest to `w`. */
export function nearestWeight(font: Pick<GoogleFont, 'weights'>, w: number): number {
  return font.weights.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), font.weights[0] ?? 400);
}

/** A pasted Google Fonts source, read: the family, its kind, and the weights the link names (none: ask for what's needed). */
export interface FontLink { family: string; category: FontCategory; weights: number[] }

/** Presentation fonts are Google families with plain names (types/presentationStyle.ts). */
const PLAIN_FAMILY = /^[A-Za-z0-9 ]{1,60}$/;

/** A family's kind from its name, for one outside the list: the fallback fonts behind it. */
export function guessCategory(family: string): FontCategory {
  if (/\b(mono|code)\b/i.test(family)) return 'mono';
  if (/\bserif\b/i.test(family) && !/\bsans\b/i.test(family)) return 'serif';
  if (/\b(display|poster)\b/i.test(family)) return 'display';
  if (/\b(hand|script)\b/i.test(family)) return 'handwriting';
  return 'sans';
}

/** The weights a css2 link's family asks for: `:wght@400;700`, `:wght@300..700`, `:ital,wght@0,400;1,700`. */
export function linkWeights(css: string): number[] {
  const m = /[?&]family=[^&:]+:([^&]+)/.exec(css.replace(/%3A/gi, ':').replace(/%40/gi, '@').replace(/%3B/gi, ';').replace(/%2C/gi, ','));
  if (!m) return [];
  const [axes, values] = m[1].split('@');
  if (!values) return [];
  const names = axes.split(',');
  const wi = names.indexOf('wght');
  if (wi < 0) return [];
  const out = new Set<number>();
  for (const tuple of values.split(';')) {
    const w = tuple.split(',')[wi];
    if (!w) continue;
    const range = /^(\d{3})\.\.(\d{3,4})$/.exec(w);
    if (range) {
      const lo = Number(range[1]), hi = Math.min(1000, Number(range[2]));
      for (let x = Math.ceil(lo / 100) * 100; x <= hi; x += 100) out.add(x);
    } else if (/^\d{3}$/.test(w)) out.add(Number(w));
  }
  return [...out].filter(x => x >= 100 && x <= 900).sort((a, b) => a - b);
}

/**
 * A pasted Google Fonts link or family name, for a presentation font: a
 * fonts.google.com/specimen/… page, a fonts.googleapis.com/css2?family=… link
 * (or the <link> tag holding it), or a plain name. Font file URLs aren't
 * Google families, and names with other characters aren't kept, so both are
 * null (as is anything else). Reads links the Text layer's way (klParseFontUrl).
 */
export function parseFontLink(input: string): FontLink | null {
  const r = klParseFontUrl(input);
  if (!r || r.file || !r.css) return null;
  let family = r.family.trim().replace(/\s+/g, ' ');
  // Google's names are capitalised ("bebas neue" is Bebas Neue).
  if (family === family.toLowerCase()) family = family.replace(/\b[a-z]/g, c => c.toUpperCase());
  if (!PLAIN_FAMILY.test(family)) return null;
  // A family in the list keeps its proper name, kind and weights.
  const known = GOOGLE_FONTS.find(f => f.family.toLowerCase() === family.toLowerCase());
  const asked = linkWeights(r.css);
  if (known) return { family: known.family, category: known.category, weights: asked.length ? asked.filter(w => known.weights.includes(w)) : [] };
  return { family, category: guessCategory(family), weights: asked };
}

const API = 'https://fonts.googleapis.com/css2';
const familyParam = (family: string) => family.trim().replace(/ /g, '+');

/** The CSS API's URL for a family at some weights (sorted, deduplicated; a one-weight family asks for no axis). */
export function fontsCssUrl(family: string, weights: readonly number[]): string {
  const ws = [...new Set(weights)].sort((a, b) => a - b);
  const axis = ws.length === 1 && ws[0] === 400 ? '' : `:wght@${ws.join(';')}`;
  return `${API}?family=${familyParam(family)}${axis}&display=swap`;
}

/** A stylesheet with only the letters `text` needs, for every family in the list: the picker's previews. */
export function previewCssUrl(fonts: readonly GoogleFont[], text: string): string {
  const letters = [...new Set(text)].join('');
  return `${API}?${fonts.map(x => `family=${familyParam(x.family)}`).join('&')}&text=${encodeURIComponent(letters)}&display=swap`;
}

/** Subsets kept: Latin and Latin Extended (English and the European languages). A sheet without subset comments keeps everything. */
const KEEP = new Set(['latin', 'latin-ext']);

export interface CssFace { family: string; weight: string; style: 'normal' | 'italic'; unicodeRange?: string; url: string; subset?: string }

/** The @font-face rules of a Google Fonts stylesheet (the kept subsets). */
export function parseGoogleCss(css: string): CssFace[] {
  const out: CssFace[] = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const subset = m[1];
    if (subset && !KEEP.has(subset)) continue;
    const body = m[2];
    const prop = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);?`).exec(body)?.[1].trim();
    const family = prop('font-family')?.replace(/^['"]|['"]$/g, '');
    const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(body)?.[1];
    if (!family || !url || !/^https:\/\//.test(url)) continue;
    const weight = (prop('font-weight') ?? '400').replace(/\s+/g, ' ');
    const face: CssFace = { family, weight, style: prop('font-style') === 'italic' ? 'italic' : 'normal', url };
    const ur = prop('unicode-range');
    if (ur) face.unicodeRange = ur;
    if (subset) face.subset = subset;
    out.push(face);
  }
  return out;
}

/** Faces sharing a file (a variable font's weights) become one face with the weight range. */
export function mergeFaces(faces: readonly CssFace[]): CssFace[] {
  const by = new Map<string, CssFace & { lo: number; hi: number }>();
  for (const x of faces) {
    const key = `${x.family}|${x.style}|${x.url}|${x.unicodeRange ?? ''}`;
    const [a, b = a] = x.weight.split(' ').map(Number);
    const e = by.get(key);
    if (e) { e.lo = Math.min(e.lo, a); e.hi = Math.max(e.hi, b); } else by.set(key, { ...x, lo: a, hi: b });
  }
  return [...by.values()].map(({ lo, hi, ...x }) => ({ ...x, weight: lo === hi ? String(lo) : `${lo} ${hi}` }));
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const mimeOf = (url: string, type: string | null): string => {
  if (type && /^font\/(woff2|woff|ttf|otf)$/.test(type)) return type;
  const ext = /\.(woff2|woff|ttf|otf)(?:$|\?)/.exec(url)?.[1] ?? 'woff2';
  return `font/${ext}`;
};

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'arrayBuffer' | 'headers'>>;

/**
 * Download a family at some weights and embed it: the stylesheet (asking for
 * the weights it has; if Google refuses, the family's regular face), the Latin
 * subsets' font files, each once. Throws when nothing could be fetched.
 */
export async function fetchFontFaces(family: string, weights: readonly number[], fetchImpl: Fetch = (u: string) => fetch(u)): Promise<EmbeddedFontFace[]> {
  const known = findFont(family);
  const ws = known ? [...new Set(weights.map(w => nearestWeight(known, w)))] : [...new Set(weights)];
  let res = await fetchImpl(fontsCssUrl(family, ws));
  if (!res.ok && ws.some(w => w !== 400)) res = await fetchImpl(fontsCssUrl(family, [400]));
  if (!res.ok) throw new Error(`Google Fonts answered ${res.status} for “${family}”.`);
  const faces = mergeFaces(parseGoogleCss(await res.text()).filter(x => x.family === family));
  if (!faces.length) throw new Error(`Google Fonts sent no faces for “${family}”.`);
  const files = new Map<string, Promise<string>>();
  const load = (url: string) => {
    let p = files.get(url);
    if (!p) {
      p = fetchImpl(url).then(async r => {
        if (!r.ok) throw new Error(`Couldn’t download ${family} (${r.status}).`);
        return `data:${mimeOf(url, r.headers.get('content-type'))};base64,${base64(await r.arrayBuffer())}`;
      });
      files.set(url, p);
    }
    return p;
  };
  return Promise.all(faces.map(async x => {
    const face: EmbeddedFontFace = { family: x.family, weight: x.weight, style: x.style, src: await load(x.url) };
    if (x.unicodeRange) face.unicodeRange = x.unicodeRange;
    return face;
  }));
}
