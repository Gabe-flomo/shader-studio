/**
 * curatedExamples.ts — examples built for the curated Examples lists (docs/examples-curation-proposal.md,
 * the user's feedback of 2026-10-19), where a category needed a better showpiece than it had:
 *
 *  - perspectivePlanes (2D: Shapes, Space & Colour): two Perspective 2D nodes make the floor and ceiling of a
 *    long, dim hall, lit by one row of ceiling panels mirrored in a polished floor. Replaces Neon Floor Grid.
 *
 * Built from the node definitions (graphBuilder.ts), every node with a note.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

export const CURATED_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  perspectivePlanes: {
    label: 'Perspective 2D: a hall of lights',
    description: 'Two Perspective 2D nodes turn the flat picture into the floor and the ceiling of a long hall, both meeting at a horizon in the middle. One row of light panels runs down the ceiling; the polished floor shows them mirrored and lit pools under each; fog closes the far end. Everything is flat 2D: no ray march.',
  },
};

/** A node comment (shown on the card's Comment tab and, as // lines, in the generated code). */
const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

type V = 'float' | 'vec2' | 'vec3';
/** An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result; its note explains every named line. */
function expr(id: string, x: number, y: number, o: {
  label: string; outputType: V;
  inputs: Array<[name: string, type: V, from: [string, string]]>;
  lines: Array<[lhs: string, rhs: string]>;
  result: string; note: string[];
}): GraphNode {
  const node = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(([name, type]) => ({ name, type, slider: null })),
    outputType: o.outputType,
    lines: o.lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result: o.result, expr: o.result,
    ...note(o.note),
  });
  node.inputs = Object.fromEntries(o.inputs.map(([name, type, from]) => [name, { type, label: name, connection: { nodeId: from[0], outputKey: from[1] } }]));
  node.outputs = { result: { type: o.outputType, label: 'Result' } };
  return node;
}

/** The ceiling's light panels as a distance, in hall units (x across, z along the hall): one every 3 units, 1.8 × 0.5. */
const panelSd = (x: string, z: string): Array<[string, string]> => [
  ['float pz', `mod(${z}, 3.0) - 1.5`],
  ['vec2 pd', `abs(vec2(${x}, pz)) - vec2(0.9, 0.25)`],
  ['float panel', 'length(max(pd, 0.0)) + min(max(pd.x, pd.y), 0.0)'],
];

