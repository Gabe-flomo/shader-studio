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
import { CELL3_DECL, CELL3_GLOBAL, CELL3SIZE_GLOBAL } from './repeatScene';

export const PIECE_SHAPES = ['circle', 'ball', 'square', 'hexagon', 'diamond', 'glyph'] as const;
export type PieceShape = typeof PIECE_SHAPES[number];
export const PIECE_SIZE_BY = ['none', 'brightness', 'darkness', 'depth'] as const;
export const PIECE_ORDER = ['moved', 'random', 'brightness'] as const;
/** The search's cap, cells each side (Near: 9 × 9 round the inverse; Every piece: 25 × 25 round the pixel). The live radius stops the loops sooner. */
export const PIECES_SEARCH_CAP = 4;
export const PIECES_FULL_CAP = 12;
/** Fixed-point steps for the inverse (h = X − offset(h)). */
export const PIECES_FP_STEPS = 4;

/** How far a shape reaches from its centre, as a share of its half-size, turned any way. */
const SHAPE_REACH: Record<PieceShape, number> = { circle: 1, ball: 1, square: 1.415, hexagon: 1.155, diamond: 1, glyph: 1.415 };

const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';

/** Distance to each shape in a piece's own frame, where the half-size is 1 (size 1 touches the neighbours). */
/**
 * Four stable random numbers (0–1) for a piece (or ball) from its cell and the Seed: Dave Hoskins'
 * hash44, so neighbouring cells and seeds are unrelated. Scatter, its turn and its size read it.
 */
export const PIECES_RAND_GLSL = `vec4 pieces_rand4(vec2 c, float seed) {
  vec4 p4 = fract(vec4(c.x, c.y, seed, c.x * 0.61803 + c.y * 1.41421 + seed * 0.37) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}`;

