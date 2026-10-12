/**
 * handStyle.ts — the hands' colours on the picture, from the app's theme (theme/tokens.ts): the right hand in the
 * accent, the left in the expression violet, each theme's own shades. A colour the setup picked (Show hand on
 * picture's swatch) wins: the right hand takes it and the left a lighter shade. The kit draws (kit/hands.js hdDraw).
 */
import { THEMES, fontFamily, type ThemeMode } from '../theme/tokens';
import { HD_LEGACY_COLOUR, type HdPalette, type HdRgb } from './kit/hands.js';

/** `#rrggbb` → 0..1 channels. */
export function hexRgb(hex: string): HdRgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** The setup still has the old default colour (or none): the theme's two colours are used. */
export const isThemeColour = (c: HdRgb | null | undefined): boolean =>
  !c || c.every((v, i) => Math.abs(v - HD_LEGACY_COLOUR[i]) < 0.01);

/** The two theme colours as hex, for swatches. */
export const handThemeHex = (mode: ThemeMode): { left: string; right: string } => ({ right: THEMES[mode].accent.base, left: THEMES[mode].kind.expr });

const cache = new Map<string, HdPalette>();

/** The hands' palette for a theme and the setup's colour (cached: the overlay asks every frame). */
export function handPalette(mode: ThemeMode, colour?: HdRgb | null): HdPalette {
  const custom = !isThemeColour(colour);
  const key = custom ? `${mode}:${colour!.join(',')}` : mode;
  let p = cache.get(key);
  if (!p) {
    const hex = handThemeHex(mode);
    p = custom
      ? { right: colour!, left: colour!.map(v => v + (1 - v) * 0.4) as HdRgb, font: fontFamily.ui }
      : { right: hexRgb(hex.right), left: hexRgb(hex.left), font: fontFamily.ui };
    cache.set(key, p);
  }
  return p;
}
