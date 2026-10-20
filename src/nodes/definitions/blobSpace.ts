/**
 * Blob Space (docs/combine.md, "Replace mask with"): each pixel's place inside the blob it is on. Wire Blob Track's
 * Blob data in; out come the blob's Slot (0 the oldest blob seen now, 1 the next…), its ID, the pixel's Local UV in
 * the blob's box (as the UV node gives it, so any picture chain drawn at Local UV lands on the blob), Inside and Edge.
 *
 * With a Fill wired (a field socket, docs/field-sockets.md) the fill chain is drawn again inside every blob, at that
 * blob's Local UV: one 2D build, a gradient, a noise, fitted to every person the Segment node finds, with no pass. A
 * Fill texture (a photo, a video, a Pass, Draw agents' Image) is read at the blob's 0–1 UV instead. The fill is only
 * worked out where a blob is (an `if` round it), so it costs nothing elsewhere.
 *
 * Fit: Box stretches the fill to the blob's box (the whole fill, squeezed); Square keeps the fill's shape (its middle
 * square, as big as the blob's longer side); Circle is Square cut round. Padding grows every box by a share of its
 * size, Scale grows the fill against the blob, Spin by ID turns each blob's fill by its own angle.
 *
 * One blob (`only`): only the blob picked By order (its Slot) or By ID is filled. A chain of Blob Spaces, one per
 * blob, each with its own Fill, is how per-blob fills are built (phase 3 of docs/combine-plan.md).
 *
 * The maths is mirrored on the CPU (blobSpaceAt) for the tests.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn, p, withParamSockets } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { BLOB_SLOTS } from '../../lib/blobs/track';

export const BLOB_SPACE_TYPE = 'blobSpace';

export type BlobFit = 'box' | 'square' | 'circle';
export const BLOB_FITS: readonly BlobFit[] = ['box', 'square', 'circle'];
export const blobFitOf = (v: unknown): BlobFit => (v === 'box' || v === 'circle' ? v : 'square');

const FIT = 'Fit';
const WHICH = 'Which blobs';

/** The golden-ratio angle step Spin by ID turns each blob by (the same as Blob Track's Stamp). */
const SPIN_STEP = 0.618034;

