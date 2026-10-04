/**
 * shapeRecipes.ts — starter recipes for 2D shapes (the SDF primitives and the SDF combiners)
 * and for the spaces that repeat or fold them (Tile, the Repeat nodes, Kaleidoscope, Polar).
 */
import type { RecipeContext, StarterRecipe } from './types';
import { SELF, col, colour, n, note, selfIn, selfOut } from './kit';

/** The input a 2D shape reads its position from. */
const posKey = (ctx: RecipeContext) => selfIn(ctx, ['position', 'p']) ?? 'position';
const distOf = (ctx: RecipeContext) => selfOut(ctx, 'float', ['distance', 'dist', 'result']);

/** Sizes that fit a shape inside a tile (−0.5…0.5), by shape. */
function tileSize(ctx: RecipeContext): Record<string, unknown> {
  switch (ctx.self.type) {
    case 'boxSDF': return { width: 0.28, height: 0.28 };
    case 'circleSDF': case 'ringSDF': return { radius: 0.3 };
    case 'shapeSDF': case 'simpleSDF': return { r: 0.3 };
    default: return {};
  }
}

const fillNode = (id: string, x: number, y: number, wires: Record<string, [string, string]>, why: string) =>
  n('sdfFill', id, x, y, { antialias: 0.006, ...note('SDF Fill: paints a distance field: Fill inside, black outside.', why) }, wires);

export const SDF_SHAPE_RECIPES: StarterRecipe[] = [
  {
    id: 'shape-fill',
    label: 'Filled, with an outline',
    description: 'SDF Fill paints the shape in a colour, with a thin outline in a second colour.',
    build: ctx => ({
      nodes: [
        colour('fillCol', col(1), 260, [0.95, 0.55, 0.25], 'Why: the inside of the shape (SDF Fill\'s Fill).'),
        colour('lineCol', col(1), 520, [1, 0.95, 0.85], 'Why: the outline (SDF Fill\'s Stroke).'),
        n('sdfFill', 'paint', col(2), 0, { strokeWidth: 0.02, antialias: 0.006, ...note(
          'SDF Fill: paints a distance field: Fill inside, Stroke along the edge, black outside.',
          'Why: a shape node only gives distances (negative inside); this turns them into a picture. Stroke Width sets the outline (0 for none).',
        ) }, { d: distOf(ctx), fillColor: ['fillCol', 'rgb'], strokeColor: ['lineCol', 'rgb'] }),
      ],
      show: ['paint', 'result'],
    }),
  },
  {
    id: 'shape-glow',
    label: 'Neon outline',
    description: 'Abs makes the distance count either side of the edge; SDF Glow turns that into a glowing tube along the outline.',
    build: ctx => ({
      nodes: [
        n('abs', 'edge', col(1), 0, note(
          'Abs: the distance to the edge, from inside or outside alike (a shape\'s distance is negative inside).',
          'Why: so the glow hugs the outline both ways instead of filling the inside with light.',
        ), { input: distOf(ctx) }),
        n('light', 'glow', col(2), 0, { mode: 'glow', brightness: 12, tint: [1, 0.35, 0.75], ...note(
          'SDF Glow: light that is brightest where the distance is 0 (the edge) and fades away from it. Tinted is the light times Tint.',
          'Why: the neon. Falloff sets how tight the tube is (lower for a wider halo); Tint its colour.',
        ) }, { distance: ['edge', 'output'] }),
      ],
      show: ['glow', 'tinted'],
    }),
  },
  {
    id: 'shape-tile',
    label: 'Repeated in a grid',
    description: 'A Tile node repeats the space, so the shape is drawn once in every tile.',
    build: ctx => ({
      params: tileSize(ctx),
      nodes: [
        n('uv', 'uv', col(-2), 0, note('UV: the position of each pixel, (0, 0) in the middle.')),
        n('fract', 'tile', col(-1), 0, { scale: 4, ...note(
          'Tile: repeats the space Scale times across, each tile centred on (0, 0).',
          'Why: wired into the shape\'s position, so the shape is drawn in every tile. Scale sets how many.',
        ) }, { input: ['uv', 'uv'] }),
        colour('fillCol', col(1), 260, [0.4, 0.8, 1], 'Why: the colour the shapes are painted with.'),
        fillNode('paint', col(2), 0, { d: distOf(ctx), fillColor: ['fillCol', 'rgb'] }, 'Why: turns the repeated shape into a picture.'),
      ],
      wire: { [posKey(ctx)]: ['tile', 'output'] },
      show: ['paint', 'result'],
    }),
  },
];

