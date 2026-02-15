import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

export const AddNode: NodeDefinition = {
  type: 'add', label: 'Add', category: 'Math', description: 'Add two float values (a + b)',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { b: 0.0 },
  paramDefs: { b: { label: 'B', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = ${inputVars.a || '0.0'} + ${inputVars.b || f(typeof node.params.b === 'number' ? node.params.b : 0.0)};\n`, outputVars: { result: o } };
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
    return { code: `    float ${o} = ${inputVars.a || '0.0'} - ${inputVars.b || f(typeof node.params.b === 'number' ? node.params.b : 0.0)};\n`, outputVars: { result: o } };
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
    return { code: `    float ${o} = ${inputVars.a || '1.0'} * ${inputVars.b || f(typeof node.params.b === 'number' ? node.params.b : 1.0)};\n`, outputVars: { result: o } };
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
    return { code: `    float ${o} = ${inputVars.a || '0.0'} / max(${inputVars.b || f(typeof node.params.b === 'number' ? node.params.b : 1.0)}, 0.0001);\n`, outputVars: { result: o } };
  },
};

export const SinNode: NodeDefinition = {
  type: 'sin', label: 'Sin', category: 'Math', description: 'Sine of input: amp * sin(input * freq).',
  inputs: { input: { type: 'float', label: 'Input' }, freq: { type: 'float', label: 'Freq' }, amp: { type: 'float', label: 'Amp' } },
  outputs: { output: { type: 'float', label: 'Output' } },
  defaultParams: { freq: 1.0, amp: 1.0 },
  paramDefs: { freq: { label: 'Freq', type: 'float', min: 0.01, max: 20, step: 0.01 }, amp: { label: 'Amplitude', type: 'float', min: 0, max: 5, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    const freq = inputVars.freq || f(typeof node.params.freq === 'number' ? node.params.freq : 1.0);
    const amp  = inputVars.amp  || f(typeof node.params.amp  === 'number' ? node.params.amp  : 1.0);
    return { code: `    float ${o} = ${amp} * sin(${inputVars.input || '0.0'} * ${freq});\n`, outputVars: { output: o } };
  },
};

export const CosNode: NodeDefinition = {
  type: 'cos', label: 'Cos', category: 'Math', description: 'Cosine of input: amp * cos(input * freq).',
  inputs: { input: { type: 'float', label: 'Input' }, freq: { type: 'float', label: 'Freq' }, amp: { type: 'float', label: 'Amp' } },
  outputs: { output: { type: 'float', label: 'Output' } },
  defaultParams: { freq: 1.0, amp: 1.0 },
  paramDefs: { freq: { label: 'Freq', type: 'float', min: 0.01, max: 20, step: 0.01 }, amp: { label: 'Amplitude', type: 'float', min: 0, max: 5, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    const freq = inputVars.freq || f(typeof node.params.freq === 'number' ? node.params.freq : 1.0);
    const amp  = inputVars.amp  || f(typeof node.params.amp  === 'number' ? node.params.amp  : 1.0);
    return { code: `    float ${o} = ${amp} * cos(${inputVars.input || '0.0'} * ${freq});\n`, outputVars: { output: o } };
  },
};

export const ExpNode: NodeDefinition = {
  type: 'exp', label: 'Exp', category: 'Math', description: 'exp(input × scale).',
  inputs: { input: { type: 'float', label: 'Input' }, scale: { type: 'float', label: 'Scale' } },
  outputs: { output: { type: 'float', label: 'Output' } },
  defaultParams: { scale: 1.0 },
  paramDefs: { scale: { label: 'Scale', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    const s = inputVars.scale || f(typeof node.params.scale === 'number' ? node.params.scale : 1.0);
    return { code: `    float ${o} = exp(${inputVars.input || '0.0'} * ${s});\n`, outputVars: { output: o } };
  },
};

export const PowNode: NodeDefinition = {
  type: 'pow', label: 'Pow', category: 'Math', description: 'base ^ exponent.',
  inputs: { base: { type: 'float', label: 'Base' }, exponent: { type: 'float', label: 'Exponent' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { exponent: 1.2 },
  paramDefs: { exponent: { label: 'Exponent', type: 'float', min: 0, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    const e = inputVars.exponent || f(typeof node.params.exponent === 'number' ? node.params.exponent : 1.2);
    return { code: `    float ${o} = pow(max(${inputVars.base || '1.0'}, 0.0), ${e});\n`, outputVars: { result: o } };
  },
};

export const NegateNode: NodeDefinition = {
  type: 'negate', label: 'Negate', category: 'Math', description: 'Negate a float (-x).',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    return { code: `    float ${o} = -(${inputVars.input || '0.0'});\n`, outputVars: { output: o } };
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
    const s = inputVars.scale || f(typeof node.params.scale === 'number' ? node.params.scale : 1.0);
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
    const s = inputVars.scale || f(typeof node.params.scale === 'number' ? node.params.scale : 1.0);
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

export const MaxNode: NodeDefinition = {
  type: 'max', label: 'Max', category: 'Math', description: 'Maximum of two floats.',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { b: 0.0 },
  paramDefs: { b: { label: 'B', type: 'float', min: -10, max: 10, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_result`;
    return { code: `    float ${o} = max(${inputVars.a || '0.0'}, ${inputVars.b || f(typeof node.params.b === 'number' ? node.params.b : 0.0)});\n`, outputVars: { result: o } };
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
    const lo = inputVars.lo || f(typeof node.params.lo === 'number' ? node.params.lo : 0.0);
    const hi = inputVars.hi || f(typeof node.params.hi === 'number' ? node.params.hi : 1.0);
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
    const t = inputVars.t || f(typeof node.params.t === 'number' ? node.params.t : 0.5);
    return { code: `    float ${o} = mix(${inputVars.a || '0.0'}, ${inputVars.b || '1.0'}, ${t});\n`, outputVars: { result: o } };
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
    const p = inputVars.period || f(typeof node.params.period === 'number' ? node.params.period : 1.0);
    return { code: `    float ${o} = mod(${inputVars.input || '0.0'}, ${p});\n`, outputVars: { output: o } };
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
    const o = `${node.id}_output`;
    return { code: `    float ${o} = floor(${inputVars.input || '0.0'});\n`, outputVars: { output: o } };
  },
};

export const SqrtNode: NodeDefinition = {
  type: 'sqrt', label: 'Sqrt', category: 'Math', description: 'Square root.',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    return { code: `    float ${o} = sqrt(max(${inputVars.input || '0.0'}, 0.0));\n`, outputVars: { output: o } };
  },
};

