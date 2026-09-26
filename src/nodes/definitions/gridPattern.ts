import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, pv3, fieldFn } from './helpers';
import { GLSL_MAT2_INV } from './matrixOps';

/**
 * Lattices: the cell centres as a basis matrix (columns are the two steps
 * between neighbouring centres, in cell units, so centres are 1 apart like
 * the square grid). Cells are the region nearest each centre, except
 * Triangle, which splits each rhombus of a lattice into two triangles.
 */
const LATTICE_BASIS: Record<string, [number, number, number, number]> = {
  hex:      [1, 0, 0.5, Math.sqrt(3) / 2],
  brick:    [1, 0, 0.5, 1],
  diamond:  [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2],
  triangle: [Math.sqrt(3), 0, Math.sqrt(3) / 2, 1.5],
};
const glslNum = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${+v.toFixed(7)}`);
const mat2Lit = (m: number[]) => `mat2(${m.map(glslNum).join(', ')})`;
/** Inverse of a column-major [a, b, c, d] mat2. */
const inv2 = ([a, b, c, d]: number[]) => { const det = a * d - c * b; return [d / det, -b / det, -c / det, a / det]; };

/**
 * Grid Pattern — the whole "shapes on a grid" recipe in one node.
 *
 * Grid → Circle SDF on the Cell UV → Cell Filter → SDF Fill is the standard
 * chain, and it stays available for anything unusual.
 *
 * Three ways to choose the shape:
 *   - the built-in dropdown (nothing wired);
 *   - one wire: any SDF into the Shape field socket (and/or a colour chain
 *     into Picture). The chain is compiled as a function and called once per
 *     cell in the cell's effected coordinates, and for the neighbouring cells
 *     too when Overflow is on, so shapes can cross cell borders;
 *   - two nodes: Cell UV → anything → Grid Paint, for full control. This node does the
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
  description: 'Shapes on a grid: which cells get one (all, every other column or row, checker, diagonals, random) and a point that affects the shapes near it (grow, shrink, pull, push, hide, spin). For a shape of your own, wire any SDF (Circle SDF, Shape SDF…) straight into Shape, or a colour chain into Picture: it is drawn once per cell in that cell’s coordinates, and a Cell node inside the chain gives the cell’s ID for per-cell variation. Or take Cell UV into anything and finish with Grid Paint. With nothing wired, the built-in shape is drawn. Overflow lets shapes cross cell borders. Lattice makes the grid hexagons, bricks, diamonds, triangles, or any basis matrix wired into Basis. Also outputs the mask, the SDF and the raw grid (Cell ID, Cell Center, Influence, Placed).',
  inputs: {
    uv:         { type: 'vec2',  label: 'UV' },
    shape:      { type: 'float', label: 'Shape', field: true, hint: 'Wire an SDF (Circle SDF, Shape SDF, a union…): it is drawn in every placed cell, in the cell’s coordinates (−0.5…0.5, with the pattern’s effects). The wired chain is evaluated per cell, so a Cell node inside it varies the shape per cell. Unwired: the built-in shape.' },
    picture:    { type: 'vec3',  label: 'Picture', field: true, hint: 'Wire a colour chain (Palette, FBM → Palette, a texture): evaluated per cell in the cell’s coordinates. Colours the shape, or fills the whole cell when Shape is unwired.' },
    columns:    { type: 'float', label: 'Columns', hint: 'Cells across; the same count as the Grid node, so the two line up.' },
    size:       { type: 'float', label: 'Size', hint: 'Shape size as a fraction of the cell (0.5 touches the cell edge).' },
    affectPos:  { type: 'vec2',  label: 'Affect Pos', hint: 'The point that affects nearby shapes: wire Mouse UV, or a null from Play. Unwired, it is the centre of the picture.' },
    affectAmount: { type: 'float', label: 'Affect Amount', hint: 'How strongly the point affects shapes inside its radius (0 = not at all).' },
    color:      { type: 'vec3',  label: 'Colour', hint: 'Wire a Palette for per-cell colour, or pick a colour below.' },
    background: { type: 'vec3',  label: 'Background' },
    basis:      { type: 'mat2',  label: 'Basis', hint: 'Lattice: Custom. A mat2 whose columns are the two steps from one cell centre to its neighbours (Scale, Shear, Stretch and Rotation Matrix, multiplied together). Identity is the square grid.' },
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
    columns: 8.0, lattice: 'square', shape: 'circle', size: 0.3, overflow: 'none', rotation: 0.0, jitter: 0.0, antialias: 0.02,
    pattern: 'all', density: 0.5,
    affect: 'grow', affectRadius: 0.6, affectSoftness: 0.7, affectAmount: 1.0,
    color: [0.95, 0.85, 0.6], background: [0.06, 0.06, 0.09],
  },
  paramDefs: {
    columns:  { label: 'Columns', type: 'float', min: 1, max: 60, step: 1, hint: 'Cells across the width.' },
    lattice:  { label: 'Lattice', type: 'select', options: [
      { value: 'square',   label: 'Square' },
      { value: 'hex',      label: 'Hexagons' },
      { value: 'brick',    label: 'Brick (offset rows)' },
      { value: 'diamond',  label: 'Diamonds (45°)' },
      { value: 'triangle', label: 'Triangles' },
      { value: 'custom',   label: 'Custom (Basis input)' },
    ], hint: 'The shape of the grid itself. Every lattice is a basis matrix: the two steps between neighbouring cell centres. Custom takes that matrix from the Basis input, so matrix nodes can stretch, shear and turn the whole grid.' },
    shape:    { label: 'Built-in shape', type: 'select', hint: 'Drawn when nothing is wired into Shape (or Picture).', options: [
      { value: 'circle',  label: 'Circle' },
      { value: 'box',     label: 'Square' },
      { value: 'diamond', label: 'Diamond' },
      { value: 'ring',    label: 'Ring' },
      { value: 'cross',   label: 'Cross' },
      { value: 'triangle', label: 'Triangle' },
    ] },
    size:     { label: 'Size', type: 'float', min: 0.02, max: 1.0, step: 0.01, hint: 'Built-in shape only: fraction of the cell. 0.5 fills the cell edge to edge; above that neighbours touch (turn Overflow on so they are not clipped).' },
    overflow: { label: 'Overflow', type: 'select', options: [
      { value: 'none',       label: 'Clip at the cell edge' },
      { value: 'neighbours', label: 'Neighbours (3×3)' },
      { value: 'far',        label: 'Far (5×5)' },
    ], hint: 'Draws the shapes of the neighbouring cells too, so a shape that is pulled, pushed, grown or jittered past its cell edge carries on into the next cell instead of being cut off. Pull and Push can then move a shape a whole cell. Costs 9× (Neighbours) or 25× (Far) shape evaluations.' },
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
  glslFunctions: [GLSL_MAT2_INV, `// Nearest lattice centre (as a lattice index) to gp, for basis B with inverse Bi.
