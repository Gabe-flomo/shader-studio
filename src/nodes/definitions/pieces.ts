/**
 * pieces.ts — a picture rebuilt from pieces that can move (docs/pieces.md; the plan's section 1c,
 * docs/depth-and-splats-plan.md), After Effects' CC Ball Action in Playfield.
 *
 * Every piece has a **home**: the centre of its cell on a grid laid over the picture. It takes the
 * picture's colour there (or, in Piece mode, carries the picture round its home), and is drawn at
 * home + offset. The picture isn't laid on top: it is made of the pieces, so whatever moves them
 * moves the picture.
 *
 *  - **Pieces** (2D): Picture + Shape + Pieces across + an **Offset ƒ** field socket (any vec2 chain:
 *    noise, a flow, the mouse, time) read at each piece's home, times Amount. Sizes can follow the
 *    brightness (a halftone) or a Depth texture; pieces turn (Turn, Spin, Turn ƒ per piece). Because
 *    a piece may travel far from its cell, every pixel works out which homes could have sent a piece
 *    there (the Grid builder's fixed-point inverse, #822) and searches a bounded square of cells round
 *    that home, sized live from the pieces' size and Search. Outputs: Colour (over Background), Mask,
 *    Piece ID, Home, Distance.
 *  - **Balls** (3D): one piece of a picture as a sphere or box, inside a Scene Group repeated by
 *    Repeat Scene (its per-cell centre and neighbour checks). Each ball reads the picture at its
 *    cell's centre, is lifted towards the camera by the brightness or a Depth texture, sized, and
 *    moved by a vec3 Displace wire (which is per ball, as the scene is measured once per copy).
 *    After the March Loop the same node, with Repeat Cell's Cell wired in, gives the colour of the
 *    ball each ray hit.
 *
 * Pictures are read with textureLod at level 0: the reads sit in loops (and, for Balls, in the scene
 * function the march calls), where the implicit level texture2D picks is undefined and speckles.
 *
 * The GLSL is built by `piecesCode` / `ballsCode`, exported for the tests (which run it on the CPU).
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn, p, pv3 } from './helpers';
import { texUv } from './passes';
import { CELL3_DECL, CELL3_GLOBAL, CELL3SIZE_GLOBAL } from './repeatScene';

export const PIECE_SHAPES = ['circle', 'square', 'hexagon', 'diamond', 'glyph'] as const;
export type PieceShape = typeof PIECE_SHAPES[number];
export const PIECE_SIZE_BY = ['none', 'brightness', 'darkness', 'depth'] as const;
export const PIECE_ORDER = ['moved', 'random', 'brightness'] as const;
/** The search's cap, cells each side (Near: 9 × 9 round the inverse; Every piece: 25 × 25 round the pixel). The live radius stops the loops sooner. */
export const PIECES_SEARCH_CAP = 4;
export const PIECES_FULL_CAP = 12;
/** Fixed-point steps for the inverse (h = X − offset(h)). */
export const PIECES_FP_STEPS = 4;

/** How far a shape reaches from its centre, as a share of its half-size, turned any way. */
const SHAPE_REACH: Record<PieceShape, number> = { circle: 1, square: 1.415, hexagon: 1.155, diamond: 1, glyph: 1.415 };

const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';

/** Distance to each shape in a piece's own frame, where the half-size is 1 (size 1 touches the neighbours). */
export const PIECES_GLSL = [
  `float pieces_box(vec2 q, vec2 b) { vec2 d = abs(q) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }`,
  `float pieces_hex(vec2 q) {
  vec3 k = vec3(-0.8660254, 0.5, 0.5773503);
  q = abs(q);
  q -= 2.0 * min(dot(k.xy, q), 0.0) * k.xy;
  q -= vec2(clamp(q.x, -k.z, k.z), 1.0);
  return length(q) * sign(q.y);
}`,
  // A glyph from the brightness, darkest to brightest: a dot, a dash, a plus, a cross, a ring, a block.
  `float pieces_glyph(vec2 q, float b) {
  float k = floor(clamp(b, 0.0, 0.9999) * 6.0);
  vec2 a = abs(q);
  vec2 r = vec2(a.x + a.y, abs(q.x - q.y)) * 0.7071068;
  if (k < 0.5) return length(q) - 0.28;
  if (k < 1.5) return pieces_box(q, vec2(0.7, 0.16));
  if (k < 2.5) return min(pieces_box(q, vec2(0.85, 0.18)), pieces_box(q, vec2(0.18, 0.85)));
  if (k < 3.5) return min(pieces_box(r, vec2(0.85, 0.18)), pieces_box(r, vec2(0.18, 0.85)));
  if (k < 4.5) return abs(length(q) - 0.7) - 0.2;
  return pieces_box(q, vec2(0.92));
}`,
];

