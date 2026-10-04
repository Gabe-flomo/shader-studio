/**
 * An Expression Block's own sliders are live uniforms: a drag writes the uniform
 * instead of recompiling (inside an Agents group a recompile also restarted the
 * simulation). A slider turned off stays baked.
 */
import { describe, expect, it } from 'vitest';
import { patchNodeParamsForUniforms } from '../uniformPatcher';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

const expr = (sliderOn: boolean): GraphNode => ({
  id: 'crowd_1', type: 'exprNode', position: { x: 0, y: 0 }, outputs: {},
  inputs: { r: { type: 'vec3', label: 'r' }, sat: { type: 'float', label: 'sat' } },
  params: { inputs: [{ name: 'r', type: 'vec3', slider: null }, { name: 'sat', type: 'float', slider: sliderOn ? { min: 1, max: 300 } : null }], sat: 60, expr: 'r * exp(-r / sat)', outputType: 'vec3' },
});

describe('Expression Block sliders', () => {
  it('become uniforms with a binding the store can find', () => {
    const n = expr(true);
    const { patchedNode, uniforms, bindings } = patchNodeParamsForUniforms(n, getNodeDefinitionFor(n)!, undefined, 'crowd_1');
    expect(patchedNode.params.sat).toBe('u_p_crowdx1_sat');
    expect(uniforms).toEqual({ u_p_crowdx1_sat: 60 });
    expect(bindings).toEqual({ 'crowd_1::sat': 'u_p_crowdx1_sat' });
  });

  it('stay baked when the slider is off', () => {
    const n = expr(false);
    const { patchedNode, uniforms } = patchNodeParamsForUniforms(n, getNodeDefinitionFor(n)!, undefined, 'crowd_1');
    expect(patchedNode.params.sat).toBe(60);
    expect(uniforms).toEqual({});
  });
});
