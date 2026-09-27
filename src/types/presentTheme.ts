/**
 * presentTheme.ts — a presentation's theme: the look of the whole page, as
 * the websites in Play's "Put it on a website" preview have one (mockSites.ts).
 *
 *   Presentation.style.theme   { id, mode?, colours?, radius?, column?, spacing?, saved? }
 *
 * A theme is a built-in (THEMES) plus the settings changed on top of it. The
 * built-ins:
 *
 *   classic     the Present page as it always was: the app's colours, paper
 *               grain, system fonts. Every presentation without a theme is this
 *   landing     the Landing page: warm off-white, ink headings set big and
 *               tight, pill buttons, an eyebrow pill for the step number,
 *               generous spacing
 *   article     the Blog post: Georgia headings and body, a narrow reading
 *               column, a relaxed line height, the step number as a byline
 *   portfolio   the Portfolio: near-black, clean sans set tight, pictures on
 *               rounded tiles, white buttons
 *
 * Each has a light and a dark palette; `mode` picks one ('auto' follows the
 * app, and in an exported page the reader's system). Fonts, text size and line
 * height changed by hand live in the typography (presentationStyle.ts) and
 * win over the theme's; colours, corners, column width and spacing changed by
 * hand live here. Resetting one drops it, and the theme's shows again.
 *
 * themeLook() resolves a theme to its palette and the CSS custom properties
 * the page's stylesheets read (presentCss.ts in the app, the export's
 * PAGE_CSS). Classic without changes sets none, so the page is exactly as
 * before. Pure.
 */
import type { RGB } from './presentationStyle';

export type ThemeId = 'classic' | 'landing' | 'article' | 'portfolio';
export type ThemeMode = 'light' | 'dark' | 'auto';
/** The colours a theme's settings can change. */
export type ThemeColourKey = 'background' | 'surface' | 'text' | 'accent' | 'link';
/** How the step number is shown: plain ("02 / 07"), as an eyebrow pill (above the title), or as a byline. */
export type NumberStyle = 'plain' | 'pill' | 'meta';

export interface PresentTheme {
  id: ThemeId;
  mode?: ThemeMode;
  colours?: Partial<Record<ThemeColourKey, RGB>>;
  /** Corner radius of pictures, cards and code, px. */
  radius?: number;
  /** Width of the reading column, px. */
  column?: number;
  /** Space between blocks and around steps, × the theme's. */
  spacing?: number;
  /** Applied from one of your saved themes: which (for the panel only). */
  saved?: { id: string; name: string };
}

export interface ThemePalette {
  background: string; surface: string; heading: string; text: string; muted: string;
  accent: string; link: string; rule: string; wash: string;
  /** Buttons: their colour and the text on them. */
  button: string; onButton: string;
  codeBg: string;
}

export interface ThemeSpec {
  id: ThemeId;
  label: string;
  hint: string;
  /** Font stacks (system fonts: nothing to download). */
  headingFont: string; bodyFont: string; codeFont: string;
  /** Names for the panel. */
  headingName: string; bodyName: string;
  headingWeight: number;
  /** Heading letter spacing, em. */
  tracking: number;
  scale: number;
  lineHeight: number;
  /** Step titles, × the usual size. */
  titleScale: number;
  radius: number;
  button: 'pill' | 'square';
  column: number;
  spacing: number;
  number: NumberStyle;
  /** Pictures sit on tiles of the surface colour. */
  tiles: boolean;
  /** The paper grain behind the page (Classic). */
  grain: boolean;
  mode: ThemeMode;
  light: ThemePalette;
  dark: ThemePalette;
}

export const RADIUS_RANGE = [0, 28] as const;
export const COLUMN_RANGE = [560, 1200] as const;
export const SPACING_RANGE = [0.6, 1.8] as const;

