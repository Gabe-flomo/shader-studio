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
 * Volume coordinate (u, v, t) of box point q (0–1³) for a stack axis, 0 depth (z), 1 width (x),
 * 2 height (y) (plan.ts boxToVolume), and back (tcBoxQ). The app's cameras (March Camera) put
 * screen right at −x looking down −z, so u runs toward −x: a frame reads the right way round from
 * the side time starts on. The axis is always a literal, so the compiler folds the choice.
 */
const TC_UVT = `vec3 tcUvt(vec3 q, float ax) {
    return ax < 0.5 ? vec3(1.0 - q.x, q.y, 1.0 - q.z) : ax < 1.5 ? vec3(q.z, q.y, 1.0 - q.x) : vec3(1.0 - q.x, 1.0 - q.z, 1.0 - q.y);
}
vec3 tcBoxQ(vec3 w, float ax) {
    return ax < 0.5 ? vec3(1.0 - w.x, w.y, 1.0 - w.z) : ax < 1.5 ? vec3(1.0 - w.z, w.y, w.x) : vec3(1.0 - w.x, 1.0 - w.z, 1.0 - w.y);
}`;

/** The shape (lib/timeCube/style.ts shapeDistance): a rounded box (rb.x) with puffed-out faces (rb.y). */
const TC_SHAPE = `float tcRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float tcShape(vec3 p, vec3 b, vec2 rb) {
    if (rb.y <= 0.0) return tcRoundBox(p, b, min(rb.x, min(b.x, min(b.y, b.z))));
    vec3 s = clamp(p / b, -1.0, 1.0);
    s *= s;
    vec3 bb = b + rb.y * vec3((1.0 - s.y) * (1.0 - s.z), (1.0 - s.x) * (1.0 - s.z), (1.0 - s.x) * (1.0 - s.y));
    return tcRoundBox(p, bb, min(rb.x, min(bb.x, min(bb.y, bb.z))));
}`;

/**
 * Highlights and frame motion (style.ts combDistance, bump, warpUv). hl = (start, spacing, count,
 * loop), in time; mv = (side, up, scale, turn).
 */
const TC_MOTION = `float tcComb(float g, vec4 hl) {
    float S = max(hl.y, 1e-4);
    float n = max(hl.z, 1.0);
    float x = g - hl.x;
    if (hl.w < 0.5) return x - clamp(floor(x / S + 0.5), 0.0, n - 1.0) * S;
    x = fract(x);
    float best = 1e9;
    for (int m = -1; m <= 1; m++) {
        float xm = x + float(m);
        float d = xm - clamp(floor(xm / S + 0.5), 0.0, n - 1.0) * S;
        if (abs(d) < abs(best)) best = d;
    }
    return best;
}
float tcBump(float d, float w) {
    return 0.5 + 0.5 * cos(3.14159265 * clamp(abs(d) / max(w, 1e-5), 0.0, 1.0));
}
vec3 tcWarp(vec3 w, float b, vec4 mv, float asp) {
    vec2 d = (w.xy - 0.5) * vec2(asp, 1.0) - mv.xy * b;
    d /= max(1.0 + mv.z * b, 0.05);
    float a = -mv.w * b;
    float c = cos(a), s = sin(a);
    d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    return vec3(d / vec2(asp, 1.0) + 0.5, w.z);
}
float tcShapeAt(vec3 p, vec3 B, vec2 rb, vec4 st, vec4 hl, vec4 mw, vec4 mv, float asp, out vec3 w, out float b) {
    w = tcUvt((p + B) * (0.5 / B), st.w);
    b = 0.0;
    if (mw.w < 0.5) return tcShape(p, B, rb);
    float g = w.z - st.y * (w.x - 0.5) - st.z * (w.y - 0.5);
    if (mw.x > 0.5) b = tcBump(g - st.x, mw.z);
    if (mw.y > 0.5) b = max(b, tcBump(tcComb(g, hl), mw.z));
    w = tcWarp(w, b, mv, asp);
    return tcShape((tcBoxQ(w, st.w) * 2.0 - 1.0) * B, B, rb);
}`;

/** Per-frame treatments (style.ts frameFx): fx = (hue turns along time, posterize levels, grey with age). */
const TC_FX = `vec3 tcHueTurn(vec3 c, float turns) {
    float a = 6.2831853 * turns;
    vec3 k = vec3(0.57735027);
    float cs = cos(a);
    return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}
vec3 tcFx(vec3 c, float t, float age, vec3 fx) {
    if (fx.x != 0.0) c = tcHueTurn(c, fx.x * t);
    if (fx.y >= 2.0) c = floor(c * (fx.y - 1.0) + 0.5) / (fx.y - 1.0);
    if (fx.z > 0.0) c = mix(c, vec3(dot(c, ${'vec3(0.299, 0.587, 0.114)'})), clamp(fx.z * age * 2.0, 0.0, 1.0));
    return clamp(c, 0.0, 1.0);
}`;

/**
 * Key pulse and lightning (style.ts pulseBand, lightningBurst). pp = (count, width, softness, phase):
 * bands of visibility along time. A burst: slot k of a clock running at ll.x a second (ll = rate,
 * seed, width, time); (centre, width, strength).
 */
const TC_PULSE = `float tcPulse(float x, vec4 pp) {
    float d = abs(fract(x * max(pp.x, 0.0) - pp.w) - 0.5) * 2.0;
    float w = clamp(pp.y, 0.001, 1.0);
    return 1.0 - smoothstep(w * (1.0 - clamp(pp.z, 0.0, 1.0)), w + 1e-4, d);
}
float tcHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
vec4 tcBurstAt(float k, vec4 ll) {
    float s = ll.w * max(ll.x, 0.01);
    float h0 = tcHash(k + ll.y * 17.17);
    float h1 = tcHash(k * 1.31 + ll.y * 3.7 + 11.0);
    float h2 = tcHash(k * 2.17 + ll.y * 5.3 + 23.0);
    float age = s - k - h0 * 0.5;
    float fire = step(h2, 0.8) * step(0.0, age);
    float flick = 0.55 + 0.45 * step(0.35, tcHash(floor(ll.w * 24.0) + k * 7.0));
    return vec4(h1, max(ll.z, 0.002) * (0.4 + 0.75 * h2), fire * exp(-max(age, 0.0) * 8.0) * flick, 0.0);
}
float tcBurst(float x, vec4 b) { return b.z * (1.0 - smoothstep(b.y * 0.35, b.y, abs(x - b.x))); }`;

/** Depth of field on the frames: four reads round the point, `r` across (frame units); one read when in focus. */
const TC_BLUR = `vec3 tcSampleBlur(sampler2D tex, vec4 lay, vec2 inset, vec3 q, vec2 r) {
    if (r.x + r.y < 2e-4) return tcSample(tex, lay, inset, q);
    vec3 c = tcSample(tex, lay, inset, q + vec3(r * vec2(0.35, 0.6), 0.0));
    c += tcSample(tex, lay, inset, q + vec3(r * vec2(-0.6, 0.35), 0.0));
    c += tcSample(tex, lay, inset, q + vec3(r * vec2(-0.35, -0.6), 0.0));
    c += tcSample(tex, lay, inset, q + vec3(r * vec2(0.6, -0.35), 0.0));
    return c * 0.25;
}`;

/** Closest approach of a ray to a segment: (distance, distance along the ray). */
const TC_RAYSEG = `float tcLine(float d, float px, float coc, float ew) {
    float hw = max(0.5 * ew, coc / max(px, 1e-7));
    return clamp(hw + 0.5 - d / max(px, 1e-7), 0.0, 1.0) * min(ew, 1.0) * (0.5 * ew + 0.5) / (hw + 0.5);
}
vec2 tcRaySeg(vec3 ro, vec3 rd, vec3 a, vec3 b) {
    vec3 ba = b - a, w = ro - a;
    float bb = dot(ba, ba), br = dot(ba, rd), wb = dot(w, ba), wr = dot(w, rd);
    float den = bb - br * br;
    float s = clamp(den > 1e-9 ? (wb - wr * br) / den : 0.0, 0.0, 1.0);
    float t = max(s * br - wr, 0.0);
    s = clamp((dot(ro + rd * t - a, ba)) / max(bb, 1e-9), 0.0, 1.0);
    return vec2(length(ro + rd * t - a - ba * s), t);
}`;

