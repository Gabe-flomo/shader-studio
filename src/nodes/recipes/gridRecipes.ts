/**
 * gridRecipes.ts — starter recipes for the Grid node and Grid Pattern (docs/starter-recipes.md).
 */
import type { StarterRecipe } from './types';
import { SELF, col, colour, n, note } from './kit';

const BG: [number, number, number] = [0.05, 0.05, 0.08];

export const GRID_RECIPES: StarterRecipe[] = [
  {
    id: 'grid-no-clip',
    label: 'Shapes don\'t clip',
    description: 'Neighbour Dist measures to the dots in the cells around too, so a dot that wanders over its cell edge stays round. Painted with SDF Fill.',
    build: () => ({
      params: { columns: 12, ...note('Grid: cuts the picture into cells. Cell UV is the position inside a cell, Cell ID which cell it is.') },
      nodes: [
        n('neighborDist', 'near', col(1), 0, { dispScale: 0.45, ...note(
          'Neighbour Dist: the distance to the nearest dot, looking in this cell and the 8 around it. Each dot is nudged by its own random amount (Disp Scale).',
          'Why: a shape drawn from Cell UV alone is cut off at its cell\'s edge. Looking at the neighbours too keeps dots whole when they cross into the next cell.',
        ) }, { uv: [SELF, 'cellUV'], cellID: [SELF, 'cellID'] }),
        n('sdfOffset', 'size', col(2), 0, { amount: -0.42, ...note(
          'Offset: shrinks or grows a distance field. Amount −0.42 turns "distance to the dot" into a circle of radius 0.42 (in cells).',
          'Why: this is the shape. Make Amount more negative for bigger dots: they overlap their neighbours without being clipped.',
        ) }, { sdf: ['near', 'minDist'] }),
        colour('ink', col(2), 300, [0.98, 0.78, 0.42], 'The colour of the dots.'),
        n('sdfFill', 'paint', col(3), 0, { antialias: 0.01, ...note(
          'SDF Fill: paints the shape: Fill inside, black outside.',
          'Why: a distance field is only numbers; this turns it into a picture for the Output.',
        ) }, { d: ['size', 'result'], fillColor: ['ink', 'rgb'] }),
      ],
      show: ['paint', 'result'],
    }),
  },
  {
    id: 'grid-per-cell',
    label: 'Per-cell variation',
    description: 'A random number per cell (Cell ID → hash) sets each circle\'s size and colour.',
    build: () => ({
      params: { columns: 14, ...note('Grid: cuts the picture into cells. Cell UV is the position inside a cell, Cell ID which cell it is.') },
      nodes: [
        n('noiseFloat', 'rand', col(1), 260, { mode: 'hash', scale: 1, speed: 0, outMin: 0.12, outMax: 0.44, ...note(
          'Noise Float (Hash): turns each Cell ID into its own random number, the same all over the cell. Out Min / Max make it a radius directly.',
          'Why: one number per cell is all it takes to vary every cell differently.',
        ) }, { uv: [SELF, 'cellID'] }),
        n('circleSDF', 'dot', col(2), 0, { ...note(
          'Circle SDF: a circle in every cell, drawn in Cell UV (each cell\'s own coordinates).',
          'Why: the shape. Its Radius comes from the random number, so each cell gets its own size.',
        ) }, { position: [SELF, 'cellUV'], radius: ['rand', 'value'] }),
        n('palette', 'hue', col(2), 320, { preset: '1', scale: 3, ...note(
          'Palette: the same random number as a colour.',
          'Why: size and colour vary together. Change Preset for another set of colours.',
        ) }, { value: ['rand', 'value'] }),
        n('sdfFill', 'paint', col(3), 0, { antialias: 0.01, ...note('SDF Fill: paints each circle with its colour, black between them.') },
          { d: ['dot', 'distance'], fillColor: ['hue', 'color'] }),
      ],
      show: ['paint', 'result'],
    }),
  },
  {
    id: 'grid-wave',
    label: 'A wave across the cells',
    description: 'Each cell\'s distance from the centre plus Time makes a wave (Wave Radius) that rolls outward, setting dot size and colour.',
    build: () => ({
      params: { columns: 20, ...note('Grid: cuts the picture into cells. Dist to Center says how far each cell is from the middle.') },
      nodes: [
        n('waveRadius', 'wave', col(1), 260, { speed: 1, freq: 1.4, amp: 0.18, base: 0.24, ...note(
          'Wave Radius: a sine of (distance − time), so a ripple rolls outward from the centre, one ring after another.',
          'Why: every cell reads its own distance, so together they draw a wave much bigger than a cell. Speed, Frequency and Amplitude shape it.',
        ) }, { distance: [SELF, 'dist_to_center'] }),
        n('circleSDF', 'dot', col(2), 0, { ...note(
          'Circle SDF: a circle in every cell (drawn in Cell UV) whose radius is the wave at that cell.',
          'Why: the dots swell and shrink as the wave passes.',
        ) }, { position: [SELF, 'cellUV'], radius: ['wave', 'wave_radius'] }),
        n('palette', 'hue', col(2), 320, { preset: '4', scale: 2.2, ...note('Palette: the wave as a colour, so crests and troughs differ in hue as well as size.') }, { value: ['wave', 'wave_radius'] }),
        n('sdfFill', 'paint', col(3), 0, { antialias: 0.01, ...note('SDF Fill: paints the circles with their colour, black between them.') },
          { d: ['dot', 'distance'], fillColor: ['hue', 'color'] }),
      ],
      show: ['paint', 'result'],
    }),
  },
];