vec2 gpNearest(vec2 gp, mat2 B, mat2 Bi) {
    vec2 k0 = floor(Bi * gp + 0.5);
    vec2 best = k0; float bd = 1e9;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 k = k0 + vec2(float(i), float(j));
        vec2 d = gp - B * k;
        float dd = dot(d, d);
        if (dd < bd) { bd = dd; best = k; }
    }
    return best;
}`],
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
    // Field sockets: function names, or undefined when unwired (see helpers.fieldFn).
    const shapeFn = fieldFn(inputVars.shape);
    const picFn = fieldFn(inputVars.picture);
    const overflow = String(node.params.overflow ?? 'none');
    const reach = overflow === 'far' ? 2 : overflow === 'neighbours' ? 1 : 0;
    const shapeLit = `${shapeIdx < 0 ? 0 : shapeIdx}.0`;
    const patternLit = `${patternIdx < 0 ? 0 : patternIdx}.0`;
    // Pull/push stop at the cell edge unless the neighbours are drawn too.
    const pushK = reach > 0 ? '1.0' : '0.45';
    // Lattice: square keeps the plain floor/fract grid; the others work in a basis.
    const latticeParam = String(node.params.lattice ?? 'square');
    const lattice = latticeParam === 'custom' || LATTICE_BASIS[latticeParam] ? latticeParam : 'square';
    const tri = lattice === 'triangle';
    const basisExpr = lattice === 'custom' ? (inputVars.basis ?? 'mat2(1.0)') : lattice === 'square' ? '' : mat2Lit(LATTICE_BASIS[lattice]);
    const basisInv = lattice === 'custom' ? `m2Inv(${id}_B)` : lattice === 'square' ? '' : mat2Lit(inv2(LATTICE_BASIS[lattice]));

    /** One cell frame's SDF, evaluated in its effected coordinates. */
    const shapeAt = (rq: string, cid: string, inf: string) =>
      shapeFn ? `${shapeFn}(${rq}, ${cid}, ${inf}, 0.0)`
        : picFn ? `sdBox(${rq}, vec2(0.5))`   // a picture alone fills its (effected) cell
        : `gpShape(${rq}, ${shapeLit}, ${size})`;
    const colourAt = (rq: string, cid: string, inf: string) => (picFn ? `${picFn}(${rq}, ${cid}, ${inf}, 0.0)` : col);
    const pictureOnly = !shapeFn && !!picFn;
    /** The affect point's effect on one frame; `v` names its variables (`${v}q`, `${v}sc`, …). */
    const effects = (v: string, ind: string): string[] => {
      const out: string[] = [];
      if (affect === 'grow') out.push(`${ind}${v}sc = 1.0 + ${v}inf;`);
      if (affect === 'shrink') out.push(`${ind}${v}sc = max(0.001, 1.0 - ${v}inf);`);
      if (affect === 'pull' || affect === 'push') {
        const sgn = affect === 'pull' ? '' : '-';
        out.push(`${ind}vec2 ${v}dir = ${ap} - ${v}cc; ${v}dir = length(${v}dir) > 1e-4 ? normalize(${v}dir) : vec2(0.0);`);
        out.push(`${ind}${v}q -= ${sgn}${v}dir * ${v}inf * ${pushK};`);
      }
      if (affect === 'hide') out.push(`${ind}${v}on *= 1.0 - min(1.0, ${v}inf);`);
      if (affect === 'spin') out.push(`${ind}${v}ang += ${v}inf * 3.14159;`);
      return out;
    };
    const rotated = (v: string) => `vec2(cos(${v}ang) * ${v}q.x - sin(${v}ang) * ${v}q.y, sin(${v}ang) * ${v}q.x + cos(${v}ang) * ${v}q.y) / ${v}sc`;

    const h = `${id}_`;
    const cellLines = lattice === 'square' ? [
      `    vec2  ${id}_cid  = floor(${id}_gp);`,
      `    vec2  ${id}_cc   = (${id}_cid + 0.5) * ${id}_cell;`,
      `    vec2  ${id}_q    = fract(${id}_gp) - 0.5 - (gpHash2(${id}_cid) - 0.5) * ${jit};`,
    ] : [
      // The lattice as a basis matrix B (columns: the steps between neighbouring centres).
      `    mat2  ${id}_B    = ${basisExpr};`,
      `    mat2  ${id}_Bi   = ${basisInv};`,
      ...(tri ? [
        // Triangles: each rhombus of the lattice holds an up and a down triangle (flip 0 / 1).
        `    vec2  ${id}_L    = ${id}_Bi * ${id}_gp;`,
        `    vec2  ${id}_k    = floor(${id}_L);`,
        `    float ${id}_flip = step(1.0, ${id}_L.x - ${id}_k.x + ${id}_L.y - ${id}_k.y);`,
        `    vec2  ${id}_cid  = vec2(${id}_k.x * 2.0 + ${id}_flip, ${id}_k.y);`,
        `    vec2  ${id}_ctr  = ${id}_B * (${id}_k + mix(vec2(0.3333333), vec2(0.6666667), ${id}_flip));`,
      ] : [
        `    vec2  ${id}_k    = gpNearest(${id}_gp, ${id}_B, ${id}_Bi);`,
        `    float ${id}_flip = 0.0;`,
        `    vec2  ${id}_cid  = ${id}_k;`,
        `    vec2  ${id}_ctr  = ${id}_B * ${id}_k;`,
      ]),
      `    vec2  ${id}_cc   = ${id}_ctr * ${id}_cell;`,
      `    vec2  ${id}_q    = ${id}_gp - ${id}_ctr - (gpHash2(${id}_cid) - 0.5) * ${jit};`,
    ];
    const lines = [
      `    float ${id}_asp  = u_resolution.x / u_resolution.y;`,
      `    float ${id}_cell = ${id}_asp / ${cols};`,
      `    vec2  ${id}_gp   = ${uv} / ${id}_cell;`,
      ...cellLines,
      `    float ${id}_sc   = 1.0;`,
      `    float ${id}_ang  = ${rot}${lattice === 'square' ? '' : ` + ${id}_flip * 3.14159`};`,
      `    float ${id}_on   = gpPlaced(${id}_cid, ${patternLit}, ${dens});`,
      // Influence: 1 at the point, 0 at the radius; softness widens the fade inward. Always an output, whatever Affect does with it.
      `    float ${id}_inf  = smoothstep(${radius}, ${radius} * (1.0 - ${soft}), length(${ap} - ${id}_cc)) * ${amount};`,
      ...effects(h, '    '),
      // The cell's coordinates with every effect applied: rotated, then scaled so a shape drawn in them grows or shrinks.
      `    vec2  ${id}_rq   = ${rotated(h)};`,
    ];
    if (reach === 0) {
      lines.push(
        `    float ${id}_d    = mix(10.0, ${shapeAt(`${id}_rq`, `${id}_cid`, `${id}_inf`)}, step(0.5, ${id}_on));`,
        pictureOnly
          ? `    float ${id}_mask = ${id}_on;`
          : `    float ${id}_mask = (1.0 - smoothstep(-${aa}, ${aa}, ${id}_d)) * ${id}_on;`,
        `    vec3  ${id}_col  = mix(${bg}, ${colourAt(`${id}_rq`, `${id}_cid`, `${id}_inf`)}, ${id}_mask);`,
      );
    } else {
      // Overflow: also draw the shapes of the neighbouring cells (3×3 or 5×5),
      // each in its own frame (its jitter, placement, influence and effects),
      // so a shape pulled, grown or offset past its cell edge continues into
      // the next cell. Distances combine with min. Colours composite over in
      // one fixed order (row by row, by cell id), so where two cells' shapes
      // overlap the same one is on top on both sides of the border; putting
      // the pixel's own cell last would flip the order at every cell edge
      // and cut overlapping shapes along it. Distances are scaled back to
      // cell units so frames of different scales compare.
      const n = `${id}_n`;
      const maskOf = (d: string) => (pictureOnly ? `step(${d}, 0.0)` : `(1.0 - smoothstep(-${aa}, ${aa}, ${d}))`);
      const ind = tri ? '                ' : '            ';
      // Where the neighbour's cell is: the square grid steps its id; a lattice steps its lattice index.
      const frame = lattice === 'square' ? [
        `${ind}vec2  ${n}cid = ${id}_cid + ${n}o;`,
        `${ind}vec2  ${n}cc  = (${n}cid + 0.5) * ${id}_cell;`,
        `${ind}vec2  ${n}q   = ${id}_fp - 0.5 - ${n}o - (gpHash2(${n}cid) - 0.5) * ${jit};`,
      ] : [
        ...(tri ? [
          `${ind}float ${n}flip = float(${id}_t);`,
          `${ind}vec2  ${n}cid = vec2((${id}_k.x + ${n}o.x) * 2.0 + ${n}flip, ${id}_k.y + ${n}o.y);`,
          `${ind}vec2  ${n}ctr = ${id}_B * (${id}_k + ${n}o + mix(vec2(0.3333333), vec2(0.6666667), ${n}flip));`,
        ] : [
          `${ind}float ${n}flip = 0.0;`,
          `${ind}vec2  ${n}cid = ${id}_k + ${n}o;`,
          `${ind}vec2  ${n}ctr = ${id}_B * ${n}cid;`,
        ]),
        `${ind}vec2  ${n}cc  = ${n}ctr * ${id}_cell;`,
        `${ind}vec2  ${n}q   = ${id}_gp - ${n}ctr - (gpHash2(${n}cid) - 0.5) * ${jit};`,
      ];
      lines.push(
        `    float ${id}_d    = 10.0;`,
        `    float ${id}_mask = 0.0;`,
        `    vec3  ${id}_col  = ${bg};`,
        ...(lattice === 'square' ? [`    vec2  ${id}_fp   = fract(${id}_gp);`] : []),
        `    for (int ${id}_j = -${reach}; ${id}_j <= ${reach}; ${id}_j++) {`,
        `        for (int ${id}_i = -${reach}; ${id}_i <= ${reach}; ${id}_i++) {`,
        ...(tri ? [`            for (int ${id}_t = 0; ${id}_t <= 1; ${id}_t++) {`] : []),
        `${ind}vec2  ${n}o   = vec2(float(${id}_i), float(${id}_j));`,
        ...frame,
        `${ind}float ${n}sc  = 1.0;`,
        `${ind}float ${n}ang = ${rot}${lattice === 'square' ? '' : ` + ${n}flip * 3.14159`};`,
        `${ind}float ${n}on  = gpPlaced(${n}cid, ${patternLit}, ${dens});`,
        `${ind}float ${n}inf = smoothstep(${radius}, ${radius} * (1.0 - ${soft}), length(${ap} - ${n}cc)) * ${amount};`,
        ...effects(n, ind),
        `${ind}vec2  ${n}rq  = ${rotated(n)};`,
        `${ind}float ${n}d   = mix(10.0, ${shapeAt(`${n}rq`, `${n}cid`, `${n}inf`)} * ${n}sc, step(0.5, ${n}on));`,
        `${ind}float ${n}m   = ${maskOf(`${n}d`)} * ${n}on;`,
        `${ind}${id}_d    = min(${id}_d, ${n}d);`,
        `${ind}${id}_mask = max(${id}_mask, ${n}m);`,
        `${ind}${id}_col  = mix(${id}_col, ${colourAt(`${n}rq`, `${n}cid`, `${n}inf`)}, ${n}m);`,
        ...(tri ? [`            }`] : []),
        `        }`,
        `    }`,
      );
    }
    return {
      code: lines.join('\n') + '\n',
      outputVars: {
        color: `${id}_col`, mask: `${id}_mask`, distance: `${id}_d`, influence: `${id}_inf`,
        cellUV: `${id}_rq`, scale: `${id}_sc`, cellID: `${id}_cid`, cellCenter: `${id}_cc`, placed: `${id}_on`,
      },
    };
  },
};
