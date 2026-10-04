/**
 * kit.ts — small helpers the starter recipes share: notes, a column grid, and the few
 * stand-ins (a colour, a picture) several recipes start from.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { n } from '../../store/graphBuilder';
import { SELF, type RecipeContext, type Wire } from './types';

export { n, SELF };

/** A node's note: what it does, then why the recipe added it. */
export const note = (...lines: string[]) => ({ __comment: lines.join('\n') });

/** Column x for a recipe (the new node is column 0; −1 is just left of it). */
export const col = (i: number) => i * 420;

/** The first output of `self` whose type is `type`, as a wire from SELF. */
export function selfOut(ctx: RecipeContext, type: string, prefer: string[] = []): Wire {
  for (const k of prefer) if (ctx.self.outputs[k]?.type === type) return [SELF, k];
  const key = Object.entries(ctx.self.outputs).find(([, o]) => o.type === type)?.[0] ?? Object.keys(ctx.self.outputs)[0];
  return [SELF, key];
}

/** The first input of `self` named one of `keys` (in that order). */
export function selfIn(ctx: RecipeContext, keys: string[]): string | undefined {
  return keys.find(k => ctx.self.inputs[k]);
}

/** A flat colour to paint with (a Color node), so changing the colour is one swatch away. */
export function colour(id: string, x: number, y: number, rgb: [number, number, number], why: string): GraphNode {
  return n('colorPicker', id, x, y, { color: rgb, ...note('Color: one flat colour. Click the swatch to change it.', why) });
}

/**
 * A picture to work on when the Output shows nothing yet: slow fractal noise through a palette.
 * Returns its nodes and the wire of its colour.
 */
export function standInPicture(prefix: string, x: number, y: number): { nodes: GraphNode[]; out: Wire } {
  return {
    nodes: [
      n('time', `${prefix}Time`, x - 420, y + 260, note('Time: seconds since the start. It makes the stand-in picture drift.')),
      n('fbm', `${prefix}Noise`, x, y, { scale: 2.2, time_scale: 0.15, ...note(
        'Fractal Noise: soft, cloudy noise that drifts with Time.',
        'A stand-in picture, because the Output showed nothing yet. Swap it for anything: a Texture Input, a shape, a pattern.',
      ) }, { time: [`${prefix}Time`, 'time'] }),
      n('palette', `${prefix}Colour`, x + 420, y, { preset: '0', scale: 1.4, ...note('Palette: turns the noise (0…1) into colour, so the stand-in picture has some hues to work with.') }, { value: [`${prefix}Noise`, 'value'] }),
    ],
    out: [`${prefix}Colour`, 'color'],
  };
}

/** What the Output shows, or a stand-in picture placed at (x, y) when it shows nothing. */
export function pictureFor(ctx: RecipeContext, x: number, y: number): { nodes: GraphNode[]; out: Wire } {
  return ctx.shown ? { nodes: [], out: ctx.shown } : standInPicture('pic', x, y);
}
