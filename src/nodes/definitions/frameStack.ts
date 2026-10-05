import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';
import { volLayout, volPx } from './timeCube';
import { LAYERS, MAX_CARDS, layoutOf, morphTargetOf, playbackOf, type Layout } from '../../lib/frameStack/layout';

/**
 * Frame Stack (docs/frame-stack.md): a Time Cube's frames as separate cards
 * you can arrange and animate: a stack, a fan, a ring or torus, a helix, a
 * grid, and a morph between two of them; a random scatter and a slow drift;
 * a scan that pulls cards out as it passes; highlighted cards every so many;
 * and which frame each card shows (its own, a time echo, or one for all).
 *
 * How it draws: every card is a thin box (a rounded rectangle with a
 * thickness). One bounded loop over the cards (MAX_CARDS) finds where this
 * pixel's ray meets each card, analytically: a bounding-sphere test first,
 * then the ray against the card's slab and its rounded rectangle. The
 * nearest LAYERS hits are kept in order (two vec4s, no arrays). A second,
 * short loop reads those cards' frames from the atlas and composites them
 * front to back. So the texture is read at most LAYERS times a pixel, however
 * many cards there are.
 *
 * The maths mirrors lib/frameStack/layout.ts (the tests check that one).
 */

export const FRAME_STACK_TYPE = 'frameStack';

/** Atlas coordinate of frame f (an integer) at frame point uv: the Time Cube's layout (tcTile in timeCube.ts). */
const FS_TILE = `vec2 fsTile(vec4 lay, float f, vec2 uv) {
    float row = floor((f + 0.5) / lay.x);
    float col = f - row * lay.x;
    return vec2((col + uv.x) / lay.x, 1.0 - (row + 1.0 - uv.y) / lay.y);
}`;

/** Dave Hoskins' hash33 (layout.ts hash33). */
const FS_HASH = `vec3 fsHash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}`;

/** Signed distance to a rounded rectangle (layout.ts sdRoundRect). */
/**
 * A seeded shuffle of 0 … n − 1 (and back, with inv): a three-round Feistel network on an s × s
 * square (s = ⌈√n⌉), walking the cycle until it lands below n. A true permutation: every card
 * gets its own place. (layout.ts shufflePlace mirrors it.)
 */
const FS_PERM = `float fsFeistel(float x, float s, float seed, bool inv) {
    float L = floor(x / s);
    float R = x - L * s;
    for (int k = 0; k < 3; k++) {
        if (!inv) {
            float F = floor(fsHash33(vec3(R, seed, float(k))).x * s);
            float nl = R;
            R = mod(L + F, s);
            L = nl;
        } else {
            float F = floor(fsHash33(vec3(L, seed, float(2 - k))).x * s);
            float nr = L;
            L = mod(R - F, s);
            R = nr;
        }
    }
    return L * s + R;
}
float fsPerm(float x, float n, float seed, bool inv) {
    float s = ceil(sqrt(n) - 1e-3);
    float y = x;
    for (int w = 0; w < 32; w++) {
        y = fsFeistel(y, s, seed, inv);
        if (y < n - 0.5) return y;
    }
    return x;
}`;

const FS_RRECT = `float fsRoundRect(vec2 q, vec2 b, float r) {
    r = min(r, min(b.x, b.y));
    vec2 d = abs(q) - b + r;
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}`;

const LAYOUT_OPTIONS = [
  { value: 'stack', label: 'Stack (a line of cards)' },
  { value: 'fan', label: 'Fan (a hand of cards)' },
  { value: 'ring', label: 'Ring / torus' },
  { value: 'helix', label: 'Helix (a spiral staircase)' },
  { value: 'grid', label: 'Grid (a contact sheet)' },
];