function shapeDist(shape: PieceShape, q: string, bright: string): string {
  switch (shape) {
    case 'square': return `pieces_box(${q}, vec2(1.0))`;
    case 'hexagon': return `pieces_hex(${q})`;
    case 'diamond': return `(abs(${q}.x) + abs(${q}.y) - 1.0) * 0.7071068`;
    case 'glyph': return `pieces_glyph(${q}, ${bright})`;
    default: return `(length(${q}) - 1.0)`;
  }
}

const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => ((list as readonly string[]).includes(v as string) ? v as T : d);

export interface PiecesOpts {
  /** The search's cap in cells each side (tests raise it to check against a brute-force search). */
  cap?: number;
  /** Search every cell up to the cap, ignoring the live radius (the brute-force reference). */
  brute?: boolean;
}

/**
 * The Pieces node's GLSL. `iv` is the compiler's inputVars: picture / depth (sampler names), offset /
 * shape / turnField (field function names, or a plain value), and wired numbers.
 */
export function piecesCode(node: GraphNode, iv: Record<string, string>, opts: PiecesOpts = {}): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const P = node.params;
  const near = P.searchMode === 'near';
  const cap = Math.max(1, Math.round(opts.cap ?? (near ? PIECES_SEARCH_CAP : PIECES_FULL_CAP)));
  const shape = pick(P.shape, PIECE_SHAPES, 'circle');
  const sizeBy = pick(P.sizeBy, PIECE_SIZE_BY, 'none');
  const order = pick(P.order, PIECE_ORDER, 'moved');
  const colourMode = P.colourMode === 'piece' ? 'piece' : 'flat';
  const num = (k: string, d: number) => iv[k] || p(P[k], d);

  const uv = iv.uv || 'g_uv';
  const tex = iv.picture;
  const depth = iv.depth;
  const offFn = fieldFn(iv.offset);
  const shapeFn = fieldFn(iv.shape);
  const turnFn = fieldFn(iv.turnField);
  // Offsets: the field at a home (a field function), a plain value (the same for every piece), or none.
  const off = (h: string, cell: string, idx: string) => offFn ? `${offFn}(${h}, ${cell}, 0.0, ${idx})` : iv.offset ? `vec2(${iv.offset})` : 'vec2(0.0)';
  const amt = num('amount', 1);

  const L: string[] = [];
  const v = (s: string) => L.push(`    ${s}\n`);
  v(`vec2 ${id}_X = ${uv};`);
  v(`float ${id}_A = u_resolution.x / u_resolution.y;`);
  v(`float ${id}_n = max(floor(${num('count', 32)} + 0.5), 1.0);`);
  v(`float ${id}_cs = 2.0 * ${id}_A / ${id}_n;`);
  v(`vec2 ${id}_org = vec2(-${id}_A, -1.0);`);
  v(`float ${id}_stg = clamp(${num('stagger', 0)}, 0.0, 1.0);`);
  v(`float ${id}_amt = ${amt};`);
  // The picture's aspect for Fill (0 or less: stretched over the frame, as Texture Input's Stretch).
  v(`float ${id}_pa = ${num('aspect', 0)};`);
  v(`vec2 ${id}_fs = ${id}_pa > 0.0 ? (${id}_pa > ${id}_A ? vec2(${id}_A / ${id}_pa, 1.0) : vec2(1.0, ${id}_pa / ${id}_A)) : vec2(1.0);`);
  const toSt = (q: string) => `((${q}) / vec2(${id}_A, 1.0) * ${id}_fs * 0.5 + 0.5)`;
  const readAt = (q: string) => tex
    ? `textureLod(${tex}, ${toSt(q)}, 0.0).rgb`
    : `(0.5 + 0.5 * cos(6.2831853 * (dot(${toSt(q)}, vec2(0.8, 0.3)) + vec3(0.0, 0.33, 0.67))))`;
  const depthAt = (q: string) => (depth ? `textureLod(${depth}, ${toSt(q)}, 0.0).r` : '0.5');

  // Where to look, and how far (in cells). The pieces at X come from homes h with h + offset(h) = X.
  //  - Near (fast): the fixed point h = X − amount × offset(h), iterated, and the cells round it out
  //    to the pieces' size plus Search. Exact when the offset is the same everywhere; right for smooth
  //    fields whose neighbouring offsets differ by less than a cell (they don't overtake each other).
  //  - Every piece (sure, the default): the cells round X out to the furthest any piece travels,
  //    estimated from the offset here and one step back (× 1.25), plus the size and Search. Complete
  //    for fields of steady strength (a Vector Field's directions, the mouse, time), however wild.
  v(`vec2 ${id}_h = ${id}_X;`);
  v(`float ${id}_trav = 0.0;`);
  if (offFn || iv.offset) {
    if (near) {
      L.push(`    for (int ${id}_k = 0; ${id}_k < ${PIECES_FP_STEPS}; ${id}_k++) {\n`);
      v(`  vec2 ${id}_hc = floor((${id}_h - ${id}_org) / ${id}_cs);`);
      v(`  ${id}_h = ${id}_X - ${id}_amt * ${off(`${id}_h`, `${id}_hc`, '0.0')};`);
      L.push('    }\n');
    } else {
      v(`vec2 ${id}_o0 = ${id}_amt * ${off(`${id}_X`, `floor((${id}_X - ${id}_org) / ${id}_cs)`, '0.0')};`);
      v(`vec2 ${id}_o1 = ${id}_amt * ${off(`(${id}_X - ${id}_o0)`, `floor((${id}_X - ${id}_o0 - ${id}_org) / ${id}_cs)`, '0.0')};`);
      v(`${id}_trav = 1.25 * max(length(${id}_o0), length(${id}_o1)) / ${id}_cs;`);
    }
  }
  // How far a piece can reach, in cells: its biggest size, turned any way, plus Search (and, looking
  // round X, the furthest travel).
  v(`float ${id}_sz = max(${num('size', 1)}, 0.0);`);
  v(`float ${id}_reach = ${id}_sz * ${SHAPE_REACH[shape].toFixed(3)} * 0.5 + max(${num('search', 1)}, 0.0) + ${id}_stg * 0.5 + ${id}_trav;`);
  v(`float ${id}_aa = max(1.0 / u_resolution.y, max(${num('softness', 0)}, 0.0) * ${id}_cs * 0.5);`);
  v(`float ${id}_turn0 = radians(${num('turn', 0)} + ${num('spin', 0)} * u_time);`);
  v(`float ${id}_minS = clamp(${num('minSize', 0.15)}, 0.0, 1.0);`);
  v(`vec3 ${id}_bg = ${iv.background || pv3(P.background, [0.02, 0.02, 0.03])};`);
  // The two top pieces at this pixel (layer, colour, coverage), the top one's id, home and distance.
  v(`float ${id}_l1 = -1.0e9; vec3 ${id}_c1 = vec3(0.0); float ${id}_a1 = 0.0;`);
  v(`float ${id}_l2 = -1.0e9; vec3 ${id}_c2 = vec3(0.0); float ${id}_a2 = 0.0;`);
  v(`vec2 ${id}_id = vec2(-1.0); vec2 ${id}_home = ${id}_h; float ${id}_d = 1.0e3;`);
  v(`float ${id}_hy = (${id}_h.y - ${id}_org.y) / ${id}_cs - 0.5;`);
  L.push(`    for (int ${id}_j = -${cap}; ${id}_j <= ${cap}; ${id}_j++) {\n`);
  if (!opts.brute) v(`  if (abs(float(${id}_j)) > ${id}_reach + 1.0) continue;`);
  v(`  float ${id}_row = floor(${id}_hy + 0.5) + float(${id}_j);`);
  if (!opts.brute) v(`  if (abs(${id}_row - ${id}_hy) > ${id}_reach) continue;`);
  v(`  float ${id}_sh = ${id}_stg * 0.5 * mod(${id}_row, 2.0);`);
  v(`  float ${id}_hx = (${id}_h.x - ${id}_org.x) / ${id}_cs - 0.5 - ${id}_sh;`);
  L.push(`      for (int ${id}_i = -${cap}; ${id}_i <= ${cap}; ${id}_i++) {\n`);
  v(`    float ${id}_col = floor(${id}_hx + 0.5) + float(${id}_i);`);
  if (!opts.brute) v(`    if (abs(${id}_col - ${id}_hx) > ${id}_reach) continue;`);
  v(`    vec2 ${id}_cid = vec2(${id}_col, ${id}_row);`);
  v(`    vec2 ${id}_cc = ${id}_org + (${id}_cid + vec2(0.5 + ${id}_sh, 0.5)) * ${id}_cs;`);
  v(`    float ${id}_rnd = fract(sin(dot(${id}_cid, vec2(12.9898, 78.233))) * 43758.5453);`);
  v(`    vec3 ${id}_col3 = ${readAt(`${id}_cc`)};`);
  v(`    float ${id}_lum = dot(${LUMA}, clamp(${id}_col3, 0.0, 1.0));`);
  const sizeDrive = sizeBy === 'brightness' ? `${id}_lum` : sizeBy === 'darkness' ? `(1.0 - ${id}_lum)` : sizeBy === 'depth' ? depthAt(`${id}_cc`) : '';
  v(`    float ${id}_r = 0.5 * ${id}_cs * ${id}_sz${sizeDrive ? ` * mix(${id}_minS, 1.0, clamp(${sizeDrive}, 0.0, 1.0))` : ''};`);
  v(`    vec2 ${id}_o = ${id}_amt * ${off(`${id}_cc`, `${id}_cid`, `${id}_rnd`)};`);
  v(`    vec2 ${id}_P = ${id}_cc + ${id}_o;`);
  v(`    float ${id}_an = ${id}_turn0${turnFn ? ` + radians(${turnFn}(${id}_cc, ${id}_cid, 0.0, ${id}_rnd))` : iv.turnField ? ` + radians(${iv.turnField})` : ''};`);
  v(`    vec2 ${id}_w = ${id}_X - ${id}_P;`);
  v(`    vec2 ${id}_q = mat2(cos(${id}_an), -sin(${id}_an), sin(${id}_an), cos(${id}_an)) * ${id}_w / max(${id}_r, 1.0e-6);`);
  const sd = shapeFn ? `${shapeFn}(${id}_q * 0.5, ${id}_cid, 0.0, ${id}_rnd) * 2.0` : shapeDist(shape, `${id}_q`, `${id}_lum`);
  v(`    float ${id}_dd = ${sd} * ${id}_r;`);
  v(`    float ${id}_a = 1.0 - smoothstep(-${id}_aa, ${id}_aa, ${id}_dd);`);
  v(`    ${id}_d = min(${id}_d, ${id}_dd);`);
  L.push(`        if (${id}_a > 0.001) {\n`);
  const layer = order === 'random' ? `${id}_rnd` : order === 'brightness' ? `${id}_lum + ${id}_rnd * 1.0e-3` : `length(${id}_o) / ${id}_cs + ${id}_rnd * 1.0e-3`;
  v(`      float ${id}_l = ${layer};`);
  // Piece mode: the picture round the home, turned and scaled with the piece (its own piece travels with it).
  if (colourMode === 'piece') v(`      vec3 ${id}_pc = ${readAt(`${id}_cc + ${id}_q * ${id}_cs * 0.5`)};`);
  else v(`      vec3 ${id}_pc = ${id}_col3;`);
  L.push(`        if (${id}_l > ${id}_l1) {\n`);
  v(`        ${id}_l2 = ${id}_l1; ${id}_c2 = ${id}_c1; ${id}_a2 = ${id}_a1;`);
  v(`        ${id}_l1 = ${id}_l; ${id}_c1 = ${id}_pc; ${id}_a1 = ${id}_a; ${id}_id = ${id}_cid; ${id}_home = ${id}_cc;`);
  L.push(`        } else if (${id}_l > ${id}_l2) {\n`);
  v(`        ${id}_l2 = ${id}_l; ${id}_c2 = ${id}_pc; ${id}_a2 = ${id}_a;`);
  L.push('        }\n');
  L.push('        }\n');
  L.push('      }\n');
  L.push('    }\n');
  // Disjoint over: the second piece fills only what the top one leaves, so two pieces side by side
  // (at rest, edge to edge) add up to a whole pixel with no seam, and where they overlap the top wins.
  v(`float ${id}_a2e = min(${id}_a2, 1.0 - ${id}_a1);`);
  v(`float ${id}_mask = ${id}_a1 + ${id}_a2e;`);
  v(`vec3 ${id}_color = ${id}_bg * (1.0 - ${id}_mask) + ${id}_c1 * ${id}_a1 + ${id}_c2 * ${id}_a2e;`);
  return {
    code: L.join(''),
    outputVars: { color: `${id}_color`, mask: `${id}_mask`, pieceID: `${id}_id`, home: `${id}_home`, dist: `${id}_d`, pieceColor: `${id}_c1` },
  };
}

