import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';
import { planFrameStack, stackSettingsOf, FRAME_WIDTHS, MAX_FRAMES, MIN_FRAMES } from '../../lib/timeCube/plan';
import { DEMO_META } from '../../lib/timeCube/frames';

/**
 * Time cube (docs/time-cube.md): a video as a box of time.
 *
 * - **Time Cube** (`timeCube`): picks a video (or the built-in test clip) and
 *   stacks its frames into a volume: one atlas texture (`u_tex_<slug>`,
 *   bound from the store's nodeTextures by lib/timeCube/volumes.ts) plus two
 *   defines for its layout. Its Volume output is that sampler's name.
 * - **Time Cube View** (`timeCubeView`): ray-marches the box in 3D, front to
 *   back, with a transfer function: frames before the slice are see-through,
 *   frames after it opaque, the slice itself a crisp frame; a colour key;
 *   box edges. Its own orbit camera, or a March Camera's rays.
 * - **Time Slice** (`timeSlice`): the 2D cut through the volume: a frame, a
 *   tilted plane (slit-scan), a row or column through time, or a per-pixel
 *   delay map (time displacement).
 *
 * The layout is known when the graph compiles (the plan is a pure function
 * of the node's settings and its video's size), so it is written into the
 * shader as `#define u_tex_<slug>_vol vec4(cols, rows, frames, aspect)` and
 * `_volpx` (half a texel of a tile). The atlas is read with plain bilinear
 * filtering, no mipmaps, in every host.
 */

export const TIME_CUBE_SOURCE_TYPE = 'timeCube';
export const TIME_CUBE_VIEW_TYPE = 'timeCubeView';
export const TIME_SLICE_TYPE = 'timeSlice';

/** The layout define of a volume sampler (`<sampler>_vol`): vec4(cols, rows, frames, aspect). */
export const volLayout = (sampler: string) => `${sampler}_vol`;
/** Its half-texel inset within a tile, in tile units (`<sampler>_volpx`). */
export const volPx = (sampler: string) => `${sampler}_volpx`;

const fx = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${+n.toFixed(6)}`);

/** The defines a Time Cube node's volume needs, from its plan (the test clip's when its video's size isn't known yet). */
export function timeCubeDeclarations(node: GraphNode): string[] {
  const meta = node.params.source === 'library' ? (node.params._meta as { width?: number; height?: number; duration?: number } | undefined) : DEMO_META;
  const plan = planFrameStack(
    meta && typeof meta.width === 'number' && typeof meta.height === 'number' ? { width: meta.width, height: meta.height, duration: Number(meta.duration) || 0 } : DEMO_META,
    stackSettingsOf(node.params),
  );
  const s = `u_tex_${node.id}`;
  return [
    `#define ${volLayout(s)} vec4(${fx(plan.cols)}, ${fx(plan.rows)}, ${fx(plan.frames)}, ${fx(plan.aspect)})`,
    `#define ${volPx(s)} vec2(${fx(0.5 / plan.tileW)}, ${fx(0.5 / plan.tileH)})`,
  ];
}

// ── Shared GLSL ──────────────────────────────────────────────────────────────

/** Atlas coordinate of frame f (an integer) at frame point uv. Mirrors lib/timeCube/plan.ts atlasUv. */
const TC_TILE = `vec2 tcTile(vec4 lay, float f, vec2 uv) {
    float row = floor((f + 0.5) / lay.x);
    float col = f - row * lay.x;
    return vec2((col + uv.x) / lay.x, 1.0 - (row + 1.0 - uv.y) / lay.y);
}`;

/** The volume at (u, v, t), 0–1 each: bilinear inside a frame, blended between the two nearest frames. */
const TC_SAMPLE = `vec3 tcSample(sampler2D tex, vec4 lay, vec2 inset, vec3 q) {
    vec2 uv = clamp(q.xy, inset, 1.0 - inset);
    float f = clamp(q.z, 0.0, 1.0) * (lay.z - 1.0);
    float f0 = floor(f);
    float f1 = min(f0 + 1.0, lay.z - 1.0);
    return mix(texture2D(tex, tcTile(lay, f0, uv)).rgb, texture2D(tex, tcTile(lay, f1, uv)).rgb, f - f0);
}`;

/**
 * The two frames either side of time q.z at (u, v), and how far between them (0–1). A key reads
 * each frame on its own and blends the matches, so a keyed colour fades smoothly from one frame
 * to the next instead of dropping out where its blend with the background no longer matches.
 */
const TC_FRAMES = `float tcFrames(sampler2D tex, vec4 lay, vec2 inset, vec3 q, out vec3 c0, out vec3 c1) {
    vec2 uv = clamp(q.xy, inset, 1.0 - inset);
    float f = clamp(q.z, 0.0, 1.0) * (lay.z - 1.0);
    float f0 = floor(f);
    c0 = texture2D(tex, tcTile(lay, f0, uv)).rgb;
    c1 = texture2D(tex, tcTile(lay, min(f0 + 1.0, lay.z - 1.0), uv)).rgb;
    return f - f0;
}`;

