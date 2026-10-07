/**
 * vocabulary.ts — the shared words of the no-AI phrase languages: the Do… bar
 * (suggestions/doBar.ts) and the 3D Scene Builder's recipe language.
 *
 * One fixed vocabulary: shapes (2D and 3D node types), actions (with synonyms), targets
 * ("it", "these", "the space"), parameter names, colours, number words and places. Matching is
 * deterministic: exact word or synonym first, then a small edit distance for longer words, so
 * "glwo" still means glow but "ring" never becomes "rings" by accident (plural folding is
 * explicit). Nothing here knows about the graph; callers map ids to moves or nodes.
 *
 * Adding words: put them on the entry they mean. Both languages pick them up.
 */

import { SHAPES as SCENE_SHAPES, WARPS as SCENE_WARPS } from '../sceneBuilder/spec';
import { COLOUR_TABLE, colourOf as colourOfAny, type RGB } from './colours';
import { editDistance, fuzzBudget } from './fuzzy';

export type { RGB };

/** Every Scene Builder warp kind and alias (for checking the mapping below stays valid). */
export const SCENE_WARP_KINDS: readonly string[] = SCENE_WARPS.map(w => w.kind);

export interface ShapeWord {
  id: string;
  words: string[];
  /** The 2D node (and its settings) the shape is. */
  node2d?: { type: string; params?: Record<string, unknown>; size?: string };
  /** The 3D node. */
  node3d?: { type: string; params?: Record<string, unknown>; size?: string };
}

/** Shapes: the first word is the name shown. */
const BASE_SHAPES: ShapeWord[] = [
  { id: 'circle', words: ['circle', 'disc', 'disk', 'dot', 'blob', 'round shape'], node2d: { type: 'circleSDF', size: 'radius' }, node3d: { type: 'sphereSDF3D', size: 'radius' } },
  { id: 'sphere', words: ['sphere', 'ball', 'orb'], node2d: { type: 'circleSDF', size: 'radius' }, node3d: { type: 'sphereSDF3D', size: 'radius' } },
  { id: 'box', words: ['box', 'square', 'rectangle', 'rect', 'block'], node2d: { type: 'boxSDF', size: 'width' }, node3d: { type: 'boxSDF3D' } },
  { id: 'cube', words: ['cube'], node2d: { type: 'boxSDF', size: 'width' }, node3d: { type: 'boxSDF3D' } },
  { id: 'ring', words: ['ring', 'hoop', 'annulus'], node2d: { type: 'ringSDF', size: 'radius' }, node3d: { type: 'torusSDF3D' } },
  { id: 'torus', words: ['torus', 'donut', 'doughnut'], node2d: { type: 'ringSDF', size: 'radius' }, node3d: { type: 'torusSDF3D' } },
  { id: 'heart', words: ['heart'], node2d: { type: 'shapeSDF', params: { shape: 'heart' }, size: 'r' } },
  { id: 'triangle', words: ['triangle', 'tri'], node2d: { type: 'shapeSDF', params: { shape: 'triangle' }, size: 'r' }, node3d: { type: 'triPrismSDF3D' } },
  { id: 'hexagon', words: ['hexagon', 'hex'], node2d: { type: 'shapeSDF', params: { shape: 'hexagon' }, size: 'r' }, node3d: { type: 'hexPrismSDF3D' } },
  { id: 'pentagon', words: ['pentagon'], node2d: { type: 'shapeSDF', params: { shape: 'pentagon' }, size: 'r' } },
  { id: 'octagon', words: ['octagon'], node2d: { type: 'shapeSDF', params: { shape: 'octagon' }, size: 'r' } },
  { id: 'star', words: ['star', 'pentagram'], node2d: { type: 'shapeSDF', params: { shape: 'pentagram' }, size: 'r' } },
  { id: 'cross', words: ['cross', 'plus sign'], node2d: { type: 'shapeSDF', params: { shape: 'cross' }, size: 'r' }, node3d: { type: 'sdCross3D' } },
  { id: 'moon', words: ['moon', 'crescent'], node2d: { type: 'shapeSDF', params: { shape: 'moon' }, size: 'r' } },
  { id: 'diamond', words: ['diamond', 'rhombus'], node2d: { type: 'shapeSDF', params: { shape: 'rhombus' }, size: 'r' }, node3d: { type: 'octahedronSDF3D' } },
  { id: 'ellipse', words: ['ellipse', 'oval', 'egg'], node2d: { type: 'shapeSDF', params: { shape: 'ellipse' }, size: 'r' }, node3d: { type: 'ellipsoidSDF3D' } },
  { id: 'line', words: ['line', 'segment', 'stroke'], node2d: { type: 'shapeSDF', params: { shape: 'segment' } }, node3d: { type: 'capsuleSDF3D' } },
  { id: 'capsule', words: ['capsule', 'pill'], node3d: { type: 'capsuleSDF3D' } },
  { id: 'cylinder', words: ['cylinder', 'tube', 'pillar', 'column'], node3d: { type: 'cylinderSDF3D' } },
  { id: 'cone', words: ['cone'], node3d: { type: 'coneSDF3D' } },
  { id: 'pyramid', words: ['pyramid'], node3d: { type: 'pyramidSDF3D' } },
  { id: 'octahedron', words: ['octahedron'], node3d: { type: 'octahedronSDF3D' } },
  { id: 'plane', words: ['plane', 'floor', 'ground'], node3d: { type: 'planeSDF3D' } },
];