/** A circle into A and a box into B, overlapping, painted: what the combiner does is the picture. */
function twoShapes(id: string, label: string, description: string, what: string): StarterRecipe {
  return {
    id, label, description,
    build: () => ({
      params: { k: 0.12 },
      nodes: [
        n('circleSDF', 'a', col(-1), 0, { radius: 0.32, posX: -0.12, posY: 0.04, ...note('Circle SDF: the first shape (A).', 'Why: something to combine. Swap it for any shape.') }),
        n('boxSDF', 'b', col(-1), 300, { width: 0.24, height: 0.24, posX: 0.18, posY: -0.04, ...note('Box SDF: the second shape (B), overlapping the circle.', 'Why: something to combine with A. Move it with its Center X / Y.') }),
        colour('fillCol', col(1), 260, [0.55, 0.9, 0.6], 'Why: the colour the result is painted with.'),
        fillNode('paint', col(2), 0, { d: [SELF, 'dist'], fillColor: ['fillCol', 'rgb'] }, `Why: shows ${what}. K on the combiner rounds where the shapes meet.`),
      ],
      wire: { a: ['a', 'distance'], b: ['b', 'distance'] },
      show: ['paint', 'result'],
    }),
  };
}

export const SDF_COMBINE_RECIPES: Record<'union' | 'subtract' | 'intersect', StarterRecipe[]> = {
  union: [twoShapes('combine-union', 'Two shapes, melted together', 'A circle and a box go into A and B; a little smoothing (K) melts them into one shape, painted with SDF Fill.', 'the two shapes as one')],
  subtract: [twoShapes('combine-subtract', 'Cut a box out of a circle', 'A circle goes into A and a box into B; the box is cut away from the circle (K rounds the cut), painted with SDF Fill.', 'the circle with the box cut out')],
  intersect: [twoShapes('combine-intersect', 'Where two shapes overlap', 'A circle goes into A and a box into B; only the part inside both is kept, painted with SDF Fill.', 'only the overlap')],
};

export const TILE_RECIPES: StarterRecipe[] = [
  {
    id: 'tile-shape',
    label: 'A shape in every tile',
    description: 'A Circle SDF drawn in the tiled space appears once per tile, painted with SDF Fill.',
    build: ctx => {
      const small = ctx.self.type !== 'fract';
      return {
        params: small ? { cellX: 0.4, cellY: 0.4 } : { scale: 5 },
        nodes: [
          n('uv', 'uv', col(-1), 0, note('UV: the position of each pixel, (0, 0) in the middle.', 'Why: the space being repeated.')),
          n('circleSDF', 'dot', col(1), 0, { radius: small ? 0.13 : 0.3, ...note(
            'Circle SDF: a circle around (0, 0).',
            'Why: it reads the repeated space, so there is one circle per tile.',
          ) }, { position: selfOut(ctx, 'vec2', ['output']) }),
          colour('fillCol', col(1), 300, [1, 0.8, 0.35], 'Why: the colour the circles are painted with.'),
          fillNode('paint', col(2), 0, { d: ['dot', 'distance'], fillColor: ['fillCol', 'rgb'] }, 'Why: turns the circles into a picture.'),
        ],
        wire: { input: ['uv', 'uv'] },
        show: ['paint', 'result'],
      };
    },
  },
];

export const REPEAT_RECIPES: StarterRecipe[] = [
  TILE_RECIPES[0],
  {
    id: 'tile-per-cell',
    label: 'Per-tile variation',
    description: 'Each tile\'s Cell ID gives it a random number that sets its circle\'s size and colour.',
    build: ctx => ({
      params: ctx.self.type === 'limitedRepeat2D' ? { cellX: 0.3, cellY: 0.3, countX: 8, countY: 5 } : { cellX: 0.3, cellY: 0.3 },
      nodes: [
        n('uv', 'uv', col(-1), 0, note('UV: the position of each pixel, (0, 0) in the middle.', 'Why: the space being repeated.')),
        n('noiseFloat', 'rand', col(1), 300, { mode: 'hash', scale: 1, speed: 0, outMin: 0.03, outMax: 0.12, ...note(
          'Noise Float (Hash): turns each tile\'s Cell ID into its own random number.',
          'Why: one number per tile, used below as the circle\'s radius and colour.',
        ) }, { uv: [SELF, 'cellID'] }),
        n('circleSDF', 'dot', col(2), 0, note('Circle SDF: one circle per tile, its radius from the random number.'),
          { position: [SELF, 'output'], radius: ['rand', 'value'] }),
        n('palette', 'hue', col(2), 300, { preset: '1', scale: 9, ...note('Palette: the random number as a colour.') }, { value: ['rand', 'value'] }),
        fillNode('paint', col(3), 0, { d: ['dot', 'distance'], fillColor: ['hue', 'color'] }, 'Why: paints each circle in its own colour.'),
      ],
      wire: { input: ['uv', 'uv'] },
      show: ['paint', 'result'],
    }),
  },
];