const axisOf = (v: unknown) => (v === 'x' || v === 'y' ? v : 'z');
const AXIS_CODE: Record<string, string> = { z: '0.0', x: '1.0', y: '2.0' };
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
  defaultParams: {
    source: 'demo', videoId: '', fileName: '', frames: 128, frameWidth: '256', start: 0, end: 0, spacing: 'count', step: 0.1,
    combine: 'pick', subFrames: 4, order: 'time', sortBy: 'brightness', invert: false, seed: 1, keyColor: [0.85, 0.12, 0.12], keyTolerance: 0.25,
  },
  paramDefs: {
    frames: { section: 'Stack', label: 'Frames', type: 'float', min: MIN_FRAMES, max: MAX_FRAMES, step: 1, hard: true, showWhen: { param: 'spacing', value: 'count' }, hint: 'How many frames to stack, spread evenly from Start to End.', help: 'How many frames to stack, spread evenly from Start to End. More frames make a smoother box but take longer to build and more memory (the card shows how much). Up to 256.' },
    spacing: { section: 'Stack', label: 'Spacing', type: 'select', options: [{ value: 'count', label: 'Spread a number of frames' }, { value: 'step', label: 'One frame every…' }], hint: 'Pick frames by count, or one every so many seconds.' },
    step: { section: 'Stack', label: 'Every (s)', type: 'float', min: 0.02, max: 2, step: 0.01, showWhen: { param: 'spacing', value: 'step' }, hint: 'Seconds between stacked frames.' },
    frameWidth: { section: 'Stack', label: 'Frame size', type: 'select', options: FRAME_WIDTHS.map(w => ({ value: String(w), label: `${w} px wide` })), hint: 'How wide each stacked frame is (the height follows the video\'s shape). Bigger is sharper and heavier.' },
    start: { section: 'Stack', label: 'Start (s)', type: 'float', min: 0, max: 60, step: 0.1, hint: 'Where in the video the stack begins.' },
    end: { section: 'Stack', label: 'End (s)', type: 'float', min: 0, max: 60, step: 0.1, hint: 'Where it ends. 0 = the end of the video.' },
    combine: { section: 'Frames from', label: 'Frames from', type: 'select', options: [
      { value: 'pick', label: 'Pick one frame' },
      { value: 'average', label: 'Average (long exposure)' },
      { value: 'max', label: 'Brightest (light trails)' },
      { value: 'min', label: 'Darkest' },
      { value: 'difference', label: 'Motion (only what moved)' },
      { value: 'median', label: 'Median (moving things vanish)' },
    ], hint: 'Each stacked frame is one frame of the video, or several from its slot of time combined.', help: 'Pick takes one frame per slot. The others read Sub-frames frames spread over the slot and combine them: Average is a long exposure (motion blur), Brightest keeps light trails, Darkest dark ones, Motion keeps only what changed, Median keeps what stayed put. They decode Sub-frames times as many frames (the card says how long that takes).' },
    subFrames: { section: 'Frames from', label: 'Sub-frames', type: 'float', min: 2, max: 16, step: 1, hard: true, showWhen: { param: 'combine', value: ['average', 'max', 'min', 'difference', 'median'] }, hint: 'Frames read for each stacked frame when combining.' },
    order: { section: 'Order', label: 'Frame order', type: 'select', options: [
      { value: 'time', label: 'Time' },
      { value: 'reverse', label: 'Reverse' },
      { value: 'shuffle', label: 'Shuffle' },
      { value: 'sort', label: 'Sort' },
    ], hint: 'The order the frames are stacked in. Changing it rearranges the frames already read: nothing is decoded again.' },
    sortBy: { section: 'Order', label: 'Sort by', type: 'select', showWhen: { param: 'order', value: 'sort' }, options: [
      { value: 'brightness', label: 'Brightness' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'motion', label: 'Motion (change from the frames either side)' },
      { value: 'key', label: 'Amount of a colour' },
    ], hint: 'What to sort by, lowest first.' },
    invert: { section: 'Order', label: 'Invert', type: 'bool', showWhen: { param: 'order', value: 'sort' }, hint: 'Highest first.' },
    seed: { section: 'Order', label: 'Seed', type: 'float', min: 0, max: 999, step: 1, showWhen: { param: 'order', value: 'shuffle' }, hint: 'A different seed, a different shuffle (the same seed always gives the same one).' },
    keyColor: { section: 'Order', label: 'Colour', type: 'vec3color', showWhen: { param: 'order', value: 'sort' }, hint: 'Sort by amount of a colour: the colour.' },
    keyTolerance: { section: 'Order', label: 'Colour tolerance', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'order', value: 'sort' }, hint: 'Sort by amount of a colour: how close counts.' },
  },
  assignable: false,
  declarationsFor: timeCubeDeclarations,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: { volume: `u_tex_${node.id}` } }),
};

// ── Time Cube View (3D) ──────────────────────────────────────────────────────

/** The view's defaults. The GLSL reads a missing setting (an older save) as its default. */
const VIEW_DEFAULTS = {
  timeMode: 'slice', slice: 0.5, framePos: 0.5, flowSpeed: 0.05, flowTime: 0, before: 0.45, after: 1, sliceOpacity: 1, tiltX: 0, tiltY: 0,
  roundness: 0.4, feather: 0.18, bulge: 0,
  rimStrength: 0.35, rimWidth: 0.08, rimColor: [0.78, 0.6, 1], tintAmount: 0, tintFrom: [1, 0.8, 0.55], tintTo: [0.7, 0.93, 0.75], tintAlong: 'diagonal',
  shadow: 0, shadowSoftness: 0.3, shadowGap: 0.06,
  highlights: false, motion: false, effects: false, dof: 'off',
  hlCount: 3, hlMode: 'loop', hlStart: 0, hlSpacing: 16, hlThickness: 1, hlOpacity: 0.9, hlTint: 0.25, hlColor: [1, 0.75, 0.35], hlEdge: 0.6, hlOthers: 1, sendThrough: 0,
  motionAt: 'slice', motionWidth: 10, liftUp: 0, liftSide: 0, frameScale: 0, frameTurn: 0, frameFade: 0,
  fxHue: 0, fxPosterize: 0, fxAgeGrey: 0,
  axis: 'z', depth: 1.6, size: 1, quality: 'good',
  brightness: 0, contrast: 1, darkClear: 0, background: [0.05, 0.05, 0.07],
  keyMode: 'off', keyColor: [0.85, 0.12, 0.12], keyTolerance: 0.08, lumaLo: 0.6, lumaHi: 1, keySoftness: 0.06, keyOpacity: 1, othersOpacity: 0.2, othersGrey: 0.5,
  keyHueShift: 0, keyHueDrift: 0, pulse: 0, pulseDir: 'forward', pulseSpeed: 0.25, pulsePhase: 0, pulseCount: 3, pulseWidth: 0.15, pulseSoftness: 0.5,
  lightning: 0, lightningRate: 2, lightningWidth: 0.15, lightningSeed: 1,
  blur: 0.5, focus: 1, maxBlur: 16,
  outline: 'off', edgeWidth: 1, edgeOpacity: 0.6, sliceEdge: 0, edgeColor: [0.92, 0.93, 0.96],
  camDist: 3.8, camAngle: 0.6, camElevation: 0.4, rotSpeed: 0, swing: 0, ortho: 0, fov: 1.8,
};