/** Optical depth across the box's length in time for an opacity (plan.ts opticalDepth): 1 is a hard surface. */
const TC_DEPTH = `float tcDepth(float o) {
    o = clamp(o, 0.0, 1.0);
    if (o <= 0.95) return -log(1.0 - o);
    float k = (o - 0.95) / 0.05;
    return 2.9957323 + (1000.0 - 2.9957323) * k * k;
}`;

const TC_HUESAT = `vec2 tcHueSat(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float d = mx - mn;
    if (d < 1e-6) return vec2(0.0);
    float h;
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    return vec2(fract(h / 6.0), d / max(mx, 1e-6));
}`;

/** Key match, 0–1 (plan.ts keyMatch). */
const TC_KEY = `float tcKeyColor(vec3 c, vec3 k, float tol, float soft) {
    return 1.0 - smoothstep(tol, tol + max(soft, 1e-3), length(c - k) / 1.7320508);
}
float tcKeyHue(vec3 c, vec3 k, float tol, float soft) {
    vec2 a = tcHueSat(c);
    vec2 b = tcHueSat(k);
    float dh = abs(fract(a.x - b.x + 1.5) - 0.5) * 2.0;
    return (1.0 - smoothstep(tol, tol + max(soft, 1e-3), dh)) * smoothstep(0.2, 0.4, a.y);
}
float tcKeyLuma(vec3 c, float lo, float hi, float soft) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    soft = max(soft, 1e-3);
    return smoothstep(lo - soft, lo, l) * (1.0 - smoothstep(hi, hi + soft, l));
}`;

const LUMA = 'vec3(0.299, 0.587, 0.114)';

/**
 * Volume coordinate (u, v, t) of box point q (0–1³) for a stack axis (plan.ts boxToVolume). The
 * app's cameras (March Camera) put screen right at −x looking down −z, so u runs toward −x: a
 * frame reads the right way round from the side time starts on.
 */
const uvtOf = (axis: string, q: string) =>
  axis === 'x' ? `vec3(${q}.z, ${q}.y, 1.0 - ${q}.x)`
  : axis === 'y' ? `vec3(1.0 - ${q}.x, 1.0 - ${q}.z, 1.0 - ${q}.y)`
  : `vec3(1.0 - ${q}.x, ${q}.y, 1.0 - ${q}.z)`;

const axisOf = (v: unknown) => (v === 'x' || v === 'y' ? v : 'z');
const STEPS: Record<string, number> = { draft: 96, good: 160, best: 288 };

// ── Time Cube (the source) ───────────────────────────────────────────────────

export const TimeCubeNode: NodeDefinition = {
  type: TIME_CUBE_SOURCE_TYPE,
  label: 'Time Cube',
  category: 'Sources',
  aliases: ['Video volume', 'Space-time cube', 'Video cube', 'Frame stack', 'Slit-scan'],
  description: 'Stacks a video\'s frames into a box of time: frame after frame, one behind the other. Wire its Volume into Time Cube View (the box in 3D) or Time Slice (a cut through it, for slit-scan). Uses the built-in test clip until you choose a video.',
  inputs: {},
  outputs: {
    volume: { type: 'volume', label: 'Volume', hint: 'The stacked frames. Wire into Time Cube View or Time Slice.' },
  },
  defaultParams: { source: 'demo', videoId: '', fileName: '', frames: 128, frameWidth: '256', start: 0, end: 0, spacing: 'count', step: 0.1 },
  paramDefs: {
    frames: { label: 'Frames', type: 'float', min: MIN_FRAMES, max: MAX_FRAMES, step: 1, hard: true, showWhen: { param: 'spacing', value: 'count' }, hint: 'How many frames to stack, spread evenly from Start to End.', help: 'How many frames to stack, spread evenly from Start to End. More frames make a smoother box but take longer to build and more memory (the card shows how much). Up to 256.' },
    spacing: { label: 'Spacing', type: 'select', options: [{ value: 'count', label: 'Spread a number of frames' }, { value: 'step', label: 'One frame every…' }], hint: 'Pick frames by count, or one every so many seconds.' },
    step: { label: 'Every (s)', type: 'float', min: 0.02, max: 2, step: 0.01, showWhen: { param: 'spacing', value: 'step' }, hint: 'Seconds between stacked frames.' },
    frameWidth: { label: 'Frame size', type: 'select', options: FRAME_WIDTHS.map(w => ({ value: String(w), label: `${w} px wide` })), hint: 'How wide each stacked frame is (the height follows the video\'s shape). Bigger is sharper and heavier.' },
    start: { label: 'Start (s)', type: 'float', min: 0, max: 60, step: 0.1, hint: 'Where in the video the stack begins.' },
    end: { label: 'End (s)', type: 'float', min: 0, max: 60, step: 0.1, hint: 'Where it ends. 0 = the end of the video.' },
  },
  assignable: false,
  declarationsFor: timeCubeDeclarations,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: { volume: `u_tex_${node.id}` } }),
};

