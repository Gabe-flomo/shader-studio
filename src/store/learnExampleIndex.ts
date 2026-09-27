/**
 * learnExampleIndex.ts — names and one-line descriptions for the Learn folder:
 * The Book of Shaders (https://thebookofshaders.com/) as graphs, chapter by
 * chapter in the Book's order, one idea per lesson. Kept apart from the graphs
 * themselves (learnExamples.ts) so the examples browser can list them without
 * loading every graph up front.
 *
 * Also the earlier Learn lessons that teach something the Book doesn't: they
 * keep their keys and live in the folders they fit (LEARN_MOVED_INDEX).
 */

import type { SourceCredit } from '../types/credit';

/** The Book's chapters, as its pages title them. */
const CHAPTERS: Record<number, string> = {
  2: 'Hello World', 3: 'Uniforms', 5: 'Shaping functions', 6: 'Colors', 7: 'Shapes', 8: '2D Matrices',
  9: 'Patterns', 10: 'Random', 11: 'Noise', 12: 'Cellular Noise', 13: 'Fractal Brownian Motion', 14: 'Fractals',
};

/**
 * Where a lesson is in the Book: its chapter, and the heading inside it the
 * lesson follows when the chapter has one for it (the Book's pages have no
 * anchors, so the address is the chapter's).
 */
export function bookSource(chapter: number, section?: string): SourceCredit {
  const chapterTitle = CHAPTERS[chapter];
  if (!chapterTitle) throw new Error(`learnExampleIndex: no chapter ${chapter} in the Book`);
  return {
    title: 'The Book of Shaders', author: 'Patricio Gonzalez Vivo and Jen Lowe',
    url: `https://thebookofshaders.com/${String(chapter).padStart(2, '0')}/`,
    chapter, chapterTitle, ...(section ? { section } : {}),
  };
}

type Where = [chapter: number, section?: string];

