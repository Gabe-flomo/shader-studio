/**
 * effectRecipes.ts — starter recipes for nodes that work on a picture or over time: Previous
 * Frame (feedback), Pass, Particles, Audio Input, LFO and the picture effects (Bloom, Vignette,
 * Grain…).
 */
import type { GraphNode } from '../../types/nodeGraph';
import type { RecipeContext, StarterRecipe, Wire } from './types';
import { SELF, col, colour, n, note, pictureFor, selfIn, selfOut } from './kit';

/** An Expression Block with vec3/float inputs wired from `ins`. */
function expr(id: string, x: number, y: number, label: string, ins: Array<[name: string, type: 'vec3' | 'float', from: Wire]>, result: string, comment: string): GraphNode {
  const e = n('exprNode', id, x, y, {
    label, inputs: ins.map(([name, type]) => ({ name, type, slider: null })),
    outputType: 'vec3', lines: [], result, expr: result, __comment: comment,
  });
  e.inputs = Object.fromEntries(ins.map(([name, type, from]) => [name, { type, label: name, connection: { nodeId: from[0], outputKey: from[1] } }]));
  e.outputs = { result: { type: 'vec3', label: 'Result' } };
  return e;
}

/** A Mix retyped to colours (its type pill set to vec3): A, B and the result are vec3. */
function vec3Mix(m: GraphNode): GraphNode {
  return { ...m, inputs: { ...m.inputs, a: { ...m.inputs.a, type: 'vec3' }, b: { ...m.inputs.b, type: 'vec3' } }, outputs: { result: { ...m.outputs.result, type: 'vec3' } } };
}

export const FEEDBACK_RECIPES: StarterRecipe[] = [
  {
    id: 'feedback-trails',
    label: 'Trails behind the mouse',
    description: 'A glowing dot follows the mouse; each frame keeps a faded copy of the last, so it leaves a trail.',
    build: () => ({
      params: note('Previous Frame: the picture as it was one frame ago.', 'Why: mixed back in a little darker every frame, so whatever moves leaves a fading trail.'),
      nodes: [
        n('mouse', 'mouse', col(-1), 300, note('Mouse: where the pointer is.', 'Why: moves the dot.')),
        n('circleSDF', 'dot', col(0), 360, { radius: 0.05, ...note('Circle SDF: a small circle at the mouse (its Offset is the mouse position).') }, { offset: ['mouse', 'uv'] }),
        n('light', 'glow', col(1), 360, { mode: 'glow', brightness: 10, tint: [0.4, 0.8, 1], ...note('SDF Glow: makes the dot a soft light.', 'Why: the new picture drawn this frame.') }, { distance: ['dot', 'distance'] }),
        expr('keep', col(2), 0, 'Fade and add', [['last', 'vec3', [SELF, 'color']], ['now', 'vec3', ['glow', 'tinted']]], 'max(last * 0.96, now)',
          'Fade and add (an Expression Block): last frame × 0.96, with the new dot on top (max).\nWhy: the 0.96 is the trail length. 0.99 for long trails, 0.8 for short ones.'),
      ],
      show: ['keep', 'result'],
    }),
  },
  {
    id: 'feedback-smear',
    label: 'Drifting smear',
    description: 'Last frame is read through a slightly shrunk, turned UV and mixed with fresh colour: everything swirls inward.',
    build: () => ({
      params: note('Previous Frame: the picture one frame ago, read through the turned UV.', 'Why: reading it a little shrunk and turned every frame makes the picture flow inward in a spiral.'),
      nodes: [
        n('uv', 'uv', col(-2), 0, note('UV: the position of each pixel, (0, 0) in the middle.')),
        n('uvTransform2d', 'drift', col(-1), 0, { angle: 0.02, sx: 0.985, sy: 0.985, ...note(
          'UV Transform 2D: shrinks the UV by 1.5% and turns it a little.',
          'Why: wired into Previous Frame\'s UV, so last frame is read slightly zoomed and turned: the drift. Angle and Scale change the swirl.',
        ) }, { uv: ['uv', 'uv'] }),
        n('time', 'time', col(-1), 360, note('Time: seconds since the start.', 'Why: makes the fresh colour change.')),
        n('fbm', 'noise', col(0), 400, { scale: 2, time_scale: 0.3, ...note('Fractal Noise: fresh, drifting values every frame.') }, { time: ['time', 'time'] }),
        n('palette', 'hue', col(1), 400, { preset: '0', scale: 1.5, ...note('Palette: the noise as colour: the fresh paint added each frame.') }, { value: ['noise', 'value'] }),
        vec3Mix(n('mix', 'blend', col(2), 0, { outputType: 'vec3', t: 0.08, ...note(
          'Mix: 92% last frame, 8% fresh colour.',
          'Why: Blend sets how fast the old picture is painted over. Lower for longer smears.',
        ) }, { a: [SELF, 'color'], b: ['hue', 'color'] })),
      ],
      wire: { uv: ['drift', 'result'] },
      show: ['blend', 'result'],
    }),
  },
];