/**
 * The shapes, with the 3D Scene Builder's own (sceneBuilder/spec.ts): its kinds and aliases are
 * folded in, so "donut", "pill" or "box-frame" mean the same node in both languages, and a 3D
 * shape only the Scene Builder knows is still a word here (`sceneKind` names it there).
 */
export const SHAPES: readonly (ShapeWord & { sceneKind?: string })[] = (() => {
  const out: (ShapeWord & { sceneKind?: string })[] = BASE_SHAPES.map(sh => ({ ...sh, words: [...sh.words] }));
  for (const sc of SCENE_SHAPES) {
    const names = [sc.kind, sc.kind.replace(/-/g, ' '), sc.label.toLowerCase(), ...sc.aliases.map(a => a.replace(/-/g, ' '))];
    const same = out.find(sh => sh.node3d?.type === sc.type && names.some(nm => sh.words.includes(nm) || sh.id === nm));
    if (same) {
      same.sceneKind = sc.kind;
      for (const nm of names) if (!out.some(o => o.words.includes(nm))) same.words.push(nm);
    } else {
      const words = names.filter((nm, i) => names.indexOf(nm) === i && !out.some(o => o.words.includes(nm)));
      if (words.length) out.push({ id: sc.kind, words, node3d: { type: sc.type }, sceneKind: sc.kind });
    }
  }
  return out;
})();

/**
 * The Do… bar's space actions as the Scene Builder's warps (sceneBuilder/spec.ts WARPS), so a
 * phrase like "twist 0.5" or "repeat 6 times around" means the same bend in 2D and in 3D.
 */
export const ACTION_TO_SCENE_WARP: Readonly<Record<string, string>> = {
  twist: 'twist', repeat: 'repeat', 'repeat-around': 'polar-repeat', mirror: 'mirror', warp: 'noise', polar: 'polar-repeat',
  'zoom-rotate': 'turn', swirl: 'twist',
};

export interface ActionWord {
  id: string;
  words: string[];
  /** Words that, with this action, pick a variant ("repeat … around" → repeat-around). */
  variants?: Array<{ words: string[]; id: string }>;
}

/**
 * Actions: what to do to a target. Ids are the suggestion moves' ids where one move covers it
 * (suggestions/moves.ts); a few ids are kind-dependent and resolved by the caller (glow on a
 * distance is SDF Glow, on a colour Bloom, on a texture Glow (texture)), and a few work on two
 * selected nodes (mix, blend).
 */