export const KALEIDO_RECIPES: StarterRecipe[] = [
  {
    id: 'kaleido-noise',
    label: 'Kaleidoscope of noise',
    description: 'Noise read through the folded space becomes a slowly turning mandala.',
    build: () => ({
      params: { segments: 8 },
      nodes: [
        n('uv', 'uv', col(-2), 0, note('UV: the position of each pixel, (0, 0) in the middle.', 'Why: the space the kaleidoscope folds.')),
        n('time', 'time', col(-2), 260, note('Time: seconds since the start.', 'Why: turns the kaleidoscope and moves the noise.')),
        n('multiply', 'slow', col(-1), 260, { b: 0.1, ...note('Multiply: Time × 0.1, a slow angle.', 'Why: wired into Rotate, so the mandala turns slowly.') }, { a: ['time', 'time'] }),
        n('fbm', 'noise', col(1), 0, { scale: 2.5, time_scale: 0.2, ...note(
          'Fractal Noise: soft cloudy values.',
          'Why: it reads the folded space, so the clouds are mirrored into every wedge.',
        ) }, { uv: [SELF, 'output'], time: ['time', 'time'] }),
        n('palette', 'hue', col(2), 0, { preset: '2', scale: 1.6, ...note('Palette: the noise as colour.') }, { value: ['noise', 'value'] }),
      ],
      wire: { input: ['uv', 'uv'], rotate: ['slow', 'result'] },
      show: ['hue', 'color'],
    }),
  },
  {
    id: 'kaleido-dots',
    label: 'Mandala of dots',
    description: 'One glowing dot off-centre, mirrored into every wedge: a ring of lights.',
    build: () => ({
      params: { segments: 10 },
      nodes: [
        n('uv', 'uv', col(-1), 0, note('UV: the position of each pixel, (0, 0) in the middle.', 'Why: the space the kaleidoscope folds.')),
        n('circleSDF', 'dot', col(1), 0, { radius: 0.06, posX: 0.5, posY: 0.08, ...note(
          'Circle SDF: one small circle, off-centre.',
          'Why: it reads the folded space, so it is repeated in every wedge. Move its X / Y for other mandalas.',
        ) }, { position: [SELF, 'output'] }),
        n('light', 'glow', col(2), 0, { mode: 'glow', brightness: 12, tint: [1, 0.7, 0.3], ...note('SDF Glow: lights up the dots.') }, { distance: ['dot', 'distance'] }),
      ],
      wire: { input: ['uv', 'uv'] },
      show: ['glow', 'tinted'],
    }),
  },
];

export const POLAR_RECIPES: StarterRecipe[] = [
  {
    id: 'polar-spiral',
    label: 'Spiral stripes',
    description: 'Stripes read in polar space wrap round the centre; Twist bends them into a spiral that turns with Time.',
    build: () => ({
      params: { twist: 2 },
      nodes: [
        n('uv', 'uv', col(-1), 0, note('UV: the position of each pixel, (0, 0) in the middle.', 'Why: what Polar Space turns into (angle, radius).')),
        n('time', 'time', col(1), 300, note('Time: seconds since the start.', 'Why: makes the stripes move.')),
        n('waveTexture', 'stripes', col(1), 0, { mode: 'x', scale: 18.8496, speed: 0.6, ...note(
          'Wave Texture: straight stripes across X.',
          'Why: it reads polar space, where X is the angle, so the stripes become rays round the centre and Twist curls them into a spiral. Scale is 2π × 3, so three arms meet up all the way round (keep it a multiple of 6.2832 to avoid a seam).',
        ) }, { uv: [SELF, 'output'], time: ['time', 'time'] }),
        n('palette', 'hue', col(2), 0, { preset: '3', scale: 0.8, ...note('Palette: the stripes as colour.') }, { value: ['stripes', 'value'] }),
      ],
      wire: { input: ['uv', 'uv'] },
      show: ['hue', 'color'],
    }),
  },
];