export const BlobSpaceNode: NodeDefinition = withParamSockets({
  type: BLOB_SPACE_TYPE,
  label: 'Blob Space',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Blob UV', 'Fill blobs', 'Replace people', 'Per blob UV', 'Stick to blob', 'Blob local'],
  description: 'Where each pixel is inside the blob it is on: wire Blob Track\'s Blob data in. Local UV is the pixel\'s place in the blob\'s box, as the UV node gives it, so a picture drawn at Local UV sits on the blob and follows it. Wire a colour chain into Fill and it is drawn on every blob (Color, with Alpha to lay it over); or a texture into Fill texture. Slot and ID tell the blobs apart.',
  inputs: {
    blobs: { type: 'texture', label: 'Blob data', hint: 'Blob Track\'s Blob data: where the blobs are, their size and ID.' },
    fill: { type: 'vec3', label: 'Fill', field: true, hint: 'A colour chain (a 2D scene, a gradient, a noise…): drawn again on every blob, at its Local UV. A Cell node inside the chain gives the blob\'s Slot (x) and ID (y).' },
    fillTexture: { type: 'texture', label: 'Fill texture', hint: 'A picture, a video, a Pass or Draw agents\' Image, read on every blob at its 0–1 UV. Used when Fill is not wired.' },
    mask: { type: 'float', label: 'Mask', hint: 'Where the fill may show inside a blob (1) or not (0): the Segment node\'s Mask, so the fill takes the person\'s shape. Unwired: the whole box.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to measure, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The fill on every blob (black elsewhere). Without a fill: each blob\'s ID colour.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'How much the fill shows here: Inside (soft at its edge) times Mask. Mix your picture to Color by it.' },
    localUv: { type: 'vec2', label: 'Local UV', hint: 'This pixel\'s place in its blob, centred, as the UV node gives it (Box: the whole frame squeezed into the box; Square: the frame\'s middle square).' },
    texUv: { type: 'vec2', label: 'Blob UV (0–1)', hint: 'The same place as 0–1 across the blob\'s box: for Sample or Read (texture).' },
    inside: { type: 'float', label: 'Inside', hint: '1 inside a blob\'s fitted box (or circle), soft at the edge.' },
    edge: { type: 'float', label: 'Edge', hint: 'Bright along the fitted box\'s edge.' },
    slot: { type: 'float', label: 'Slot', hint: 'Which blob: 0 the oldest one seen now, 1 the next… (−1 on none). Steady while blobs come and go.' },
    id: { type: 'float', label: 'ID', hint: 'The blob\'s tracked ID (0 on none): it stays with a blob while it is followed.' },
    size: { type: 'vec2', label: 'Size', hint: 'The blob\'s box, width and height in picture units (as Blob Track\'s Size).' },
  },
  defaultParams: { fit: 'square', padding: 0.1, scale: 1, spin: 0, softness: 0.04, only: 'all', onlyBy: 'order', onlyIndex: 0 },
  paramDefs: {
    fit: { label: 'Fit', type: 'select', section: FIT, hint: 'Box: the fill stretched to each blob\'s box. Square: the fill keeps its shape, as big as the blob. Circle: Square, cut round.', options: [
      { value: 'box', label: 'Box (stretch)' }, { value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' },
    ] },
    padding: { label: 'Padding', type: 'float', min: -0.5, max: 1, step: 0.01, section: FIT, hint: 'Grows every box by this share of its size (negative shrinks it).' },
    scale: { label: 'Fill scale', type: 'float', min: 0.1, max: 4, step: 0.01, section: FIT, hint: 'The fill against its blob: 2 shows it twice as big (and cropped), 0.5 half as big.' },
    spin: { label: 'Spin by ID', type: 'float', min: 0, max: 1, step: 0.01, section: FIT, hint: 'Turns each blob\'s fill by a different angle (from its ID): 0 all upright, 1 any angle.' },
    softness: { label: 'Edge softness', type: 'float', min: 0, max: 0.5, step: 0.005, section: FIT, hint: 'How soft the fitted box\'s edge is, as a share of its size.' },
    only: { label: 'Fill', type: 'select', section: WHICH, hint: 'Every blob, or only one (By order or By ID): a Blob Space per blob, each with its own Fill, gives each blob its own picture.', options: [
      { value: 'all', label: 'Every blob' }, { value: 'one', label: 'One blob' },
    ] },
    onlyBy: { label: 'Pick by', type: 'select', section: WHICH, showWhen: { param: 'only', value: 'one' }, hint: 'By order: the Nth blob seen now, oldest first (steady when others come and go). By ID: the blob with this tracked ID (IDs grow as new blobs appear, so it suits short clips).', options: [
      { value: 'order', label: 'By order' }, { value: 'id', label: 'By ID' },
    ] },
    onlyIndex: { label: 'Which', type: 'int', min: 0, max: 64, step: 1, section: WHICH, showWhen: { param: 'only', value: 'one' }, hint: 'By order: 0 is the oldest blob, 1 the next… By ID: the ID (from 1).' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const v = (k: string) => `${id}_${k}`;
    const S = inputVars.blobs;
    const fill = fieldFn(inputVars.fill);
    const tex = inputVars.fillTexture;
    const fit = blobFitOf(P.fit);
    const one = P.only === 'one';
    const byId = P.onlyBy === 'id';
    const L: string[] = [];
    const add = (s: string) => L.push(`    ${s}\n`);
    add(`vec2 ${v('st')} = ${texUv(inputVars.uv ?? 'g_uv')};`);
    add(`vec2 ${v('px')} = ${v('st')} * u_resolution;`);
    add(`float ${v('asp')} = u_resolution.x / u_resolution.y;`);
    // The fit's settings, read once (and read even with no Blob data wired, so their sliders are live).
    add(`float ${v('pad')} = ${p(P.padding, 0.1)}, ${v('spin')} = ${p(P.spin, 0)}, ${v('soft')} = max(${p(P.softness, 0.04)}, 1e-4);`);
    // The best blob here: the most covered, then the nearest centre. q: the pixel in its fitted box (−1…1).
    add(`float ${v('cov')} = 0.0, ${v('e')} = 1.0e3, ${v('slot')} = -1.0, ${v('bid')} = 0.0;`);
    add(`vec2 ${v('q')} = vec2(0.0), ${v('size')} = vec2(0.0);`);
    if (S) {
      add(`for (int i = 0; i < ${BLOB_SLOTS}; i++) {`);
      add(`  vec4 b = texelFetch(${S}, ivec2(i, 0), 0); vec4 m = texelFetch(${S}, ivec2(i, 1), 0);`);
      // The slots are filled from 0, oldest ID first: the first empty one ends the list.
      add(`  if (m.w < 0.5) break;`);
      if (one) add(`  if (${byId ? `abs(m.x - ${p(P.onlyIndex, 0)}) > 0.5` : `i != int(floor(${p(P.onlyIndex, 0)} + 0.5))`}) continue;`);
      add(`  vec2 bs = b.zw * u_resolution * (1.0 + ${v('pad')});`);
      add(`  vec2 hs = ${fit === 'box' ? 'bs' : 'vec2(max(bs.x, bs.y))'} * 0.5;`);
      add(`  float ang = fract(m.x * ${SPIN_STEP}) * 6.28318 * ${v('spin')};`);
      add(`  vec2 d = ${v('px')} - b.xy * u_resolution;`);
      add(`  d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;`);
      add(`  vec2 qq = d / max(hs, vec2(1.0));`);
      add(`  float ee = ${fit === 'circle' ? 'length(qq)' : 'max(abs(qq.x), abs(qq.y))'} - 1.0;`);
      add(`  float c = 1.0 - smoothstep(-${v('soft')}, 0.0, ee);`);
      add(`  if (c > ${v('cov')} + 1e-4 || (c > 0.0 && abs(c - ${v('cov')}) <= 1e-4 && ee < ${v('e')})) { ${v('cov')} = c; ${v('e')} = ee; ${v('q')} = qq; ${v('slot')} = float(i); ${v('bid')} = m.x; ${v('size')} = b.zw * 2.0 * vec2(${v('asp')}, 1.0); }`);
      add(`}`);
    }
    // Local UV: as the UV node gives it (y −1…1). Box squeezes the whole frame into the box; Square shows its middle square.
    add(`vec2 ${v('luv')} = ${v('q')} / max(${p(P.scale, 1)}, 1e-3)${fit === 'box' ? ` * vec2(${v('asp')}, 1.0)` : ''};`);
    add(`vec2 ${v('tuv')} = ${v('q')} / max(${p(P.scale, 1)}, 1e-3) * 0.5 + 0.5;`);
    add(`float ${v('in')} = ${v('cov')};`);
    add(`float ${v('edge')} = ${v('slot')} < 0.0 ? 0.0 : 1.0 - smoothstep(0.0, 0.06, abs(${v('e')}));`);
    add(`float ${v('a')} = ${v('in')} * clamp(${inputVars.mask ?? '1.0'}, 0.0, 1.0);`);
    add(`vec3 ${v('col')} = vec3(0.0);`);
    // Only where a blob is: the fill (a whole picture chain, or a texture read) costs nothing elsewhere.
    add(`if (${v('in')} > 0.0) {`);
    if (fill) add(`  ${v('col')} = ${fill}(${v('luv')}, vec2(${v('slot')}, ${v('bid')}), ${v('in')}, ${v('slot')});`);
    else if (tex) add(`  ${v('col')} = textureLod(${tex}, clamp(${v('tuv')}, 0.0, 1.0), 0.0).rgb;`);
    else add(`  ${v('col')} = (0.55 + 0.45 * cos(6.28318 * (${v('bid')} * 0.161 + vec3(0.0, 0.33, 0.67)))) * (0.6 + 0.4 * (1.0 - length(${v('q')}) * 0.5));`);
    add(`}`);
    return {
      code: L.join(''),
      outputVars: {
        color: v('col'), alpha: v('a'), localUv: v('luv'), texUv: v('tuv'), inside: v('in'), edge: v('edge'), slot: v('slot'), id: v('bid'), size: v('size'),
      },
    };
  },
}, ['padding', 'scale', 'spin', 'softness']);

// ── The same maths on the CPU (tests) ────────────────────────────────────────

/** One blob as Blob Track's data has it: centre and box size in 0–1 picture coordinates, its ID. */
export interface CpuBlob { x: number; y: number; w: number; h: number; id: number }

export interface BlobSpaceParams { fit?: BlobFit; padding?: number; scale?: number; spin?: number; softness?: number; only?: 'all' | 'one'; onlyBy?: 'order' | 'id'; onlyIndex?: number }

export interface BlobSpaceHit { slot: number; id: number; inside: number; localUv: [number, number]; texUv: [number, number] }

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Blob Space at the pixel `st` (0–1 picture coordinates) of a `res` picture: the blob chosen and the pixel's place in
 * it, as the shader works it out. `blobs` in slot order (the oldest first).
 */
export function blobSpaceAt(st: [number, number], blobs: readonly CpuBlob[], res: [number, number], o: BlobSpaceParams = {}): BlobSpaceHit {
  const fit = blobFitOf(o.fit), pad = o.padding ?? 0.1, scale = o.scale ?? 1, spin = o.spin ?? 0, soft = Math.max(o.softness ?? 0.04, 1e-4);
  const asp = res[0] / res[1];
  const px = [st[0] * res[0], st[1] * res[1]];
  let cov = 0, e = 1e3, slot = -1, bid = 0, q: [number, number] = [0, 0];
  blobs.slice(0, BLOB_SLOTS).forEach((b, i) => {
    if (o.only === 'one' && (o.onlyBy === 'id' ? Math.abs(b.id - (o.onlyIndex ?? 0)) > 0.5 : i !== Math.floor((o.onlyIndex ?? 0) + 0.5))) return;
    const bs = [b.w * res[0] * (1 + pad), b.h * res[1] * (1 + pad)];
    const hs = fit === 'box' ? [bs[0] / 2, bs[1] / 2] : [Math.max(bs[0], bs[1]) / 2, Math.max(bs[0], bs[1]) / 2];
    const ang = (((b.id * SPIN_STEP) % 1) + 1) % 1 * 6.28318 * spin;
    const dx = px[0] - b.x * res[0], dy = px[1] - b.y * res[1];
    // GLSL's mat2(c, -s, s, c) * d (column-major): (c·dx + s·dy, −s·dx + c·dy).
    const c0 = Math.cos(ang), s0 = Math.sin(ang);
    const d = [c0 * dx + s0 * dy, -s0 * dx + c0 * dy];
    const qq: [number, number] = [d[0] / Math.max(hs[0], 1), d[1] / Math.max(hs[1], 1)];
    const ee = (fit === 'circle' ? Math.hypot(qq[0], qq[1]) : Math.max(Math.abs(qq[0]), Math.abs(qq[1]))) - 1;
    const c = 1 - smooth(-soft, 0, ee);
    if (c > cov + 1e-4 || (c > 0 && Math.abs(c - cov) <= 1e-4 && ee < e)) { cov = c; e = ee; q = qq; slot = i; bid = b.id; }
  });
  const s = Math.max(scale, 1e-3);
  const luv: [number, number] = fit === 'box' ? [q[0] / s * asp, q[1] / s] : [q[0] / s, q[1] / s];
  return { slot, id: bid, inside: cov, localUv: luv, texUv: [q[0] / s * 0.5 + 0.5, q[1] / s * 0.5 + 0.5] };
}