const NUM_IN = (label: string, hint: string) => ({ type: 'float' as const, label, hint });

export const PiecesNode: NodeDefinition = {
  type: 'pieces',
  label: 'Pieces',
  category: 'Grid',
  aliases: ['Picture in pieces', 'Ball action', 'CC Ball Action', 'Scatter picture', 'Mosaic', 'Halftone pieces', 'Shatter'],
  description: 'A picture rebuilt from pieces (circles, squares, hexagons, diamonds or glyphs), each taking the picture\'s colour at its home. Wire any vec2 field into Offset ƒ (noise, a flow, the mouse) and the pieces move, so the picture moves: Amount 0 puts every piece back home. Pieces can travel past their cells and overlap; sizes can follow brightness (a halftone) or a Depth texture. Video plays inside the pieces.',
  brief: {
    summary: 'A picture made of pieces you can move: CC Ball Action in 2D.',
    start: [
      'Wire a Texture Input\'s (or Video Input\'s) Texture into Picture.',
      'Wire a noise or flow (vec2) into Offset ƒ, and an LFO into Amount: the picture scatters and comes back.',
      'Size by Brightness with Min size 0 makes a halftone; Glyph turns it into text art.',
    ],
  },
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'The point being drawn (the UV node). Unwired: this pixel.' },
    picture: { type: 'texture', label: 'Picture', hint: 'The picture the pieces are made of: Texture Input, Video Input, Baked, a Pass. Video is read again every frame.' },
    offset: { type: 'vec2', label: 'Offset ƒ', field: true, hint: 'Where each piece goes from its home: any vec2 chain, read at the piece\'s home (a Cell node in it gives the piece\'s cell, and Index a random 0–1 per piece). Times Amount.' },
    amount: NUM_IN('Amount', 'How far the offset moves the pieces: 0 is home. Wire an LFO to scatter and return.'),
    count: NUM_IN('Pieces across', 'How many pieces across the frame.'),
    size: NUM_IN('Size', 'A piece\'s size: 1 touches its neighbours.'),
    minSize: NUM_IN('Min size', 'With Size by: the size of the darkest (or farthest) pieces, as a share of Size.'),
    turn: NUM_IN('Turn', 'Every piece turned by this many degrees.'),
    spin: NUM_IN('Spin', 'Degrees a second every piece turns.'),
    turnField: { type: 'float', label: 'Turn ƒ', field: true, hint: 'Degrees for each piece, from any chain read at its home (noise for a jumble).' },
    shape: { type: 'float', label: 'Shape ƒ', field: true, hint: 'Your own shape: an SDF chain drawn in each piece\'s frame (−0.5…0.5, as Grid Pattern\'s Shape). Unwired: the Shape menu.' },
    depth: { type: 'texture', label: 'Depth', hint: 'A Depth node\'s Depth texture: with Size by Depth, near pieces are bigger.' },
    search: NUM_IN('Search', 'Extra cells each side to look in, for offsets that differ a lot between neighbours (strong, fine noise). 1 is plenty for smooth fields.'),
    softness: NUM_IN('Softness', 'Soft edges, as a share of a piece. 0: one pixel.'),
    aspect: NUM_IN('Aspect', 'The picture\'s width ÷ height, to Fill the frame keeping its shape. 0: stretched over the frame.'),
    stagger: NUM_IN('Stagger', '1 shifts every other row by half a piece (a honeycomb, best with hexagons).'),
    background: { type: 'vec3', label: 'Background', hint: 'What shows between the pieces: wire a colour or a picture (a dimmed copy of the picture, say).' },
  },
  socketsOnDemand: { minSize: ['minSize'], turn: ['turn'], spin: ['spin'], search: ['search'], softness: ['softness'], aspect: ['aspect'], stagger: ['stagger'] },
  outputs: {
    color: { type: 'vec3', label: 'Colour', hint: 'The pieces over the Background.' },
    mask: { type: 'float', label: 'Mask', hint: '1 on a piece, 0 between them.' },
    pieceID: { type: 'vec2', label: 'Piece ID', hint: 'The top piece\'s cell (column, row), −1 where there is none.' },
    home: { type: 'vec2', label: 'Home', hint: 'The top piece\'s home, in picture units: wire into a Sample (texture)\'s UV to read anything at the home.' },
    dist: { type: 'float', label: 'Distance', hint: 'The distance to the nearest piece\'s edge (negative inside): for glows and outlines.' },
    pieceColor: { type: 'vec3', label: 'Piece colour', hint: 'The top piece\'s colour, without the Background.' },
  },
  defaultParams: {
    shape: 'circle', colourMode: 'flat', sizeBy: 'none', order: 'moved', searchMode: 'full',
    count: 40, size: 1, minSize: 0.15, amount: 1, turn: 0, spin: 0, search: 1, softness: 0, aspect: 0, stagger: 0,
    background: [0.02, 0.02, 0.03],
  },
  paramDefs: {
    shape: { label: 'Shape', type: 'select', options: [
      { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'hexagon', label: 'Hexagon' },
      { value: 'diamond', label: 'Diamond' }, { value: 'glyph', label: 'Glyph (by brightness)' },
    ], hint: 'What each piece is. Glyph picks a mark by the piece\'s brightness: dot, dash, plus, cross, ring, block.' },
    colourMode: { label: 'Colour', type: 'select', options: [
      { value: 'flat', label: 'Flat: the colour at its home' }, { value: 'piece', label: 'Piece: carries its piece of the picture' },
    ], hint: 'Flat: one colour a piece, the picture\'s at its home (a mosaic). Piece: each piece carries the picture round its home, turning with it: at rest the pieces make up the picture exactly.' },
    count: { label: 'Pieces across', type: 'float', min: 2, max: 200, step: 1, hint: 'How many pieces across the frame.' },
    size: { label: 'Size', type: 'float', min: 0, max: 3, step: 0.01, hint: '1 touches the neighbours; above 1 they overlap.' },
    sizeBy: { label: 'Size by', type: 'select', options: [
      { value: 'none', label: 'Nothing' }, { value: 'brightness', label: 'Brightness (halftone)' },
      { value: 'darkness', label: 'Darkness (ink)' }, { value: 'depth', label: 'Depth (near is big)' },
    ], hint: 'Scale each piece by the picture at its home: bright pieces big (a halftone), dark pieces big (ink on paper), or near pieces big with a Depth texture wired.' },
    minSize: { label: 'Min size', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'sizeBy', value: ['brightness', 'darkness', 'depth'] }, hint: 'The smallest piece, as a share of Size. 0 lets them vanish.' },
    amount: { label: 'Amount', type: 'float', min: 0, max: 2, step: 0.01, hint: 'How far the Offset ƒ moves the pieces. 0 is home: the picture.' },
    turn: { label: 'Turn', type: 'float', min: -180, max: 180, step: 1, hint: 'Degrees every piece is turned.' },
    spin: { label: 'Spin', type: 'float', min: -360, max: 360, step: 1, hint: 'Degrees a second.' },
    order: { label: 'On top', type: 'select', options: [
      { value: 'moved', label: 'The ones moved furthest' }, { value: 'random', label: 'Random' }, { value: 'brightness', label: 'The brightest' },
    ], hint: 'Which piece is drawn on top where pieces overlap.' },
    searchMode: { label: 'Find pieces', type: 'select', options: [
      { value: 'full', label: 'Every piece that can reach (sure)' }, { value: 'near', label: 'Near where they came from (fast)' },
    ], hint: 'How each pixel finds the pieces over it. Every piece: looks as far as the furthest piece travels, so nothing is cut however wild the offset (it costs more while they are far from home). Near: works out the one home a piece here came from and looks round it: fast, and right for smooth offsets where neighbours move together.' },
    search: { label: 'Search', type: 'float', min: 0, max: 3, step: 0.1, hint: 'Extra cells each side to look for pieces. Raise it if pieces get cut (an offset whose strength varies a lot, or Near with a fine field); each step costs more.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Soft edges, as a share of a piece. 0: one pixel.' },
    aspect: { label: 'Aspect', type: 'float', min: 0, max: 4, step: 0.01, hint: 'The picture\'s width ÷ height (1.5 for 3:2), to Fill the frame keeping its shape. 0: stretched, as Texture Input\'s Stretch.' },
    stagger: { label: 'Stagger', type: 'float', min: 0, max: 1, step: 1, hint: '1 shifts every other row by half a piece: a honeycomb.' },
    background: { label: 'Background', type: 'vec3color', hint: 'What shows between the pieces (unless Background is wired).' },
  },
  glslFunctions: PIECES_GLSL,
  generateGLSL: (node, inputVars) => piecesCode(node, inputVars),
};

