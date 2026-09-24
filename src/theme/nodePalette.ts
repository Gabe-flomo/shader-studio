import { ctp } from './palette';
import { useThemeMode } from './themeStore';

/**
 * The Catppuccin roles (`base`, `surface0`, `text`, `blue`, …) for the current app theme: Mocha
 * on dark, and on light Latte's accents over the light tokens' neutrals. Lets the large graph
 * components that were written against `ctp` follow the theme without rewriting every call site.
 * New code should use `useTokens()` instead. Render surfaces (shader previews, scopes) keep `ctp`.
 */
export type CtpPalette = typeof ctp;

const LIGHT: CtpPalette = Object.freeze({
  rosewater: '#dc8a78',
  flamingo: '#dd7878',
  pink: '#ea76cb',
  mauve: '#8839ef',
  red: '#d20f39',
  maroon: '#e64553',
  peach: '#fe640b',
  yellow: '#b57614',
  green: '#177a45',
  teal: '#179299',
  sky: '#04a5e5',
  sapphire: '#209fb5',
  blue: '#3a6ff7',
  lavender: '#7287fd',
  text: '#1a1b23',
  subtext1: '#3a3d47',
  subtext0: '#6b6f7a',
  overlay2: '#7c7f8b',
  overlay1: '#8a8d99',
  overlay0: '#9a9da8',
  surface2: '#b4b7c2',
  surface1: '#e2e4ea',
  surface0: '#f4f5f8',
  base: '#ffffff',
  mantle: '#fbfbfc',
  crust: '#eef0f4',
});

export function useCtp(): CtpPalette {
  return useThemeMode() === 'dark' ? ctp : LIGHT;
}