const VIEW_PARAMS: Record<string, ParamDef> = {
  timeMode:     { section: 'Slice', label: 'Time', type: 'select', options: [{ value: 'slice', label: 'Slice (Offset scans the box)' }, { value: 'flow', label: 'Flow (the video flows through the box)' }], hint: 'Slice: the box stands still and Offset moves the crisp frame through it. Flow: the crisp frame stays at Frame position and the video flows through the box past it, wrapping round.' },
  slice:        { section: 'Slice', label: 'Offset', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Where the slice sits in time: 0 the first frame, 1 the last. Wire Time or an LFO into it to sweep.' },
  framePos:     { section: 'Slice', label: 'Frame position', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'timeMode', value: 'flow' }, hint: 'Flow: where the crisp frame sits in the box, 0 the front (where time starts) to 1 the back.' },
  flowSpeed:    { section: 'Slice', label: 'Flow speed', type: 'float', min: -1, max: 1, step: 0.005, showWhen: { param: 'timeMode', value: 'flow' }, hint: 'Flow: how fast the video moves through the box, in clip lengths a second (0.05 plays the whole clip at the frame every 20 s). Negative runs it backwards.' },
  flowTime:     { section: 'Slice', label: 'Flow time', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'timeMode', value: 'flow' }, hint: 'Flow: an offset added to the flow, in clip lengths. Wire Time, an LFO or a Play control into it to drive the flow yourself (set Flow speed 0).' },
  before:       { section: 'Slice', label: 'Before opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frames before the slice are, looking through all of them: 0.2 lets most of what is behind show through.' },
  after:        { section: 'Slice', label: 'After opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frames after the slice are. 1 is a solid block whose sides show each frame\'s edge pixels through time.' },
  sliceOpacity: { section: 'Slice', label: 'Slice face', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frame at the slice is: 1 shows that frame crisply.' },
  tiltX:        { section: 'Slice', label: 'Tilt X°', type: 'float', min: -75, max: 75, step: 0.5, hint: 'Tilts the slice so time runs across the frame from left to right: the slit-scan look.' },
  tiltY:        { section: 'Slice', label: 'Tilt Y°', type: 'float', min: -75, max: 75, step: 0.5, hint: 'Tilts the slice so time runs from bottom to top.' },

  roundness:    { section: 'Shape', label: 'Corner roundness', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Rounds the box\'s corners and edges: 0 a sharp box, 1 a pill.' },
  feather:      { section: 'Shape', label: 'Edge softness', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Feathers the box\'s silhouette and the slice frame\'s border: 0 a crisp edge, higher a soft, blurry one.' },
  bulge:        { section: 'Shape', label: 'Bulge', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Puffs the faces out at their middles, like a cushion.' },

  rimStrength:  { section: 'Glow', label: 'Rim glow', type: 'float', min: 0, max: 1.5, step: 0.01, hint: 'A soft glow of the rim colour round the box\'s silhouette, inside and out. 0 turns it off.' },
  rimWidth:     { section: 'Glow', label: 'Rim width', type: 'float', min: 0.005, max: 0.5, step: 0.005, hint: 'How far the rim glow spreads, in frame heights.' },
  rimColor:     { section: 'Glow', label: 'Rim colour', type: 'vec3color', hint: 'The glow\'s colour.' },
  tintAmount:   { section: 'Glow', label: 'Side tint', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Mixes a two-colour gradient into the frames (not the slice frame): pastel sides with the picture crisp on the face.' },
  tintFrom:     { section: 'Glow', label: 'Tint from', type: 'vec3color', hint: 'The gradient\'s first colour.' },
  tintTo:       { section: 'Glow', label: 'Tint to', type: 'vec3color', hint: 'The gradient\'s second colour.' },
  tintAlong:    { section: 'Glow', label: 'Tint along', type: 'select', options: [{ value: 'diagonal', label: 'Diagonal' }, { value: 'time', label: 'Time (first to last frame)' }, { value: 'height', label: 'Height (bottom to top)' }], hint: 'Which way the tint\'s gradient runs.' },
  shadow:       { section: 'Glow', label: 'Shadow', type: 'float', min: 0, max: 1, step: 0.01, hint: 'A soft shadow on the ground beneath the box. 0 turns it off.' },
  shadowSoftness: { section: 'Glow', label: 'Shadow softness', type: 'float', min: 0.01, max: 1.5, step: 0.01, hint: 'How blurred the shadow is, in frame heights.' },
  shadowGap:    { section: 'Glow', label: 'Shadow gap', type: 'float', min: 0, max: 2, step: 0.01, hint: 'How far below the box the ground is, in frame heights.' },

  highlights:   { section: 'Highlights', label: 'Highlight frames', type: 'bool', hint: 'Turns highlighted frames on (one recompile; the sliders below are then live).' },
  hlCount:      { section: 'Highlights', label: 'Count', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 32, step: 1, hint: 'How many frames to highlight. 0 turns highlights off.' },
  hlMode:       { section: 'Highlights', label: 'Highlights move', type: 'select', showWhen: { param: 'highlights', value: 'true' }, options: [{ value: 'loop', label: 'With the slice, looping round' }, { value: 'follow', label: 'With the slice' }, { value: 'fixed', label: 'Fixed (from the first frame)' }], hint: 'Whether the highlighted frames travel with Offset; looping, they wrap round the box so as you scan they come round again and again.' },
  hlStart:      { section: 'Highlights', label: 'Start (frames)', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: -128, max: 128, step: 1, hint: 'The first highlighted frame: frames from the slice (or from the first frame, when Fixed).' },
  hlSpacing:    { section: 'Highlights', label: 'Spacing (frames)', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 1, max: 128, step: 1, hint: 'Frames from one highlighted frame to the next.' },
  hlThickness:  { section: 'Highlights', label: 'Thickness (frames)', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0.25, max: 16, step: 0.05, hint: 'How many frames thick each highlight is.' },
  hlOpacity:    { section: 'Highlights', label: 'Opacity', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'How solid a highlighted frame is, as a sheet: 1 hides what is behind it.' },
  hlTint:       { section: 'Highlights', label: 'Tint', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Mixes the highlight colour into the highlighted frames.' },
  hlColor:      { section: 'Highlights', label: 'Colour', type: 'vec3color', showWhen: { param: 'highlights', value: 'true' }, hint: 'The highlight colour (tint and outline).' },
  hlEdge:       { section: 'Highlights', label: 'Outline', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'A line round each highlighted frame, in the highlight colour.' },
  hlOthers:     { section: 'Highlights', label: 'Others', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Opacity of the frames that are not highlighted, times Before / After: lower makes the highlights stand alone.' },
  sendThrough:  { section: 'Highlights', label: 'Send through', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Sends the first highlighted frame\'s picture through the whole box: at 1 every frame is that one (a slit-scan of a single frame).' },

  motion:       { section: 'Frame motion', label: 'Move frames', type: 'bool', hint: 'Turns frame motion on (one recompile; the sliders below are then live).' },
  motionAt:     { section: 'Frame motion', label: 'Moves frames near', type: 'select', showWhen: { param: 'motion', value: 'true' }, options: [{ value: 'slice', label: 'The slice' }, { value: 'highlights', label: 'The highlighted frames' }, { value: 'both', label: 'Both' }], hint: 'Where the wave that moves frames sits. It travels with Offset.' },
  motionWidth:  { section: 'Frame motion', label: 'Falloff (frames)', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: 0.5, max: 128, step: 0.5, hint: 'How many frames either side the wave reaches, easing off.' },
  liftUp:       { section: 'Frame motion', label: 'Lift', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: -1, max: 1, step: 0.01, hint: 'Lifts the frames in the wave up (frame heights).' },
  liftSide:     { section: 'Frame motion', label: 'Lift sideways', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: -1, max: 1, step: 0.01, hint: 'Moves them sideways (frame heights).' },
  frameScale:   { section: 'Frame motion', label: 'Scale', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: -0.9, max: 2, step: 0.01, hint: 'Grows (or shrinks) them: 0.5 makes the frame at the top of the wave half as big again.' },
  frameTurn:    { section: 'Frame motion', label: 'Turn°', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: -180, max: 180, step: 0.5, hint: 'Turns them in their own plane.' },
  frameFade:    { section: 'Frame motion', label: 'Fade', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Fades them out: 1 makes the frame at the top of the wave clear.' },

  effects:      { section: 'Frame effects', label: 'Frame effects', type: 'bool', hint: 'Turns the per-frame effects on (one recompile; the sliders below are then live).' },
  fxHue:        { section: 'Frame effects', label: 'Hue across time', type: 'float', showWhen: { param: 'effects', value: 'true' }, min: -2, max: 2, step: 0.01, hint: 'Turns each frame\'s hue by its time: 1 goes once round the colour wheel from first frame to last.' },
  fxPosterize:  { section: 'Frame effects', label: 'Posterize', type: 'float', showWhen: { param: 'effects', value: 'true' }, min: 0, max: 16, step: 1, hint: 'Levels per colour channel: 2 to 16. 0 (or 1) is off.' },
  fxAgeGrey:    { section: 'Frame effects', label: 'Grey with age', type: 'float', showWhen: { param: 'effects', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Drains the colour from frames older than the slice, more the older they are.' },

  axis:         { section: 'Box', label: 'Stack along', type: 'select', options: [{ value: 'z', label: 'Depth (frames one behind another)' }, { value: 'x', label: 'Width (frames side by side)' }, { value: 'y', label: 'Height (frames stacked up)' }], hint: 'Which way time runs through the box.' },
  depth:        { section: 'Box', label: 'Time stretch', type: 'float', min: 0.1, max: 6, step: 0.01, hint: 'How long the box is in time, against the frame\'s height of 1.' },
  size:         { section: 'Box', label: 'Box size', type: 'float', min: 0.1, max: 4, step: 0.01, hint: 'Scales the whole box.' },
  quality:      { section: 'Box', label: 'Quality', type: 'select', options: [{ value: 'draft', label: 'Draft (96 steps)' }, { value: 'good', label: 'Good (160 steps)' }, { value: 'best', label: 'Best (288 steps)' }], hint: 'Samples along each ray. More is smoother through time and slower.' },

  brightness:   { section: 'Look', label: 'Brightness', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Added to every frame\'s colour.' },
  contrast:     { section: 'Look', label: 'Contrast', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Spreads the colours away from mid grey (1 = as they are).' },
  darkClear:    { section: 'Look', label: 'Dark is clear', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Above 0 makes dark pixels see-through (footage on black); below 0 makes light pixels see-through (footage on white, or a light background).' },
  background:   { section: 'Look', label: 'Background', type: 'vec3color', hint: 'Behind the box (unless something is wired to Background).' },

  keyMode:      { section: 'Colour key', label: 'Key', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'color', label: 'A colour' }, { value: 'hue', label: 'A hue (any brightness)' }, { value: 'luma', label: 'A brightness range' }], hint: 'Pick out a colour: what matches stays solid through time, everything else fades.' },
  keyColor:     { section: 'Colour key', label: 'Key colour', type: 'vec3color', showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'The colour (or hue) to keep.' },
  keyTolerance: { section: 'Colour key', label: 'Tolerance', type: 'float', min: 0, max: 1, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'How far from the key colour still counts as a match.' },
  lumaLo:       { section: 'Colour key', label: 'Brightness from', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: 'luma' }, pair: { with: 'lumaHi', label: 'Brightness range' }, hint: 'Darkest brightness kept.' },
  lumaHi:       { section: 'Colour key', label: 'Brightness to', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: 'luma' }, hint: 'Brightest brightness kept.' },
  keySoftness:  { section: 'Colour key', label: 'Softness', type: 'float', min: 0, max: 0.5, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'A soft edge to the match.' },
  keyOpacity:   { section: 'Colour key', label: 'Key opacity', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'How solid the matching colour is, before and after the slice alike: 1 leaves a solid trail.' },
  othersOpacity:{ section: 'Colour key', label: 'Others', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Opacity of everything else, times Before / After: low makes the rest ghostly.' },
  keyHueShift:  { section: 'Colour key', label: 'Key hue shift', type: 'float', min: -1, max: 1, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'Turns the key colour round the colour wheel (1 = once round). Map it to an LFO or a knob on Play to sweep which colour is kept.' },
  keyHueDrift:  { section: 'Colour key', label: 'Key hue drift', type: 'float', min: -1, max: 1, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'Turns the key colour round the wheel on its own, in turns a second.' },
  pulse:        { section: 'Colour key', label: 'Pulse', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Shows the keyed colour only in bands that travel through time. 0: all of it at once.' },
  pulseDir:     { section: 'Colour key', label: 'Pulse direction', type: 'select', options: [{ value: 'forward', label: 'Forward (first to last frame)' }, { value: 'backward', label: 'Backward' }, { value: 'bounce', label: 'Back and forth' }, { value: 'outward', label: 'Out from the slice' }], showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Which way the pulse travels.' },
  pulseSpeed:   { section: 'Colour key', label: 'Pulse speed', type: 'float', min: -4, max: 4, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Bands a second.' },
  pulsePhase:   { section: 'Colour key', label: 'Pulse phase', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Moves the bands by hand (or from an LFO or Play): one band spacing across 0–1.' },
  pulseCount:   { section: 'Colour key', label: 'Pulse count', type: 'float', min: 1, max: 16, step: 1, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'How many bands at once along the box.' },
  pulseWidth:   { section: 'Colour key', label: 'Pulse width', type: 'float', min: 0.01, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'How much of the space between bands each band fills.' },
  pulseSoftness:{ section: 'Colour key', label: 'Pulse softness', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Soft (1) or hard (0) band edges.' },
  lightning:    { section: 'Colour key', label: 'Lightning', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Sharp, short flashes of the keyed colour through random stretches of time. Up to 0.5 they come in on top; from 0.5 to 1 the rest of the key fades, so at 1 only the flashes show it.' },
  lightningRate:{ section: 'Colour key', label: 'Flashes a second', type: 'float', min: 0.1, max: 20, step: 0.1, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'How often a flash can strike.' },
  lightningWidth:{ section: 'Colour key', label: 'Flash width', type: 'float', min: 0.01, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'How much of the box (in time) a flash lights.' },
  lightningSeed:{ section: 'Colour key', label: 'Flash seed', type: 'float', min: 0, max: 100, step: 1, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'A different seed, a different pattern of flashes.' },
  othersGrey:   { section: 'Colour key', label: 'Others grey', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Drains the colour from everything that doesn\'t match.' },

  outline:      { section: 'Outline', label: 'Outline', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'silhouette', label: 'Silhouette (follows the soft shape)' }, { value: 'edges', label: 'Box edges (wireframe)' }], hint: 'A thin line round the box: its outer silhouette, or all twelve edges (the back ones behind the frames).' },
  edgeWidth:    { section: 'Outline', label: 'Line width', type: 'float', min: 0, max: 6, step: 0.1, hint: 'Thickness of the lines in pixels (the outline, the slice outline and the highlight outlines). 0 hides them.' },
  edgeOpacity:  { section: 'Outline', label: 'Line opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How strong the outline is.' },
  sliceEdge:    { section: 'Outline', label: 'Slice outline', type: 'float', min: 0, max: 1, step: 0.01, hint: 'A line round the slice frame.' },
  edgeColor:    { section: 'Outline', label: 'Line colour', type: 'vec3color', hint: 'Colour of the outline and the slice outline.' },

  dof:          { section: 'Focus', label: 'Depth of field', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'distance', label: 'Focus at a distance' }, { value: 'slice', label: 'Focus on the slice (follows the scan)' }], hint: 'Blurs frames nearer and further than the focus, like a camera lens (as Frame Stack\'s). Choosing it recompiles once; the sliders are then live.' },
  blur:         { section: 'Focus', label: 'Blur', type: 'float', showWhen: { param: 'dof', value: ['distance', 'slice'] }, min: 0, max: 2, step: 0.01, hint: 'Depth of field: frames and edges away from Focus go soft. 0 turns it off.' },
  focus:        { section: 'Focus', label: 'Focus', type: 'float', showWhen: { param: 'dof', value: ['distance', 'slice'] }, min: 0.05, max: 3, step: 0.01, hint: 'Where the picture is sharp, as a share of the distance to the box\'s middle (or to the slice): 1 right on it, 0.8 nearer the camera, 1.2 beyond.' },
  maxBlur:      { section: 'Focus', label: 'Max blur', type: 'float', showWhen: { param: 'dof', value: ['distance', 'slice'] }, min: 1, max: 48, step: 0.5, hint: 'The most anything blurs, in pixels.' },

  camDist:      { section: 'Camera', label: 'Cam Distance', type: 'float', min: 0.5, max: 20, step: 0.05, hint: 'How far the built-in camera is from the box (when Ray Origin / Ray Dir are not wired).' },
  camAngle:     { section: 'Camera', label: 'Angle', type: 'float', min: -6.28, max: 6.28, step: 0.01, hint: 'Orbit angle round the box, in radians.' },
  camElevation: { section: 'Camera', label: 'Elevation', type: 'float', min: -1.5, max: 1.5, step: 0.01, hint: 'Height of the camera: 0 level, up to 1.5 looking straight down. 0.62 is the isometric angle.' },
  rotSpeed:     { section: 'Camera', label: 'Orbit speed', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Turns the camera round the box over time (radians a second); with Swing, how fast it swings.' },
  swing:        { section: 'Camera', label: 'Swing', type: 'float', min: 0, max: 3.14, step: 0.01, hint: 'Above 0 the camera swings back and forth by this much (radians) instead of going all the way round.' },
  ortho:        { section: 'Camera', label: 'Flatten (isometric)', type: 'float', min: 0, max: 1, step: 0.01, hint: 'From perspective (0) to orthographic (1): parallel edges stay parallel, like an isometric drawing.' },
  fov:          { section: 'Camera', label: 'Zoom', type: 'float', min: 0.5, max: 5, step: 0.01, hint: 'Lens length: higher is zoomed in, with less perspective. With a March Camera wired, set it to that camera\'s FOV so lines stay the same width.' },
};

/** The axes across a frame (not time), per stack axis: the march's box grows along them for moved frames. */
const PERP: Record<string, string> = { z: 'vec3(1.0, 1.0, 0.0)', x: 'vec3(0.0, 1.0, 1.0)', y: 'vec3(1.0, 0.0, 1.0)' };

export const TimeCubeViewNode: NodeDefinition = {
  type: TIME_CUBE_VIEW_TYPE,
  label: 'Time Cube View',
  category: '3D Scene',
  aliases: ['Video volume render', 'Space-time cube', 'Volume render', 'Time box', 'Video pill'],
  description: 'Draws a Time Cube as a soft, rounded box in 3D: earlier frames see-through, later ones solid, the frame at the slice crisp. Rim glow, side tint and shadow; highlighted frames that travel and loop as you scan; frames that lift, scale and fade as the slice passes. Has its own orbit camera, or takes a March Camera\'s rays to sit in a 3D scene.',
  brief: {
    summary: 'A video as a box of time, ray-marched front to back. The slice (Offset) splits it: frames before it are see-through, frames after it solid, and the frame at the slice shows crisply. Shape and Glow set the look; Highlights pick out frames; Frame motion lifts frames as the slice passes.',
    start: [
      'Wire a Time Cube\'s Volume in and the Color out to the Output.',
      'Drag Offset, or wire an LFO (amplitude 0.5, offset 0.5) into it to sweep through time.',
      'Shape: Corner roundness and Edge softness. Glow: a rim, a pastel side tint, a shadow; set Background light for the soft-pill look.',
      'Highlights: Count above 0 picks out frames Spacing apart; they travel with Offset and loop round. Frame motion: Lift moves frames up as the slice passes.',
      'To place it in a raymarched scene: wire a March Camera\'s Ray Origin and Ray Dir in, the March Loop\'s Color into Background and its Distance into Scene distance.',
    ],
  },
  inputs: {
    volume: { type: 'volume', label: 'Volume', hint: 'A Time Cube\'s Volume.' },
    slice: { type: 'float', label: 'Offset', hint: 'Where the slice is in time, 0–1. Wire Time or an LFO here to sweep.' },
    flowTime: { type: 'float', label: 'Flow time', hint: 'Flow mode: drives the flow (in clip lengths), added to Flow speed × time.' },
    ro: { type: 'vec3', label: 'Ray Origin', hint: 'A March Camera\'s Ray Origin. Unwired: the built-in orbit camera.' },
    rd: { type: 'vec3', label: 'Ray Dir', hint: 'A March Camera\'s Ray Dir.' },
    background: { type: 'vec3', label: 'Background', hint: 'What is behind the box: e.g. a March Loop\'s Color, so the box sits in that scene.' },
    sceneDist: { type: 'float', label: 'Scene distance', hint: 'A March Loop\'s Distance (with the same camera): scene surfaces nearer than the box hide it.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The box over the background.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'How much of this pixel the box covers, with its glow, outline and shadow.' },
  },
  defaultParams: { ...VIEW_DEFAULTS },
  paramDefs: VIEW_PARAMS,
  assignable: false,
  glslFunctions: [TC_TILE, TC_SAMPLE, TC_FRAMES, TC_DEPTH, TC_HUESAT, TC_KEY, TC_UVT, TC_SHAPE, TC_MOTION, TC_FX, TC_PULSE, TC_BLUR, TC_RAYSEG],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params;
    const D = VIEW_DEFAULTS as Record<string, unknown>;
    const f = (k: string) => p(P[k], D[k] as number);
    const c3 = (k: string) => pv3(P[k], D[k] as number[]);
    const V = inputVars.volume;
    const bg = inputVars.background ?? c3('background');
    if (!V) {
      return { code: `    vec3 ${id}_color = ${bg};\n    float ${id}_alpha = 0.0;\n`, outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
    }
    const axis = axisOf(P.axis);
    const AX = AXIS_CODE[axis];
    const steps = STEPS[String(P.quality)] ?? STEPS.good;
    const keyMode = P.keyMode === 'color' || P.keyMode === 'hue' || P.keyMode === 'luma' ? P.keyMode : 'off';
    const hlMode = P.hlMode === 'follow' || P.hlMode === 'fixed' ? P.hlMode : 'loop';
    const motionAt = P.motionAt === 'highlights' || P.motionAt === 'both' ? P.motionAt : 'slice';
    const tintAlong = P.tintAlong === 'time' || P.tintAlong === 'height' ? P.tintAlong : 'diagonal';
    const outline = P.outline === 'silhouette' || P.outline === 'edges' ? P.outline : 'off';
    const flow = P.timeMode === 'flow';
    const pulseDir = P.pulseDir === 'backward' || P.pulseDir === 'bounce' || P.pulseDir === 'outward' ? P.pulseDir : 'forward';
    // Optional features are switched on by a toggle (one recompile); their sliders are then live. Off,
    // their code is left out of the march, which keeps the plain view as fast as it was.
    const HL = P.highlights === true, MOT = P.motion === true, FX = P.effects === true, DOF = P.dof === 'distance' || P.dof === 'slice';
    const lay = volLayout(V), inset = volPx(V);
    const slice = inputVars.slice ?? f('slice');
    const wired = !!(inputVars.ro && inputVars.rd);
    const look = (c: string) => `clamp((${c} - 0.5) * ${f('contrast')} + 0.5 + ${f('brightness')}, 0.0, 1.0)`;
    const edgeCol = c3('edgeColor');
    const timeLen = axis === 'x' ? '$_B.x' : axis === 'y' ? '$_B.y' : '$_B.z';
    const half = axis === 'x' ? 'vec3($_dep, 1.0, $_asp)' : axis === 'y' ? 'vec3($_asp, $_dep, 1.0)' : 'vec3($_asp, 1.0, $_dep)';
    /** The shape at a point, with frame motion; `w` (the volume point to read) and `b` (the bump) must be declared. */
    const shapeAt = (pt: string, w: string, b: string) => `tcShapeAt(${pt}, $_B, $_rb, $_st, $_hl, $_mw, $_mv, $_asp, ${w}, ${b})`;
    /** A pixel's width in world units at distance t along the ray (perspective, or flat when orthographic). */
    const pixAt = (t: string) => `($_pix * (${t} * (1.0 - $_or) + $_cd * $_or))`;
    /** The clip time read at box time z: z itself, or in Flow the video moved through the box (style.ts flowTime). */
    const tmap = (z: string) => (flow ? `fract(${z} + $_fsh)` : z);
    /** Depth of field: the blur's radius (world units) at distance t along the ray, capped at Max blur. */
    const cocAt = (t: string) => (DOF ? `min($_ap * abs(${t} - $_F) / max($_F, 1e-3), $_mxb * ${pixAt(t)})` : '0.0');
    /** The time to read at box time z: mapped (Flow), then sent through (the first highlighted frame's picture). */
    const timeAt = (z: string) => (HL ? `mix(${tmap(z)}, $_sendT, $_send)` : tmap(z));
    /** The volume at a frame point `w`, blurred by the depth of field at distance t along the ray. */
    const sampleAt = (w: string, t: string) => (DOF
      ? `tcSampleBlur(${V}, ${lay}, ${inset}, vec3(${w}.xy, ${timeAt(`${w}.z`)}), ${cocAt(t)} * $_ruv)`
      : `tcSample(${V}, ${lay}, ${inset}, vec3(${w}.xy, ${timeAt(`${w}.z`)}))`);
    /** Per-frame effects on a colour, when on. */
    const fxOn = (c: string, t: string, age: string) => (FX ? `tcFx(${c}, ${t}, ${age}, $_fx)` : c);
    /** Frame motion's fade, when on. */
    const fadeBy = (b: string) => (MOT ? ` * (1.0 - $_fade * ${b})` : '');
    /**
     * Where the ray meets a box of half size `bx` (sphere tracing in from the search box's entry and back
     * from its exit: the rounded box's distance is exact, so a few steps land on the surface), into
     * `en` / `ex`. With `md` / `tS`, also the least distance to it along the ray (minus how deep, when
     * the ray goes in): a miss reads it off the trace, which slows near the shape; a ray that goes in
     * only shallowly (near the silhouette) refines it by golden-section search between entry and exit
     * (the distance along a line to a convex shape has one minimum). Deep rays need no more.
     */
    const trace = (bx: string, en: string, ex: string, md?: string, tS?: string) => {
      const at = (t: string) => `tcShape($_ro + $_rd * ${t}, ${bx}, $_rb)`;
      return [
        '    {\n',
        '        float $_t = $_t0, $_mn = 1e3, $_tn = $_t0;\n',
        '        for (int $_i = 0; $_i < 32; $_i++) {\n',
        `            float $_d = ${at('$_t')};\n`,
        '            if ($_d < $_mn) { $_mn = $_d; $_tn = $_t; }\n',
        '            if ($_d < 1e-4 || $_t > $_t1) break;\n',
        '            $_t += max($_d * $_ks, 1e-4);\n',
        '        }\n',
        ...(md ? [`        ${md} = $_mn; ${tS} = $_tn;\n`] : []),
        '        if ($_mn < 1e-4) {\n',
        `            ${en} = $_t;\n`,
        '            float $_u = $_t1;\n',
        '            for (int $_i = 0; $_i < 32; $_i++) {\n',
        `                float $_d = ${at('$_u')};\n`,
        `                if ($_d < 1e-4 || $_u < ${en}) break;\n`,
        '                $_u -= max($_d * $_ks, 1e-4);\n',
        '            }\n',
        `            ${ex} = max($_u, ${en});\n`,
        ...(md ? [
          `            float $_ga = ${en}, $_gb = ${ex};\n`,
          `            ${tS} = 0.5 * ($_ga + $_gb);\n`,
          `            ${md} = ${at(tS!)};\n`,
          `            if (-${md} < $_mg) {\n`,
          '                float $_gc = $_gb - 0.618034 * ($_gb - $_ga), $_gd = $_ga + 0.618034 * ($_gb - $_ga);\n',
          `                float $_fc = ${at('$_gc')}, $_fd = ${at('$_gd')};\n`,
          '                for (int $_i = 0; $_i < 10; $_i++) {\n',
          `                    if ($_fc < $_fd) { $_gb = $_gd; $_gd = $_gc; $_fd = $_fc; $_gc = $_gb - 0.618034 * ($_gb - $_ga); $_fc = ${at('$_gc')}; }\n`,
          `                    else { $_ga = $_gc; $_gc = $_gd; $_fc = $_fd; $_gd = $_ga + 0.618034 * ($_gb - $_ga); $_fd = ${at('$_gd')}; }\n`,
          '                }\n',
          `                ${tS} = $_fc < $_fd ? $_gc : $_gd;\n`,
          `                ${md} = min($_fc, $_fd);\n`,
          '            }\n',
        ] : []),
        '        }\n',
        '    }\n',
      ].join('');
    };
    /** The soft-edge weight of a point with frames moved: the box's coverage inside the box, 1 for frames moved out of it. */
    const coverAt = (pt: string) => (MOT ? `($_cvIn < 0.999 && tcShape(${pt}, $_B, $_rb) >= 0.0 ? 1.0 : $_cvIn)` : '1.0');
    const camera = wired
      ? [
        `    vec3 $_ro = ${inputVars.ro};\n`,
        `    vec3 $_rd = normalize(${inputVars.rd});\n`,
        '    float $_or = 0.0;\n',
        '    float $_cd = 0.0;\n',
      ]
      : [
        // The March Camera's orbit, aimed at the box's centre; Swing turns the orbit into a back-and-forth.
        `    float $_sw = max(${f('swing')}, 0.0);\n`,
        `    float $_ang = ${f('camAngle')} + ($_sw > 0.0 ? $_sw * sin(u_time * ${f('rotSpeed')}) : u_time * ${f('rotSpeed')});\n`,
        `    float $_elev = ${f('camElevation')};\n`,
        '    vec3 $_hz = vec3(sin($_ang), 0.0, cos($_ang));\n',
        `    float $_cd = ${f('camDist')};\n`,
        '    vec3 $_ro = $_cd * (cos($_elev) * $_hz + sin($_elev) * vec3(0.0, 1.0, 0.0));\n',
        '    vec3 $_fw = normalize(-$_ro);\n',
        '    vec3 $_cu = normalize(-sin($_elev) * $_hz + cos($_elev) * vec3(0.0, 1.0, 0.0));\n',
        '    vec3 $_rt = normalize(cross($_cu, $_fw));\n',
        `    vec3 $_lat = ${inputVars.uv ?? 'g_uv'}.x * $_rt + ${inputVars.uv ?? 'g_uv'}.y * cross($_fw, $_rt);\n`,
        // Flatten: the rays' origins spread across the picture and their directions close up; the box keeps its size.
        `    float $_or = clamp(${f('ortho')}, 0.0, 1.0);\n`,
        `    $_ro += $_or * $_cd / max(${f('fov')}, 0.05) * $_lat;\n`,
        `    vec3 $_rd = normalize(max(${f('fov')}, 0.05) * $_fw + (1.0 - $_or) * $_lat);\n`,
      ];
    const keyOf = (c: string) => keyMode === 'color' ? `tcKeyColor(${c}, $_kc, ${f('keyTolerance')}, ${f('keySoftness')})`
      : keyMode === 'hue' ? `tcKeyHue(${c}, $_kc, ${f('keyTolerance')}, ${f('keySoftness')})`
      : `tcKeyLuma(${c}, ${f('lumaLo')}, ${f('lumaHi')}, ${f('keySoftness')})`;
    const keyLines = keyMode === 'off' ? '' : [
      // Each frame keyed on its own, the matches blended (tcFrames).
      `            float $_k = mix(${keyOf('$_c0')}, ${keyOf('$_c1')}, $_fwt);\n`,
      // Pulse: the keyed colour shows in bands travelling through time; lightning: in short flashes.
      `            float $_kv = mix(1.0, tcPulse(${pulseDir === 'backward' ? '1.0 - $_gv' : pulseDir === 'outward' ? 'abs($_gv - $_sl0)' : '$_gv'}, $_pp), $_pls);\n`,
      '            if ($_lt > 0.0) $_kv = max($_kv * (1.0 - clamp(2.0 * $_lt - 1.0, 0.0, 1.0)), min(2.0 * $_lt, 1.0) * max(tcBurst($_gv, $_lb0), tcBurst($_gv, $_lb1)));\n',
      `            $_op = $_op * ${f('othersOpacity')} * (1.0 - $_k) + ${f('keyOpacity')} * $_kv * $_k;\n`,
      `            $_c = mix($_c, vec3(dot($_c, ${LUMA})), ${f('othersGrey')} * (1.0 - $_k));\n`,
    ].join('');
    const tintCoord = tintAlong === 'time' ? '$_wv.z' : tintAlong === 'height' ? '$_qv.y' : 'clamp(0.5 * ($_qv.y + $_wv.z), 0.0, 1.0)';
    // The frame at the slice, where the ray crosses the plane (exactly, not at a step): worked out once,
    // before the march, as premultiplied colour and alpha; the march composites it in order.
    const sliceFacePre = [
      '        vec4 $_sf = vec4(0.0);\n',
      '        if ($_ls >= 0.0) {\n',
      '            vec3 $_ps = $_ro + $_rd * $_ls;\n',
      '            vec3 $_ws; float $_bs;\n',
      `            float $_ds = ${shapeAt('$_ps', '$_ws', '$_bs')};\n`,
      `            vec3 $_sc = ${fxOn(look(sampleAt('$_ws', '$_ls')), tmap('$_ws.z'), '0.0')};\n`,
      `            float $_spx = ${pixAt('$_ls')};\n`,
      // Inside the shape, its border feathered by the Edge softness (or the depth of field's blur): the frame fades into the sides.
      `            float $_sin = 1.0 - smoothstep(-max(max($_fe, ${cocAt('$_ls')}), $_spx), 0.5 * $_spx, $_ds);\n`,
      `            float $_so = $_ew > 0.0 ? clamp(${f('sliceEdge')}, 0.0, 1.0) * (1.0 - smoothstep(0.5 * $_ew * $_spx, (0.5 * $_ew + 1.0) * $_spx, abs($_ds))) : 0.0;\n`,
      `            float $_sa = max(clamp(${f('sliceOpacity')}, 0.0, 1.0) * $_sin${fadeBy('$_bs')}, $_so) * ${coverAt('$_ps')};\n`,
      `            $_sf = vec4(mix($_sc, ${edgeCol}, $_so / max($_sa, 1e-4)) * $_sa, $_sa);\n`,
      '        }\n',
    ].join('');
    const sliceFace = '            { $_acc.rgb += (1.0 - $_acc.a) * $_sf.rgb; $_acc.a += (1.0 - $_acc.a) * $_sf.a; }\n';
    // Highlighted frames: the part of this step inside the nearest one dims Others less; crossing
    // it composites the frame as a sheet, read crisply at its own time (lib/timeCube/style.ts stepInHighlight).
    const highlight = !HL ? '' : [
      '            float $_ah = 0.0;\n',
      '            vec3 $_hc = vec3(0.0);\n',
      '            if ($_hlOn > 0.5) {\n',
      '                float $_g1 = $_gA + $_gS * ($_ta - $_en);\n',
      '                float $_g2 = $_gA + $_gS * ($_tb - $_en);\n',
      '                float $_lo = min($_g1, $_g2), $_hi = max($_g1, $_g2), $_gm = 0.5 * ($_lo + $_hi);\n',
      '                float $_cg = $_gm - tcComb($_gm, $_hl);\n',
      '                float $_ov = max(min($_hi, $_cg + $_hw) - max($_lo, $_cg - $_hw), 0.0);\n',
      '                float $_fr = $_hi - $_lo > 1e-6 ? $_ov / ($_hi - $_lo) : step(abs($_gm - $_cg), $_hw);\n',
      `                $_op *= mix(clamp(${f('hlOthers')}, 0.0, 1.0), 1.0, $_fr);\n`,
      '                float $_cr = min($_ov / (2.0 * $_hw), 1.0);\n',
      '                if ($_cr > 0.0) {\n',
      '                    float $_tc = abs($_gS) > 1e-6 ? clamp($_en + ($_cg - $_gA) / $_gS, $_ta, $_tb) : $_tm;\n',
      '                    vec3 $_pc = $_ro + $_rd * $_tc;\n',
      '                    vec3 $_wc; float $_bc;\n',
      `                    float $_dc = ${shapeAt('$_pc', '$_wc', '$_bc')};\n`,
      `                    $_hc = mix(${fxOn(look(`tcSample(${V}, ${lay}, ${inset}, vec3($_wc.xy, ${timeAt('$_wc.z')}))`), tmap('$_wc.z'), 'max($_sl0 - $_cg, 0.0)')}, ${c3('hlColor')}, clamp(${f('hlTint')}, 0.0, 1.0));\n`,
      `                    float $_cpx = ${pixAt('$_tc')};\n`,
      '                    float $_hin = 1.0 - smoothstep(-$_cpx, $_cpx, $_dc);\n',
      `                    float $_hol = $_ew > 0.0 ? clamp(${f('hlEdge')}, 0.0, 1.0) * (1.0 - smoothstep(0.5 * $_ew * $_cpx, (0.5 * $_ew + 1.0) * $_cpx, abs($_dc))) : 0.0;\n`,
      `                    $_hc = mix($_hc, ${c3('hlColor')}, $_hol);\n`,
      `                    $_ah = $_cr * max(clamp(${f('hlOpacity')}, 0.0, 1.0) * $_hin, $_hol)${fadeBy('$_bc')} * ${coverAt('$_pc')};\n`,
      '                }\n',
      '            }\n',
    ].join('');
    const edgesBlock = outline !== 'edges' ? '' : [
      // The twelve edges (through the middle of each rounded edge), as lines a set number of pixels wide
      // wherever they are: anti-aliased, steady as the camera turns. Behind the box's middle, a back edge.
      '    {\n',
      '        float $_er = min($_rb.x, $_mnB);\n',
      '        vec3 $_EL = $_B - 0.6 * $_er;\n',
      '        vec3 $_EX = $_B - 0.29289322 * $_er;\n',
      '        float $_tmid = 0.5 * ($_en + $_ex);\n',
      '        for (int $_k = 0; $_k < 12; $_k++) {\n',
      '            int $_kj = $_k - 4 * ($_k / 4);\n',
      '            float $_s1 = ($_kj == 1 || $_kj == 3) ? -1.0 : 1.0;\n',
      '            float $_s2 = $_kj >= 2 ? -1.0 : 1.0;\n',
      '            vec3 $_e0, $_e1;\n',
      '            if ($_k < 4) { $_e0 = vec3(-$_EL.x, $_s1 * $_EX.y, $_s2 * $_EX.z); $_e1 = vec3($_EL.x, $_s1 * $_EX.y, $_s2 * $_EX.z); }\n',
      '            else if ($_k < 8) { $_e0 = vec3($_s1 * $_EX.x, -$_EL.y, $_s2 * $_EX.z); $_e1 = vec3($_s1 * $_EX.x, $_EL.y, $_s2 * $_EX.z); }\n',
      '            else { $_e0 = vec3($_s1 * $_EX.x, $_s2 * $_EX.y, -$_EL.z); $_e1 = vec3($_s1 * $_EX.x, $_s2 * $_EX.y, $_EL.z); }\n',
      '            vec2 $_sg = tcRaySeg($_ro, $_rd, $_e0, $_e1);\n',
      `            float $_lc = $_sg.y > $_scn ? 0.0 : tcLine($_sg.x, ${pixAt('$_sg.y')}, ${cocAt('$_sg.y')}, $_ew);\n`,
      '            if ($_md >= 0.0 || $_sg.y < $_tmid) $_eF = max($_eF, $_lc); else $_eB = max($_eB, $_lc);\n',
      '        }\n',
      '    }\n',
    ].join('');
    const lines = [
      ...camera,
      `    float $_pix = 2.0 / (u_resolution.y * max(${f('fov')}, 0.05));\n`,
      `    float $_asp = ${lay}.w;\n`,
      `    float $_dep = max(${f('depth')}, 0.01);\n`,
      `    float $_sz = max(${f('size')}, 0.01);\n`,
      `    vec3 $_B = 0.5 * $_sz * ${half};\n`,
      '    vec3 $_iB = 0.5 / $_B;\n',
      '    float $_mnB = min($_B.x, min($_B.y, $_B.z));\n',
      `    vec2 $_rb = vec2(clamp(${f('roundness')}, 0.0, 1.0), max(${f('bulge')}, 0.0)) * $_mnB;\n`,
      `    float $_fe = max(${f('feather')}, 0.0) * $_mnB;\n`,
      ...(flow
        ? [
          // Flow: the crisp frame stays at Frame position; the clip moves through the box past it.
          `    float $_tau = ${inputVars.flowTime ?? f('flowTime')} + u_time * ${f('flowSpeed')};\n`,
          `    float $_sl0 = clamp(${f('framePos')}, 0.0, 1.0);\n`,
          '    float $_fsh = $_tau - $_sl0;\n',
        ]
        : [`    float $_sl0 = ${slice};\n`]),
      `    float $_kx = tan(radians(clamp(${f('tiltX')}, -85.0, 85.0)));\n`,
      `    float $_ky = tan(radians(clamp(${f('tiltY')}, -85.0, 85.0)));\n`,
      `    vec4 $_st = vec4($_sl0, $_kx, $_ky, ${AX});\n`,
      // Highlights: a comb of frames in time (style.ts highlightComb).
      `    float $_fs = 1.0 / max(${lay}.z - 1.0, 1.0);\n`,
      ...(HL ? [`    float $_hlOn = step(1.0, ${f('hlCount')});\n`] : ['    float $_hlOn = 0.0;\n']),
      ...(!HL ? ['    vec4 $_hl = vec4(0.0, 1.0, 1.0, 0.0);\n'] : flow
        ? [
          // In Flow the highlighted frames are frames of the clip: they travel through the box with it.
          `    float $_h0 = ${f('hlStart')} * $_fs - $_fsh;\n`,
          `    vec4 $_hl = vec4($_h0, max(${f('hlSpacing')}, 0.25) * $_fs, max(floor(${f('hlCount')} + 0.5), 1.0), 1.0);\n`,
          `    float $_sendT = fract($_tau + ${f('hlStart')} * $_fs);\n`,
        ]
        : [
          `    float $_h0 = ${hlMode === 'fixed' ? '0.0' : '$_sl0'} + ${f('hlStart')} * $_fs;\n`,
          `    vec4 $_hl = vec4($_h0, max(${f('hlSpacing')}, 0.25) * $_fs, max(floor(${f('hlCount')} + 0.5), 1.0), ${hlMode === 'loop' ? '1.0' : '0.0'});\n`,
          `    float $_sendT = ${hlMode === 'loop' ? 'fract($_h0)' : 'clamp($_h0, 0.0, 1.0)'};\n`,
        ]),
      ...(HL ? [
        `    float $_hw = 0.5 * max(${f('hlThickness')}, 0.05) * $_fs;\n`,
        `    float $_send = clamp(${f('sendThrough')}, 0.0, 1.0);\n`,
      ] : []),
      // Frame motion: a bump round the slice (or the highlights) moves the frames in it.
      ...(MOT ? [
        `    vec4 $_mv = vec4(${f('liftSide')}, ${f('liftUp')}, ${f('frameScale')}, radians(${f('frameTurn')}));\n`,
        `    float $_fade = clamp(${f('frameFade')}, 0.0, 1.0);\n`,
        `    vec4 $_mw = vec4(${motionAt === 'highlights' ? '0.0' : '1.0'}, ${motionAt === 'slice' ? '0.0' : '$_hlOn'}, max(${f('motionWidth')}, 0.05) * $_fs, abs($_mv.x) + abs($_mv.y) + abs($_mv.z) + abs($_mv.w) + $_fade > 0.0 ? 1.0 : 0.0);\n`,
        '    float $_wide = max($_asp, 1.0);\n',
        '    float $_grow = $_mw.w > 0.5 ? $_sz * (abs($_mv.x) + abs($_mv.y) + max($_mv.z, 0.0) * 0.5 * $_wide + ($_mv.w != 0.0 ? 0.25 * $_wide : 0.0)) : 0.0;\n',
        `    vec3 $_Bx = $_B + $_grow * ${PERP[axis]};\n`,
      ] : [
        '    vec4 $_mv = vec4(0.0);\n',
        '    vec4 $_mw = vec4(0.0);\n',
        '    vec3 $_Bx = $_B;\n',
      ]),
      ...(FX ? [`    vec3 $_fx = vec3(${f('fxHue')}, ${f('fxPosterize')}, ${f('fxAgeGrey')});\n`] : []),
      `    float $_ew = max(${f('edgeWidth')}, 0.0);\n`,
      `    float $_rimS = max(${f('rimStrength')}, 0.0);\n`,
      `    float $_rw = max(${f('rimWidth')}, 1e-3) * $_sz;\n`,
      `    float $_scn = ${inputVars.sceneDist ? `max(${inputVars.sceneDist}, 0.0)` : '1e9'};\n`,
      // Key colour turned round the wheel (by hand, or drifting); pulse and lightning.
      ...(keyMode === 'color' || keyMode === 'hue' ? [`    vec3 $_kc = clamp(tcHueTurn(${c3('keyColor')}, ${f('keyHueShift')} + u_time * ${f('keyHueDrift')}), 0.0, 1.0);\n`] : []),
      ...(keyMode === 'off' ? [] : [
        `    float $_pls = clamp(${f('pulse')}, 0.0, 1.0);\n`,
        `    float $_pph = ${f('pulsePhase')} + u_time * ${f('pulseSpeed')};\n`,
        ...(pulseDir === 'bounce' ? [`    $_pph = (1.0 - abs(1.0 - mod($_pph, 2.0))) * max(${f('pulseCount')}, 1.0);\n`] : []),
        `    vec4 $_pp = vec4(max(floor(${f('pulseCount')} + 0.5), 1.0), ${f('pulseWidth')}, ${f('pulseSoftness')}, $_pph);\n`,
        `    float $_lt = clamp(${f('lightning')}, 0.0, 1.0);\n`,
        `    vec4 $_ll = vec4(${f('lightningRate')}, ${f('lightningSeed')}, ${f('lightningWidth')}, u_time);\n`,
        '    float $_lk = floor($_ll.w * max($_ll.x, 0.01));\n',
        '    vec4 $_lb0 = $_lt > 0.0 ? tcBurstAt($_lk, $_ll) : vec4(0.0);\n',
        '    vec4 $_lb1 = $_lt > 0.0 ? tcBurstAt($_lk - 1.0, $_ll) : vec4(0.0);\n',
      ]),
      // Depth of field: the aperture, the focus distance along each ray, the blur cap.
      ...(DOF ? [
        `    float $_ap = max(${f('blur')}, 0.0) * 0.08 * $_sz;\n`,
        `    vec3 $_fp = ${P.dof === 'slice' ? '(tcBoxQ(vec3(0.5, 0.5, $_sl0), ' + AX + ') * 2.0 - 1.0) * $_B' : 'vec3(0.0)'};\n`,
        `    float $_F = max(${f('focus')}, 0.01) * max(dot($_fp - $_ro, $_rd), 0.05);\n`,
        `    float $_mxb = max(${f('maxBlur')}, 0.0);\n`,
        '    vec2 $_ruv = vec2(1.0 / ($_sz * $_asp), 1.0 / $_sz);\n',
      ] : []),
      '    vec4 $_acc = vec4(0.0);\n',
      '    float $_eF = 0.0, $_eB = 0.0;\n',
      // The search box: the shape's reach plus room (mg) for its soft edge, glow, outline and blur.
      `    float $_mg = max(max($_fe, $_rimS > 0.0 ? 4.0 * $_rw : 0.0), ($_ew + 2.0${DOF ? ' + ($_ap > 0.0 ? $_mxb : 0.0)' : ''}) * ${pixAt('length($_ro)')});\n`,
      '    vec3 $_Bs = $_Bx + $_rb.y + $_mg;\n',
      // Sphere-tracing step: the distance is exact for a rounded box; a bulge makes it overshoot, so step shorter.
      '    float $_ks = 1.0 / (1.0 + 2.0 * $_rb.y / $_mnB);\n',
      '    vec3 $_inv = 1.0 / ($_rd + vec3(equal($_rd, vec3(0.0))) * 1e-7);\n',
      '    vec3 $_ta0 = (-$_Bs - $_ro) * $_inv;\n',
      '    vec3 $_tb0 = ($_Bs - $_ro) * $_inv;\n',
      '    vec3 $_tmn = min($_ta0, $_tb0);\n',
      '    vec3 $_tmx = max($_ta0, $_tb0);\n',
      '    float $_t0 = max(max(max($_tmn.x, $_tmn.y), $_tmn.z), 0.0);\n',
      '    float $_t1 = min(min($_tmx.x, $_tmx.y), $_tmx.z);\n',
      // md (the least distance to the box along the ray, minus how deep when it goes in) sets the soft
      // edge, the rim glow and the silhouette; they follow the box, not frames moved out of it. The
      // march runs from where the ray enters the shape to where it leaves, so its surface is exact.
      '    float $_md = 1e3, $_tS = 0.0, $_en = 0.0, $_ex = -1.0, $_enB = 0.0, $_exB = -1.0;\n',
      '    if ($_t1 > $_t0) {\n',
      trace('$_B', '$_enB', '$_exB', '$_md', '$_tS'),
      // Moved frames reach out of the box: the march runs through the box grown to hold them.
      ...(MOT ? [
        '    if ($_mw.w > 0.5) {\n',
        trace('$_Bx', '$_en', '$_ex'),
        '    } else { $_en = $_enB; $_ex = $_exB; }\n',
      ] : ['    $_en = $_enB; $_ex = $_exB;\n']),
      '    }\n',
      '    float $_far = min($_ex, $_scn);\n',
      `    float $_pxS = ${pixAt('$_tS')};\n`,
      // Edge softness: a ray that only grazes the box covers little of its pixel (style.ts coverage).
      // With frames moved, only what is still inside the box is softened, step by step.
      `    float $_cov = smoothstep(-0.5 * $_pxS, max(${DOF ? `max($_fe, ${cocAt('$_tS')})` : '$_fe'}, $_pxS), -$_md);\n`,
      ...(MOT ? ['    float $_cvEnd = $_mw.w > 0.5 ? 1.0 : $_cov;\n', '    float $_cvIn = $_mw.w > 0.5 ? $_cov : 1.0;\n'] : ['    float $_cvEnd = $_cov;\n']),
      '    if ($_ex > $_en && $_far > $_en) {\n',
      // The slice plane: where along the ray it is crossed, if it is (the side function is linear along the ray).
      `        vec3 $_wA = tcUvt(($_ro + $_rd * $_en + $_B) * $_iB, ${AX});\n`,
      `        vec3 $_wB = tcUvt(($_ro + $_rd * $_far + $_B) * $_iB, ${AX});\n`,
      '        float $_gA = $_wA.z - $_kx * ($_wA.x - 0.5) - $_ky * ($_wA.y - 0.5);\n',
      '        float $_gB = $_wB.z - $_kx * ($_wB.x - 0.5) - $_ky * ($_wB.y - 0.5);\n',
      '        float $_len = $_far - $_en;\n',
      '        float $_gS = ($_gB - $_gA) / max($_len, 1e-6);\n',
      '        float $_f0 = $_gA - $_sl0, $_f1 = $_gB - $_sl0;\n',
      '        float $_ls = $_f0 * $_f1 < 0.0 ? $_en + $_len * $_f0 / ($_f0 - $_f1) : -1.0;\n',
      sliceFacePre,
      `        float $_dl = length(2.0 * $_Bx) / ${steps}.0;\n`,
      // Where in each step to sample, per pixel (interleaved gradient noise): fine grain instead of the bands a fixed step draws.
      '        float $_j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));\n',
      `        float $_tl = 2.0 * ${timeLen};\n`,
      '        int $_n = int(ceil($_len / $_dl));\n',
      `        for (int $_i = 0; $_i < ${steps}; $_i++) {\n`,
      '            if ($_i >= $_n || $_acc.a > 0.995) break;\n',
      '            float $_ta = $_en + float($_i) * $_dl;\n',
      '            float $_tb = min($_ta + $_dl, $_far);\n',
      '            float $_tm = mix($_ta, $_tb, $_j);\n',
      '            bool $_cross = $_ls >= $_ta && $_ls < $_tb;\n',
      '            if ($_cross && $_ls < $_tm)\n',
      sliceFace,
      '            vec3 $_pm = $_ro + $_rd * $_tm;\n',
      '            vec3 $_qv = ($_pm + $_B) * $_iB;\n',
      ...(MOT ? [
        '            vec3 $_wv; float $_bv;\n',
        '            float $_mk = 1.0;\n',
        // Moved frames: read each sample from where its frame came from (the inverse of the move), inside the moved shape.
        `            if ($_mw.w > 0.5) { float $_dv = ${shapeAt('$_pm', '$_wv', '$_bv')}; $_mk = 1.0 - smoothstep(-0.5 * $_dl, 0.5 * $_dl, $_dv); }\n`,
        `            else { $_wv = tcUvt($_qv, ${AX}); $_bv = 0.0; }\n`,
      ] : [`            vec3 $_wv = tcUvt($_qv, ${AX});\n`]),
      '            float $_gv = $_gA + $_gS * ($_tm - $_en);\n',
      `            vec3 $_sq = vec3($_wv.xy, ${timeAt('$_wv.z')});\n`,
      ...(keyMode === 'off'
        ? [DOF ? `            vec3 $_c = tcSampleBlur(${V}, ${lay}, ${inset}, $_sq, ${cocAt('$_tm')} * $_ruv);\n` : `            vec3 $_c = tcSample(${V}, ${lay}, ${inset}, $_sq);\n`]
        : [
          '            vec3 $_c0, $_c1;\n',
          `            float $_fwt = tcFrames(${V}, ${lay}, ${inset}, $_sq, $_c0, $_c1);\n`,
          '            vec3 $_c = mix($_c0, $_c1, $_fwt);\n',
        ]),
      // Transfer function (lib/timeCube/plan.ts voxelOpacity): before / after the slice, dark (or light) is clear, the key.
      `            float $_op = $_gv < $_sl0 ? ${f('before')} : ${f('after')};\n`,
      `            float $_dc0 = clamp(${f('darkClear')}, -1.0, 1.0);\n`,
      `            float $_lv = dot($_c, ${LUMA});\n`,
      '            $_op *= 1.0 - abs($_dc0) + abs($_dc0) * ($_dc0 >= 0.0 ? smoothstep(0.02, 0.4, $_lv) : 1.0 - smoothstep(0.6, 0.98, $_lv));\n',
      keyLines,
      ...(MOT ? ['            $_op *= $_mk * (1.0 - $_fade * $_bv);\n'] : []),
      highlight,
      `            float $_al = (1.0 - exp(-tcDepth($_op) * ($_tb - $_ta) / $_tl))${MOT ? ` * ${coverAt('$_pm')}` : ''};\n`,
      `            vec3 $_col = ${fxOn(look('$_c'), '$_sq.z', 'max($_sl0 - $_gv, 0.0)')};\n`,
      `            $_col = mix($_col, mix(${c3('tintFrom')}, ${c3('tintTo')}, smoothstep(0.0, 1.0, ${tintCoord})), clamp(${f('tintAmount')}, 0.0, 1.0));\n`,
      ...(HL ? ['            $_acc.rgb += (1.0 - $_acc.a) * $_ah * $_hc;\n', '            $_acc.a += (1.0 - $_acc.a) * $_ah;\n'] : []),
      '            $_acc.rgb += (1.0 - $_acc.a) * $_al * $_col;\n',
      '            $_acc.a += (1.0 - $_acc.a) * $_al;\n',
      '            if ($_cross && $_ls >= $_tm)\n',
      sliceFace,
      '        }\n',
      '    }\n',
      edgesBlock,
      outline === 'silhouette'
        ? `    $_eF = $_tS > $_scn ? 0.0 : tcLine(abs($_md), $_pxS, ${cocAt('$_tS')}, $_ew);\n`
        : '',
      // Back edges, behind the frames.
      `    float $_eo = clamp(${f('edgeOpacity')}, 0.0, 1.0);\n`,
      `    $_acc.rgb += (1.0 - $_acc.a) * $_eB * $_eo * ${edgeCol};\n`,
      '    $_acc.a += (1.0 - $_acc.a) * $_eB * $_eo;\n',
      // A soft shadow on the ground below the box.
      `    float $_shA = max(${f('shadow')}, 0.0);\n`,
      '    float $_sh = 0.0;\n',
      '    if ($_shA > 0.0 && $_rd.y < -1e-4) {\n',
      `        float $_tg = (-($_Bx.y + $_rb.y) - ${f('shadowGap')} * $_sz - $_ro.y) / $_rd.y;\n`,
      '        if ($_tg > 0.0 && $_tg < $_scn) {\n',
      '            vec2 $_gq = abs(($_ro + $_rd * $_tg).xz) - $_Bx.xz + $_rb.x;\n',
      '            float $_gsd = length(max($_gq, 0.0)) + min(max($_gq.x, $_gq.y), 0.0) - $_rb.x;\n',
      `            float $_gw = max(${f('shadowSoftness')}, 0.01) * $_sz;\n`,
      '            $_sh = clamp($_shA, 0.0, 1.0) * (1.0 - smoothstep(-0.5 * $_gw, $_gw, $_gsd));\n',
      '        }\n',
      '    }\n',
      `    vec3 $_color = $_acc.rgb * $_cvEnd + (1.0 - $_acc.a * $_cvEnd) * (${bg}) * (1.0 - $_sh);\n`,
      '    float $_alpha = max($_acc.a * $_cvEnd, $_sh);\n',
      // The rim glow, brightest on the silhouette, inside and out (style.ts rimGlow).
      '    float $_rim = $_tS > $_scn ? 0.0 : clamp($_rimS * exp(-abs($_md) / $_rw), 0.0, 1.0);\n',
      `    $_color = mix($_color, ${c3('rimColor')}, $_rim);\n`,
      '    $_alpha = max($_alpha, $_rim);\n',
      // Front edges (or the silhouette), over everything.
      `    $_color = mix($_color, ${edgeCol}, $_eF * $_eo);\n`,
      '    $_alpha = max($_alpha, $_eF * $_eo);\n',
    ];
    return { code: lines.join('').replace(/\$_/g, `${id}_`), outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
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
