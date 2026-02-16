import type { NodeDefinition } from '../../types/nodeGraph';

/**
 * Loop node — chains user-selected graph nodes and repeats them N times,
 * feeding the output of one iteration back as the input of the next.
 *
 * The actual GLSL is generated inline by the compiler (graphCompiler.ts)
 * which has access to the full node list. generateGLSL here is a stub.
 */
export const LoopNode: NodeDefinition = {
  type: 'loop',
  label: 'Loop',
  category: 'Loops',
  description: 'Chains selected graph nodes and repeats them N times, feeding output back as input each iteration. Open the editor to pick steps and set carry type.',

  // Carry type + iterations are dynamic — sockets rebuilt by LoopModal via updateNodeSockets
  inputs:  { carry: { type: 'vec2', label: 'Carry' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },

  defaultParams: {
    steps: [] as string[],  // ordered node IDs
    iterations: 4,
    carryType: 'vec2',
  },

  paramDefs: {
    iterations: { label: 'Iterations', type: 'float', min: 1, max: 16, step: 1 },
  },

  // Stub — real code is generated in graphCompiler.ts special-case for type === 'loop'
  generateGLSL: (_node, _inputVars) => ({
    code: '',
    outputVars: { result: 'vec2(0.0)' },
  }),
};