export const PIECES_GLSL = [
  PIECES_RAND_GLSL,
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

/** A number setting that does something: wired, live (a uniform name), or not 0. */
const live = (P: Record<string, unknown>, iv: Record<string, string>, k: string) => !!iv[k] || typeof P[k] === 'string' || (Number(P[k]) || 0) !== 0;

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
  // Scatter (CC Ball Action's): a stable random push per piece, its turn and its size, from the
  // piece's cell and the Seed. Left out of the code while all three are 0 and unwired.
  const scat = live(P, iv, 'scatter');
  const scatTurn = live(P, iv, 'scatterTurn');
  const scatSize = live(P, iv, 'scatterSize');
  const inst = live(P, iv, 'instability');
  const anyScatter = scat || scatTurn || scatSize || inst;
  const ball = shape === 'ball';
  const lit = P.ballLook === 'lit';
  const dim = live(P, iv, 'dimFloor');
  // Depth of field (as the particle camera's Focus and Blur): out of focus, a piece spreads into a
  // soft disc that keeps its light. Focus is on the value that sizes the pieces (Size by: depth,
  // brightness or darkness; the brightness when it is Nothing).
  const dof = live(P, iv, 'blur');

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
  if (scat) v(`float ${id}_scat = max(${num('scatter', 0)}, 0.0);`);
  if (scatSize) v(`float ${id}_ssz = clamp(${num('scatterSize', 0)}, 0.0, 1.0);`);
  if (anyScatter) v(`float ${id}_seed = ${num('seed', 1)};`);
  if (inst) v(`float ${id}_ins = abs(${num('instability', 0)});`);
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
  // Scatter adds its full length (in cells) and Scatter size its biggest piece, so nothing is cut.
  if (dof) {
    v(`float ${id}_blur = max(${num('blur', 0)}, 0.0);`);
    v(`float ${id}_focus = ${num('focus', 0.5)};`);
  }
  v(`float ${id}_reach = ${dof ? `${id}_blur + ` : ''}${id}_sz${scatSize ? ` * (1.0 + ${id}_ssz)` : ''} * ${SHAPE_REACH[shape].toFixed(3)} * 0.5 + max(${num('search', 1)}, 0.0) + ${id}_stg * 0.5 + ${id}_trav${scat ? ` + ${id}_scat / ${id}_cs` : ''}${inst ? ` + 1.4143 * ${id}_ins / ${id}_cs` : ''};`);
  v(`float ${id}_aa = max(1.0 / u_resolution.y, max(${num('softness', 0)}, 0.0) * ${id}_cs * 0.5);`);
  v(`float ${id}_turn0 = radians(${num('turn', 0)} + ${num('spin', 0)} * u_time);`);
  v(`float ${id}_minS = clamp(${num('minSize', 0.15)}, 0.0, 1.0);`);
  if (ball) {
    // The Ball shape's light (Lit): from Light angle (degrees, 0 is from the right, 90 from above), raised.
    if (lit) {
      v(`float ${id}_la = radians(${num('lightAngle', 135)});`);
      v(`vec3 ${id}_L = normalize(vec3(cos(${id}_la), sin(${id}_la), 1.2));`);
    }
    v(`float ${id}_shd = clamp(${num('shading', 1)}, 0.0, 1.0);`);
  }
  if (dim) v(`float ${id}_dim = clamp(${num('dimFloor', 0)}, 0.0, 1.0);`);
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
  if (anyScatter) v(`    vec4 ${id}_rr = pieces_rand4(${id}_cid, ${id}_seed);`);
  // Instability: every piece wobbles round its place, each at its own pace and phase.
  if (inst) v(`    vec2 ${id}_wob = ${id}_ins * vec2(sin(6.2831853 * (u_time * (0.6 + 0.8 * ${id}_rr.x) + ${id}_rr.y)), sin(6.2831853 * (u_time * (0.6 + 0.8 * ${id}_rr.z) * 0.87 + ${id}_rr.w)));`);
  v(`    vec3 ${id}_col3 = ${readAt(`${id}_cc`)};`);
  v(`    float ${id}_lum = dot(${LUMA}, clamp(${id}_col3, 0.0, 1.0));`);
  const sizeDrive = sizeBy === 'brightness' ? `${id}_lum` : sizeBy === 'darkness' ? `(1.0 - ${id}_lum)` : sizeBy === 'depth' ? depthAt(`${id}_cc`) : '';
  v(`    float ${id}_r = 0.5 * ${id}_cs * ${id}_sz${sizeDrive ? ` * mix(${id}_minS, 1.0, clamp(${sizeDrive}, 0.0, 1.0))` : ''}${scatSize ? ` * (1.0 + ${id}_ssz * (2.0 * ${id}_rr.z - 1.0))` : ''};`);
  // Scatter: a direction (rr.x) and a distance (√rr.y, even over the disc) per piece, times Scatter,
  // so raising it pushes every piece further along its own line. Added to the Offset × Amount.
  v(`    vec2 ${id}_o = ${id}_amt * ${off(`${id}_cc`, `${id}_cid`, `${id}_rnd`)}${scat ? ` + ${id}_scat * sqrt(${id}_rr.y) * vec2(cos(6.2831853 * ${id}_rr.x), sin(6.2831853 * ${id}_rr.x))` : ''}${inst ? ` + ${id}_wob` : ''};`);
  v(`    vec2 ${id}_P = ${id}_cc + ${id}_o;`);
  v(`    float ${id}_an = ${id}_turn0${turnFn ? ` + radians(${turnFn}(${id}_cc, ${id}_cid, 0.0, ${id}_rnd))` : iv.turnField ? ` + radians(${iv.turnField})` : ''}${scatTurn ? ` + radians(${num('scatterTurn', 0)} * (2.0 * ${id}_rr.w - 1.0))` : ''};`);
  v(`    vec2 ${id}_w = ${id}_X - ${id}_P;`);
  if (dof) {
    // The circle of confusion, in cells: Blur × how far this piece's value is from Focus. The piece
    // grows by it and its coverage falls as its area grows (its light kept), its edge as soft as the blur.
    v(`    float ${id}_cf = ${id}_blur * abs(clamp(${sizeDrive || `${id}_lum`}, 0.0, 1.0) - ${id}_focus);`);
    v(`    float ${id}_r0 = ${id}_r;`);
    v(`    ${id}_r += ${id}_cf * 0.5 * ${id}_cs;`);
    v(`    float ${id}_keep = ${id}_r0 * ${id}_r0 / max(${id}_r * ${id}_r, 1.0e-12);`);
    v(`    float ${id}_paa = max(${id}_aa, ${id}_cf * 0.3 * ${id}_cs);`);
  }
  v(`    vec2 ${id}_q = mat2(cos(${id}_an), -sin(${id}_an), sin(${id}_an), cos(${id}_an)) * ${id}_w / max(${id}_r, 1.0e-6);`);
  const sd = shapeFn ? `${shapeFn}(${id}_q * 0.5, ${id}_cid, 0.0, ${id}_rnd) * 2.0` : shapeDist(shape, `${id}_q`, `${id}_lum`);
  v(`    float ${id}_dd = ${sd} * ${id}_r;`);
  v(dof ? `    float ${id}_a = (1.0 - smoothstep(-${id}_paa, ${id}_paa, ${id}_dd)) * ${id}_keep;` : `    float ${id}_a = 1.0 - smoothstep(-${id}_aa, ${id}_aa, ${id}_dd);`);
  v(`    ${id}_d = min(${id}_d, ${id}_dd);`);
  L.push(`        if (${id}_a > 0.001) {\n`);
  const layer = order === 'random' ? `${id}_rnd` : order === 'brightness' ? `${id}_lum + ${id}_rnd * 1.0e-3` : `length(${id}_o) / ${id}_cs + ${id}_rnd * 1.0e-3`;
  v(`      float ${id}_l = ${layer};`);
  // Piece mode: the picture round the home, turned and scaled with the piece (its own piece travels with it).
  if (colourMode === 'piece') v(`      vec3 ${id}_pc = ${readAt(`${id}_cc + ${id}_q * ${id}_cs * 0.5`)};`);
  else v(`      vec3 ${id}_pc = ${id}_col3;`);
  // Dim floor: dark pieces stay visible, as small dim balls rather than nothing.
  if (dim) v(`      ${id}_pc = ${id}_dim + (1.0 - ${id}_dim) * ${id}_pc;`);
  if (ball && !lit) {
    // Ball, Glowing (the default): a bead that gives off its own light. Brightest at the centre (a
    // hot, still saturated core: the colour pushed up, not towards white), falling off to a dim rim,
    // with a faint highlight. The sphere's depth at this point (N.z) shapes the fall-off.
    v(`      vec2 ${id}_bq = ${id}_w / max(${id}_r, 1.0e-6);`);
    v(`      float ${id}_nz = sqrt(max(1.0 - dot(${id}_bq, ${id}_bq), 0.0));`);
    v(`      vec3 ${id}_glow = ${id}_pc * (0.22 + 0.8 * ${id}_nz * ${id}_nz) + ${id}_pc * ${id}_pc * 0.4 * pow(${id}_nz, 6.0) + 0.04 * pow(${id}_nz, 24.0);`);
    v(`      ${id}_pc = mix(${id}_pc, ${id}_glow, ${id}_shd);`);
  }
  if (ball && lit) {
    // Ball, Lit: shaded as a little sphere under a light. Its normal from the disc (−1…1 across the
    // piece, in screen space so the light stays put as pieces turn), a soft lit side, a highlight
    // and a dark rim.
    v(`      vec2 ${id}_bq = ${id}_w / max(${id}_r, 1.0e-6);`);
    v(`      vec3 ${id}_N = vec3(${id}_bq, sqrt(max(1.0 - dot(${id}_bq, ${id}_bq), 0.0)));`);
    v(`      float ${id}_dif = 0.3 + 0.85 * max(dot(${id}_N, ${id}_L), 0.0);`);
    v(`      float ${id}_spc = pow(max(2.0 * dot(${id}_N, ${id}_L) * ${id}_N.z - ${id}_L.z, 0.0), 24.0);`);
    v(`      float ${id}_rim = mix(0.35, 1.0, smoothstep(0.0, 0.55, ${id}_N.z));`);
    v(`      ${id}_pc = mix(${id}_pc, ${id}_pc * ${id}_dif * ${id}_rim + 0.45 * ${id}_spc * (0.35 + ${id}_pc), ${id}_shd);`);
  }
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
    scatter: NUM_IN('Scatter', 'A random push for every piece, the same each frame (its own direction and distance from the Seed): 0 keeps the grid; raise it and every piece moves further along its own line. Added to the Offset × Amount. Wire an LFO to scatter and return.'),
    seed: NUM_IN('Seed', 'Another random layout for Scatter, Scatter turn and Scatter size.'),
    scatterTurn: NUM_IN('Scatter turn', 'Up to this many degrees of random turn per piece.'),
    scatterSize: NUM_IN('Scatter size', 'Random size per piece: 0.3 makes pieces 70%–130% of Size.'),
    instability: NUM_IN('Instability', 'Every piece wobbles round its place, each at its own pace (picture units).'),
    dimFloor: NUM_IN('Dim floor', 'Lifts the darkest colours so dark parts of the picture stay as dim pieces rather than nothing.'),
    lightAngle: NUM_IN('Light angle', 'Ball shape, Lit: where the light comes from, in degrees (0 the right, 90 above).'),
    shading: NUM_IN('Shading', 'Ball shape: how much it glows (or is shaded) as a sphere. 0 is a flat disc.'),
    focus: NUM_IN('Focus', 'Where it is sharp, on the value that sizes the pieces (Size by): 0 dark or far, 1 bright or near. Pairs with Blur.'),
    blur: NUM_IN('Blur', 'Depth of field: out of focus, pieces spread into soft discs that keep their light (0: everything sharp).'),
    background: { type: 'vec3', label: 'Background', hint: 'What shows between the pieces: wire a colour or a picture (a dimmed copy of the picture, say).' },
  },
  socketsOnDemand: { minSize: ['minSize'], turn: ['turn'], spin: ['spin'], search: ['search'], softness: ['softness'], aspect: ['aspect'], stagger: ['stagger'], seed: ['seed'], scatterTurn: ['scatterTurn'], scatterSize: ['scatterSize'], instability: ['instability'], dimFloor: ['dimFloor'], lightAngle: ['lightAngle'], shading: ['shading'], focus: ['focus'], blur: ['blur'] },
  outputs: {
    color: { type: 'vec3', label: 'Colour', hint: 'The pieces over the Background.' },
    mask: { type: 'float', label: 'Mask', hint: '1 on a piece, 0 between them.' },
    pieceID: { type: 'vec2', label: 'Piece ID', hint: 'The top piece\'s cell (column, row), −1 where there is none.' },
    home: { type: 'vec2', label: 'Home', hint: 'The top piece\'s home, in picture units: wire into a Sample (texture)\'s UV to read anything at the home.' },
    dist: { type: 'float', label: 'Distance', hint: 'The distance to the nearest piece\'s edge (negative inside): for glows and outlines.' },
    pieceColor: { type: 'vec3', label: 'Piece colour', hint: 'The top piece\'s colour, without the Background.' },
  },
  // A new node starts as the CC Ball Action look: dense shaded balls a little scattered, dark parts
  // kept as dim balls. (Saved nodes without these keys read them as 0 / Circle: unchanged.)
  defaultParams: {
    shape: 'ball', colourMode: 'flat', sizeBy: 'none', order: 'moved', searchMode: 'full',
    count: 120, size: 1.08, minSize: 0.15, amount: 1, turn: 0, spin: 0, search: 1, softness: 0, aspect: 0, stagger: 0,
    scatter: 0.012, seed: 1, scatterTurn: 0, scatterSize: 0.12, instability: 0, dimFloor: 0.08, ballLook: 'glow', lightAngle: 135, shading: 1, focus: 0.5, blur: 0,
    background: [0.02, 0.02, 0.03],
  },
  paramDefs: {
    shape: { label: 'Shape', type: 'select', options: [
      { value: 'ball', label: 'Ball (shaded)' }, { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'hexagon', label: 'Hexagon' },
      { value: 'diamond', label: 'Diamond' }, { value: 'glyph', label: 'Glyph (by brightness)' },
    ], hint: 'What each piece is. Ball is a circle shaded as a little sphere (lit side, highlight, dark rim): CC Ball Action\'s look. Glyph picks a mark by the piece\'s brightness: dot, dash, plus, cross, ring, block.' },
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
    scatter: { label: 'Scatter', type: 'float', min: 0, max: 1, step: 0.001, hint: 'A random push per piece (picture units: 1 is half the frame\'s height), the same every frame. A little (0.01) breaks the grid up; more flings the pieces apart. Works with Amount 0.' },
    seed: { label: 'Seed', type: 'float', min: 0, max: 100, step: 1, hint: 'Another random layout.' },
    scatterTurn: { label: 'Scatter turn', type: 'float', min: 0, max: 180, step: 0.5, hint: 'Up to this many degrees of random turn per piece.' },
    scatterSize: { label: 'Scatter size', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Random size per piece: 0.3 makes them 70%–130% of Size.' },
    instability: { label: 'Instability', type: 'float', min: 0, max: 0.2, step: 0.001, hint: 'Every piece wobbles round its place, each at its own pace (picture units): CC Ball Action\'s Instability.' },
    dimFloor: { label: 'Dim floor', type: 'float', min: 0, max: 0.5, step: 0.01, hint: 'Lifts the darkest colours, so dark parts of the picture stay as dim pieces rather than black.' },
    focus: { label: 'Focus', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Where it is sharp, on the value that sizes the pieces (Size by depth: 1 near, 0 far; brightness: 1 bright; Nothing: the brightness). Pairs with Blur.' },
    blur: { label: 'Blur', type: 'float', min: 0, max: 4, step: 0.01, hint: 'Depth of field: out of focus, pieces spread into soft discs that keep their light, so the pieces far from Focus become haze or bokeh (0: everything sharp). Each Blur step lets a piece spread half a cell more, so the search looks that much further.' },
    ballLook: { label: 'Ball look', type: 'select', options: [
      { value: 'glow', label: 'Glowing: lit from within' }, { value: 'lit', label: 'Lit: a bead under a light' },
    ], showWhen: { param: 'shape', value: 'ball' }, hint: 'Glowing: each ball gives off its own colour, brightest at its centre and falling off to the rim (CC Ball Action\'s look). Lit: a sphere lit from Light angle, with a highlight and a dark rim.' },
    lightAngle: { label: 'Light angle', type: 'float', min: -180, max: 180, step: 1, showWhen: { param: 'ballLook', value: 'lit' }, hint: 'Where the light comes from, in degrees: 0 the right, 90 above, 135 the upper left.' },
    shading: { label: 'Shading', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'shape', value: 'ball' }, hint: 'How much each ball glows from its centre (or, Lit, is shaded as a sphere): 0 is a flat disc.' },
    background: { label: 'Background', type: 'vec3color', hint: 'What shows between the pieces (unless Background is wired).' },
  },
  glslFunctions: PIECES_GLSL,
  generateGLSL: (node, inputVars) => piecesCode(node, inputVars),
};

