/**
 * textureRecipes.ts — starter recipes for the Texture tools (docs/texture-tools.md) and Jump
 * flood: the setups these nodes need round them (a Pass with its Previous, a repeated flood).
 */
import type { GraphNode } from '../../types/nodeGraph';
import type { RecipeContext, StarterRecipe, Wire } from './types';
import { SELF, col, n, note, pictureFor } from './kit';

/** An Expression Block with float / vec3 inputs wired from `ins`. */
function expr(id: string, x: number, y: number, label: string, outputType: 'float' | 'vec3', ins: Array<[name: string, type: 'vec3' | 'float', from: Wire]>, result: string, comment: string): GraphNode {
  const e = n('exprNode', id, x, y, {
    label, inputs: ins.map(([name, type]) => ({ name, type, slider: null })),
    outputType, lines: [], result, expr: result, __comment: comment,
  });
  e.inputs = Object.fromEntries(ins.map(([name, type, from]) => [name, { type, label: name, connection: { nodeId: from[0], outputKey: from[1] } }]));
  e.outputs = { result: { type: outputType, label: 'Result' } };
  return e;
}

/** A whole jump flood round the new Jump flood node, from what the Output shows; `mode` is what Outline (distance) draws. */
function floodRecipe(mode: 'outline' | 'glow' | 'rings', ctx: RecipeContext): ReturnType<StarterRecipe['build']> {
  const pic = pictureFor(ctx, col(-3), 0);
  const shape = {
    outline: { offset: 0.03, width: 0.012, softness: 0.004, tint: [1, 0.75, 0.35], why: 'an outline 0.03 out from the shapes. Offset moves it, Width thickens it.' },
    glow: { offset: 0, reach: 0.2, tint: [0.4, 0.8, 1], why: 'a glow that falls off over 0.2 of the picture, the same width at any blur.' },
    rings: { offset: 0, spacing: 0.06, thickness: 0.01, softness: 0.004, fade: 3, speed: 0.4, tint: [1, 0.5, 0.8], why: 'rings every 0.06 moving outwards. Spacing and Speed change them.' },
  }[mode];
  const { why, ...params } = shape;
  return {
    params: { reach: 1, ...note('Jump flood (texture): one round of the flood. It reads the Pass\'s Previous (the round before) here and 8 places Reach pixels away, and keeps the nearest shape point any of them knows.', 'Why: repeated 10 times with the reach halving each time, every pixel learns where the nearest shape is.') },
    nodes: [
      ...pic.nodes,
      n('textureMask', 'shape', col(-2), 0, { source: 'brightness', threshold: 'hard', level: 0.5, ...note(
        'Mask (texture), on the picture\'s colour: 1 where it is brighter than Level.',
        'Why: its Seed output is what a jump flood starts from: each pixel inside the mask stores its own place. Change Level to pick other shapes.',
      ) }, { color: pic.out }),
      expr('reach', col(-1), 420, 'Reach this round', 'float', [['stepNow', 'float', ['flood', 'step']], ['stepCount', 'float', ['flood', 'steps']]], 'exp2(stepCount - stepNow)',
        'Reach this round: how far the flood looks, in picture pixels: 1024 on the first round, halving every round down to 2.\nstepNow is the Pass\'s Step (which repeat is drawing), stepCount its Steps (Repeat).'),
      expr('start', col(1), 0, 'Start, then flood', 'vec3', [['seed', 'vec3', ['shape', 'seed']], ['found', 'vec3', [SELF, 'seed']], ['stepNow', 'float', ['flood', 'step']]], 'stepNow < 0.5 ? seed : found',
        'Start, then flood: the seeds on the first round, the nearest seed found on every later one.'),
      n('pass', 'flood', col(2), 0, { label: 'Pass · jump flood', scale: '0.5', format: 'half', filter: 'nearest', repeat: 10, ...note(
        'Pass with Repeat 10: drawn ten times a frame, each reading the round before through Previous.',
        'Why: half size is a quarter of the work; Nearest keeps the stored places exact; Half float keeps them signed.',
      ) }, { color: ['start', 'result'] }),
      n('jumpFloodTexture', 'read', col(3), 0, { reach: 2, ...note('Jump flood (texture), once more, on the finished field: Distance is how far each pixel is from the nearest shape, in picture units.', 'Why: read at full size, so the distance is smooth.') }, { texture: ['flood', 'texture'] }),
      n('distanceShape', 'draw', col(4), 0, { mode, ...params, ...note(`Outline (distance): draws ${why}`) }, { distance: ['read', 'distance'] }),
      n('addColor', 'over', col(5), 0, note('Add Colors: the picture with the light from the distance added over it.'), { a: pic.out, b: ['draw', 'light'] }),
    ],
    wire: { texture: ['flood', 'previous'], reach: ['reach', 'result'] },
    show: ['over', 'result'],
  };
}