const SYS_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const THEMES: Readonly<Record<ThemeId, ThemeSpec>> = {
  classic: {
    id: 'classic', label: 'Classic', hint: 'The Present page’s own look: the app’s colours on paper',
    headingFont: 'system-ui, -apple-system, sans-serif', bodyFont: 'system-ui, -apple-system, sans-serif', codeFont: MONO, headingName: 'System', bodyName: 'System',
    headingWeight: 700, tracking: -0.015, scale: 1, lineHeight: 1.62, titleScale: 1, radius: 12, button: 'square', column: 944, spacing: 1,
    number: 'plain', tiles: false, grain: true, mode: 'auto',
    light: { background: '#eef0f4', surface: '#ffffff', heading: '#1a1b23', text: '#3a3d47', muted: '#6b6f7a', accent: '#2f5fe0', link: '#2f5fe0', rule: '#e7e8ee', wash: '#f4f5f8', button: '#1a1b23', onButton: '#ffffff', codeBg: '#fbfbfc' },
    dark: { background: '#15161b', surface: '#1e2027', heading: '#f1f2f6', text: '#c9ccd6', muted: '#8d91a0', accent: '#8aa8ff', link: '#8aa8ff', rule: '#2c2f3a', wash: '#262833', button: '#f1f2f6', onButton: '#15161b', codeBg: '#191b21' },
  },
  landing: {
    id: 'landing', label: 'Landing', hint: 'Like the landing page: big tight headlines, pill buttons, room to breathe',
    headingFont: SYS_SANS, bodyFont: SYS_SANS, codeFont: MONO, headingName: 'System sans', bodyName: 'System sans',
    headingWeight: 750, tracking: -0.035, scale: 1.04, lineHeight: 1.6, titleScale: 1.5, radius: 18, button: 'pill', column: 980, spacing: 1.3,
    number: 'pill', tiles: false, grain: false, mode: 'light',
    light: { background: '#f6f5f2', surface: '#ffffff', heading: '#1b1c22', text: '#2b2c33', muted: '#6b6d78', accent: '#1b1c22', link: '#1b1c22', rule: '#e4e2dc', wash: '#ecebe6', button: '#1b1c22', onButton: '#ffffff', codeBg: '#fbfaf8' },
    dark: { background: '#111114', surface: '#1b1c22', heading: '#f7f7f9', text: '#e2e3e9', muted: '#a3a5b1', accent: '#ffffff', link: '#ffffff', rule: '#2a2b33', wash: '#26272e', button: '#ffffff', onButton: '#111114', codeBg: '#17181d' },
  },
  article: {
    id: 'article', label: 'Article', hint: 'Like the blog post: serif type, a narrow reading column, a byline',
    headingFont: SERIF, bodyFont: SERIF, codeFont: MONO, headingName: 'Georgia', bodyName: 'Georgia',
    headingWeight: 700, tracking: -0.02, scale: 1.12, lineHeight: 1.7, titleScale: 1.3, radius: 16, button: 'pill', column: 680, spacing: 1.1,
    number: 'meta', tiles: false, grain: false, mode: 'light',
    light: { background: '#fbfaf7', surface: '#ffffff', heading: '#1b1c22', text: '#2d2b28', muted: '#6b6d78', accent: '#8a5a3c', link: '#3f6f7f', rule: '#e8e4dc', wash: '#f1eee7', button: '#1b1c22', onButton: '#ffffff', codeBg: '#f7f5f0' },
    dark: { background: '#16140f', surface: '#201d17', heading: '#f3efe7', text: '#e0dbd1', muted: '#a8a296', accent: '#d9a47f', link: '#8fc1cf', rule: '#322e26', wash: '#2a261f', button: '#f3efe7', onButton: '#16140f', codeBg: '#1c1a15' },
  },
  portfolio: {
    id: 'portfolio', label: 'Portfolio', hint: 'Like the portfolio: dark, clean sans, pictures on rounded tiles',
    headingFont: SYS_SANS, bodyFont: SYS_SANS, codeFont: MONO, headingName: 'System sans', bodyName: 'System sans',
    headingWeight: 700, tracking: -0.035, scale: 1, lineHeight: 1.6, titleScale: 1.4, radius: 20, button: 'pill', column: 1040, spacing: 1.1,
    number: 'plain', tiles: true, grain: false, mode: 'dark',
    light: { background: '#f3f3f5', surface: '#ffffff', heading: '#111116', text: '#2a2a31', muted: '#6e6f7a', accent: '#5b45d6', link: '#5b45d6', rule: '#e2e2e7', wash: '#e9e9ee', button: '#111116', onButton: '#ffffff', codeBg: '#fafafb' },
    dark: { background: '#0f0f12', surface: '#1d1d24', heading: '#ffffff', text: '#ececf1', muted: '#9a9ba6', accent: '#b8a9ff', link: '#b8a9ff', rule: '#26262e', wash: '#26262f', button: '#ffffff', onButton: '#111111', codeBg: '#16161b' },
  },
};

export const THEME_IDS: readonly ThemeId[] = ['classic', 'landing', 'article', 'portfolio'];

export const THEME_COLOUR_LABELS: Record<ThemeColourKey, string> = { background: 'Background', surface: 'Cards', text: 'Text', accent: 'Accent', link: 'Links' };

// ── Colour helpers ──────────────────────────────────────────────────────────

