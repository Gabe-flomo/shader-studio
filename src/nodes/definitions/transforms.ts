import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

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
    const scale = inputVars.scale || f(typeof node.params.scale === 'number' ? node.params.scale : 3.0);
    return {
      code: `    vec2 ${outVar} = fract(${inVar} * ${scale}) - 0.5;\n`,
      outputVars: { output: outVar },
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
    const angleVar = inputVars.angle || f(typeof node.params.angle === 'number' ? node.params.angle : 0.0);
    return {
      code: `    vec2 ${outVar} = rotate(${inVar}, ${angleVar});\n`,
      outputVars: { output: outVar },
    };
  },
};
