import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';

export const OutputNode: NodeDefinition = {
  type: 'output',
  label: 'Output',
  category: 'Output',
  description: 'Final color output of the shader',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
  },
  outputs: {},
  generateGLSL: (_node: GraphNode, inputVars) => {
    const colorVar = inputVars.color || 'vec3(0.0)';
    return {
      code: `    gl_FragColor = vec4(${colorVar}, 1.0);\n`,
      outputVars: {},
    };
  },
};

export const Vec4OutputNode: NodeDefinition = {
  type: 'vec4Output',
  label: 'Output (RGBA)',
  category: 'Output',
  description: 'Final RGBA output. Passes a vec4 color (including alpha) directly to gl_FragColor. Use with nodes that produce a vec4, like Rotating Lines Loop.',
  inputs: {
    color: { type: 'vec4', label: 'Color (RGBA)' },
  },
  outputs: {},
  generateGLSL: (_node: GraphNode, inputVars) => {
    const colorVar = inputVars.color || 'vec4(0.0, 0.0, 0.0, 1.0)';
    return {
      code: `    gl_FragColor = ${colorVar};\n`,
      outputVars: {},
    };
  },
};
