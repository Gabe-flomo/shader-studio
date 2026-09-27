/**
 * backdrop.ts — a step's background as stacked layers, the same for the app
 * (components/present/Backdrop.tsx) and the exported page:
 *
 *   base      the colour, the gradient, or the image (fit and position)
 *   blur      the image again, blurred with CSS filter: blur() (WKWebView has
 *             no canvas filters; a CSS filter on an element works everywhere
 *             and the browser keeps the blurred layer, it isn't redrawn per
 *             frame). With falloff it's masked by a column-shaped gradient:
 *             fully opaque across the content column, fading toward the sides
 *             to 1 − falloff, so the text sits on the softened picture and the
 *             sharp one shows at the edges. The column is the page's content
 *             width (`column`, CSS pixels), so the mask follows the layout.
 *   shade     a flat wash toward the tone (dark under light text, light under
 *             dark text)
 *   vignette  the edges fade to the tone
 *
 * Each layer is a list of CSS declarations (kebab-case), turned into React
 * styles by the app or into a stylesheet by the export.
 */
import { paletteCss } from '../lib/backgroundLibrary';
import { BLUR_MAX_PX, type PresentBackground, type RGB } from '../types/presentationStyle';

export type Decls = Array<[prop: string, value: string]>;
export interface BackdropLayer { name: 'base' | 'blur' | 'shade' | 'vignette'; decls: Decls }

const css = (c: readonly number[], a = 1) => {
  const [r, g, b] = c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${Number(a.toFixed(3))})`;
};

/** The blur radius for an amount (0..1), in CSS pixels. */
export const blurPx = (amount: number) => Math.round(Math.max(0, Math.min(1, amount)) * BLUR_MAX_PX * 10) / 10;

/**
 * The falloff mask: opaque over the content column (`column` px wide, centred),
 * fading out to 1 − falloff at the layer's sides. On a screen no wider than
 * the column, it's even.
 */
export function falloffMask(falloff: number, column: number): string {
  const edge = Number((1 - Math.max(0, Math.min(1, falloff))).toFixed(3));
  const half = Math.round(column / 2);
  const side = `(50% - min(50%, ${half}px))`;
  // A colour hint a third of the way in from each edge: the blur stays strong just past the column and eases out toward the edge.
  return `linear-gradient(90deg, rgb(0 0 0 / ${edge}) 0%, calc(${side} * 0.35), #000 calc(50% - min(50%, ${half}px)), #000 calc(50% + min(50%, ${half}px)), calc(100% - ${side} * 0.35), rgb(0 0 0 / ${edge}) 100%)`;
}

/**
 * The layers for a background. `src` is the image's URL (a data URL, or the
 * library's full-size copy); `matte` the colour around a fitted image (its
 * average); `tone` what shade and vignette mix toward; `column` the content
 * column's width for the blur's falloff. `imageClass`: leave the picture
 * out of the declarations (the export sets it once per image with a class).
 */
export function backdropLayers(bg: PresentBackground, o: { src?: string; imageClass?: string; matte?: RGB; tone: RGB; column: number }): BackdropLayer[] {
  const out: BackdropLayer[] = [];
  const image: Decls = [];
  if (bg.kind === 'image' && (o.src || o.imageClass)) {
    const [x, y] = bg.position ?? [0.5, 0.5];
    // With imageClass the picture comes from a class (the export defines each image once).
    if (o.src && !o.imageClass) image.push(['background-image', `url("${o.src}")`]);
    image.push(
      ['background-size', bg.fit === 'contain' ? 'contain' : 'cover'],
      ['background-position', `${Math.round(x * 100)}% ${Math.round(y * 100)}%`],
      ['background-repeat', 'no-repeat'],
    );
    out.push({ name: 'base', decls: [['background-color', css(o.matte ?? [0.08, 0.08, 0.1])], ...image] });
  } else if (bg.kind === 'fill' && bg.fill) {
    out.push({ name: 'base', decls: [['background-image', paletteCss(bg.fill)]] });
  } else if (bg.kind === 'colour' && bg.colour) {
    out.push({ name: 'base', decls: [['background-color', css(bg.colour)]] });
  } else {
    return out;
  }
  const blur = bg.kind === 'image' && image.length ? blurPx(bg.blur ?? 0) : 0;
  if (blur > 0.5) {
    const decls: Decls = [['background-color', css(o.matte ?? [0.08, 0.08, 0.1])], ...image,
      // Blurring spreads the edges inward: the layer overhangs the box by twice the radius, so they stay solid.
      ['inset', `${-2 * Math.ceil(blur)}px`], ['filter', `blur(${blur}px)`], ['will-change', 'transform']];
    const falloff = bg.falloff ?? 0;
    if (falloff > 0.001) {
      const m = falloffMask(falloff, o.column);
      decls.push(['-webkit-mask-image', m], ['mask-image', m]);
    }
    out.push({ name: 'blur', decls });
  }
  const shade = Math.max(0, Math.min(1, bg.shade ?? 0));
  if (shade > 0.001) out.push({ name: 'shade', decls: [['background-color', css(o.tone, shade * 0.78)]] });
  const v = Math.max(0, Math.min(1, bg.vignette ?? 0));
  if (v > 0.001) {
    const clear = Math.round(62 - 34 * v);
    out.push({ name: 'vignette', decls: [['background-image', `radial-gradient(ellipse 72% 78% at 50% 50%, ${css(o.tone, 0)} ${clear}%, ${css(o.tone, 0.92 * v)} 100%)`]] });
  }
  return out;
}

/** Declarations as a React style object (kebab-case to camelCase; -webkit- to Webkit). */
export function declsToStyle(d: Decls): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of d) out[k.replace(/^-webkit-/, 'Webkit-').replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = v;
  return out;
}

export function declsToCss(d: Decls): string {
  return d.map(([k, v]) => `${k}:${v}`).join(';');
}
