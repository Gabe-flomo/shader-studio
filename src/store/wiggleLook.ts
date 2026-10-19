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
 * Distance × k + Iter Count × k (+ extra) → Palette (the Wiggle colours) → a shading Expression Block (a little form
 * from the normal, depth fade into the background, a faint halo on near misses) → Vignette → Output.
 */
export function wiggleFinish(o: WiggleFinish): GraphNode[] {
  const { x, y, march } = o;
  const pos: Wire = o.extra ? ['wg_add2', 'result'] : ['wg_add', 'result'];
  const [br, bgG, bb] = o.bg.map(v => v.toFixed(3));
  return [
    n('multiply', 'wg_d', x, y - 120, { b: o.distK, outputType: 'float', ...note(`Multiply: how far the ray went × ${o.distK}. Farther surfaces sit further round the palette, so colour bands recede with depth (the Wiggle Tunnel's first driver).`) }, { a: [march, 'dist'] }),
    n('multiply', 'wg_i', x, y + 40, { b: o.iterK, outputType: 'float', ...note(`Multiply: the steps the ray took × ${o.iterK}. Rays slow down along edges and in crevices, so those shift colour and pick out the shape (the Wiggle Tunnel's second driver).`) }, { a: [march, 'iterCount'] }),
    n('add', 'wg_add', x + 220, y - 40, { outputType: 'float', ...note('Add: the two together, where on the palette this pixel sits.') }, { a: ['wg_d', 'result'], b: ['wg_i', 'result'] }),
    ...(o.extra ? [n('add', 'wg_add2', x + 440, y - 40, { outputType: 'float', ...note(o.extra.note) }, { a: ['wg_add', 'result'], b: o.extra.from })] : []),
    n('palette', 'wg_pal', x + 660, y - 40, { ...WIGGLE_PALETTE, anim: o.shift, speed: 1, ...note(o.paletteNote ?? `Palette: the Wiggle Tunnel's colours (offset and amplitude 0.5, frequency 1, phase 0.3, 0.416, 0.557): deep navy, sky blue, cream, orange and maroon in turn. Angle offset ${o.shift} turns the wheel so the plain, near surfaces land on the blues and the edges and far bands on cream and orange. Every 3D and 4D showpiece uses this one palette.`) }, { value: pos }),
    exprBlock('wg_shade', x + 900, y, 'Form, depth and halo', {
      pal: { type: 'vec3', from: ['wg_pal', 'color'] }, nrm: { type: 'vec3', from: [march, 'normal'] },
      hit: { type: 'float', from: [march, 'hit'] }, dist: { type: 'float', from: [march, 'dist'] }, it: { type: 'float', from: [march, 'iter'] },
    }, [
      { lhs: 'vec3 bg', rhs: `vec3(${br}, ${bgG}, ${bb})` },
      { lhs: 'float lit', rhs: 'max(dot(nrm, normalize(vec3(0.5, 0.8, 0.4))), 0.0)' },
      { lhs: 'float rim', rhs: 'pow(1.0 - abs(nrm.z), 3.0)' },
      { lhs: 'vec3 surf', rhs: `pal * (${(1 - o.form).toFixed(2)} + ${o.form.toFixed(2)} * lit) + pal * rim * 0.15` },
      { lhs: 'float fade', rhs: o.fog > 0 ? `exp(-max(dist - ${o.fogStart.toFixed(2)}, 0.0) / ${o.fog.toFixed(2)})` : '1.0' },
      { lhs: 'vec3 miss', rhs: `bg + pal * pow(clamp(it * 1.6, 0.0, 1.0), 4.0) * ${o.halo.toFixed(2)}` },
    ], 'mix(miss, mix(bg, surf, fade), hit)',
    `Shading, kept light so the palette does the work. lit: how much the surface faces a soft key light up and to the right, mixed in at ${o.form.toFixed(2)} so the shape reads as solid without washing out the colour bands. rim: a touch of the palette on edges turning away from the camera. fade: far surfaces sink into the background${o.fog > 0 ? ` (past ${o.fogStart.toFixed(1)} units from the camera, they lose 63% every ${o.fog.toFixed(1)} units)` : ' (off here)'}, for depth. miss: where the ray hit nothing, the dark background plus a faint glow from rays that nearly touched (Iter, to the 4th power so only true near-misses glow).`),
    n('vignette', 'wg_vig', x + 1160, y, { radius: 0.8, softness: 0.65, strength: 0.65, ...note('Vignette: a gentle darkening toward the corners, to hold the eye on the middle.') }, { color: ['wg_shade', 'result'] }),
    n('output', 'out', x + 1400, y, { ...note('Output: the picture.') }, { color: ['wg_vig', 'result'] }),
  ];
}
