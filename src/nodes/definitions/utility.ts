import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// p is imported for use by other utility nodes if needed in the future
void p;

export const ScopeNode: NodeDefinition = {
  type: 'scope',
  label: 'Scope',
  category: 'Utility',
  description: 'Oscilloscope — visualizes a float signal as a rolling waveform. Output is a passthrough of the input value.',
  inputs: {
    value: { type: 'float', label: 'Value' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  defaultParams: { min: -1.0, max: 1.0 },
  paramDefs: {
    min: { label: 'Min', type: 'float', min: -10, max: 10, step: 0.1 },
    max: { label: 'Max', type: 'float', min: -10, max: 10, step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    return {
      code: `    float ${id}_value = ${inputVars.value ?? '0.0'};\n`,
      outputVars: { value: `${id}_value` },
    };
  },
};