// ── Balls (3D) ───────────────────────────────────────────────────────────────

export const BALL_LIFT_BY = ['brightness', 'darkness', 'depth', 'none'] as const;

/** Own grid with sideways scatter: the cap on the neighbour search, cells each side (7 × 7 balls at most). The live radius stops the loops sooner. */
export const BALLS_SEARCH_CAP = 3;

export interface BallsOpts {
  /** The search's cap, cells each side (tests raise it). */
  cap?: number;
  /** Search every cell up to the cap, ignoring the live radius (the brute-force reference). */
  brute?: boolean;
}

/**
 * The Balls node's GLSL. Two layouts:
 *  - Own grid (the default): the node is the whole grid. It finds the cell the point is in (Pieces
 *    across × as many rows as the picture's Aspect gives, each Width ÷ Pieces across wide, centred on
 *    the origin), measures that cell's ball, and caps the distance at the cell's walls (towards cells
 *    that exist), so a ray never steps over a short ball's cell into a tall neighbour. With sideways
 *    Scatter (or Instability, or Scatter size) it measures the balls of the cells round it too, out to
 *    the furthest a ball can reach (a live radius, to BALLS_SEARCH_CAP), keeping the nearest. Twist
 *    turns the space the grid stands in. It works in any Scene Group, and after the March Loop at Hit
 *    Pos it gives the colour of the ball there.
 *  - Repeat Scene: one ball per copy, the copy's cell from Repeat Scene (or Repeat Cell's Cell, wired
 *    after the loop); Repeat Scene's own neighbour checks and wall cap apply.
 */