// ── Balls (3D) ───────────────────────────────────────────────────────────────

export const BALL_LIFT_BY = ['brightness', 'darkness', 'depth', 'none'] as const;

/** The Balls node's GLSL (inside a Scene Group under Repeat Scene, or after the March Loop with Cell wired). */
export function ballsCode(node: GraphNode, iv: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const P = node.params;
  const num = (k: string, d: number) => iv[k] || p(P[k], d);
  const liftBy = pick(P.liftBy, BALL_LIFT_BY, 'brightness');
  const sizeBy = pick(P.sizeBy, PIECE_SIZE_BY, 'none');
  const box = P.shape === 'box';
  const tex = iv.picture;
  const depth = iv.depth;
  const L: string[] = [];
  const v = (s: string) => L.push(`    ${s}\n`);
  // The copy: Repeat Cell's Cell when wired (after the loop), else the copy being measured.
  v(`vec3 ${id}_cell = ${iv.cell || CELL3_GLOBAL};`);
  v(`vec2 ${id}_cs = max(${CELL3SIZE_GLOBAL}.xy, vec2(1.0e-4));`);
  v(`vec2 ${id}_home = ${id}_cell.xy * ${id}_cs;`);
  // The picture spans Pieces across copies; its height follows Aspect. Mirror X: the March Camera's
  // right is −X when it looks along −Z (Angle 0), so the picture reads the right way round from there.
  v(`float ${id}_W = max(${num('count', 31)}, 1.0) * ${id}_cs.x;`);
  v(`vec2 ${id}_span = vec2(${id}_W, ${id}_W / max(${num('aspect', 1.5)}, 0.05));`);
  v(`vec2 ${id}_st = ${id}_home / ${id}_span * vec2(${P.mirror === false ? '1.0' : '-1.0'}, 1.0) + 0.5;`);
  v(`float ${id}_in = step(0.0, ${id}_st.x) * step(${id}_st.x, 1.0) * step(0.0, ${id}_st.y) * step(${id}_st.y, 1.0);`);
  v(`vec3 ${id}_col = ${tex ? `textureLod(${tex}, clamp(${id}_st, 0.0, 1.0), 0.0).rgb` : `(0.5 + 0.5 * cos(6.2831853 * (dot(${id}_st, vec2(0.8, 0.3)) + vec3(0.0, 0.33, 0.67))))`};`);
  v(`float ${id}_lum = dot(${LUMA}, clamp(${id}_col, 0.0, 1.0));`);
  v(`float ${id}_dep = ${depth ? `textureLod(${depth}, clamp(${id}_st, 0.0, 1.0), 0.0).r` : `${id}_lum`};`);
  const drive = (by: string) => (by === 'brightness' ? `${id}_lum` : by === 'darkness' ? `(1.0 - ${id}_lum)` : by === 'depth' ? `${id}_dep` : '0.0');
  v(`float ${id}_lift = ${num('lift', 1.5)} * ${drive(liftBy)};`);
  v(`float ${id}_r = 0.5 * min(${id}_cs.x, ${id}_cs.y) * max(${num('size', 0.9)}, 0.0)${sizeBy !== 'none' ? ` * mix(clamp(${num('minSize', 0.3)}, 0.0, 1.0), 1.0, clamp(${drive(sizeBy)}, 0.0, 1.0))` : ''} * ${id}_in;`);
  // The ball's centre in the copy's own space: lifted along Z (towards a camera at Angle 0), then displaced.
  v(`vec3 ${id}_c = vec3(0.0, 0.0, ${id}_lift) + ${iv.displace || 'vec3(0.0)'};`);
  v(`vec3 ${id}_q = ${iv.pos || 'vec3(0.0)'} - ${id}_c;`);
  if (box) {
    v(`vec3 ${id}_b = abs(${id}_q) - vec3(${id}_r * 0.8);`);
    v(`float ${id}_dist = length(max(${id}_b, 0.0)) + min(max(${id}_b.x, max(${id}_b.y, ${id}_b.z)), 0.0) - ${id}_r * 0.2;`);
  } else v(`float ${id}_dist = length(${id}_q) - ${id}_r;`);
  return {
    code: L.join(''),
    outputVars: { dist: `${id}_dist`, color: `${id}_col`, home: `${id}_st`, lift: `${id}_lift`, centre: `${id}_c` },
  };
}

