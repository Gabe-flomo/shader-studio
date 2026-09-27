/**
 * presentLook — the hooks the Present page's views use to dress a step:
 *
 *   useStepLook(step)   the background it shows and the text colours over it
 *   lookVars(look)      those colours as the CSS variables presentCss reads
 *   useTypeVars()       the typography's variables (fonts, size, line height)
 *   usePresentFonts()   the presentation's embedded @font-face rules
 *
 * <Backdrop> (Backdrop.tsx) draws the background itself.
 */
import { useMemo, type CSSProperties } from 'react';
import { fontFaceCss, stepLook, textVars, typeVars, type PresentImage, type StepLook } from '../../types/presentationStyle';
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

/** The embedded fonts' @font-face rules ('' when there are none). */
export function usePresentFonts(): string {
  const fonts = usePresentation(s => s.doc?.fonts);
  return useMemo(() => (fonts?.length ? fontFaceCss(fonts) : ''), [fonts]);
}
