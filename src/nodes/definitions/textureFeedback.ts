/**
 * Feedback (texture) (docs/texture-tools.md, "Feedback (texture)"): one node for a trail on any
 * texture. Texture in, trailed texture out.
 *
 * Before it, a trail took three nodes: a Pass whose Previous is last frame, Fade (feedback) to dim
 * it, and Read (texture) to drift it. This node is those three, wired for you. The compiler opens it
 * (compiler/feedbackExpand.ts) into
 *
 *   textureFeedbackStep (`<id>__fbstep`) ──▶ Pass with the node's own id ──▶ every wire out
 *        ▲ reads the Pass's Previous
 *
 * so its buffer is an ordinary Pass render target: kept, reset (lib/runtimeReset.ts clears every
 * Pass's Previous), exported and drawn on pages exactly as any feedback Pass is. Each Feedback node
 * is its own Pass, so several keep several buffers.
 *
 * The step's GLSL is Read (texture)'s and Fade (feedback)'s own generators (textureTools.ts), run
 * under sub-ids: Read bends where last frame is read (zoom, turn, move round a pivot, pushed by a
 * flow), Fade dims what it reads there and lays the fresh picture over it. Then a hue drift turns
 * the colour round the grey axis a little each second.
 *
 * The step compiles under the node's slug and binds its sliders to the node's id (`__bindAs`), so
 * every slider is a live uniform (and a Play target) and a drag never recompiles.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { texUv } from './passes';
import { FRAME_DT_UNIFORM, ReadTextureNode, TEXTURE_TOOLS_CATEGORY, TextureFadeNode } from './textureTools';

export const FEEDBACK_TYPE = 'textureFeedback';
export const FEEDBACK_STEP_TYPE = 'textureFeedbackStep';

/** The sliders that are live uniforms (and can be wired from outside). */
const LIVE_KEYS = ['tail', 'clean', 'tint', 'amount', 'zoom', 'turn', 'moveX', 'moveY', 'pivotX', 'pivotY', 'flowAmount', 'hueDrift'] as const;

export const FEEDBACK_BLENDS = ['add', 'over', 'max', 'screen'] as const;
export const FEEDBACK_SCALES = ['1', '0.5', '0.25'] as const;
export const FEEDBACK_WRAPS = ['clamp', 'repeat', 'mirror'] as const;

const sel = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;

const DEFAULTS = {
  tail: 1.5, clean: 0.05, tint: [1, 1, 1], amount: 1, blend: 'add',
  zoom: 1, turn: 0, moveX: 0, moveY: 0, pivotX: 0, pivotY: 0, flowAmount: 1, hueDrift: 0,
  scale: '1', wrap: 'clamp',
};

const fadeDefs = TextureFadeNode.paramDefs!;
const readDefs = ReadTextureNode.paramDefs!;

