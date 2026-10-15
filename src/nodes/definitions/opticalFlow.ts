/**
 * Optical Flow (docs/optical-flow.md): how each part of a moving picture moved since the last frame, as a vector,
 * TouchDesigner's Optical Flow TOP. Wire its Flow into Feedback (texture)'s Flow, Displace, Particles or Agents.
 *
 * compiler/opticalFlowExpand.ts opens the node into two Passes at Resolution (a share of the picture):
 *
 *   the source (`<id>__ofsrc`, a Sample) ──▶ Pass `<id>__ofluma` (keeps its Previous)
 *   Optical Flow step (`<id>__ofstep`) ──▶ Pass `<id>__ofpass` (rg: the flow, b: its speed; keeps its Previous)
 *   Optical Flow read (the node's own id) ──▶ every wire out of the node
 *
 * The step is Lucas–Kanade over a small window: the brightness slopes (x, y, from this frame and the last) and its
 * change in time give, per window, the one motion that best explains the change. A little regularisation keeps flat
 * areas at 0; Smoothing blends with the last frame's flow; Min speed drops the noise.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

export const OPTICAL_FLOW_TYPE = 'opticalFlow';
export const OPTICAL_FLOW_STEP_TYPE = 'opticalFlowStep';
export const OPTICAL_FLOW_READ_TYPE = 'opticalFlowRead';
export const OF_SCALES = ['0.5', '0.25', '0.125'] as const;

export const ofScaleOf = (n: GraphNode): string => ((OF_SCALES as readonly string[]).includes(String(n.params.resolution)) ? String(n.params.resolution) : '0.25');
export const ofWindowOf = (n: GraphNode): number => (n.params.window === '3' ? 1 : n.params.window === '7' ? 3 : 2);

const OUTPUTS: NodeDefinition['outputs'] = {
  flow: { type: 'vec2', label: 'Flow', hint: 'How far this part of the picture moved since the last frame, in picture units (times Strength). Wire into Feedback (texture)\'s Flow, Displace\'s offset, or a UV to push things along the motion.' },
  speed: { type: 'float', label: 'Speed', hint: 'How fast it moved: the length of Flow.' },
  color: { type: 'vec3', label: 'View', hint: 'The flow as colour: hue is the direction, brightness the speed (times View gain). To see what it finds.' },
  texture: { type: 'texture', label: 'Flow texture', hint: 'The flow as a texture (red, green: the flow; blue: its speed), at Resolution: for Sample, Blur, or another program.' },
};

const PARAMS: NonNullable<NodeDefinition['paramDefs']> = {
  resolution: { label: 'Resolution', type: 'select', hint: 'The size it works at, against the picture. ¼ is smooth and cheap; ½ finds finer motion.', options: [
    { value: '0.5', label: '½' }, { value: '0.25', label: '¼' }, { value: '0.125', label: '⅛' },
  ] },
  window: { label: 'Window', type: 'select', hint: 'How many pixels round each one it looks at: bigger is steadier and blurrier.', options: [
    { value: '3', label: '3 × 3' }, { value: '5', label: '5 × 5' }, { value: '7', label: '7 × 7' },
  ] },
  strength: { label: 'Strength', type: 'float', min: 0, max: 10, step: 0.01, hint: 'Scales the flow.' },
  smoothing: { label: 'Smoothing', type: 'float', min: 0, max: 0.95, step: 0.01, hint: 'Blends with the last frame\'s flow: steadier, a little behind.' },
  minSpeed: { label: 'Min speed', type: 'float', min: 0, max: 0.02, step: 0.0005, hint: 'Motion slower than this (picture units a frame) counts as none: hides camera noise.' },
  viewGain: { label: 'View gain', type: 'float', min: 1, max: 400, step: 1, hint: 'How bright View shows a given speed.' },
};

const DEFAULTS = { resolution: '0.25', window: '5', strength: 1, smoothing: 0.5, minSpeed: 0.0015, viewGain: 60 };

/** The user's node. Its own GLSL (inside a group, or with nothing wired) is no motion. */
export const OpticalFlowNode: NodeDefinition = {
  type: OPTICAL_FLOW_TYPE,
  label: 'Optical Flow',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Optical Flow TOP', 'Motion vectors', 'Motion field', 'Lucas-Kanade', 'Movement direction', 'Video flow'],
  description: 'Finds how each part of a moving picture moved since the last frame: Flow is a direction and distance at every pixel. Wire a Video Input or the camera. Feed Flow into Feedback (texture)\'s Flow so trails follow real movement, into Displace, or into particles and agents; Speed lights up whatever moves.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'The moving picture: a Video Input (or the camera), Baked, a Pass.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the flow, in picture coordinates. Empty: this pixel.' },
  },
  outputs: OUTPUTS,
  defaultParams: DEFAULTS,
  paramDefs: PARAMS,
  // No motion (and, for Flow texture, a stand-in sampler that is never written).
  generateGLSL: node => ({
    code: `    vec2 ${node.id}_f = vec2(0.0);\n`,
    outputVars: { flow: `${node.id}_f`, speed: '0.0', color: 'vec3(0.0)', texture: 'u_fontTexture' },
  }),
};

const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';

