import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// sdBox, sdSegment, sdEllipse, opRepeat, opRepeatPolar are now always-available
// built-ins emitted by shaderAssembler.ts — no per-node glslFunction needed.


export const SdSegmentNode: NodeDefinition = {
  type: 'sdSegment', label: 'Line Segment SDF', aliases: ['sdSegment'], category: '2D Primitives',
  description: 'Signed distance to a 2D line segment (IQ)',
  inputs: {
    p: { type: 'vec2', label: 'UV' },
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
  type: 'sdEllipse', label: 'Ellipse SDF', aliases: ['sdEllipse'], category: '2D Primitives',
  description: 'Signed distance to a 2D ellipse (IQ)',
  inputs: {
    p:  { type: 'vec2', label: 'UV' },
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



// ─── SDF Offset ───────────────────────────────────────────────────────────────
// sdf + amount: expands (negative) or shrinks (positive) the zero-crossing.
export const SdfOffsetNode: NodeDefinition = {
  type: 'sdfOffset',
  label: 'Offset',
  category: 'SDF', subcategory: 'Modify', aliases: ['round', 'inflate', 'erode'],
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
  label: 'Sharpen',
  category: 'SDF', subcategory: 'Modify',
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

// ─── SDF Onion 2D ─────────────────────────────────────────────────────────────
// abs(sdf) - thickness: converts any shape into a hollow shell.