export const ACTIONS: readonly ActionWord[] = [
  { id: 'glow', words: ['glow', 'glowing', 'halo', 'neon', 'light up', 'shine', 'bloom'] },
  { id: 'rings', words: ['rings', 'ripples', 'contours', 'iso lines', 'isolines', 'concentric'] },
  { id: 'outline', words: ['outline', 'outlined', 'border', 'edge line', 'stroke it', 'edges'] },
  { id: 'onion', words: ['onion', 'hollow', 'shell'] },
  { id: 'round', words: ['round', 'rounded', 'grow', 'bigger', 'fatten', 'inflate', 'thicken'] },
  { id: 'blend', words: ['blend', 'melt', 'merge', 'smooth union', 'smoothly blend', 'smooth min', 'smin', 'combine', 'join'] },
  { id: 'mask-from', words: ['mask', 'cutout', 'stencil'] },
  { id: 'warp', words: ['warp', 'distort', 'wobble', 'noise', 'noisy', 'organic', 'marble', 'domain warp'] },
  { id: 'swirl', words: ['swirl', 'vortex', 'whirl', 'spin'] },
  { id: 'twist', words: ['twist', 'twisted', 'spiral'] },
  { id: 'polar', words: ['polar', 'radial', 'wrap around'] },
  { id: 'mirror', words: ['mirror', 'mirrored', 'symmetric', 'symmetry', 'reflect', 'flip'] },
  { id: 'repeat', words: ['repeat', 'tile', 'tiles', 'tiled', 'grid of', 'copies', 'duplicate', 'pattern'], variants: [{ words: ['around', 'circle', 'radially', 'round', 'ring', 'petals', 'kaleidoscope'], id: 'repeat-around' }] },
  { id: 'zoom-rotate', words: ['zoom', 'scale', 'rotate', 'turn', 'tilt', 'magnify'] },
  { id: 'code-here', words: ['custom code', 'code', 'expression', 'my own'] },
  { id: 'mix-with', words: ['mix', 'mixed', 'tint', 'mix with', 'crossfade'] },
  { id: 'palette', words: ['palette', 'colour it', 'color it', 'colorize', 'colourise', 'colourize', 'rainbow', 'recolour', 'recolor', 'gradient map'] },
  { id: 'tone-map', words: ['tone map', 'tonemap', 'tone-map', 'tone mapping', 'aces', 'unclip', 'stop clipping', 'compress highlights'] },
  { id: 'grade', words: ['grade', 'colour grade', 'color grade', 'lift gamma gain', 'look'] },
  { id: 'brighten', words: ['brighter', 'brighten', 'lighten', 'lift', 'exposure'] },
  { id: 'grain', words: ['grain', 'film grain', 'dither', 'noise grain', 'grainy'] },
  { id: 'blend-with', words: ['blend mode', 'screen', 'overlay', 'layer'] },
  { id: 'soft-edge', words: ['soften', 'soft edge', 'soft', 'feather', 'smooth edge', 'antialias', 'anti alias', 'blur the edge'] },
  { id: 'invert', words: ['invert', 'inverse', 'negate', 'flip inside'] },
  { id: 'grow-mask', words: ['grow the mask', 'shrink', 'erode', 'dilate'] },
  { id: 'mix-two', words: ['mix two pictures', 'two pictures', 'cut between'] },
  { id: 'blur-texture', words: ['blur', 'blurry', 'soft focus', 'defocus'] },
  { id: 'trails', words: ['trails', 'trail', 'feedback', 'echo', 'smear', 'motion trails'] },
  { id: 'flow', words: ['flow', 'stream', 'smudge'] },
  { id: 'remap', words: ['remap', 'normalize', 'normalise', 'rescale', 'fit range'] },
];

/** Targets: what an action applies to. */
export const TARGETS: Readonly<Record<string, string[]>> = {
  selection: ['it', 'this', 'that', 'the selection', 'selected', 'the shape', 'the node'],
  pair: ['these', 'them', 'both', 'the two', 'these colours', 'these colors', 'these shapes', 'the edges'],
  space: ['the space', 'space', 'the uv', 'uv', 'uvs', 'coordinates', 'the coordinates', 'the domain'],
  picture: ['the picture', 'the image', 'everything', 'the output', 'the whole thing', 'the result'],
};

/** Parameter names and the words that mean them. Each slot is a move argument name (moves.ts). */
export const PARAMS: Readonly<Record<string, string[]>> = {
  falloff: ['falloff', 'fall off', 'fall-off', 'tightness'],
  count: ['times', 'count', 'copies', 'tiles', 'rings', 'petals', 'repeats', 'x'],
  amount: ['amount', 'strength', 'by', 'intensity', 'power'],
  thickness: ['thickness', 'thick', 'width', 'wide'],
  smoothness: ['smoothness', 'smooth', 'k', 'softness'],
  radius: ['radius', 'size', 'big', 'r'],
  speed: ['speed', 'fast'],
  angle: ['angle', 'degrees', 'deg', 'rad', 'radians'],
  zoom: ['zoom'],
};

