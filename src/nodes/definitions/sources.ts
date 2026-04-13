import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

/**
 * Loop Index — outputs the current iteration counter `i` when placed inside
 * an iterated group (iterations > 1).  The compiler replaces the placeholder
 * GLSL with the actual loop variable at code-generation time.
 * Outside an iterated group it safely outputs 0.0.
 */
export const LoopIndexNode: NodeDefinition = {
  type: 'loopIndex',
  label: 'Loop Index',
  category: 'Sources',
  description: 'Current iteration index (float i) — place inside a group with iterations > 1',
  inputs: {},
  outputs: {
    i: { type: 'float', label: 'i' },
  },
  generateGLSL: (node: GraphNode) => {
    // Default codegen (single-pass / preview context): emit 0.0.
    // The iterated-group compiler overrides nodeOutputs for this node type
    // before calling generateGLSL, so this fallback is rarely reached.
    const outVar = `${node.id}_loopidx`;
    return {
      code: `    float ${outVar} = 0.0;\n`,
      outputVars: { i: outVar },
    };
  },
};

export const UVNode: NodeDefinition = {
  type: 'uv',
  label: 'UV',
  category: 'Sources',
  description: 'Centered, aspect-corrected UV coordinates',
  inputs: {},
  outputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  generateGLSL: (node: GraphNode) => {
    const outVar = `${node.id}_uv`;
    return {
      code: `    vec2 ${outVar} = (vUv - 0.5) * 2.0;\n    ${outVar}.x *= u_resolution.x / u_resolution.y;\n`,
      outputVars: { uv: outVar },
    };
  },
};

export const TimeNode: NodeDefinition = {
  type: 'time',
  label: 'Time',
  category: 'Sources',
  description: 'Current time in seconds',
  inputs: {},
  outputs: {
    time: { type: 'float', label: 'Time' },
  },
  generateGLSL: (node: GraphNode) => {
    const outVar = `${node.id}_time`;
    return {
      code: `    float ${outVar} = u_time;\n`,
      outputVars: { time: outVar },
    };
  },
};

export const PixelUVNode: NodeDefinition = {
  type: 'pixelUV',
  label: 'Pixel UV',
  category: 'Sources',
  description: 'Raw screen UV: fragCoord / resolution.y. Origin at bottom-left, x reaches aspect ratio. Use this for shaders that work in pixel-ratio space rather than centered UV.',
  inputs: {},
  outputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  generateGLSL: (node: GraphNode) => {
    const outVar = `${node.id}_uv`;
    return {
      code: `    vec2 ${outVar} = gl_FragCoord.xy / u_resolution.y;\n`,
      outputVars: { uv: outVar },
    };
  },
};

export const MouseNode: NodeDefinition = {
  type: 'mouse',
  label: 'Mouse',
  category: 'Sources',
  description: 'Mouse position in the same centered UV space as the UV node (aspect-corrected, origin = center). Returns vec2 UV, X float, and Y float.',
  inputs: {},
  outputs: {
    uv: { type: 'vec2',  label: 'Mouse UV' },
    x:  { type: 'float', label: 'X'        },
    y:  { type: 'float', label: 'Y'        },
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    // u_mouse is in pixel coords (0=bottom-left, same as gl_FragCoord).
    // Convert to the same centered + aspect-corrected space as the UV node.
    return {
      code: [
        `    vec2 ${id}_uv = (u_mouse / u_resolution.y - vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5) * 2.0;\n`,
        `    float ${id}_x = ${id}_uv.x;\n`,
        `    float ${id}_y = ${id}_uv.y;\n`,
      ].join(''),
      outputVars: { uv: `${id}_uv`, x: `${id}_x`, y: `${id}_y` },
    };
  },
};

export const PrevFrameNode: NodeDefinition = {
  type: 'prevFrame',
  label: 'Prev Frame',
  category: 'Sources',
  description: 'Samples the previous frame\'s rendered output. Enables stateful effects like trails, reaction-diffusion, and fluid simulation.',
  inputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
    uv:    { type: 'vec2',  label: 'UV (pass-through)' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const uvVar = inputVars.uv ?? 'g_uv';
    // Convert centered UV back to [0,1] for texture sampling
    const samplerUV = `(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5)`;
    return {
      code: [
        `    vec4 ${id}_prev = texture2D(u_prevFrame, clamp(${samplerUV}, 0.0, 1.0));\n`,
        `    vec3 ${id}_color = ${id}_prev.rgb;\n`,
        `    float ${id}_alpha = ${id}_prev.a;\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, alpha: `${id}_alpha`, uv: uvVar },
    };
  },
};

export const TextureInputNode: NodeDefinition = {
  type: 'textureInput',
  label: 'Texture Input',
  category: 'Sources',
  description: 'Samples an image texture loaded from a file. Wire to UV for sampling position.',
  inputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
    uv:    { type: 'vec2',  label: 'UV (pass-through)' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar = inputVars.uv ?? 'g_uv';
    // Map from centered [-aspect,aspect] × [-1,1] UV back to [0,1] UV for texture sampling
    const samplerUV = `(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5)`;
    return {
      code: [
        `    vec4 ${id}_sample = texture2D(u_tex_${id}, clamp(${samplerUV}, 0.0, 1.0));\n`,
        `    vec3 ${id}_color = ${id}_sample.rgb;\n`,
        `    float ${id}_alpha = ${id}_sample.a;\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, alpha: `${id}_alpha`, uv: uvVar },
    };
  },
};

export const AudioInputNode: NodeDefinition = {
  type: 'audioInput',
  label: 'Audio Input',
  category: 'Sources',
  description: 'Load an audio file and output per-band frequency amplitudes as floats (0–1). Add multiple bands or use Full Spectrum mode for overall volume.',
  inputs: {},
  outputs: {
    amplitude_0: { type: 'float', label: 'Band 0' },
  },
  defaultParams: {
    freq_range:  200.0,
    mode: 'band',
    _bands: [200],
    _fileName: '',
    _hasFile: false,
  },
  paramDefs: {
    freq_range: { label: 'Freq Range (Hz)', type: 'float', min: 0, max: 10000, step: 1 },
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'band', label: 'Frequency Band' },
      { value: 'full', label: 'Full Spectrum'  },
    ]},
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    const rawBands = node.params._bands;
    const bands: number[] = Array.isArray(rawBands) ? rawBands as number[] : [200];
    const lines: string[] = [];
    const outputVars: Record<string, string> = {};
    for (let i = 0; i < bands.length; i++) {
      const outVar = `${id}_amplitude_${i}`;
      lines.push(`    float ${outVar} = u_audio_${id}_${i};\n`);
      outputVars[`amplitude_${i}`] = outVar;
    }
    return { code: lines.join(''), outputVars };
  },
};

export const ConstantNode: NodeDefinition = {
  type: 'constant',
  label: 'Constant',
  category: 'Sources',
  description: 'A constant float value — wire an input to override the slider',
  inputs: {
    value: { type: 'float', label: 'Value' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  defaultParams: { value: 1.0 },
  paramDefs: {
    value: { label: 'Value', type: 'float', step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_value`;
    const val = inputVars.value || p(node.params.value, 1.0);
    return {
      code: `    float ${outVar} = ${val};\n`,
      outputVars: { value: outVar },
    };
  },
};