export const toHex = (c: readonly number[]): string => `#${c.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
export const fromHex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const s = m ? m[1] : '000000';
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255) as RGB;
};
const mix = (a: string, b: string, t: number) => { const x = fromHex(a), y = fromHex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
function lum(h: string): number {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = fromHex(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** Is a colour dark (light text reads better on it)? */
export const isDarkColour = (h: string): boolean => lum(h) < 0.2;

// ── Parsing ─────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));
const rgb = (v: unknown): RGB | undefined =>
  Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v.map(x => Math.max(0, Math.min(1, x))) as RGB : undefined;
const COLOUR_KEYS: readonly ThemeColourKey[] = ['background', 'surface', 'text', 'accent', 'link'];

export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);

/** A theme from a file; undefined when it's Classic with nothing changed (or not a theme): the page as it always was. */
export function parseTheme(v: unknown): PresentTheme | undefined {
  if (!isObj(v) || !isThemeId(v.id)) return undefined;
  const out: PresentTheme = { id: v.id };
  if (v.mode === 'light' || v.mode === 'dark' || v.mode === 'auto') out.mode = v.mode;
  if (isObj(v.colours)) {
    const c: Partial<Record<ThemeColourKey, RGB>> = {};
    for (const k of COLOUR_KEYS) { const x = rgb((v.colours as Record<string, unknown>)[k]); if (x) c[k] = x; }
    if (Object.keys(c).length) out.colours = c;
  }
  const r = num(v.radius), col = num(v.column), sp = num(v.spacing);
  if (r !== null) out.radius = Math.round(clamp(r, RADIUS_RANGE));
  if (col !== null) out.column = Math.round(clamp(col, COLUMN_RANGE));
  if (sp !== null) out.spacing = Number(clamp(sp, SPACING_RANGE).toFixed(2));
  if (isObj(v.saved) && typeof v.saved.id === 'string' && typeof v.saved.name === 'string' && v.saved.id.length <= 80) out.saved = { id: v.saved.id, name: v.saved.name.slice(0, 80) };
  return isPlainClassic(out) ? undefined : out;
}

/** Classic with nothing changed: the same as no theme. */
export function isPlainClassic(t: PresentTheme | undefined): boolean {
  if (!t) return true;
  return t.id === 'classic' && !t.mode && !t.colours && t.radius === undefined && t.column === undefined && t.spacing === undefined;
}

/** The theme with its hand-changed settings dropped (all of them, or some). */
export function resetTheme(t: PresentTheme, keys?: ReadonlyArray<ThemeColourKey | 'radius' | 'column' | 'spacing' | 'mode'>): PresentTheme {
  if (!keys) return { id: t.id };
  const out: PresentTheme = { ...t };
  for (const k of keys) {
    if (k === 'radius' || k === 'column' || k === 'spacing' || k === 'mode') delete out[k];
    else if (out.colours) {
      const c = { ...out.colours };
      delete c[k];
      if (Object.keys(c).length) out.colours = c; else delete out.colours;
    }
  }
  return out;
}

/** Has the theme any hand-changed settings? */
export const themeChanged = (t: PresentTheme | undefined): boolean => !!t && (!!t.mode || !!t.colours || t.radius !== undefined || t.column !== undefined || t.spacing !== undefined);

// ── The look ────────────────────────────────────────────────────────────────

export interface ThemeLook {
  spec: ThemeSpec;
  id: ThemeId;
  dark: boolean;
  palette: ThemePalette;
  radius: number;
  column: number;
  spacing: number;
  /** The paper grain behind the page. */
  grain: boolean;
  /**
   * Does the theme decide the page's colours? False only for Classic without
   * colour changes, where the app's own colours stay (light or dark with the app).
   */
  ownColours: boolean;
  /** The CSS custom properties (see presentCss.ts and the export's PAGE_CSS). */
  vars: Record<string, string>;
}

/** The palette with the hand-set colours: text also sets the headings and the muted text; accent the buttons. */
function paletteWith(base: ThemePalette, c: PresentTheme['colours']): ThemePalette {
  if (!c) return base;
  const p = { ...base };
  if (c.background) {
    p.background = toHex(c.background);
    // What sits on the page follows it: the rules and code's backing a step off it.
    const d = isDarkColour(p.background);
    p.rule = mix(p.background, d ? '#ffffff' : '#000000', 0.1);
    p.wash = mix(p.background, d ? '#ffffff' : '#000000', 0.06);
  }
  if (c.surface) p.surface = toHex(c.surface);
  if (c.text) {
    p.text = toHex(c.text);
    p.heading = p.text;
    p.muted = mix(p.text, p.background, 0.4);
  }
  if (c.accent) {
    p.accent = toHex(c.accent);
    p.button = p.accent;
    p.onButton = isDarkColour(p.accent) ? '#ffffff' : '#111114';
  }
  if (c.link) p.link = toHex(c.link);
  return p;
}

/** Is the page dark under this theme? `appDark`: the app's own mode (what 'auto' follows). */
export function themeIsDark(t: PresentTheme | undefined, appDark: boolean): boolean {
  const spec = THEMES[t?.id ?? 'classic'] ?? THEMES.classic;
  const mode = t?.mode ?? spec.mode;
  return mode === 'dark' || (mode === 'auto' && appDark);
}

const px = (n: number) => `${n}px`;

/** The page's colour variables from a palette. */
export function paletteVars(p: ThemePalette): Record<string, string> {
  return {
    '--pp-page': p.background, '--pp-surface': p.surface, '--pp-heading': p.heading, '--pp-body': p.text, '--pp-muted': p.muted,
    '--pp-accent': p.accent, '--pp-link': p.link, '--pp-rule': p.rule, '--pp-wash': p.wash,
    '--pp-btn': p.button, '--pp-on-btn': p.onButton, '--pp-code-bg': p.codeBg,
  };
}

/**
 * A theme's look. Classic sets only what was changed by hand (so an untouched
 * presentation is exactly as before); the others set every variable.
 */
export function themeLook(t: PresentTheme | undefined, appDark: boolean): ThemeLook {
  const id: ThemeId = t && isThemeId(t.id) ? t.id : 'classic';
  const spec = THEMES[id];
  const dark = themeIsDark(t, appDark);
  const palette = paletteWith(dark ? spec.dark : spec.light, t?.colours);
  const radius = t?.radius ?? spec.radius, column = t?.column ?? spec.column, spacing = t?.spacing ?? spec.spacing;
  const classic = id === 'classic';
  // Classic follows the app's colours until one is set, or the mode is pinned.
  const ownColours = !classic || !!t?.colours || (!!t?.mode && t.mode !== 'auto');
  const vars: Record<string, string> = {};
  if (ownColours) {
    const all = paletteVars(palette);
    if (classic && !(t?.mode && t.mode !== 'auto')) {
      // Only what was changed, and what follows from it.
      const c = t?.colours ?? {};
      const keep = new Set<string>();
      if (c.background) ['--pp-page', '--pp-rule', '--pp-wash'].forEach(k => keep.add(k));
      if (c.surface) keep.add('--pp-surface');
      if (c.text) ['--pp-heading', '--pp-body', '--pp-muted'].forEach(k => keep.add(k));
      if (c.accent) ['--pp-accent', '--pp-btn', '--pp-on-btn', '--pp-link'].forEach(k => keep.add(k));
      if (c.link) keep.add('--pp-link');
      for (const k of keep) vars[k] = all[k];
    } else Object.assign(vars, all);
  }
  if (!classic) {
    Object.assign(vars, {
      '--pp-font-heading': spec.headingFont, '--pp-font-body': spec.bodyFont, '--pp-font-code': spec.codeFont,
      '--pp-hw': String(spec.headingWeight), '--pp-track': `${spec.tracking}em`, '--pp-scale': String(spec.scale), '--pp-lh': String(spec.lineHeight),
      '--pp-title': String(spec.titleScale), '--pp-btn-radius': spec.button === 'pill' ? '999px' : '8px',
    });
  }
  if (!classic || t?.radius !== undefined) vars['--pp-radius'] = px(radius);
  if (!classic || t?.column !== undefined) vars['--pp-col'] = px(column);
  if (!classic || t?.spacing !== undefined) vars['--pp-space'] = String(spacing);
  return { spec, id, dark, palette, radius, column, spacing, grain: spec.grain && !t?.colours?.background, ownColours, vars };
}

/** The attributes the stylesheets key a theme's layout on (the step number's style, tiles). */
export function themeAttrs(look: Pick<ThemeLook, 'spec'>): Record<string, string> {
  const out: Record<string, string> = {};
  if (look.spec.number !== 'plain') out['data-pp-num'] = look.spec.number;
  if (look.spec.tiles) out['data-pp-tiles'] = '';
  return out;
}

/**
 * The export's theme rules: the variables on body (with a dark set for the
 * reader's system when the mode is 'auto'), before the typography's own.
 * Classic without changes: '' (the page as before). `typeVars` wins over the
 * theme's fonts and sizes.
 */
export function themeExportCss(t: PresentTheme | undefined, typeVars: Record<string, string>): { css: string; dark: boolean } {
  const light = themeLook(t, false);
  const decl = (v: Record<string, string>) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';');
  if (!Object.keys(light.vars).length) return { css: '', dark: false };
  const rules = [`body{${decl({ ...light.vars, ...typeVars })}}`];
  const mode = t?.mode ?? light.spec.mode;
  // Classic's 'auto' stays light in an export, as it always has.
  if (mode === 'auto' && light.id !== 'classic') {
    const dark = themeLook(t, true);
    // Code keeps its light colours (its highlighting is baked in for a light backing).
    const { '--pp-code-bg': _c, ...dv } = paletteVars(dark.palette);
    void _c;
    rules.push(`@media (prefers-color-scheme:dark){body{${decl(dv)}}}`);
  }
  return { css: rules.join('\n'), dark: light.dark };
}