/** Colour words: the one table (colours.ts). */
export const COLOURS: Readonly<Record<string, RGB>> = COLOUR_TABLE;

/** Number words. */
export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  sixteen: 16, twenty: 20, half: 0.5, quarter: 0.25, twice: 2, double: 2, once: 1, thrice: 3, dozen: 12, a: 1, an: 1,
};

/** Places on the picture (UV, the picture is about −0.9…0.9 wide, −0.5…0.5 tall). */
export const PLACES: Readonly<Record<string, [number, number]>> = {
  middle: [0, 0], center: [0, 0], centre: [0, 0], 'the middle': [0, 0], 'the center': [0, 0], 'the centre': [0, 0],
  top: [0, 0.3], bottom: [0, -0.3], left: [-0.45, 0], right: [0.45, 0],
  'top left': [-0.45, 0.3], 'top right': [0.45, 0.3], 'bottom left': [-0.45, -0.3], 'bottom right': [0.45, -0.3],
};

/** Words that only glue a phrase together. */
export const FILLER = new Set(['a', 'an', 'the', 'with', 'and', 'then', 'to', 'of', 'in', 'on', 'at', 'some', 'add', 'make', 'put', 'give', 'please', 'it', 'its', 'me', 'please', 'into', 'by', 'for', 'is', 'be', 'more', 'little', 'bit', 'slightly', 'very', 'lots']);

// ── Matching ────────────────────────────────────────────────────────────────

/** Lower-case words, numbers kept whole ("0.5", "-2", "#ff8800", "6x" → "6", "x"). */
export function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/(\d)x\b/g, '$1 x')
    .replace(/[“”"']/g, '')
    .split(/[^a-z0-9.#\-]+/)
    .map(w => w.replace(/^[.-]+(?=[a-z])/, '').replace(/[.]+$/, ''))
    .filter(Boolean);
}

export { editDistance, fuzzBudget };

/**
 * Find a phrase (one or more words) of `entries` at position `i` of `tokens`: the longest exact
 * match wins, then a fuzzy single word. Returns the entry, how many tokens it used and whether
 * it was fuzzy.
 */
export function matchAt<T extends { words: readonly string[] }>(tokens: string[], i: number, entries: readonly T[]): { entry: T; length: number; fuzzy: boolean; word: string } | null {
  let best: { entry: T; length: number; fuzzy: boolean; word: string } | null = null;
  for (const entry of entries) {
    for (const w of entry.words) {
      const parts = w.split(' ');
      if (parts.length > tokens.length - i) continue;
      if (parts.every((p, k) => tokens[i + k] === p || (k === parts.length - 1 && plural(tokens[i + k]) === p))) {
        if (!best || parts.length > best.length || (best.fuzzy && parts.length === best.length)) best = { entry, length: parts.length, fuzzy: false, word: w };
      }
    }
  }
  if (best) return best;
  const t = tokens[i];
  const budget = fuzzBudget(t);
  if (!budget) return null;
  let bestD = budget + 1;
  for (const entry of entries) {
    for (const w of entry.words) {
      if (w.includes(' ') || fuzzBudget(w) === 0) continue;
      const d = editDistance(t, w, budget);
      if (d < bestD) { bestD = d; best = { entry, length: 1, fuzzy: true, word: w }; }
    }
  }
  return best;
}

/** A plural folded to its singular ("circles" → "circle", "boxes" → "box"); else the word. */
export function plural(word: string): string {
  if (word.length > 4 && word.endsWith('es') && /(x|s|sh|ch)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** A number token ("0.5", "-2", "six", "half"), or null. */
export function numberOf(token: string): number | null {
  if (/^-?\d*\.?\d+$/.test(token)) return Number(token);
  if (token in NUMBER_WORDS && token !== 'a' && token !== 'an') return NUMBER_WORDS[token];
  return null;
}

/** A colour token: a colour word or #rrggbb / #rgb (the one table, colours.ts). */
export const colourOf = (token: string): RGB | null => colourOfAny(token);
