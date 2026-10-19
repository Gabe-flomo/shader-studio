/**
 * cinemaLook.ts — the finishing shared by the particle and agent showpieces (examples curation, 2026-10-19).
 *
 * The user's note: a large glow looks cheap. So the particles carry little or no built-in glow and stay below
 * white; depth comes from a dark graded backdrop instead of flat black, highlights roll off through a filmic tone
 * map (ACES), a vignette holds the eye and a fine moving grain takes off the digital edge.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

export type Wire = [fromId: string, outputKey: string];
const note = (text: string) => ({ __comment: text });

/** A radial backdrop (Gradient, Radial): `inner` at the middle falling to `outer` at the edges. */
export function backdrop(id: string, x: number, y: number, uv: Wire, inner: [number, number, number], outer: [number, number, number], comment: string): GraphNode {
  return n('gradient', id, x, y, { mode: 'radial', color_a: inner, color_b: outer, t_offset: 0, ...note(comment) }, { uv });
}

export interface CinemaFinish {
  /** Left edge of the finishing nodes. */
  x: number;
  y: number;
  /** Vignette strength (0 = none). */
  vignette?: number;
  /** Grain amount (0 = none). */
  grain?: number;
  /** Tone map mode. */
  tone?: string;
  /** Ids for the nodes, when an example already uses these. */
  prefix?: string;
  /** UV and Time wires for the grain (they default to nodes `uv` and `t`). */
  uv?: Wire;
  time?: Wire;
  /** Id of the Output node (default `out`). */
  outId?: string;
}

/** Tone Map (ACES) → Vignette → Grain → Output, from `src`. */
export function cinemaFinish(src: Wire, o: CinemaFinish): GraphNode[] {
  const P = o.prefix ?? 'cf';
  const { x, y } = o;
  const tone = o.tone ?? 'aces';
  return [
    n('toneMap', `${P}_tone`, x, y, { mode: tone, ...note(`Tone Map (${tone === 'aces' ? 'ACES' : tone}): a film curve. Rolls the brightest crowds off gently instead of clipping them to flat white, deepens the shadows a little and keeps the blacks black: highlights that soften rather than burn.`) }, { color: src }),
    n('vignette', `${P}_vig`, x + 230, y, { radius: 0.78, softness: 0.65, strength: o.vignette ?? 0.7, ...note('Vignette: darkens the corners, so the eye goes to the middle and the frame has depth.') }, { color: [`${P}_tone`, 'color'] }),
    n('grain', `${P}_grain`, x + 460, y, { mode: 'temporal', amount: o.grain ?? 0.015, scale: 1, ...note('Grain (Temporal): a faint film grain that changes every frame. It breaks up smooth gradients and gives the dark areas some life, instead of a flat digital black.') },
      { color: [`${P}_vig`, 'result'], uv: o.uv ?? ['uv', 'uv'], time: o.time ?? ['t', 'time'] }),
    n('output', o.outId ?? 'out', x + 690, y, { ...note('Output: the picture.') }, { color: [`${P}_grain`, 'color'] }),
  ];
}
