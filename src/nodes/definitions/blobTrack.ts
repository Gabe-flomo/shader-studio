/**
 * Blob Track (docs/blob-track.md): finds the separate bright shapes in a mask and follows them, each with an ID
 * that stays with it while it moves — TouchDesigner's Blob Track TOP.
 *
 * The finding runs outside the shader (lib/blobs/engine.ts): each frame the wired texture is read back small
 * (Resolution on its long side), thresholded, split into 8-connected blobs on the CPU and matched to the last
 * frame's (lib/blobs/track.ts). The result comes back as a tiny float texture, `u_tex_<slug>` (the store's
 * nodeTextures[id]): BLOB_SLOTS × 2 texels, row 0 the centre and box size (0–1 texture coordinates), row 1 the
 * ID, area, age and 1 for a blob. The shader loops over the slots for the count, the picked blob and the overlay.
 *
 * The node writes one comment naming the texture wired into it (BLOB_SOURCE_MARK), as the Depth node does.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3, withParamSockets } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { BLOB_SLOTS } from '../../lib/blobs/track';

export const BLOB_TRACK_TYPE = 'blobTrack';
/** `// blob-source <blob sampler> <wired sampler>`: what the engine reads (lib/blobs/engine.ts). */
export const BLOB_SOURCE_MARK = '// blob-source ';

export const blobSampler = (slug: string): string => `u_tex_${slug}`;

export const BLOB_RESOLUTIONS = [80, 160, 320] as const;
export const blobResolutionOf = (node: GraphNode): number => {
  const s = Number(node.params.resolution);
  return (BLOB_RESOLUTIONS as readonly number[]).includes(s) ? s : 160;
};

const FIND = 'Find';
const FOLLOW = 'Follow';
const SHOW = 'Show';
const MARKS = 'Marks';
const LINKS = 'Connections';
const STAMP = 'Stamp';

/**
 * The drawing helpers every Blob Track shares (pixel units): a quadratic Bézier's distance (Inigo Quilez's exact
 * solution), one connection (a curve, an arrowhead at its middle, dots flowing along it), and a label in the
 * preview's font atlas (u_fontTexture: ASCII in a 16 × 16 grid of 64 px cells, drawn at +6 px, flipped in y).
 */
