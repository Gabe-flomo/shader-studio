import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, p } from './helpers';

const UV_WARP_GLSL = `
// Fast hash-based UV displacement — grain/jitter feel per element
vec2 uvWarpHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
vec2 uvWarpOffset(vec2 uv, float scale, float t, float speed) {
    vec2 p = uv * scale + t * speed;
    return uvWarpHash(floor(p) + 0.5) * fract(p + 0.5);
}`;

export const FractNode: NodeDefinition = {
  type: 'fract',
  label: 'Fract / Tile',
  category: 'Transforms',
  description: 'Tile space using fract with an optional scale multiplier. Wire a float to Scale to animate tile count.',
  inputs: {
    input: { type: 'vec2', label: 'Input' },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Output' },
  },
  defaultParams: { scale: 3.0 },
  paramDefs: {
    scale: { label: 'Scale', type: 'float', min: 0.1, max: 20, step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_output`;
    const inVar = inputVars.input || 'vec2(0.0)';
    const scale = inputVars.scale || p(node.params.scale, 3.0);
    return {
      code: `    vec2 ${outVar} = fract(${inVar} * ${scale}) - 0.5;\n`,
      outputVars: { output: outVar },
    };
  },
};

export const UVWarpNode: NodeDefinition = {
  type: 'uvWarp',
  label: 'UV Warp',
  category: 'Transforms',
  description: 'Displaces UV by a fast hash-based noise — grain-like jitter with no smooth blending. Wire between UV and any SDF or space node to add turbulence to just that element. Scale controls frequency, Strength controls displacement amount.',
  inputs: {
    input: { type: 'vec2', label: 'UV' },
    time:  { type: 'float', label: 'Time' },
  },
  outputs: {
    output: { type: 'vec2', label: 'UV out' },
  },
  defaultParams: { strength: 0.05, scale: 8.0, speed: 1.0 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0.0,  max: 0.5,  step: 0.001 },
    scale:    { label: 'Scale',    type: 'float', min: 0.1,  max: 40.0, step: 0.1   },
    speed:    { label: 'Speed',    type: 'float', min: 0.0,  max: 5.0,  step: 0.01  },
  },
  glslFunction: UV_WARP_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uv       = inputVars.input || 'vec2(0.0)';
    const timeVar  = inputVars.time  || '0.0';
    const str      = p(node.params.strength, 0.05);
    const scale    = p(node.params.scale, 8.0);
    const speed    = p(node.params.speed, 1.0);
    return {
      code: `    vec2 ${id}_output = ${uv} + uvWarpOffset(${uv}, ${scale}, ${timeVar}, ${speed}) * ${str};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

export const Rotate2DNode: NodeDefinition = {
  type: 'rotate2d',
  label: 'Rotate 2D',
  category: 'Transforms',
  description: 'Rotate a 2D vector by an angle (radians)',
  inputs: {
    input: { type: 'vec2', label: 'Input' },
    angle: { type: 'float', label: 'Angle' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Output' },
  },
  defaultParams: { angle: 0.0 },
  paramDefs: {
    angle: { label: 'Angle', type: 'float', min: -6.28, max: 6.28, step: 0.01 },
  },
  glslFunction: `
vec2 rotate(vec2 v, float angle) {
    return vec2(
        v.x * cos(angle) - v.y * sin(angle),
        v.x * sin(angle) + v.y * cos(angle)
    );
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_output`;
    const inVar = inputVars.input || 'vec2(0.0)';
    const angleVar = inputVars.angle || p(node.params.angle, 0.0);
    return {
      code: `    vec2 ${outVar} = rotate(${inVar}, ${angleVar});\n`,
      outputVars: { output: outVar },
    };
  },
};