export const BallsNode: NodeDefinition = {
  type: 'pieceBalls',
  label: 'Balls',
  category: '3D Primitives',
  aliases: ['Picture balls', 'CC Ball Action', 'Ball action', 'Picture as balls', 'Pieces 3D'],
  description: 'One ball of a picture rebuilt from balls (CC Ball Action), inside a Scene Group repeated by Repeat Scene: each copy reads the picture at its cell\'s centre, is lifted towards the camera by the brightness or a Depth texture, and moved by Displace (anything from Repeat Cell\'s Centre: noise, a wave). After the March Loop, wire Repeat Cell\'s Cell (looked up at Hit Pos) to get the colour of the ball each ray hit.',
  brief: {
    summary: 'A picture as a grid of balls, lifted by brightness or depth: CC Ball Action in 3D.',
    start: [
      'Easiest: Scene builder → 3D scene → the "Picture as balls" template.',
      'By hand: in a Scene Group under Repeat Scene, Scene Pos → Balls → Scene Output; wire the picture into Picture.',
      'After the March Loop, another Balls with Repeat Cell\'s Cell gives each ball\'s colour.',
    ],
  },
  inputs: {
    pos: { type: 'vec3', label: 'Position', hint: 'Scene Pos inside the Scene Group (already moved into this copy\'s cell by Repeat Scene).' },
    picture: { type: 'texture', label: 'Picture', hint: 'The picture the balls take their colour and lift from.' },
    depth: { type: 'texture', label: 'Depth', hint: 'A Depth node\'s Depth texture: with Lift by Depth, near parts of the picture come forward.' },
    displace: { type: 'vec3', label: 'Displace', hint: 'Moves this ball: wire anything worked out from Repeat Cell\'s Centre or Random (noise, a wave), so every ball moves its own way.' },
    cell: { type: 'vec3', label: 'Cell', hint: 'Only after the March Loop: Repeat Cell\'s Cell (with the Repeat Scene and Hit Pos wired in), for the colour of the ball each ray hit.' },
    lift: { type: 'float', label: 'Lift', hint: 'How far the brightest (or nearest) balls come forward.' },
    size: { type: 'float', label: 'Size', hint: 'A ball\'s size: 1 touches its neighbours.' },
    minSize: { type: 'float', label: 'Min size', hint: 'With Size by: the smallest ball, as a share of Size.' },
    count: { type: 'float', label: 'Pieces across', hint: 'How many copies the picture spans across (Repeat Scene\'s Copies each side × 2 + 1).' },
    aspect: { type: 'float', label: 'Aspect', hint: 'The picture\'s width ÷ height.' },
  },
  socketsOnDemand: { minSize: ['minSize'], count: ['count'], aspect: ['aspect'] },
  outputs: {
    dist: { type: 'float', label: 'Distance', hint: 'The distance to this copy\'s ball: into Scene Output.' },
    color: { type: 'vec3', label: 'Colour', hint: 'The picture\'s colour at this ball\'s home.' },
    home: { type: 'vec2', label: 'Home', hint: 'Where on the picture this ball comes from (0–1).' },
    lift: { type: 'float', label: 'Lift', hint: 'How far this ball is lifted.' },
    centre: { type: 'vec3', label: 'Centre', hint: 'The ball\'s centre in its copy\'s space (lift + Displace).' },
  },
  defaultParams: { shape: 'sphere', liftBy: 'brightness', sizeBy: 'none', lift: 1.5, size: 0.9, minSize: 0.3, count: 31, aspect: 1.5, mirror: true },
  paramDefs: {
    shape: { label: 'Shape', type: 'select', options: [{ value: 'sphere', label: 'Sphere' }, { value: 'box', label: 'Rounded box' }] },
    liftBy: { label: 'Lift by', type: 'select', options: [
      { value: 'brightness', label: 'Brightness' }, { value: 'darkness', label: 'Darkness' }, { value: 'depth', label: 'Depth (wire a Depth texture)' }, { value: 'none', label: 'Nothing (flat)' },
    ], hint: 'What brings a ball forward: the picture\'s brightness at its home, its darkness, or a Depth node\'s nearness.' },
    lift: { label: 'Lift', type: 'float', min: -5, max: 5, step: 0.01, hint: 'How far the brightest (or nearest) balls come forward, in scene units.' },
    sizeBy: { label: 'Size by', type: 'select', options: [
      { value: 'none', label: 'Nothing' }, { value: 'brightness', label: 'Brightness' }, { value: 'darkness', label: 'Darkness' }, { value: 'depth', label: 'Depth' },
    ] },
    size: { label: 'Size', type: 'float', min: 0, max: 3, step: 0.01, hint: '1 touches the neighbours. Above 1 they overlap: raise Repeat Scene\'s Overlap to match.' },
    minSize: { label: 'Min size', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'sizeBy', value: ['brightness', 'darkness', 'depth'] } },
    count: { label: 'Pieces across', type: 'float', min: 1, max: 201, step: 1, hint: 'How many copies the picture spans across: Repeat Scene\'s Copies each side X × 2 + 1.' },
    aspect: { label: 'Aspect', type: 'float', min: 0.2, max: 4, step: 0.01, hint: 'The picture\'s width ÷ height (1.5 for 3:2).' },
    mirror: { label: 'Face a camera at Angle 0', type: 'bool', hint: 'On: the picture reads the right way round from a March Camera at Angle 0 (looking along −Z). Off: from Angle π.' },
  },
  declarationsFor: () => [CELL3_DECL],
  generateGLSL: (node, inputVars) => ballsCode(node, inputVars),
};
