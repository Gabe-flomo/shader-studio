import { describe, expect, it } from 'vitest';
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

const graph = (): GraphNode[] => [
  { id: 'c1', type: 'colorPicker', position: { x: 0, y: 0 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'Color' }, r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } }, params: { color: [0.25, 0.5, 1] } },
  { id: 'out', type: 'output', position: { x: 200, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'c1', outputKey: 'rgb' } } }, outputs: {}, params: {} },
];

describe('Color (picker) node', () => {
  it('is registered under Color with a vec3color param and vec3 + channel outputs', () => {
    const d = getNodeDefinition('colorPicker')!;
    expect(d.category).toBe('Color');
    expect(d.paramDefs?.color.type).toBe('vec3color');
    expect(Object.keys(d.outputs)).toEqual(['rgb', 'r', 'g', 'b']);
  });
  it('compiles to a live vec3 uniform read by the shader', () => {
    const r = compileGraph({ nodes: graph() });
    expect(r.errors ?? []).toEqual([]);
    const uni = Object.keys(r.paramUniforms).find(k => k.endsWith('_color'));
    expect(uni).toBeTruthy();
    expect(r.paramUniforms[uni!]).toEqual([0.25, 0.5, 1]);
    expect(r.fragmentShader).toMatch(new RegExp(`vec3 \\w+_rgb = ${uni};`));
  });
});