/** A Pass's picture: its Color input when wired, else what the Output shows (or a stand-in). */
function passPicture(ctx: RecipeContext): { nodes: GraphNode[]; wire: Record<string, Wire> } {
  if (ctx.self.inputs.color?.connection) return { nodes: [], wire: {} };
  const pic = pictureFor(ctx, col(-2), 0);
  return { nodes: pic.nodes, wire: { color: pic.out } };
}

export const PASS_RECIPES: StarterRecipe[] = [
  {
    id: 'pass-glow',
    label: 'Glow',
    description: 'Glow (texture) keeps the bright parts of the picture and blurs them; Add Colors lays that glow over the picture.',
    build: ctx => {
      const pic = passPicture(ctx);
      return {
        params: note('Pass: draws the picture into a texture first.', 'Why: the nodes after it can then read the pixels around each one (a blur needs that).'),
        nodes: [
          ...pic.nodes,
          n('glowTexture', 'glow', col(1), 0, { threshold: 0.8, radius: 18, intensity: 0.5, ...note(
            'Glow (texture): keeps what is brighter than Threshold and spreads it by Radius pixels (the Bloom chain: a soft core with a long tail).',
            'Why: the glow itself. Radius for a wider halo, Intensity for a brighter one.',
          ) }, { texture: [SELF, 'texture'] }),
          n('addColor', 'over', col(2), 0, note('Add Colors: the picture plus its glow.', 'Why: lays the halo over the original.'), { a: [SELF, 'color'], b: ['glow', 'glow'] }),
        ],
        wire: pic.wire,
        show: ['over', 'result'],
      };
    },
  },
  {
    id: 'pass-blur',
    label: 'Soft blur',
    description: 'Blur (texture) reads the Pass around each pixel and averages it.',
    build: ctx => {
      const pic = passPicture(ctx);
      return {
        params: note('Pass: draws the picture into a texture first.', 'Why: a blur reads the pixels around each one, which only works on a texture.'),
        nodes: [
          ...pic.nodes,
          n('blurTexture', 'blur', col(1), 0, { radius: 10, ...note('Blur (texture): a smooth Gaussian Radius pixels wide.', 'Why: the blur. Raise Radius for softer.') }, { texture: [SELF, 'texture'] }),
        ],
        wire: pic.wire,
        show: ['blur', 'color'],
      };
    },
  },
  {
    id: 'pass-edges',
    label: 'Outlines',
    description: 'Edges (texture) finds where the picture changes fast and keeps only those outlines.',
    build: ctx => {
      const pic = passPicture(ctx);
      // A picture the recipe wires in goes through Posterize first: flat bands give clean lines.
      const bands = pic.wire.color
        ? [n('posterize', 'bands', col(-1), 300, { levels: 5, ...note('Posterize: cuts the colours into a few flat bands.', 'Why: hard steps between bands give Edges clean lines to find.') }, { color: pic.wire.color })]
        : [];
      return {
        params: note('Pass: draws the picture into a texture first.', 'Why: finding an edge means comparing a pixel with its neighbours, which only works on a texture.'),
        nodes: [
          ...pic.nodes,
          ...bands,
          n('edgesTexture', 'edges', col(1), 0, { strength: 3, width: 1.5, ...note('Edges (texture): bright where the picture changes fast, dark elsewhere.', 'Why: the outlines. Width for thicker lines.') }, { texture: [SELF, 'texture'] }),
        ],
        wire: bands.length ? { color: ['bands', 'color'] as Wire } : undefined,
        show: ['edges', 'color'],
      };
    },
  },
];

