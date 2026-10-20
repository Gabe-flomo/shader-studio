/**
 * wiggleLook.ts — the house colouring for 3D and 4D examples (examples curation, 2026-10-19).
 *
 * "MLG: Wiggle Tunnel" colours its march by how far each ray went and how many steps it took, through one
 * cosine palette (deep navy → sky blue → cream → orange → maroon) on black. Distance gives bands that recede
 * with depth; the step count brightens edges and crevices, where rays slow down. The 3D and 4D showpieces use
 * the same palette and the same two drivers, plus a light touch of form shading and a depth fade, so a single
 * object reads as solid while still looking like part of the same family.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

export type Wire = [fromId: string, outputKey: string];
const note = (text: string) => ({ __comment: text });

/** The Wiggle Tunnel's palette: offset and amplitude 0.5, frequency 1, phase (0.3, 0.416, 0.557). */
export const WIGGLE_PALETTE = { preset: 'custom', offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0.3, 0.416, 0.557] };

/** An Expression Block whose inputs may be floats or vectors, with a vec3 (or `out`) result. */
export function exprBlock(id: string, x: number, y: number, label: string,
  ins: Record<string, { type: 'float' | 'vec2' | 'vec3'; from: Wire }>, lines: Array<{ lhs: string; rhs: string }>, result: string, comment: string,
  out: 'float' | 'vec2' | 'vec3' = 'vec3'): GraphNode {
  const base = n('exprNode', id, x, y, {
    inputs: Object.entries(ins).map(([name, v]) => ({ name, type: v.type, slider: null })),
    outputType: out, lines: lines.map(l => ({ lhs: l.lhs, op: '=', rhs: l.rhs })), result, expr: result, label, ...note(comment),
  });
  const inputs: GraphNode['inputs'] = {};
  for (const [k, v] of Object.entries(ins)) inputs[k] = { type: v.type, label: k, connection: { nodeId: v.from[0], outputKey: v.from[1] } };
  return { ...base, inputs, outputs: { result: { type: out, label: 'Result' } } };
}

export interface WiggleFinish {
  /** The March Loop's id (its dist, iterCount, iter, normal, hit outputs are read). */
  march: string;
  /** Left edge of the finishing nodes. */
  x: number;
  y: number;
  /** Palette position per unit of distance and per step (the Wiggle Tunnel uses 0.04 and 0.005). */
  distK: number;
  iterK: number;
  /** Optional third driver added to the palette position (a ring's angle, a height…), with its own note. */
  extra?: { from: Wire; note: string };
  /** Background (the misses), dark. */
  bg: [number, number, number];
  /** How far (in scene units) the depth fade takes to reach the background; 0 = none. */
  fog: number;
  /** Where the depth fade starts (scene units from the camera): about the distance to the subject's front. */
  fogStart: number;
  /** How strongly the surface's facing to the light shapes it: 0 = flat like the tunnel, 1 = fully lit. */
  form: number;
  /** Halo on near misses from the step count (restrained: 0 = none). */
  halo: number;
  /** The note on the Palette node. */
  paletteNote?: string;
  /** Where on the palette the nearest, plainest surfaces sit (its Angle offset): about 0.25 is the tunnel's blue. */
  shift: number;
}

/**
 * Distance × k + Iter Count × k (+ extra) → Palette (the Wiggle colours) → Multi-Light (a little form from the
 * normal, the background where the ray missed) → Volumetric Fog (a depth fade that starts at the subject) → a
 * faint halo on near misses (Pow of Iter → Glow to Colour) → Vignette → Output. All nodes, no Expression Block
 * (2026-10-19: examples use nodes wherever one exists).
 */