export const BLOB_DRAW_GLSL = `float bt_seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
vec2 bt_qpt(vec2 A, vec2 B, vec2 C, float t) { float s = 1.0 - t; return s * s * A + 2.0 * s * t * B + t * t * C; }
vec2 bt_qtan(vec2 A, vec2 B, vec2 C, float t) { return normalize(2.0 * (1.0 - t) * (B - A) + 2.0 * t * (C - B) + 1e-6); }
float bt_bezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b), ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0, kz = kk * dot(d, a);
  float p = ky - kx * kx, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz, h = q * q + 4.0 * p * p * p;
  float res;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 e = d + (c + b * t) * t; res = dot(e, e);
  } else {
    float z = sqrt(-p), v = acos(q / (p * z * 2.0)) / 3.0, m = cos(v), n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    vec2 e1 = d + (c + b * t.x) * t.x, e2 = d + (c + b * t.y) * t.y;
    res = min(dot(e1, e1), dot(e2, e2));
  }
  return sqrt(res);
}
float bt_edge(vec2 p, vec2 A, vec2 C, float bend, float lw, float arrow, float flow, float time) {
  vec2 d = C - A; float L = length(d);
  if (L < 1.0) return 0.0;
  vec2 B = (A + C) * 0.5 + vec2(-d.y, d.x) * bend * 0.5;
  float pad = 14.0 + lw * 3.0;
  if (any(lessThan(p, min(min(A, B), C) - pad)) || any(greaterThan(p, max(max(A, B), C) + pad))) return 0.0;
  float dist = abs(bend) < 0.002 ? bt_seg(p, A, C) : bt_bezier(p, A, B, C);
  float cov = 1.0 - smoothstep(lw * 0.5, lw * 0.5 + 1.0, dist);
  if (arrow > 0.5) {
    vec2 M = bt_qpt(A, B, C, 0.5), T = bt_qtan(A, B, C, 0.5), N = vec2(-T.y, T.x);
    float s = 5.0 + lw * 2.0;
    vec2 tip = M + T * s * 0.5;
    float da = min(bt_seg(p, tip, tip - T * s + N * s * 0.6), bt_seg(p, tip, tip - T * s - N * s * 0.6));
    cov = max(cov, 1.0 - smoothstep(lw * 0.5, lw * 0.5 + 1.0, da));
  }
  if (flow > 0.0) {
    for (int k = 0; k < 3; k++) {
      vec2 q = bt_qpt(A, B, C, fract(time * flow * 120.0 / L + float(k) / 3.0));
      cov = max(cov, 1.0 - smoothstep(lw + 1.0, lw + 2.0, length(p - q)));
    }
  }
  return cov;
}
float bt_glyph(int code, vec2 lp) {
  if (code <= 32 || lp.x < 0.0 || lp.x > 1.0 || lp.y < 0.0 || lp.y > 1.0) return 0.0;
  float col = float(code % 16), row = float(code / 16);
  vec2 uv = vec2((col * 64.0 + 6.0 + lp.x * 32.0) / 1024.0, 1.0 - (row * 64.0 + 6.0 + (1.0 - lp.y) * 56.0) / 1024.0);
  return textureLod(u_fontTexture, uv, 0.0).r;
}
int bt_ndig(float n) { return n >= 1000.0 ? 4 : n >= 100.0 ? 3 : n >= 10.0 ? 2 : 1; }
int bt_digit(float n, int d, int j) { return 48 + int(mod(floor(n / pow(10.0, float(d - 1 - j)) + 0.0001), 10.0)); }
int bt_labelChar(int mode, int k, float a, float b) {
  int da = bt_ndig(a);
  if (mode == 1) { if (k == 0) return 35; return k - 1 < da ? bt_digit(a, da, k - 1) : 32; }
  int db = bt_ndig(b);
  if (k == 0) return 120;
  if (k == 1) return 58;
  if (k == 2) return 32;
  int j = k - 3;
  if (j < da) return bt_digit(a, da, j);
  j -= da;
  if (j == 0) return 32;
  if (j == 1) return 121;
  if (j == 2) return 58;
  if (j == 3) return 32;
  j -= 4;
  return j < db ? bt_digit(b, db, j) : 32;
}
float bt_label(vec2 p, vec2 origin, float h, int mode, float a, float b) {
  float cw = h * 0.6;
  vec2 q = (p - origin) / vec2(cw, h);
  if (q.y < 0.0 || q.y > 1.0 || q.x < 0.0 || q.x > 16.0) return 0.0;
  int k = int(floor(q.x));
  int code = bt_labelChar(mode, k, a, b);
  vec2 lp = vec2(fract(q.x), q.y), o = 0.25 / vec2(cw, h);
  return 0.25 * (bt_glyph(code, lp - o) + bt_glyph(code, lp + vec2(o.x, -o.y)) + bt_glyph(code, lp + vec2(-o.x, o.y)) + bt_glyph(code, lp + o));
}`;

export const BLOB_CONNECT = ['off', 'chain', 'nearest', 'nearest2', 'all'] as const;