export const PARTICLE_RECIPES: StarterRecipe[] = [
  {
    id: 'particles-over',
    label: 'Over the picture',
    description: 'The particles drift over what the Output shows (or over a stand-in picture).',
    build: ctx => {
      const pic = pictureFor(ctx, col(-2), 0);
      return {
        nodes: pic.nodes,
        wire: { over: pic.out },
        show: [SELF, 'color'],
      };
    },
  },
  {
    id: 'particles-mouse',
    label: 'Follow the mouse',
    description: 'The Mouse moves the emitter, so the particles pour out wherever the pointer is.',
    build: () => ({
      nodes: [n('mouse', 'mouse', col(-1), 0, note('Mouse: where the pointer is.', 'Why: wired into Emitter, so particles are born under the pointer.'))],
      wire: { emitAt: ['mouse', 'uv'] },
      show: [SELF, 'color'],
    }),
  },
];

export const AUDIO_RECIPES: StarterRecipe[] = [
  {
    id: 'audio-pulse',
    label: 'Pulse a shape to the sound',
    description: 'The band\'s level (0…1) becomes a circle\'s radius, lit by SDF Glow. Load a sound on the card to hear and see it.',
    build: ctx => ({
      nodes: [
        n('remap', 'size', col(1), 0, { inMin: 0, inMax: 1, outMin: 0.18, outMax: 0.5, ...note(
          'Remap: the sound level (0…1) as a radius (0.18…0.5).',
          'Why: silence keeps a small circle; loud parts swell it. Change Out Min / Max for a smaller or bigger pulse.',
        ) }, { value: selfOut(ctx, 'float') }),
        n('circleSDF', 'dot', col(2), 0, note('Circle SDF: the circle that pulses.'), { radius: ['size', 'result'] }),
        n('light', 'glow', col(3), 0, { mode: 'glow', brightness: 10, tint: [1, 0.5, 0.3], ...note('SDF Glow: makes the circle\'s edge glow.') }, { distance: ['dot', 'distance'] }),
      ],
      show: ['glow', 'tinted'],
    }),
  },
];

export const LFO_RECIPES: StarterRecipe[] = [
  {
    id: 'lfo-breathe',
    label: 'Breathe a shape',
    description: 'The LFO\'s swing (−1…1) becomes a circle\'s radius: it grows and shrinks forever.',
    build: () => ({
      params: { freq: 0.5 },
      nodes: [
        n('remap', 'size', col(1), 0, { inMin: -1, inMax: 1, outMin: 0.15, outMax: 0.45, ...note(
          'Remap: the LFO\'s −1…1 as a radius between 0.15 and 0.45.',
          'Why: the LFO swings evenly; this turns that swing into a size. The LFO\'s Frequency sets the breathing speed.',
        ) }, { value: [SELF, 'value'] }),
        n('circleSDF', 'dot', col(2), 0, note('Circle SDF: the circle that breathes.'), { radius: ['size', 'result'] }),
        colour('fillCol', col(2), 300, [0.5, 0.85, 0.7], 'Why: the colour of the circle.'),
        n('sdfFill', 'paint', col(3), 0, { antialias: 0.006, ...note('SDF Fill: paints the circle.') }, { d: ['dot', 'distance'], fillColor: ['fillCol', 'rgb'] }),
      ],
      show: ['paint', 'result'],
    }),
  },
];

/** "Apply it to the picture": the node goes between what the Output shows and the Output. */
export const PICTURE_EFFECT_RECIPES: StarterRecipe[] = [
  {
    id: 'effect-apply',
    label: 'Apply to the picture',
    description: 'Puts it between what the Output shows and the Output (on a stand-in picture when the Output shows nothing).',
    build: ctx => {
      const key = selfIn(ctx, ['color', 'base']) ?? 'color';
      const pic = pictureFor(ctx, col(-2), 0);
      return {
        nodes: pic.nodes,
        wire: { [key]: pic.out },
        show: selfOut(ctx, 'vec3', ['result', 'color']),
      };
    },
  },
];
