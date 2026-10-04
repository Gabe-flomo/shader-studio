/**
 * noiseRecipes.ts — starter recipes for noise (Fractal Noise, Noise Float, Wave Texture),
 * Voronoi and the Palette (docs/starter-recipes.md).
 */
import type { RecipeContext, StarterRecipe, Wire } from './types';
import { SELF, col, n, note, selfOut } from './kit';

/** Params that make a noise node drift once Time is wired (each names its speed differently). */
function driftParams(ctx: RecipeContext): Record<string, unknown> {
  switch (ctx.self.type) {
    case 'fbm': return { scale: 2, time_scale: 0.2 };
    case 'voronoi': return { time_scale: 0.4 };
    case 'waveTexture': return { speed: 0.3, distortion: 2 };
    default: return {};
  }
}

const timeNode = (x: number, y: number, why: string) => n('time', 'time', x, y, note('Time: seconds since the start.', why));

export const NOISE_RECIPES: StarterRecipe[] = [
  {
    id: 'noise-colour',
    label: 'Coloured and drifting',
    description: 'Time makes the noise drift and a Palette turns its values into colour.',
    build: ctx => ({
      params: driftParams(ctx),
      nodes: [
        timeNode(col(-1), 260, 'Why: wired into the noise\'s Time, so it slowly drifts (its Speed says how fast).'),
        n('palette', 'hue', col(1), 0, { preset: '0', scale: 1.4, ...note(
          'Palette: turns a number (0…1) into a colour, cycling through hues.',
          'Why: the noise is greyscale numbers; this paints them. Change Preset or Scale for other colours.',
        ) }, { value: selfOut(ctx, 'float', ['value', 'dist']) }),
      ],
      wire: ctx.self.inputs.time ? { time: ['time', 'time'] as Wire } : undefined,
      show: ['hue', 'color'],
    }),
  },
  {
    id: 'noise-warp',
    label: 'Marbled (domain warp)',
    description: 'A Domain Warp bends the coordinates before the noise reads them, for swirling, marble-like shapes.',
    build: ctx => ({
      params: driftParams(ctx),
      nodes: [
        timeNode(col(-2), 260, 'Why: makes the warp (and the noise) move.'),
        n('domainWarp', 'warp', col(-1), 0, { strength: 0.6, scale: 1.2, time_scale: 0.15, ...note(
          'Domain Warp: pushes every point around by a smooth noise of its own.',
          'Why: wired into the noise\'s UV, so the noise is read through bent coordinates and its blobs stretch into swirls. Strength sets how much.',
        ) }, { time: ['time', 'time'] }),
        n('palette', 'hue', col(1), 0, { preset: '2', scale: 1.6, ...note(
          'Palette: the warped noise as colour.',
          'Why: shows the swirls. Try another Preset.',
        ) }, { value: selfOut(ctx, 'float', ['value', 'dist']) }),
      ],
      wire: { uv: ['warp', 'uv'], ...(ctx.self.inputs.time ? { time: ['time', 'time'] } : {}) },
      show: ['hue', 'color'],
    }),
  },
];

export const VORONOI_RECIPES: StarterRecipe[] = [
  NOISE_RECIPES[0],
  {
    id: 'voronoi-glow',
    label: 'Glowing seeds',
    description: 'SDF Glow lights up the points the cells grow from: a field of soft, drifting lights.',
    build: () => ({
      params: { scale: 6, time_scale: 0.5 },
      nodes: [
        timeNode(col(-1), 260, 'Why: wired into Voronoi\'s Time, so the seeds wander.'),
        n('light', 'glow', col(1), 0, { mode: 'glow', brightness: 5, tint: [0.45, 0.75, 1], ...note(
          'SDF Glow: light that is brightest where the distance is 0 and fades away from it.',
          'Why: Voronoi\'s Distance is 0 at each cell\'s seed, so every seed becomes a soft light. Falloff sets how far they reach (lower is wider); Tint their colour.',
        ) }, { distance: [SELF, 'dist'] }),
      ],
      wire: { time: ['time', 'time'] },
      show: ['glow', 'tinted'],
    }),
  },
];

export const PALETTE_RECIPES: StarterRecipe[] = [
  {
    id: 'palette-radial',
    label: 'Radial rainbow',
    description: 'The distance from the centre picks the colour, and Time cycles it: rings of colour flowing outward.',
    build: () => ({
      params: { scale: 1.2, speed: 0.4 },
      nodes: [
        n('uv', 'uv', col(-2), 0, note('UV: the position of each pixel, (0, 0) in the middle.')),
        n('length', 'far', col(-1), 0, { scale: 1, ...note(
          'Length: how far each pixel is from the centre.',
          'Why: wired into the Palette\'s Angle, so the colour changes with distance: rings.',
        ) }, { input: ['uv', 'uv'] }),
        n('time', 'time', col(-1), 260, note('Time: seconds since the start.', 'Why: wired into Angle offset, so the colours flow outward (Speed sets how fast).')),
      ],
      wire: { value: ['far', 'output'], anim: ['time', 'time'] },
      show: [SELF, 'color'],
    }),
  },
  {
    id: 'palette-noise',
    label: 'Colour some noise',
    description: 'Drifting Fractal Noise picks the colour, for a cloudy, many-coloured picture.',
    build: () => ({
      params: { scale: 1.5 },
      nodes: [
        n('time', 'time', col(-2), 260, note('Time: seconds since the start.', 'Why: makes the noise drift.')),
        n('fbm', 'noise', col(-1), 0, { scale: 2, time_scale: 0.2, ...note(
          'Fractal Noise: soft cloudy values between 0 and 1.',
          'Why: wired into the Palette\'s Angle, so each value of the noise gets its own colour.',
        ) }, { time: ['time', 'time'] }),
      ],
      wire: { value: ['noise', 'value'] },
      show: [SELF, 'color'],
    }),
  },
];