export const RoundNode: NodeDefinition = {
  type: 'round', label: 'Round', category: 'Math', description: 'Round to nearest integer.',
  inputs: { input: { type: 'float', label: 'Input' } }, outputs: { output: { type: 'float', label: 'Output' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_output`;
    return { code: `    float ${o} = floor(${inputVars.input || '0.0'} + 0.5);\n`, outputVars: { output: o } };
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
    const x = inputVars.x || f(typeof node.params.x === 'number' ? node.params.x : 0.0);
    const y = inputVars.y || f(typeof node.params.y === 'number' ? node.params.y : 0.0);
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

export const MakeVec3Node: NodeDefinition = {
  type: 'makeVec3', label: 'Make Vec3', category: 'Math', description: 'Build a vec3 color from three float values.',
  inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
  outputs: { rgb: { type: 'vec3', label: 'RGB' } },
  defaultParams: { r: 0.0, g: 0.0, b: 0.0 },
  paramDefs: { r: { label: 'R', type: 'float', min: 0, max: 1, step: 0.01 }, g: { label: 'G', type: 'float', min: 0, max: 1, step: 0.01 }, b: { label: 'B', type: 'float', min: 0, max: 1, step: 0.01 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const o = `${node.id}_rgb`;
    const r = inputVars.r || f(typeof node.params.r === 'number' ? node.params.r : 0.0);
    const g = inputVars.g || f(typeof node.params.g === 'number' ? node.params.g : 0.0);
    const b = inputVars.b || f(typeof node.params.b === 'number' ? node.params.b : 0.0);
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
    const o = `${node.id}_output`;
    return { code: `    float ${o} = fract(${inputVars.input || '0.0'});\n`, outputVars: { output: o } };
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
    const e0 = inputVars.edge0 || f(typeof node.params.edge0 === 'number' ? node.params.edge0 : 0.0);
    const e1 = inputVars.edge1 || f(typeof node.params.edge1 === 'number' ? node.params.edge1 : 1.0);
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
    const s = inputVars.scale || f(typeof node.params.scale === 'number' ? node.params.scale : 1.0);
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
