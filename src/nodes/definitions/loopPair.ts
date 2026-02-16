import type { NodeDefinition } from '../../types/nodeGraph';

/**
 * Loop Start / Loop End pair nodes.
 *
 * Usage:
 *   1. Add a LoopStart node — it has a `carry` input (your initial value) and a `carry` output.
 *   2. Add a LoopEnd node — it has a `carry` input and a `result` output.
 *      Set `iterations` on the LoopEnd node (1–16).
 *   3. Wire nodes between them: LoopStart.carry → nodeA → nodeB → LoopEnd.carry
 *   4. The compiler detects the Start→End chain and unrolls it N times inline.
 *
 * The carry type is inferred from the wire type (float / vec2 / vec3 / vec4).
 * Body nodes get their carry-type input auto-injected each iteration.
 * All other inputs (params, time, UV, etc.) work normally.
 *
 * The compiler special-cases these nodes — generateGLSL is a stub.
 */

// ─── Loop Start ────────────────────────────────────────────────────────────────

export const LoopStartNode: NodeDefinition = {
  type: 'loopStart',
  label: 'Loop Start',
  category: 'Loops',
  description: 'Marks the beginning of a wired loop chain. Connect its output through one or more nodes to a Loop End node. The carry type is determined by the wire.',

  inputs:  { carry: { type: 'vec2', label: 'Initial value' } },
  outputs: { carry: { type: 'vec2', label: 'Carry →' } },

  defaultParams: {},
  paramDefs: {},

  // Pass-through: output = input (the compiler handles the actual unrolling)
  generateGLSL: (node, inputVars) => {
    const carry = inputVars['carry'] ?? 'vec2(0.0)';
    const id = node.id;
    // Carry type is stored on the node's output socket (updated when connected)
    const outType = Object.values(node.outputs)[0]?.type ?? 'vec2';
    return {
      code: `    ${outType} ${id}_carry = ${carry};\n`,
      outputVars: { carry: `${id}_carry` },
    };
  },
};

// ─── Loop End ─────────────────────────────────────────────────────────────────

