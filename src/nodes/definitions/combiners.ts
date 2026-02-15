import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

export const SmoothMinNode: NodeDefinition = {
  type: 'smoothMin',
  label: 'Smooth Min',
  category: 'Combiners',
  description: 'Smooth minimum of two SDF values',
  inputs: {
    a: { type: 'float', label: 'A' },
    b: { type: 'float', label: 'B' },
    smoothness: { type: 'float', label: 'Smoothness' },
  },
  outputs: {
    result: { type: 'float', label: 'Result' },
  },
  defaultParams: { smoothness: 0.5 },
  paramDefs: {
    smoothness: { label: 'Smoothness', type: 'float', min: 0.01, max: 2, step: 0.01 },
  },
  glslFunction: `
float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    const aVar = inputVars.a || '0.0';
    const bVar = inputVars.b || '0.0';
    const kVar = inputVars.smoothness || f(typeof node.params.smoothness === 'number' ? node.params.smoothness : 0.5);
    return {
      code: `    float ${outVar} = smin(${aVar}, ${bVar}, ${kVar});\n`,
      outputVars: { result: outVar },
    };
  },
};

export const MinNode: NodeDefinition = {
  type: 'min',
  label: 'Min',
  category: 'Combiners',
  description: 'Minimum of two float values',
  inputs: {
    a: { type: 'float', label: 'A' },
    b: { type: 'float', label: 'B' },
  },
  outputs: {
    result: { type: 'float', label: 'Result' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    const aVar = inputVars.a || '0.0';
    const bVar = inputVars.b || '0.0';
    return {
      code: `    float ${outVar} = min(${aVar}, ${bVar});\n`,
      outputVars: { result: outVar },
    };
  },
};