// [key, title, description, where in the Book], in learning order. The number comes from the position.
// The section is the Book's own heading, spelled as it spells it.
const ROWS: Array<[string, string, string, Where?]> = [
  // Getting started (chapters 2–3)
  ['learnColour',      'Hello colour',                  'A shader is one small program run for every pixel. The smallest one: a Colour into the Output.', [2]],
  ['learnTime',        'Uniforms: time',                'Time is the same for every pixel and keeps rising. Bend it with Sin and use it to blend two colours.', [3]],
  ['learnUV',          'Where am I? st',                'Pixel position ÷ canvas size gives st, 0 to 1 across the screen. Paint it as red and green to see it.', [3, 'gl_FragCoord']],
  // Shaping functions (chapter 5)
  ['learnPlot',        'Plot a function',               'Each pixel feeds its x into a function; the value is the brightness and a green line marks where it equals y.', [5]],
  ['learnPow',         'Pow and friends',               'Pow bends a straight line into an ease-in or ease-out curve while 0 and 1 stay put. Square root is the exponent 0.5.', [5]],
  ['learnStep',        'Step and smoothstep',           'Step switches from 0 to 1 at a threshold; smoothstep ramps between two edges along an S-curve.', [5, 'Step and Smoothstep']],
  ['learnSinCos',      'Sin and cos',                   'Waves that swing forever: frequency, amplitude, and Time added to x to make them travel.', [5, 'Sine and Cosine']],
  ['learnFractFloor',  'Fract and floor',               'Floor keeps the whole part (a staircase), fract the rest (a sawtooth): the two halves of every repeat.', [5, 'Some extra useful functions']],
  ['learnShapers',     'Shaping functions by hand',     'Golan Levin\'s exponential sigmoid (a Shapers node) and Inigo Quilez\'s impulse (an Expression Block), plotted.', [5, 'Advance shaping functions']],
  // Colours (chapter 6)
  ['learnGradient',    'Mix and gradients',             'Mix blends two colours; give red, green and blue their own shaping curve and the gradient takes a shape.', [6, 'Playing with gradients']],
  ['learnHSB',         'HSB colour',                    'Hue across the screen, brightness up it: HSB converted to RGB shows the whole spectrum.', [6, 'HSB']],
  ['learnColorWheel',  'Polar colour wheel',            'Angle as hue, distance as saturation: a spinning colour wheel from polar coordinates.', [6, 'HSB in polar coordinates']],
  // Shapes (chapter 7)
  ['learnRect',        'Rectangle from step',           'Past the margin on the left AND bottom AND right AND top: four smoothsteps multiplied make a rectangle.', [7, 'Rectangle']],
  ['learnCircle',      'Circle from distance',          'Distance from the centre is a cone; everything nearer than the radius is the circle.', [7, 'Circles']],
  ['learnDistanceField','Distance fields',              'Every pixel\'s distance to a box, drawn as contour rings: the field has a value everywhere, not only on the edge.', [7, 'Distance field']],
  ['learnPolar',       'Polar shapes',                  'Let the radius depend on the angle and the circle becomes a flower, a star or a gear.', [7, 'Polar shapes']],
  ['learnPolygon',     'Polygons: polar + distance',    'One formula in an Expression Block draws any regular polygon, with polygonal contour rings.', [7, 'Combining powers']],
  ['learnCombine',     'Combining shapes',              'Union is the min of two distance fields; its k blends them like putty as the circle swings through the box.', [7, 'Combining powers']],
  // Matrices (chapter 8)
  ['learnTranslate',   'Translate: move the space',     'Subtract an offset from the coordinates and the cross appears at the offset. Here it circles the centre.', [8, 'Translate']],
  ['learnRotate',      'Rotate with a matrix',          'A Rotation Matrix times the UV turns the whole space, so the cross spins.', [8, 'Rotations']],
  ['learnScale',       'Scale with a matrix',           'A Scale Matrix stretches the space: scale up and the shape shrinks. The cross breathes.', [8, 'Scale']],
  ['learnTransform',   'Move, turn, scale in one node', 'UV Transform 2D does all three as one matrix before the SDF, so the box spins.', [8]],
  ['learnYUV',         'YUV: a matrix on colour',       'A 3×3 matrix turns YUV (brightness plus two colour differences) into RGB.', [8, 'Other uses for matrices: YUV color']],
  // Patterns (chapter 9)
  ['learnTiling',      'Tiling',                        'Tile repeats the coordinates, so one circle becomes many. Everything after it happens in every tile.', [9]],
  ['learnTileRotate',  'Transforms inside the tiles',   'A rotation after Tile turns every tile round its own centre: a grid of spinning squares.', [9, 'Apply matrices inside patterns']],
  ['learnBricks',      'Offset patterns: bricks',       'Mod and step find the odd rows; sliding them half a brick makes a brick wall.', [9, 'Offset patterns']],
  ['learnTruchet',     'Truchet tiles',                 'One triangle, turned four ways by its place in the grid, makes diamonds and zigzags.', [9, 'Truchet Tiles']],
  // Random (chapter 10)
  ['learnRandom',      'Random from a sine',            'fract(sin(x) × a big number): raise the multiplier and a wave dissolves into noise.', [10, 'Controlling chaos']],
  ['learnRandomGrid',  'Random cells',                  'A hash of the floored position gives every cell its own random value: a mosaic, or static when the cells are tiny.', [10, '2D Random']],
  ['learnMaze',        'A random maze (10 PRINT)',      'Each cell tosses a coin and draws one diagonal or the other; a maze appears.', [10, 'Using the chaos']],
  // Noise (chapter 11)
  ['learnNoise1D',     'Smooth random: 1D noise',       'Random values at whole numbers, blended with a smooth curve in between: noise, plotted.', [11]],
  ['learnNoise',       '2D noise',                      'Value noise in 2D, moved through time and coloured by Colorize.', [11, '2D Noise']],
  ['learnWood',        'Noise at work: wood grain',     'Turn every point by a noise angle before drawing stripes and they bend into wood grain.', [11, 'Using Noise in Generative Designs']],
  // Cellular noise (chapter 12)
  ['learnCellDistance','Distance to the nearest point', 'Distance to the nearest of four points (one is the mouse): circles that meet in creases, the cells of cellular noise.', [12, 'Points for a distance field']],
  ['learnVoronoi',     'Cellular noise',                'One random point per tile, checked against the nine nearest tiles: Worley noise at any density.', [12, 'Tiling and iteration']],
  // Fractal Brownian motion (chapter 13)
  ['learnOctaves',     'Octaves: fractal noise',        'Layers of noise, each finer and weaker, added up: a mountain-range line.', [13]],
  ['learnFBM',         'Fractal noise (FBM) in 2D',     'Octaves of noise stacked at doubling frequencies give clouds and terrain. Palette colours the height.', [13]],
  ['learnTurbulence',  'Turbulence and ridges',         'Four octaves built by hand with abs on each: sharp creases, flipped into glowing ridges.', [13]],
  ['learnWarp',        'Domain warp',                   'Feed noise-warped coordinates into noise: the classic marbled, flowing look.', [13, 'Domain Warping']],
  // Fractals (chapter 14)
  ['learnFractal',     'Fractals: the Mandelbrot set',  'z = z² + c repeated for every pixel; zoom into the edge and it never runs out of detail.', [14]],
  ['learnLoop',        'A fractal by hand: Loop Carry', 'A group that runs four times, folding the UV it carries from one pass to the next; += sums the colour.', [14]],
  // An extra: the Book's 3D chapters aren't written yet.
  ['learnRaymarch',    'Extra: first ray march',        'Into 3D: a camera shoots a ray per pixel, the March Loop Group walks it to the scene, the normal becomes colour.'],
];

