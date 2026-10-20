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
  category: 'Loops',
  description: 'Carry variable across loop iterations. Init = starting value, Next = updated value each iteration, Value = current iteration value. Use with an iterated group (iterations > 1) and Loop Index; step nodes like Ring Step or Domain Fold produce Next.',

  inputs: {
    init: { type: 'vec2', label: 'Init', hint: 'Starting value, evaluated once before the first iteration.' },
    next: { type: 'vec2', label: 'Next', hint: 'Value fed forward into the next iteration.' },
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
      type: 'select', hint: 'Type of the carried value. Must match what Init and Next are wired to.',
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

/**
 * LoopBreak — stops an iterated group early, like GLSL's `break`.
 *
 * Wire a 0/1 mask into When (a Compare: |z| > 2, a step smaller than 0.001…). At the end of each pass, after
 * the Loop Carries and the group's outputs have taken this pass's values, the compiler emits
 * `if (when > 0.5) break;`, so every carry keeps the value it had when the pass that tripped it ended: the
 * escape-time fractals' `for (…) { z = z*z + c; n++; if (dot(z, z) > 256.0) break; }`.
 *
 * Outside an iterated group (Iterations 1, or the top level) there is no loop to stop: it does nothing.
 * Several Loop Breaks in one group: any of them stops it.
 */
export const LoopBreakNode: NodeDefinition = {
  type: 'loopBreak',
  label: 'Loop Break',
  aliases: ['Break', 'Break when', 'Escape', 'Stop loop'],
  category: 'Loops',
  description: 'Stops an iterated group early: when When is 1 at the end of a pass, the loop ends there, and every Loop Carry keeps the value that pass gave it. Wire a Compare into When (|z| above 2 for a Mandelbrot, a step below 0.001 for Newton). It saves the passes a pixel no longer needs; outside an iterated group it does nothing.',

  inputs: {
    when: { type: 'float', label: 'When', hint: 'Above 0.5 at the end of a pass: stop the loop. A Compare\'s Mask is the usual wire; unwired it never stops.' },
  },
  outputs: {},
  assignable: false,

  // The compiler emits the break itself (shaderAssembler, iterated groups); this only names the condition.
  generateGLSL: (node, inputVars) => {
    const v = `${node.id}_when`;
    return { code: `    float ${v} = ${inputVars.when || '0.0'};\n`, outputVars: { when: v } };
  },
};

