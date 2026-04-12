import type { NodeDefinition, DataType } from '../../types/nodeGraph';

/**
 * Loop node — chains user-selected graph nodes and repeats them N times,
 * feeding the output of one iteration back as the input of the next.
 *
 * The actual GLSL is generated inline by the compiler (graphCompiler.ts)
 * which has access to the full node list. generateGLSL here is a stub.
 */
/**
 * LoopCarry — carry variable that persists across iterations of an iterated group.
 *
 * Connect `init` → starting value (before the first iteration).
 * Connect `next` → new value to carry forward (computed inside the loop).
 * Use `value` → current iteration's value.
 *
 * This enables patterns like the classic UV fractal fold:
 *   uv = fract(uv * 1.5) - 0.5;  (mirrored UV's output → next, mirrored UV reads value)
 *
 * The compiler handles this specially inside iterated groups:
 *   Before loop: T carry = init;
 *   Inside loop: <all nodes see carry as "value">
 *   End of loop: carry = next;
 */
export const LoopCarryNode: NodeDefinition = {
  type: 'loopCarry',
  label: 'Loop Carry',
  category: 'Loop',
  description: 'Carry variable across loop iterations. Init = starting value, Next = updated value each iteration, Value = current iteration value.',

  inputs: {
    init: { type: 'vec2', label: 'Init' },
    next: { type: 'vec2', label: 'Next' },
  },
  outputs: {
    value: { type: 'vec2', label: 'Value' },
  },

  defaultParams: {
    dataType: 'vec2' as DataType,
  },

  paramDefs: {
    dataType: {
      label: 'Type',
      type: 'select',
      options: [
        { value: 'float', label: 'float' },
        { value: 'vec2',  label: 'vec2'  },
        { value: 'vec3',  label: 'vec3'  },
        { value: 'vec4',  label: 'vec4'  },
      ],
    },
  },

  // Stub — compiler handles this node specially for iterated groups
  generateGLSL: (node, _inputVars) => {
    const t = (node.params.dataType as DataType | undefined) ?? 'vec2';
    return {
      code: '',
      outputVars: { value: `${t}(0.0)` },
    };
  },
};

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
