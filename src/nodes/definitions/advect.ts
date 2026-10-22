/**
 * Advect (docs/advect.md): smoke, ink in water and marbled paper in one node. A picture is kept from frame to
 * frame and every frame each of its pixels is carried a little way along a Flow (a direction per pixel), faded,
 * softened, and fresh Source is painted in where the Inject mask says. TouchDesigner builds this from Feedback +
 * Displace; here it is one node.
 *
 * It is a sibling of Feedback (texture) (textureFeedback.ts) and runs on the same machinery: the compiler
 * (compiler/feedbackExpand.ts) opens it into
 *
 *   advectStep (`<id>__fbstep`) ──▶ Pass with the node's own id ──▶ every wire out
 *        ▲ reads the Pass's Previous
 *
 * so its buffer is an ordinary Pass render target (half float, RGBA: colour plus density in alpha), kept, cleared
 * by ↺ (lib/runtimeReset.ts), exported, rendered offline and drawn on pages exactly as Feedback's is. A loop back
 * into it (its own Texture into a Flow (texture) that drives its Flow) reads the buffer a frame ago.
 *
 * One frame of the step (semi-Lagrangian advection: each pixel asks where its paint came from):
 *   flow    = Flow wired, or a built-in gentle curl noise (swirls that never pile up), turned by Swirl
 *   back    = here − flow × Speed picture pixels (× frames at 60 fps, so it moves the same at any frame rate)
 *   old     = the buffer at `back`, softened towards its four neighbours by Diffuse, × e^(−Fade × dt)
 *   inject  = Inject × mask × the Source's alpha, painted in by Mode (Mix, Add or Max)
 *   Reset   = a trigger: while it is above 0.5 the old buffer is dropped (the card's button pulses it)
 *
 * The step compiles under the node's slug and binds its sliders to the node's id (`__bindAs`), so every slider is
 * a live uniform (and a Play target) and a drag never recompiles. The maths is mirrored in JS below for the tests.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { passPxUniform, texUv } from './passes';
import { FRAME_DT_UNIFORM, TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { ADVECT_STEP_TYPE, ADVECT_TYPE } from './textureFeedback';

export { ADVECT_STEP_TYPE, ADVECT_TYPE };

export const ADVECT_MODES = ['mix', 'add', 'max'] as const;
export type AdvectMode = typeof ADVECT_MODES[number];

/** The sliders that are live uniforms (and can be wired from outside). */
export const ADVECT_LIVE_KEYS = ['speed', 'swirl', 'curlSize', 'fade', 'inject', 'diffuse', 'reset'] as const;

const sel = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;

export const ADVECT_DEFAULTS = {
  speed: 2, swirl: 0, curlSize: 1, fade: 0.3, inject: 0.5, diffuse: 0.05, mode: 'mix', reset: 0,
  scale: '1', wrap: 'clamp',
};