export function ballsCode(node: GraphNode, iv: Record<string, string>, opts: BallsOpts = {}): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const P = node.params;
  const num = (k: string, d: number) => iv[k] || p(P[k], d);
  const liftBy = pick(P.liftBy, BALL_LIFT_BY, 'brightness');
  const sizeBy = pick(P.sizeBy, PIECE_SIZE_BY, 'none');
  const box = P.shape === 'box';
  const own = P.layout !== 'repeat';
  const tex = iv.picture;
  const depth = iv.depth;
  const scat = live(P, iv, 'scatter');
  const scatD = live(P, iv, 'scatterDepth');
  const scatSize = live(P, iv, 'scatterSize');
  const inst = live(P, iv, 'instability');
  const twist = live(P, iv, 'twist');
  const anyRand = scat || scatD || scatSize || inst;
  // Depth of field (the particle camera's Focus and Blur): each ball grows by its circle of
  // confusion and its colour spreads thin over it, brightest in the middle, so it keeps its light.
  const dof = live(P, iv, 'blur');
  // Own grid: a ball may leave its cell sideways (or grow past it), so look round it.
  const search = own && (scat || inst || scatSize || dof);
  const cap = Math.max(1, Math.round(opts.cap ?? BALLS_SEARCH_CAP));
  let pos = iv.pos || 'vec3(0.0)';
  const L: string[] = [];
  const v = (s: string) => L.push(`    ${s}\n`);
  v(`float ${id}_n = max(floor(${num('count', 31)} + 0.5), 1.0);`);
  v(`float ${id}_asp = max(${num('aspect', 1.5)}, 0.05);`);
  if (anyRand) v(`float ${id}_seed = ${num('seed', 1)};`);
  if (scat) v(`float ${id}_scat = max(${num('scatter', 0)}, 0.0);`);
  if (scatD) v(`float ${id}_scd = ${num('scatterDepth', 0)};`);
  if (scatSize) v(`float ${id}_ssz = clamp(${num('scatterSize', 0)}, 0.0, 1.0);`);
  if (inst) v(`float ${id}_ins = abs(${num('instability', 0)});`);
  if (twist) v(`float ${id}_tw = radians(${num('twist', 0)});`);
  if (dof) {
    v(`float ${id}_blur = max(${num('blur', 0)}, 0.0);`);
    v(`float ${id}_focus = ${num('focus', 0)};`);
  }
  if (own && twist) {
    // Twist (own grid): the space the grid stands in turned round the middle, Twist degrees per unit
    // out, so a ball at home h sits at h turned by Twist × |h|. Turning keeps |p|, so the turn back is
    // exact; the distance is shrunk by the twist's stretch so rays don't overstep.
    v(`vec3 ${id}_p0 = ${pos};`);
    v(`float ${id}_ta = -${id}_tw * length(${id}_p0.xy);`);
    v(`vec3 ${id}_pw = vec3(mat2(cos(${id}_ta), sin(${id}_ta), -sin(${id}_ta), cos(${id}_ta)) * ${id}_p0.xy, ${id}_p0.z);`);
    pos = `${id}_pw`;
  }
  if (own) {
    v(`float ${id}_cs1 = max(${num('width', 4)}, 1.0e-3) / ${id}_n;`);
    v(`vec2 ${id}_cs = vec2(${id}_cs1);`);
    v(`vec2 ${id}_nm = vec2(${id}_n, max(floor(${id}_n / ${id}_asp + 0.5), 1.0));`);
    v(`vec2 ${id}_mid = (${id}_nm - 1.0) * 0.5;`);
    v(`vec2 ${id}_ci = clamp(floor(${pos}.xy / ${id}_cs1 + ${id}_mid + 0.5), vec2(0.0), ${id}_nm - 1.0);`);
    v(`vec2 ${id}_span = ${id}_nm * ${id}_cs1;`);
  } else {
    v(`vec2 ${id}_cs = max(${CELL3SIZE_GLOBAL}.xy, vec2(1.0e-4));`);
    v(`float ${id}_W = ${id}_n * ${id}_cs.x;`);
    v(`vec2 ${id}_span = vec2(${id}_W, ${id}_W / ${id}_asp);`);
  }
  const drive = (k: string, by: string) => (by === 'brightness' ? `${k}lum` : by === 'darkness' ? `(1.0 - ${k}lum)` : by === 'depth' ? `${k}dep` : '0.0');
  /** One ball: its cell (`cellExpr`), home, colour, lift, size, centre and distance, named `${k}…`. */
  const ball = (k: string, cellExpr: string, ind: string, prune?: string) => {
    const w = (s: string) => L.push(`    ${ind}${s}\n`);
    w(`vec3 ${k}cell = ${cellExpr};`);
    w(`vec2 ${k}home = ${k}cell.xy * ${id}_cs;`);
    // A neighbour too far sideways even moved the furthest any ball moves: skipped at once.
    if (prune) w(`if (length(${pos}.xy - ${k}home) - ${id}_m - ${id}_rmax > ${prune}) continue;`);
    w(`float ${k}rnd = fract(sin(dot(${k}cell.xy, vec2(12.9898, 78.233))) * 43758.5453);`);
    if (anyRand) {
      w(`vec4 ${k}rr = pieces_rand4(${k}cell.xy, ${id}_seed);`);
      if (scatD || inst) w(`vec4 ${k}rs = pieces_rand4(${k}cell.xy + vec2(101.0, 57.0), ${id}_seed);`);
    }
    // The moves that need no picture: Scatter's random point in a ball of radius Scatter (direction
    // from rr.x and rr.y, distance ∛rr.z: even through the ball), Scatter depth's push along Z, and
    // Instability's wobble (each ball its own pace and phase).
    const extra: string[] = [];
    if (scat) {
      w(`float ${k}sz = 2.0 * ${k}rr.x - 1.0;`);
      w(`float ${k}sa = 6.2831853 * ${k}rr.y;`);
      w(`vec3 ${k}sv = ${id}_scat * pow(${k}rr.z, 0.3333333) * vec3(sqrt(max(1.0 - ${k}sz * ${k}sz, 0.0)) * vec2(cos(${k}sa), sin(${k}sa)), ${k}sz);`);
      extra.push(`${k}sv`);
    }
    if (scatD) extra.push(`vec3(0.0, 0.0, ${id}_scd * (2.0 * ${k}rs.x - 1.0))`);
    if (inst) {
      w(`float ${k}fq = 0.6 + 0.8 * ${k}rs.y;`);
      w(`vec3 ${k}wv = ${id}_ins * vec3(sin(6.2831853 * (u_time * ${k}fq + ${k}rs.z)), sin(6.2831853 * (u_time * ${k}fq * 0.87 + ${k}rs.w)), sin(6.2831853 * (u_time * ${k}fq * 1.13 + ${k}rr.w)));`);
      extra.push(`${k}wv`);
    }
    // Repeat Scene: Twist moves each ball round the middle (Repeat Scene's neighbour checks find it).
    if (!own && twist) {
      w(`float ${k}ta = ${id}_tw * length(${k}home);`);
      extra.push(`vec3(mat2(cos(${k}ta), sin(${k}ta), -sin(${k}ta), cos(${k}ta)) * ${k}home - ${k}home, 0.0)`);
    }
    // A neighbour whose ball sits further sideways than the nearest found so far (plus the biggest
    // ball) can't be nearer: skipped before its picture is read (now its own move is known).
    // Everything but the lift (which needs the picture): a ring wave rolling out from the middle, a
    // random push per ball along Z, Displace and the moves above.
    w(`float ${k}wave = ${num('wave', 0)} * sin(length(${k}home) * ${num('waveFreq', 6)} - u_time * ${num('waveSpeed', 2)});`);
    w(`vec3 ${k}c0 = vec3(0.0, 0.0, ${k}wave + ${num('jitter', 0)} * (${k}rnd - 0.5)) + ${iv.displace || 'vec3(0.0)'}${extra.map(e => ` + ${e}`).join('')};`);
    if (prune) {
      // Its centre is known but for the lift, which lies between 0 and Lift: if even the nearest it
      // could be (sideways, and in depth over that span) is further than the nearest so far, skip it.
      w(`vec2 ${k}lat = ${pos}.xy - ${k}home - ${k}c0.xy;`);
      w(`float ${k}dz = max(max(${k}c0.z + min(0.0, ${num('lift', 1.5)}) - ${pos}.z, ${pos}.z - ${k}c0.z - max(0.0, ${num('lift', 1.5)})), 0.0);`);
      w(`if (sqrt(dot(${k}lat, ${k}lat) + ${k}dz * ${k}dz) - ${id}_rmax > ${prune}) continue;`);
    }
    // Mirror X: the March Camera's right is −X when it looks along −Z (Angle 0), so the picture reads
    // the right way round from there.
    w(`vec2 ${k}st = ${k}home / ${id}_span * vec2(${P.mirror === false ? '1.0' : '-1.0'}, 1.0) + 0.5;`);
    w(`float ${k}in = step(0.0, ${k}st.x) * step(${k}st.x, 1.0) * step(0.0, ${k}st.y) * step(${k}st.y, 1.0);`);
    w(`vec3 ${k}col = ${tex ? `textureLod(${tex}, clamp(${k}st, 0.0, 1.0), 0.0).rgb` : `(0.5 + 0.5 * cos(6.2831853 * (dot(${k}st, vec2(0.8, 0.3)) + vec3(0.0, 0.33, 0.67))))`};`);
    w(`float ${k}lum = dot(${LUMA}, clamp(${k}col, 0.0, 1.0));`);
    w(`float ${k}dep = ${depth ? `textureLod(${depth}, clamp(${k}st, 0.0, 1.0), 0.0).r` : `${k}lum`};`);
    w(`float ${k}lift = ${num('lift', 1.5)} * ${drive(k, liftBy)};`);
    w(`float ${k}r = 0.5 * min(${id}_cs.x, ${id}_cs.y) * max(${num('size', 0.9)}, 0.0)${sizeBy !== 'none' ? ` * mix(clamp(${num('minSize', 0.3)}, 0.0, 1.0), 1.0, clamp(${drive(k, sizeBy)}, 0.0, 1.0))` : ''}${scatSize ? ` * (1.0 + ${id}_ssz * (2.0 * ${k}rr.w - 1.0))` : ''} * ${k}in;`);
    // Along Z (towards a camera at Angle 0): the lift, on top of the rest.
    w(`vec3 ${k}c = ${k}c0 + vec3(0.0, 0.0, ${k}lift);`);
    if (dof) {
      // The circle of confusion: Blur × how far the ball is from the Focus depth (along Z), in half
      // cells, at most 1.5 cells. The ball grows by it; its light is spread over the bigger disc.
      w(`float ${k}r0 = ${k}r;`);
      w(`float ${k}coc = 0.5 * min(${id}_cs.x, ${id}_cs.y) * min(${id}_blur * abs(${k}c.z - ${id}_focus), 3.0) * ${k}in;`);
      w(`${k}r += ${k}coc;`);
    }
    w(`vec3 ${k}q = ${pos} - ${own ? `vec3(${k}home, 0.0)` : 'vec3(0.0)'} - ${k}c;`);
    if (dof) {
      w(`float ${k}rho = clamp(length(${k}q.xy) / max(${k}r, 1.0e-6), 0.0, 1.0);`);
      w(`${k}col *= mix(1.0, ${k}r0 * ${k}r0 / max(${k}r * ${k}r, 1.0e-12) * 2.0 * (1.0 - ${k}rho * ${k}rho), ${k}coc / max(${k}r, 1.0e-6));`);
    }
    if (box) {
      w(`vec3 ${k}b = abs(${k}q) - vec3(${k}r * 0.8);`);
      w(`float ${k}dist = length(max(${k}b, 0.0)) + min(max(${k}b.x, max(${k}b.y, ${k}b.z)), 0.0) - ${k}r * 0.2;`);
    } else w(`float ${k}dist = length(${k}q) - ${k}r;`);
  };
  const me = `${id}_`;
  const capLines = () => {
    // The wall cap: never step past this cell's wall into a neighbour (only towards cells that exist).
    v(`vec2 ${id}_f = ${pos}.xy - (${id}_ci - ${id}_mid) * ${id}_cs1;`);
    v(`float ${id}_wall = 1.0e5;`);
    v(`if (${id}_ci.x < ${id}_nm.x - 1.5) ${id}_wall = min(${id}_wall, 0.5 * ${id}_cs1 - ${id}_f.x);`);
    v(`if (${id}_ci.x > 0.5) ${id}_wall = min(${id}_wall, 0.5 * ${id}_cs1 + ${id}_f.x);`);
    v(`if (${id}_ci.y < ${id}_nm.y - 1.5) ${id}_wall = min(${id}_wall, 0.5 * ${id}_cs1 - ${id}_f.y);`);
    v(`if (${id}_ci.y > 0.5) ${id}_wall = min(${id}_wall, 0.5 * ${id}_cs1 + ${id}_f.y);`);
    // Off the grid (plus the furthest a ball moves sideways), or in front of or behind the slab the
    // balls can be in, every ball is at least that far away, so the cap never holds a ray back out
    // there (it would run out of steps).
    v(`float ${id}_out = length(max(abs(${pos}.xy) - 0.5 * ${id}_span${search ? ` - ${id}_m` : ''}, 0.0));`);
    v(`float ${id}_slab = max(min(0.0, ${num('lift', 1.5)}) - ${id}_zr - ${pos}.z, ${pos}.z - max(0.0, ${num('lift', 1.5)}) - ${id}_zr);`);
  };
  const capExpr = `max(max(${id}_wall, 0.0) + 0.04 * ${id}_cs1 + 1.0e-3, max(${id}_out, ${id}_slab))`;
  const zExtra = `${scat ? ` + ${id}_scat` : ''}${scatD ? ` + abs(${id}_scd)` : ''}${inst ? ` + ${id}_ins` : ''}`;
  // How far in front of or behind the lift a ball's centre (and its surface) can be.
  const zrLine = () => v(`float ${id}_zr = abs(${num('wave', 0)}) + 0.5 * abs(${num('jitter', 0)}) + 0.5 * ${id}_cs1 * max(${num('size', 0.9)}, 0.0)${scatSize ? ` * (1.0 + ${id}_ssz)` : ''}${dof ? ` + 1.5 * ${id}_cs1` : ''} + ${iv.displace ? `abs((${iv.displace}).z)` : '0.0'}${zExtra};`);
  if (!own) ball(me, iv.cell || CELL3_GLOBAL, '');
  else if (!search) {
    ball(me, `vec3(${id}_ci - ${id}_mid, 0.0)`, '');
    zrLine();
    capLines();
    v(`${id}_dist = min(${id}_dist, ${capExpr});`);
  } else {
    // This cell's ball first (its outputs are the default), then the neighbours: every cell whose
    // ball can reach into this cell (as before Scatter, the step stops 0.04 of a cell past its walls): the
    // furthest a ball moves sideways (Scatter, Instability × √2, a sideways Displace) plus the biggest
    // ball (Scatter size, Blur's circle of confusion), in cells. The nearest ball wins.
    v(`float ${id}_m = ${scat ? `${id}_scat` : '0.0'}${inst ? ` + 1.4143 * ${id}_ins` : ''}${iv.displace ? ` + length((${iv.displace}).xy)` : ''};`);
    zrLine();
    v(`float ${id}_rmax = 0.5 * ${id}_cs1 * max(${num('size', 0.9)}, 0.0)${scatSize ? ` * (1.0 + ${id}_ssz)` : ''}${dof ? ` + 0.5 * ${id}_cs1 * min(${id}_blur * (abs(${num('lift', 1.5)}) + ${id}_zr + abs(${id}_focus)), 3.0)` : ''};`);
    // Every ball outside the window is at least (R + 1) cells, less this point's offset in its cell,
    // Scatter and the biggest ball, away sideways: a ray may step that far when it is more than this
    // cell's wall cap. Nothing reaching a neighbour (Scatter and the rest at 0, as a live slider can
    // be): R is 0, the loop is skipped and the step is the wall cap, as without Scatter.
    v(`float ${id}_R = min(max(ceil((${id}_m + ${id}_rmax) / ${id}_cs1 - 0.501), 0.0), ${cap.toFixed(1)});`);
    ball(me, `vec3(${id}_ci - ${id}_mid, 0.0)`, '');
    capLines();
    v(`float ${id}_far = ${id}_R > 0.5 ? max(${capExpr}, (${id}_R + 1.0) * ${id}_cs1 - max(abs(${id}_f.x), abs(${id}_f.y)) - ${id}_m - ${id}_rmax) : ${capExpr};`);
    v(`float ${id}_best = ${opts.brute ? '1.0e5' : `min(${id}_dist, ${id}_far)`};`);
    // Only the columns and rows whose balls could come that near this point (sideways, along each
    // axis): on this side of the cell, usually one or two each way rather than the whole window.
    // The brute-force reference (tests) walks the whole window, −cap…cap.
    v(`vec2 ${id}_lo = ${opts.brute ? `vec2(-${cap}.0)` : `max(ceil((${id}_f - ${id}_m - ${id}_rmax - ${id}_best) / ${id}_cs1), vec2(-${id}_R))`};`);
    v(`vec2 ${id}_hi = ${opts.brute ? `vec2(${cap}.0)` : `min(floor((${id}_f + ${id}_m + ${id}_rmax + ${id}_best) / ${id}_cs1), vec2(${id}_R))`};`);
    // Counted from lo and stopped past hi (break, not continue), so a step runs only the cells it needs.
    if (!opts.brute) L.push(`    if (${id}_R > 0.5) {\n`);
    L.push(`    for (int ${id}_jj = 0; ${id}_jj < ${2 * cap + 1}; ${id}_jj++) {\n`);
    v(`  float ${id}_j = ${id}_lo.y + float(${id}_jj);`);
    v(`  if (${id}_j > ${id}_hi.y) break;`);
    L.push(`      for (int ${id}_ii = 0; ${id}_ii < ${2 * cap + 1}; ${id}_ii++) {\n`);
    v(`    float ${id}_i = ${id}_lo.x + float(${id}_ii);`);
    v(`    if (${id}_i > ${id}_hi.x) break;`);
    v(`    if (${id}_i == 0.0 && ${id}_j == 0.0) continue;`);
    v(`    vec2 ${id}_kci = ${id}_ci + vec2(${id}_i, ${id}_j);`);
    v(`    if (${id}_kci.x < 0.0 || ${id}_kci.y < 0.0 || ${id}_kci.x > ${id}_nm.x - 1.0 || ${id}_kci.y > ${id}_nm.y - 1.0) continue;`);
    ball(`${id}_k`, `vec3(${id}_kci - ${id}_mid, 0.0)`, '    ', opts.brute ? undefined : `${id}_best`);
    v(`    if (${id}_kdist < ${id}_dist) { ${id}_dist = ${id}_kdist; ${id}_cell = ${id}_kcell; ${id}_st = ${id}_kst; ${id}_col = ${id}_kcol; ${id}_lift = ${id}_klift; ${id}_c = ${id}_kc; ${id}_best = min(${id}_best, ${id}_kdist); }`);
    L.push('      }\n');
    L.push('    }\n');
    if (!opts.brute) L.push('    }\n');
    // (The brute-force reference keeps the nearest ball of all, before any cap, for the tests.)
    if (opts.brute) v(`float ${id}_bmin = ${id}_dist;`);
    v(`${id}_dist = min(${id}_dist, ${opts.brute ? capExpr : `${id}_far`});`);
  }
  if (own && twist) v(`${id}_dist /= sqrt(1.0 + ${id}_tw * ${id}_tw * dot(${id}_p0.xy, ${id}_p0.xy));`);
  return {
    code: L.join(''),
    outputVars: { dist: `${id}_dist`, color: `${id}_col`, home: `${id}_st`, lift: `${id}_lift`, centre: `${id}_c`, cell: `${id}_cell` },
  };
}

