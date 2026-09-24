import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../graphCompiler';

const echo = (copies: number, delay: number, blend = 'max'): GraphNode => ({
  id: 'e', type: 'echo', position: { x: 0, y: 0 },
  inputs: { uv: { type: 'vec2', label: 'UV' } },
  outputs: { color: { type: 'vec3', label: 'Echoes' }, alpha: { type: 'float', label: 'Coverage' } },
  params: { copies, delay, decay: 0.7, blend },
});
const out: GraphNode = {
  id: 'out', type: 'output', position: { x: 0, y: 0 },
  inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'e', outputKey: 'color' } } }, outputs: {}, params: {},
};

describe('echo node', () => {
  it('declares one sampler per copy and reports the ring the preview must keep', () => {
    const r = compileGraph({ nodes: [echo(3, 8), out] });
    expect(r.success, r.errors?.join()).toBe(true);
    expect(r.echo).toEqual({ copies: 3, delay: 8 });
    expect(r.fragmentShader).toContain('uniform sampler2D u_echo0;');
    expect(r.fragmentShader).toContain('uniform sampler2D u_echo2;');
    expect(r.fragmentShader).not.toContain('u_echo3');
    expect(r.fragmentShader).toContain('texture2D(u_echo2,');
    // decay is a live slider, copies/delay are baked
    expect(Object.keys(r.paramUniforms).some(u => u.endsWith('_decay'))).toBe(true);
    expect(Object.keys(r.paramUniforms).some(u => u.endsWith('_copies') || u.endsWith('_delay'))).toBe(false);
  });

  it('clamps copies and picks the blend', () => {
    const r = compileGraph({ nodes: [echo(50, 2, 'add'), out] });
    expect(r.echo).toEqual({ copies: 6, delay: 2 });
    expect(r.fragmentShader).toContain('u_echo5');
    expect(r.fragmentShader).toMatch(/_color \+= \w+_e0\.rgb/);
  });

  it('reports no ring without an echo node', () => {
    const plain: GraphNode = { id: 'u', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} };
    const o: GraphNode = { ...out, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'u', outputKey: 'uv' } } } };
    expect(compileGraph({ nodes: [plain, o] }).echo).toBeNull();
  });
});
