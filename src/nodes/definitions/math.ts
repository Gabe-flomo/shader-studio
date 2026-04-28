import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, zeroFor } from './helpers';

// ── Vector-type helper ────────────────────────────────────────────────────────
// Returns 'float'|'vec2'|'vec3' from params, defaulting to 'float'.
function ot(node: GraphNode): string {
  return (typeof node.params.outputType === 'string' ? node.params.outputType : 'float');
}

export const AddNode: NodeDefinition = {
  type: 'add', label: 'Add', category: 'Math', description: 'Add two float values (a + b)',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { b: 0.0 },
  paramDefs: { b: { label: 'B', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = ${inputVars.a || '0.0'} + ${inputVars.b || p(node.params.b, 0.0)};\n`, outputVars: { result: o } };
  },
};

export const SubtractNode: NodeDefinition = {
  type: 'subtract', label: 'Subtract', category: 'Math', description: 'Subtract b from a (a - b)',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { b: 0.0 },
  paramDefs: { b: { label: 'B', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = ${inputVars.a || '0.0'} - ${inputVars.b || p(node.params.b, 0.0)};\n`, outputVars: { result: o } };
  },
};

export const MultiplyNode: NodeDefinition = {
  type: 'multiply', label: 'Multiply', category: 'Math', description: 'Multiply two float values (a × b).',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { b: 1.0 },
  paramDefs: { b: { label: 'B', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = ${inputVars.a || '1.0'} * ${inputVars.b || p(node.params.b, 1.0)};\n`, outputVars: { result: o } };
  },
};

export const DivideNode: NodeDefinition = {
  type: 'divide', label: 'Divide', category: 'Math', description: 'Divide a by b (a / b).',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { b: 1.0 },
  paramDefs: { b: { label: 'B (divisor)', type: 'float', min: 0.0001, max: 10, step: 0.001 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = ${inputVars.a || '0.0'} / max(${inputVars.b || p(node.params.b, 1.0)}, 0.0001);\n`, outputVars: { result: o } };
  },
};

export const SinNode: NodeDefinition = {
  type: 'sin', label: 'Sin', category: 'Math', description: 'Sine of input: amp * sin(input * freq).',
  inputs: { input: { type: 'float', label: 'Input' }, freq: { type: 'float', label: 'Freq' }, amp: { type: 'float', label: 'Amp' } },
  outputs: { output: { type: 'float', label: 'Output' } },
  defaultParams: { freq: 1.0, amp: 1.0 },
  paramDefs: { freq: { label: 'Freq', type: 'float', min: 0.01, max: 20, step: 0.01 }, amp: { label: 'Amplitude', type: 'float', min: 0, max: 5, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_output`;
    const freq = inputVars.freq || p(node.params.freq, 1.0);
    const amp  = inputVars.amp  || p(node.params.amp, 1.0);
    return { code: `    ${t} ${o} = ${amp} * sin(${inputVars.input || zeroFor(t)} * ${freq});\n`, outputVars: { output: o } };
  },
};

export const CosNode: NodeDefinition = {
  type: 'cos', label: 'Cos', category: 'Math', description: 'Cosine of input: amp * cos(input * freq).',
  inputs: { input: { type: 'float', label: 'Input' }, freq: { type: 'float', label: 'Freq' }, amp: { type: 'float', label: 'Amp' } },
  outputs: { output: { type: 'float', label: 'Output' } },
  defaultParams: { freq: 1.0, amp: 1.0 },
  paramDefs: { freq: { label: 'Freq', type: 'float', min: 0.01, max: 20, step: 0.01 }, amp: { label: 'Amplitude', type: 'float', min: 0, max: 5, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_output`;
    const freq = inputVars.freq || p(node.params.freq, 1.0);
    const amp  = inputVars.amp  || p(node.params.amp, 1.0);
    return { code: `    ${t} ${o} = ${amp} * cos(${inputVars.input || zeroFor(t)} * ${freq});\n`, outputVars: { output: o } };
  },
};

export const ExpNode: NodeDefinition = {
  type: 'exp', label: 'Exp', category: 'Math', description: 'exp(input × scale).',
  inputs: { input: { type: 'float', label: 'Input' }, scale: { type: 'float', label: 'Scale' } },
  outputs: { output: { type: 'float', label: 'Output' } },
  defaultParams: { scale: 1.0 },
  paramDefs: { scale: { label: 'Scale', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_output`;
    const s = inputVars.scale || p(node.params.scale, 1.0);
    return { code: `    ${t} ${o} = exp(${inputVars.input || zeroFor(t)} * ${s});\n`, outputVars: { output: o } };
  },
};

export const PowNode: NodeDefinition = {
  type: 'pow', label: 'Pow', category: 'Math', description: 'base ^ exponent.',
  inputs: { base: { type: 'float', label: 'Base' }, exponent: { type: 'float', label: 'Exponent' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { exponent: 1.2 },
  paramDefs: { exponent: { label: 'Exponent', type: 'float', min: 0, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_result`;
    const e = inputVars.exponent || p(node.params.exponent, 1.2);
    // pow() requires both args to be the same genType — broadcast scalar exponent when vectorized
    const ecast = t !== 'float' ? `${t}(${e})` : e;
    const base  = inputVars.base || (t === 'float' ? '1.0' : `${t}(1.0)`);
    return { code: `    ${t} ${o} = pow(max(${base}, 0.0), ${ecast});\n`, outputVars: { result: o } };
  },
};

export const NegateNode: NodeDefinition = {
  type: 'negate', label: 'Negate', category: 'Math', description: 'Negate a float (-x).',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_output`;
    return { code: `    ${t} ${o} = -(${inputVars.input || zeroFor(t)});\n`, outputVars: { output: o } };
  },
};

export const LengthNode: NodeDefinition = {
  type: 'length', label: 'Length', category: 'Math', description: 'Distance from a vec2 to the origin, multiplied by scale.',
  inputs: { input: { type: 'vec2', label: 'Input' }, scale: { type: 'float', label: 'Scale' } },
  outputs: { output: { type: 'float', label: 'Output' } },
  defaultParams: { scale: 1.0 },
  paramDefs: { scale: { label: 'Scale', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    const s = inputVars.scale || p(node.params.scale, 1.0);
    return { code: `    float ${o} = length(${inputVars.input || 'vec2(0.0)'}) * ${s};\n`, outputVars: { output: o } };
  },
};

export const MultiplyVec3Node: NodeDefinition = {
  type: 'multiplyVec3', label: 'Scale Color', category: 'Math', description: 'Scale a vec3 color by a float intensity.',
  inputs: { color: { type: 'vec3', label: 'Color' }, scale: { type: 'float', label: 'Scale' } },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { scale: 1.0 },
  paramDefs: { scale: { label: 'Scale', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    const s = inputVars.scale || p(node.params.scale, 1.0);
    return { code: `    vec3 ${o} = ${inputVars.color || 'vec3(1.0)'} * ${s};\n`, outputVars: { result: o } };
  },
};

export const AddVec3Node: NodeDefinition = {
  type: 'addVec3', label: 'Add Colors', category: 'Math', description: 'Add two vec3 colors together.',
  inputs: { a: { type: 'vec3', label: 'A' }, b: { type: 'vec3', label: 'B' } },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    vec3 ${o} = ${inputVars.a || 'vec3(0.0)'} + ${inputVars.b || 'vec3(0.0)'};\n`, outputVars: { result: o } };
  },
};