export const LoopEndNode: NodeDefinition = {
  type: 'loopEnd',
  label: 'Loop End',
  category: 'Loops',
  description: 'Marks the end of a wired loop chain. Set iterations to control how many times the chain between Loop Start and here is repeated. The result is the final carry value after all iterations.',

  inputs:  { carry: { type: 'vec2', label: '← Carry in' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },

  defaultParams: { iterations: 4 },
  paramDefs: {
    iterations: { label: 'Iterations', type: 'float', min: 1, max: 16, step: 1 },
  },

  // Stub — real unrolled GLSL emitted by graphCompiler.ts
  generateGLSL: (_node, _inputVars) => ({
    code: '',
    outputVars: { result: 'vec2(0.0)' },
  }),
};

// ─── Example: UV Distort Loop ──────────────────────────────────────────────────
// Pair these with Loop Start → [your distort nodes] → Loop End

/**
 * Loop Ripple Step — distorts a vec2 UV by a sin-based ripple each iteration.
 * Use inside a Loop Start/End chain with vec2 carry.
 *
 *   carry → RippleStep → Loop End (iterations=6)
 *
 * Produces a classic UV-warp feedback ripple.
 */
export const LoopRippleStepNode: NodeDefinition = {
  type: 'loopRippleStep',
  label: 'Ripple Step',
  category: 'Loops',
  description: 'Applies one iteration of UV ripple distortion. Wire inside a Loop Start → Loop End chain (vec2 carry). Each pass warps UV by sin/cos of scaled coordinates + time.',

  inputs:  { uv: { type: 'vec2', label: 'UV' } },
  outputs: { uv: { type: 'vec2', label: 'UV out' } },

  defaultParams: { scale: 3.0, speed: 1.0, strength: 0.12 },
  paramDefs: {
    scale:    { label: 'Scale',    type: 'float', min: 0.1, max: 20.0, step: 0.1 },
    speed:    { label: 'Speed',    type: 'float', min: 0.0, max: 5.0,  step: 0.01 },
    strength: { label: 'Strength', type: 'float', min: 0.0, max: 1.0,  step: 0.005 },
  },

  generateGLSL: (node, inputVars) => {
    const uv  = inputVars['uv'] ?? 'vec2(0.0)';
    const sc  = typeof node.params.scale    === 'number' ? node.params.scale.toFixed(3)    : '3.000';
    const sp  = typeof node.params.speed    === 'number' ? node.params.speed.toFixed(3)    : '1.000';
    const str = typeof node.params.strength === 'number' ? node.params.strength.toFixed(4) : '0.1200';
    const id  = node.id;
    return {
      code: [
        `    vec2 ${id}_s = ${uv} * ${sc};`,
        `    vec2 ${id}_uv = ${uv} + vec2(`,
        `        sin(${id}_s.y + u_time * ${sp}) * ${str},`,
        `        cos(${id}_s.x + u_time * ${sp}) * ${str}`,
        `    );`,
        '',
      ].join('\n'),
      outputVars: { uv: `${id}_uv` },
    };
  },
};

/**
 * Loop Rotate Step — rotates a vec2 UV by a small angle each iteration.
 * Use inside a Loop Start/End chain with vec2 carry.
 *
 *   carry → RotateStep → Loop End (iterations=8)
 *
 * Produces a spiral / rotation feedback effect.
 */
export const LoopRotateStepNode: NodeDefinition = {
  type: 'loopRotateStep',
  label: 'Rotate Step',
  category: 'Loops',
  description: 'Rotates a vec2 UV by `angle` radians each iteration. Wire inside a Loop Start → Loop End chain (vec2 carry). Great for spiral and kaleidoscope effects.',

  inputs:  { uv: { type: 'vec2', label: 'UV' } },
  outputs: { uv: { type: 'vec2', label: 'UV out' } },

  defaultParams: { angle: 0.3, scale: 1.02 },
  paramDefs: {
    angle: { label: 'Angle (rad)', type: 'float', min: -3.14159, max: 3.14159, step: 0.01 },
    scale: { label: 'Scale/iter', type: 'float', min: 0.5, max: 2.0, step: 0.01 },
  },

  generateGLSL: (node, inputVars) => {
    const uv = inputVars['uv'] ?? 'vec2(0.0)';
    const a  = typeof node.params.angle === 'number' ? node.params.angle.toFixed(5) : '0.30000';
    const sc = typeof node.params.scale === 'number' ? node.params.scale.toFixed(4) : '1.0200';
    const id = node.id;
    return {
      code: [
        `    float ${id}_c = cos(${a}), ${id}_s = sin(${a});`,
        `    vec2 ${id}_uv = mat2(${id}_c, -${id}_s, ${id}_s, ${id}_c) * ${uv} * ${sc};`,
        '',
      ].join('\n'),
      outputVars: { uv: `${id}_uv` },
    };
  },
};

/**
 * Loop Domain Fold — applies abs() fold + offset each iteration.
 * Classic fractal/IFS technique. Use with vec2 carry.
 *
 *   carry → DomainFold → Loop End (iterations=6–10)
 *
 * Creates Menger-sponge-like folded domain patterns.
 */
export const LoopDomainFoldNode: NodeDefinition = {
  type: 'loopDomainFold',
  label: 'Domain Fold',
  category: 'Loops',
  description: 'Applies abs()-mirror fold + scale + offset each iteration — a classic IFS/fractal technique. Wire inside a Loop Start → Loop End chain (vec2 carry, 6–10 iterations recommended).',

  inputs:  { uv: { type: 'vec2', label: 'UV' } },
  outputs: { uv: { type: 'vec2', label: 'UV out' } },

  defaultParams: { scale: 1.8, offsetX: 0.5, offsetY: 0.3 },
  paramDefs: {
    scale:   { label: 'Scale',    type: 'float', min: 0.5, max: 4.0, step: 0.01 },
    offsetX: { label: 'Offset X', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    offsetY: { label: 'Offset Y', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
  },

  generateGLSL: (node, inputVars) => {
    const uv  = inputVars['uv'] ?? 'vec2(0.0)';
    const sc  = typeof node.params.scale   === 'number' ? node.params.scale.toFixed(4)   : '1.8000';
    const ox  = typeof node.params.offsetX === 'number' ? node.params.offsetX.toFixed(4) : '0.5000';
    const oy  = typeof node.params.offsetY === 'number' ? node.params.offsetY.toFixed(4) : '0.3000';
    const id  = node.id;
    return {
      code: [
        `    vec2 ${id}_uv = abs(${uv}) * ${sc} - vec2(${ox}, ${oy});`,
        '',
      ].join('\n'),
      outputVars: { uv: `${id}_uv` },
    };
  },
};

/**
 * Loop Float Accumulate — accumulates a float value each iteration.
 * Each pass adds sin(carry * scale + time * speed).
 * Wire LoopStart (float carry) → FloatAccumulate → LoopEnd.
 */
export const LoopFloatAccumulateNode: NodeDefinition = {
  type: 'loopFloatAccumulate',
  label: 'Float Accumulate',
  category: 'Loops',
  description: 'Accumulates a float value by adding sin(carry * scale + time * speed) each iteration. Wire inside a Loop Start → Loop End chain (float carry). Produces oscillating build-up patterns.',

  inputs:  { value: { type: 'float', label: 'Value' } },
  outputs: { value: { type: 'float', label: 'Value out' } },

  defaultParams: { scale: 2.0, speed: 1.0, amplitude: 0.15 },
  paramDefs: {
    scale:     { label: 'Scale',     type: 'float', min: 0.01, max: 20.0, step: 0.1 },
    speed:     { label: 'Speed',     type: 'float', min: 0.0,  max: 5.0,  step: 0.01 },
    amplitude: { label: 'Amplitude', type: 'float', min: 0.0,  max: 2.0,  step: 0.01 },
  },

  generateGLSL: (node, inputVars) => {
    const v   = inputVars['value'] ?? '0.0';
    const sc  = typeof node.params.scale     === 'number' ? node.params.scale.toFixed(3)     : '2.000';
    const sp  = typeof node.params.speed     === 'number' ? node.params.speed.toFixed(3)     : '1.000';
    const amp = typeof node.params.amplitude === 'number' ? node.params.amplitude.toFixed(4) : '0.1500';
    const id  = node.id;
    return {
      code: `    float ${id}_value = ${v} + sin(${v} * ${sc} + u_time * ${sp}) * ${amp};\n`,
      outputVars: { value: `${id}_value` },
    };
  },
};
