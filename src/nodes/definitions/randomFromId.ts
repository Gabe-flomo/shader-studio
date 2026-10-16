/**
 * Random (from ID) (docs/random-from-id.md): a steady random number for each cell, copy or walker, from its
 * ID: Grid Layout's or Voxelize's Cell ID, a Repeat's cell, Loop Index, an agent's Index. The same ID always
 * gives the same number; neighbours get unrelated ones. Seed picks another set.
 *
 * The hash is the classic fract(sin(dot(id, k)) × 43758.5453) the examples wrote by hand, on a vec3 (a 2D ID
 * or a number is padded with zeros), with a second and third dot for Random colour.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';

export const RANDOM_FROM_ID_GLSL = `
float rfiHash(vec3 id, float seed) { return fract(sin(dot(id + seed * vec3(1.618, 2.718, 3.142), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`;

export const RandomFromIdNode: NodeDefinition = withParamSockets({
  type: 'randomFromId',
  label: 'Random (from ID)',
  category: 'Noise',
  aliases: ['Hash', 'Hash ID', 'Random per cell', 'Random per copy', 'Cell random', 'Random from cell', 'White noise from ID', 'Per-instance random', 'Hash 3D'],
  description: 'A steady random number for each cell, copy or walker, from its ID: Grid Layout\'s or Voxelize\'s Cell ID, a Repeat\'s cell, Loop Index. The same ID always gives the same number, neighbours unrelated ones, so each cell can get its own size, colour or height. Seed picks another set.',
  inputs: {
    id: { type: 'vec3', label: 'Cell ID (3D)', hint: 'A 3D ID: Voxelize\'s or Repeat 3D\'s Cell ID. Wins over the others.' },
    id2: { type: 'vec2', label: 'Cell ID (2D)', hint: 'A 2D ID: Grid Layout\'s Cell ID, a tile\'s floor(UV).' },
    n: { type: 'float', label: 'Number', hint: 'A single ID: Loop Index, an agent\'s Index, a counter.' },
  },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'The random number, between From and To.' },
    colour: { type: 'vec3', label: 'Random colour', hint: 'Three unrelated random numbers 0–1, as a colour.' },
    signed: { type: 'float', label: 'Signed', hint: 'The same random number from −1 to 1: for a nudge either way.' },
  },
  defaultParams: { seed: 0, from: 0, to: 1 },
  paramDefs: {
    seed: { label: 'Seed', type: 'float', min: 0, max: 100, step: 1, hint: 'Another whole set of random numbers for the same IDs.' },
    from: { label: 'From', type: 'float', min: -10, max: 10, step: 0.001, hint: 'The smallest Value can be.' },
    to: { label: 'To', type: 'float', min: -10, max: 10, step: 0.001, hint: 'The largest Value can be.' },
  },
  glslFunctions: [RANDOM_FROM_ID_GLSL],
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const src = v.id ?? (v.id2 ? `vec3(${v.id2}, 0.0)` : v.n ? `vec3(${v.n}, 0.0, 0.0)` : 'vec3(0.0)');
    const seed = p(P.seed, 0);
    return {
      code: [
        `    vec3 ${id}_id = ${src};\n`,
        `    float ${id}_h = rfiHash(${id}_id, ${seed});\n`,
        `    float ${id}_v = mix(${p(P.from, 0)}, ${p(P.to, 1)}, ${id}_h);\n`,
        `    vec3 ${id}_c = vec3(${id}_h, rfiHash(${id}_id, ${seed} + 17.0), rfiHash(${id}_id, ${seed} + 31.0));\n`,
      ].join(''),
      outputVars: { value: `${id}_v`, colour: `${id}_c`, signed: `(${id}_h * 2.0 - 1.0)` },
    };
  },
}, ['seed', 'from', 'to']);