export const GRID_PATTERN_RECIPES: StarterRecipe[] = [
  {
    id: 'pattern-mouse',
    label: 'The mouse grows the shapes',
    description: 'Wires the Mouse into Affect Pos and sets Affect to Grow, with Overflow on so grown shapes aren\'t clipped.',
    build: () => ({
      params: { columns: 18, affect: 'grow', affectRadius: 0.8, affectSoftness: 0.8, affectAmount: 1.2, overflow: 'neighbours', background: BG, ...note(
        'Grid Pattern: a shape in every cell. Affect: Grow makes the shapes near Affect Pos bigger; Overflow: Neighbours keeps the grown ones whole across cell edges.',
      ) },
      nodes: [
        n('mouse', 'mouse', col(-1), 260, note(
          'Mouse: where the pointer is over the picture.',
          'Why: wired into Affect Pos, so the shapes near the pointer grow.',
        )),
      ],
      wire: { affectPos: ['mouse', 'uv'] },
      show: [SELF, 'color'],
    }),
  },
  {
    id: 'pattern-colours',
    label: 'Per-cell colours',
    description: 'A Cell node gives each cell its ID; a hash of it picks a colour from a Palette for that cell\'s shape.',
    build: () => ({
      params: { columns: 16, affect: 'none', background: BG },
      nodes: [
        n('fieldCell', 'cell', col(-3), 260, note(
          'Cell: inside a chain wired into Grid Pattern, this is the cell being drawn (its Cell ID).',
          'Why: the colour below is worked out per cell from it.',
        )),
        n('noiseFloat', 'rand', col(-2), 260, { mode: 'hash', scale: 1, speed: 0, ...note('Noise Float (Hash): one random number per Cell ID.') }, { uv: ['cell', 'cellID'] }),
        n('palette', 'hue', col(-1), 260, { preset: '1', scale: 3, ...note(
          'Palette: the random number as a colour.',
          'Why: wired into Grid Pattern\'s Picture, so each cell\'s shape gets its own colour. Change Preset for another set.',
        ) }, { value: ['rand', 'value'] }),
        n('circleSDF', 'dot', col(-1), 0, { radius: 0.38, ...note(
          'Circle SDF: the shape in every cell (its UV is the cell\'s own coordinates).',
          'Why: wired into Shape, so the colour fills a circle. Without a Shape, the Picture fills the whole cell (a mosaic).',
        ) }),
      ],
      wire: { picture: ['hue', 'color'], shape: ['dot', 'distance'] },
      show: [SELF, 'color'],
    }),
  },
  {
    id: 'pattern-wave',
    label: 'A wave across the cells',
    description: 'Each cell\'s distance from the centre plus Time sets its circle\'s size and colour: rings roll outward.',
    build: () => ({
      params: { columns: 30, pattern: 'all', affect: 'none', background: BG },
      nodes: [
        n('fieldCell', 'cell', col(-4), 0, note('Cell: the cell being drawn. Its Cell ID counts columns and rows from the middle.')),
        n('length', 'far', col(-3), 0, { scale: 0.6, ...note(
          'Length: how far this cell is from the centre, in cells. Scale sets the ring spacing.',
        ) }, { input: ['cell', 'cellID'] }),
        n('waveRadius', 'wave', col(-2), 0, { speed: 1.2, freq: 2, amp: 0.2, base: 0.25, ...note(
          'Wave Radius: a sine of (distance − time), so rings roll outward. It is the circle\'s radius.',
          'Why: every cell computes the same wave from its own distance, so together they draw ripples across the whole grid.',
        ) }, { distance: ['far', 'output'] }),
        n('circleSDF', 'dot', col(-1), 0, note('Circle SDF: the shape drawn in every cell (its UV is the cell\'s own coordinates), sized by the wave.'),
          { radius: ['wave', 'wave_radius'] }),
        n('palette', 'hue', col(-1), 300, { preset: '4', scale: 2.2, ...note('Palette: the wave as a colour, wired into Picture.') }, { value: ['wave', 'wave_radius'] }),
      ],
      wire: { shape: ['dot', 'distance'], picture: ['hue', 'color'] },
      show: [SELF, 'color'],
    }),
  },
];