/**
 * How far the furthest piece or ball reaches, in cells, against the search's cap, from the node's
 * own numbers (a wired value can't be known here): for the card's warning. Pieces assumes a 16:9 frame.
 */
export function scatterReach(node: GraphNode): { reach: number; cap: number } | null {
  const P = node.params;
  const n = (k: string, d: number) => (typeof P[k] === 'number' ? P[k] as number : d);
  if (node.type === 'pieces') {
    const near = P.searchMode === 'near';
    const cs = 2 * (16 / 9) / Math.max(1, Math.round(n('count', 32)));
    const shape = pick(P.shape, PIECE_SHAPES, 'circle');
    const reach = n('size', 1) * (1 + Math.min(Math.max(n('scatterSize', 0), 0), 1)) * SHAPE_REACH[shape] * 0.5 + Math.max(n('search', 1), 0)
      + Math.min(Math.max(n('stagger', 0), 0), 1) * 0.5 + (Math.max(n('scatter', 0), 0) + 1.4143 * Math.abs(n('instability', 0))) / cs + Math.max(n('blur', 0), 0);
    // The loops run to the cap and skip rows and columns past reach + 1 (a row's offset): cut past cap − 1.
    return { reach, cap: (near ? PIECES_SEARCH_CAP : PIECES_FULL_CAP) - 1 };
  }
  if (node.type === 'pieceBalls') {
    if (P.layout === 'repeat') return null;
    const cs = Math.max(n('width', 4), 1e-3) / Math.max(1, Math.round(n('count', 31)));
    const m = Math.max(n('scatter', 0), 0) + 1.4143 * Math.abs(n('instability', 0));
    const rmax = 0.5 * cs * Math.max(n('size', 0.9), 0) * (1 + Math.min(Math.max(n('scatterSize', 0), 0), 1)) + (n('blur', 0) > 0 ? 1.5 * cs : 0);
    return { reach: (m + rmax) / cs - 0.5, cap: BALLS_SEARCH_CAP };
  }
  return null;
}

