/**
 * Blob Track (docs/blob-track.md): finds the separate bright shapes in a mask and follows them, each with an ID
 * that stays with it while it moves — TouchDesigner's Blob Track TOP.
 *
 * The finding runs outside the shader (lib/blobs/engine.ts): each frame the wired texture is read back small
 * (Resolution on its long side), thresholded, split into 8-connected blobs on the CPU and matched to the last
 * frame's (lib/blobs/track.ts). The result comes back as a tiny float texture, `u_tex_<slug>` (the store's
 * nodeTextures[id]): BLOB_SLOTS × BLOB_ROWS texels, row 0 the centre and box size (0–1 texture coordinates), row 1 the
 * ID, area, age and 1 for a blob, row 2 where its marks are drawn (held in Jump / Pulse). The shader loops over the
 * slots for the count, the picked blob and the marks.
 *
 * The node writes one comment naming the texture wired into it (BLOB_SOURCE_MARK), as the Depth node does.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3, withParamSockets } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { BLOB_ROWS, BLOB_SLOTS } from '../../lib/blobs/track';

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
const MOTION = 'Motion';

/**
 * The drawing helpers every Blob Track shares (pixel units): a quadratic Bézier's distance (Inigo Quilez's exact
 * solution), one connection (a curve, an arrowhead at its middle, dots flowing along it), and a label in the
 * preview's font atlas (u_fontTexture: ASCII in a 16 × 16 grid of 64 px cells, drawn at +6 px, flipped in y).
 */
