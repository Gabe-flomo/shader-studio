/**
 * presentLook — the hooks the Present page's views use to dress a step:
 *
 *   useStepLook(step)   the background it shows and the text colours over it
 *   lookVars(look)      those colours as the CSS variables presentCss reads
 *   useTypeVars()       the typography's variables (fonts, size, line height)
 *   usePresentTheme()   the theme's look (presentTheme.ts): palette, sizes,
 *                       its variables, light or dark
 *   usePageVars()       the page's variables and attributes: the theme's, then
 *                       the typography's (which win)
 *   usePageBackground() the reading area's background: the paper grain
 *                       (Classic), or the theme's colour
 *   useColumn(view)     the reading column's width in a view
 *   ThemeScope          pins the app's colours inside a reading area to the
 *                       theme's light or dark, so cards and code match the page
 *   usePresentFonts()   the presentation's @font-face rules (files from the font
 *                       cache; a family missing from it is fetched again)
 *   useLibraryImage(i)  an image background's picture from the library, or
 *                       that it's missing
 *
 * <Backdrop> (Backdrop.tsx) draws the background itself.
 */
import { createElement, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ThemeOverrideContext, useThemeStore, useTokens } from '../../theme/themeStore';
import { themeAttrs, themeLook, type ThemeLook } from '../../types/presentTheme';
import { paperStyle } from './paper';
import { fontFaceCss, stepLook, textVars, typeVars, type EmbeddedFontFace, type PresentImage, type StepLook } from '../../types/presentationStyle';
import { BACKGROUNDS_CHANGED, imageUrl } from '../../lib/backgroundLibrary';
import { faceUrl, fontKey, putFace } from '../../lib/fontCache';
import { fetchFontFaces } from '../../present/googleFonts';
import type { Step } from '../../types/presentation';
import { usePresentation } from './presentationStore';

/** Content column widths (CSS px) the blur's falloff is shaped around: the reading width in each view. */
export const COLUMN = { edit: 944, slides: 1068, scroll: 824 } as const;

const EMPTY_IMAGES: ReadonlyMap<string, PresentImage> = new Map();

/** The presentation's images by id. */
export function useImageMap(): ReadonlyMap<string, PresentImage> {
  const images = usePresentation(s => s.doc?.images);
  return useMemo(() => (images?.length ? new Map(images.map(i => [i.id, i])) : EMPTY_IMAGES), [images]);
}

export function useStepLook(step: Step | undefined): StepLook {
  const style = usePresentation(s => s.doc?.style);
  const images = useImageMap();
  return useMemo(() => stepLook(style, images, step), [style, images, step]);
}

/** The step's text colours as CSS variables (none when the page's theme decides). */
export function lookVars(look: StepLook): CSSProperties {
  return textVars(look.text) as CSSProperties;
}

/** The typography's variables (fonts, size, line height) for the page. */
export function useTypeVars(): CSSProperties {
  const t = usePresentation(s => s.doc?.style?.typography);
  return useMemo(() => typeVars(t) as CSSProperties, [t]);
}

/** The presentation's theme, resolved against the app's light or dark. */
export function usePresentTheme(): ThemeLook {
  const theme = usePresentation(s => s.doc?.style?.theme);
  const appDark = useThemeStore(s => s.mode) === 'dark';
  return useMemo(() => themeLook(theme, appDark), [theme, appDark]);
}

/** The page's CSS variables (the theme's, then the typography's) and the attributes the stylesheet keys layouts on. */
export function usePageVars(): { style: CSSProperties; attrs: Record<string, string> } {
  const look = usePresentTheme();
  const type = useTypeVars();
  return useMemo(() => ({ style: { ...look.vars, ...type } as CSSProperties, attrs: themeAttrs(look) }), [look, type]);
}

/**
 * A reading area's background. `root`: an area that paints its own (Slides,
 * Scroll); otherwise an area inside the page that shows the page's paper
 * unless the theme has its own colour.
 */