export function wiggleFinish(o: WiggleFinish): GraphNode[] {
  const { x, y, march } = o;
  const pos: Wire = o.extra ? ['wg_add2', 'result'] : ['wg_add', 'result'];
  const form = Number(o.form.toFixed(2)), flat = Number((1 - o.form).toFixed(2));
  const haloGain = Number((6.55 * o.halo).toFixed(2));
  const fogged: Wire = o.fog > 0 ? ['wg_fog', 'color'] : ['wg_lit', 'color'];
  return [
    n('multiply', 'wg_d', x, y - 120, { b: o.distK, outputType: 'float', ...note(`Multiply: how far the ray went × ${o.distK}. Farther surfaces sit further round the palette, so colour bands recede with depth (the Wiggle Tunnel's first driver).`) }, { a: [march, 'dist'] }),
    n('multiply', 'wg_i', x, y + 40, { b: o.iterK, outputType: 'float', ...note(`Multiply: the steps the ray took × ${o.iterK}. Rays slow down along edges and in crevices, so those shift colour and pick out the shape (the Wiggle Tunnel's second driver).`) }, { a: [march, 'iterCount'] }),
    n('add', 'wg_add', x + 220, y - 40, { outputType: 'float', ...note('Add: the two together, where on the palette this pixel sits.') }, { a: ['wg_d', 'result'], b: ['wg_i', 'result'] }),
    ...(o.extra ? [n('add', 'wg_add2', x + 440, y - 40, { outputType: 'float', ...note(o.extra.note) }, { a: ['wg_add', 'result'], b: o.extra.from })] : []),
    n('palette', 'wg_pal', x + 660, y - 40, { ...WIGGLE_PALETTE, anim: o.shift, speed: 1, ...note(o.paletteNote ?? `Palette: the Wiggle Tunnel's colours (offset and amplitude 0.5, frequency 1, phase 0.3, 0.416, 0.557): deep navy, sky blue, cream, orange and maroon in turn. Angle offset ${o.shift} turns the wheel so the plain, near surfaces land on the blues and the edges and far bands on cream and orange. Every 3D and 4D showpiece uses this one palette.`) }, { value: pos }),
    n('multiLight', 'wg_lit', x + 900, y, {
      sunFrom: 'angles', azimuth: 51.3, elevation: 51.4, sunR: form, sunG: form, sunB: form,
      skyR: Number((flat * 1.2).toFixed(2)), skyG: Number((flat * 1.2).toFixed(2)), skyB: Number((flat * 1.2).toFixed(2)),
      bounceR: Number((flat * 0.35).toFixed(2)), bounceG: Number((flat * 0.35).toFixed(2)), bounceB: Number((flat * 0.35).toFixed(2)),
      background: 'colour', bgColor: o.bg,
      ...note(`Multi-Light, kept light so the palette does the work: a white key light up and to the right at ${form} (its facing shapes the surface) and an even sky and bounce fill for the rest, so the shape reads as solid without washing out the colour bands. Where the ray hit nothing (Hit 0) it shows the dark Background colour.`),
    }, { baseColor: ['wg_pal', 'color'], normal: [march, 'normal'], hit: [march, 'hit'] }),
    ...(o.fog > 0 ? [
      n('subtract', 'wg_far', x + 900, y + 260, { b: o.fogStart, outputType: 'float', ...note(`Subtract: how far past ${o.fogStart} units (about the front of the subject) the ray went, so the fade starts at the subject, not at the camera.`) }, { a: [march, 'dist'] }),
      n('max', 'wg_past', x + 1120, y + 260, { b: 0, outputType: 'float', ...note('Max with 0: nearer than that, no fade at all.') }, { a: ['wg_far', 'result'] }),
      n('volumetricFog', 'wg_fog', x + 1160, y, {
        density: Number((1 / o.fog).toFixed(3)), fogR: o.bg[0], fogG: o.bg[1], fogB: o.bg[2],
        ...note(`Volumetric Fog: far surfaces sink into the background colour for depth: past the subject they lose 63% every ${o.fog.toFixed(1)} units (Density ${(1 / o.fog).toFixed(2)}). Misses are left alone (Hit).`),
      }, { color: ['wg_lit', 'color'], depth: ['wg_past', 'result'], hit: [march, 'hit'] }),
    ] : []),
    n('pow', 'wg_near', x + 1160, y + 460, { exponent: 4, ...note('Pow 4 of Iter (the share of steps used): only rays that nearly touched the shape take most of their steps, so only true near misses get a high number.') }, { base: [march, 'iter'] }),
    n('glowToColor', 'wg_halo', x + 1400, y + 460, { exposure: haloGain, ...note(`Glow to Colour: that near-miss number as a faint halo in the palette's own colour (Exposure ${haloGain}), rolled off by tanh so it never blows out.`) }, { glow: ['wg_near', 'result'], tint: ['wg_pal', 'color'] }),
    n('addColor', 'wg_sum', x + 1400, y, { ...note('Add Colours: the lit, faded surface plus the halo round its edges.') }, { a: fogged, b: ['wg_halo', 'color'] }),
    n('vignette', 'wg_vig', x + 1640, y, { radius: 0.8, softness: 0.65, strength: 0.65, ...note('Vignette: a gentle darkening toward the corners, to hold the eye on the middle.') }, { color: ['wg_sum', 'result'] }),
    n('output', 'out', x + 1880, y, { ...note('Output: the picture.') }, { color: ['wg_vig', 'result'] }),
  ];
}
