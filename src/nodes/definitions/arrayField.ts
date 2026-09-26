import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, pv3, fieldFn } from './helpers';

/**
 * Array — N copies of a shape on a line, a grid or a ring.
 *
 * The shape comes in through a field socket: whatever is wired into Shape
 * is compiled as a function of position and called once per copy, at the
 * copy's own coordinates. The copies are combined into one distance with
 * min (a union), smooth min (blobs that melt together), add, or max. A Cell
 * node inside the shape's chain gives the copy's Index (and its column and
 * row in a grid as Cell ID), so the copies can differ: radius = 0.05 + 0.02
 * × index, a colour per copy, a rotation per copy.
 *
 * With nothing wired into Shape the copies are dots of radius Dot Size, so
 * the node shows its layout as soon as it is dropped in.
 *
 * Layout names match the Play Cloner layer (docs/cloner-layer.md).
 */
const MAX_COPIES = 64;

export const ArrayFieldNode: NodeDefinition = {
  type: 'arrayField',
  label: 'Array',
  category: 'Grid',
  description: 'Repeats a shape N times on a line, a grid or a ring. Wire any SDF into Shape (and optionally a colour chain into Picture): it is evaluated once per copy in the copy’s own coordinates and the copies are combined (min, smooth min, add or max). A Cell node inside the shape’s chain gives each copy’s Index for per-copy variation. Unwired, the copies are dots.',
  inputs: {
    uv:       { type: 'vec2',  label: 'UV', hint: 'Where the array is drawn. Unwired: the canvas UV, or the cell’s coordinates when the Array itself is wired into a field socket (an array in every grid cell).' },
    shape:    { type: 'float', label: 'Shape', field: true, hint: 'Wire an SDF: it is drawn once per copy, centred on the copy. A Cell node inside its chain gives the copy’s Index. Unwired: dots.' },
    picture:  { type: 'vec3',  label: 'Picture', field: true, hint: 'Wire a colour chain: evaluated for the copy nearest each pixel, in that copy’s coordinates, and painted inside the combined shape.' },
    count:    { type: 'float', label: 'Count', hint: `How many copies (1–${MAX_COPIES}).` },
    spacing:  { type: 'vec2',  label: 'Spacing', axisParams: ['spacingX', 'spacingY'], hint: 'Distance between copies: along the line, or across and down the grid.' },
    origin:   { type: 'vec2',  label: 'Origin', axisParams: ['originX', 'originY'], hint: 'Centre of the layout.' },
    rotation: { type: 'float', label: 'Rotation', hint: 'Turns the whole layout around the origin (radians).' },
  },
  outputs: {
    color:        { type: 'vec3',  label: 'Color', hint: 'Background with the copies painted over it (Picture, or Colour).' },
    distance:     { type: 'float', label: 'Distance', hint: 'The combined SDF of every copy.' },
    mask:         { type: 'float', label: 'Mask', hint: '1 inside the combined shape, 0 outside, soft at the edge.' },
    nearestIndex: { type: 'float', label: 'Nearest Index', hint: 'Index of the copy nearest each pixel: feed a Palette for a colour per copy.' },
  },
  defaultParams: {
    layout: 'line', combine: 'min', count: 5, spacingX: 0.35, spacingY: 0.35, cols: 4,
    radius: 0.6, startAngle: 0.0, sweep: 6.2832, originX: 0.0, originY: 0.0, rotation: 0.0,
    smoothK: 0.1, turn: true, size: 0.1, antialias: 0.01,
    color: [0.95, 0.85, 0.6], background: [0.06, 0.06, 0.09],
  },
  paramDefs: {
    layout:  { label: 'Layout', type: 'select', options: [
      { value: 'line', label: 'Line' },
      { value: 'grid', label: 'Grid' },
      { value: 'ring', label: 'Ring' },
    ], hint: 'How the copies are placed.' },
    count:    { label: 'Count', type: 'float', min: 1, max: MAX_COPIES, step: 1, hint: 'How many copies.' },
    spacingX: { label: 'Spacing', type: 'float', min: 0.0, max: 2.0, step: 0.005, showWhen: { param: 'layout', value: ['line', 'grid'] }, hint: 'Distance between neighbouring copies (across, in a grid).' },
    spacingY: { label: 'Row Spacing', type: 'float', min: 0.0, max: 2.0, step: 0.005, showWhen: { param: 'layout', value: 'grid' }, hint: 'Distance between rows.' },
    cols:     { label: 'Columns', type: 'float', min: 1, max: 16, step: 1, showWhen: { param: 'layout', value: 'grid' }, hint: 'Copies per row; rows fill up as Count needs.' },
    radius:     { label: 'Ring Radius', type: 'float', min: 0.0, max: 2.0, step: 0.005, showWhen: { param: 'layout', value: 'ring' }, hint: 'Distance of the copies from the origin.' },
    startAngle: { label: 'Start Angle', type: 'float', min: -3.1416, max: 3.1416, step: 0.01, showWhen: { param: 'layout', value: 'ring' }, hint: 'Where the first copy sits (radians, 0 = right).' },
    sweep:      { label: 'Sweep', type: 'float', min: 0.0, max: 6.2832, step: 0.01, showWhen: { param: 'layout', value: 'ring' }, hint: 'How much of the circle the copies cover. A full turn spaces them evenly all the way round; less spreads them from the first to the last.' },
    originX:  { label: 'Origin X', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    originY:  { label: 'Origin Y', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    rotation: { label: 'Rotation', type: 'float', min: -3.1416, max: 3.1416, step: 0.01, hint: 'Turns the whole layout around the origin.' },
    turn:     { label: 'Turn copies', type: 'bool', hint: 'Each copy turns with the layout; on a ring, each copy’s up points away from the centre.' },
    combine:  { label: 'Combine', type: 'select', options: [
      { value: 'min',  label: 'Union (min)' },
      { value: 'smin', label: 'Smooth union' },
      { value: 'add',  label: 'Add' },
      { value: 'max',  label: 'Intersect (max)' },
    ], hint: 'How the copies’ distances make one shape.' },
    smoothK:  { label: 'Smoothness', type: 'float', min: 0.001, max: 0.5, step: 0.001, showWhen: { param: 'combine', value: 'smin' }, hint: 'How far apart copies start to melt together.' },
    size:     { label: 'Dot Size', type: 'float', min: 0.005, max: 0.5, step: 0.005, hint: 'Radius of the dots drawn when nothing is wired into Shape.' },
    antialias: { label: 'Edge', type: 'float', min: 0.001, max: 0.1, step: 0.001, hint: 'Softness of the edge in Mask and Color.' },
    color:      { label: 'Colour',     type: 'vec3color' },
    background: { label: 'Background', type: 'vec3color' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const a = `${id}_`;
    const shapeFn = fieldFn(inputVars.shape);
    const picFn = fieldFn(inputVars.picture);
    const layout = String(node.params.layout ?? 'line');
    const combine = String(node.params.combine ?? 'min');
    const turn = node.params.turn !== false;
    const uv = inputVars.uv ?? 'g_uv';
    const count = inputVars.count ?? p(node.params.count, 5);
    const spacing = inputVars.spacing ?? `vec2(${p(node.params.spacingX, 0.35)}, ${p(node.params.spacingY, 0.35)})`;
    const origin = inputVars.origin ?? `vec2(${p(node.params.originX, 0.0)}, ${p(node.params.originY, 0.0)})`;
    const rot = inputVars.rotation ?? p(node.params.rotation, 0.0);
    const aa = p(node.params.antialias, 0.01);
    const col = pv3(node.params.color, [0.95, 0.85, 0.6]);
    const bg = pv3(node.params.background, [0.06, 0.06, 0.09]);
    const ind = '        ';

    const place: string[] = [];
    if (layout === 'grid') {
      const cols = p(node.params.cols, 4);
      place.push(
        `${ind}float ${a}cols = min(${cols}, ${a}n);`,
        `${ind}float ${a}rows = ceil(${a}n / ${a}cols);`,
        `${ind}vec2  ${a}cid  = vec2(mod(${a}fi, ${a}cols), floor(${a}fi / ${a}cols + 1e-4));`,
        `${ind}vec2  ${a}pos  = vec2((${a}cid.x - (${a}cols - 1.0) * 0.5) * ${a}sp.x, ((${a}rows - 1.0) * 0.5 - ${a}cid.y) * ${a}sp.y);`,
        `${ind}float ${a}ang  = 0.0;`,
      );
    } else if (layout === 'ring') {
      const radius = p(node.params.radius, 0.6);
      const start = p(node.params.startAngle, 0.0);
      const sweep = p(node.params.sweep, 6.2832);
      place.push(
        // A full turn spaces the copies evenly all the way round; less runs first to last.
        `${ind}float ${a}full = step(6.2831, abs(${sweep}));`,
        `${ind}float ${a}ang  = ${start} + ${sweep} * ${a}fi / max(mix(${a}n - 1.0, ${a}n, ${a}full), 1.0);`,
        `${ind}vec2  ${a}cid  = vec2(${a}fi, 0.0);`,
        `${ind}vec2  ${a}pos  = ${radius} * vec2(cos(${a}ang), sin(${a}ang));`,
      );
    } else {
      place.push(
        `${ind}vec2  ${a}cid  = vec2(${a}fi, 0.0);`,
        `${ind}vec2  ${a}pos  = vec2((${a}fi - (${a}n - 1.0) * 0.5) * ${a}sp.x, 0.0);`,
        `${ind}float ${a}ang  = 0.0;`,
      );
    }
    // Each copy's own turn: the layout rotation, and on a ring its angle (so its up points outward).
    const copyTurn = !turn ? '0.0' : layout === 'ring' ? `${a}rot + ${a}ang - 1.5708` : `${a}rot`;
    const dn = shapeFn ? `${shapeFn}(${a}l, ${a}cid, 0.0, ${a}fi)` : `length(${a}l) - ${p(node.params.size, 0.1)}`;
    const init = combine === 'add' ? '0.0' : combine === 'max' ? '-1e5' : '1e5';
    const step = combine === 'smin' ? `${a}d = smin(${a}d, ${a}dn, max(${p(node.params.smoothK, 0.1)}, 1e-4));`
      : combine === 'add' ? `${a}d += ${a}dn;`
      : combine === 'max' ? `${a}d = max(${a}d, ${a}dn);`
      : `${a}d = min(${a}d, ${a}dn);`;

    const lines = [
      `    vec2  ${a}p    = ${uv};`,
      `    vec2  ${a}sp   = ${spacing};`,
      `    vec2  ${a}org  = ${origin};`,
      `    float ${a}rot  = ${rot};`,
      `    float ${a}n    = clamp(floor(${count} + 0.5), 1.0, ${MAX_COPIES}.0);`,
      `    float ${a}d    = ${init};`,
      `    float ${a}best = 1e5;`,
      `    float ${a}near = 0.0;`,
      `    vec2  ${a}nl   = vec2(0.0);`,
      `    vec2  ${a}ncid = vec2(0.0);`,
      // GLSL ES 1.00 needs a constant bound: run to the cap and stop at Count.
      `    for (int ${a}i = 0; ${a}i < ${MAX_COPIES}; ${a}i++) {`,
      `${ind}float ${a}fi   = float(${a}i);`,
      `${ind}if (${a}fi >= ${a}n) break;`,
      ...place,
      `${ind}${a}pos = vec2(cos(${a}rot) * ${a}pos.x - sin(${a}rot) * ${a}pos.y, sin(${a}rot) * ${a}pos.x + cos(${a}rot) * ${a}pos.y) + ${a}org;`,
      `${ind}vec2  ${a}l    = ${a}p - ${a}pos;`,
      `${ind}float ${a}t    = ${copyTurn};`,
      `${ind}${a}l = vec2(cos(${a}t) * ${a}l.x + sin(${a}t) * ${a}l.y, -sin(${a}t) * ${a}l.x + cos(${a}t) * ${a}l.y);`,
      `${ind}float ${a}dn   = ${dn};`,
      `${ind}${step}`,
      `${ind}if (${a}dn < ${a}best) { ${a}best = ${a}dn; ${a}near = ${a}fi; ${a}nl = ${a}l; ${a}ncid = ${a}cid; }`,
      `    }`,
      `    float ${a}mask = 1.0 - smoothstep(-${aa}, ${aa}, ${a}d);`,
      `    vec3  ${a}col  = mix(${bg}, ${picFn ? `${picFn}(${a}nl, ${a}ncid, 0.0, ${a}near)` : col}, ${a}mask);`,
    ];
    return {
      code: lines.join('\n') + '\n',
      outputVars: { color: `${a}col`, distance: `${a}d`, mask: `${a}mask`, nearestIndex: `${a}near` },
    };
  },
};
