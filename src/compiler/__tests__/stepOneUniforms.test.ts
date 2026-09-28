/**
 * A slider's step says nothing about how the compiler treats it. A whole-number
 * slider (Max Dist, Angle°, Count X…) is a live `u_p_*` uniform like any other
 * float, so dragging it is a uniform write, not a shader recompile. Only params
 * declared `compileTime: true` (loop bounds, JS-side branches) stay baked.
 */
import { describe, it, expect } from 'vitest';
import { patchNodeParamsForUniforms } from '../uniformPatcher';
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';

const def: NodeDefinition = {
  type: 'stepOneProbe',
  label: 'Step One Probe',
  category: 'Test',
  inputs: {},
  outputs: { out: { type: 'float', label: 'Out' } },
  defaultParams: { maxDist: 20, loops: 4, soft: 0.5 },
  paramDefs: {
    maxDist: { label: 'Max Dist', type: 'float', min: 5, max: 100, step: 1 },
    loops:   { label: 'Loops',    type: 'float', min: 1, max: 8,   step: 1, compileTime: true },
    soft:    { label: 'Soft',     type: 'float', min: 0, max: 1,   step: 0.01 },
  },
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

const node: GraphNode = {
  id: 'probe', type: 'stepOneProbe', position: { x: 0, y: 0 },
  inputs: {}, outputs: { out: { type: 'float', label: 'Out' } },
  params: { maxDist: 20, loops: 4, soft: 0.5 },
};

describe('step-1 float params', () => {
  it('become uniforms unless declared compileTime', () => {
    const { patchedNode, uniforms, bindings } = patchNodeParamsForUniforms(node, def);
    expect(patchedNode.params.maxDist).toBe('u_p_probe_maxDist');
    expect(uniforms.u_p_probe_maxDist).toBe(20);
    expect(bindings['probe::maxDist']).toBe('u_p_probe_maxDist');

    expect(patchedNode.params.loops).toBe(4);
    expect(Object.keys(uniforms).some(u => u.endsWith('_loops'))).toBe(false);
    expect(bindings['probe::loops']).toBeUndefined();

    expect(patchedNode.params.soft).toBe('u_p_probe_soft');
  });
});
