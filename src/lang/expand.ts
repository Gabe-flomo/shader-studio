/**
 * expand.ts — the language's words and the code they stand for (docs/playfield-language-plan.md
 * D17, §6.9): one table the registry and the Code Explorer both read, so typing "halo" in the
 * Do… bar and "halo" in the Code Explorer mean the same thing.
 *
 * Kept light (vocabulary words only, no node definitions) so the Code Explorer's search can load it.
 */
import { ACTIONS, SHAPES } from './vocabulary';

/** A Do… bar action's canonical head (§6.2). */
export const ACTION_HEAD: Readonly<Record<string, string>> = {
  glow: 'glow', rings: 'rings', outline: 'outline', onion: 'onion', round: 'round', blend: 'smooth-union', 'mask-from': 'mask',
  warp: 'warp', swirl: 'swirl', twist: 'twist', polar: 'polar', mirror: 'mirror', repeat: 'repeat', 'repeat-around': 'polar-repeat',
  'zoom-rotate': 'zoom-rotate', 'code-here': 'custom', 'mix-with': 'mix', palette: 'palette', 'tone-map': 'tone-map', grade: 'grade',
  brighten: 'brighten', grain: 'grain', 'blend-with': 'blend-mode', 'soft-edge': 'soft-edge', invert: 'invert', 'grow-mask': 'grow-mask',
  'mix-two': 'mix-two', 'blur-texture': 'blur', trails: 'fade', flow: 'flow', remap: 'remap',
};

/** The GLSL a head is usually written with (function names and words), by canonical head. */
export const EXPAND: Readonly<Record<string, readonly string[]>> = {
  // Steps
  glow: ['exp', 'glow', 'pow', 'bloom'], rings: ['abs', 'fract', 'sin', 'ring'], outline: ['abs', 'ring', 'stroke', 'outline'], onion: ['abs', 'onion'],
  round: ['round', 'offset'], 'smooth-union': ['smin', 'min', 'mix'], mask: ['step', 'smoothstep'], warp: ['fbm', 'noise', 'warp'],
  swirl: ['atan', 'length', 'polar', 'swirl'], twist: ['atan', 'rot', 'twist'], polar: ['atan', 'length', 'polar'], mirror: ['abs', 'mirror'],
  repeat: ['fract', 'mod', 'floor', 'cell', 'grid'], 'polar-repeat': ['atan', 'mod', 'polar', 'kaleido'], 'zoom-rotate': ['rot', 'rotate', 'mat2', 'atan', 'cos', 'sin'],
  mix: ['mix', 'smoothstep'], palette: ['palette', 'cos', 'mix', 'col', 'color'], 'tone-map': ['aces', 'tonemap', 'pow'], grade: ['pow', 'mix'],
  brighten: ['pow', 'exposure'], grain: ['hash', 'fract', 'sin', 'grain'], 'blend-mode': ['screen', 'overlay', 'mix'], 'soft-edge': ['smoothstep', 'fwidth', 'edge', 'antialias'],
  invert: ['1.0 -', 'invert'], 'grow-mask': ['smoothstep', 'max'], blur: ['blur', 'texture2d', 'gauss'], fade: ['mix', 'decay', 'exp'], flow: ['texture2d', 'flow'],
  // Shapes and makers
  circle: ['length', 'distance', 'sdcircle', 'circle'], ring: ['abs', 'length', 'ring'], box: ['abs', 'max', 'sdbox', 'box'],
  star: ['atan', 'mod', 'sdstar', 'star'], hexagon: ['abs', 'dot', 'sdhexagon'], heart: ['sqrt', 'sdheart'], line: ['clamp', 'dot', 'sdsegment'],
  noise: ['hash', 'noise', 'fbm', 'fract', 'sin', 'dot'], voronoi: ['fract', 'floor', 'min', 'voronoi', 'cell'],
  // Combines and colouring
  union: ['min', 'smin'], subtract: ['max', '-'], intersect: ['max'], colour: ['palette', 'cos', 'mix', 'col', 'color'],
};

/** Extra words people use for a head that aren't the bar's words (they still find its code). */
const MORE_WORDS: Readonly<Record<string, readonly string[]>> = {
  union: ['union', 'combine', 'merge', 'join', 'add'], subtract: ['subtract', 'cut', 'minus', 'difference'], intersect: ['intersect', 'intersection', 'both'],
  colour: ['colour', 'color', 'hue', 'tint', 'colourise', 'colorize'], noise: ['noise', 'random', 'hash', 'rand', 'fbm', 'clouds'], voronoi: ['voronoi', 'cells', 'worley'],
  'polar-repeat': ['repeat-around', 'petals', 'kaleidoscope'], glow: ['bloom', 'light', 'halo'], rings: ['ripple', 'ripples', 'contours'], repeat: ['grid', 'cell', 'cells', 'wrap'],
};

export interface SynonymRow { words: string[]; expand: string[] }

/** The Code Explorer's rows for the language's words: each head and its aliases → its code. */
export function languageSynonymRows(): SynonymRow[] {
  const rows = new Map<string, Set<string>>();
  const add = (head: string, words: readonly string[]) => {
    if (!EXPAND[head]) return;
    const set = rows.get(head) ?? new Set<string>([head]);
    for (const w of words) if (!w.includes(' ')) set.add(w.toLowerCase());
    rows.set(head, set);
  };
  for (const a of ACTIONS) add(ACTION_HEAD[a.id] ?? a.id, a.words);
  for (const s of SHAPES) if (s.node2d) add(s.id, s.words);
  for (const [head, words] of Object.entries(MORE_WORDS)) add(head, words);
  return [...rows].map(([head, words]) => ({ words: [...words], expand: [...EXPAND[head]] }));
}