export const BLOB_DRAW_GLSL = `float bt_h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bt_n(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(bt_h(i), bt_h(i + vec2(1.0, 0.0)), f.x), mix(bt_h(i + vec2(0.0, 1.0)), bt_h(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 bt_idc(float id) { return 0.55 + 0.45 * cos(6.28318 * (id * 0.161 + vec3(0.0, 0.33, 0.67))); }
float bt_seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
vec2 bt_segT(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return vec2(length(pa - ba * h), h); }
vec2 bt_qpt(vec2 A, vec2 B, vec2 C, float t) { float s = 1.0 - t; return s * s * A + 2.0 * s * t * B + t * t * C; }
vec2 bt_qtan(vec2 A, vec2 B, vec2 C, float t) { return normalize(2.0 * (1.0 - t) * (B - A) + 2.0 * t * (C - B) + 1e-6); }
vec2 bt_bezierT(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b), ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0, kz = kk * dot(d, a);
  float p = ky - kx * kx, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz, h = q * q + 4.0 * p * p * p;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 e = d + (c + b * t) * t;
    return vec2(length(e), t);
  }
  float z = sqrt(-p), v = acos(q / (p * z * 2.0)) / 3.0, m = cos(v), n = sin(v) * 1.732050808;
  vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
  vec2 e1 = d + (c + b * t.x) * t.x, e2 = d + (c + b * t.y) * t.y;
  float d1 = dot(e1, e1), d2 = dot(e2, e2);
  return d1 < d2 ? vec2(sqrt(d1), t.x) : vec2(sqrt(d2), t.y);
}
// One connection A → C: (coverage, where along it 0–1, brightness). Style 0 solid, 1 dashed, 2 dotted. Packet (Pulse):
// a bright packet with a tail runs A → C and the rest of the line dims. Wobble shakes it with noise; longer than
// maxLen (pixels, 0: no limit) draws nothing.
vec3 bt_edge(vec2 p, vec2 A, vec2 C, float bend, float lw, float arrow, float flow, float time, float style, float packet, float seed, float wobble, float maxLen) {
  vec2 d = C - A; float L = length(d);
  if (L < 1.0 || (maxLen > 0.0 && L > maxLen)) return vec3(0.0);
  vec2 B = (A + C) * 0.5 + vec2(-d.y, d.x) * bend * 0.5;
  float pad = 14.0 + lw * 3.0 + wobble * 12.0;
  if (any(lessThan(p, min(min(A, B), C) - pad)) || any(greaterThan(p, max(max(A, B), C) + pad))) return vec3(0.0);
  if (wobble > 0.0) p += (vec2(bt_n(p * 0.02 + vec2(time * 0.9, seed * 7.0)), bt_n(p * 0.02 + vec2(seed * 5.0, -time * 0.8))) - 0.5) * wobble * 20.0;
  vec2 dt = abs(bend) < 0.002 ? bt_segT(p, A, C) : bt_bezierT(p, A, B, C);
  float along = dt.y * L;
  float cov = 1.0 - smoothstep(lw * 0.5, lw * 0.5 + 1.0, dt.x);
  if (style > 1.5) { float g = lw * 3.0 + 4.0; cov = 1.0 - smoothstep(lw * 0.7, lw * 0.7 + 1.0, length(vec2((fract(along / g) - 0.5) * g, dt.x))); }
  else if (style > 0.5) cov *= step(fract(along / (lw * 6.0 + 6.0)), 0.55);
  float bright = 1.0;
  if (packet > 0.5) {
    float ph = fract(time * max(flow, 0.25) * 120.0 / L + seed);
    float k = ph - dt.y;
    bright = 0.3 + 1.7 * (k >= 0.0 ? exp(-k * L / (30.0 + lw * 8.0)) : 0.0);
    float head = 1.0 - smoothstep(lw + 1.0, lw + 2.0, length(p - bt_qpt(A, B, C, ph)));
    if (head > cov) { cov = head; bright = 2.0; }
  }
  if (arrow > 0.5) {
    vec2 M = bt_qpt(A, B, C, 0.5), T = bt_qtan(A, B, C, 0.5), N = vec2(-T.y, T.x);
    float s = 5.0 + lw * 2.0;
    vec2 tip = M + T * s * 0.5;
    float da = min(bt_seg(p, tip, tip - T * s + N * s * 0.6), bt_seg(p, tip, tip - T * s - N * s * 0.6));
    cov = max(cov, 1.0 - smoothstep(lw * 0.5, lw * 0.5 + 1.0, da));
  }
  if (flow > 0.0 && packet < 0.5) {
    for (int k = 0; k < 3; k++) {
      vec2 q = bt_qpt(A, B, C, fract(time * flow * 120.0 / L + float(k) / 3.0));
      cov = max(cov, 1.0 - smoothstep(lw + 1.0, lw + 2.0, length(p - q)));
    }
  }
  return vec3(cov, dt.y, bright);
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
  if (mode == 3) {
    if (k == 0) return 48;
    if (k == 1) return 120;
    if (k > 7) return 32;
    int h = int(floor(bt_h(vec2(a, float(k) + b * 13.0)) * 16.0));
    return h < 10 ? 48 + h : 55 + h;
  }
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
    texture: { type: 'texture', label: 'Blob data', hint: 'The blobs as a 16 × 3 float texture (row 0: centre and size, row 1: ID, area, age, 1, row 2: where the marks are drawn): for Read Neighbours or code.' },
  },
  defaultParams: {
    threshold: 0.5, channel: 'luma', invert: false, resolution: '160', minSize: 0.002, maxSize: 0.5, maxBlobs: 16,
    maxJump: 0.15, memory: 10, smoothing: 0.3, pick: 0,
    boxStyle: 'box', boxColour: 'line', marker: 'dot', labels: 'none', lineWidth: 2, textSize: 14,
    lineColor: [0.78, 1.0, 0.22], labelColor: [1.0, 0.25, 0.4], markerColor: [1.0, 1.0, 1.0],
    connect: 'off', bend: 0.35, arrows: true, flow: 0, lineStyle: 'solid', lineColourBy: 'line', wobble: 0, maxLink: 0, padding: 0,
    motion: 'follow', jumpRate: 4, scatter: 0.15, flicker: 0.2, hold: 2, pulseRate: 0.8,
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
      { value: 'none', label: 'None' }, { value: 'id', label: 'ID (#3)' }, { value: 'xy', label: 'x / y' }, { value: 'hex', label: 'Hex code (0x3FA9C2)' },
    ] },
    labelColor: { label: 'Label colour', type: 'vec3color', section: MARKS, showWhen: { param: 'labels', value: ['id', 'xy', 'hex'] }, hint: 'The labels\' colour.' },
    textSize: { label: 'Text size', type: 'float', min: 6, max: 48, step: 1, section: MARKS, showWhen: { param: 'labels', value: ['id', 'xy', 'hex'] }, hint: 'The labels\' height in pixels.' },
    padding: { label: 'Box padding', type: 'float', min: -20, max: 60, step: 1, section: MARKS, hint: 'Grows each box (and its brackets and label) by this many pixels; negative shrinks it.' },
    lineWidth: { label: 'Line width', type: 'float', min: 0.5, max: 8, step: 0.5, section: MARKS, hint: 'Boxes, markers and connections: the line width in pixels.' },
    lineColor: { label: 'Line colour', type: 'vec3color', section: MARKS, hint: 'The connections\' colour, and the boxes\' with Box colour: Line colour.' },
    connect: { label: 'Connect', type: 'select', section: LINKS, hint: 'Lines between blobs. Chain: in ID order, each to the next. Nearest: each to its closest (or two closest). All: every pair.', options: [
      { value: 'off', label: 'Off' }, { value: 'chain', label: 'Chain (ID order)' }, { value: 'nearest', label: 'Nearest' }, { value: 'nearest2', label: 'Two nearest' }, { value: 'all', label: 'All pairs' },
    ] },
    bend: { label: 'Bend', type: 'float', min: -1, max: 1, step: 0.01, section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'How much the lines arc: 0 straight, ± bends either way.' },
    arrows: { label: 'Arrows', type: 'bool', section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'An arrowhead halfway along each line, pointing from the older blob to the newer.' },
    flow: { label: 'Flow', type: 'float', min: 0, max: 4, step: 0.05, section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'Dots running along the lines, this fast. 0: none.' },
    lineStyle: { label: 'Line style', type: 'select', section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'Solid, dashed or dotted connections.', options: [
      { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' },
    ] },
    lineColourBy: { label: 'Line colour by', type: 'select', section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'One Line colour, each line in its older blob\'s ID colour, or a gradient from one blob\'s colour to the other\'s.', options: [
      { value: 'line', label: 'Line colour' }, { value: 'id', label: 'Blob\'s ID colour' }, { value: 'gradient', label: 'Gradient between blobs' },
    ] },
    wobble: { label: 'Wobble', type: 'float', min: 0, max: 2, step: 0.01, section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'Shakes the lines with moving noise. For your own warp, wire one into UV: it moves every mark.' },
    maxLink: { label: 'Max link', type: 'float', min: 0, max: 2, step: 0.01, section: LINKS, showWhen: { param: 'connect', value: ['chain', 'nearest', 'nearest2', 'all'] }, hint: 'Leaves out connections longer than this (a share of the picture\'s height). 0: no limit.' },
    motion: { label: 'Motion', type: 'select', section: MOTION, hint: 'Follow: the marks glide with their blobs. Jump: each mark holds, then snaps to its blob at random moments, flickering, its connections re-picked (the classic tracking look). Pulse: the marks stay put for Hold seconds while packets flow along the connections and the boxes pulse.', options: [
      { value: 'follow', label: 'Follow' }, { value: 'jump', label: 'Jump' }, { value: 'pulse', label: 'Pulse' },
    ] },
    jumpRate: { label: 'Jump rate', type: 'float', min: 0.2, max: 20, step: 0.1, section: MOTION, showWhen: { param: 'motion', value: 'jump' }, hint: 'About how many times a second each mark snaps (each on its own clock), and how often connections re-pick and flicker.' },
    scatter: { label: 'Scatter', type: 'float', min: 0, max: 1, step: 0.01, section: MOTION, compileTime: true, showWhen: { param: 'motion', value: 'jump' }, hint: 'How far off its blob a mark lands when it snaps, as a share of the blob\'s size.' },
    flicker: { label: 'Flicker', type: 'float', min: 0, max: 0.9, step: 0.01, section: MOTION, showWhen: { param: 'motion', value: 'jump' }, hint: 'How often a mark (and its lines) blinks out for a step. 0: never.' },
    hold: { label: 'Hold', type: 'float', min: 0.1, max: 20, step: 0.1, section: MOTION, compileTime: true, showWhen: { param: 'motion', value: 'pulse' }, hint: 'Seconds the marks stay put before they are placed on the blobs again.' },
    pulseRate: { label: 'Pulse rate', type: 'float', min: 0, max: 4, step: 0.05, section: MOTION, showWhen: { param: 'motion', value: 'pulse' }, hint: 'Box pulses a second (each box on its own beat). Flow sets how fast the packets run.' },
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
  declarationsFor: (node: GraphNode) => [`#define ${blobSampler(node.id)}_px (vec2(1.0) / vec2(${BLOB_SLOTS}.0, ${BLOB_ROWS}.0))`],
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
    const labels = P.labels === 'id' ? 1 : P.labels === 'xy' ? 2 : P.labels === 'hex' ? 3 : 0;
    const motion = P.motion === 'jump' || P.motion === 'pulse' ? P.motion : 'follow';
    const rate = motion === 'jump' ? p(P.jumpRate, 4) : '4.0';
    // Jump: a blob's step (its own clock) and whether it shows this step.
    const stepOf = (idx: string) => `floor(u_time * ${rate} + bt_h(vec2(${idx}, 3.7)))`;
    const visOf = (idx: string) => motion === 'jump' ? `step(${p(P.flicker, 0.2)}, bt_h(vec2(${idx}, ${stepOf(idx)})))` : '1.0';
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
    // B: the blobs; M: ID, area, age, 1; D: where their marks are drawn (held in Jump / Pulse, lib/blobs/track.ts placeMarks).
    add(`vec4 ${v('B')}[${N}]; vec4 ${v('M')}[${N}]; vec4 ${v('D')}[${N}];`);
    add(`int ${v('n')} = 0;`);
    add(`for (int i = 0; i < ${N}; i++) { ${v('B')}[i] = texelFetch(${S}, ivec2(i, 0), 0); ${v('M')}[i] = texelFetch(${S}, ivec2(i, 1), 0); ${v('D')}[i] = texelFetch(${S}, ivec2(i, 2), 0); if (${v('M')}[i].w > 0.5) ${v('n')} = i + 1; }`);
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
      add(`  vec4 b = ${v('D')}[i]; float bid = ${v('M')}[i].x;`);
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
      const style = P.lineStyle === 'dashed' ? '1.0' : P.lineStyle === 'dotted' ? '2.0' : '0.0';
      const by = P.lineColourBy === 'id' || P.lineColourBy === 'gradient' ? P.lineColourBy : 'line';
      const colourOf = (a: string, b: string) => by === 'gradient' ? `mix(bt_idc(${v('M')}[${a}].x), bt_idc(${v('M')}[${b}].x), e.y)` : by === 'id' ? `bt_idc(${v('M')}[${a}].x)` : lineC;
      const edge = (a: string, b: string) => `{ vec3 e = bt_edge(${v('px')}, ${v('D')}[${a}].xy * u_resolution, ${v('D')}[${b}].xy * u_resolution, ${p(P.bend, 0.35)}, ${lw}, ${P.arrows === false ? '0.0' : '1.0'}, ${p(P.flow, 0)}, u_time, ${style}, ${motion === 'pulse' ? '1.0' : '0.0'}, bt_h(vec2(${v('M')}[${a}].x, ${v('M')}[${b}].x)), ${p(P.wobble, 0)}, ${p(P.maxLink, 0)} * u_resolution.y); float c = e.x${motion === 'jump' ? ` * ${visOf(`${v('M')}[${a}].x`)} * ${visOf(`${v('M')}[${b}].x`)}` : ''}; ${v('mc')} = mix(${v('mc')}, ${colourOf(a, b)} * e.z, c); ${v('ma')} = max(${v('ma')}, c); }`;
      if (connect === 'all') {
        add(`for (int i = 0; i < ${N}; i++) { if (i >= ${v('n')}) break; for (int j = 0; j < ${N}; j++) { if (j >= ${v('n')}) break; if (j <= i) continue; ${edge('i', 'j')} } }`);
      } else if (motion === 'jump') {
        // Jump: each blob links to one (or two) others picked at random each of its steps.
        add(`if (${v('n')} > 1) for (int i = 0; i < ${N}; i++) {`);
        add(`  if (i >= ${v('n')}) break;`);
        add(`  float s = ${stepOf(`${v('M')}[i].x`)};`);
        add(`  int j1 = int(floor(bt_h(vec2(${v('M')}[i].x, s + 0.5)) * float(${v('n')} - 1))); if (j1 >= i) j1++;`);
        add(`  { int a0 = min(i, j1), b0 = max(i, j1); ${edge('a0', 'b0')} }`);
        if (connect === 'nearest2') add(`  int j2 = int(floor(bt_h(vec2(${v('M')}[i].x, s + 0.25)) * float(${v('n')} - 1))); if (j2 >= i) j2++; if (j2 != j1) { int a0 = min(i, j2), b0 = max(i, j2); ${edge('a0', 'b0')} }`);
        add(`}`);
      } else if (connect === 'chain') {
        add(`for (int i = 0; i < ${N - 1}; i++) { if (i + 1 >= ${v('n')}) break; ${edge('i', 'i + 1')} }`);
      } else {
        add(`for (int i = 0; i < ${N}; i++) {`);
        add(`  if (i >= ${v('n')}) break;`);
        add(`  int j1 = -1, j2 = -1; float d1 = 1.0e9, d2 = 1.0e9;`);
        add(`  for (int j = 0; j < ${N}; j++) { if (j >= ${v('n')}) break; if (j == i) continue; vec2 e = (${v('D')}[j].xy - ${v('D')}[i].xy) * u_resolution; float dd = dot(e, e); if (dd < d1) { d2 = d1; j2 = j1; d1 = dd; j1 = j; } else if (dd < d2) { d2 = dd; j2 = j; } }`);
        add(`  if (j1 >= 0) { int a0 = min(i, j1), b0 = max(i, j1); ${edge('a0', 'b0')} }`);
        if (connect === 'nearest2') add(`  if (j2 >= 0) { int a0 = min(i, j2), b0 = max(i, j2); ${edge('a0', 'b0')} }`);
        add(`}`);
      }
    }
    // Boxes, centre markers and labels.
    add(`for (int i = 0; i < ${N}; i++) {`);
    add(`  if (i >= ${v('n')}) break;`);
    add(`  vec4 b = ${v('B')}[i]; vec4 m = ${v('M')}[i]; vec4 dm = ${v('D')}[i];`);
    // Inside and Nearest are the blob's; the marks are drawn where they are held (D).
    add(`  { vec2 qb = abs(${v('px')} - b.xy * u_resolution) - b.zw * u_resolution * 0.5; ${v('in')} = max(${v('in')}, step(max(qb.x, qb.y), 0.0)); }`);
    add(`  ${v('near')} = min(${v('near')}, length((${v('st')} - b.xy) * 2.0 * ${v('asp')}));`);
    add(`  float vis = ${visOf('m.x')};`);
    add(`  float pl = ${motion === 'pulse' ? `exp(-fract(u_time * ${p(P.pulseRate, 0.8)} + bt_h(vec2(m.x, 1.3))) * 5.0)` : '0.0'};`);
    add(`  vec2 c = dm.xy * u_resolution, hs = dm.zw * u_resolution * 0.5 + ${p(P.padding, 0)} + pl * 6.0, q = abs(${v('px')} - c);`);
    add(`  float e = max(q.x - hs.x, q.y - hs.y);`);
    if (boxStyle !== 'none') {
      const colour = P.boxColour === 'line' ? lineC : `(0.55 + 0.45 * cos(6.28318 * (m.x * 0.161 + vec3(0.0, 0.33, 0.67))))`;
      add(`  float ln = 1.0 - smoothstep(${lw} * 0.5, ${lw} * 0.5 + 1.0, abs(e));`);
      if (boxStyle === 'brackets') add(`  float arm = min(hs.x, hs.y) * 0.45 + 4.0; ln *= step(hs.x - arm, q.x) * step(hs.y - arm, q.y);`);
      add(`  ln *= vis; ${v('mc')} = mix(${v('mc')}, ${colour} * (1.0 + pl), ln); ${v('ma')} = max(${v('ma')}, ln);`);
    }
    if (marker !== 'none') {
      add(`  vec2 u = ${v('px')} - c;`);
      add(marker === 'cross'
        ? `  float mk = (1.0 - smoothstep(${lw} * 0.5, ${lw} * 0.5 + 1.0, min(abs(u.x - u.y), abs(u.x + u.y)) * 0.7071)) * step(max(abs(u.x), abs(u.y)), 4.0 + ${lw} * 1.5);`
        : `  float mk = 1.0 - smoothstep(${lw} + 1.5, ${lw} + 2.5, length(u));`);
      add(`  mk *= vis; ${v('mc')} = mix(${v('mc')}, ${pv3(P.markerColor, [1, 1, 1])}, mk); ${v('ma')} = max(${v('ma')}, mk);`);
    }
    if (labels) {
      // Above the box's top-left corner; x / y in preview pixels from the top left, like a screen.
      add(`  float th = ${p(P.textSize, 14)};`);
      add(`  float tx = bt_label(${v('px')}, c + vec2(-hs.x, hs.y + 3.0), th, ${labels}, ${labels === 2 ? 'floor(c.x)' : 'm.x'}, ${labels === 2 ? 'floor(u_resolution.y - c.y)' : labels === 3 && motion === 'jump' ? stepOf('m.x') : '0.0'}) * vis;`);
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