/** Internal: one frame of the flow, in its Pass (compiler/opticalFlowExpand.ts). */
export const OpticalFlowStepNode: NodeDefinition = {
  type: OPTICAL_FLOW_STEP_TYPE,
  label: 'Optical Flow step',
  category: 'Output',
  description: 'Internal: one frame of an Optical Flow (Lucas–Kanade over a window), blended with the last.',
  inputs: {
    cur: { type: 'texture', label: 'This frame' },
    prev: { type: 'texture', label: 'Last frame' },
    flowPrev: { type: 'texture', label: 'Last flow' },
  },
  outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
  defaultParams: DEFAULTS,
  // View gain is the read's.
  paramDefs: Object.fromEntries(Object.entries(PARAMS).filter(([k]) => k !== 'viewGain')),
  assignable: false,
  generateGLSL: (node, inputVars) => {
    const id = node.id, P = node.params, R = ofWindowOf(node);
    const cur = inputVars.cur, prev = inputVars.prev, fp = inputVars.flowPrev;
    if (!cur || !prev) return { code: `    vec3 ${id}_o = vec3(0.0);\n`, outputVars: { color: `${id}_o`, alpha: '1.0' } };
    const L = (s: string, q: string) => `dot(texture2D(${s}, ${q}).rgb, ${LUMA})`;
    const code = [
      `    vec2 ${id}_st = gl_FragCoord.xy / u_resolution;\n`,
      `    vec2 ${id}_px = 1.0 / u_resolution;\n`,
      `    float ${id}_a11 = 0.0, ${id}_a12 = 0.0, ${id}_a22 = 0.0, ${id}_b1 = 0.0, ${id}_b2 = 0.0;\n`,
      `    for (int j = -${R}; j <= ${R}; j++) for (int i = -${R}; i <= ${R}; i++) {\n`,
      `      vec2 q = ${id}_st + vec2(float(i), float(j)) * ${id}_px;\n`,
      `      vec2 dx = vec2(${id}_px.x, 0.0), dy = vec2(0.0, ${id}_px.y);\n`,
      // The slopes, averaged over both frames; the change in time.
      `      float ix = 0.25 * ((${L(cur, 'q + dx')} - ${L(cur, 'q - dx')}) + (${L(prev, 'q + dx')} - ${L(prev, 'q - dx')}));\n`,
      `      float iy = 0.25 * ((${L(cur, 'q + dy')} - ${L(cur, 'q - dy')}) + (${L(prev, 'q + dy')} - ${L(prev, 'q - dy')}));\n`,
      `      float it = ${L(cur, 'q')} - ${L(prev, 'q')};\n`,
      `      ${id}_a11 += ix * ix; ${id}_a12 += ix * iy; ${id}_a22 += iy * iy; ${id}_b1 += ix * it; ${id}_b2 += iy * it;\n`,
      `    }\n`,
      // The motion (texels a frame) that best explains the change: −A⁻¹ b, regularised so flat areas stay still.
      `    ${id}_a11 += 1e-4; ${id}_a22 += 1e-4;\n`,
      `    float ${id}_det = ${id}_a11 * ${id}_a22 - ${id}_a12 * ${id}_a12;\n`,
      `    vec2 ${id}_v = -vec2(${id}_a22 * ${id}_b1 - ${id}_a12 * ${id}_b2, ${id}_a11 * ${id}_b2 - ${id}_a12 * ${id}_b1) / max(${id}_det, 1e-8);\n`,
      `    ${id}_v = clamp(${id}_v, vec2(-4.0), vec2(4.0));\n`,
      // In picture units (the picture is 2 high), times Strength; slower than Min speed is none.
      `    vec2 ${id}_f = ${id}_v * 2.0 / u_resolution.y * ${p(P.strength, 1)};\n`,
      `    ${id}_f *= step(${p(P.minSpeed, 0.0015)}, length(${id}_f));\n`,
      fp ? `    ${id}_f = mix(${id}_f, texture2D(${fp}, ${id}_st).xy, ${p(P.smoothing, 0.5)});\n` : '',
      `    vec3 ${id}_o = vec3(${id}_f, length(${id}_f));\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_o`, alpha: '1.0' } };
  },
};

/** Internal: the node's outputs, read from its flow Pass. */
export const OpticalFlowReadNode: NodeDefinition = {
  type: OPTICAL_FLOW_READ_TYPE,
  label: 'Optical Flow read',
  category: 'Output',
  description: 'Internal: an Optical Flow\'s outputs, from its flow Pass.',
  inputs: {
    state: { type: 'texture', label: 'Flow' },
    uv: { type: 'vec2', label: 'UV' },
  },
  outputs: OUTPUTS,
  defaultParams: { viewGain: 60 },
  // Bound to the user's node (__bindAs), so View gain is a uniform write.
  paramDefs: { viewGain: PARAMS.viewGain },
  assignable: false,
  generateGLSL: (node, inputVars) => {
    const id = node.id, S = inputVars.state;
    if (!S) return { code: `    vec2 ${id}_f = vec2(0.0);\n`, outputVars: { flow: `${id}_f`, speed: '0.0', color: 'vec3(0.0)', texture: 'u_fontTexture' } };
    const code = [
      `    vec4 ${id}_s = texture2D(${S}, clamp(${texUv(inputVars.uv ?? 'g_uv')}, 0.0, 1.0));\n`,
      `    vec2 ${id}_f = ${id}_s.xy;\n`,
      `    float ${id}_sp = length(${id}_f);\n`,
      `    vec3 ${id}_view = (0.5 + 0.5 * cos(6.28318 * (atan(${id}_f.y, ${id}_f.x) / 6.28318 + vec3(0.0, 0.33, 0.67)))) * clamp(${id}_sp * ${p(node.params.viewGain, 60)}, 0.0, 1.0);\n`,
    ].join('');
    return { code, outputVars: { flow: `${id}_f`, speed: `${id}_sp`, color: `${id}_view`, texture: S } };
  },
};