export const TanhNode: NodeDefinition = {
  type: 'tanh', label: 'Tanh', category: 'Math', description: 'Hyperbolic tangent.',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    return { code: `    float ${o} = tanh(${inputVars.input || '0.0'});\n`, outputVars: { output: o } };
  },
};

export const MinMathNode: NodeDefinition = {
  type: 'minMath', label: 'Min', category: 'Math', description: 'Minimum of two floats.',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { b: 0.0 },
  paramDefs: { b: { label: 'B', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = min(${inputVars.a || '0.0'}, ${inputVars.b || p(node.params.b, 0.0)});\n`, outputVars: { result: o } };
  },
};

export const MaxNode: NodeDefinition = {
  type: 'max', label: 'Max', category: 'Math', description: 'Maximum of two floats.',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { b: 0.0 },
  paramDefs: { b: { label: 'B', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = max(${inputVars.a || '0.0'}, ${inputVars.b || p(node.params.b, 0.0)});\n`, outputVars: { result: o } };
  },
};

export const ClampNode: NodeDefinition = {
  type: 'clamp', label: 'Clamp', category: 'Math', description: 'Clamp a value between min and max.',
  inputs: { input: { type: 'float', label: 'Input' }, lo: { type: 'float', label: 'Min' }, hi: { type: 'float', label: 'Max' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { lo: 0.0, hi: 1.0 },
  paramDefs: { lo: { label: 'Min', type: 'float', min: -10, max: 10, step: 0.01 }, hi: { label: 'Max', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    const lo = inputVars.lo || p(node.params.lo, 0.0);
    const hi = inputVars.hi || p(node.params.hi, 1.0);
    return { code: `    float ${o} = clamp(${inputVars.input || '0.0'}, ${lo}, ${hi});\n`, outputVars: { result: o } };
  },
};

export const MixNode: NodeDefinition = {
  type: 'mix', label: 'Mix', category: 'Math', description: 'Linear interpolation: mix(a, b, t).',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' }, t: { type: 'float', label: 'T' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { t: 0.5 },
  paramDefs: { t: { label: 'T', type: 'float', min: 0, max: 1, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    const t = inputVars.t || p(node.params.t, 0.5);
    return { code: `    float ${o} = mix(${inputVars.a || '0.0'}, ${inputVars.b || '1.0'}, ${t});\n`, outputVars: { result: o } };
  },
};

export const MixVec3Node: NodeDefinition = {
  type: 'mixVec3', label: 'Mix (Color)', category: 'Math',
  description: 'Blend two vec3 colors: mix(a, b, fac). fac=0 → A, fac=1 → B.',
  inputs: { a: { type: 'vec3', label: 'A' }, b: { type: 'vec3', label: 'B' }, fac: { type: 'float', label: 'Fac' } },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { fac: 0.5 },
  paramDefs: { fac: { label: 'Fac', type: 'float', min: 0, max: 1, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    const fac = inputVars.fac || p(node.params.fac, 0.5);
    return { code: `    vec3 ${o} = mix(${inputVars.a || 'vec3(0.0)'}, ${inputVars.b || 'vec3(1.0)'}, ${fac});\n`, outputVars: { result: o } };
  },
};

export const ModNode: NodeDefinition = {
  type: 'mod', label: 'Mod', category: 'Math', description: 'Modulo: mod(x, period).',
  inputs: { input: { type: 'float', label: 'Input' }, period: { type: 'float', label: 'Period' } },
  outputs: { output: { type: 'float', label: 'Output' } },
  defaultParams: { period: 1.0 },
  paramDefs: { period: { label: 'Period', type: 'float', min: 0.001, max: 10, step: 0.001 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    const period = inputVars.period || p(node.params.period, 1.0);
    return { code: `    float ${o} = mod(${inputVars.input || '0.0'}, ${period});\n`, outputVars: { output: o } };
  },
};

export const Atan2Node: NodeDefinition = {
  type: 'atan2', label: 'Atan2', category: 'Math', description: 'Polar angle: atan(y, x).',
  inputs: { y: { type: 'float', label: 'Y' }, x: { type: 'float', label: 'X' } },
  outputs: { angle: { type: 'float', label: 'Angle' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_angle`;
    return { code: `    float ${o} = atan(${inputVars.y || '0.0'}, ${inputVars.x || '1.0'});\n`, outputVars: { angle: o } };
  },
};

export const CeilNode: NodeDefinition = {
  type: 'ceil', label: 'Ceil', category: 'Math', description: 'Round up to nearest integer.',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    return { code: `    float ${o} = ceil(${inputVars.input || '0.0'});\n`, outputVars: { output: o } };
  },
};

export const FloorNode: NodeDefinition = {
  type: 'floor', label: 'Floor', category: 'Math', description: 'Round down to nearest integer.',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_output`;
    return { code: `    ${t} ${o} = floor(${inputVars.input || zeroFor(t)});\n`, outputVars: { output: o } };
  },
};

export const SqrtNode: NodeDefinition = {
  type: 'sqrt', label: 'Sqrt', category: 'Math', description: 'Square root.',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_output`;
    return { code: `    ${t} ${o} = sqrt(max(${inputVars.input || zeroFor(t)}, 0.0));\n`, outputVars: { output: o } };
  },
};

export const RoundNode: NodeDefinition = {
  type: 'round', label: 'Round', category: 'Math', description: 'Round to nearest integer.',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_output`;
    return { code: `    ${t} ${o} = floor(${inputVars.input || zeroFor(t)} + 0.5);\n`, outputVars: { output: o } };
  },
};

export const DotNode: NodeDefinition = {
  type: 'dot', label: 'Dot', category: 'Math', description: 'Dot product of two vec2 inputs.',
  inputs: { a: { type: 'vec2', label: 'A' }, b: { type: 'vec2', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = dot(${inputVars.a || 'vec2(0.0)'}, ${inputVars.b || 'vec2(0.0)'});\n`, outputVars: { result: o } };
  },
};

export const MakeVec2Node: NodeDefinition = {
  type: 'makeVec2', label: 'Make Vec2', category: 'Math', description: 'Build a vec2 from two float values.',
  inputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } },
  outputs: { xy: { type: 'vec2', label: 'XY' } },
  defaultParams: { x: 0.0, y: 0.0 },
  paramDefs: { x: { label: 'X', type: 'float', min: -2, max: 2, step: 0.01 }, y: { label: 'Y', type: 'float', min: -2, max: 2, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_xy`;
    const x = inputVars.x || p(node.params.x, 0.0);
    const y = inputVars.y || p(node.params.y, 0.0);
    return { code: `    vec2 ${o} = vec2(${x}, ${y});\n`, outputVars: { xy: o } };
  },
};

export const ExtractXNode: NodeDefinition = {
  type: 'extractX', label: 'Extract X', category: 'Math', description: 'Extract the X component (.x) from a vec2.',
  inputs: { v: { type: 'vec2', label: 'Vec2' } }, outputs: { x: { type: 'float', label: 'X' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_x`;
    return { code: `    float ${o} = (${inputVars.v || 'vec2(0.0)'}).x;\n`, outputVars: { x: o } };
  },
};

export const ExtractYNode: NodeDefinition = {
  type: 'extractY', label: 'Extract Y', category: 'Math', description: 'Extract the Y component (.y) from a vec2.',
  inputs: { v: { type: 'vec2', label: 'Vec2' } }, outputs: { y: { type: 'float', label: 'Y' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_y`;
    return { code: `    float ${o} = (${inputVars.v || 'vec2(0.0)'}).y;\n`, outputVars: { y: o } };
  },
};

export const SplitVec2Node: NodeDefinition = {
  type: 'splitVec2', label: 'Split Vec2', category: 'Math', description: 'Extract X and Y float components from a vec2.',
  inputs:  { v: { type: 'vec2', label: 'Vec2' } },
  outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const v  = inputVars.v || 'vec2(0.0)';
    return {
      code: `    float ${id}_x = (${v}).x;\n    float ${id}_y = (${v}).y;\n`,
      outputVars: { x: `${id}_x`, y: `${id}_y` },
    };
  },
};

export const SplitVec3Node: NodeDefinition = {
  type: 'splitVec3', label: 'Split Vec3', category: 'Math', description: 'Extract X, Y, and Z float components from a vec3.',
  inputs:  { v: { type: 'vec3', label: 'Vec3' } },
  outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' }, z: { type: 'float', label: 'Z' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const v  = inputVars.v || 'vec3(0.0)';
    return {
      code: `    float ${id}_x = (${v}).x;\n    float ${id}_y = (${v}).y;\n    float ${id}_z = (${v}).z;\n`,
      outputVars: { x: `${id}_x`, y: `${id}_y`, z: `${id}_z` },
    };
  },
};

export const SplitVec4Node: NodeDefinition = {
  type: 'splitVec4', label: 'Split Vec4', category: 'Math', description: 'Extract X, Y, Z, and W float components from a vec4.',
  inputs:  { v: { type: 'vec4', label: 'Vec4' } },
  outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' }, z: { type: 'float', label: 'Z' }, w: { type: 'float', label: 'W' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const v  = inputVars.v || 'vec4(0.0)';
    return {
      code: `    float ${id}_x = (${v}).x;\n    float ${id}_y = (${v}).y;\n    float ${id}_z = (${v}).z;\n    float ${id}_w = (${v}).w;\n`,
      outputVars: { x: `${id}_x`, y: `${id}_y`, z: `${id}_z`, w: `${id}_w` },
    };
  },
};

export const MakeVec3Node: NodeDefinition = {
  type: 'makeVec3', label: 'Make Vec3', category: 'Math', description: 'Build a vec3 color from three float values.',
  inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
  outputs: { rgb: { type: 'vec3', label: 'RGB' } },
  defaultParams: { r: 0.0, g: 0.0, b: 0.0 },
  paramDefs: { r: { label: 'R', type: 'float', min: 0, max: 1, step: 0.01 }, g: { label: 'G', type: 'float', min: 0, max: 1, step: 0.01 }, b: { label: 'B', type: 'float', min: 0, max: 1, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_rgb`;
    const r = inputVars.r || p(node.params.r, 0.0);
    const g = inputVars.g || p(node.params.g, 0.0);
    const b = inputVars.b || p(node.params.b, 0.0);
    return { code: `    vec3 ${o} = vec3(${r}, ${g}, ${b});\n`, outputVars: { rgb: o } };
  },
};

export const FloatToVec3Node: NodeDefinition = {
  type: 'floatToVec3', label: 'Float → Color', category: 'Math', description: 'Convert a float to a grayscale vec3.',
  inputs: { input: { type: 'float', label: 'Float' } }, outputs: { rgb: { type: 'vec3', label: 'Color' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_rgb`;
    return { code: `    vec3 ${o} = vec3(${inputVars.input || '0.0'});\n`, outputVars: { rgb: o } };
  },
};

export const FractRawNode: NodeDefinition = {
  type: 'fractRaw', label: 'Fract (scalar)', category: 'Math', description: 'Raw fract(x) on a float.',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), o = `${node.id}_output`;
    return { code: `    ${t} ${o} = fract(${inputVars.input || zeroFor(t)});\n`, outputVars: { output: o } };
  },
};

export const SmoothstepNode: NodeDefinition = {
  type: 'smoothstep', label: 'Smoothstep', category: 'Math', description: 'smoothstep(edge0, edge1, x).',
  inputs: { value: { type: 'float', label: 'Value' }, edge0: { type: 'float', label: 'Edge 0' }, edge1: { type: 'float', label: 'Edge 1' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { edge0: 0.0, edge1: 1.0 },
  paramDefs: { edge0: { label: 'Edge 0', type: 'float', min: -2, max: 2, step: 0.001 }, edge1: { label: 'Edge 1', type: 'float', min: -2, max: 2, step: 0.001 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    const e0 = inputVars.edge0 || p(node.params.edge0, 0.0);
    const e1 = inputVars.edge1 || p(node.params.edge1, 1.0);
    return { code: `    float ${o} = smoothstep(${e0}, ${e1}, ${inputVars.value || '0.0'});\n`, outputVars: { result: o } };
  },
};

export const AddVec2Node: NodeDefinition = {
  type: 'addVec2', label: 'Add Vec2', category: 'Math', description: 'Add two vec2 values.',
  inputs: { a: { type: 'vec2', label: 'A' }, b: { type: 'vec2', label: 'B' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    vec2 ${o} = (${inputVars.a || 'vec2(0.0)'}) + (${inputVars.b || 'vec2(0.0)'});\n`, outputVars: { result: o } };
  },
};

export const MultiplyVec2Node: NodeDefinition = {
  type: 'multiplyVec2', label: 'Scale Vec2', category: 'Math', description: 'Scale a vec2 by a float.',
  inputs: { v: { type: 'vec2', label: 'Vec2' }, scale: { type: 'float', label: 'Scale' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },
  defaultParams: { scale: 1.0 },
  paramDefs: { scale: { label: 'Scale', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    const s = inputVars.scale || p(node.params.scale, 1.0);
    return { code: `    vec2 ${o} = (${inputVars.v || 'vec2(0.0)'}) * ${s};\n`, outputVars: { result: o } };
  },
};

export const NormalizeVec2Node: NodeDefinition = {
  type: 'normalizeVec2', label: 'Normalize Vec2', category: 'Math', description: 'Normalize a vec2 to unit length.',
  inputs: { v: { type: 'vec2', label: 'Vec2' } }, outputs: { result: { type: 'vec2', label: 'Result' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    vec2 ${o} = normalize(${inputVars.v || 'vec2(1.0, 0.0)'});\n`, outputVars: { result: o } };
  },
};

export const RemapNode: NodeDefinition = {
  type: 'remap',
  label: 'Remap',
  category: 'Math',
  description: 'Re-map a value from [inMin, inMax] to [outMin, outMax]. Smoothstep mode eases in/out. Great for turning a 0–1 noise into any range you need.',
  inputs: {
    value:  { type: 'float', label: 'Value'      },
    inMin:  { type: 'float', label: 'In Min'     },
    inMax:  { type: 'float', label: 'In Max'     },
    outMin: { type: 'float', label: 'Out Min'    },
    outMax: { type: 'float', label: 'Out Max'    },
  },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { inMin: 0.0, inMax: 1.0, outMin: 0.0, outMax: 1.0, smooth: 'linear' },
  paramDefs: {
    inMin:  { label: 'In Min',  type: 'float', min: -10, max: 10, step: 0.01 },
    inMax:  { label: 'In Max',  type: 'float', min: -10, max: 10, step: 0.01 },
    outMin: { label: 'Out Min', type: 'float', min: -10, max: 10, step: 0.01 },
    outMax: { label: 'Out Max', type: 'float', min: -10, max: 10, step: 0.01 },
    smooth: { label: 'Mode', type: 'select', options: [
      { value: 'linear',      label: 'Linear'      },
      { value: 'smoothstep',  label: 'Smoothstep'  },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const val    = inputVars.value  ?? '0.0';
    const inMin  = inputVars.inMin  ?? p(node.params.inMin,  0.0);
    const inMax  = inputVars.inMax  ?? p(node.params.inMax,  1.0);
    const outMin = inputVars.outMin ?? p(node.params.outMin, 0.0);
    const outMax = inputVars.outMax ?? p(node.params.outMax, 1.0);
    const smooth = node.params.smooth === 'smoothstep';
    const tExpr  = `clamp((${val} - ${inMin}) / max(${inMax} - ${inMin}, 0.0001), 0.0, 1.0)`;
    const normT  = smooth ? `smoothstep(0.0, 1.0, ${tExpr})` : tExpr;
    return {
      code: `    float ${id}_result = mix(${outMin}, ${outMax}, ${normT});\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

// ─── New Math Nodes (V2) ───────────────────────────────────────────────────────

export const CrossProductNode: NodeDefinition = {
  type: 'crossProduct', label: 'Cross Product', category: 'Math', description: 'Cross product of two vec3 vectors',
  inputs: { a: { type: 'vec3', label: 'A' }, b: { type: 'vec3', label: 'B' } },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const a  = inputVars.a || 'vec3(1.0, 0.0, 0.0)';
    const b  = inputVars.b || 'vec3(0.0, 1.0, 0.0)';
    return {
      code: `    vec3 ${id}_result = cross(${a}, ${b});\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

export const ReflectNode: NodeDefinition = {
  type: 'reflect', label: 'Reflect', category: 'Math', description: 'Reflect incident vector I around normal N',
  inputs: { incident: { type: 'vec3', label: 'Incident' }, normal: { type: 'vec3', label: 'Normal' } },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const i  = inputVars.incident || 'vec3(0.0, -1.0, 0.0)';
    const n  = inputVars.normal   || 'vec3(0.0, 1.0, 0.0)';
    return {
      code: `    vec3 ${id}_result = reflect(${i}, normalize(${n}));\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

export const ComplexMulNode: NodeDefinition = {
  type: 'complexMul', label: 'Complex Mul', category: 'Math', description: 'Multiply two complex numbers (vec2)',
  inputs: { a: { type: 'vec2', label: 'A (re,im)' }, b: { type: 'vec2', label: 'B (re,im)' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const a  = inputVars.a || 'vec2(1.0, 0.0)';
    const b  = inputVars.b || 'vec2(1.0, 0.0)';
    return {
      code: [
        `    vec2 ${id}_av = ${a};\n`,
        `    vec2 ${id}_bv = ${b};\n`,
        `    vec2 ${id}_result = vec2(${id}_av.x*${id}_bv.x - ${id}_av.y*${id}_bv.y, ${id}_av.x*${id}_bv.y + ${id}_av.y*${id}_bv.x);\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};

export const ComplexPowNode: NodeDefinition = {
  type: 'complexPow', label: 'Complex Pow', category: 'Math', description: 'Raise complex number (vec2) to a real power via polar form',
  inputs: { z: { type: 'vec2', label: 'Z (re,im)' }, exponent: { type: 'float', label: 'Exponent' } },
  outputs: { result: { type: 'vec2', label: 'Result' } },
  defaultParams: { exponent: 2.0 },
  paramDefs: { exponent: { label: 'Exponent', type: 'float', min: -8.0, max: 8.0, step: 0.1 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const z  = inputVars.z        || 'vec2(1.0, 0.0)';
    const k  = inputVars.exponent || p(node.params.exponent, 2.0);
    return {
      code: [
        `    vec2  ${id}_zv = ${z};\n`,
        `    float ${id}_r  = length(${id}_zv);\n`,
        `    float ${id}_a  = atan(${id}_zv.y, ${id}_zv.x);\n`,
        `    vec2  ${id}_result = pow(max(${id}_r, 0.00001), ${k}) * vec2(cos(${k}*${id}_a), sin(${k}*${id}_a));\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};

export const AngleToVec2Node: NodeDefinition = {
  type: 'angleToVec2', label: 'Angle → Vec2', category: 'Math', description: 'Convert angle (radians) to unit direction vec2',
  inputs: { angle: { type: 'float', label: 'Angle (rad)' } },
  outputs: { result: { type: 'vec2', label: 'Direction' } },
  defaultParams: { angle: 0.0 },
  paramDefs: { angle: { label: 'Angle', type: 'float', min: -6.2832, max: 6.2832, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const a  = inputVars.angle || p(node.params.angle, 0.0);
    return {
      code: `    vec2 ${id}_result = vec2(cos(${a}), sin(${a}));\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

export const Vec2AngleNode: NodeDefinition = {
  type: 'vec2Angle', label: 'Vec2 → Angle', category: 'Math', description: 'Get angle of a vec2 direction (atan2)',
  inputs: { v: { type: 'vec2', label: 'Vector' } },
  outputs: { result: { type: 'float', label: 'Angle (rad)' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const v  = inputVars.v || 'vec2(1.0, 0.0)';
    return {
      code: `    float ${id}_result = atan((${v}).y, (${v}).x);\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

export const LuminanceNode: NodeDefinition = {
  type: 'luminance', label: 'Luminance', category: 'Math', description: 'Perceptual luminance of a vec3 RGB color (BT.709)',
  inputs: { color: { type: 'vec3', label: 'RGB' } },
  outputs: { result: { type: 'float', label: 'Luminance' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const c  = inputVars.color || 'vec3(0.5)';
    return {
      code: `    float ${id}_result = dot(${c}, vec3(0.2126, 0.7152, 0.0722));\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

export const SignNode: NodeDefinition = {
  type: 'sign', label: 'Sign', category: 'Math', description: 'Sign of a float value (-1, 0, +1)',
  inputs: { value: { type: 'float', label: 'Value' } },
  outputs: { result: { type: 'float', label: 'Sign' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const t = ot(node), id = node.id;
    const v = inputVars.value || zeroFor(t);
    return {
      code: `    ${t} ${id}_result = sign(${v});\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

export const StepNode: NodeDefinition = {
  type: 'step', label: 'Step', category: 'Math', description: 'step(edge, x) — 0 if x < edge, else 1',
  inputs: { edge: { type: 'float', label: 'Edge' }, x: { type: 'float', label: 'X' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { edge: 0.5 },
  paramDefs: { edge: { label: 'Edge', type: 'float', min: -2.0, max: 2.0, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const edge = inputVars.edge || p(node.params.edge, 0.5);
    const x    = inputVars.x   || '0.0';
    return {
      code: `    float ${id}_result = step(${edge}, ${x});\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

export const WeightedAverageNode: NodeDefinition = {
  type: 'weightedAverage',
  label: 'Weighted Average',
  category: 'Math',
  description: 'Weighted average of 2–4 float inputs. Great for combining noise octaves.',
  inputs: {
    a: { type: 'float', label: 'A' },
    b: { type: 'float', label: 'B' },
    c: { type: 'float', label: 'C' },
    d: { type: 'float', label: 'D' },
  },
  outputs: {
    result:       { type: 'float', label: 'Result'       },
    total_weight: { type: 'float', label: 'Total Weight' },
  },
  defaultParams: { w1: 1.0, w2: 1.0, w3: 0.0, w4: 0.0, inputs_used: '2' },
  paramDefs: {
    w1:          { label: 'W1',          type: 'float',  min: 0.0, max: 10.0, step: 0.1 },
    w2:          { label: 'W2',          type: 'float',  min: 0.0, max: 10.0, step: 0.1 },
    w3:          { label: 'W3',          type: 'float',  min: 0.0, max: 10.0, step: 0.1 },
    w4:          { label: 'W4',          type: 'float',  min: 0.0, max: 10.0, step: 0.1 },
    inputs_used: { label: 'Inputs Used', type: 'select', options: [
      { value: '2', label: '2' },
      { value: '3', label: '3' },
      { value: '4', label: '4' },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const aV  = inputVars.a || '0.0';
    const bV  = inputVars.b || '0.0';
    const cV  = inputVars.c || '0.0';
    const dV  = inputVars.d || '0.0';
    const w1  = p(node.params.w1, 1.0);
    const w2  = p(node.params.w2, 1.0);
    const w3  = p(node.params.w3, 0.0);
    const w4  = p(node.params.w4, 0.0);
    const n   = (node.params.inputs_used as string) ?? '2';
    let sumCode: string;
    let wCode: string;
    if (n === '4') {
      sumCode = `${w1} * ${aV} + ${w2} * ${bV} + ${w3} * ${cV} + ${w4} * ${dV}`;
      wCode   = `${w1} + ${w2} + ${w3} + ${w4}`;
    } else if (n === '3') {
      sumCode = `${w1} * ${aV} + ${w2} * ${bV} + ${w3} * ${cV}`;
      wCode   = `${w1} + ${w2} + ${w3}`;
    } else {
      sumCode = `${w1} * ${aV} + ${w2} * ${bV}`;
      wCode   = `${w1} + ${w2}`;
    }
    return {
      code: [
        `    float ${id}_total_weight = max(${wCode}, 0.00001);\n`,
        `    float ${id}_result = (${sumCode}) / ${id}_total_weight;\n`,
      ].join(''),
      outputVars: { result: `${id}_result`, total_weight: `${id}_total_weight` },
    };
  },
};

export const CompareNode: NodeDefinition = {
  type: 'compare',
  label: 'Compare',
  category: 'Conditionals',
  description: 'Compares two floats and outputs a 0/1 mask (soft edges via smoothing).',
  inputs: {
    a: { label: 'A', type: 'float' },
    b: { label: 'B', type: 'float' },
  },
  outputs: { mask: { label: 'Mask', type: 'float' } },
  defaultParams: { operator: '>', smoothing: 0.0 },
  paramDefs: {
    operator: {
      label: 'Operator',
      type: 'select',
      options: [
        { value: '>', label: '>' },
        { value: '<', label: '<' },
        { value: '>=', label: '>=' },
        { value: '<=', label: '<=' },
        { value: '≈', label: '≈ (approx)' },
      ],
    },
    smoothing: { label: 'Smoothing', type: 'float', min: 0.0, max: 1.0, step: 0.01 },
  },
  generateGLSL(node, inputs) {
    const id   = node.id.replace(/-/g, '_');
    const aV   = inputs.a   ?? '0.0';
    const bV   = inputs.b   ?? '0.0';
    const op   = (node.params.operator as string) ?? '>';
    const soft = (node.params.smoothing as number) ?? 0.0;

    let expr: string;
    if (soft > 0) {
      const h = p(soft, 0.0);
      if (op === '>') {
        expr = `smoothstep(${bV} - ${h}, ${bV} + ${h}, ${aV})`;
      } else if (op === '<') {
        expr = `1.0 - smoothstep(${bV} - ${h}, ${bV} + ${h}, ${aV})`;
      } else if (op === '>=') {
        expr = `smoothstep(${bV} - ${h}, ${bV}, ${aV})`;
      } else if (op === '<=') {
        expr = `1.0 - smoothstep(${bV}, ${bV} + ${h}, ${aV})`;
      } else {
        // ≈
        expr = `1.0 - smoothstep(0.0, ${h}, abs(${aV} - ${bV}))`;
      }
    } else {
      if (op === '>') {
        expr = `step(${bV}, ${aV}) * (1.0 - step(${aV}, ${bV}))`;
      } else if (op === '<') {
        expr = `step(${aV}, ${bV}) * (1.0 - step(${bV}, ${aV}))`;
      } else if (op === '>=') {
        expr = `step(${bV}, ${aV})`;
      } else if (op === '<=') {
        expr = `step(${aV}, ${bV})`;
      } else {
        // ≈ hard: exact equality
        expr = `1.0 - step(0.001, abs(${aV} - ${bV}))`;
      }
    }

    return {
      code: `    float ${id}_mask = ${expr};\n`,
      outputVars: { mask: `${id}_mask` },
    };
  },
};

export const SelectNode: NodeDefinition = {
  type: 'select',
  label: 'Select',
  category: 'Conditionals',
  description: 'Selects between two values using a mask (0 → ifFalse, 1 → ifTrue).',
  inputs: {
    mask:    { label: 'Mask',     type: 'float' },
    ifTrue:  { label: 'If True',  type: 'vec3' },
    ifFalse: { label: 'If False', type: 'vec3' },
  },
  outputs: { result: { label: 'Result', type: 'vec3' } },
  defaultParams: { outputType: 'float' },
  paramDefs: {
    outputType: {
      label: 'Output Type',
      type: 'select',
      options: [
        { value: 'float', label: 'float' },
        { value: 'vec2',  label: 'vec2' },
        { value: 'vec3',  label: 'vec3' },
      ],
    },
  },
  generateGLSL(node, inputs) {
    const id      = node.id.replace(/-/g, '_');
    const mask    = inputs.mask    ?? '0.0';
    const ifTrue  = inputs.ifTrue  ?? '0.0';
    const ifFalse = inputs.ifFalse ?? '0.0';
    const outType = (node.params.outputType as string) ?? 'float';

    const zeroFor = (t: string) =>
      t === 'float' ? '0.0' : t === 'vec2' ? 'vec2(0.0)' : 'vec3(0.0)';

    const trueVal  = ifTrue  !== '0.0' ? ifTrue  : zeroFor(outType);
    const falseVal = ifFalse !== '0.0' ? ifFalse : zeroFor(outType);

    return {
      code: `    ${outType} ${id}_result = mix(${falseVal}, ${trueVal}, clamp(${mask}, 0.0, 1.0));\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

// ─── Swizzle Nodes ────────────────────────────────────────────────────────────

export const Vec2SwizzleNode: NodeDefinition = {
  type: 'vec2Swizzle',
  label: 'Vec2 Swizzle',
  category: 'Math',
  description:
    'Reorder vec2 channels. .yx swaps X and Y — useful for axis reflection, ' +
    '90° rotation prep, or feeding one axis into the other. .xx / .yy broadcast a single channel.',
  inputs: {
    input: { type: 'vec2', label: 'Input' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Output' },
  },
  defaultParams: { mode: 'yx' },
  paramDefs: {
    mode: {
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'yx', label: '.yx  (swap X / Y)'  },
        { value: 'xx', label: '.xx  (X broadcast)' },
        { value: 'yy', label: '.yy  (Y broadcast)' },
      ],
    },
  },
  generateGLSL: (node, inputVars) => {
    const id   = node.id;
    const v    = inputVars.input || 'vec2(0.0)';
    const mode = String(node.params.mode || 'yx');
    return {
      code: `    vec2 ${id}_output = ${v}.${mode};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

export const Vec3SwizzleNode: NodeDefinition = {
  type: 'vec3Swizzle',
  label: 'Vec3 Swizzle',
  category: 'Math',
  description:
    'Reorder vec3 channels. .yzx / .zxy are cyclic permutations used for ' +
    'cross-products (a.yzx * b.zxy - a.zxy * b.yzx), component-min (min(v, min(v.yzx, v.zxy))), ' +
    'and color-channel cycling inside loops.',
  inputs: {
    input: { type: 'vec3', label: 'Input' },
  },
  outputs: {
    output: { type: 'vec3', label: 'Output' },
  },
  defaultParams: { mode: 'yzx' },
  paramDefs: {
    mode: {
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'yzx', label: '.yzx  (cycle forward)'  },
        { value: 'zxy', label: '.zxy  (cycle backward)' },
        { value: 'xxy', label: '.xxy  (X, X, Y)'        },
        { value: 'xyy', label: '.xyy  (X, Y, Y)'        },
        { value: 'xxx', label: '.xxx  (X broadcast)'    },
        { value: 'yyy', label: '.yyy  (Y broadcast)'    },
        { value: 'zzz', label: '.zzz  (Z broadcast)'    },
        { value: 'zyx', label: '.zyx  (reverse)'        },
      ],
    },
  },
  generateGLSL: (node, inputVars) => {
    const id   = node.id;
    const v    = inputVars.input || 'vec3(0.0)';
    const mode = String(node.params.mode || 'yzx');
    return {
      code: `    vec3 ${id}_output = ${v}.${mode};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

// ── Transform Vec node ────────────────────────────────────────────────────────

const TRANSFORM_COMPS = ['x', 'y', 'z', 'w'] as const;

function substituteComps(expr: string, id: string, dims: number): string {
  const active = TRANSFORM_COMPS.slice(0, dims);
  return active.reduce(
    (s, c) => s.replace(new RegExp(`\\b${c}\\b`, 'g'), `${id}_${c}_raw`),
    expr,
  );
}

export const TransformVecNode: NodeDefinition = {
  type: 'transformVec',
  label: 'Transform Vec',
  category: 'Math',
  description: 'Split a vector into components, apply per-component GLSL expressions, reassemble.',
  inputs:  { v: { type: 'vec2', label: 'Vec' } },
  outputs: {
    x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' },
    z: { type: 'float', label: 'Z' }, w: { type: 'float', label: 'W' },
    result: { type: 'vec2', label: 'Result' },
  },
  defaultParams: { outputType: 'vec2', exprX: 'x', exprY: 'y', exprZ: 'z', exprW: 'w' },
  paramDefs: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const type = (node.params.outputType as string) || 'vec2';
    const dims = type === 'vec4' ? 4 : type === 'vec3' ? 3 : 2;
    const id   = node.id;
    const v    = inputVars.v || `${type}(0.0)`;
    const active = TRANSFORM_COMPS.slice(0, dims);

    let code = '';
    // Raw splits
    for (const c of active) {
      code += `    float ${id}_${c}_raw = (${v}).${c};\n`;
    }
    // Per-component expressions
    for (const c of active) {
      const paramKey = `expr${c.toUpperCase()}`;
      const raw = typeof node.params[paramKey] === 'string' ? (node.params[paramKey] as string) : c;
      code += `    float ${id}_${c} = ${substituteComps(raw, id, dims)};\n`;
    }
    // Unused components default to 0.0 so their output vars are always declared
    for (const c of TRANSFORM_COMPS.slice(dims)) {
      code += `    float ${id}_${c} = 0.0;\n`;
    }
    // Reassemble
    code += `    ${type} ${id}_result = ${type}(${active.map(c => `${id}_${c}`).join(', ')});\n`;

    const outputVars: Record<string, string> = { result: `${id}_result` };
    for (const c of TRANSFORM_COMPS) outputVars[c] = `${id}_${c}`;
    return { code, outputVars };
  },
};

// ── Vectorizable node registry ────────────────────────────────────────────────
// Nodes that support component-wise operation on vec2/vec3 inputs.
// primaryInput / primaryOutput are the socket keys that change type.
export const VECTORIZABLE_NODES: Record<string, { primaryInput: string; primaryOutput: string }> = {
  sin:      { primaryInput: 'input', primaryOutput: 'output' },
  cos:      { primaryInput: 'input', primaryOutput: 'output' },
  exp:      { primaryInput: 'input', primaryOutput: 'output' },
  pow:      { primaryInput: 'base',  primaryOutput: 'result' },
  negate:   { primaryInput: 'input', primaryOutput: 'output' },
  floor:    { primaryInput: 'input', primaryOutput: 'output' },
  sqrt:     { primaryInput: 'input', primaryOutput: 'output' },
  round:    { primaryInput: 'input', primaryOutput: 'output' },
  fractRaw: { primaryInput: 'input', primaryOutput: 'output' },
  sign:     { primaryInput: 'value', primaryOutput: 'result' },
};
