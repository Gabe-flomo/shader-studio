/**
 * Neighbours (docs/agents-group.md "Neighbours"): the walkers near this one, read from the
 * group's spatial grid rather than through a trail.
 *
 * A group with a Neighbours node inside builds a grid every step, before its rule
 * (kit/agentPlan.js agNbLayout, kit/agentShaders.js AG_NB_BIN_VERT, run by lib/agentRunner.ts
 * and kit/agentHost.js): every live walker is binned into a cell at least the largest Radius
 * across, with an exact count per cell and up to 8 walkers per cell kept in slots (the highest
 * numbered ones, the same on every run). A query here visits the 3 × 3 cells round the walker
 * (3 × 3 × 3 in 3D), reads a fixed share of each cell's slots (Max neighbours ÷ 9, or ÷ 27),
 * keeps those within Radius, and weighs each cell by its count over what it read. So the
 * outputs are exact while no cell holds more walkers than it reads, and an unbiased estimate
 * (from a fixed, well-mixed sample) in a denser crowd.
 *
 * The update shader's header (compiler/shaderAssembler.ts, `neighbours`) declares the grid's
 * samplers and the helpers this code calls: agNbGrid(), agNbCount(texel), agNbSlot(slot, texel)
 * and agNbOther(index) (velocity and species of another walker), so the code here is the same
 * for every group.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';
import { AG_NB_GLSL } from '../../play/kit/agentShaders.js';
import { agNbCells, agNbTile, AG_NB_SLOTS } from '../../play/kit/agentPlan.js';
import { agentNbUniforms, agentStateUniform, isAgent3d } from './agents';

const THIS_AGENT = 'Unwired: this walker\'s own (the card shows "← this walker\'s …").';

export const NEIGHBOUR_SPECIES = [
  { value: 'all', label: 'Everyone' }, { value: 'own', label: 'Its own kind' }, { value: 'others', label: 'Other kinds' },
  { value: '1', label: 'Species 1' }, { value: '2', label: 'Species 2' }, { value: '3', label: 'Species 3' }, { value: '4', label: 'Species 4' },
];

/**
 * The update shader's neighbour helpers for a group (its slug, state side, per-walker state and
 * space): the grid's samplers and four functions the Neighbours node's code calls.
 */
export function agentNbHeader(slug: string, stateC: boolean, d3: boolean): string {
  const u = agentNbUniforms(slug);
  const tw = agNbTile(d3)[0];
  const B = agentStateUniform(slug, 'B');
  const species = stateC ? `texelFetch(${agentStateUniform(slug, 'C')}, ivec2(t), 0).x` : 'mod(i, a_speciesCount)';
  return [
    `uniform highp sampler2D ${u.a};`,
    `uniform highp sampler2D ${u.b};`,
    `uniform highp sampler2D ${u.n};`,
    `uniform vec4 ${u.g};`,
    `vec4 agNbGrid() { return ${u.g}; }`,
    `float agNbCount(vec2 t) { return texelFetch(${u.n}, ivec2(t), 0).x; }`,
    `vec4 agNbSlot(float j, vec2 t) { vec2 q = t + vec2(floor(j * 0.5) * ${tw}.0, 0.0); return mod(j, 2.0) < 0.5 ? texelFetch(${u.a}, ivec2(q), 0) : texelFetch(${u.b}, ivec2(q), 0); }`,
    `vec4 agNbOther(float i) { vec2 t = vec2(mod(i, float(a_side)), floor(i / float(a_side))); vec4 b = texelFetch(${B}, ivec2(t), 0); return vec4(b.x, b.y, ${d3 ? 'b.z' : '0.0'}, ${species}); }`,
  ].join('\n');
}

const sel = (v: unknown, allowed: string[], fallback: string) => (typeof v === 'string' && allowed.includes(v) ? v : fallback);