const PARAM_DEFS: NonNullable<NodeDefinition['paramDefs']> = {
  tail: { ...fadeDefs.tail, section: 'Trail' },
  clean: { ...fadeDefs.clean, section: 'Trail' },
  tint: { ...fadeDefs.tint, section: 'Trail' },
  amount: { label: 'Fresh', type: 'float', min: 0, max: 2, step: 0.01, section: 'Trail', hint: 'How strongly this frame\'s picture is laid over the trail (1: as it is; 0: only the trail, which then fades away).' },
  blend: { label: 'Blend', type: 'select', section: 'Trail', hint: 'How the fresh picture meets the faded trail.', options: [
    { value: 'add', label: 'Add (light builds up)' }, { value: 'over', label: 'Over (replace where bright)' },
    { value: 'max', label: 'Brighter of the two' }, { value: 'screen', label: 'Screen (soft add)' },
  ] },
  hueDrift: { label: 'Hue drift', type: 'float', min: -360, max: 360, step: 0.5, section: 'Trail', hint: 'Degrees per second the trail\'s colour turns round the colour wheel: older trails drift through the hues.' },
  zoom: { ...readDefs.zoom, section: 'Drift' },
  turn: { ...readDefs.turn, section: 'Drift' },
  moveX: { ...readDefs.moveX, section: 'Drift' },
  moveY: { ...readDefs.moveY, section: 'Drift' },
  pivotX: { ...readDefs.pivotX, section: 'Drift' },
  pivotY: { ...readDefs.pivotY, section: 'Drift' },
  flowAmount: { ...readDefs.flowAmount, label: 'Flow strength', section: 'Drift', hint: 'How far the Flow input pushes the trail each frame (1: as given). Only used when Flow is wired.' },
  scale: { label: 'Resolution', type: 'select', section: 'Buffer', hint: 'Size of the trail buffer relative to the picture. ½ is cheaper and softer.', options: [
    { value: '1', label: '1 (full size)' }, { value: '0.5', label: '½' }, { value: '0.25', label: '¼' },
  ] },
  wrap: { label: 'Edges', type: 'select', section: 'Buffer', hint: 'What a drift past the edge of the buffer reads: Clamp smears the edge pixels in, Repeat wraps round, Mirror folds back.', options: [
    { value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' },
  ] },
};

const INPUTS: NodeDefinition['inputs'] = {
  texture: { type: 'texture', label: 'Texture', hint: 'The picture to leave trails: any texture (Texture Input, Video Input, the camera, a Pass, Baked, a Trail field\'s Image…).' },
  uv: { type: 'vec2', label: 'UV', hint: 'Where to read the picture and the trail, in picture coordinates. Leave empty for this pixel; wire a warp to bend both.' },
  flow: { type: 'vec2', label: 'Flow', hint: 'Pushes the trail along this every frame (picture units): Flow (texture)\'s Flow, a noise, a curl.' },
  fresh: { type: 'vec3', label: 'Fresh', hint: 'Optional: paint this colour instead of the Texture\'s (a shape, a mask times a colour). The Texture still sets the buffer\'s size.' },
};

/** The fresh picture (Texture at UV, or the Fresh override) times Fresh, and its alpha. */
function freshCode(id: string, P: Record<string, unknown>, inputVars: Record<string, string>): string {
  const tex = inputVars.texture;
  const read = tex ? `texture2D(${tex}, ${texUv(inputVars.uv ?? 'g_uv')})` : 'vec4(0.0)';
  return `    vec4 ${id}_src = ${inputVars.fresh ? `vec4(${inputVars.fresh}, 1.0)` : read};\n`
    + `    vec3 ${id}_fr = ${id}_src.rgb * ${p(P.amount, 1)};\n`;
}

/** One frame of the trail: Read's drift, Fade's decay with the fresh picture over it, a hue drift. */
export function feedbackStepCode(node: GraphNode, inputVars: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const P = node.params;
  const prev = inputVars.prev;
  const read = ReadTextureNode.generateGLSL(
    { ...node, id: `${id}_rd`, type: 'readTexture', params: { zoom: P.zoom, turn: P.turn, moveX: P.moveX, moveY: P.moveY, pivotX: P.pivotX, pivotY: P.pivotY, flowAmount: P.flowAmount, edges: 'texture' } },
    { ...(prev ? { texture: prev } : {}), ...(inputVars.uv ? { uv: inputVars.uv } : {}), ...(inputVars.flow ? { flow: inputVars.flow } : {}) },
  );
  const fade = TextureFadeNode.generateGLSL(
    { ...node, id: `${id}_fd`, type: 'textureFade', params: { tail: P.tail, clean: P.clean, tint: P.tint, combine: sel(P.blend, FEEDBACK_BLENDS, 'add') } },
    { ...(prev ? { texture: prev } : {}), uv: read.outputVars.uv, fresh: `${id}_fr` },
  );
  const c = fade.outputVars.color;
  const code = freshCode(id, P, inputVars) + read.code + fade.code
    // Hue drift: the colour turned round the grey axis (Rodrigues), by degrees per second × this frame's length.
    + `    float ${id}_ha = radians(${p(P.hueDrift, 0)}) * ${id}_fd_dt;\n`
    + `    vec3 ${id}_k = vec3(0.57735027);\n`
    + `    vec3 ${id}_c = ${c} * cos(${id}_ha) + vec3(${id}_k.y * ${c}.z - ${id}_k.z * ${c}.y, ${id}_k.z * ${c}.x - ${id}_k.x * ${c}.z, ${id}_k.x * ${c}.y - ${id}_k.y * ${c}.x) * sin(${id}_ha) + ${id}_k * dot(${id}_k, ${c}) * (1.0 - cos(${id}_ha));\n`
    + `    float ${id}_a = max(${fade.outputVars.alpha}, clamp(${id}_src.a * ${p(P.amount, 1)}, 0.0, 1.0));\n`;
  return { code, outputVars: { color: `${id}_c`, alpha: `${id}_a` } };
}

export const TextureFeedbackNode: NodeDefinition = withParamSockets({
  type: FEEDBACK_TYPE,
  label: 'Feedback (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Feedback', 'Trails', 'Echo', 'Video feedback', 'Texture feedback', 'Feedback loop', 'Zoom tunnel', 'Afterimage'],
  description: 'Trails on any texture in one node: last frame is kept in a buffer of its own, drifted (zoomed, turned, moved round a Pivot, pushed by a Flow), faded with a Tail in seconds, and the fresh picture is laid over it. Texture out is the trailed picture, for any texture node; Color and Alpha are it at this pixel. It is a Pass, a Fade (feedback) and a Read (texture) wired for you: ↺ clears it, and every slider moves live.',
  inputs: INPUTS,
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The trailed picture at this pixel.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'Its alpha at this pixel.' },
    texture: { type: 'texture', label: 'Texture', hint: 'The trailed picture as a texture: wire it into any texture node (Levels, Glow, Mask, Sample, another Feedback).' },
  },
  defaultParams: DEFAULTS,
  paramDefs: PARAM_DEFS,
  assignable: false,
  declarationsFor: () => [`uniform float ${FRAME_DT_UNIFORM};`],
  // Compiled only when the compiler has not opened it (compiler/feedbackExpand.ts always does in a
  // graph): the picture as it comes in, with no trail.
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = inputVars.texture;
    return {
      code: `    vec4 ${id}_s = ${tex ? `texture2D(${tex}, ${texUv(inputVars.uv ?? 'g_uv')})` : 'vec4(0.0)'};\n`,
      outputVars: { color: `${id}_s.rgb`, alpha: `${id}_s.a`, texture: tex ?? '' },
    };
  },
}, LIVE_KEYS);