const PARAM_DEFS: NonNullable<NodeDefinition['paramDefs']> = {
  speed: { label: 'Speed', type: 'float', min: -10, max: 10, step: 0.05, section: 'Motion', hint: 'How many pixels the picture moves along Flow each frame (for a Flow 1 long, at 60 frames a second). Negative runs it backwards.' },
  swirl: { label: 'Swirl', type: 'float', min: -180, max: 180, step: 0.5, section: 'Motion', hint: 'Degrees the Flow is turned before it moves the picture. 90 turns an uphill slope into a flow along its contours, which curls into swirls.' },
  curlSize: { label: 'Built-in flow size', type: 'float', min: 0.1, max: 6, step: 0.01, section: 'Motion', hint: 'With Flow unwired, a gentle curl of swirls moves the picture: this sets how many swirls fit across it (bigger: smaller swirls).' },
  inject: { label: 'Inject', type: 'float', min: 0, max: 1, step: 0.005, section: 'Paint', hint: 'How much Source is painted in each frame (at 60 frames a second). 0: nothing new, only what is already there keeps moving.' },
  mode: { label: 'Mode', type: 'select', section: 'Paint', hint: 'How the Source meets the picture already there.', options: [
    { value: 'mix', label: 'Mix (paint over)', hint: 'Fades towards the Source by Inject: ink dropped in water.' },
    { value: 'add', label: 'Add (light builds up)', hint: 'Adds the Source on top: smoke and glow that pile up.' },
    { value: 'max', label: 'Max (brighter of the two)', hint: 'Keeps whichever is brighter: trails that never wash out.' },
  ] },
  fade: { label: 'Fade', type: 'float', min: 0, max: 5, step: 0.01, section: 'Paint', hint: 'How quickly the old picture fades, per second (0: never; 1: about two thirds gone each second).' },
  diffuse: { label: 'Soften', type: 'float', min: 0, max: 1, step: 0.005, section: 'Paint', hint: 'A tiny blur each frame, so smoke and ink spread out and their edges go soft. 0 keeps them sharp.' },
  reset: { label: 'Reset', type: 'float', trigger: true, min: 0, max: 1, step: 0.01, section: 'Buffer', hint: 'A trigger: clears the picture (while it is above 0.5 nothing old is kept).', help: 'A trigger. The button clears the picture; in Play, route a key, a beat or a pad to it, or wire a pulse. ↺ (start over) clears it too, with the clock.' },
  scale: { label: 'Resolution', type: 'select', section: 'Buffer', hint: 'Size of the kept picture relative to the output. ½ is cheaper and softer.', options: [
    { value: '1', label: '1 (full size)' }, { value: '0.5', label: '½' }, { value: '0.25', label: '¼' },
  ] },
  wrap: { label: 'Edges', type: 'select', section: 'Buffer', hint: 'What paint carried in from past the edge is: Clamp smears the edge pixels in, Repeat wraps round from the other side, Mirror folds back.', options: [
    { value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' },
  ] },
};

const INPUTS: NodeDefinition['inputs'] = {
  texture: { type: 'texture', label: 'Source', hint: 'The picture painted in each frame: any texture (Texture Input, Video Input, the camera, a Pass…). Leave Source and Colour empty for a built-in drifting spot of colour.' },
  colour: { type: 'vec3', label: 'Colour', hint: 'Optional: paint this colour instead of a texture (a shape, Voronoi\'s cell colour, a palette). It wins over Source.' },
  flow: { type: 'vec2', label: 'Flow', hint: 'The direction each pixel moves, per pixel: Noise\'s Slope, a Vector Field, Optical Flow, Flow (texture). Leave empty for a built-in gentle curl.' },
  mask: { type: 'float', label: 'Inject mask', hint: 'Optional: where Source is painted in (1: fully, 0: not at all): a circle, a brush, a noise. Empty: everywhere.' },
};

// ── The maths, in plain JS (the GLSL below does the same) ───────────────────

/** Frames at 60 fps this frame stands for. */
export const advectFrames = (dt: number) => (dt > 0 ? dt : 1 / 60) * 60;
/** What one frame of `dt` seconds keeps of the old picture at Fade `fade` per second. */
export const advectKeep = (dt: number, fade: number) => Math.exp(-Math.max(fade, 0) * (dt > 0 ? dt : 1 / 60));
/** How much of the Source one frame lays in, for Inject `k` (meant per frame at 60 fps) in Mix mode. */
export const advectMixAmount = (k: number, dt: number) => 1 - Math.pow(1 - Math.min(Math.max(k, 0), 1), advectFrames(dt));
/** One frame of the paint on one channel: `old` (already carried and faded), `src` the Source, `m` Inject × mask × alpha. */
export function advectCombine(mode: AdvectMode, old: number, src: number, m: number, dt: number): number {
  if (mode === 'add') return old + src * m * advectFrames(dt);
  if (mode === 'max') return Math.max(old, src * m);
  const t = advectMixAmount(m, dt);
  return old + (src - old) * t;
}
/** Flow turned by `deg` degrees (anticlockwise), as Swirl does. */
export function advectSwirl(fx: number, fy: number, deg: number): [number, number] {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c * fx - s * fy, s * fx + c * fy];
}

// ── GLSL ─────────────────────────────────────────────────────────────────────

/** The built-in flow: the curl of a few slow sine waves (no hashing, the same on every GPU), about 1 long. */
export const ADVECT_CURL_GLSL = `float advPsi(vec2 p, float t) {
    return 0.5 * sin(p.x * 1.7 + t * 0.31) * cos(p.y * 1.3 - t * 0.23)
         + 0.25 * sin(p.x * 2.9 - p.y * 2.3 + t * 0.47)
         + 0.17 * cos(p.x * 4.3 + p.y * 3.7 - t * 0.19);
}
vec2 advCurl(vec2 p, float t) {
    const float e = 0.01;
    float dy = advPsi(p + vec2(0.0, e), t) - advPsi(p - vec2(0.0, e), t);
    float dx = advPsi(p + vec2(e, 0.0), t) - advPsi(p - vec2(e, 0.0), t);
    return vec2(dy, -dx) / (2.0 * e);
}`;