const num = (i: number) => String(i + 1).padStart(2, '0');

export const LEARN_EXAMPLE_KEYS: string[] = ROWS.map(r => r[0]);

type LearnEntry = { label: string; description: string; play: true; source?: SourceCredit };

export const LEARN_EXAMPLE_INDEX: Record<string, LearnEntry> = Object.fromEntries(
  ROWS.map(([key, title, description, where], i) => [key, {
    label: `${num(i)} · ${title}`, description, play: true as const,
    ...(where ? { source: bookSource(...where) } : {}),
  }]),
);

/** Earlier Learn lessons that teach something the Book doesn't, in the folders they fit (exampleIndex.ts). */
export const LEARN_MOVED_INDEX: Record<string, { label: string; description: string; play: true }> = {
  learnShaping:     { label: 'Bezier shaping curve', play: true, description: 'x goes through a Cubic Bezier shaper and every pixel below the curve is painted, so the boundary is the curve. Four handles on the Play page.' },
  learnShape:       { label: 'SDF: Circle SDF + SDF Fill', play: true, description: 'A distance field: Circle SDF measures how far each pixel is from the edge; SDF Fill paints it with a fill and a stroke.' },
  learnDistance:    { label: 'SDF: distance as light', play: true, description: 'The same distance through SDF Glow instead of a fill: the field itself becomes light.' },
  learnPalette:     { label: 'Cosine palettes', play: true, description: 'A cosine palette turns one number into a colour ramp. Distance from the centre picks the colour.' },
  learnGrid:        { label: 'Grid: Cell ID and hash', play: true, description: 'Grid gives each cell its own coordinates and an ID; hash the ID for per-cell size and colour.' },
  learnGridPattern: { label: 'Grid: Grid Pattern and the mouse', play: true, description: 'The grid recipe in one node: a shape in every cell, a placement pattern, and the mouse growing the shapes near it.' },
  learnGridSpread:  { label: 'Grid: Effects across the grid', play: true, description: 'Influence spreads out from a point: shapes are pulled toward the mouse and coloured by how near they are.' },
};

/** Which folder each moved lesson lives in. */
export const LEARN_CURVES_KEYS = ['learnShaping', 'learnShape', 'learnDistance'];
export const LEARN_COLOR_KEYS = ['learnPalette'];
export const LEARN_GRID_KEYS = ['learnGrid', 'learnGridPattern', 'learnGridSpread'];
