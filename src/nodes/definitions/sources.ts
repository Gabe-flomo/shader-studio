import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

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

export const ConstantNode: NodeDefinition = {
  type: 'constant',
  label: 'Constant',
  category: 'Sources',
  description: 'A constant float value',
  inputs: {},
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  defaultParams: { value: 1.0 },
  paramDefs: {
    value: { label: 'Value', type: 'float', step: 0.01 },
  },
  generateGLSL: (node: GraphNode) => {
    const outVar = `${node.id}_value`;
    const val = f(typeof node.params.value === 'number' ? node.params.value : 1.0);
    return {
      code: `    float ${outVar} = ${val};\n`,
      outputVars: { value: outVar },
    };
  },
};