/** One frame of a Feedback (texture) buffer: made by the compiler (compiler/feedbackExpand.ts), never in a graph. */
export const TextureFeedbackStepNode: NodeDefinition = withParamSockets({
  type: FEEDBACK_STEP_TYPE,
  label: 'Feedback (texture) step',
  category: 'Output',
  description: 'Internal: one frame of a Feedback (texture) buffer: last frame drifted and faded, with the fresh picture over it.',
  inputs: {
    prev: { type: 'texture', label: 'Buffer a frame ago' },
    ...INPUTS,
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  defaultParams: DEFAULTS,
  paramDefs: PARAM_DEFS,
  assignable: false,
  declarationsFor: () => [`uniform float ${FRAME_DT_UNIFORM};`],
  generateGLSL: (node: GraphNode, inputVars) => feedbackStepCode(node, inputVars),
}, LIVE_KEYS);

/** The Pass params a Feedback node's settings give. */
export function feedbackPassParams(n: GraphNode): Record<string, unknown> {
  const label = typeof n.params.label === 'string' && n.params.label.trim() ? n.params.label.trim() : 'Feedback';
  return {
    label, scale: sel(n.params.scale, FEEDBACK_SCALES, '1'), format: 'half', filter: 'linear',
    wrap: sel(n.params.wrap, FEEDBACK_WRAPS, 'clamp'), repeat: 1,
  };
}

/** JS mirror of the hue drift (tests): `c` turned by `deg` round the grey axis. */
export function hueTurn(c: [number, number, number], deg: number): [number, number, number] {
  const a = deg * Math.PI / 180, k = 1 / Math.sqrt(3), co = Math.cos(a), si = Math.sin(a);
  const d = k * (c[0] + c[1] + c[2]);
  const cr: [number, number, number] = [k * c[2] - k * c[1], k * c[0] - k * c[2], k * c[1] - k * c[0]];
  return [0, 1, 2].map(i => c[i] * co + cr[i] * si + k * d * (1 - co)) as [number, number, number];
}