/** The Source this frame as a vec4 named `${id}_src` (alpha: how much of it there is). */
function sourceCode(id: string, inputVars: Record<string, string>): string {
  if (inputVars.colour) return `    vec4 ${id}_src = vec4(${inputVars.colour}, 1.0);\n`;
  if (inputVars.texture) return `    vec4 ${id}_src = texture2D(${inputVars.texture}, ${texUv('g_uv')});\n`;
  // Nothing wired: a soft spot of colour drifting round the middle, its hue turning slowly.
  return `    vec2 ${id}_sp = vec2(0.45 * cos(u_time * 0.53), 0.35 * sin(u_time * 0.71));\n`
    + `    float ${id}_sd = length(g_uv - ${id}_sp);\n`
    + `    vec4 ${id}_src = vec4(0.5 + 0.5 * cos(6.2831853 * (u_time * 0.05 + vec3(0.0, 0.33, 0.67))), exp(-${id}_sd * ${id}_sd / 0.006));\n`;
}

/** One frame of an Advect buffer: last frame carried along the flow, softened, faded, with fresh Source painted in. */
export function advectStepCode(node: GraphNode, inputVars: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const P = node.params;
  const prev = inputVars.prev;
  const mode = sel(P.mode, ADVECT_MODES, 'mix');
  const flow = inputVars.flow ?? `advCurl(g_uv * ${p(P.curlSize, 1)}, u_time)`;
  const read = (st: string) => (prev ? `texture2D(${prev}, ${st})` : 'vec4(0.0)');
  const px = prev ? passPxUniform(prev) : '(1.0 / u_resolution.xy)';
  const lines = [
    `    float ${id}_dt = ${FRAME_DT_UNIFORM} > 0.0 ? ${FRAME_DT_UNIFORM} : 1.0 / 60.0;\n`,
    `    float ${id}_fr = ${id}_dt * 60.0;\n`,
    `    vec2 ${id}_f0 = ${flow};\n`,
    `    float ${id}_sw = radians(${p(P.swirl, 0)});\n`,
    `    vec2 ${id}_fl = vec2(cos(${id}_sw) * ${id}_f0.x - sin(${id}_sw) * ${id}_f0.y, sin(${id}_sw) * ${id}_f0.x + cos(${id}_sw) * ${id}_f0.y);\n`,
    // Where this pixel's paint was a frame ago: back along the flow, Speed picture pixels (2 / height each here).
    `    vec2 ${id}_back = g_uv - ${id}_fl * ${p(P.speed, 2)} * ${id}_fr * (2.0 / u_resolution.y);\n`,
    `    vec2 ${id}_st = ${texUv(`${id}_back`)};\n`,
    `    vec2 ${id}_px = ${px};\n`,
    `    vec4 ${id}_c0 = ${read(`${id}_st`)};\n`,
    `    vec4 ${id}_nb = (${read(`${id}_st + vec2(${id}_px.x, 0.0)`)} + ${read(`${id}_st - vec2(${id}_px.x, 0.0)`)} + ${read(`${id}_st + vec2(0.0, ${id}_px.y)`)} + ${read(`${id}_st - vec2(0.0, ${id}_px.y)`)}) * 0.25;\n`,
    `    vec4 ${id}_old = mix(${id}_c0, ${id}_nb, clamp(${p(P.diffuse, 0.05)} * ${id}_fr, 0.0, 1.0));\n`,
    `    ${id}_old *= exp(-max(${p(P.fade, 0.3)}, 0.0) * ${id}_dt) * step(${p(P.reset, 0)}, 0.5);\n`,
    sourceCode(id, inputVars),
    `    float ${id}_m = clamp(${p(P.inject, 0.5)}, 0.0, 1.0) * ${inputVars.mask ? `clamp(${inputVars.mask}, 0.0, 1.0)` : '1.0'} * clamp(${id}_src.a, 0.0, 1.0);\n`,
  ];
  if (mode === 'add') {
    lines.push(
      `    vec3 ${id}_c = ${id}_old.rgb + ${id}_src.rgb * ${id}_m * ${id}_fr;\n`,
      `    float ${id}_a = clamp(${id}_old.a + ${id}_m * ${id}_fr, 0.0, 1.0);\n`,
    );
  } else if (mode === 'max') {
    lines.push(
      `    vec3 ${id}_c = max(${id}_old.rgb, ${id}_src.rgb * ${id}_m);\n`,
      `    float ${id}_a = clamp(max(${id}_old.a, ${id}_m), 0.0, 1.0);\n`,
    );
  } else {
    lines.push(
      `    float ${id}_t = 1.0 - pow(1.0 - ${id}_m, ${id}_fr);\n`,
      `    vec3 ${id}_c = mix(${id}_old.rgb, ${id}_src.rgb, ${id}_t);\n`,
      `    float ${id}_a = clamp(mix(${id}_old.a, 1.0, ${id}_t), 0.0, 1.0);\n`,
    );
  }
  return { code: lines.join(''), outputVars: { color: `${id}_c`, alpha: `${id}_a` } };
}

