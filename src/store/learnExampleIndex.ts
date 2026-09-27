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

// [key, title, description], in learning order. The number comes from the position.
const ROWS: Array<[string, string, string]> = [
  // Getting started (chapters 2–3)
  ['learnColour',      'Hello colour',                  'A shader is one small program run for every pixel. The smallest one: a Colour into the Output.'],
  ['learnTime',        'Uniforms: time',                'Time is the same for every pixel and keeps rising. Bend it with Sin and use it to blend two colours.'],
  ['learnUV',          'Where am I? st',                'Pixel position ÷ canvas size gives st, 0 to 1 across the screen. Paint it as red and green to see it.'],
  // Shaping functions (chapter 5)
  ['learnPlot',        'Plot a function',               'Each pixel feeds its x into a function; the value is the brightness and a green line marks where it equals y.'],
  ['learnPow',         'Pow and friends',               'Pow bends a straight line into an ease-in or ease-out curve while 0 and 1 stay put. Square root is the exponent 0.5.'],
  ['learnStep',        'Step and smoothstep',           'Step switches from 0 to 1 at a threshold; smoothstep ramps between two edges along an S-curve.'],
  ['learnSinCos',      'Sin and cos',                   'Waves that swing forever: frequency, amplitude, and Time added to x to make them travel.'],
  ['learnFractFloor',  'Fract and floor',               'Floor keeps the whole part (a staircase), fract the rest (a sawtooth): the two halves of every repeat.'],
  ['learnShapers',     'Shaping functions by hand',     'Golan Levin\'s exponential sigmoid (a Shapers node) and Inigo Quilez\'s impulse (an Expression Block), plotted.'],
  // Colours (chapter 6)
  ['learnGradient',    'Mix and gradients',             'Mix blends two colours; give red, green and blue their own shaping curve and the gradient takes a shape.'],
  ['learnHSB',         'HSB colour',                    'Hue across the screen, brightness up it: HSB converted to RGB shows the whole spectrum.'],
  ['learnColorWheel',  'Polar colour wheel',            'Angle as hue, distance as saturation: a spinning colour wheel from polar coordinates.'],
  // Shapes (chapter 7)
  ['learnRect',        'Rectangle from step',           'Past the margin on the left AND bottom AND right AND top: four smoothsteps multiplied make a rectangle.'],
  ['learnCircle',      'Circle from distance',          'Distance from the centre is a cone; everything nearer than the radius is the circle.'],
  ['learnDistanceField','Distance fields',              'Every pixel\'s distance to a box, drawn as contour rings: the field has a value everywhere, not only on the edge.'],
  ['learnPolar',       'Polar shapes',                  'Let the radius depend on the angle and the circle becomes a flower, a star or a gear.'],
  ['learnPolygon',     'Polygons: polar + distance',    'One formula in an Expression Block draws any regular polygon, with polygonal contour rings.'],
  ['learnCombine',     'Combining shapes',              'Union is the min of two distance fields; its k blends them like putty as the circle swings through the box.'],
  // Matrices (chapter 8)
  ['learnTranslate',   'Translate: move the space',     'Subtract an offset from the coordinates and the cross appears at the offset. Here it circles the centre.'],
  ['learnRotate',      'Rotate with a matrix',          'A Rotation Matrix times the UV turns the whole space, so the cross spins.'],
  ['learnScale',       'Scale with a matrix',           'A Scale Matrix stretches the space: scale up and the shape shrinks. The cross breathes.'],
  ['learnTransform',   'Move, turn, scale in one node', 'UV Transform 2D does all three as one matrix before the SDF, so the box spins.'],
  ['learnYUV',         'YUV: a matrix on colour',       'A 3×3 matrix turns YUV (brightness plus two colour differences) into RGB.'],
  // Patterns (chapter 9)
  ['learnTiling',      'Tiling',                        'Tile repeats the coordinates, so one circle becomes many. Everything after it happens in every tile.'],
  ['learnTileRotate',  'Transforms inside the tiles',   'A rotation after Tile turns every tile round its own centre: a grid of spinning squares.'],
  ['learnBricks',      'Offset patterns: bricks',       'Mod and step find the odd rows; sliding them half a brick makes a brick wall.'],
  ['learnTruchet',     'Truchet tiles',                 'One triangle, turned four ways by its place in the grid, makes diamonds and zigzags.'],
  // Random (chapter 10)
  ['learnRandom',      'Random from a sine',            'fract(sin(x) × a big number): raise the multiplier and a wave dissolves into noise.'],
  ['learnRandomGrid',  'Random cells',                  'A hash of the floored position gives every cell its own random value: a mosaic, or static when the cells are tiny.'],
  ['learnMaze',        'A random maze (10 PRINT)',      'Each cell tosses a coin and draws one diagonal or the other; a maze appears.'],
  // Noise (chapter 11)
  ['learnNoise1D',     'Smooth random: 1D noise',       'Random values at whole numbers, blended with a smooth curve in between: noise, plotted.'],
  ['learnNoise',       '2D noise',                      'Value noise in 2D, moved through time and coloured by Colorize.'],
  ['learnWood',        'Noise at work: wood grain',     'Turn every point by a noise angle before drawing stripes and they bend into wood grain.'],
  // Cellular noise (chapter 12)
  ['learnCellDistance','Distance to the nearest point', 'Distance to the nearest of four points (one is the mouse): circles that meet in creases, the cells of cellular noise.'],
  ['learnVoronoi',     'Cellular noise',                'One random point per tile, checked against the nine nearest tiles: Worley noise at any density.'],
  // Fractal Brownian motion (chapter 13)
  ['learnOctaves',     'Octaves: fractal noise',        'Layers of noise, each finer and weaker, added up: a mountain-range line.'],
  ['learnFBM',         'Fractal noise (FBM) in 2D',     'Octaves of noise stacked at doubling frequencies give clouds and terrain. Palette colours the height.'],
  ['learnTurbulence',  'Turbulence and ridges',         'Four octaves built by hand with abs on each: sharp creases, flipped into glowing ridges.'],
  ['learnWarp',        'Domain warp',                   'Feed noise-warped coordinates into noise: the classic marbled, flowing look.'],
  // Fractals (chapter 14)
  ['learnFractal',     'Fractals: the Mandelbrot set',  'z = z² + c repeated for every pixel; zoom into the edge and it never runs out of detail.'],
  ['learnLoop',        'A fractal by hand: Loop Carry', 'A group that runs four times, folding the UV it carries from one pass to the next; += sums the colour.'],
  // An extra: the Book's 3D chapters aren't written yet.
  ['learnRaymarch',    'Extra: first ray march',        'Into 3D: a camera shoots a ray per pixel, the March Loop Group walks it to the scene, the normal becomes colour.'],
];

const num = (i: number) => String(i + 1).padStart(2, '0');

export const LEARN_EXAMPLE_KEYS: string[] = ROWS.map(r => r[0]);

export const LEARN_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = Object.fromEntries(
  ROWS.map(([key, title, description], i) => [key, { label: `${num(i)} · ${title}`, description, play: true as const }]),
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
