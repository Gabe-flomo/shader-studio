import type { NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';
import { PALETTE_GLSL_FN } from './color';

/**
 * Loop Start / Loop End pair nodes.
 *
 * Usage:
 *   1. Add a LoopStart node — it has a `carry` input (your initial value) and a `carry` output.
 *   2. Add a LoopEnd node — it has a `carry` input and a `result` output.
 *      Set `iterations` on the LoopStart node (1–32).
 *   3. Wire nodes between them: LoopStart.carry → nodeA → nodeB → LoopEnd.carry
 *   4. The compiler detects the Start→End chain and runs a real GLSL for loop.
 *
 * The carry type is set via the carryType dropdown on LoopStart (float / vec2 / vec3 / vec4).
 * Body nodes receive the carry via their connected input each iteration.
 * All other inputs (params, time, UV, etc.) work normally.
 * Float param sockets: connect any float output to a param socket to override the slider.
 *
 * The compiler special-cases loopStart/loopEnd — generateGLSL is a stub.
 */

// ─── Loop Start ────────────────────────────────────────────────────────────────

export const LoopStartNode: NodeDefinition = {
  type: 'loopStart',
  label: 'Loop Start',
  category: 'Loops',
  description: 'Marks the beginning of a wired loop chain. Set iterations (1–32) and carry type here. Connect its carry output through one or more body nodes to a Loop End node. Iter Index exposes the current loop counter as a float.',

  inputs:  { carry: { type: 'vec2', label: 'Initial value' } },
  outputs: {
    carry:      { type: 'vec2',  label: 'Carry →'     },
    iter_index: { type: 'float', label: 'Iter Index'  },
  },

  defaultParams: { iterations: 4, carryType: 'vec2' },
  paramDefs: {
    iterations: { label: 'Iterations', type: 'float', min: 1, max: 32, step: 1 },
    carryType: {
      label: 'Carry Type', type: 'select',
      options: [
        { value: 'float', label: 'Float' },
        { value: 'vec2',  label: 'Vec2'  },
        { value: 'vec3',  label: 'Vec3'  },
        { value: 'vec4',  label: 'Vec4'  },
      ],
    },
  },

  // Stub — the assembler owns the actual carry init; this registers the carry var.
  generateGLSL: (node, inputVars) => {
    const carry   = inputVars['carry'] ?? 'vec2(0.0)';
    const id      = node.id;
    const outType = Object.values(node.outputs)[0]?.type ?? 'vec2';
    return {
      code: `    ${outType} ${id}_carry = ${carry};\n`,
      outputVars: { carry: `${id}_carry`, iter_index: '0.0' },
    };
  },
};

// ─── Loop End ─────────────────────────────────────────────────────────────────

export const LoopEndNode: NodeDefinition = {
  type: 'loopEnd',
  label: 'Loop End',
  category: 'Loops',
  description: 'Marks the end of a wired loop chain. Set iterations on the Loop Start node. The result is the final carry value after all iterations.',

  inputs:  { carry: { type: 'vec2', label: '← Carry in' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },

  defaultParams: {},
  paramDefs: {},

  // Stub — the assembler emits the real GLSL for loop.
  generateGLSL: (_node, _inputVars) => ({
    code: '',
    outputVars: { result: 'vec2(0.0)' },
  }),
};

// ─── Body Nodes ───────────────────────────────────────────────────────────────
// All body nodes support float input sockets for every numeric param.
// When a socket is connected, it overrides the slider for that iteration.
// When unconnected, the slider value is used as a constant.

/**
 * Loop Ripple Step — distorts a vec2 UV by a sin-based ripple each iteration.
 */
export const LoopRippleStepNode: NodeDefinition = {
  type: 'loopRippleStep',
  label: 'Ripple Step',
  category: 'Loops',
  description: 'Applies one iteration of UV ripple distortion (vec2 carry). Each pass warps UV by sin/cos of scaled coordinates + time. Connect floats to scale/speed/strength to animate them.',

  inputs: {
    uv:       { type: 'vec2',  label: 'UV' },
    scale:    { type: 'float', label: 'Scale' },
    speed:    { type: 'float', label: 'Speed' },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: { uv: { type: 'vec2', label: 'UV out' } },

  defaultParams: { scale: 3.0, speed: 1.0, strength: 0.12 },
  paramDefs: {
    scale:    { label: 'Scale',    type: 'float', min: 0.1, max: 20.0, step: 0.1   },
    speed:    { label: 'Speed',    type: 'float', min: 0.0, max: 5.0,  step: 0.01  },
    strength: { label: 'Strength', type: 'float', min: 0.0, max: 1.0,  step: 0.005 },
  },

  generateGLSL: (node, inputVars) => {
    const uv  = inputVars['uv']       ?? 'vec2(0.0)';
    const sc  = inputVars['scale']    ?? p(node.params.scale,    3.000, 3);
    const sp  = inputVars['speed']    ?? p(node.params.speed,    1.000, 3);
    const str = inputVars['strength'] ?? p(node.params.strength, 0.1200, 4);
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
 */
export const LoopRotateStepNode: NodeDefinition = {
  type: 'loopRotateStep',
  label: 'Rotate Step',
  category: 'Loops',
  description: 'Rotates a vec2 UV by `angle` radians each iteration (vec2 carry). Great for spiral and kaleidoscope effects. Wire floats to angle/scale to animate them.',

  inputs: {
    uv:    { type: 'vec2',  label: 'UV' },
    angle: { type: 'float', label: 'Angle' },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: { uv: { type: 'vec2', label: 'UV out' } },

  defaultParams: { angle: 0.3, scale: 1.02 },
  paramDefs: {
    angle: { label: 'Angle (rad)', type: 'float', min: -3.14159, max: 3.14159, step: 0.01 },
    scale: { label: 'Scale/iter',  type: 'float', min: 0.5,      max: 2.0,     step: 0.01 },
  },

  generateGLSL: (node, inputVars) => {
    const uv = inputVars['uv']    ?? 'vec2(0.0)';
    const a  = inputVars['angle'] ?? p(node.params.angle, 0.30000, 5);
    const sc = inputVars['scale'] ?? p(node.params.scale, 1.0200, 4);
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
 * Classic fractal/IFS technique.
 */
export const LoopDomainFoldNode: NodeDefinition = {
  type: 'loopDomainFold',
  label: 'Domain Fold',
  category: 'Loops',
  description: 'Applies abs()-mirror fold + scale + offset each iteration (vec2 carry). Classic IFS/fractal technique. Wire floats to scale/offsetX/offsetY to animate them.',

  inputs: {
    uv:      { type: 'vec2',  label: 'UV' },
    scale:   { type: 'float', label: 'Scale' },
    offsetX: { type: 'float', label: 'Offset X' },
    offsetY: { type: 'float', label: 'Offset Y' },
  },
  outputs: { uv: { type: 'vec2', label: 'UV out' } },

  defaultParams: { scale: 1.8, offsetX: 0.5, offsetY: 0.3 },
  paramDefs: {
    scale:   { label: 'Scale',    type: 'float', min: 0.5,  max: 4.0, step: 0.01 },
    offsetX: { label: 'Offset X', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    offsetY: { label: 'Offset Y', type: 'float', min: -2.0, max: 2.0, step: 0.01 },
  },

  generateGLSL: (node, inputVars) => {
    const uv  = inputVars['uv']      ?? 'vec2(0.0)';
    const sc  = inputVars['scale']   ?? p(node.params.scale,   1.8000, 4);
    const ox  = inputVars['offsetX'] ?? p(node.params.offsetX, 0.5000, 4);
    const oy  = inputVars['offsetY'] ?? p(node.params.offsetY, 0.3000, 4);
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
 */
export const LoopFloatAccumulateNode: NodeDefinition = {
  type: 'loopFloatAccumulate',
  label: 'Float Accumulate',
  category: 'Loops',
  description: 'Accumulates a float carry by adding sin(carry × scale + time × speed) × amplitude each iteration. Wire floats to scale/speed/amplitude to animate them.',

  inputs: {
    value:     { type: 'float', label: 'Value' },
    scale:     { type: 'float', label: 'Scale' },
    speed:     { type: 'float', label: 'Speed' },
    amplitude: { type: 'float', label: 'Amplitude' },
  },
  outputs: { value: { type: 'float', label: 'Value out' } },

  defaultParams: { scale: 2.0, speed: 1.0, amplitude: 0.15 },
  paramDefs: {
    scale:     { label: 'Scale',     type: 'float', min: 0.01, max: 20.0, step: 0.1  },
    speed:     { label: 'Speed',     type: 'float', min: 0.0,  max: 5.0,  step: 0.01 },
    amplitude: { label: 'Amplitude', type: 'float', min: 0.0,  max: 2.0,  step: 0.01 },
  },

  generateGLSL: (node, inputVars) => {
    const v   = inputVars['value']     ?? '0.0';
    const sc  = inputVars['scale']     ?? p(node.params.scale,     2.000, 3);
    const sp  = inputVars['speed']     ?? p(node.params.speed,     1.000, 3);
    const amp = inputVars['amplitude'] ?? p(node.params.amplitude, 0.1500, 4);
    const id  = node.id;
    return {
      code: `    float ${id}_value = ${v} + sin(${v} * ${sc} + u_time * ${sp}) * ${amp};\n`,
      outputVars: { value: `${id}_value` },
    };
  },
};

/**
 * Loop Color Ring Step — fractal rings via vec3 color carry + iter_index.
 *
 * The carry is vec3 (accumulated color). Each iteration:
 *   1. Folds base UV using (iter_index + 1) × scale
 *   2. Computes a ring glow: glow / |sin(d × freq + time)|
 *   3. Adds palette color shifted by iter_index to the carry
 *
 * Wire LoopStart (vec3 carry, 6–8 iterations) → ColorRingStep → LoopEnd.
 * Connect any float output to scale/freq/glow/timeScale/phaseStep to animate them.
 */
export const LoopColorRingStepNode: NodeDefinition = {
  type: 'loopColorRingStep',
  label: 'Color Ring Step',
  category: 'Loops',
  description: 'Fractal ring step with color accumulation (vec3 carry). Each iteration folds UV by (iter+1)×scale, computes a ring glow, and adds palette color shifted by iter_index. Wire any float to animatable params.',

  inputs: {
    color:     { type: 'vec3',  label: 'Color in'   },
    uv:        { type: 'vec2',  label: 'UV'          },
    scale:     { type: 'float', label: 'UV Scale'    },
    freq:      { type: 'float', label: 'Ring Freq'   },
    glow:      { type: 'float', label: 'Glow'        },
    timeScale: { type: 'float', label: 'Time Scale'  },
    phaseStep: { type: 'float', label: 'Phase Step'  },
  },
  outputs: { color: { type: 'vec3', label: 'Color out' } },

  defaultParams: { scale: 1.5, freq: 8.0, glow: 0.005, timeScale: 0.4, phaseStep: 0.4 },
  paramDefs: {
    scale:     { label: 'UV Scale',   type: 'float', min: 0.5,    max: 5.0,  step: 0.01   },
    freq:      { label: 'Ring Freq',  type: 'float', min: 1.0,    max: 20.0, step: 0.1    },
    glow:      { label: 'Glow',       type: 'float', min: 0.0001, max: 0.01, step: 0.0001 },
    timeScale: { label: 'Time Scale', type: 'float', min: 0.0,    max: 2.0,  step: 0.01   },
    phaseStep: { label: 'Phase Step', type: 'float', min: 0.0,    max: 2.0,  step: 0.01   },
  },

  glslFunction: PALETTE_GLSL_FN,

  generateGLSL: (node, inputVars) => {
    const color  = inputVars['color']      ?? 'vec3(0.0)';
    const iter   = inputVars['iter_index'] ?? '0.0';
    const baseUV = inputVars['uv']         ?? 'g_uv';
    const sc = inputVars['scale']     ?? p(node.params.scale,     1.5000, 4);
    const fr = inputVars['freq']      ?? p(node.params.freq,      8.0000, 4);
    const gl = inputVars['glow']      ?? p(node.params.glow,      0.0050, 4);
    const ts = inputVars['timeScale'] ?? p(node.params.timeScale, 0.4000, 4);
    const ps = inputVars['phaseStep'] ?? p(node.params.phaseStep, 0.4000, 4);
    const id = node.id;
    return {
      code: [
        `    vec2  ${id}_uv   = fract(${baseUV} * (${iter} + 1.0) * ${sc}) - 0.5;`,
        `    float ${id}_d    = length(${id}_uv);`,
        `    float ${id}_ring = sin(${id}_d * ${fr} + u_time * ${ts}) / ${fr};`,
        `    float ${id}_g    = ${gl} / abs(${id}_ring);`,
        `    vec3  ${id}_col  = palette(${id}_d + ${iter} * ${ps} + u_time * ${ts}, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));`,
        `    vec3  ${id}_color = ${color} + ${id}_col * ${id}_g;`,
        '',
      ].join('\n'),
      outputVars: { color: `${id}_color` },
    };
  },
};

/**
 * Loop Ring Step — one iteration of the classic fractal rings effect.
 * Use inside a Loop Start/End chain (vec2 carry for UV) or an iterated group.
 */
export const LoopRingStepNode: NodeDefinition = {
  type: 'loopRingStep',
  label: 'Ring Step',
  category: 'Loops',
  description: 'One iteration of the fractal rings effect: folds UV with fract, computes a ring glow, and accumulates palette color. Use inside a Loop Start/End chain or an iterated group. Wire floats to animatable params.',

  inputs: {
    uv:        { type: 'vec2',  label: 'UV'         },
    color:     { type: 'vec3',  label: 'Color in'   },
    scale:     { type: 'float', label: 'Scale'       },
    freq:      { type: 'float', label: 'Freq'        },
    glow:      { type: 'float', label: 'Glow'        },
    timeScale: { type: 'float', label: 'Time Scale'  },
  },
  outputs: {
    uv:    { type: 'vec2', label: 'UV out'    },
    color: { type: 'vec3', label: 'Color out' },
  },

  defaultParams: { scale: 1.5, freq: 8.0, glow: 0.01, timeScale: 0.4 },
  paramDefs: {
    scale:     { label: 'Scale',      type: 'float', min: 0.5,   max: 5.0,  step: 0.01  },
    freq:      { label: 'Freq',       type: 'float', min: 1.0,   max: 20.0, step: 0.1   },
    glow:      { label: 'Glow',       type: 'float', min: 0.001, max: 0.5,  step: 0.001 },
    timeScale: { label: 'Time Scale', type: 'float', min: 0.0,   max: 2.0,  step: 0.01  },
  },

  glslFunction: PALETTE_GLSL_FN,

  generateGLSL: (node, inputVars) => {
    const uv    = inputVars['uv']        ?? 'vec2(0.0)';
    const color = inputVars['color']     ?? 'vec3(0.0)';
    const sc = inputVars['scale']     ?? p(node.params.scale,     1.5000, 4);
    const fr = inputVars['freq']      ?? p(node.params.freq,      8.0000, 4);
    const gl = inputVars['glow']      ?? p(node.params.glow,      0.0100, 4);
    const ts = inputVars['timeScale'] ?? p(node.params.timeScale, 0.4000, 4);
    const id = node.id;
    return {
      code: [
        `    vec2  ${id}_uv   = fract(${uv} * ${sc}) - 0.5;`,
        `    float ${id}_d    = length(${id}_uv);`,
        `    float ${id}_ring = sin(${id}_d * ${fr} + u_time * ${ts}) / ${fr};`,
        `    float ${id}_g    = ${gl} / abs(${id}_ring);`,
        `    vec3  ${id}_col  = palette(${id}_d + u_time * ${ts}, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));`,
        `    vec3  ${id}_color = ${color} + ${id}_col * ${id}_g;`,
        '',
      ].join('\n'),
      outputVars: { uv: `${id}_uv`, color: `${id}_color` },
    };
  },
};
