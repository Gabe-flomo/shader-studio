import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

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
  type: 'opRepeat', label: 'opRepeat', category: '2D Primitives',
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
  type: 'opRepeatPolar', label: 'opRepeatPolar', category: '2D Primitives',
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