export const JUMP_FLOOD_RECIPES: StarterRecipe[] = [
  { id: 'flood-outline', label: 'Outline the picture', description: 'A repeated Pass floods the picture\'s bright shapes into a distance field; Outline (distance) draws a line round them.', build: ctx => floodRecipe('outline', ctx) },
  { id: 'flood-glow', label: 'Glow round it', description: 'The same flood; Outline (distance) in Glow mode lights the space round the shapes.', build: ctx => floodRecipe('glow', ctx) },
  { id: 'flood-rings', label: 'Rings round it', description: 'The same flood; Outline (distance) in Rings mode draws moving contour lines.', build: ctx => floodRecipe('rings', ctx) },
];

/** A Pass holding `from`, wired as the new Change node's Texture (now) and Before (its Previous). */
function changeRecipe(from: { nodes: GraphNode[]; out: Wire }, why: string): ReturnType<StarterRecipe['build']> {
  return {
    params: note('Change (texture): compares the Pass now with the Pass a frame ago (its Previous): Motion is bright where something moved.'),
    nodes: [
      ...from.nodes,
      n('pass', 'held', col(-1), 0, { label: 'Pass · now', scale: '0.5', ...note('Pass: keeps this frame as a texture, and last frame as its Previous.', why) }, { color: from.out }),
      n('palette', 'paint', col(1), 0, { preset: '0', scale: 0.8, ...note('Palette: the motion as colour, black where still.') }, { value: [SELF, 'motion'] }),
    ],
    wire: { texture: ['held', 'texture'], before: ['held', 'previous'] },
    show: ['paint', 'color'],
  };
}

export const CHANGE_RECIPES: StarterRecipe[] = [
  {
    id: 'change-video', label: 'Motion in a video',
    description: 'A Video Input drawn into a Pass; Change compares it with the frame before. Choose a video or the camera on the Video Input.',
    build: () => changeRecipe({
      nodes: [n('videoInput', 'video', col(-2), 0, note('Video Input: choose a file or the camera on this card.', 'Why: the moving picture to watch.'))],
      out: ['video', 'color'],
    }, 'Why: a video has no Previous of its own; drawn into a Pass, it gets one.'),
  },
  {
    id: 'change-picture', label: 'Motion in the picture',
    description: 'What the Output shows, drawn into a Pass; Change finds where it moves.',
    build: ctx => changeRecipe(pictureFor(ctx, col(-2), 0), 'Why: the Pass gives the picture a Previous (last frame) to compare with.'),
  },
];

/** A feedback Pass round the new Fade node, painting `fresh` (what the Output shows) each frame. */
function fadeRecipe(ctx: RecipeContext, drift: boolean): ReturnType<StarterRecipe['build']> {
  const pic = pictureFor(ctx, col(-3), 0);
  const nodes: GraphNode[] = [
    ...pic.nodes,
    n('pass', 'trails', col(1), 0, { label: 'Pass · trails', ...note('Pass: holds the trails. Its Previous (last frame) goes back into Fade, which closes the feedback loop.') }, { color: [SELF, 'color'] }),
    n('textureLevels', 'tone', col(2), 0, { rollOff: 0.4, ...note('Levels (texture): Roll-off 0.4 bends the brightest overlaps down so stacked light doesn\'t clip to flat white.') }, { color: ['trails', 'color'] }),
  ];
  const wire: Record<string, Wire> = { texture: ['trails', 'previous'], fresh: pic.out };
  if (drift) {
    nodes.push(n('readTexture', 'drift', col(-1), 360, { zoom: 1.01, turn: 0.6, ...note('Read (texture): last frame read a little zoomed and turned.', 'Why: its UV goes into Fade\'s UV, so the trails stream outwards in a slow swirl. Zoom and Turn change the drift.') }, { texture: ['trails', 'previous'] }));
    wire.uv = ['drift', 'uv'];
  }
  return {
    params: { tail: 1.5, ...note('Fade (feedback): last frame, faded (Tail: seconds to fade to 1%), with the picture painted on top.', 'Why: whatever moves leaves a trail. Tail for longer or shorter trails.') },
    nodes,
    wire,
    show: ['tone', 'color'],
  };
}

export const FADE_RECIPES: StarterRecipe[] = [
  { id: 'fade-trails', label: 'Trails', description: 'A feedback Pass: last frame fades and the picture is painted on top, so moving things leave trails.', build: ctx => fadeRecipe(ctx, false) },
  { id: 'fade-drift', label: 'Drifting trails', description: 'The same, with Read (texture) zooming and turning last frame a little: the trails swirl outwards.', build: ctx => fadeRecipe(ctx, true) },
];
