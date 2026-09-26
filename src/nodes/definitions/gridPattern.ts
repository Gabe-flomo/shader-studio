import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';

/**
 * Grid Pattern — the whole "shapes on a grid" recipe in one node.
 *
 * Grid → Circle SDF on the Cell UV → Cell Filter → SDF Fill is the standard
 * chain, and it stays available for anything unusual. This node does the
 * common version of it directly: cut the UV into cells, put one shape in
 * each, choose which cells get one (all, every other column or row, a
 * checkerboard, diagonal stripes, random), and let a point (the mouse, a
 * null, any vec2) affect the shapes near it: grow, shrink, pull them toward
 * it, hide them, or spin them.
 *
 * It exposes the raw grid as well (Cell UV, Cell ID, Cell Center, the SDF
 * and the influence), so the result can still be taken further with the
 * rest of the Grid family: Neighbor Dist on its Cell ID, SDF Glow on its
 * Distance, Palette on its Influence.
 *
 * The cell maths is the same as the Grid node's (cell size = aspect ÷
 * Columns), so a Grid with the same Columns lines up with it exactly.
 */
export const GridPatternNode: NodeDefinition = {
  type: 'gridPattern',
  label: 'Grid Pattern',
  category: 'Grid',
  description: 'Shapes on a grid: which cells get one (all, every other column or row, checker, diagonals, random) and a point that affects the shapes near it (grow, shrink, pull, push, hide, spin). For a shape of your own, take Cell UV (it already carries the pattern’s effects) into any SDF or colour and finish with Grid Paint; with nothing wired, the built-in shape below is drawn. Also outputs the mask, the SDF and the raw grid (Cell ID, Cell Center, Influence, Placed).',
  inputs: {
    uv:         { type: 'vec2',  label: 'UV' },
    columns:    { type: 'float', label: 'Columns', hint: 'Cells across; the same count as the Grid node, so the two line up.' },
    size:       { type: 'float', label: 'Size', hint: 'Shape size as a fraction of the cell (0.5 touches the cell edge).' },
    affectPos:  { type: 'vec2',  label: 'Affect Pos', hint: 'The point that affects nearby shapes: wire Mouse UV, or a null from Play. Unwired, it is the centre of the picture.' },
    affectAmount: { type: 'float', label: 'Affect Amount', hint: 'How strongly the point affects shapes inside its radius (0 = not at all).' },
    color:      { type: 'vec3',  label: 'Colour', hint: 'Wire a Palette for per-cell colour, or pick a colour below.' },
    background: { type: 'vec3',  label: 'Background' },
  },
  outputs: {
    color:      { type: 'vec3',  label: 'Color', hint: 'Background with the shapes painted over it.' },
    mask:       { type: 'float', label: 'Mask', hint: '1 inside a shape, 0 outside, soft at the edge.' },
    distance:   { type: 'float', label: 'Distance', hint: 'The shape SDF in cell units (negative inside). Empty cells are far outside.' },
    influence:  { type: 'float', label: 'Influence', hint: 'How much the affect point reaches this cell, 0–1. Colour or animate with it.' },
    cellUV:     { type: 'vec2',  label: 'Cell UV', hint: 'Position inside the cell, −0.5…0.5, with jitter and the affect point already applied (grow/shrink scale it, pull/push shift it, spin rotates it). Wire it into any SDF, then Grid Paint.' },
    scale:      { type: 'float', label: 'Scale', hint: 'How much the affect point scales this cell’s shape (1 = unchanged). Cell UV is already divided by it.' },
    cellID:     { type: 'vec2',  label: 'Cell ID', hint: 'Integer column and row: hash it for per-cell variation.' },
    cellCenter: { type: 'vec2',  label: 'Cell Center', hint: 'The cell’s centre in UV space.' },
    placed:     { type: 'float', label: 'Placed', hint: '1 where the pattern puts a shape in this cell, 0 where it leaves the cell empty.' },
  },
  defaultParams: {
    columns: 8.0, shape: 'circle', size: 0.3, rotation: 0.0, jitter: 0.0, antialias: 0.02,
    pattern: 'all', density: 0.5,
    affect: 'grow', affectRadius: 0.6, affectSoftness: 0.7, affectAmount: 1.0,
    color: [0.95, 0.85, 0.6], background: [0.06, 0.06, 0.09],
  },
  paramDefs: {
    columns:  { label: 'Columns', type: 'float', min: 1, max: 60, step: 1, hint: 'Cells across the width.' },
    shape:    { label: 'Built-in shape', type: 'select', hint: 'Drawn when no shape of your own comes back through Grid Paint.', options: [
      { value: 'circle',  label: 'Circle' },
      { value: 'box',     label: 'Square' },
      { value: 'diamond', label: 'Diamond' },
      { value: 'ring',    label: 'Ring' },
      { value: 'cross',   label: 'Cross' },
      { value: 'triangle', label: 'Triangle' },
    ] },
    size:     { label: 'Size', type: 'float', min: 0.02, max: 1.0, step: 0.01, hint: 'Fraction of the cell. 0.5 fills the cell edge to edge; above that neighbours touch.' },
    rotation: { label: 'Rotation', type: 'float', min: -3.1416, max: 3.1416, step: 0.01, hint: 'Turns every shape (radians).' },
    jitter:   { label: 'Jitter', type: 'float', min: 0, max: 0.5, step: 0.01, hint: 'Random offset per cell, so the grid stops looking like a grid.' },
    pattern:  { label: 'Pattern', type: 'select', options: [
      { value: 'all',      label: 'Every cell' },
      { value: 'columns',  label: 'Every other column' },
      { value: 'rows',     label: 'Every other row' },
      { value: 'checker',  label: 'Checkerboard' },
      { value: 'diagonal', label: 'Diagonal stripes' },
      { value: 'random',   label: 'Random' },
    ], hint: 'Which cells get a shape.' },
    density:  { label: 'Density', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'pattern', value: 'random' }, hint: 'Share of cells that get a shape in Random.' },
    affect:   { label: 'Affect', type: 'select', options: [
      { value: 'none',   label: 'Nothing' },
      { value: 'grow',   label: 'Grow near the point' },
      { value: 'shrink', label: 'Shrink near the point' },
      { value: 'pull',   label: 'Pull toward the point' },
      { value: 'push',   label: 'Push away from the point' },
      { value: 'hide',   label: 'Hide near the point' },
      { value: 'spin',   label: 'Spin near the point' },
    ], hint: 'What the Affect Pos point does to the shapes inside its radius.' },
    affectRadius:   { label: 'Affect Radius',   type: 'float', min: 0.05, max: 3.0, step: 0.01, hint: 'Reach of the point, in UV units (the screen is 2 tall).' },
    affectSoftness: { label: 'Affect Softness', type: 'float', min: 0.0, max: 1.0, step: 0.01, hint: '0 = a hard edge at the radius, 1 = fades all the way from the point.' },
    affectAmount:   { label: 'Affect Amount',   type: 'float', min: 0.0, max: 2.0, step: 0.01, hint: 'Strength at the point itself.' },
    antialias: { label: 'Edge', type: 'float', min: 0.002, max: 0.2, step: 0.002, hint: 'Softness of the shape edge, in cell units.' },
    color:      { label: 'Colour',     type: 'vec3color' },
    background: { label: 'Background', type: 'vec3color' },
  },
  glslFunction: `float gpHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453123); }
vec2 gpHash2(vec2 c) { return vec2(gpHash(c), gpHash(c + vec2(19.19, 7.07))); }
float gpShape(vec2 q, float shape, float s) {
    if (shape < 0.5) return length(q) - s;
    if (shape < 1.5) return sdBox(q, vec2(s));
    if (shape < 2.5) return (abs(q.x) + abs(q.y)) * 0.7071 - s * 0.7071;
    if (shape < 3.5) return abs(length(q) - s * 0.8) - s * 0.2;
    if (shape < 4.5) return min(sdBox(q, vec2(s, s * 0.3)), sdBox(q, vec2(s * 0.3, s)));
    q.x = abs(q.x) - s; q.y = q.y + s * 0.57735;
    if (q.x + 1.73205 * q.y > 0.0) q = vec2(q.x - 1.73205 * q.y, -1.73205 * q.x - q.y) * 0.5;
    q.x -= clamp(q.x, -2.0 * s, 0.0);
    return -length(q) * sign(q.y);
}
float gpPlaced(vec2 id, float pattern, float density) {
    if (pattern < 0.5) return 1.0;
    if (pattern < 1.5) return step(0.5, mod(id.x, 2.0));
    if (pattern < 2.5) return step(0.5, mod(id.y, 2.0));
    if (pattern < 3.5) return step(0.5, mod(id.x + id.y, 2.0));
    if (pattern < 4.5) return step(mod(id.x + id.y, 3.0), 0.5);
    return step(1.0 - density, gpHash(id + 0.5));
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv ?? 'g_uv';
    const cols = inputVars.columns ?? p(node.params.columns, 8.0);
    const size = inputVars.size ?? p(node.params.size, 0.3);
    const shapeIdx = ['circle', 'box', 'diamond', 'ring', 'cross', 'triangle'].indexOf(String(node.params.shape ?? 'circle'));
    const patternIdx = ['all', 'columns', 'rows', 'checker', 'diagonal', 'random'].indexOf(String(node.params.pattern ?? 'all'));
    const affect = String(node.params.affect ?? 'grow');
    const ap = inputVars.affectPos ?? 'vec2(0.0)';
    const amount = inputVars.affectAmount ?? p(node.params.affectAmount, 1.0);
    const radius = p(node.params.affectRadius, 0.6);
    const soft = p(node.params.affectSoftness, 0.7);
    const rot = p(node.params.rotation, 0.0);
    const jit = p(node.params.jitter, 0.0);
    const aa = p(node.params.antialias, 0.02);
    const dens = p(node.params.density, 0.5);
    const col = inputVars.color ?? pv3(node.params.color, [0.95, 0.85, 0.6]);
    const bg = inputVars.background ?? pv3(node.params.background, [0.06, 0.06, 0.09]);
    const lines = [
      `    float ${id}_asp  = u_resolution.x / u_resolution.y;`,
      `    float ${id}_cell = ${id}_asp / ${cols};`,
      `    vec2  ${id}_gp   = ${uv} / ${id}_cell;`,
      `    vec2  ${id}_cid  = floor(${id}_gp);`,
      `    vec2  ${id}_cc   = (${id}_cid + 0.5) * ${id}_cell;`,
      `    vec2  ${id}_q    = fract(${id}_gp) - 0.5 - (gpHash2(${id}_cid) - 0.5) * ${jit};`,
      `    float ${id}_sc   = 1.0;`,
      `    float ${id}_ang  = ${rot};`,
      `    float ${id}_on   = gpPlaced(${id}_cid, ${patternIdx < 0 ? 0 : patternIdx}.0, ${dens});`,
      // Influence: 1 at the point, 0 at the radius; softness widens the fade inward. Always an output, whatever Affect does with it.
      `    float ${id}_inf  = smoothstep(${radius}, ${radius} * (1.0 - ${soft}), length(${ap} - ${id}_cc)) * ${amount};`,
    ];
    {
      if (affect === 'grow') lines.push(`    ${id}_sc = 1.0 + ${id}_inf;`);
      if (affect === 'shrink') lines.push(`    ${id}_sc = max(0.001, 1.0 - ${id}_inf);`);
      if (affect === 'pull' || affect === 'push') {
        const sgn = affect === 'pull' ? '' : '-';
        lines.push(`    vec2 ${id}_dir = ${ap} - ${id}_cc; ${id}_dir = length(${id}_dir) > 1e-4 ? normalize(${id}_dir) : vec2(0.0);`);
        lines.push(`    ${id}_q -= ${sgn}${id}_dir * ${id}_inf * 0.45;`);
      }
      if (affect === 'hide') lines.push(`    ${id}_on *= 1.0 - min(1.0, ${id}_inf);`);
      if (affect === 'spin') lines.push(`    ${id}_ang += ${id}_inf * 3.14159;`);
    }
    lines.push(
      // The cell's coordinates with every effect applied: rotated, then scaled so a shape drawn in them grows or shrinks.
      `    vec2  ${id}_rq   = vec2(cos(${id}_ang) * ${id}_q.x - sin(${id}_ang) * ${id}_q.y, sin(${id}_ang) * ${id}_q.x + cos(${id}_ang) * ${id}_q.y) / ${id}_sc;`,
      `    float ${id}_d    = mix(10.0, gpShape(${id}_rq, ${shapeIdx < 0 ? 0 : shapeIdx}.0, ${size}), step(0.5, ${id}_on));`,
      `    float ${id}_mask = (1.0 - smoothstep(-${aa}, ${aa}, ${id}_d)) * ${id}_on;`,
      `    vec3  ${id}_col  = mix(${bg}, ${col}, ${id}_mask);`,
    );
    return {
      code: lines.join('\n') + '\n',
      outputVars: {
        color: `${id}_col`, mask: `${id}_mask`, distance: `${id}_d`, influence: `${id}_inf`,
        cellUV: `${id}_rq`, scale: `${id}_sc`, cellID: `${id}_cid`, cellCenter: `${id}_cc`, placed: `${id}_on`,
      },
    };
  },
};