const OUTPUTS: NodeDefinition['outputs'] = {
  color: { type: 'vec3', label: 'Colour', hint: 'The moving picture at this pixel.' },
  alpha: { type: 'float', label: 'Density', hint: 'How much paint is here (0 to 1): fades and moves with the colour. Use it as a mask or an alpha.' },
  texture: { type: 'texture', label: 'Texture', hint: 'The moving picture as a texture: wire it into any texture node (Levels, Glow, Flow (texture), Sample, another Advect).' },
};

export const AdvectNode: NodeDefinition = withParamSockets({
  type: ADVECT_TYPE,
  label: 'Advect',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Smoke', 'Ink in water', 'Marbling', 'Fluid', 'Flow feedback', 'Feedback displace', 'Advection', 'Paint flow'],
  description: 'Smoke, ink in water and marbled paper in one node: the picture is kept from frame to frame, and every frame it is carried along Flow (Speed pixels), faded (Fade), softened (Soften) and fresh Source is painted in (Inject, where the mask says). With Flow empty a gentle built-in curl moves it; with nothing wired at all a drifting spot of colour paints it. ↺ or Reset clears it, and every slider moves live.',
  inputs: INPUTS,
  outputs: OUTPUTS,
  defaultParams: ADVECT_DEFAULTS,
  paramDefs: PARAM_DEFS,
  assignable: false,
  declarationsFor: () => [`uniform float ${FRAME_DT_UNIFORM};`],
  // Compiled only when the compiler has not opened it (compiler/feedbackExpand.ts always does in a graph, unless it
  // is bypassed): the Source as it comes in, with nothing kept.
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = inputVars.texture;
    const src = inputVars.colour ? `vec4(${inputVars.colour}, 1.0)` : tex ? `texture2D(${tex}, ${texUv('g_uv')})` : 'vec4(0.0)';
    return {
      code: `    vec4 ${id}_s = ${src};\n`,
      outputVars: { color: `${id}_s.rgb`, alpha: `${id}_s.a`, texture: tex ?? '' },
    };
  },
}, ADVECT_LIVE_KEYS);

/** One frame of an Advect buffer: made by the compiler (compiler/feedbackExpand.ts), never in a graph. */
export const AdvectStepNode: NodeDefinition = withParamSockets({
  type: ADVECT_STEP_TYPE,
  label: 'Advect step',
  category: 'Output',
  description: 'Internal: one frame of an Advect buffer: last frame carried along the flow, softened and faded, with fresh Source painted in.',
  inputs: {
    prev: { type: 'texture', label: 'Buffer a frame ago' },
    ...INPUTS,
  },
  outputs: {
    color: { type: 'vec3', label: 'Colour' },
    alpha: { type: 'float', label: 'Density' },
  },
  defaultParams: ADVECT_DEFAULTS,
  paramDefs: PARAM_DEFS,
  assignable: false,
  glslFunctions: [ADVECT_CURL_GLSL],
  declarationsFor: () => [`uniform float ${FRAME_DT_UNIFORM};`],
  generateGLSL: (node: GraphNode, inputVars) => advectStepCode(node, inputVars),
}, ADVECT_LIVE_KEYS);