export const AgentNeighboursNode: NodeDefinition = {
  type: 'agentNeighbours',
  label: 'Neighbours',
  category: 'Simulation',
  aliases: ['Nearby walkers', 'Flocking', 'Boids', 'Separation', 'Cohesion', 'Alignment', 'Crowd density', 'Spatial grid', 'Nearest neighbour'],
  description: 'Inside an Agents group: the other walkers within Radius of this one, found through a grid the group builds every step. Count, their Centre, their Heading (average velocity), Push (away from them, harder the closer they are) and the Nearest distance. Boids and crowds from the walkers themselves, not from a trail.',
  brief: {
    summary: 'The walkers near this one: how many, where their middle is, which way they go, and a push away from them.',
    start: [
      'Separation: add Push (times a weight) to the walker\'s velocity.',
      'Cohesion: steer toward Centre − Position. Alignment: steer toward Heading.',
      'Crowding: slow down as Count rises.',
    ],
  },
  inputs: {
    position: { type: 'vec2', label: 'Position', hint: `Where to look round. ${THIS_AGENT}` },
  },
  outputs: {
    count: { type: 'float', label: 'Count', hint: 'How many walkers are within Radius (not counting this one). In a crowd denser than Max neighbours lets it read, an estimate from the ones it read.' },
    centre: { type: 'vec2', label: 'Centre', hint: 'Their average position (its own position when there are none). Centre − Position points toward them: cohesion.' },
    heading: { type: 'vec2', label: 'Heading', hint: 'Their average velocity (0 when there are none): alignment.' },
    push: { type: 'vec2', label: 'Push', hint: 'Away from them: the sum of a unit vector away from each, times Radius ÷ its distance (1 at the edge of Radius, 2 at half of it). Separation.' },
    nearest: { type: 'float', label: 'Nearest', hint: 'The distance to the nearest one (Radius when there are none).' },
  },
  defaultParams: { radius: 0.05, max: 36, species: 'all', edges: 'wrap' },
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0.005, max: 0.5, step: 0.001, hint: 'How far it looks, in picture units (the picture is 2 tall).', help: 'How far it looks, in picture units (the picture is 2 tall). The group\'s grid cells are at least this big (the largest Radius of its Neighbours nodes), so a bigger radius means bigger cells and more walkers in each.' },
    max: { label: 'Max neighbours', type: 'float', min: 1, max: 216, step: 1, hint: 'How many walkers it reads at most (cost). In a crowd denser than this the outputs are estimates.', help: 'How many walkers it reads at most: Max ÷ 9 from each of the 9 cells round it (÷ 27 of 27 in 3D), at most 8 a cell. That is the cost. While no cell holds more walkers than it reads, the outputs are exact; in a denser crowd each cell is weighed by how many it holds, so Count, Centre, Heading and Push are estimates from a fixed sample.' },
    species: { label: 'Which', type: 'select', hint: 'Which walkers count.', options: NEIGHBOUR_SPECIES },
    edges: { label: 'Across edges', type: 'select', hint: 'Wrap: a walker near the right edge sees the ones near the left (for Wrap edges). Stop: the edges are walls.', options: [
      { value: 'wrap', label: 'Wrap (sees across)' }, { value: 'stop', label: 'Stop (edges are walls)' },
    ] },
  },
  assignable: false,
  glslFunctions: [AG_NB_GLSL],
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const d3 = isAgent3d(node);
    const V = d3 ? 'vec3' : 'vec2';
    const sw = d3 ? '' : '.xy';
    const radius = p(node.params.radius, 0.05);
    // The eye preview (an agent at each pixel) has no grid: nobody near.
    if (node.params.__agentEye === true) {
      return { code: '', outputVars: { count: '0.0', centre: v.position ?? 'a_pos', heading: `${V}(0.0)`, push: `${V}(0.0)`, nearest: radius } };
    }
    const nc = agNbCells(d3);
    const wrap = sel(node.params.edges, ['wrap', 'stop'], 'wrap') === 'wrap';
    const which = sel(node.params.species, NEIGHBOUR_SPECIES.map(o => o.value), 'all');
    const speciesOk = which === 'all' ? '' : which === 'own' ? `abs(${id}_x.w - a_species) < 0.5` : which === 'others' ? `abs(${id}_x.w - a_species) > 0.5` : `abs(${id}_x.w - ${Number(which) - 1}.0) < 0.5`;
    const pos = v.position ? (d3 ? v.position : `vec3(${v.position}, 0.0)`) : (d3 ? 'a_pos' : 'vec3(a_pos, 0.0)');
    const offset = d3
      ? `vec3(mod(float(${id}_k), 3.0), mod(floor(float(${id}_k) / 3.0), 3.0), floor(float(${id}_k) / 9.0)) - 1.0`
      : `vec3(mod(float(${id}_k), 3.0) - 1.0, floor(float(${id}_k) / 3.0) - 1.0, 0.0)`;
    const axes = d3 ? ['x', 'y', 'z'] : ['x', 'y'];
    const L = (s: string, depth = 1) => `${'    '.repeat(depth)}${s}\n`;
    const cellOk = wrap
      // Wrapping round a grid fewer than 3 cells across would visit a cell twice: each axis visits only its distinct cells.
      ? [...axes.map(a => L(`if (${id}_G.${a} < 2.5 && !(${id}_o.${a} == 0.0 || (${id}_G.${a} > 1.5 && ${id}_o.${a} > 0.5))) ${id}_ok = 0.0;`, 2)), L(`${id}_q = mod(${id}_q, ${id}_G.xyz);`, 2)]
      : [L(`if (${axes.map(a => `${id}_q.${a} < 0.0 || ${id}_q.${a} > ${id}_G.${a} - 0.5`).join(' || ')}) ${id}_ok = 0.0;`, 2)];
    const keep = [
      L(`${id}_cn += 1.0;`, 6),
      L(`${id}_cs += ${id}_d;`, 6),
      L(`${id}_cv += ${id}_x.xyz;`, 6),
      L(`${id}_cp -= ${id}_l > 1e-6 ? ${id}_d * (${id}_r / (${id}_l * ${id}_l)) : vec3(0.0);`, 6),
      L(`${id}_near = min(${id}_near, ${id}_l);`, 6),
    ];
    const code = [
      L(`vec3 ${id}_p = ${pos};`),
      L(`float ${id}_r = max(${radius}, 1e-4);`),
      // Slots read from each cell: Max ÷ the cells visited, 1 to 8 (the engine builds as many).
      L(`float ${id}_per = clamp(ceil(max(${p(node.params.max, 36)}, 1.0) / ${nc}.0), 1.0, ${AG_NB_SLOTS}.0);`),
      L(`vec4 ${id}_G = agNbGrid();`),
      L(`vec3 ${id}_box = vec3(${id}_G.w, 1.0, 1.0);`),
      L(`vec3 ${id}_c = agNbCell(${id}_p, ${id}_G);`),
      // This walker is in the grid (alive as the step began) in the cell of where it was then.
      L(`vec3 ${id}_own = agNbCell(${d3 ? 'a_sA.xyz' : 'vec3(a_sA.xy, 0.0)'}, ${id}_G);`),
      L(`float ${id}_in = a_sB.w > 0.0 ? 1.0 : 0.0;`),
      L(`float ${id}_n = 0.0;`),
      L(`vec3 ${id}_sum = vec3(0.0);`),
      L(`vec3 ${id}_vel = vec3(0.0);`),
      L(`vec3 ${id}_push = vec3(0.0);`),
      L(`float ${id}_near = ${id}_r;`),
      L(`for (int ${id}_k = 0; ${id}_k < ${nc}; ${id}_k++) {`),
      L(`vec3 ${id}_o = ${offset};`, 2),
      L(`vec3 ${id}_q = ${id}_c + ${id}_o;`, 2),
      L(`float ${id}_ok = 1.0;`, 2),
      ...cellOk,
      L(`if (${id}_ok > 0.5) {`, 2),
      L(`vec2 ${id}_t = agNbTexel(${id}_q, ${id}_G);`, 3),
      L(`float ${id}_s = 0.0;`, 3),
      L(`float ${id}_me = 0.0;`, 3),
      L(`float ${id}_cn = 0.0;`, 3),
      L(`vec3 ${id}_cs = vec3(0.0);`, 3),
      L(`vec3 ${id}_cv = vec3(0.0);`, 3),
      L(`vec3 ${id}_cp = vec3(0.0);`, 3),
      L(`float ${id}_more = 1.0;`, 3),
      L(`for (int ${id}_j = 0; ${id}_j < ${AG_NB_SLOTS}; ${id}_j++) {`, 3),
      L(`if (${id}_more > 0.5 && float(${id}_j) < ${id}_per) {`, 4),
      L(`vec4 ${id}_e = agNbSlot(float(${id}_j), ${id}_t);`, 5),
      L(`if (${id}_e.w < 0.5) { ${id}_more = 0.0; } else {`, 5),
      L(`${id}_s += 1.0;`, 6),
      L(`float ${id}_i = ${id}_e.w - 1.0;`, 6),
      L(`if (${id}_i == a_index) { ${id}_me = 1.0; } else {`, 6),
      L(`vec3 ${id}_d = ${id}_e.xyz - ${id}_p;`, 7),
      ...(wrap ? [L(`${id}_d -= 2.0 * ${id}_box * floor(${id}_d / (2.0 * ${id}_box) + 0.5);`, 7)] : []),
      L(`float ${id}_l = length(${id}_d);`, 7),
      L(`if (${id}_l < ${id}_r) {`, 7),
      L(`vec4 ${id}_x = agNbOther(${id}_i);`, 8),
      ...(speciesOk ? [L(`if (${speciesOk}) {`, 8), ...keep.map(s => `        ${s}`), L('}', 8)] : keep.map(s => `    ${s}`)),
      L('}', 7),
      L('}', 6),
      L('}', 5),
      L('}', 4),
      L('}', 3),
      // Weigh the cell by the walkers in it (besides this one) over those read.
      L(`float ${id}_has = max(${id}_me, ${id}_in * (1.0 - step(0.5, length(${id}_q - ${id}_own))));`, 3),
      L(`float ${id}_seen = ${id}_s - ${id}_me;`, 3),
      L(`float ${id}_w = ${id}_seen > 0.5 ? max(agNbCount(${id}_t) - ${id}_has, ${id}_seen) / ${id}_seen : 0.0;`, 3),
      L(`${id}_n += ${id}_w * ${id}_cn;`, 3),
      L(`${id}_sum += ${id}_w * ${id}_cs;`, 3),
      L(`${id}_vel += ${id}_w * ${id}_cv;`, 3),
      L(`${id}_push += ${id}_w * ${id}_cp;`, 3),
      L('}', 2),
      L('}'),
      L(`vec3 ${id}_centre = ${id}_n > 0.0 ? ${id}_p + ${id}_sum / ${id}_n : ${id}_p;`),
      L(`vec3 ${id}_head = ${id}_n > 0.0 ? ${id}_vel / ${id}_n : vec3(0.0);`),
    ].join('');
    return {
      code,
      outputVars: { count: `${id}_n`, centre: `${id}_centre${sw}`, heading: `${id}_head${sw}`, push: `${id}_push${sw}`, nearest: `${id}_near` },
    };
  },
};
