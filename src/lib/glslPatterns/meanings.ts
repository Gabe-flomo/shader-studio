/**
 * Plain meanings for the idioms (docs/expression-explainer.md, "Plain meaning"): what the values
 * are, what it looks or feels like, and what it is for. The literal reading ("where a is below
 * 0.02") stays as the idiom's `noun` / `how`; this is the sentence a person reads first:
 *
 *   float silent = 1.0 - step(0.02, a);
 *   → "silent is 1 while a stays under 0.02 and 0 otherwise: a switch that is on only when a is
 *      almost 0."   (use: a hard on/off mask)
 *
 * A meaning is a noun phrase that reads after "x is …" / "Returns …" / "Gives …". `use` names
 * the common job, shown as a tag. Every built-in idiom has one (the tests check).
 */
import type { IdiomText } from './idioms';

export interface Meaning {
  meaning: (c: IdiomText) => string;
  use?: string;
}

/** "almost 0" for a tiny threshold, else "low". */
const lowWord = (c: IdiomText, k: string) => { const v = c.v(k); return v !== undefined && Math.abs(v) <= 0.1 ? 'almost 0' : 'low'; };
const highWord = (c: IdiomText, k: string) => { const v = c.v(k); return v !== undefined && Math.abs(v) <= 0.1 ? 'above almost nothing' : 'high enough'; };

