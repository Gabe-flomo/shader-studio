import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, p } from './helpers';

// sdBox, sdSegment, sdEllipse, opRepeat, opRepeatPolar are now always-available
// built-ins emitted by shaderAssembler.ts — no per-node glslFunction needed.

export const SdBoxNode: NodeDefinition = {
  type: 'sdBox', label: 'sdBox', category: '2D Primitives',
  description: 'Signed distance to a 2D box (IQ)',
  inputs: {
    p: { type: 'vec2', label: 'P' },
    b: { type: 'vec2', label: 'Half-size' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  // sdBox is now a built-in — no glslFunction needed
  generateGLSL: (node: GraphNode, inputVars) => {
    const p = inputVars['p'] ?? 'vec2(0.0)';
    const b = inputVars['b'] ?? `vec2(${f(node.params.bx as number ?? 0.3)}, ${f(node.params.by as number ?? 0.3)})`;
    const outVar = `${node.id}_distance`;
    return {
      code: `    float ${outVar} = sdBox(${p}, ${b});\n`,
      outputVars: { distance: outVar },
    };
  },
  defaultParams: { bx: 0.3, by: 0.3 },
};

export const SdSegmentNode: NodeDefinition = {
  type: 'sdSegment', label: 'sdSegment', category: '2D Primitives',
  description: 'Signed distance to a 2D line segment (IQ)',
  inputs: {
    p: { type: 'vec2', label: 'P' },
    a: { type: 'vec2', label: 'A' },
    b: { type: 'vec2', label: 'B' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  // sdSegment is now a built-in — no glslFunction needed
  generateGLSL: (node: GraphNode, inputVars) => {
    const p = inputVars['p'] ?? 'vec2(0.0)';
    const a = inputVars['a'] ?? 'vec2(-0.5, 0.0)';
    const b2 = inputVars['b'] ?? 'vec2(0.5, 0.0)';
    const outVar = `${node.id}_distance`;
    return {
      code: `    float ${outVar} = sdSegment(${p}, ${a}, ${b2});\n`,
      outputVars: { distance: outVar },
    };
  },
};

export const SdEllipseNode: NodeDefinition = {
  type: 'sdEllipse', label: 'sdEllipse', category: '2D Primitives',
  description: 'Signed distance to a 2D ellipse (IQ)',
  inputs: {
    p:  { type: 'vec2', label: 'P' },
    ab: { type: 'vec2', label: 'Radii (a,b)' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  // sdEllipse is now a built-in — no glslFunction needed
  generateGLSL: (node: GraphNode, inputVars) => {
    const p  = inputVars['p']  ?? 'vec2(0.0)';
    const ab = inputVars['ab'] ?? 'vec2(0.5, 0.25)';
    const outVar = `${node.id}_distance`;
    return {
      code: `    float ${outVar} = sdEllipse(${p}, ${ab});\n`,
      outputVars: { distance: outVar },
    };
  },
};

export const OpRepeatNode: NodeDefinition = {
  type: 'opRepeat', label: 'opRepeat', category: 'Spaces',
  description: 'Infinite domain repetition — tiles p every s units',
  inputs: {
    p: { type: 'vec2', label: 'P' },
    s: { type: 'float', label: 'Spacing' },
  },
  outputs: { result: { type: 'vec2', label: 'Tiled P' } },
  // opRepeat is now a built-in — no glslFunction needed
  generateGLSL: (node: GraphNode, inputVars) => {
    const p = inputVars['p'] ?? 'vec2(0.0)';
    const s = inputVars['s'] ?? f(node.params.s as number ?? 1.0);
    const outVar = `${node.id}_result`;
    return {
      code: `    vec2 ${outVar} = opRepeat(${p}, ${s});\n`,
      outputVars: { result: outVar },
    };
  },
  defaultParams: { s: 1.0 },
};

export const OpRepeatPolarNode: NodeDefinition = {
  type: 'opRepeatPolar', label: 'opRepeatPolar', category: 'Spaces',
  description: 'Polar domain repetition — n-fold rotational symmetry',
  inputs: {
    p: { type: 'vec2', label: 'P' },
    n: { type: 'float', label: 'Segments' },
  },
  outputs: { result: { type: 'vec2', label: 'Tiled P' } },
  // opRepeatPolar is now a built-in — no glslFunction needed
  generateGLSL: (node: GraphNode, inputVars) => {
    const p = inputVars['p'] ?? 'vec2(0.0)';
    const n = inputVars['n'] ?? f(node.params.n as number ?? 6.0);
    const outVar = `${node.id}_result`;
    return {
      code: `    vec2 ${outVar} = opRepeatPolar(${p}, ${n});\n`,
      outputVars: { result: outVar },
    };
  },
  defaultParams: { n: 6.0 },
};

// ─── SDF Offset ───────────────────────────────────────────────────────────────
// sdf + amount: expands (negative) or shrinks (positive) the zero-crossing.
export const SdfOffsetNode: NodeDefinition = {
  type: 'sdfOffset',
  label: 'SDF Offset',
  category: 'SDF',
  description: 'Expands or shrinks a shape by offsetting the zero-crossing: sdf + amount. Negative = expand, positive = shrink. Rounds corners as a side effect.',
  inputs: {
    sdf:    { type: 'float', label: 'SDF'    },
    amount: { type: 'float', label: 'Amount' },
  },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { amount: -0.05 },
  paramDefs: {
    amount: { label: 'Amount', type: 'float', min: -0.3, max: 0.3, step: 0.005 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const sdf = inputVars.sdf    ?? '0.0';
    const amt = inputVars.amount ?? p(node.params.amount, -0.05);
    return {
      code: `    float ${id}_result = ${sdf} + (${amt});\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

// ─── SDF Sharpen ──────────────────────────────────────────────────────────────
// sdf * sharpness: steepens or flattens the gradient without moving the zero-crossing.
export const SdfSharpenNode: NodeDefinition = {
  type: 'sdfSharpen',
  label: 'SDF Sharpen',
  category: 'SDF',
  description: 'Steepens (>1) or flattens (<1) the distance gradient without moving the zero-crossing. Use before smoothstep for harder or softer edges.',
  inputs: { sdf: { type: 'float', label: 'SDF' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { sharpness: 2.0 },
  paramDefs: {
    sharpness: { label: 'Sharpness', type: 'float', min: 0.1, max: 10.0, step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const sdf = inputVars.sdf ?? '0.0';
    const shp = p(node.params.sharpness, 2.0);
    return {
      code: `    float ${id}_result = ${sdf} * ${shp};\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

// ─── SDF Smooth Union 2D ─────────────────────────────────────────────────────
// smin blend of two SDFs. Outputs merged SDF + blend factor for material interpolation.
export const Sdf2dSmoothUnionNode: NodeDefinition = {
  type: 'sdf2dSmoothUnion',
  label: 'Smooth Union 2D',
  category: 'SDF',
  description: 'Blends two SDFs with smin — organic merged boundary. Also outputs a blend factor (0=A, 1=B) for color or material interpolation at the merge zone.',
  inputs: {
    sdfA: { type: 'float', label: 'SDF A' },
    sdfB: { type: 'float', label: 'SDF B' },
  },
  outputs: {
    result: { type: 'float', label: 'Result' },
    blend:  { type: 'float', label: 'Blend'  },
  },
  defaultParams: { k: 0.12 },
  paramDefs: {
    k: { label: 'Blend k', type: 'float', min: 0.01, max: 0.5, step: 0.005 },
  },
  glslFunction: `vec2 sdf2dSmoothUnionFn(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    float d = mix(b, a, h) - k * h * (1.0 - h);
    return vec2(d, h);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const a  = inputVars.sdfA ?? '0.0';
    const b  = inputVars.sdfB ?? '0.0';
    const k  = p(node.params.k, 0.12);
    return {
      code: `    vec2  ${id}_su     = sdf2dSmoothUnionFn(${a}, ${b}, ${k});\n` +
            `    float ${id}_result = ${id}_su.x;\n` +
            `    float ${id}_blend  = ${id}_su.y;\n`,
      outputVars: { result: `${id}_result`, blend: `${id}_blend` },
    };
  },
};

// ─── SDF Onion 2D ─────────────────────────────────────────────────────────────
// abs(sdf) - thickness: converts any shape into a hollow shell.
export const Sdf2dOnionNode: NodeDefinition = {
  type: 'sdf2dOnion',
  label: 'SDF Onion 2D',
  category: 'SDF',
  description: 'Converts any shape into a hollow shell: abs(sdf) - thickness. Chain multiple times or use in a looped group for concentric rings.',
  inputs: { sdf: { type: 'float', label: 'SDF' } },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { thickness: 0.02 },
  paramDefs: {
    thickness: { label: 'Thickness', type: 'float', min: 0.001, max: 0.1, step: 0.001 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const sdf = inputVars.sdf ?? '0.0';
    const t   = p(node.params.thickness, 0.02);
    return {
      code: `    float ${id}_result = abs(${sdf}) - ${t};\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};