// ── Time Cube View (3D) ──────────────────────────────────────────────────────

const VIEW_PARAMS: Record<string, ParamDef> = {
  slice:        { section: 'Slice', label: 'Offset', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Where the slice sits in time: 0 the first frame, 1 the last. Wire Time or an LFO into it to sweep.' },
  before:       { section: 'Slice', label: 'Before opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frames before the slice are, looking through all of them: 0.2 lets most of what is behind show through.' },
  after:        { section: 'Slice', label: 'After opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frames after the slice are. 1 is a solid block whose sides show each frame\'s edge pixels through time.' },
  sliceOpacity: { section: 'Slice', label: 'Slice face', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frame at the slice is: 1 shows that frame crisply.' },
  tiltX:        { section: 'Slice', label: 'Tilt X°', type: 'float', min: -75, max: 75, step: 0.5, hint: 'Tilts the slice so time runs across the frame from left to right: the slit-scan look.' },
  tiltY:        { section: 'Slice', label: 'Tilt Y°', type: 'float', min: -75, max: 75, step: 0.5, hint: 'Tilts the slice so time runs from bottom to top.' },
  axis:         { section: 'Box', label: 'Stack along', type: 'select', options: [{ value: 'z', label: 'Depth (frames one behind another)' }, { value: 'x', label: 'Width (frames side by side)' }, { value: 'y', label: 'Height (frames stacked up)' }], hint: 'Which way time runs through the box.' },
  depth:        { section: 'Box', label: 'Time stretch', type: 'float', min: 0.1, max: 6, step: 0.01, hint: 'How long the box is in time, against the frame\'s height of 1.' },
  size:         { section: 'Box', label: 'Box size', type: 'float', min: 0.1, max: 4, step: 0.01, hint: 'Scales the whole box.' },
  quality:      { section: 'Box', label: 'Quality', type: 'select', options: [{ value: 'draft', label: 'Draft (96 steps)' }, { value: 'good', label: 'Good (160 steps)' }, { value: 'best', label: 'Best (288 steps)' }], hint: 'Samples along each ray. More is smoother through time and slower.' },
  brightness:   { section: 'Look', label: 'Brightness', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Added to every frame\'s colour.' },
  contrast:     { section: 'Look', label: 'Contrast', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Spreads the colours away from mid grey (1 = as they are).' },
  darkClear:    { section: 'Look', label: 'Dark is clear', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Makes dark pixels see-through: 1 keeps only the bright parts of every frame. Good for footage on black.' },
  background:   { section: 'Look', label: 'Background', type: 'vec3color', hint: 'Behind the box (unless something is wired to Background).' },
  keyMode:      { section: 'Colour key', label: 'Key', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'color', label: 'A colour' }, { value: 'hue', label: 'A hue (any brightness)' }, { value: 'luma', label: 'A brightness range' }], hint: 'Pick out a colour: what matches stays solid through time, everything else fades.' },
  keyColor:     { section: 'Colour key', label: 'Key colour', type: 'vec3color', showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'The colour (or hue) to keep.' },
  keyTolerance: { section: 'Colour key', label: 'Tolerance', type: 'float', min: 0, max: 1, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'How far from the key colour still counts as a match.' },
  lumaLo:       { section: 'Colour key', label: 'Brightness from', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: 'luma' }, pair: { with: 'lumaHi', label: 'Brightness range' }, hint: 'Darkest brightness kept.' },
  lumaHi:       { section: 'Colour key', label: 'Brightness to', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: 'luma' }, hint: 'Brightest brightness kept.' },
  keySoftness:  { section: 'Colour key', label: 'Softness', type: 'float', min: 0, max: 0.5, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'A soft edge to the match.' },
  keyOpacity:   { section: 'Colour key', label: 'Key opacity', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'How solid the matching colour is, before and after the slice alike: 1 leaves a solid trail.' },
  othersOpacity:{ section: 'Colour key', label: 'Others', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Opacity of everything else, times Before / After: low makes the rest ghostly.' },
  othersGrey:   { section: 'Colour key', label: 'Others grey', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Drains the colour from everything that doesn\'t match.' },
  edgeWidth:    { section: 'Edges', label: 'Edge width', type: 'float', min: 0, max: 6, step: 0.1, hint: 'Thickness of the box\'s outline, in pixels. 0 hides it.' },
  edgeOpacity:  { section: 'Edges', label: 'Edge opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How strong the outline is.' },
  sliceEdge:    { section: 'Edges', label: 'Slice outline', type: 'float', min: 0, max: 1, step: 0.01, hint: 'An outline round the slice where it meets the box.' },
  edgeColor:    { section: 'Edges', label: 'Edge colour', type: 'vec3color', hint: 'Colour of the outlines.' },
  camDist:      { section: 'Camera', label: 'Cam Distance', type: 'float', min: 0.5, max: 20, step: 0.05, hint: 'How far the built-in camera is from the box (when Ray Origin / Ray Dir are not wired).' },
  camAngle:     { section: 'Camera', label: 'Angle', type: 'float', min: -6.28, max: 6.28, step: 0.01, hint: 'Orbit angle round the box, in radians.' },
  camElevation: { section: 'Camera', label: 'Elevation', type: 'float', min: -1.5, max: 1.5, step: 0.01, hint: 'Height of the camera: 0 level, up to 1.5 looking straight down.' },
  rotSpeed:     { section: 'Camera', label: 'Orbit speed', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Turns the camera round the box over time (radians a second).' },
  fov:          { section: 'Camera', label: 'Zoom', type: 'float', min: 0.5, max: 5, step: 0.01, hint: 'Lens length: higher is zoomed in. With a March Camera wired, set it to that camera\'s FOV so edges stay the same width.' },
};

export const TimeCubeViewNode: NodeDefinition = {
  type: TIME_CUBE_VIEW_TYPE,
  label: 'Time Cube View',
  category: '3D Scene',
  aliases: ['Video volume render', 'Space-time cube', 'Volume render', 'Time box'],
  description: 'Draws a Time Cube as a box in 3D: earlier frames see-through, later ones solid, the frame at the slice crisp, with an outline. Has its own orbit camera, or takes a March Camera\'s rays to sit in a 3D scene.',
  brief: {
    summary: 'A video as a box of time, ray-marched front to back. The slice (Offset) splits it: frames before it are see-through, frames after it solid, and the frame at the slice shows crisply.',
    start: [
      'Wire a Time Cube\'s Volume in and the Color out to the Output.',
      'Drag Offset, or wire an LFO (amplitude 0.5, offset 0.5) into it to sweep through time.',
      'Key: pick a colour to keep solid through time while the rest fades.',
      'To place it in a raymarched scene: wire a March Camera\'s Ray Origin and Ray Dir in, the March Loop\'s Color into Background and its Distance into Scene distance.',
    ],
  },
  inputs: {
    volume: { type: 'volume', label: 'Volume', hint: 'A Time Cube\'s Volume.' },
    slice: { type: 'float', label: 'Offset', hint: 'Where the slice is in time, 0–1. Wire Time or an LFO here to sweep.' },
    ro: { type: 'vec3', label: 'Ray Origin', hint: 'A March Camera\'s Ray Origin. Unwired: the built-in orbit camera.' },
    rd: { type: 'vec3', label: 'Ray Dir', hint: 'A March Camera\'s Ray Dir.' },
    background: { type: 'vec3', label: 'Background', hint: 'What is behind the box: e.g. a March Loop\'s Color, so the box sits in that scene.' },
    sceneDist: { type: 'float', label: 'Scene distance', hint: 'A March Loop\'s Distance (with the same camera): scene surfaces nearer than the box hide it.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The box over the background.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'How much of this pixel the box (and its outline) covers.' },
  },
  defaultParams: {
    slice: 0.5, before: 0.45, after: 1, sliceOpacity: 1, tiltX: 0, tiltY: 0,
    axis: 'z', depth: 1.6, size: 1, quality: 'good',
    brightness: 0, contrast: 1, darkClear: 0, background: [0.05, 0.05, 0.07],
    keyMode: 'off', keyColor: [0.85, 0.12, 0.12], keyTolerance: 0.08, lumaLo: 0.6, lumaHi: 1, keySoftness: 0.06, keyOpacity: 1, othersOpacity: 0.2, othersGrey: 0.5,
    edgeWidth: 1.2, edgeOpacity: 0.85, sliceEdge: 0.6, edgeColor: [0.92, 0.93, 0.96],
    camDist: 4.4, camAngle: 0.6, camElevation: 0.32, rotSpeed: 0, fov: 1.8,
  },
  paramDefs: VIEW_PARAMS,
  assignable: false,
  glslFunctions: [TC_TILE, TC_SAMPLE, TC_FRAMES, TC_DEPTH, TC_HUESAT, TC_KEY],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params;
    const V = inputVars.volume;
    const bg = inputVars.background ?? pv3(P.background, [0.05, 0.05, 0.07]);
    if (!V) {
      return { code: `    vec3 ${id}_color = ${bg};\n    float ${id}_alpha = 0.0;\n`, outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
    }
    const axis = axisOf(P.axis);
    const steps = STEPS[String(P.quality)] ?? STEPS.good;
    const keyMode = P.keyMode === 'color' || P.keyMode === 'hue' || P.keyMode === 'luma' ? P.keyMode : 'off';
    const lay = volLayout(V), inset = volPx(V);
    const slice = inputVars.slice ?? p(P.slice, 0.5);
    const look = (c: string) => `clamp((${c} - 0.5) * ${p(P.contrast, 1)} + 0.5 + ${p(P.brightness, 0)}, 0.0, 1.0)`;
    /** Declare `<name>` = the volume coordinate of world point `pt` (through the box's 0–1 coordinate `<name>_q`). */
    const uvtAt = (indent: string, name: string, pt: string) =>
      `${indent}vec3 ${name}_q = (${pt} + ${id}_B) * ${id}_iB;\n${indent}vec3 ${name} = ${uvtOf(axis, `${name}_q`)};\n`;
    const sliceT = (w: string) => `(${id}_sl0 + ${id}_kx * ((${w}).x - 0.5) + ${id}_ky * ((${w}).y - 0.5))`;
    const edgeCol = pv3(P.edgeColor, [0.92, 0.93, 0.96]);
    const timeLen = axis === 'x' ? `${id}_B.x` : axis === 'y' ? `${id}_B.y` : `${id}_B.z`;
    const half = axis === 'x' ? `vec3(${id}_dep, 1.0, ${id}_asp)` : axis === 'y' ? `vec3(${id}_asp, ${id}_dep, 1.0)` : `vec3(${id}_asp, 1.0, ${id}_dep)`;
    const camera = inputVars.ro && inputVars.rd
      ? [`    vec3 ${id}_ro = ${inputVars.ro};\n`, `    vec3 ${id}_rd = normalize(${inputVars.rd});\n`]
      : [
        // The March Camera's orbit, aimed at the box's centre.
        `    float ${id}_ang = ${p(P.camAngle, 0.6)} + u_time * ${p(P.rotSpeed, 0)};\n`,
        `    float ${id}_elev = ${p(P.camElevation, 0.32)};\n`,
        `    vec3 ${id}_hz = vec3(sin(${id}_ang), 0.0, cos(${id}_ang));\n`,
        `    vec3 ${id}_ro = ${p(P.camDist, 4.4)} * (cos(${id}_elev) * ${id}_hz + sin(${id}_elev) * vec3(0.0, 1.0, 0.0));\n`,
        `    vec3 ${id}_fw = normalize(-${id}_ro);\n`,
        `    vec3 ${id}_cu = normalize(-sin(${id}_elev) * ${id}_hz + cos(${id}_elev) * vec3(0.0, 1.0, 0.0));\n`,
        `    vec3 ${id}_rt = normalize(cross(${id}_cu, ${id}_fw));\n`,
        `    vec3 ${id}_rd = normalize(${inputVars.uv ?? 'g_uv'}.x * ${id}_rt + ${inputVars.uv ?? 'g_uv'}.y * cross(${id}_fw, ${id}_rt) + ${p(P.fov, 1.8)} * ${id}_fw);\n`,
      ];
    const edgeAt = (pt: string, dist: string, out: string) => [
      `        vec3 ${out}_d = ${id}_B - abs(${pt});\n`,
      // The middle of the three distances to the faces: small only near an edge (two faces at once).
      `        float ${out}_m = ${out}_d.x + ${out}_d.y + ${out}_d.z - min(${out}_d.x, min(${out}_d.y, ${out}_d.z)) - max(${out}_d.x, max(${out}_d.y, ${out}_d.z));\n`,
      `        float ${out}_px = ${id}_pix * max(${dist}, 1e-3);\n`,
      `        float ${out} = ${id}_ew > 0.0 ? 1.0 - smoothstep(${id}_ew * ${out}_px - ${out}_px, ${id}_ew * ${out}_px, ${out}_m) : 0.0;\n`,
    ].join('');
    const keyOf = (c: string) => keyMode === 'color' ? `tcKeyColor(${c}, ${pv3(P.keyColor, [0.85, 0.12, 0.12])}, ${p(P.keyTolerance, 0.08)}, ${p(P.keySoftness, 0.06)})`
      : keyMode === 'hue' ? `tcKeyHue(${c}, ${pv3(P.keyColor, [0.85, 0.12, 0.12])}, ${p(P.keyTolerance, 0.08)}, ${p(P.keySoftness, 0.06)})`
      : `tcKeyLuma(${c}, ${p(P.lumaLo, 0.6)}, ${p(P.lumaHi, 1)}, ${p(P.keySoftness, 0.06)})`;
    const keyLines = keyMode === 'off' ? '' : [
      // Each frame keyed on its own, the matches blended (tcFrames).
      `            float ${id}_k = mix(${keyOf(`${id}_c0`)}, ${keyOf(`${id}_c1`)}, ${id}_fw);\n`,
      `            ${id}_op = ${id}_op * ${p(P.othersOpacity, 0.2)} * (1.0 - ${id}_k) + ${p(P.keyOpacity, 1)} * ${id}_k;\n`,
      `            ${id}_c = mix(${id}_c, vec3(dot(${id}_c, ${LUMA})), ${p(P.othersGrey, 0.5)} * (1.0 - ${id}_k));\n`,
    ].join('');
    // The frame at the slice, composited where the ray crosses the plane (exactly, not at a step).
    const sliceFace = [
      `            {\n`,
      `                vec3 ${id}_ps = ${id}_ro + ${id}_rd * ${id}_ls;\n`,
      uvtAt('                ', `${id}_ws`, `${id}_ps`),
      `                vec3 ${id}_sc = ${look(`tcSample(${V}, ${lay}, ${inset}, ${id}_ws)`)};\n`,
      `                vec3 ${id}_sd = ${id}_B - abs(${id}_ps);\n`,
      `                float ${id}_spx = ${id}_pix * ${id}_ls;\n`,
      `                float ${id}_so = ${id}_ew > 0.0 ? (1.0 - smoothstep(${id}_ew * ${id}_spx - ${id}_spx, ${id}_ew * ${id}_spx, min(${id}_sd.x, min(${id}_sd.y, ${id}_sd.z)))) * ${p(P.sliceEdge, 0.6)} : 0.0;\n`,
      `                float ${id}_sa = max(clamp(${p(P.sliceOpacity, 1)}, 0.0, 1.0), ${id}_so);\n`,
      `                ${id}_sc = mix(${id}_sc, ${edgeCol}, ${id}_so);\n`,
      `                ${id}_acc.rgb += (1.0 - ${id}_acc.a) * ${id}_sa * ${id}_sc;\n`,
      `                ${id}_acc.a += (1.0 - ${id}_acc.a) * ${id}_sa;\n`,
      `            }\n`,
    ].join('');
    const lines = [
      ...camera,
      `    float ${id}_asp = ${lay}.w;\n`,
      `    float ${id}_dep = max(${p(P.depth, 1.6)}, 0.01);\n`,
      `    vec3 ${id}_B = 0.5 * max(${p(P.size, 1)}, 0.01) * ${half};\n`,
      `    vec3 ${id}_iB = 0.5 / ${id}_B;\n`,
      `    float ${id}_sl0 = ${slice};\n`,
      `    float ${id}_kx = tan(radians(clamp(${p(P.tiltX, 0)}, -85.0, 85.0)));\n`,
      `    float ${id}_ky = tan(radians(clamp(${p(P.tiltY, 0)}, -85.0, 85.0)));\n`,
      `    float ${id}_pix = 2.0 / (u_resolution.y * max(${p(P.fov, 1.8)}, 0.05));\n`,
      `    float ${id}_ew = max(${p(P.edgeWidth, 1.2)}, 0.0);\n`,
      `    vec4 ${id}_acc = vec4(0.0);\n`,
      `    float ${id}_edge = 0.0;\n`,
      // Ray against the box.
      `    vec3 ${id}_inv = 1.0 / (${id}_rd + vec3(equal(${id}_rd, vec3(0.0))) * 1e-7);\n`,
      `    vec3 ${id}_ta = (-${id}_B - ${id}_ro) * ${id}_inv;\n`,
      `    vec3 ${id}_tb = (${id}_B - ${id}_ro) * ${id}_inv;\n`,
      `    vec3 ${id}_tmn = min(${id}_ta, ${id}_tb);\n`,
      `    vec3 ${id}_tmx = max(${id}_ta, ${id}_tb);\n`,
      `    float ${id}_tn = max(max(max(${id}_tmn.x, ${id}_tmn.y), ${id}_tmn.z), 0.0);\n`,
      `    float ${id}_tf = min(min(${id}_tmx.x, ${id}_tmx.y), ${id}_tmx.z);\n`,
      `    float ${id}_scn = ${inputVars.sceneDist ? `max(${inputVars.sceneDist}, 0.0)` : '1e9'};\n`,
      `    float ${id}_far = min(${id}_tf, ${id}_scn);\n`,
      `    if (${id}_tf > ${id}_tn && ${id}_far > ${id}_tn) {\n`,
      // Front edges: drawn over everything, after the march.
      `        vec3 ${id}_pe = ${id}_ro + ${id}_rd * ${id}_tn;\n`,
      edgeAt(`${id}_pe`, `${id}_tn`, `${id}_fe`),
      `        ${id}_edge = ${id}_tn > 0.0 ? ${id}_fe : 0.0;\n`,
      // The slice plane: where along the ray it is crossed, if it is (the side function is linear along the ray).
      uvtAt('        ', `${id}_w0`, `${id}_pe`),
      uvtAt('        ', `${id}_w1`, `(${id}_ro + ${id}_rd * ${id}_far)`),
      `        float ${id}_f0 = ${id}_w0.z - ${sliceT(`${id}_w0`)};\n`,
      `        float ${id}_f1 = ${id}_w1.z - ${sliceT(`${id}_w1`)};\n`,
      `        float ${id}_len = ${id}_far - ${id}_tn;\n`,
      `        float ${id}_ls = ${id}_f0 * ${id}_f1 < 0.0 ? ${id}_tn + ${id}_len * ${id}_f0 / (${id}_f0 - ${id}_f1) : -1.0;\n`,
      `        float ${id}_dl = length(2.0 * ${id}_B) / ${steps}.0;\n`,
      // Where in each step to sample, per pixel (interleaved gradient noise): fine grain instead of the bands a fixed step draws.
      `        float ${id}_j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));\n`,
      `        float ${id}_tl = 2.0 * ${timeLen};\n`,
      `        int ${id}_n = int(ceil(${id}_len / ${id}_dl));\n`,
      `        for (int ${id}_i = 0; ${id}_i < ${steps}; ${id}_i++) {\n`,
      `            if (${id}_i >= ${id}_n || ${id}_acc.a > 0.995) break;\n`,
      `            float ${id}_a = ${id}_tn + float(${id}_i) * ${id}_dl;\n`,
      `            float ${id}_b = min(${id}_a + ${id}_dl, ${id}_far);\n`,
      `            float ${id}_m = mix(${id}_a, ${id}_b, ${id}_j);\n`,
      `            bool ${id}_cross = ${id}_ls >= ${id}_a && ${id}_ls < ${id}_b;\n`,
      `            if (${id}_cross && ${id}_ls < ${id}_m)\n`,
      sliceFace,
      uvtAt('            ', `${id}_w`, `(${id}_ro + ${id}_rd * ${id}_m)`),
      ...(keyMode === 'off'
        ? [`            vec3 ${id}_c = tcSample(${V}, ${lay}, ${inset}, ${id}_w);\n`]
        : [
          `            vec3 ${id}_c0, ${id}_c1;\n`,
          `            float ${id}_fw = tcFrames(${V}, ${lay}, ${inset}, ${id}_w, ${id}_c0, ${id}_c1);\n`,
          `            vec3 ${id}_c = mix(${id}_c0, ${id}_c1, ${id}_fw);\n`,
        ]),
      // Transfer function (lib/timeCube/plan.ts voxelOpacity): before / after the slice, dark is clear, the key.
      `            float ${id}_op = ${id}_w.z - ${sliceT(`${id}_w`)} < 0.0 ? ${p(P.before, 0.45)} : ${p(P.after, 1)};\n`,
      `            float ${id}_dc = ${p(P.darkClear, 0)};\n`,
      `            ${id}_op *= 1.0 - ${id}_dc + ${id}_dc * smoothstep(0.02, 0.4, dot(${id}_c, ${LUMA}));\n`,
      keyLines,
      `            float ${id}_al = 1.0 - exp(-tcDepth(${id}_op) * (${id}_b - ${id}_a) / ${id}_tl);\n`,
      `            ${id}_acc.rgb += (1.0 - ${id}_acc.a) * ${id}_al * ${look(`${id}_c`)};\n`,
      `            ${id}_acc.a += (1.0 - ${id}_acc.a) * ${id}_al;\n`,
      `            if (${id}_cross && ${id}_ls >= ${id}_m)\n`,
      sliceFace,
      `        }\n`,
      // Back edges: seen through whatever the march left clear.
      `        if (${id}_tf <= ${id}_scn) {\n`,
      `            vec3 ${id}_pb = ${id}_ro + ${id}_rd * ${id}_tf;\n`,
      edgeAt(`${id}_pb`, `${id}_tf`, `${id}_be`).replace(/^ {8}/gm, '            '),
      `            float ${id}_ba = ${id}_be * ${p(P.edgeOpacity, 0.85)};\n`,
      `            ${id}_acc.rgb += (1.0 - ${id}_acc.a) * ${id}_ba * ${edgeCol};\n`,
      `            ${id}_acc.a += (1.0 - ${id}_acc.a) * ${id}_ba;\n`,
      `        }\n`,
      `    }\n`,
      `    float ${id}_eo = ${id}_edge * ${p(P.edgeOpacity, 0.85)};\n`,
      `    vec3 ${id}_color = mix(${id}_acc.rgb + (1.0 - ${id}_acc.a) * ${bg}, ${edgeCol}, ${id}_eo);\n`,
      `    float ${id}_alpha = max(${id}_acc.a, ${id}_eo);\n`,
    ];
    return { code: lines.join(''), outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
  },
};

// ── Time Slice (2D) ──────────────────────────────────────────────────────────

export const TimeSliceNode: NodeDefinition = {
  type: TIME_SLICE_TYPE,
  label: 'Time Slice',
  category: 'Sources',
  aliases: ['Slit-scan', 'Time displacement', 'Time cut', 'Space-time slice', 'Video volume slice'],
  description: 'A flat cut through a Time Cube, as a picture: one frame, a tilted plane (time runs across the picture: slit-scan), one row or column of the video through time, or each pixel at its own moment (wire a Delay map).',
  inputs: {
    volume: { type: 'volume', label: 'Volume', hint: 'A Time Cube\'s Volume.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read. Unwired, the cut fills the picture.' },
    slice: { type: 'float', label: 'Offset', hint: 'Where the cut is in time (or which row / column), 0–1. Wire Time or an LFO here.' },
    delay: { type: 'float', label: 'Delay map', hint: 'A value per pixel (0–1, e.g. a gradient or noise): pushes each pixel that far back in time, times Delay amount.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The cut at this pixel.' },
    value: { type: 'float', label: 'Value', hint: 'Its brightness.' },
    time: { type: 'float', label: 'Time', hint: 'Where in the volume (0–1 in time) this pixel was read.' },
  },
  defaultParams: { slice: 0.5, mode: 'plane', tiltX: 0, tiltY: 0, delayAmount: 0.5, timeEdge: 'hold', brightness: 0, contrast: 1 },
  paramDefs: {
    slice: { label: 'Offset', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Where the cut is in time (Plane), or which row (Row through time) or column (Column through time).' },
    mode: { label: 'Cut', type: 'select', options: [
      { value: 'plane', label: 'Plane (a frame, tilt for slit-scan)' },
      { value: 'row', label: 'Row through time (time runs up)' },
      { value: 'column', label: 'Column through time (time runs right)' },
    ], hint: 'Which way to cut the box.' },
    tiltX: { label: 'Tilt X°', type: 'float', min: -75, max: 75, step: 0.5, showWhen: { param: 'mode', value: 'plane' }, hint: 'Time runs across the picture, left to right: each column from its own moment.' },
    tiltY: { label: 'Tilt Y°', type: 'float', min: -75, max: 75, step: 0.5, showWhen: { param: 'mode', value: 'plane' }, hint: 'Time runs from bottom to top.' },
    delayAmount: { label: 'Delay amount', type: 'float', min: -1, max: 1, step: 0.01, hint: 'How far back in time the Delay map pushes each pixel (only when a Delay map is wired).' },
    timeEdge: { label: 'Past the ends', type: 'select', options: [{ value: 'hold', label: 'Hold the first / last frame' }, { value: 'loop', label: 'Loop' }, { value: 'bounce', label: 'Bounce' }], hint: 'What a time before 0 or after 1 reads.' },
    brightness: { label: 'Brightness', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Added to the colour.' },
    contrast: { label: 'Contrast', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Spreads the colours from mid grey.' },
  },
  assignable: false,
  glslFunctions: [TC_TILE, TC_SAMPLE],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params;
    const V = inputVars.volume;
    if (!V) return { code: `    vec3 ${id}_color = vec3(0.0);\n    float ${id}_value = 0.0;\n    float ${id}_t = 0.0;\n`, outputVars: { color: `${id}_color`, value: `${id}_value`, time: `${id}_t` } };
    const slice = inputVars.slice ?? p(P.slice, 0.5);
    const mode = P.mode === 'row' || P.mode === 'column' ? P.mode : 'plane';
    const delay = inputVars.delay ? ` + ${inputVars.delay} * ${p(P.delayAmount, 0.5)}` : '';
    const edge = P.timeEdge === 'loop' ? `fract(${id}_t0)` : P.timeEdge === 'bounce' ? `1.0 - abs(1.0 - mod(${id}_t0, 2.0))` : `clamp(${id}_t0, 0.0, 1.0)`;
    const where = mode === 'row'
      ? [`    vec2 ${id}_fv = vec2(${id}_st.x, ${slice});\n`, `    float ${id}_t0 = ${id}_st.y${delay};\n`]
      : mode === 'column'
        ? [`    vec2 ${id}_fv = vec2(${slice}, ${id}_st.y);\n`, `    float ${id}_t0 = ${id}_st.x${delay};\n`]
        : [
          `    vec2 ${id}_fv = ${id}_st;\n`,
          `    float ${id}_t0 = ${slice} + tan(radians(clamp(${p(P.tiltX, 0)}, -85.0, 85.0))) * (${id}_st.x - 0.5) + tan(radians(clamp(${p(P.tiltY, 0)}, -85.0, 85.0))) * (${id}_st.y - 0.5)${delay};\n`,
        ];
    const code = [
      // Centred picture coordinates back to 0–1 over the frame (as Texture Input reads).
      `    vec2 ${id}_st = clamp(${inputVars.uv ?? 'g_uv'} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      ...where,
      `    float ${id}_t = ${edge};\n`,
      `    vec3 ${id}_color = clamp((tcSample(${V}, ${volLayout(V)}, ${volPx(V)}, vec3(${id}_fv, ${id}_t)) - 0.5) * ${p(P.contrast, 1)} + 0.5 + ${p(P.brightness, 0)}, 0.0, 1.0);\n`,
      `    float ${id}_value = dot(${id}_color, ${LUMA});\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_color`, value: `${id}_value`, time: `${id}_t` } };
  },
};