const PARAMS: Record<string, ParamDef> = {
  // Layout
  layout:     { section: 'Layout', label: 'Layout', type: 'select', options: LAYOUT_OPTIONS, hint: 'How the cards are arranged.' },
  layoutB:    { section: 'Layout', label: 'Morph to', type: 'select', options: [{ value: 'none', label: 'No morph' }, ...LAYOUT_OPTIONS], hint: 'A second layout to blend to with Morph (wire an LFO into Morph to go back and forth).' },
  morph:      { section: 'Layout', label: 'Morph', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'layoutB', value: LAYOUT_OPTIONS.map(o => o.value) }, hint: '0 is Layout, 1 is Morph to.' },
  stagger:    { section: 'Layout', label: 'Stagger', type: 'float', min: 0, max: 4, step: 0.01, showWhen: { param: 'layoutB', value: LAYOUT_OPTIONS.map(o => o.value) }, hint: 'Cards morph one after another instead of all at once: the first cards go first.' },
  cards:      { section: 'Layout', label: 'Cards', type: 'float', min: 1, max: MAX_CARDS, step: 1, hint: `How many cards, up to ${MAX_CARDS}. Each shows one of the Time Cube's frames, spread evenly through it. Fewer is faster.` },
  spacing:    { section: 'Layout', label: 'Spacing', type: 'float', min: 0, max: 1, step: 0.001, hint: 'The gap between cards: along a stack, up a helix, between grid cells, and how far a fan\'s cards sit behind each other.' },
  // Shape
  radius:     { section: 'Shape', label: 'Radius', type: 'float', min: 0, max: 8, step: 0.01, hint: 'Ring and helix: how far the cards are from the centre. Fan: how far below the cards it pivots.' },
  twist:      { section: 'Shape', label: 'Face out', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Ring and helix: 0 turns the cards along the ring (like a rolodex), 1 turns them to face outward.' },
  arc:        { section: 'Shape', label: 'Arc', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Ring: how much of the circle the cards go round. 1 is the whole circle.' },
  tube:       { section: 'Shape', label: 'Tube', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Ring: the radius of a tube the cards also wind round, making a torus. 0 is a flat ring.' },
  windings:   { section: 'Shape', label: 'Windings', type: 'float', min: 0, max: 24, step: 0.01, hint: 'Ring: how many times the cards go round the tube while going once round the ring.' },
  turns:      { section: 'Shape', label: 'Turns', type: 'float', min: -6, max: 6, step: 0.01, hint: 'Helix: how many times round from the first card to the last.' },
  fanAngle:   { section: 'Shape', label: 'Fan angle°', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Fan: how far the cards spread, from the first to the last, in degrees.' },
  columns:    { section: 'Shape', label: 'Columns', type: 'float', min: 0, max: 32, step: 1, hint: 'Grid: how many cards a row. 0 makes it about square.' },
  // Cards
  size:       { section: 'Cards', label: 'Card size', type: 'float', min: 0.05, max: 4, step: 0.01, hint: 'A card\'s height. The width follows the video\'s shape.' },
  aspect:     { section: 'Cards', label: 'Stretch', type: 'float', min: 0.2, max: 4, step: 0.01, hint: 'Widens (above 1) or narrows the cards against the video\'s own shape.' },
  corner:     { section: 'Cards', label: 'Corners', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How round the corners are: 1 is fully round.' },
  thickness:  { section: 'Cards', label: 'Thickness', type: 'float', min: 0, max: 0.2, step: 0.001, hint: 'How thick each card is. Its edge shows in Edge colour when you look at it from the side.' },
  opacity:    { section: 'Cards', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the cards are. Only the nearest four cards at a pixel are drawn, so keep it high with many cards overlapping.' },
  border:     { section: 'Cards', label: 'Border', type: 'float', min: 0, max: 0.3, step: 0.001, hint: 'A frame round each picture, as a share of the card\'s height.' },
  borderColor:{ section: 'Cards', label: 'Border colour', type: 'vec3color', hint: 'The border\'s colour, and the backs of the cards when Backs is Plain.' },
  edgeColor:  { section: 'Cards', label: 'Edge colour', type: 'vec3color', hint: 'The cards\' edges (with some Thickness).' },
  backFace:   { section: 'Cards', label: 'Backs', type: 'select', options: [{ value: 'image', label: 'The picture (mirrored)' }, { value: 'plain', label: 'Plain (Border colour)' }], hint: 'What the back of a card shows.' },
  shading:    { section: 'Cards', label: 'Shading', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Darkens cards turned away from the camera, for depth.' },
  // Scatter
  spread:     { section: 'Scatter', label: 'Spread', type: 'float', min: 0, max: 2, step: 0.001, hint: '0 keeps the layout tidy, 1 moves every card by its full random offset. Wire an LFO here to drift apart and come back together.' },
  scatterPos: { section: 'Scatter', label: 'Offset', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How far a card can move from its place, at Spread 1.' },
  scatterRot: { section: 'Scatter', label: 'Turn', type: 'float', min: 0, max: 2, step: 0.01, hint: 'How far a card can turn, at Spread 1 (1 is about 45°).' },
  seed:       { section: 'Scatter', label: 'Seed', type: 'float', min: 0, max: 100, step: 1, hint: 'A different set of random offsets.' },
  drift:      { section: 'Scatter', label: 'Drift', type: 'float', min: 0, max: 2, step: 0.001, hint: 'Each card wanders slowly round its place, on its own path.' },
  driftSpeed: { section: 'Scatter', label: 'Drift speed', type: 'float', min: 0, max: 2, step: 0.001, hint: 'How fast the cards wander (round trips a second, roughly).' },
  // Scan
  scan:       { section: 'Scan', label: 'Offset', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Where the scan is: 0 the first card, 1 the last. Wire Time or an LFO here to sweep.' },
  lift:       { section: 'Scan', label: 'Lift', type: 'float', min: -2, max: 2, step: 0.001, hint: 'How far the card at the scan rises out of the stack (along its own up).' },
  pull:       { section: 'Scan', label: 'Pull out', type: 'float', min: -2, max: 2, step: 0.001, hint: 'How far it comes forward (along the way it faces).' },
  scanScale:  { section: 'Scan', label: 'Scale', type: 'float', min: -0.9, max: 3, step: 0.01, hint: 'How much bigger it gets.' },
  tilt:       { section: 'Scan', label: 'Tilt°', type: 'float', min: -90, max: 90, step: 0.5, hint: 'How far it tips back, in degrees.' },
  gap:        { section: 'Scan', label: 'Gap', type: 'float', min: 0, max: 20, step: 0.01, hint: 'Cards either side slide apart, in cards, to make room.' },
  falloff:    { section: 'Scan', label: 'Falloff', type: 'float', min: 0, max: 20, step: 0.01, hint: 'How many neighbours the scan moves too, less and less: a wave. 0 moves only the one card.' },
  before:     { section: 'Scan', label: 'Before opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the cards before the scan are: lower lets you see past them to the scan.' },
  // Highlights
  hlCount:    { section: 'Highlights', label: 'Count', type: 'float', min: 0, max: MAX_CARDS, step: 1, hint: 'How many cards are highlighted. 0 is none.' },
  hlFrame:    { section: 'Highlights', label: 'First card', type: 'float', min: 0, max: MAX_CARDS - 1, step: 1, hint: 'The first highlighted card (counted from the scan with Loop on).' },
  hlEvery:    { section: 'Highlights', label: 'Every', type: 'float', min: 1, max: 64, step: 1, hint: 'Highlight one card every so many: 4 lights cards 0, 4, 8 …' },
  hlLoop:     { section: 'Highlights', label: 'With the scan', type: 'select', options: [{ value: 'loop', label: 'Travel with the scan, wrapping round' }, { value: 'fixed', label: 'Stay put' }], hint: 'Loop: the highlights move along with the scan and wrap round the end of the stack.' },
  hlLift:     { section: 'Highlights', label: 'Lift', type: 'float', min: -2, max: 2, step: 0.001, hint: 'How far highlighted cards rise.' },
  hlScale:    { section: 'Highlights', label: 'Scale', type: 'float', min: -0.9, max: 3, step: 0.01, hint: 'How much bigger they get.' },
  hlOutline:  { section: 'Highlights', label: 'Outline', type: 'float', min: 0, max: 0.2, step: 0.001, hint: 'An outline in Highlight colour, as a share of the card\'s height.' },
  hlTint:     { section: 'Highlights', label: 'Tint', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much of the Highlight colour washes over them.' },
  hlColor:    { section: 'Highlights', label: 'Highlight colour', type: 'vec3color', hint: 'The outline and tint colour.' },
  dim:        { section: 'Highlights', label: 'Dim others', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Darkens every card that is not highlighted.' },
  // Order
  order:      { section: 'Order', label: 'Order', type: 'select', options: [{ value: 'time', label: 'Time order' }, { value: 'shuffle', label: 'Shuffle' }], hint: 'Cards in time order, or Shuffle: a slider (or a wire) that sends each card to its own place in a random order.' },
  shuffle:    { section: 'Order', label: 'Shuffle', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'order', value: 'shuffle' }, hint: 'Moves the cards from time order (0) to a random order (1): each card flies to its own new place. Wire an LFO to shuffle and unshuffle.' },
  shuffleSeed:{ section: 'Order', label: 'Shuffle seed', type: 'float', min: 0, max: 100, step: 1, showWhen: { param: 'order', value: 'shuffle' }, hint: 'A different random order.' },
  // Focus
  dof:        { section: 'Focus', label: 'Depth of field', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'distance', label: 'Focus at a distance' }, { value: 'scan', label: 'Focus on the scan card' }], hint: 'Blurs cards nearer and further than the focus, like a camera lens.' },
  focus:      { section: 'Focus', label: 'Focus', type: 'float', min: 0.05, max: 3, step: 0.01, showWhen: { param: 'dof', value: 'distance' }, hint: 'Where the picture is sharp, as a share of the distance to the centre: 1 the centre, 0.6 nearer the camera, 1.5 beyond.' },
  blur:       { section: 'Focus', label: 'Blur', type: 'float', min: 0, max: 2, step: 0.01, showWhen: { param: 'dof', value: ['distance', 'scan'] }, hint: 'How strong the depth of field is: out of focus, cards go soft.' },
  maxBlur:    { section: 'Focus', label: 'Max blur', type: 'float', min: 0, max: 48, step: 0.5, showWhen: { param: 'dof', value: ['distance', 'scan'] }, hint: 'The most a card is blurred, in pixels of a 720-pixel-high picture.' },
  // Playback
  playback:   { section: 'Playback', label: 'Each card shows', type: 'select', options: [
    { value: 'own', label: 'Its own frame' },
    { value: 'echo', label: 'The video, each card a little later (time echo)' },
    { value: 'frozen', label: 'One frame on every card' },
  ], hint: 'Which frame each card shows.' },
  rate:       { section: 'Playback', label: 'Play speed', type: 'float', min: -60, max: 60, step: 0.1, showWhen: { param: 'playback', value: ['own', 'echo'] }, hint: 'Frames a second each card steps on by. 0 holds still (Its own frame).' },
  shift:      { section: 'Playback', label: 'Shift', type: 'float', min: -256, max: 256, step: 1, showWhen: { param: 'playback', value: ['own', 'echo'] }, hint: 'Moves every card on by this many frames.' },
  delay:      { section: 'Playback', label: 'Delay', type: 'float', min: 0, max: 16, step: 0.1, showWhen: { param: 'playback', value: 'echo' }, hint: 'Frames between one card and the next.' },
  frozen:     { section: 'Playback', label: 'Frame', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'playback', value: 'frozen' }, hint: 'Which frame, 0 the first, 1 the last.' },
  brightness: { section: 'Playback', label: 'Brightness', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Added to every frame\'s colour.' },
  contrast:   { section: 'Playback', label: 'Contrast', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Spreads the colours from mid grey (1 = as they are).' },
  // Camera
  projection: { section: 'Camera', label: 'Lens', type: 'select', options: [{ value: 'persp', label: 'Perspective' }, { value: 'ortho', label: 'Isometric (orthographic)' }], hint: 'Isometric keeps far cards the same size as near ones. Only the built-in camera.' },
  camDist:    { section: 'Camera', label: 'Cam Distance', type: 'float', min: 0.5, max: 40, step: 0.05, hint: 'How far the built-in camera is from the centre (Perspective).' },
  viewSize:   { section: 'Camera', label: 'View size', type: 'float', min: 0.2, max: 20, step: 0.01, showWhen: { param: 'projection', value: 'ortho' }, hint: 'Isometric: half the height of what the camera sees. Smaller is closer.' },
  camAngle:   { section: 'Camera', label: 'Angle', type: 'float', min: -6.28, max: 6.28, step: 0.01, hint: 'Orbit angle round the centre, in radians.' },
  camElevation:{ section: 'Camera', label: 'Elevation', type: 'float', min: -1.5, max: 1.5, step: 0.01, hint: 'Height of the camera: 0 level, 0.62 isometric, 1.5 looking straight down.' },
  rotSpeed:   { section: 'Camera', label: 'Orbit speed', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Turns the camera round the centre over time (radians a second).' },
  fov:        { section: 'Camera', label: 'Zoom', type: 'float', min: 0.5, max: 5, step: 0.01, hint: 'Lens length (Perspective): higher is zoomed in. With a March Camera wired, set it to that camera\'s FOV so edges stay smooth.' },
  background: { section: 'Camera', label: 'Background', type: 'vec3color', hint: 'Behind the cards (unless something is wired to Background).' },
};

export const FRAME_STACK_DEFAULTS: Record<string, unknown> = {
  layout: 'stack', layoutB: 'none', morph: 0, stagger: 0, cards: 48, spacing: 0.09,
  radius: 2.2, twist: 0, arc: 1, tube: 0, windings: 0, turns: 1.5, fanAngle: 120, columns: 0,
  size: 1, aspect: 1, corner: 0.06, thickness: 0.006, opacity: 1, border: 0, borderColor: [0.96, 0.96, 0.95], edgeColor: [0.85, 0.85, 0.86], backFace: 'image', shading: 0.35,
  spread: 0, scatterPos: 0.6, scatterRot: 0.4, seed: 1, drift: 0, driftSpeed: 0.08,
  scan: 0.5, lift: 0.5, pull: 0, scanScale: 0, tilt: 0, gap: 3, falloff: 0, before: 1,
  hlCount: 0, hlFrame: 0, hlEvery: 8, hlLoop: 'loop', hlLift: 0.3, hlScale: 0, hlOutline: 0.02, hlTint: 0, hlColor: [1, 0.78, 0.25], dim: 0,
  order: 'time', shuffle: 0, shuffleSeed: 1, dof: 'off', focus: 1, blur: 0.5, maxBlur: 16,
  playback: 'own', rate: 0, shift: 0, delay: 2, frozen: 0.5, brightness: 0, contrast: 1,
  projection: 'persp', camDist: 7, viewSize: 3, camAngle: 0.75, camElevation: 0.38, rotSpeed: 0, fov: 1.8, background: [0.05, 0.05, 0.07],
};

/** GLSL for a layout's pose: declares `<o>p`, `<o>n`, `<o>u` (position, normal, up) for card index `e` (float). */
function layoutGLSL(layout: Layout, o: string, e: string, id: string, P: Record<string, unknown>, ind: string): string {
  const sp = p(P.spacing, 0.09), R = p(P.radius, 2.2);
  const k = `(${e} - ${id}_mid)`;
  
  switch (layout) {
    case 'fan': return [
      `${ind}float ${o}a = ${id}_nf > 1.0 ? ${k} / max(${id}_nf - 1.0, 1.0) * radians(${p(P.fanAngle, 120)}) : 0.0;\n`,
      `${ind}vec3 ${o}u = vec3(-sin(${o}a), cos(${o}a), 0.0);\n`,
      `${ind}vec3 ${o}p = vec3(0.0, -${R}, -${k} * ${sp} * 0.25) + ${o}u * ${R};\n`,
      `${ind}vec3 ${o}n = vec3(0.0, 0.0, 1.0);\n`,
    ].join('');
    case 'ring': return [
      `${ind}float ${o}th = ${e} / ${id}_nf * 6.2831853 * ${p(P.arc, 1)};\n`,
      `${ind}vec3 ${o}rd = vec3(sin(${o}th), 0.0, cos(${o}th));\n`,
      `${ind}vec3 ${o}tg = vec3(cos(${o}th), 0.0, -sin(${o}th));\n`,
      `${ind}float ${o}ph = ${o}th * ${p(P.windings, 0)};\n`,
      `${ind}float ${o}tb = ${p(P.tube, 0)};\n`,
      `${ind}vec3 ${o}p = ${o}rd * (${R} + ${o}tb * cos(${o}ph)) + vec3(0.0, ${o}tb * sin(${o}ph), 0.0);\n`,
      `${ind}vec3 ${o}n = ${o}tg * ${id}_ctw + ${o}rd * ${id}_stw;\n`,
      `${ind}vec3 ${o}u = vec3(0.0, cos(${o}ph), 0.0) - ${o}rd * sin(${o}ph);\n`,
    ].join('');
    case 'helix': return [
      `${ind}float ${o}th = ${id}_nf > 1.0 ? ${e} / (${id}_nf - 1.0) * 6.2831853 * ${p(P.turns, 1.5)} : 0.0;\n`,
      `${ind}vec3 ${o}rd = vec3(sin(${o}th), 0.0, cos(${o}th));\n`,
      `${ind}vec3 ${o}p = ${o}rd * ${R} + vec3(0.0, ${k} * ${sp}, 0.0);\n`,
      `${ind}vec3 ${o}n = vec3(cos(${o}th), 0.0, -sin(${o}th)) * ${id}_ctw + ${o}rd * ${id}_stw;\n`,
      `${ind}vec3 ${o}u = vec3(0.0, 1.0, 0.0);\n`,
    ].join('');
    case 'grid': return [
      `${ind}float ${o}row = floor((${e} + 0.5) / ${id}_cols);\n`,
      `${ind}float ${o}col = ${e} - ${o}row * ${id}_cols;\n`,
      `${ind}vec3 ${o}p = vec3(-(${o}col - (${id}_cols - 1.0) * 0.5) * (2.0 * ${id}_half.x + ${sp}), -(${o}row - (${id}_rows - 1.0) * 0.5) * (2.0 * ${id}_half.y + ${sp}), 0.0);\n`,
      `${ind}vec3 ${o}n = vec3(0.0, 0.0, 1.0);\n`,
      `${ind}vec3 ${o}u = vec3(0.0, 1.0, 0.0);\n`,
    ].join('');
    default: return [
      `${ind}vec3 ${o}p = vec3(0.0, 0.0, -${k} * ${sp});\n`,
      `${ind}vec3 ${o}n = vec3(0.0, 0.0, 1.0);\n`,
      `${ind}vec3 ${o}u = vec3(0.0, 1.0, 0.0);\n`,
    ].join('');
  }
}

/**
 * A sphere round every card of a layout (before scatter and the scan's moves), as a GLSL vec4
 * (centre, radius). `<id>_L` is the half length of a stack (with the scan's gap), `<id>_hd` a
 * card's half diagonal at its largest.
 */
function boundGLSL(layout: Layout, id: string, P: Record<string, unknown>): string {
  const R = `abs(${p(P.radius, 2.2)})`;
  switch (layout) {
    case 'fan': return `vec4(0.0, -${p(P.radius, 2.2)}, 0.0, ${R} + ${id}_L * 0.25 + ${id}_hd)`;
    case 'ring': return `vec4(0.0, 0.0, 0.0, ${R} + abs(${p(P.tube, 0)}) + ${id}_hd)`;
    case 'helix': return `vec4(0.0, 0.0, 0.0, length(vec2(${R}, ${id}_L)) + ${id}_hd)`;
    case 'grid': return `vec4(0.0, 0.0, 0.0, length(0.5 * vec2(${id}_cols, ${id}_rows + 2.0 * abs(${p(P.gap, 3)}) / ${id}_cols + 1.0) * (2.0 * ${id}_half + ${p(P.spacing, 0.09)})) + ${id}_hd)`;
    default: return `vec4(0.0, 0.0, 0.0, ${id}_L + ${id}_hd)`;
  }
}

/** Ray against an axis-aligned box: (near, far); near > far is a miss. */
const FS_BOX = `vec2 fsBox(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
    vec3 inv = 1.0 / (rd + vec3(equal(rd, vec3(0.0))) * 1e-7);
    vec3 a = (lo - ro) * inv;
    vec3 b = (hi - ro) * inv;
    vec3 mn = min(a, b);
    vec3 mx = max(a, b);
    return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
}`;

/** Ray against the slab |o + d t| <= h along one axis: (near, far). */
const FS_SLAB = `vec2 fsSlab(float o, float d, float h) {
    if (abs(d) < 1e-7) return abs(o) <= h ? vec2(-1e9, 1e9) : vec2(1e9, -1e9);
    vec2 t = (vec2(-h, h) - o) / d;
    return vec2(min(t.x, t.y), max(t.x, t.y));
}`;

/** Ray against the infinite cylinder x² + z² = r² (axis y): (near, far); a miss is (1e9, -1e9). */
const FS_CYL = `vec2 fsCyl(vec3 ro, vec3 rd, float r) {
    float a = dot(rd.xz, rd.xz);
    float c = dot(ro.xz, ro.xz) - r * r;
    if (a < 1e-9) return c <= 0.0 ? vec2(-1e9, 1e9) : vec2(1e9, -1e9);
    float b = dot(ro.xz, rd.xz);
    float h = b * b - a * c;
    if (h < 0.0) return vec2(1e9, -1e9);
    h = sqrt(h);
    return vec2(-b - h, -b + h) / a;
}`;

/**
 * A run of card indices from window ends in layout units (`near` to `far`, either way round),
 * widened by `margin` and by the scan's gap, as vec3(start, count, step). Unwrapped: kept to
 * 0 … n − 1.
 */
const FS_RUN = `vec3 fsRun(float near, float far, float margin, float n, bool wrap) {
    float lo = ceil(min(near, far) - margin);
    float hi = floor(max(near, far) + margin);
    if (!wrap) { lo = max(lo, 0.0); hi = min(hi, n - 1.0); }
    float c = clamp(hi - lo + 1.0, 0.0, n);
    return far >= near ? vec3(lo, c, 1.0) : vec3(lo + c - 1.0, c, -1.0);
}`;

/** The angle of a point round the y axis, 0 … 2π, as the ring lays cards out (radial = (sin θ, 0, cos θ)). */
const FS_ANG = `float fsAng(vec3 q) {
    float a = atan(q.x, q.z);
    return a < 0.0 ? a + 6.2831853 : a;
}`;

/**
 * GLSL that sets `<id>_W0` and `<id>_W1` (vec3 start, count, step: runs of card indices this
 * pixel's ray can meet, near run first) and, for a ring, `<id>_wrap`. Every card is still tested
 * against its own bounding sphere; this only skips the ones the ray can't reach, which is most
 * of them. Morphs and fans test every card (inside one sphere round them all), walking from the
 * end nearer the camera.
 */
function windowGLSL(layout: Layout, morphTo: Layout | null, id: string, P: Record<string, unknown>): string[] {
  const empty = `vec3(0.0, 0.0, 1.0)`;
  const all = (cond: string) => [
    `    vec3 ${id}_W0 = ${cond} ? (${id}_rev ? vec3(${id}_nf - 1.0, ${id}_nf, -1.0) : vec3(0.0, ${id}_nf, 1.0)) : ${empty};\n`,
    `    vec3 ${id}_W1 = ${empty};\n`,
  ];
  const sphere = (bound: string) => [
    `    vec4 ${id}_BA = ${bound};\n`,
    `    vec3 ${id}_bo = ${id}_BA.xyz - ${id}_ro;\n`,
    `    float ${id}_bt = dot(${id}_bo, ${id}_rd);\n`,
    `    float ${id}_br = ${id}_BA.w + ${id}_mv;\n`,
    `    bool ${id}_in = ${id}_bt > -${id}_br && dot(${id}_bo, ${id}_bo) - ${id}_bt * ${id}_bt < ${id}_br * ${id}_br;\n`,
  ];
  // Margins in card units: how many slots a card can stray (its reach over the spacing), plus the gap.
  const gapM = (reach: string, unit: string) => `(${unit} > 1e-4 ? (${reach}) / ${unit} : 1e4) + ${id}_ga`;
  switch (morphTo ? 'morph' : layout) {
    case 'stack': return [
      `    vec3 ${id}_bx = vec3(${id}_hx + ${id}_mv, ${id}_L + ${id}_mv);\n`,
      `    vec2 ${id}_tb = fsBox(${id}_ro, ${id}_rd, -${id}_bx, ${id}_bx);\n`,
      `    ${id}_tb.x = max(${id}_tb.x, 0.0);\n`,
      `    float ${id}_zn = ${id}_ro.z + ${id}_rd.z * ${id}_tb.x;\n`,
      `    float ${id}_zf = ${id}_ro.z + ${id}_rd.z * ${id}_tb.y;\n`,
      `    float ${id}_isp = 1.0 / max(${id}_sp, 1e-4);\n`,
      `    vec3 ${id}_W0 = ${id}_tb.x <= ${id}_tb.y ? fsRun(${id}_mid - ${id}_zn * ${id}_isp, ${id}_mid - ${id}_zf * ${id}_isp, ${gapM(`${id}_mv`, `${id}_sp`)}, ${id}_nf, false) : ${empty};\n`,
      `    vec3 ${id}_W1 = ${empty};\n`,
    ];
    case 'helix': return [
      `    vec2 ${id}_tcy = fsCyl(${id}_ro, ${id}_rd, abs(${p(P.radius, 2.2)}) + ${id}_hd + ${id}_mv);\n`,
      `    vec2 ${id}_tsl = fsSlab(${id}_ro.y, ${id}_rd.y, ${id}_L + ${id}_hd + ${id}_mv);\n`,
      `    vec2 ${id}_tb = vec2(max(max(${id}_tcy.x, ${id}_tsl.x), 0.0), min(${id}_tcy.y, ${id}_tsl.y));\n`,
      `    float ${id}_isp = 1.0 / max(${id}_sp, 1e-4);\n`,
      `    vec3 ${id}_W0 = ${id}_tb.x <= ${id}_tb.y ? fsRun(${id}_mid + (${id}_ro.y + ${id}_rd.y * ${id}_tb.x) * ${id}_isp, ${id}_mid + (${id}_ro.y + ${id}_rd.y * ${id}_tb.y) * ${id}_isp, ${gapM(`${id}_hd + ${id}_mv`, `${id}_sp`)}, ${id}_nf, false) : ${empty};\n`,
      `    vec3 ${id}_W1 = ${empty};\n`,
    ];
    case 'grid': {
      const cw = `(2.0 * ${id}_half.x + ${id}_sp)`, ch = `(2.0 * ${id}_half.y + ${id}_sp)`;
      return [
        // The cards lie in z = 0 (give or take their reach): where the ray crosses that slab, which cells.
        `    vec2 ${id}_tz = fsSlab(${id}_ro.z, ${id}_rd.z, ${id}_mv);\n`,
        `    ${id}_tz = vec2(max(${id}_tz.x, 0.0), min(${id}_tz.y, 1e4));\n`,
        `    vec3 ${id}_q0 = ${id}_ro + ${id}_rd * ${id}_tz.x;\n`,
        `    vec3 ${id}_q1 = ${id}_ro + ${id}_rd * ${id}_tz.y;\n`,
        `    vec2 ${id}_qm = (min(${id}_q0.xy, ${id}_q1.xy) - ${id}_hx - ${id}_mv) / vec2(${cw}, ${ch});\n`,
        `    vec2 ${id}_qx = (max(${id}_q0.xy, ${id}_q1.xy) + ${id}_hx + ${id}_mv) / vec2(${cw}, ${ch});\n`,
        // Columns and rows run toward −x and −y (layoutPose grid).
        `    vec2 ${id}_cc = vec2(${id}_cols - 1.0, ${id}_rows - 1.0) * 0.5;\n`,
        `    vec2 ${id}_cl = clamp(ceil(${id}_cc - ${id}_qx), vec2(0.0), vec2(${id}_cols - 1.0, ${id}_rows - 1.0));\n`,
        `    vec2 ${id}_ch = clamp(floor(${id}_cc - ${id}_qm), vec2(0.0), vec2(${id}_cols - 1.0, ${id}_rows - 1.0));\n`,
        `    bool ${id}_gin = ${id}_tz.x <= ${id}_tz.y && ${id}_cl.x <= ${id}_ch.x && ${id}_cl.y <= ${id}_ch.y && ceil(${id}_cc.x - ${id}_qx.x) <= ${id}_cols - 1.0 && floor(${id}_cc.x - ${id}_qm.x) >= 0.0 && ceil(${id}_cc.y - ${id}_qx.y) <= ${id}_rows - 1.0 && floor(${id}_cc.y - ${id}_qm.y) >= 0.0;\n`,
        `    vec3 ${id}_W0 = ${id}_gin ? fsRun(${id}_cl.y * ${id}_cols + ${id}_cl.x, ${id}_ch.y * ${id}_cols + ${id}_ch.x, 1.0 + ${id}_ga, ${id}_nf, false) : ${empty};\n`,
        `    vec3 ${id}_W1 = ${empty};\n`,
      ];
    }
    case 'ring': {
      const R = `abs(${p(P.radius, 2.2)})`, tube = `abs(${p(P.tube, 0)})`, arc = p(P.arc, 1);
      return [
        `    float ${id}_rr = ${id}_hd + ${id}_mv;\n`,
        `    float ${id}_ri = ${R} - ${tube} - ${id}_rr;\n`,
        `    vec2 ${id}_tcy = fsCyl(${id}_ro, ${id}_rd, ${R} + ${tube} + ${id}_rr);\n`,
        `    vec2 ${id}_tsl = fsSlab(${id}_ro.y, ${id}_rd.y, ${tube} + ${id}_rr);\n`,
        `    vec2 ${id}_tb = vec2(max(max(${id}_tcy.x, ${id}_tsl.x), 0.0), min(${id}_tcy.y, ${id}_tsl.y));\n`,
        `    bool ${id}_wrap = ${arc} >= 0.999;\n`,
        `    vec3 ${id}_W0 = ${empty};\n`,
        `    vec3 ${id}_W1 = ${empty};\n`,
        `    if (${id}_tb.x <= ${id}_tb.y) {\n`,
        `        float ${id}_ke = ${id}_nf / (6.2831853 * max(${arc}, 1e-3));\n`,
        // Every point of a card is within rr of its slot on the ring (radius R ± tube), so within asin(rr / (R − tube)) of its slot's angle.
        `        float ${id}_am = ${id}_ri > 0.0 ? asin(${id}_rr / (${R} - ${tube})) * ${id}_ke + ${id}_ga : -1.0;\n`,
        `        vec2 ${id}_ti = ${id}_ri > 0.0 ? fsCyl(${id}_ro, ${id}_rd, ${id}_ri) : vec2(1e9, -1e9);\n`,
        // Up to two pieces of the ray outside the hole in the middle; each turns less than half way round.
        `        vec2 ${id}_s0 = vec2(${id}_tb.x, ${id}_ti.x < ${id}_ti.y ? min(${id}_tb.y, ${id}_ti.x) : ${id}_tb.y);\n`,
        `        vec2 ${id}_s1 = ${id}_ti.x < ${id}_ti.y ? vec2(max(${id}_tb.x, ${id}_ti.y), ${id}_tb.y) : vec2(1.0, -1.0);\n`,
        `        if (${id}_s0.x > ${id}_s0.y) { ${id}_s0 = ${id}_s1; ${id}_s1 = vec2(1.0, -1.0); }\n`,
        `        if (${id}_am < 0.0) ${id}_W0 = vec3(0.0, ${id}_nf, 1.0);\n`,
        `        else {\n`,
        `            for (int ${id}_sg = 0; ${id}_sg < 2; ${id}_sg++) {\n`,
        `                vec2 ${id}_sv = ${id}_sg == 0 ? ${id}_s0 : ${id}_s1;\n`,
        `                if (${id}_sv.x > ${id}_sv.y) continue;\n`,
        `                float ${id}_a0 = fsAng(${id}_ro + ${id}_rd * ${id}_sv.x);\n`,
        `                float ${id}_a1 = fsAng(${id}_ro + ${id}_rd * ${id}_sv.y);\n`,
        `                float ${id}_da = mod(${id}_a1 - ${id}_a0 + 3.1415927, 6.2831853) - 3.1415927;\n`,
        `                vec3 ${id}_w = fsRun(${id}_a0 * ${id}_ke, (${id}_a0 + ${id}_da) * ${id}_ke, ${id}_am, ${id}_nf, ${id}_wrap);\n`,
        // Part of an open ring: past the seam at angle 0 the indices don't wrap, so take every card.
        `                if (!${id}_wrap && (min(${id}_a0, ${id}_a0 + ${id}_da) * ${id}_ke - ${id}_am < 0.0 || max(${id}_a0, ${id}_a0 + ${id}_da) * ${id}_ke + ${id}_am > ${id}_nf / max(${arc}, 1e-3) - 1.0)) ${id}_w = vec3(0.0, ${id}_nf, 1.0);\n`,
        `                if (${id}_sg == 0) ${id}_W0 = ${id}_w; else ${id}_W1 = ${id}_w;\n`,
        `            }\n`,
        `        }\n`,
        `    }\n`,
      ];
    }
    default: return [
      ...(morphTo
        ? [
          `    vec4 ${id}_BAa = ${boundGLSL(layout, id, P)};\n`,
          `    vec4 ${id}_BBb = ${boundGLSL(morphTo, id, P)};\n`,
          ...sphere(`vec4(0.0, 0.0, 0.0, max(length(${id}_BAa.xyz) + ${id}_BAa.w, length(${id}_BBb.xyz) + ${id}_BBb.w))`),
        ]
        : sphere(boundGLSL(layout, id, P))),
      layoutGLSL(layout, `${id}_F0`, '0.0', id, P, '    '),
      layoutGLSL(layout, `${id}_F1`, `(${id}_nf - 1.0)`, id, P, '    '),
      `    bool ${id}_rev = dot(${id}_F0p - ${id}_F1p, ${id}_rd) > 0.0;\n`,
      ...all(`${id}_in`),
    ];
  }
}

export const FrameStackNode: NodeDefinition = {
  type: FRAME_STACK_TYPE,
  label: 'Frame Stack',
  category: '3D Scene',
  aliases: ['Frame cards', 'Video cards', 'Card stack', 'Frames as cards', 'Contact sheet', 'Film strip 3D', 'Time cube cards'],
  description: 'Draws a Time Cube\'s frames as separate cards you can arrange: a stack, a fan, a ring or torus, a helix or a grid, and morph between two. Scatter them, let them drift apart and back, scan through them (the card at the scan pops out) and highlight every few. Has its own camera (isometric too), or takes a March Camera\'s rays.',
  brief: {
    summary: 'A video\'s frames as a deck of cards in 3D. Pick a layout, scan through the cards (Offset) so one pops out, scatter them, highlight a few, and choose what each card plays.',
    start: [
      'Wire a Time Cube\'s Volume in and the Color out to the Output.',
      'Layout: Stack, Fan, Ring / torus, Helix or Grid. Set Morph to a second layout and wire an LFO into Morph to move between them.',
      'Scan: drag Offset (or wire an LFO) and the card there lifts out; Gap opens room round it.',
      'Scatter: wire an LFO (amplitude 0.5, offset 0.5) into Spread so the cards drift apart and come back together.',
    ],
  },
  inputs: {
    volume: { type: 'volume', label: 'Volume', hint: 'A Time Cube\'s Volume: the frames the cards show.' },
    scan: { type: 'float', label: 'Offset', hint: 'Where the scan is, 0–1. Wire Time or an LFO here.' },
    spread: { type: 'float', label: 'Spread', hint: 'How far the cards scatter, 0–1. Wire an LFO here to drift apart and back.' },
    morph: { type: 'float', label: 'Morph', hint: 'Layout to Morph to, 0–1.' },
    shuffle: { type: 'float', label: 'Shuffle', hint: 'Time order to random order, 0–1.' },
    ro: { type: 'vec3', label: 'Ray Origin', hint: 'A March Camera\'s Ray Origin. Unwired: the built-in orbit camera.' },
    rd: { type: 'vec3', label: 'Ray Dir', hint: 'A March Camera\'s Ray Dir.' },
    background: { type: 'vec3', label: 'Background', hint: 'What is behind the cards: e.g. a March Loop\'s Color.' },
    sceneDist: { type: 'float', label: 'Scene distance', hint: 'A March Loop\'s Distance (with the same camera): scene surfaces nearer than a card hide it.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The cards over the background.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'How much of this pixel the cards cover.' },
  },
  defaultParams: { ...FRAME_STACK_DEFAULTS },
  paramDefs: PARAMS,
  assignable: false,
  glslFunctionsFor: (node: GraphNode) => (node.params.order === 'shuffle' || node.inputs?.shuffle?.connection ? [FS_PERM] : []),
  glslFunctions: [FS_TILE, FS_HASH, FS_RRECT, FS_BOX, FS_SLAB, FS_CYL, FS_RUN, FS_ANG],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params;
    const V = inputVars.volume;
    const bg = inputVars.background ?? pv3(P.background, [0.05, 0.05, 0.07]);
    if (!V) return { code: `    vec3 ${id}_color = ${bg};\n    float ${id}_alpha = 0.0;\n`, outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
    const layA = layoutOf(P.layout);
    const layB = morphTargetOf(P.layoutB);
    const mode = playbackOf(P.playback);
    const ortho = P.projection === 'ortho' && !(inputVars.ro && inputVars.rd);
    const loop = P.hlLoop !== 'fixed';
    const plain = P.backFace === 'plain';
    const lay = volLayout(V), inset = volPx(V);
    /** Every layout but the ring gives a unit normal and up at right angles; a morph's mix doesn't. */
    const square = !layB && layA !== 'ring';
    const twisted = layA === 'ring' || layA === 'helix' || layB === 'ring' || layB === 'helix';
    const uv = inputVars.uv ?? 'g_uv';
    const dof = P.dof === 'distance' || P.dof === 'scan';
    /** Order: Shuffle (the shuffle's code is only written in when it is chosen: it is heavy). */
    const shuffled = P.order === 'shuffle' || !!inputVars.shuffle;
    /** The circle of confusion at distance `t`, in world units at that distance. */
    const cocW = (t: string) => ortho
      ? `min(${id}_ck * abs(${t} - ${id}_fd) / max(2.0 * ${p(P.viewSize, 3)}, 1e-3), ${id}_cmx) * ${id}_pw`
      : `min(${id}_ck * abs(${t} - ${id}_fd) / max(${t}, 1e-3), ${id}_cmx) * ${id}_pw * ${t}`;

    const camera = inputVars.ro && inputVars.rd
      ? [`    vec3 ${id}_ro = ${inputVars.ro};\n`, `    vec3 ${id}_rd = normalize(${inputVars.rd});\n`]
      : [
        // The March Camera's orbit round the centre (as Time Cube View's), or the same view through an orthographic lens.
        `    float ${id}_ang = ${p(P.camAngle, 0.75)} + u_time * ${p(P.rotSpeed, 0)};\n`,
        `    float ${id}_elev = ${p(P.camElevation, 0.38)};\n`,
        `    vec3 ${id}_hz = vec3(sin(${id}_ang), 0.0, cos(${id}_ang));\n`,
        `    vec3 ${id}_cd = cos(${id}_elev) * ${id}_hz + sin(${id}_elev) * vec3(0.0, 1.0, 0.0);\n`,
        `    vec3 ${id}_fw = -${id}_cd;\n`,
        `    vec3 ${id}_cu = normalize(-sin(${id}_elev) * ${id}_hz + cos(${id}_elev) * vec3(0.0, 1.0, 0.0));\n`,
        `    vec3 ${id}_rt = normalize(cross(${id}_cu, ${id}_fw));\n`,
        `    vec3 ${id}_up = cross(${id}_fw, ${id}_rt);\n`,
        ...(ortho
          ? [
            `    vec3 ${id}_ro = ${id}_cd * max(${p(P.camDist, 7)}, 30.0) + (${uv}.x * ${id}_rt + ${uv}.y * ${id}_up) * ${p(P.viewSize, 3)};\n`,
            `    vec3 ${id}_rd = ${id}_fw;\n`,
          ]
          : [
            `    vec3 ${id}_ro = ${p(P.camDist, 7)} * ${id}_cd;\n`,
            `    vec3 ${id}_rd = normalize(${uv}.x * ${id}_rt + ${uv}.y * ${id}_up + ${p(P.fov, 1.8)} * ${id}_fw);\n`,
          ]),
      ];

    /** A card's place in the layout: its index, or with Shuffle on the way to (or at) its shuffled place. */
    const slotOf = (i: string) => shuffled ? `(${id}_shf > 0.0 ? mix(${i}, fsPerm(${i}, ${id}_nf, ${id}_shs, false), ${id}_shf) : ${i})` : i;
    /**
     * Where card `idx` is, how big, and its scan and highlight weights (prefix `x`). `slot` is its
     * place in the layout (slotOf): the scan, its gap and the layout go by place; the frame it
     * shows and the highlights by the card itself (time order).
     */
    const geometry = (x: string, idx: string, slot: string, ind: string) => [
      `${ind}float ${x}i = ${idx};\n`,
      `${ind}float ${x}sl = ${slot};\n`,
      `${ind}float ${x}s = ${id}_nf > 1.0 ? ${x}i / (${id}_nf - 1.0) : 0.5;\n`,
      `${ind}float ${x}d = ${x}sl - ${id}_sc;\n`,
      // The scan's wave (layout.ts scanProfile): 1 within 0.35 of a card of the scan, easing to 0 Falloff cards on; the gap it opens.
      `${ind}float ${x}v = smoothstep(0.0, 1.0, clamp((abs(${x}d) - 0.35) / ${id}_fall, 0.0, 1.0));\n`,
      `${ind}float ${x}w = 1.0 - ${x}v;\n`,
      `${ind}float ${x}e = ${x}sl + ${p(P.gap, 3)} * sign(${x}d) * ${x}v;\n`,
      // Highlights (layout.ts isHighlighted).
      `${ind}float ${x}r = ${x}i - ${id}_hf${loop ? ` - floor(${id}_sc + 0.5)` : ''};\n`,
      ...(loop ? [`${ind}${x}r = mod(${x}r, ${id}_nf);\n`] : []),
      `${ind}float ${x}hl = (${x}r > -0.01 && mod(${x}r + 0.01, ${id}_hev) < 0.5 && ${x}r / ${id}_hev < ${id}_hc - 0.5) ? 1.0 : 0.0;\n`,
      layoutGLSL(layA, `${x}a`, `${x}e`, id, P, ind),
      ...(layB
        ? [
          layoutGLSL(layB, `${x}b`, `${x}e`, id, P, ind),
          `${ind}float ${x}m = smoothstep(0.0, 1.0, clamp(${id}_mo * (1.0 + ${id}_stg) - ${x}s * ${id}_stg, 0.0, 1.0));\n`,
          `${ind}vec3 ${x}p = mix(${x}ap, ${x}bp, ${x}m);\n`,
          `${ind}vec3 ${x}n = mix(${x}an, ${x}bn, ${x}m);\n`,
          `${ind}vec3 ${x}u = mix(${x}au, ${x}bu, ${x}m);\n`,
        ]
        : [`${ind}vec3 ${x}p = ${x}ap;\n`, `${ind}vec3 ${x}n = ${x}an;\n`, `${ind}vec3 ${x}u = ${x}au;\n`]),
      // Scatter (times Spread) and drift (layout.ts scatterOf).
      // (A branch on uniforms only: every pixel takes the same way, and a tidy layout skips the hashes.)
      `${ind}if (${id}_spo > 0.0 || ${id}_dr > 0.0) {\n`,
      `${ind}    vec3 ${x}h1 = fsHash33(vec3(${x}i + 1.0, ${id}_seed, 1.0)) * 2.0 - 1.0;\n`,
      `${ind}    vec3 ${x}h3 = fsHash33(vec3(${x}i + 1.0, ${id}_seed, 3.0));\n`,
      `${ind}    ${x}p += ${x}h1 * ${id}_spo + sin(u_time * ${id}_dsp * (0.6 + 0.4 * ${x}h3) + 6.2831853 * ${x}h3.yzx) * ${id}_dr;\n`,
      `${ind}}\n`,
      `${ind}float ${x}z = 1.0 + ${p(P.scanScale, 0)} * ${x}w + ${p(P.hlScale, 0)} * ${x}hl;\n`,
      `${ind}vec2 ${x}hb = ${id}_half * max(${x}z, 0.01);\n`,
      `${ind}float ${x}lu = ${id}_lift * ${x}w + ${id}_hlift * ${x}hl;\n`,
      `${ind}float ${x}lo = ${id}_pull * ${x}w;\n`,
    ].join('');

    /** Its frame (scatter turn, the scan's tilt, then lift along it) and the ray against its slab (prefix `x`). */
    const intersect = (x: string, ind: string) => [
      `${ind}vec3 ${x}nn = ${x}n;\n`,
      `${ind}vec3 ${x}uu = ${x}u;\n`,
      // Turned by the scatter (a branch on uniforms: a tidy layout skips the hash).
      `${ind}if (${id}_spr > 0.0) {\n`,
      `${ind}    vec3 ${x}h2 = fsHash33(vec3(${x}i + 1.0, ${id}_seed, 2.0)) * 2.0 - 1.0;\n`,
      `${ind}    ${x}nn += ${x}h2 * ${id}_spr;\n`,
      `${ind}    ${x}uu += ${x}h2.yzx * ${id}_spr;\n`,
      ...(square ? [] : [`${ind}}\n`]),
      // Made square again (a morph's mix, the torus's roll and the scatter's turn bend it).
      `${ind}${square ? '    ' : ''}${x}nn = normalize(${x}nn + vec3(0.0, 0.0, 1e-4));\n`,
      `${ind}${square ? '    ' : ''}${x}uu = normalize(${x}uu - ${x}nn * dot(${x}uu, ${x}nn));\n`,
      ...(square ? [`${ind}}\n`] : []),
      // The scan's tilt, only on the cards it reaches.
      `${ind}float ${x}ta = ${id}_tilt * ${x}w;\n`,
      `${ind}if (${x}ta != 0.0) {\n`,
      `${ind}    vec3 ${x}n2 = ${x}nn * cos(${x}ta) + ${x}uu * sin(${x}ta);\n`,
      `${ind}    ${x}uu = ${x}uu * cos(${x}ta) - ${x}nn * sin(${x}ta);\n`,
      `${ind}    ${x}nn = ${x}n2;\n`,
      `${ind}}\n`,
      `${ind}vec3 ${x}rt = cross(${x}nn, ${x}uu);\n`,
      `${ind}vec3 ${x}c = ${x}p + ${x}uu * ${x}lu + ${x}nn * ${x}lo;\n`,
      `${ind}vec3 ${x}o = ${id}_ro - ${x}c;\n`,
      `${ind}vec3 ${x}ol = vec3(dot(${x}o, ${x}rt), dot(${x}o, ${x}uu), dot(${x}o, ${x}nn));\n`,
      `${ind}vec3 ${x}dl = vec3(dot(${id}_rd, ${x}rt), dot(${id}_rd, ${x}uu), dot(${id}_rd, ${x}nn));\n`,
      `${ind}float ${x}dz = ${x}dl.z >= 0.0 ? max(${x}dl.z, 1e-5) : min(${x}dl.z, -1e-5);\n`,
      `${ind}float ${x}sg = sign(${x}dz);\n`,
      // Where the ray enters and leaves the card's slab.
      `${ind}float ${x}t0 = (-${x}sg * ${id}_th - ${x}ol.z) / ${x}dz;\n`,
      `${ind}float ${x}t1 = (${x}sg * ${id}_th - ${x}ol.z) / ${x}dz;\n`,
      `${ind}float ${x}cr = ${id}_crn * min(${x}hb.x, ${x}hb.y);\n`,
      `${ind}float ${x}sd = fsRoundRect(${x}ol.xy + ${x}dl.xy * ${x}t0, ${x}hb, ${x}cr);\n`,
      `${ind}float ${x}px = ${ortho ? `${id}_pix` : `${id}_pix * max(${x}t0, 1e-3)`};\n`,
      // The edge's softness: a pixel, or the circle of confusion out of focus.
      `${ind}float ${x}sf = ${dof ? `max(${x}px, ${cocW(`${x}t0`)})` : `${x}px`};\n`,
      `${ind}float ${x}t = -1.0;\n`,
      `${ind}float ${x}ed = 0.0;\n`,
      `${ind}if (${x}sd < 0.5 * ${x}sf) ${x}t = ${x}t0;\n`,
      `${ind}else if (${id}_th > 0.0) {\n`,
      // Not through the face: through the side, if the ray is inside the outline by the time it leaves the slab.
      `${ind}    float ${x}sd1 = fsRoundRect(${x}ol.xy + ${x}dl.xy * ${x}t1, ${x}hb, ${x}cr);\n`,
      `${ind}    if (${x}sd1 < 0.0) { ${x}t = mix(${x}t0, ${x}t1, ${x}sd / (${x}sd - ${x}sd1)); ${x}ed = 1.0; ${x}sd = -${x}sf; }\n`,
      `${ind}}\n`,
    ].join('');

    const look = (c: string) => `clamp((${c} - 0.5) * ${p(P.contrast, 1)} + 0.5 + ${p(P.brightness, 0)}, 0.0, 1.0)`;
    const F = `${lay}.z`;
    const frameOf = (x: string) => mode === 'frozen'
      ? `floor(clamp(${p(P.frozen, 0.5)}, 0.0, 1.0) * (${F} - 1.0) + 0.5)`
      : mode === 'echo'
        ? `mod(floor(u_time * ${p(P.rate, 0)} - ${x}i * ${p(P.delay, 2)} + ${p(P.shift, 0)}), ${F})`
        : `mod(floor(${x}s * (${F} - 1.0) + 0.5 + u_time * ${p(P.rate, 0)} + ${p(P.shift, 0)}), ${F})`;

    const H = `${id}_H`, x = `${id}_g`;
    const lines = [
      ...camera,
      `    float ${id}_nf = floor(clamp(${p(P.cards, 48)}, 1.0, ${MAX_CARDS}.0) + 0.5);\n`,
      `    float ${id}_mid = (${id}_nf - 1.0) * 0.5;\n`,
      `    float ${id}_sc = clamp(${inputVars.scan ?? p(P.scan, 0.5)}, 0.0, 1.0) * (${id}_nf - 1.0);\n`,
      `    float ${id}_fall = max(${p(P.falloff, 0)}, 0.0) + 0.3;\n`,
      `    vec2 ${id}_half = 0.5 * max(${p(P.size, 1)}, 0.01) * vec2(${lay}.w * max(${p(P.aspect, 1)}, 0.01), 1.0);\n`,
      ...(layA === 'grid' || layB === 'grid'
        ? [
          `    float ${id}_cols = floor(${p(P.columns, 0)} + 0.5);\n`,
          `    ${id}_cols = ${id}_cols >= 1.0 ? ${id}_cols : max(1.0, floor(sqrt(${id}_nf / max(${id}_half.x / ${id}_half.y, 0.05)) + 0.5));\n`,
          `    float ${id}_rows = ceil(${id}_nf / ${id}_cols);\n`,
        ]
        : []),
      ...(layB ? [`    float ${id}_mo = clamp(${inputVars.morph ?? p(P.morph, 0)}, 0.0, 1.0);\n`, `    float ${id}_stg = max(${p(P.stagger, 0)}, 0.0);\n`] : []),
      ...(twisted ? [`    float ${id}_ctw = cos(${p(P.twist, 0)} * 1.5707963);\n`, `    float ${id}_stw = sin(${p(P.twist, 0)} * 1.5707963);\n`] : []),
      ...(shuffled ? [
        `    float ${id}_shf = clamp(${inputVars.shuffle ?? p(P.shuffle, 0)}, 0.0, 1.0);\n`,
        `    float ${id}_shs = floor(${p(P.shuffleSeed, 1)} + 0.5);\n`,
      ] : []),
      `    float ${id}_sprd = max(${inputVars.spread ?? p(P.spread, 0)}, 0.0);\n`,
      `    float ${id}_spo = ${p(P.scatterPos, 0.6)} * ${id}_sprd;\n`,
      `    float ${id}_spr = ${p(P.scatterRot, 0.4)} * ${id}_sprd;\n`,
      `    float ${id}_seed = floor(${p(P.seed, 1)} + 0.5) + 1.0;\n`,
      `    float ${id}_dr = ${p(P.drift, 0)};\n`,
      `    float ${id}_dsp = ${p(P.driftSpeed, 0.08)} * 6.2831853;\n`,
      `    float ${id}_hf = floor(${p(P.hlFrame, 0)} + 0.5);\n`,
      `    float ${id}_hev = max(1.0, floor(${p(P.hlEvery, 8)} + 0.5));\n`,
      `    float ${id}_hc = floor(${p(P.hlCount, 0)} + 0.5);\n`,
      `    float ${id}_lift = ${p(P.lift, 0.5)};\n`,
      `    float ${id}_pull = ${p(P.pull, 0)};\n`,
      `    float ${id}_hlift = ${p(P.hlLift, 0.3)};\n`,
      `    float ${id}_tilt = radians(${p(P.tilt, 0)});\n`,
      `    float ${id}_th = max(${p(P.thickness, 0.006)}, 0.0) * 0.5;\n`,
      `    float ${id}_crn = clamp(${p(P.corner, 0.06)}, 0.0, 1.0);\n`,
      `    float ${id}_pix = ${ortho ? `2.0 * ${p(P.viewSize, 3)} / u_resolution.y` : `2.0 / (u_resolution.y * max(${p(P.fov, 1.8)}, 0.05))`};\n`,
      `    float ${id}_far = ${inputVars.sceneDist ? `max(${inputVars.sceneDist}, 0.0)` : '1e9'};\n`,
      // The nearest hits, in order: their distances and card indices.
      `    vec4 ${id}_T = vec4(1e9);\n`,
      `    vec4 ${id}_I = vec4(-1.0);\n`,
      // How far any card can reach from its place in the layout: its half diagonal at its largest
      // (hd), and the scatter, drift, lifts and thickness on top (mv; a turned card also its hd).
      `    vec2 ${id}_hx = ${id}_half * (1.0 + max(max(${p(P.scanScale, 0)}, ${p(P.hlScale, 0)}), 0.0));\n`,
      `    float ${id}_hd = length(${id}_hx) + ${id}_th;\n`,
      `    float ${id}_mv = 1.7320508 * (${id}_spo + ${id}_dr) + abs(${id}_lift) + abs(${id}_pull) + abs(${id}_hlift) + ${id}_th + (${id}_spr > 0.0 || ${id}_tilt != 0.0 ? ${id}_hd : 0.0);\n`,
      `    float ${id}_ex = ${id}_hd + ${id}_mv;\n`,
      `    float ${id}_sp = ${p(P.spacing, 0.09)};\n`,
      `    float ${id}_ga = abs(${p(P.gap, 3)});\n`,
      `    float ${id}_L = (${id}_mid + ${id}_ga) * ${id}_sp;\n`,
      ...(dof
        ? [
          // Depth of field (as the particles' camera): Blur 1 makes a card twice the focus distance away about 26 pixels (of 720) across.
          `    float ${id}_pw = ${ortho ? `2.0 * ${p(P.viewSize, 3)} / 720.0` : `2.0 / (720.0 * max(${p(P.fov, 1.8)}, 0.05))`};\n`,
          `    float ${id}_cmx = max(${p(P.maxBlur, 16)}, 0.0);\n`,
          `    float ${id}_ck = max(${p(P.blur, 0.5)}, 0.0) * 52.0;\n`,
          ...(P.dof === 'scan'
            ? [
              // Focus on the scan card: where it is now.
              geometry(`${id}_Q`, `floor(${id}_sc + 0.5)`, `floor(${id}_sc + 0.5)`, '    '),
              `    float ${id}_fd = length(${id}_Qp + ${id}_Qu * ${id}_Qlu + ${id}_Qn * ${id}_Qlo - ${id}_ro);\n`,
            ]
            : [`    float ${id}_fd = max(${p(P.focus, 1)}, 0.0) * ${ortho ? `dot(-${id}_ro, ${id}_rd)` : `length(${id}_ro)`};\n`]),
          // Blurred edges reach further: widen what the ray can meet.
          `    float ${id}_dm = 0.5 * ${id}_cmx * ${id}_pw * ${ortho ? '1.0' : `(length(${id}_ro) + 2.0 * (${id}_L + abs(${p(P.radius, 2.2)}) + abs(${p(P.tube, 0)}) + ${id}_hd))`};\n`,
          `    ${id}_mv += ${id}_dm;\n`,
          `    ${id}_ex += ${id}_dm;\n`,
        ]
        : []),
      // Which cards this ray can meet (windowGLSL): up to two runs of card indices,
      // each from its near end to its far end (start, count, step).
      // (`_cull: false`, for testing, tests every card: the picture must come out the same.)
      ...(P._cull === false ? windowGLSL(layA, layB ?? layA, id, P) : windowGLSL(layA, layB, id, P)),
      // Part way through a shuffle the cards are anywhere: test them all (in index order).
      ...(shuffled ? [
        `    bool ${id}_mid1 = ${id}_shf > 0.0 && ${id}_shf < 1.0;\n`,
        `    if (${id}_mid1) { ${id}_W0 = vec3(0.0, ${id}_nf, 1.0); ${id}_W1 = vec3(0.0, 0.0, 1.0); }\n`,
      ] : []),
      // Nothing further than this can show: the 4th nearest hit, or the nearest solid one.
      `    float ${id}_cut = ${id}_far;\n`,
      `    float ${id}_op = clamp(${p(P.opacity, 1)}, 0.0, 1.0);\n`,
      `    float ${id}_bf = clamp(${p(P.before, 1)}, 0.0, 1.0);\n`,
      `    float ${id}_lo0 = ${id}_W0.z > 0.0 ? ${id}_W0.x : ${id}_W0.x - ${id}_W0.y + 1.0;\n`,
      `    for (int ${id}_k = 0; ${id}_k < ${MAX_CARDS}; ${id}_k++) {\n`,
      `        float ${id}_kk = float(${id}_k);\n`,
      `        if (${id}_kk >= ${id}_W0.y + ${id}_W1.y) break;\n`,
      `        float ${id}_ii = ${id}_kk < ${id}_W0.y ? ${id}_W0.x + ${id}_W0.z * ${id}_kk : ${id}_W1.x + ${id}_W1.z * (${id}_kk - ${id}_W0.y);\n`,
      ...(layA === 'ring' && !layB && P._cull !== false
        ? [
          // Round a whole ring the indices wrap; the far run skips cards the near one had.
          `        if (${id}_wrap) {\n`,
          `            ${id}_ii = mod(${id}_ii, ${id}_nf);\n`,
          `            if (${id}_kk >= ${id}_W0.y && mod(${id}_ii - ${id}_lo0, ${id}_nf) < ${id}_W0.y - 0.5) continue;\n`,
          `        } else if (${id}_kk >= ${id}_W0.y && ${id}_ii >= ${id}_lo0 && ${id}_ii < ${id}_lo0 + ${id}_W0.y - 0.5) continue;\n`,
        ]
        : []),
      // With Shuffle all the way on, the runs are of places: which card is in this one.
      ...(shuffled
        ? [
          `        float ${id}_ci = ${id}_shf >= 1.0 ? fsPerm(${id}_ii, ${id}_nf, ${id}_shs, true) : ${id}_ii;\n`,
          geometry(x, `${id}_ci`, `(${id}_shf >= 1.0 ? ${id}_ii : ${slotOf(`${id}_ci`)})`, '        '),
        ]
        : [geometry(x, `${id}_ii`, `${id}_ii`, '        ')]),
      // Bounding sphere: skip a card whose sphere the ray misses, or that lies wholly behind the cut.
      `        float ${x}R = length(${x}hb) + ${id}_th + abs(${x}lu) + abs(${x}lo);\n`,
      `        vec3 ${x}oc = ${x}p - ${id}_ro;\n`,
      `        float ${x}tc = dot(${x}oc, ${id}_rd);\n`,
      ...(dof ? [`        ${x}R += 0.5 * ${id}_cmx * ${id}_pw * ${ortho ? '1.0' : `max(${x}tc + ${x}R, 0.0)`};\n`] : []),
      // A stack is walked near to far: once a card is past the cut by more than any card can move, so are the rest.
      ...(layA === 'stack' && !layB ? [`        if (${x}tc - ${id}_ex - 2.0 * ${id}_mv > ${id}_cut ${shuffled ? ` && !${id}_mid1` : ''}) break;\n`] : []),
      `        if (${x}tc < -${x}R || ${x}tc - ${x}R > ${id}_cut || dot(${x}oc, ${x}oc) - ${x}tc * ${x}tc > ${x}R * ${x}R) continue;\n`,
      intersect(x, '        '),
      `        if (${x}t > 1e-4 && ${x}t < ${id}_cut) {\n`,
      `            if (${x}t < ${id}_T.x) { ${id}_T = vec4(${x}t, ${id}_T.xyz); ${id}_I = vec4(${x}i, ${id}_I.xyz); }\n`,
      `            else if (${x}t < ${id}_T.y) { ${id}_T = vec4(${id}_T.x, ${x}t, ${id}_T.yz); ${id}_I = vec4(${id}_I.x, ${x}i, ${id}_I.yz); }\n`,
      `            else if (${x}t < ${id}_T.z) { ${id}_T.zw = vec2(${x}t, ${id}_T.z); ${id}_I.zw = vec2(${x}i, ${id}_I.z); }\n`,
      `            else { ${id}_T.w = ${x}t; ${id}_I.w = ${x}i; }\n`,
      // Solid where the ray meets it (inside the outline, fully opaque): nothing behind it shows.
      `            bool ${x}so = ${x}sd < -0.5 * ${x}sf && ${id}_op * mix(${id}_bf, 1.0, smoothstep(-0.5, 0.5, ${x}d)) > 0.999;\n`,
      `            ${id}_cut = min(${x}so ? ${x}t : ${id}_cut, ${id}_T.w);\n`,
      `        }\n`,
      `    }\n`,
      // Composite the nearest cards front to back: only these read the atlas.
      `    vec4 ${id}_acc = vec4(0.0);\n`,
      `    for (int ${id}_j = 0; ${id}_j < ${LAYERS}; ${id}_j++) {\n`,
      `        float ${H}ci = ${id}_j == 0 ? ${id}_I.x : ${id}_j == 1 ? ${id}_I.y : ${id}_j == 2 ? ${id}_I.z : ${id}_I.w;\n`,
      `        if (${H}ci < 0.0 || ${id}_acc.a > 0.995) break;\n`,
      geometry(H, `${H}ci`, slotOf(`${H}ci`), '        '),
      intersect(H, '        '),
      `        vec2 ${H}q = ${H}ol.xy + ${H}dl.xy * ${H}t;\n`,
      `        vec2 ${H}st = clamp(${H}q / (2.0 * ${H}hb) + 0.5, ${inset}, 1.0 - ${inset});\n`,
      ...(dof
        ? [
          // Out of focus: the frame read at 12 points over the circle of confusion (a golden-angle disc, turned per pixel).
          `        float ${H}fr = ${frameOf(H)};\n`,
          `        vec2 ${H}cr2 = ${cocW(`${H}t`)} / (2.0 * ${H}hb);\n`,
          `        vec3 ${H}tex = vec3(0.0);\n`,
          `        if (${cocW(`${H}t`)} > ${H}px) {\n`,
          `            float ${H}jr = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));\n`,
          `            for (int ${id}_q = 0; ${id}_q < 12; ${id}_q++) {\n`,
          `                float ${H}qa = float(${id}_q) * 2.3999632 + ${H}jr;\n`,
          `                vec2 ${H}qo = vec2(cos(${H}qa), sin(${H}qa)) * sqrt((float(${id}_q) + 0.5) / 12.0) * ${H}cr2;\n`,
          `                ${H}tex += texture2D(${V}, fsTile(${lay}, ${H}fr, clamp(${H}st + ${H}qo, ${inset}, 1.0 - ${inset}))).rgb;\n`,
          `            }\n`,
          `            ${H}tex /= 12.0;\n`,
          `        } else ${H}tex = texture2D(${V}, fsTile(${lay}, ${H}fr, ${H}st)).rgb;\n`,
          `        vec3 ${H}col = ${look(`${H}tex`)};\n`,
        ]
        : [`        vec3 ${H}col = ${look(`texture2D(${V}, fsTile(${lay}, ${frameOf(H)}, ${H}st)).rgb`)};\n`]),
      ...(plain ? [`        if (${H}dl.z > 0.0) ${H}col = ${pv3(P.borderColor, [0.96, 0.96, 0.95])};\n`] : []),
      `        float ${H}bw = ${p(P.border, 0)} * ${H}hb.y * 2.0;\n`,
      `        ${H}col = mix(${H}col, ${pv3(P.borderColor, [0.96, 0.96, 0.95])}, ${H}bw > 0.0 ? smoothstep(-${H}bw - ${H}sf, -${H}bw, ${H}sd) : 0.0);\n`,
      // Highlights: a tint and an outline; the rest dimmed.
      `        ${H}col = mix(${H}col, ${pv3(P.hlColor, [1, 0.78, 0.25])}, ${p(P.hlTint, 0)} * ${H}hl);\n`,
      `        float ${H}ow = ${p(P.hlOutline, 0.02)} * ${H}hb.y * 2.0;\n`,
      `        ${H}col = mix(${H}col, ${pv3(P.hlColor, [1, 0.78, 0.25])}, ${H}ow > 0.0 ? ${H}hl * smoothstep(-${H}ow - ${H}sf, -${H}ow, ${H}sd) : 0.0);\n`,
      `        ${H}col = mix(${H}col, ${pv3(P.edgeColor, [0.85, 0.85, 0.86])}, ${H}ed);\n`,
      `        ${H}col *= 1.0 - ${p(P.dim, 0)} * (1.0 - ${H}hl) * step(0.5, ${id}_hc);\n`,
      `        ${H}col *= mix(1.0, 0.4 + 0.6 * abs(${H}dl.z), ${p(P.shading, 0.35)});\n`,
      `        float ${H}al = clamp(0.5 - ${H}sd / ${H}sf, 0.0, 1.0) * clamp(${p(P.opacity, 1)}, 0.0, 1.0) * mix(clamp(${p(P.before, 1)}, 0.0, 1.0), 1.0, smoothstep(-0.5, 0.5, ${H}d));\n`,
      `        ${id}_acc.rgb += (1.0 - ${id}_acc.a) * ${H}al * ${H}col;\n`,
      `        ${id}_acc.a += (1.0 - ${id}_acc.a) * ${H}al;\n`,
      `    }\n`,
      `    vec3 ${id}_color = ${id}_acc.rgb + (1.0 - ${id}_acc.a) * ${bg};\n`,
      `    float ${id}_alpha = ${id}_acc.a;\n`,
    ];
    return { code: lines.join(''), outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
  },
};