export const MEANINGS: Record<string, Meaning> = {
  'hash-sin-dot': { meaning: c => `a random-looking number from 0 to 1 for each ${c.h('p')}: the same spot always gets the same number, neighbours look unrelated`, use: 'per-cell randomness' },
  'hash-sin': { meaning: c => `a random-looking number from 0 to 1 for each ${c.h('x')}, the same every time for the same input`, use: 'randomness' },
  'centre-uv': { meaning: c => `${c.h('uv')} running from −1 to 1, with 0 in the middle of the picture`, use: 'centred coordinates' },
  'remap-01': { meaning: c => `${c.h('x')} squeezed from −1…1 into 0…1: the same shape, but never negative`, use: 'a brightness or mix amount' },
  'centre-half': { meaning: c => `${c.h('uv')} moved so (0, 0) sits in the middle: −0.5 at one edge, 0.5 at the other`, use: 'centred coordinates' },
  'screen-uv': { meaning: () => 'where the pixel is on the screen: 0 at the left/bottom, 1 at the right/top', use: 'screen coordinates' },
  'centred-aspect-uv': { meaning: () => 'where the pixel is, measured from the middle, with squares staying square on any screen', use: 'centred coordinates' },
  'aspect': { meaning: c => `${c.h('x')} widened to match the screen, so circles stay round`, use: 'aspect correction' },
  'tile': { meaning: c => `${c.h('p')} chopped into ${c.code('n') ? `${c.h('n')} × ${c.h('n')} ` : ''}tiles, each running 0…1: draw once, see it repeated`, use: 'a repeating grid' },
  'tile-centred': { meaning: c => `${c.h('p')} chopped into repeating tiles, each with its own centre at 0 (−0.5…0.5)`, use: 'a repeating grid' },
  'cell-id': { meaning: c => `which tile ${c.h('p')} is in, as whole numbers: every pixel in a tile gets the same id`, use: 'per-tile variation' },
  'mod-repeat-centred': { meaning: c => `${c.h('p')} repeating every ${c.h('c')}, each copy centred on 0`, use: 'repeated shapes' },
  'polar': { meaning: c => `${c.h('p')} as how far from the centre and which way round`, use: 'radial patterns' },
  'angle': { meaning: c => `which way ${c.h('p')} points from the centre: −π…π, 0 pointing right`, use: 'radial patterns' },
  'rotate-mat': { meaning: c => `${c.h('p')} turned around the centre by ${c.h('a')} radians`, use: 'rotation' },
  'rotation-matrix': { meaning: c => `a turn by ${c.h('a')} radians, ready to multiply a point by`, use: 'rotation' },
  'normalize': { meaning: c => `just the direction of ${c.h('v')}, with its length set to 1`, use: 'directions and lighting' },
  'soft-circle-inside': { meaning: c => `a filled dot: 1 inside radius ${c.h('r')}, fading to 0 just outside it`, use: 'a soft round mask' },
  'soft-circle': { meaning: c => `a soft-edged circle of radius ${c.h('r')}, cut out: 0 inside the circle, rising to 1 outside it`, use: 'a soft round mask' },
  'circle-sdf': { meaning: c => `how far ${c.h('p')} is from the edge of a circle of radius ${c.h('r')}: negative inside, 0 on the edge, positive outside`, use: 'a shape to fill, outline or glow' },
  'ring-sdf': { meaning: c => `how far ${c.h('p')} is from a ring of radius ${c.h('r')}: 0 on the ring, growing both ways`, use: 'a ring shape' },
  'box-sdf': { meaning: () => 'how far the point is from a box’s edge: negative inside, 0 on the edge, positive outside', use: 'a shape to fill, outline or glow' },
  'box-sdf-outside': { meaning: c => `how far ${c.h('p')} is outside a box of half-size ${c.h('b')} (0 anywhere inside)`, use: 'a box shape' },
  'box-offsets': { meaning: c => `how far ${c.h('p')} sticks out past a box of half-size ${c.h('b')}, per axis`, use: 'the first step of a box' },
  'onion': { meaning: c => `the edge of ${c.h('d')} turned into a line of thickness ${c.h('w')}`, use: 'an outline' },
  'fill-soft': { meaning: c => `the shape ${c.h('d')} filled in: 1 inside, fading to 0 over ${c.h('w')} past its edge`, use: 'a soft-edged mask' },
  'fill-hard': { meaning: c => `the shape ${c.h('d')} filled in: 1 inside, 0 outside, with a crisp edge`, use: 'a hard on/off mask' },
  'sdf-union': { meaning: c => `both shapes ${c.h('a')} and ${c.h('b')} at once`, use: 'combining shapes' },
  'sdf-subtract': { meaning: c => `${c.h('a')} with ${c.h('b')} bitten out of it`, use: 'cutting shapes' },
  'sdf-intersect': { meaning: c => `only where ${c.h('a')} and ${c.h('b')} overlap`, use: 'combining shapes' },
  'smin-poly': { meaning: c => `${c.h('a')} and ${c.h('b')} melted together where they meet, over ${c.h('k')}`, use: 'blobby, gooey joins' },
  'smin-weight': { meaning: c => `how much of ${c.h('a')} versus ${c.h('b')} to take near their join: 0…1`, use: 'blobby, gooey joins' },
  'smin-exp': { meaning: c => `${c.h('a')} and ${c.h('b')} melted together with a soft join (${c.h('k')} sets how soft)`, use: 'blobby, gooey joins' },
  'smin-root': { meaning: c => `${c.h('a')} and ${c.h('b')} melted together with a rounded join`, use: 'blobby, gooey joins' },
  'glow-exp': { meaning: c => `a glow: 1 right at ${c.h('d')}’s edge, fading quickly and smoothly to 0 further away`, use: 'a soft glow' },
  'glow-inv': { meaning: c => `a glow: 1 at ${c.h('d')}’s edge, fading slowly with a long tail`, use: 'a soft glow' },
  'glow-over': { meaning: c => `a hot glow that shoots up near ${c.h('d')}’s edge and fades slowly (add it, it can go far above 1)`, use: 'a neon glow' },
  'triangle': { meaning: c => `a zig-zag of ${c.h('x')}: up and down in straight lines, once per unit`, use: 'a repeating ramp' },
  'smoothstep-hand': { meaning: c => `${c.h('x')} eased in and out: starts slow, speeds up, settles gently`, use: 'a soft fade from 0 to 1' },
  'quintic': { meaning: c => `${c.h('x')} eased in and out, even more gently at the ends than smoothstep`, use: 'a soft fade from 0 to 1' },
  'saturate': { meaning: c => `${c.h('x')} kept between 0 and 1: anything outside is pinned to the nearest end`, use: 'a safe 0…1 value' },
  'step-band': { meaning: c => `1 while ${c.h('x')} is between ${c.h('a')} and ${c.h('b')} and 0 everywhere else: a stripe`, use: 'a hard band mask' },
  'quantise': { meaning: c => `${c.h('x')} snapped to ${c.h('n')} flat steps per unit, like a staircase`, use: 'posterising' },
  'checker': { meaning: () => 'alternating 0 and 1 from one tile to the next, like a chessboard', use: 'a checkerboard pattern' },
  'rings': { meaning: c => `rings spreading out from ${c.h('p')}’s centre, ${c.h('f')} per unit, moving as ${c.h('t')} changes`, use: 'ripples' },
  'luma-601': { meaning: c => `how bright ${c.h('c')} looks to the eye, as one number 0…1`, use: 'greyscale' },
  'luma-709': { meaning: c => `how bright ${c.h('c')} looks to the eye, as one number 0…1`, use: 'greyscale' },
  'grey-average': { meaning: c => `${c.h('c')} as a plain grey: the average of its red, green and blue`, use: 'greyscale' },
  'iq-palette': { meaning: c => `a colour picked smoothly along a looping gradient as ${c.h('t')} changes`, use: 'a colour gradient' },
  'gamma-encode': { meaning: c => `${c.h('c')} brightened in the darks so it looks right on screen`, use: 'gamma correction' },
  'gamma-decode': { meaning: c => `${c.h('c')} turned into true light amounts, so mixing and lighting add up`, use: 'linear colour' },
  'contrast': { meaning: c => `${c.h('c')} pushed away from mid-grey (more punch) or toward it (flatter), by ${c.h('k')}`, use: 'contrast' },
  'vignette': { meaning: c => `1 in the middle of ${c.h('p')}, getting darker toward the edges`, use: 'a vignette mask' },
  'mix-half': { meaning: c => `exactly halfway between ${c.h('a')} and ${c.h('b')}`, use: 'an even blend' },
  'inverse-lerp': { meaning: c => `how far ${c.h('x')} has got from ${c.h('a')} to ${c.h('b')}: 0 at ${c.h('a')}, 1 at ${c.h('b')}`, use: 'a ramp between two values' },
  'dot-self': { meaning: c => `how far ${c.h('p')} is from the centre, squared (cheap, and fine for comparing)`, use: 'distance checks' },
  'distance-between': { meaning: c => `how far apart ${c.h('a')} and ${c.h('b')} are`, use: 'distance' },
  'mod-repeat': { meaning: c => `${c.h('p')} counting up to ${c.h('c')} and starting again from 0`, use: 'repetition' },
  'step-threshold-inv': { meaning: c => `1 while ${c.h('x')} stays under ${c.h('e')} and 0 otherwise: a switch that is on only when ${c.h('x')} is ${lowWord(c, 'e')}`, use: 'a hard on/off mask' },
  'step-threshold': { meaning: c => `0 until ${c.h('x')} reaches ${c.h('e')}, then 1: a switch that turns on once ${c.h('x')} is ${highWord(c, 'e')}`, use: 'a hard on/off mask' },
  'mix': { meaning: c => (c.v('t') !== undefined ? `mostly ${(c.v('t') as number) < 0.5 ? c.h('a') : c.h('b')}, with a share of ${(c.v('t') as number) < 0.5 ? c.h('b') : c.h('a')} mixed in` : `${c.h('a')} when ${c.h('t')} is 0, ${c.h('b')} when it is 1, and a blend in between`), use: 'a crossfade' },
  'invert': { meaning: c => (c.role('x') === 'colour' ? `the photo negative of ${c.h('x')}` : `${c.h('x')} upside down: 1 where it was 0, 0 where it was 1`), use: 'flipping a mask' },
};