export const BallsNode: NodeDefinition = {
  type: 'pieceBalls',
  label: 'Balls',
  category: '3D Primitives',
  aliases: ['Picture balls', 'CC Ball Action', 'Ball action', 'Picture as balls', 'Pieces 3D'],
  description: 'A picture rebuilt from balls (CC Ball Action): a grid of spheres or boxes, each the picture\'s colour at its home, lifted towards the camera by the brightness or a Depth texture, with a wave, a random push and a Displace wire. On its own grid it is one shape for any Scene Group (and, after the March Loop at Hit Pos, gives the colour of the ball there); or one ball per copy of a Repeat Scene, so Displace can come from Repeat Cell.',
  brief: {
    summary: 'A picture as a grid of balls, lifted by brightness or depth: CC Ball Action in 3D.',
    start: [
      'Easiest: Scene builder → 3D scene → the "Picture as balls" template.',
      'By hand: in a Scene Group, Scene Pos → Balls → Scene Output; wire the picture into the group and on to Picture.',
      'After the March Loop, another Balls (same settings) at Hit Pos gives each ball\'s colour.',
    ],
  },
  inputs: {
    pos: { type: 'vec3', label: 'Position', hint: 'Scene Pos inside the Scene Group (with Repeat Scene: already moved into this copy\'s cell). After the March Loop: Hit Pos, for the colour of the ball there.' },
    picture: { type: 'texture', label: 'Picture', hint: 'The picture the balls take their colour and lift from.' },
    depth: { type: 'texture', label: 'Depth', hint: 'A Depth node\'s Depth texture: with Lift by Depth, near parts of the picture come forward.' },
    displace: { type: 'vec3', label: 'Displace', hint: 'Moves the ball. Under Repeat Scene, wire anything worked out from Repeat Cell\'s Centre or Random (noise, a wave), so every ball moves its own way. On its own grid keep it along Z (each ball must stay over its cell): for sideways moves use Scatter, which the grid searches round.' },
    cell: { type: 'vec3', label: 'Cell', hint: 'Repeat Scene layout, after the March Loop: Repeat Cell\'s Cell (with the Repeat Scene and Hit Pos wired in), for the colour of the ball each ray hit.' },
    lift: { type: 'float', label: 'Lift', hint: 'How far the brightest (or nearest) balls come forward.' },
    size: { type: 'float', label: 'Size', hint: 'A ball\'s size: 1 touches its neighbours.' },
    minSize: { type: 'float', label: 'Min size', hint: 'With Size by: the smallest ball, as a share of Size.' },
    count: { type: 'float', label: 'Pieces across', hint: 'How many balls across the picture.' },
    width: { type: 'float', label: 'Width', hint: 'Own grid: how wide the picture is, in scene units.' },
    aspect: { type: 'float', label: 'Aspect', hint: 'The picture\'s width ÷ height.' },
    wave: { type: 'float', label: 'Wave', hint: 'How far a ring wave rolling out from the middle moves the balls along Z.' },
    waveFreq: { type: 'float', label: 'Wave rings', hint: 'How close together the wave\'s rings are.' },
    waveSpeed: { type: 'float', label: 'Wave speed', hint: 'How fast the wave rolls out.' },
    jitter: { type: 'float', label: 'Jitter', hint: 'A random push along Z per ball.' },
    scatter: { type: 'float', label: 'Scatter', hint: 'A random push per ball in every direction (X, Y and Z, scene units), the same each frame. Wire an LFO to scatter and return.' },
    scatterDepth: { type: 'float', label: 'Scatter depth', hint: 'A random push per ball towards or away from the camera only (scene units).' },
    scatterSize: { type: 'float', label: 'Scatter size', hint: 'Random size per ball: 0.3 makes them 70%–130% of Size.' },
    seed: { type: 'float', label: 'Seed', hint: 'Another random layout for the scatter.' },
    twist: { type: 'float', label: 'Twist', hint: 'Turns the balls round the middle, this many degrees per scene unit out: the outer balls turn most.' },
    instability: { type: 'float', label: 'Instability', hint: 'Every ball wobbles round its place, each at its own pace (scene units).' },
    focus: { type: 'float', label: 'Focus', hint: 'The depth (Z) where the balls are sharp. Pairs with Blur.' },
    blur: { type: 'float', label: 'Blur', hint: 'Depth of field: out of focus, balls spread into soft discs that keep their light (0: everything sharp).' },
  },
  socketsOnDemand: { minSize: ['minSize'], count: ['count'], width: ['width'], aspect: ['aspect'], waveFreq: ['waveFreq'], waveSpeed: ['waveSpeed'], jitter: ['jitter'], scatterSize: ['scatterSize'], seed: ['seed'], twist: ['twist'], instability: ['instability'], focus: ['focus'], blur: ['blur'] },
  outputs: {
    dist: { type: 'float', label: 'Distance', hint: 'The distance to this copy\'s ball: into Scene Output.' },
    color: { type: 'vec3', label: 'Colour', hint: 'The picture\'s colour at this ball\'s home.' },
    home: { type: 'vec2', label: 'Home', hint: 'Where on the picture this ball comes from (0–1).' },
    lift: { type: 'float', label: 'Lift', hint: 'How far this ball is lifted.' },
    centre: { type: 'vec3', label: 'Centre', hint: 'The ball\'s centre from its home (lift, wave, jitter and Displace).' },
    cell: { type: 'vec3', label: 'Cell', hint: 'Which ball: its column and row from the middle.' },
  },
  defaultParams: { layout: 'own', shape: 'sphere', liftBy: 'brightness', sizeBy: 'none', lift: 0.6, size: 0.9, minSize: 0.3, count: 41, width: 4, aspect: 1.5, wave: 0, waveFreq: 6, waveSpeed: 2, jitter: 0, scatter: 0, scatterDepth: 0, scatterSize: 0, seed: 1, twist: 0, instability: 0, focus: 0, blur: 0, mirror: true },
  paramDefs: {
    layout: { label: 'Grid', type: 'select', options: [
      { value: 'own', label: 'Its own grid' }, { value: 'repeat', label: 'One ball per Repeat Scene copy' },
    ], hint: 'Its own grid: the node is the whole picture of balls (Width, Pieces across), one shape for any scene. One per Repeat Scene copy: put it in the Scene Group a Repeat Scene repeats; the copy spacing is the ball spacing and Displace can differ per copy (Repeat Cell).' },
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
    count: { label: 'Pieces across', type: 'float', min: 1, max: 201, step: 1, hint: 'How many balls across the picture. With Repeat Scene: its Copies each side X × 2 + 1.' },
    width: { label: 'Width', type: 'float', min: 0.1, max: 40, step: 0.01, showWhen: { param: 'layout', value: 'own' }, hint: 'How wide the picture is, in scene units.' },
    aspect: { label: 'Aspect', type: 'float', min: 0.2, max: 4, step: 0.01, hint: 'The picture\'s width ÷ height (1.5 for 3:2).' },
    wave: { label: 'Wave', type: 'float', min: -3, max: 3, step: 0.01, hint: 'A ring wave rolling out from the middle, this far along Z.' },
    waveFreq: { label: 'Wave rings', type: 'float', min: 0, max: 40, step: 0.1, hint: 'How close together the wave\'s rings are (per scene unit).' },
    waveSpeed: { label: 'Wave speed', type: 'float', min: -10, max: 10, step: 0.01, hint: 'How fast it rolls out.' },
    jitter: { label: 'Jitter', type: 'float', min: 0, max: 3, step: 0.01, hint: 'A random push along Z per ball: the picture breaks into depth.' },
    scatter: { label: 'Scatter', type: 'float', min: 0, max: 2, step: 0.001, hint: 'A random push per ball in X, Y and Z (scene units), the same every frame (Seed). On its own grid the balls round each point are searched out to the furthest one can reach, so they are never cut (up to 3 cells sideways: the card warns past that).' },
    scatterDepth: { label: 'Scatter depth', type: 'float', min: -3, max: 3, step: 0.01, hint: 'A random push per ball along Z only: the picture breaks up towards and away from the camera.' },
    scatterSize: { label: 'Scatter size', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Random size per ball: 0.3 makes them 70%–130% of Size.' },
    seed: { label: 'Seed', type: 'float', min: 0, max: 100, step: 1, hint: 'Another random layout.' },
    twist: { label: 'Twist', type: 'float', min: -360, max: 360, step: 1, hint: 'Degrees per scene unit from the middle: the grid turns round its centre, the outer balls most (CC Ball Action\'s Twist).' },
    instability: { label: 'Instability', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Every ball wobbles round its place in X, Y and Z, each at its own pace (scene units).' },
    focus: { label: 'Focus', type: 'float', min: -3, max: 3, step: 0.01, hint: 'Where it is sharp: the depth along Z (towards a camera at Angle 0) where balls are in focus. 0 is the picture\'s plane; Lift brings the brightest balls to Lift. Pairs with Blur.' },
    blur: { label: 'Blur', type: 'float', min: 0, max: 4, step: 0.01, hint: 'Depth of field: out of focus, balls spread into soft discs that keep their light (0: everything sharp). Each ball grows by Blur × its distance from Focus, up to a cell and a half each side, and its colour thins out towards the edge. On its own grid the neighbours are searched that much further. The discs fade to black, not to what is behind them: best on a dark background.' },
    mirror: { label: 'Face a camera at Angle 0', type: 'bool', hint: 'On: the picture reads the right way round from a March Camera at Angle 0 (looking along −Z). Off: from Angle π.' },
  },
  declarationsFor: () => [CELL3_DECL],
  glslFunctions: [PIECES_RAND_GLSL],
  generateGLSL: (node, inputVars) => ballsCode(node, inputVars),
};
