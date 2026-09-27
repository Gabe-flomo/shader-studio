/**
 * presentLook — the hooks the Present page's views use to dress a step:
 *
 *   useStepLook(step)   the background it shows and the text colours over it
 *   lookVars(look)      those colours as the CSS variables presentCss reads
 *   useTypeVars()       the typography's variables (fonts, size, line height)
 *   usePresentFonts()   the presentation's @font-face rules (files from the font
 *                       cache; a family missing from it is fetched again)
 *   useLibraryImage(i)  an image background's picture from the library, or
 *                       that it's missing
 *
 * <Backdrop> (Backdrop.tsx) draws the background itself.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