function hallOfLights(): GraphNode[] {
  return [
    n('uv', 'uv', 40, 360, note('UV: this pixel, centred, the frame 2 tall (−1 at the bottom, +1 at the top). The horizon will sit at 0: the floor below it, the ceiling above.')),
    expr('floorIn', 340, 200, {
      label: 'Floor: horizon to the middle', outputType: 'vec2',
      inputs: [['uv', 'vec2', ['uv', 'uv']]],
      lines: [],
      result: 'uv + vec2(0.0, 1.0)',
      note: [
        'Floor: horizon to the middle. Perspective 2D (Y, Ratio 1) divides by 1 − y, so its horizon is where y = 1: the top of the frame.',
        'Moving the picture up by 1 first puts that horizon at the middle of the frame, and everything below it becomes a floor seen from 1 unit above.',
      ],
    }),
    expr('ceilIn', 340, 560, {
      label: 'Ceiling: horizon to the middle', outputType: 'vec2',
      inputs: [['uv', 'vec2', ['uv', 'uv']]],
      lines: [],
      result: 'uv - vec2(0.0, 1.0)',
      note: [
        'Ceiling: horizon to the middle. The ceiling\'s Perspective 2D is flipped (it divides by 1 + y), so its horizon is at y = −1.',
        'Moving the picture down by 1 brings that horizon to the middle too: above it is a ceiling 1 unit over the eye.',
      ],
    }),
    n('perspective2d', 'floorP', 660, 200, { ratio: 1, axis: 'y', flip: 'false', ...note([
      'Perspective 2D (floor): the whole trick. It divides the picture by its distance from the horizon, so rows near the horizon are stretched over huge distances and rows at the bottom over short ones: a flat plane seen at a slant.',
      'Its UV is the floor\'s own coordinates: x across the hall, y along it (0 under your feet, growing toward the horizon). Depth is 0 at the bottom of the frame and 1 at the horizon.',
    ]) }, { uv: ['floorIn', 'result'] }),
    n('perspective2d', 'ceilP', 660, 560, { ratio: 1, axis: 'y', flip: 'true', ...note([
      'Perspective 2D (ceiling): the same divide, flipped, for the plane above. Its UV runs along the ceiling the other way (its y goes negative toward the horizon), which the ceiling\'s shading turns round.',
    ]) }, { uv: ['ceilIn', 'result'] }),
    expr('floor', 1000, 200, {
      label: 'Polished concrete floor', outputType: 'vec3',
      inputs: [['f', 'vec2', ['floorP', 'uv']], ['uv', 'vec2', ['uv', 'uv']]],
      lines: [
        ['float z', 'f.y + t * 0.6'],
        ['vec2 s', 'vec2(f.x + 1.0, z) * 0.5'],
        ['vec2 sid', 'floor(s)'],
        ['vec2 sf', 'abs(fract(s) - 0.5)'],
        ['float slab', 'smoothstep(0.497, 0.485, max(sf.x, sf.y))'],
        ['float tone', '0.82 + 0.18 * fract(sin(dot(sid, vec2(12.9898, 78.233))) * 43758.5453)'],
        ['float lz', 'mod(z, 3.0) - 1.5'],
        ['float pool', '1.0 / (1.0 + (f.x * f.x + lz * lz) * 0.9)'],
        ['float k', '3.0 / max(-uv.y, 0.002)'],
        ...panelSd('uv.x * k', 'k - 1.0 + t * 0.6'),
        ['float rough', '0.05 + 0.02 * k'],
        ['float mirror', 'exp(-max(panel, 0.0) / rough)'],
        ['float fresnel', 'mix(0.18, 0.9, smoothstep(-0.5, 0.0, uv.y))'],
        ['vec3 concrete', 'vec3(0.31, 0.325, 0.34) * tone * (0.6 + 0.4 * slab)'],
      ],
      result: 'concrete * (0.04 + 0.85 * pool) + vec3(1.0, 0.87, 0.7) * mirror * fresnel * 0.55 * (0.7 + 0.3 * slab)',
      note: [
        'Polished concrete floor, shaded in the floor\'s own coordinates (from Perspective 2D), so slabs, light and reflections all shrink toward the horizon by themselves.',
        'z: how far along the hall, walking forward at 0.6 units a second (t is the clock).',
        's, sid, sf: slabs 2 × 2 units (shifted 1 across so a slab, not a seam, runs down the middle); sid numbers each slab, sf is where we are inside it.',
        'slab: 1 on a slab, 0 in the thin seams between them. tone: each slab a slightly different grey (a hash of its number).',
        'lz, pool: a soft pool of light under each ceiling panel (one every 3 units), fading with distance across and along.',
        'k: the mirror trick. In a polished floor you see the ceiling as if it were 3 units below you (1 down to the floor, 2 more to the mirrored ceiling), so the same screen row reaches 3 times further: k is that distance.',
        'pz, pd, panel: the ceiling panels measured at the mirrored place (the same rule the ceiling uses).',
        'rough, mirror: the panels\' reflection, blurrier the further away it is, so it smears into long streaks like a real polished floor.',
        'fresnel: reflections are faint looking down and strong at a glancing angle near the horizon.',
        'result: the concrete lit by the pools, plus the warm mirrored panels.',
      ],
    }),
    expr('ceiling', 1000, 560, {
      label: 'Ceiling with light panels', outputType: 'vec3',
      inputs: [['c', 'vec2', ['ceilP', 'uv']]],
      lines: [
        ['float z', '-c.y + t * 0.6'],
        ...panelSd('c.x', 'z'),
        ['float lamp', 'smoothstep(0.012, -0.012, panel)'],
        ['float spill', 'exp(-max(panel, 0.0) * 2.5)'],
        ['float rib', 'smoothstep(0.03, 0.0, abs(mod(c.x, 3.0) - 1.5) - 0.02)'],
      ],
      result: 'vec3(0.2, 0.2, 0.21) * (0.05 + 0.3 * spill) * (1.0 - 0.5 * rib) + vec3(1.0, 0.9, 0.76) * lamp * 1.4',
      note: [
        'Ceiling with light panels, in the ceiling\'s coordinates: its y runs the other way, so z = −y, and it walks forward with the floor.',
        'pz, pd, panel: one light panel every 3 units along the hall, 1.8 wide and 0.5 deep, as a distance (negative inside).',
        'lamp: the panel itself, a warm white (about 3000 K), a little over 1 so it stays the brightest thing in frame.',
        'spill: the concrete round each panel catching its light.',
        'rib: thin dark joints in the ceiling every 3 units across, half way between the rows of light, so its surface reads.',
        'result: dim concrete, lit near the panels, and the panels.',
      ],
    }),
    expr('grade', 1360, 360, {
      label: 'Hall: fog and grade', outputType: 'vec3',
      inputs: [['uv', 'vec2', ['uv', 'uv']], ['floorCol', 'vec3', ['floor', 'result']], ['ceilCol', 'vec3', ['ceiling', 'result']], ['depth', 'float', ['floorP', 'depth']]],
      lines: [
        ['float dist', '1.0 / max(abs(uv.y), 0.002)'],
        ['vec3 col', 'uv.y < 0.0 ? floorCol : ceilCol'],
        ['float fog', '1.0 - exp(-dist * 0.05)'],
        ['vec3 haze', 'vec3(0.13, 0.125, 0.13) * (0.5 + 0.5 * exp(-abs(uv.x) * 2.0))'],
        ['col', 'mix(col, haze, fog)'],
        ['col', '1.0 - exp(-col * 1.6)'],
        ['col', 'col + vec3(0.004, 0.006, 0.01)'],
        ['float vig', '1.0 - 0.4 * dot(uv * vec2(0.5, 0.8), uv * vec2(0.5, 0.8))'],
        ['float grain', '(fract(sin(dot(uv * 517.0 + fract(t) * 13.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.014'],
      ],
      result: 'max(col * vig + grain, 0.0)',
      note: [
        'Hall: fog and grade. The floor shows below the horizon and the ceiling above it.',
        'dist: how far away this pixel\'s floor or ceiling is (1 / |y|: both planes are 1 unit from the eye). The floor\'s Depth output says the same on a 0 to 1 scale; it is wired in for you to try (mix by depth instead of dist).',
        'fog: the far end of the hall fades into a dim haze, slightly brighter down the middle where the lights are.',
        'Then a soft tone curve (nothing clips), a faint blue lift in the blacks, a vignette, and fine film grain so the gradients don\'t band.',
      ],
    }),
    n('output', 'out', 1700, 360, note('Output: the graded hall.'), { color: ['grade', 'result'] }),
  ];
}

export function buildCuratedExamples(): Record<string, ExampleGraph> {
  return {
    perspectivePlanes: { ...CURATED_EXAMPLE_INDEX.perspectivePlanes, counter: 20, nodes: hallOfLights() },
  };
}