export const BlobTrackNode: NodeDefinition = withParamSockets({
  type: BLOB_TRACK_TYPE,
  label: 'Blob Track',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Blob tracking', 'Blob detection', 'Connected components', 'Track shapes', 'Motion tracking', 'Object tracking', 'Centroid', 'Tracery', 'Tracking overlay'],
  description: 'Finds the separate bright shapes (blobs) in a mask and follows them, each keeping its ID while it moves. Wire a mask into Mask: a keyed video, Depth\'s near mask through a Pass, a threshold, a difference of frames. Count is how many; Position, Size, Area and ID are the picked blob\'s (Pick: 0 is the oldest). Marks draws boxes or brackets, crosses, x/y labels and curved connections between blobs (the tracking-overlay look); Stamp puts a picture on every blob. Up to 16 blobs.',
  inputs: {
    texture: { type: 'texture', label: 'Mask', hint: 'The mask to find blobs in: white shapes on black. A Texture Input, Video Input, Baked or a Pass. Empty: the picture itself (a frame late).' },
    stamp: { type: 'texture', label: 'Stamp', hint: 'A picture put on every blob: an image, a video, a Pass or a Shader Texture. With Sheet cells, a grid of pictures, one per blob by its ID.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where Overlay, Marks, Stamped, Inside and Nearest are measured. Empty: this pixel.' },
  },
  outputs: {
    count: { type: 'float', label: 'Count', hint: 'How many blobs are seen now.' },
    position: { type: 'vec2', label: 'Position', hint: 'The picked blob\'s centre, in picture coordinates (as UV): wire into a shape\'s centre to follow it.' },
    size: { type: 'vec2', label: 'Size', hint: 'The picked blob\'s box, width and height in picture units.' },
    area: { type: 'float', label: 'Area', hint: 'How much of the frame the picked blob covers, 0–1.' },
    id: { type: 'float', label: 'ID', hint: 'The picked blob\'s ID: it stays the same while the blob is followed. New blobs count up from 1.' },
    found: { type: 'float', label: 'Found', hint: '1 while there is a blob at Pick, 0 when not.' },
    inside: { type: 'float', label: 'Inside', hint: '1 inside any blob\'s box at this pixel.' },
    nearest: { type: 'float', label: 'Nearest', hint: 'How far this pixel is from the nearest blob\'s centre, in picture units (large with none): a glow around every blob.' },
    overlay: { type: 'vec3', label: 'Overlay', hint: 'Everything at once, to check what is found: the mask dimmed, the stamps, then the marks.' },
    marks: { type: 'vec3', label: 'Marks', hint: 'The boxes, centre markers, labels and connections in their colours (black elsewhere). Lay them over any picture with Marks alpha.' },
    marksAlpha: { type: 'float', label: 'Marks alpha', hint: '1 on the marks, 0 elsewhere: Mix your picture to Marks by it.' },
    stamped: { type: 'vec3', label: 'Stamped', hint: 'The Stamp picture on every blob (black elsewhere).' },
    stampAlpha: { type: 'float', label: 'Stamp alpha', hint: '1 where a stamp is (its own alpha, and Circle\'s round edge), 0 elsewhere.' },
    texture: { type: 'texture', label: 'Blob data', hint: 'The blobs as a 16 × 2 float texture (row 0: centre and size, row 1: ID, area, age, 1): for Read Neighbours or code.' },
  },
  defaultParams: {
    threshold: 0.5, channel: 'luma', invert: false, resolution: '160', minSize: 0.002, maxSize: 0.5, maxBlobs: 16,
    maxJump: 0.15, memory: 10, smoothing: 0.3, pick: 0,
    boxStyle: 'box', boxColour: 'line', marker: 'dot', labels: 'none', lineWidth: 2, textSize: 14,
    lineColor: [0.78, 1.0, 0.22], labelColor: [1.0, 0.25, 0.4], markerColor: [1.0, 1.0, 1.0],
    connect: 'off', bend: 0.35, arrows: true, flow: 0,
    stampFit: 'square', stampScale: 1, stampCells: '1', stampSpin: 0,
  },
  paramDefs: {
    threshold: { label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.01, section: FIND, compileTime: true, hint: 'How bright a pixel must be to count as part of a blob.' },
    channel: { label: 'Channel', type: 'select', section: FIND, hint: 'What the threshold reads.', options: [
      { value: 'luma', label: 'Brightness' }, { value: 'red', label: 'Red' }, { value: 'alpha', label: 'Alpha' },
    ] },
    invert: { label: 'Invert', type: 'bool', section: FIND, hint: 'Find dark shapes on light instead.' },
    resolution: { label: 'Resolution', type: 'select', section: FIND, hint: 'The long side the mask is read at. Smaller is faster and joins near blobs; larger finds smaller ones.', options: BLOB_RESOLUTIONS.map(s => ({ value: String(s), label: `${s} px` })) },
    minSize: { label: 'Min size', type: 'float', min: 0, max: 0.1, step: 0.0005, section: FIND, compileTime: true, hint: 'The smallest blob kept, as a share of the frame: raise it to ignore specks.' },
    maxSize: { label: 'Max size', type: 'float', min: 0, max: 1, step: 0.005, section: FIND, compileTime: true, hint: 'The largest blob kept, as a share of the frame: lower it to ignore the background.' },
    maxBlobs: { label: 'Max blobs', type: 'int', min: 1, max: BLOB_SLOTS, step: 1, section: FIND, hint: `How many blobs at most (the biggest), up to ${BLOB_SLOTS}.` },
    maxJump: { label: 'Max jump', type: 'float', min: 0, max: 1, step: 0.005, section: FOLLOW, compileTime: true, hint: 'How far a blob may move in one frame and keep its ID, as a share of the frame\'s height. Too small and fast blobs get new IDs; too big and IDs swap.' },
    memory: { label: 'Memory', type: 'int', min: 0, max: 120, step: 1, section: FOLLOW, hint: 'Frames a lost blob\'s ID is kept: it gets it back if it reappears nearby (a flicker, a hand passing in front).' },
    smoothing: { label: 'Smoothing', type: 'float', min: 0, max: 0.95, step: 0.01, section: FOLLOW, compileTime: true, hint: 'Blends each blob\'s position and size with the last frame\'s, so they jitter less (and lag a little).' },
    pick: { label: 'Pick', type: 'float', min: 0, max: BLOB_SLOTS - 1, step: 1, section: SHOW, hint: 'Which blob Position, Size, Area and ID report: 0 is the oldest one seen now, 1 the next…' },
    boxStyle: { label: 'Boxes', type: 'select', section: MARKS, hint: 'How each blob is framed: a full box, corner brackets, or nothing.', options: [
      { value: 'box', label: 'Box' }, { value: 'brackets', label: 'Corner brackets' }, { value: 'none', label: 'None' },
    ] },
    boxColour: { label: 'Box colour', type: 'select', section: MARKS, showWhen: { param: 'boxStyle', value: ['box', 'brackets'] }, hint: 'A colour for each ID, or Line colour for all.', options: [
      { value: 'id', label: 'By ID' }, { value: 'line', label: 'Line colour' },
    ] },
    marker: { label: 'Centre', type: 'select', section: MARKS, hint: 'What marks each blob\'s centre.', options: [
      { value: 'dot', label: 'Dot' }, { value: 'cross', label: 'Cross ✕' }, { value: 'none', label: 'None' },
    ] },
    markerColor: { label: 'Centre colour', type: 'vec3color', section: MARKS, showWhen: { param: 'marker', value: ['dot', 'cross'] }, hint: 'The centre markers\' colour.' },
    labels: { label: 'Labels', type: 'select', section: MARKS, hint: 'Text by each box: its ID, or its centre\'s x / y in preview pixels (from the top left).', options: [
      { value: 'none', label: 'None' }, { value: 'id', label: 'ID (#3)' }, { value: 'xy', label: 'x / y' },
    ] },
    labelColor: { label: 'Label colour', type: 'vec3color', section: MARKS, showWhen: { param: 'labels', value: ['id', 'xy'] }, hint: 'The labels\' colour.' },
    textSize: { label: 'Text size', type: 'float', min: 6, max: 48, step: 1, section: MARKS, showWhen: { param: 'labels', value: ['id', 'xy'] }, hint: 'The labels\' height in pixels.' },
    lineWidth: { label: 'Line width', type: 'float', min: 0.5, max: 8, step: 0.5, section: MARKS, hint: 'Boxes, markers and connections: the line width in pixels.' },
    lineColor: { label: 'Line colour', type: 'vec3color', section: MARKS, hint: 'The connections\' colour, and the boxes\' with Box colour: Line colour.' },
    connect: { label: 'Connect', type: 'select', section: LINKS, hint: 'Lines between blobs. Chain: in ID order, each to the next. Nearest: each to its closest (or two closest). All: every pair.', options: [
      { value: 'off', label: 'Off' }, { value: 'chain', label: 'Chain (ID order)' }, { value: 'nearest', label: 'Nearest' }, { value: 'nearest2', label: 'Two nearest' }, { value: 'all', label: 'All pairs' },
    ] },
    bend: { label: 'Bend', type: 'float', min: -1, max: 1, step: 0.01, section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'How much the lines arc: 0 straight, ± bends either way.' },
    arrows: { label: 'Arrows', type: 'bool', section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'An arrowhead halfway along each line, pointing from the older blob to the newer.' },
    flow: { label: 'Flow', type: 'float', min: 0, max: 4, step: 0.05, section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'Dots running along the lines, this fast. 0: none.' },
    stampFit: { label: 'Fit', type: 'select', section: STAMP, hint: 'Box: stretched to each blob\'s box. Square: the picture\'s own shape, as big as the blob. Circle: Square, cut round.', options: [
      { value: 'box', label: 'Box (stretch)' }, { value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' },
    ] },
    stampScale: { label: 'Scale', type: 'float', min: 0.1, max: 4, step: 0.01, section: STAMP, hint: 'The stamp against its blob: 1 fits it, 2 is twice as big.' },
    stampCells: { label: 'Sheet cells', type: 'select', section: STAMP, hint: 'A sprite sheet: the Stamp split into a grid, each blob showing one cell by its ID (it keeps it while followed).', options: [
      { value: '1', label: 'Whole picture' }, { value: '2', label: '2 × 2' }, { value: '3', label: '3 × 3' }, { value: '4', label: '4 × 4' }, { value: '8', label: '8 × 8' },
    ] },
    stampSpin: { label: 'Spin by ID', type: 'float', min: 0, max: 1, step: 0.01, section: STAMP, hint: 'Turns each blob\'s stamp by a different angle (from its ID): 0 all upright, 1 any angle.' },
  },
  glslFunctions: [BLOB_DRAW_GLSL],
  // The Blob data texture's `_px` (sampling nodes measure their offsets with it).
  declarationsFor: (node: GraphNode) => [`#define ${blobSampler(node.id)}_px (vec2(1.0) / vec2(${BLOB_SLOTS}.0, 2.0))`],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const S = blobSampler(id);
    const uv = inputVars.uv ?? 'g_uv';
    const src = inputVars.texture;
    const stamp = inputVars.stamp;
    const N = BLOB_SLOTS;
    const lw = p(P.lineWidth, 2);
    const boxStyle = P.boxStyle === 'brackets' || P.boxStyle === 'none' ? P.boxStyle : 'box';
    const marker = P.marker === 'cross' || P.marker === 'none' ? P.marker : 'dot';
    const labels = P.labels === 'id' ? 1 : P.labels === 'xy' ? 2 : 0;
    const connect = (BLOB_CONNECT as readonly string[]).includes(P.connect as string) ? P.connect as string : 'off';
    const lineC = pv3(P.lineColor, [0.78, 1.0, 0.22]);
    const v = (k: string) => `${id}_${k}`;
    const L: string[] = [];
    const add = (s: string) => L.push(`    ${s}\n`);
    // Which texture the engine reads (lib/blobs/engine.ts); empty: the picture.
    add(`${BLOB_SOURCE_MARK}${S} ${src ?? 'picture'}`);
    add(`vec2 ${v('st')} = ${texUv(uv)};`);
    add(`vec2 ${v('px')} = ${v('st')} * u_resolution;`);
    add(`vec2 ${v('asp')} = vec2(u_resolution.x / u_resolution.y, 1.0);`);
    add(`int ${v('pk')} = int(floor(${p(P.pick, 0)} + 0.5));`);
    // The slots are filled from 0 (oldest ID first), so the first Count slots are the blobs.
    add(`vec4 ${v('B')}[${N}]; vec4 ${v('M')}[${N}];`);
    add(`int ${v('n')} = 0;`);
    add(`for (int i = 0; i < ${N}; i++) { ${v('B')}[i] = texelFetch(${S}, ivec2(i, 0), 0); ${v('M')}[i] = texelFetch(${S}, ivec2(i, 1), 0); if (${v('M')}[i].w > 0.5) ${v('n')} = i + 1; }`);
    add(`vec4 ${v('pb')} = ${v('pk')} >= 0 && ${v('pk')} < ${v('n')} ? ${v('B')}[clamp(${v('pk')}, 0, ${N - 1})] : vec4(0.0);`);
    add(`vec4 ${v('pi')} = ${v('pk')} >= 0 && ${v('pk')} < ${v('n')} ? ${v('M')}[clamp(${v('pk')}, 0, ${N - 1})] : vec4(0.0);`);
    add(`float ${v('in')} = 0.0, ${v('near')} = 1.0e3;`);
    add(`vec3 ${v('mc')} = vec3(0.0); float ${v('ma')} = 0.0;`);
    add(`vec3 ${v('sc')} = vec3(0.0); float ${v('sa')} = 0.0;`);
    // Stamps first (under the marks).
    if (stamp) {
      const cells = Math.max(1, Math.min(8, Number(P.stampCells) || 1));
      const fit = P.stampFit === 'box' || P.stampFit === 'circle' ? P.stampFit : 'square';
      add(`for (int i = 0; i < ${N}; i++) {`);
      add(`  if (i >= ${v('n')}) break;`);
      add(`  vec4 b = ${v('B')}[i]; float bid = ${v('M')}[i].x;`);
      add(`  vec2 half_ = ${fit === 'box' ? 'b.zw * u_resolution' : 'vec2(max(b.z * u_resolution.x, b.w * u_resolution.y))'} * 0.5 * ${p(P.stampScale, 1)};`);
      add(`  float ang = fract(bid * 0.618034) * 6.28318 * ${p(P.stampSpin, 0)};`);
      add(`  vec2 d = ${v('px')} - b.xy * u_resolution;`);
      add(`  d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;`);
      add(`  vec2 lu = d / max(half_, vec2(1.0)) * 0.5 + 0.5;`);
      add(`  if (any(lessThan(lu, vec2(0.0))) || any(greaterThan(lu, vec2(1.0)))) continue;`);
      if (cells > 1) add(`  float cell = mod(bid - 1.0, ${cells * cells}.0); lu = (vec2(mod(cell, ${cells}.0), ${cells - 1}.0 - floor(cell / ${cells}.0)) + lu) / ${cells}.0;`);
      add(`  vec4 t = textureLod(${stamp}, lu, 0.0);`);
      add(`  float a = t.a${fit === 'circle' ? ` * (1.0 - smoothstep(0.98, 1.0, length(d / max(half_, vec2(1.0)))))` : ''};`);
      add(`  ${v('sc')} = mix(${v('sc')}, t.rgb, a); ${v('sa')} = max(${v('sa')}, a);`);
      add(`}`);
    }
    // Connections, under the boxes. Each pair drawn from the older blob to the newer, so a pair found twice is one curve.
    if (connect !== 'off') {
      const edge = (a: string, b: string) => `{ float c = bt_edge(${v('px')}, ${v('B')}[${a}].xy * u_resolution, ${v('B')}[${b}].xy * u_resolution, ${p(P.bend, 0.35)}, ${lw}, ${P.arrows === false ? '0.0' : '1.0'}, ${p(P.flow, 0)}, u_time); ${v('mc')} = mix(${v('mc')}, ${lineC}, c); ${v('ma')} = max(${v('ma')}, c); }`;
      if (connect === 'chain') {
        add(`for (int i = 0; i < ${N - 1}; i++) { if (i + 1 >= ${v('n')}) break; ${edge('i', 'i + 1')} }`);
      } else if (connect === 'all') {
        add(`for (int i = 0; i < ${N}; i++) { if (i >= ${v('n')}) break; for (int j = 0; j < ${N}; j++) { if (j >= ${v('n')}) break; if (j <= i) continue; ${edge('i', 'j')} } }`);
      } else {
        add(`for (int i = 0; i < ${N}; i++) {`);
        add(`  if (i >= ${v('n')}) break;`);
        add(`  int j1 = -1, j2 = -1; float d1 = 1.0e9, d2 = 1.0e9;`);
        add(`  for (int j = 0; j < ${N}; j++) { if (j >= ${v('n')}) break; if (j == i) continue; vec2 e = (${v('B')}[j].xy - ${v('B')}[i].xy) * u_resolution; float dd = dot(e, e); if (dd < d1) { d2 = d1; j2 = j1; d1 = dd; j1 = j; } else if (dd < d2) { d2 = dd; j2 = j; } }`);
        add(`  if (j1 >= 0) { int a0 = min(i, j1), b0 = max(i, j1); ${edge('a0', 'b0')} }`);
        if (connect === 'nearest2') add(`  if (j2 >= 0) { int a0 = min(i, j2), b0 = max(i, j2); ${edge('a0', 'b0')} }`);
        add(`}`);
      }
    }
    // Boxes, centre markers and labels.
    add(`for (int i = 0; i < ${N}; i++) {`);
    add(`  if (i >= ${v('n')}) break;`);
    add(`  vec4 b = ${v('B')}[i]; vec4 m = ${v('M')}[i];`);
    add(`  vec2 c = b.xy * u_resolution, hs = b.zw * u_resolution * 0.5, q = abs(${v('px')} - c);`);
    add(`  float e = max(q.x - hs.x, q.y - hs.y);`);
    add(`  ${v('in')} = max(${v('in')}, step(e, 0.0));`);
    add(`  ${v('near')} = min(${v('near')}, length((${v('st')} - b.xy) * 2.0 * ${v('asp')}));`);
    if (boxStyle !== 'none') {
      const colour = P.boxColour === 'line' ? lineC : `(0.55 + 0.45 * cos(6.28318 * (m.x * 0.161 + vec3(0.0, 0.33, 0.67))))`;
      add(`  float ln = 1.0 - smoothstep(${lw} * 0.5, ${lw} * 0.5 + 1.0, abs(e));`);
      if (boxStyle === 'brackets') add(`  float arm = min(hs.x, hs.y) * 0.45 + 4.0; ln *= step(hs.x - arm, q.x) * step(hs.y - arm, q.y);`);
      add(`  ${v('mc')} = mix(${v('mc')}, ${colour}, ln); ${v('ma')} = max(${v('ma')}, ln);`);
    }
    if (marker !== 'none') {
      add(`  vec2 u = ${v('px')} - c;`);
      add(marker === 'cross'
        ? `  float mk = (1.0 - smoothstep(${lw} * 0.5, ${lw} * 0.5 + 1.0, min(abs(u.x - u.y), abs(u.x + u.y)) * 0.7071)) * step(max(abs(u.x), abs(u.y)), 4.0 + ${lw} * 1.5);`
        : `  float mk = 1.0 - smoothstep(${lw} + 1.5, ${lw} + 2.5, length(u));`);
      add(`  ${v('mc')} = mix(${v('mc')}, ${pv3(P.markerColor, [1, 1, 1])}, mk); ${v('ma')} = max(${v('ma')}, mk);`);
    }
    if (labels) {
      // Above the box's top-left corner; x / y in preview pixels from the top left, like a screen.
      add(`  float th = ${p(P.textSize, 14)};`);
      add(`  float tx = bt_label(${v('px')}, c + vec2(-hs.x, hs.y + 3.0), th, ${labels}, ${labels === 1 ? 'm.x' : 'floor(c.x)'}, ${labels === 1 ? '0.0' : 'floor(u_resolution.y - c.y)'});`);
      add(`  ${v('mc')} = mix(${v('mc')}, ${pv3(P.labelColor, [1, 0.25, 0.4])}, tx); ${v('ma')} = max(${v('ma')}, tx);`);
    }
    add(`}`);
    add(`vec3 ${v('base')} = ${src ? `texture2D(${src}, clamp(${v('st')}, 0.0, 1.0)).rgb * 0.45` : 'vec3(0.0)'};`);
    add(`vec3 ${v('ov')} = mix(mix(${v('base')}, ${v('sc')}, ${v('sa')}), ${v('mc')}, ${v('ma')});`);
    add(`vec2 ${v('pos')} = (${v('pb')}.xy * 2.0 - 1.0) * ${v('asp')};`);
    add(`vec2 ${v('size')} = ${v('pb')}.zw * 2.0 * ${v('asp')};`);
    add(`float ${v('cnt')} = float(${v('n')});`);
    return {
      code: L.join(''),
      outputVars: {
        count: v('cnt'), position: v('pos'), size: v('size'), area: `${v('pi')}.y`, id: `${v('pi')}.x`, found: `${v('pi')}.w`,
        inside: v('in'), nearest: v('near'), overlay: v('ov'), marks: v('mc'), marksAlpha: v('ma'), stamped: v('sc'), stampAlpha: v('sa'), texture: S,
      },
    };
  },
}, ['pick', 'lineWidth', 'bend', 'flow', 'textSize']);