export function usePageBackground(root = false): CSSProperties {
  const look = usePresentTheme();
  const tk = useTokens();
  const appDark = useThemeStore(s => s.mode) === 'dark';
  return useMemo(() => {
    if (look.grain) return root ? paperStyle(tk.bg.app, appDark) : {};
    return { backgroundColor: look.palette.background };
  }, [look, root, tk.bg.app, appDark]);
}

/** The reading column's width (CSS px) in a view: Classic's own widths until the column is changed; Slides never narrower than their default. */
export function useColumn(view: keyof typeof COLUMN): number {
  const look = usePresentTheme();
  const theme = usePresentation(s => s.doc?.style?.theme);
  if (look.id === 'classic' && theme?.column === undefined) return COLUMN[view];
  return view === 'slides' ? Math.max(look.column, COLUMN.slides) : look.column;
}

/** Inside a reading area: the app's colours follow the theme's light or dark (Classic: the app's own). */
export function ThemeScope({ children }: { children: ReactNode }) {
  const look = usePresentTheme();
  const appDark = useThemeStore(s => s.mode) === 'dark';
  const pin = look.ownColours && look.dark !== appDark ? (look.dark ? 'dark' : 'light') : null;
  // Always the provider (null: no override), so switching themes never remounts the canvases inside.
  return createElement(ThemeOverrideContext.Provider, { value: pin }, children);
}

const refetched = new Set<string>();

/** The presentation's @font-face rules ('' when it has no fonts, or until their files are read from the font cache). */
export function usePresentFonts(): string {
  const fonts = usePresentation(s => s.doc?.fonts);
  const [css, setCss] = useState<{ for: readonly EmbeddedFontFace[] | undefined; css: string }>({ for: undefined, css: '' });
  useEffect(() => {
    if (!fonts?.length) return;
    let live = true;
    const resolve = async (): Promise<EmbeddedFontFace[]> => Promise.all(fonts.map(async f => (f.src ? f : { ...f, src: (await faceUrl(fontKey(f))) ?? undefined })));
    void (async () => {
      let faces = await resolve();
      // Not in this browser's cache (a file from elsewhere, a restored backup): fetch the family again, once.
      const missing = [...new Set(faces.filter(f => !f.src).map(f => f.family))].filter(f => !refetched.has(f));
      if (missing.length) {
        for (const family of missing) {
          refetched.add(family);
          try {
            const weights = [...new Set(fonts.filter(f => f.family === family).flatMap(f => f.weight.split(' ').map(Number)))];
            await Promise.all((await fetchFontFaces(family, weights)).map(g => putFace(g)));
          } catch { /* offline: system fonts stand in */ }
        }
        faces = await resolve();
      }
      if (live) setCss({ for: fonts, css: fontFaceCss(faces) });
    })();
    return () => { live = false; };
  }, [fonts]);
  return fonts?.length && css.for === fonts ? css.css : '';
}

/** An image background's picture: the library's (an object URL), the embedded one, or missing (show its preview). */
export function useLibraryImage(img: PresentImage | undefined): { url: string | undefined; missing: boolean } {
  const [state, setState] = useState<{ for: string; url: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick(n => n + 1);
    window.addEventListener(BACKGROUNDS_CHANGED, on);
    return () => window.removeEventListener(BACKGROUNDS_CHANGED, on);
  }, []);
  const lib = img?.libraryId;
  useEffect(() => {
    if (!lib) return;
    let live = true;
    imageUrl(lib).then(u => { if (live) setState({ for: lib, url: u }); }, () => { if (live) setState({ for: lib, url: null }); });
    return () => { live = false; };
  }, [lib, tick]);
  if (!img) return { url: undefined, missing: false };
  const known = state && state.for === lib ? state.url : undefined;
  if (known) return { url: known, missing: false };
  if (img.src) return { url: img.src, missing: false };
  // Still looking: the preview for now. Looked and not there: missing.
  return { url: img.thumb, missing: !lib || known === null };
}
