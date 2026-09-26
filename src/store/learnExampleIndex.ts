/**
 * learnExampleIndex.ts — names and one-line descriptions for the Learn folder:
 * a Book of Shaders-style course in graphs, in the order you would learn it.
 * Kept apart from the graphs themselves (learnExamples.ts) so the examples
 * browser can list them without loading every graph up front.
 */

// [key, title, description], in learning order. The number comes from the position.
const ROWS: Array<[string, string, string]> = [
  ['learnColour',   'Hello colour',               'A shader is one small program run for every pixel. The smallest one: a Colour into the Output.'],
  ['learnUV',       'UV: where am I?',            'Every pixel knows its position. Paint the UV as red and green to see the coordinate system.'],
  ['learnTime',     'Time',                       'Time is a number that keeps rising. Bend it with Sin and use it to blend two colours.'],
  ['learnShaping',  'Shaping functions',          'A curve turns one number into another. Plot a shaper across the screen and see its shape.'],
  ['learnShape',    'Your first shape',           'A distance field: Circle SDF measures how far each pixel is from the edge; SDF Fill paints it.'],
  ['learnDistance', 'Distance is a number',       'The same distance through SDF Glow instead of a fill: the field itself becomes light.'],
  ['learnCombine',  'Combining shapes',           'Union joins two distance fields; its k blends them like putty as the circle swings through the box.'],
  ['learnTransform','Move, turn, scale',          'Transform the coordinates, not the shape: UV Transform 2D before the SDF spins the whole picture.'],
  ['learnPalette',  'Palettes',                   'A cosine palette turns one number into a colour ramp. Distance from the centre picks the colour.'],
  ['learnTiling',   'Tiling',                     'Tile repeats the coordinates, so one circle becomes many. Everything after it happens in every tile.'],
  ['learnGrid',     'Grids and Cell ID',          'Grid gives each cell its own coordinates and an ID; hash the ID for per-cell size and colour.'],
  ['learnGridPattern','Grid Pattern',             'The grid recipe in one node: a shape in every cell, a placement pattern, and the mouse growing the shapes near it.'],
  ['learnGridSpread','Effects across the grid',   'Influence spreads out from a point: shapes are pulled toward the mouse and coloured by how near they are.'],
  ['learnNoise',    'Random and noise',           'Hash is static; value noise is smooth. Noise Float scaled and moved through time, coloured by Colorize.'],
  ['learnFBM',      'Fractal noise (FBM)',        'Octaves of noise stacked at doubling frequencies give clouds and terrain. Palette colours the height.'],
  ['learnWarp',     'Domain warp',                'Feed noise-warped coordinates into noise: the classic marbled, flowing look.'],
  ['learnLoop',     'Iterated groups: Loop Carry','A group that runs four times. Loop Carry passes the folded UV from one pass to the next; += sums the colour.'],
  ['learnRaymarch', 'First ray march',            'Into 3D: a camera shoots a ray per pixel, the March Loop Group walks it to the scene, the normal becomes colour.'],
];

const num = (i: number) => String(i + 1).padStart(2, '0');

export const LEARN_EXAMPLE_KEYS: string[] = ROWS.map(r => r[0]);

export const LEARN_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = Object.fromEntries(
  ROWS.map(([key, title, description], i) => [key, { label: `${num(i)} · ${title}`, description, play: true as const }]),
);
