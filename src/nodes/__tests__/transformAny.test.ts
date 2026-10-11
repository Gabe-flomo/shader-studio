import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { parser } from '@shaderfrog/glsl-parser';
import { getNodeDefinition } from '../definitions';
import { TransformNode, retypeTransform, transformSockets } from '../definitions/transformAny';
import { Place2DNode } from '../definitions/scene2d';
import { migrateNodeParams, type GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';

const node = (dim: '2' | '3' | '4', extra: Record<string, unknown> = {}): GraphNode => {
  const s = transformSockets(dim);
  return { id: 't', type: 'transform', position: { x: 0, y: 0 }, params: { ...TransformNode.defaultParams, dim, ...extra }, inputs: s.inputs, outputs: s.outputs } as GraphNode;
};

describe('Transform 2D (was Place 2D)', () => {
  it('is called Transform 2D, keeps its type id, and is still found as Place 2D', () => {
    const def = getNodeDefinition('place2D')!;
    expect(def.label).toBe('Transform 2D');
    expect(def.type).toBe(Place2DNode.type);
    expect(def.aliases).toContain('Place 2D');
  });
});

describe('Transform (2D, 3D or 4D)', () => {
  it('is registered', () => {
    expect(getNodeDefinition('transform')?.label).toBe(TransformNode.label);
  });

  it('its sockets follow the Dimension, keeping wires that still fit', () => {
    const n2 = { ...node('2'), inputs: { ...node('2').inputs, grow: { ...node('2').inputs.grow, connection: { nodeId: 'm', outputKey: 'grow' } }, p: { ...node('2').inputs.p, connection: { nodeId: 'uv', outputKey: 'uv' } } } };
    const n3 = retypeTransform({ ...n2, params: { ...n2.params, dim: '3' } });
    expect(n3.inputs.p.type).toBe('vec3');
    expect(n3.outputs.p.type).toBe('vec3');
    expect(n3.inputs.turn.type).toBe('vec3');
    expect(n3.inputs.p.connection).toBeUndefined(); // a vec2 wire no longer fits
    expect(n3.inputs.grow.connection).toEqual({ nodeId: 'm', outputKey: 'grow' });
    const n4 = retypeTransform({ ...n3, params: { ...n3.params, dim: '4' } });
    expect(n4.inputs.p.type).toBe('vec4');
    expect(n4.inputs.turn).toBeUndefined();
    // Loading runs the same sync.
    const loaded = migrateNodeParams({ ...node('2'), params: { ...node('2').params, dim: '4' } }, getNodeDefinition);
    expect(loaded.outputs.p.type).toBe('vec4');
  });

  it('2D: the same maths as Transform 2D', () => {
    const { code } = TransformNode.generateGLSL(node('2', { x: 0.5, rotate: 90, scale: 2 }), { p: 'uv' });
    expect(code).toContain('vec2 t_q = uv - (vec2(0.5, 0.0));');
    expect(code).toContain('t_q = trfUnturn(t_q, 90.0 * 0.017453292519943295);');
    expect(code).toContain('vec2 t_p = t_q / t_scale;');
  });

  for (const dim of ['2', '3', '4'] as const) {
    it(`${dim}D: its GLSL parses with the helper`, () => {
      const { code } = TransformNode.generateGLSL(node(dim, { rx: 10, rxw: 20 }), dim === '2' ? {} : { p: `vec${dim}(0.1)` });
      const src = `precision highp float;\nvarying vec2 vUv;\n${TransformNode.glslFunction}\nvoid main() {\n vec2 g_uv = vUv;\n${code} gl_FragColor = vec4(t_scale);\n}`;
      expect(() => parser.parse(src, { quiet: true })).not.toThrow();
    });
  }

  it('compiles in a graph (2D, into a Circle SDF)', () => {
    const uv = { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, params: {}, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } } as unknown as GraphNode;
    const t = { ...node('2'), inputs: { ...node('2').inputs, p: { ...node('2').inputs.p, connection: { nodeId: 'uv', outputKey: 'uv' } } } };
    const out = { id: 'out', type: 'output', position: { x: 0, y: 0 }, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 't', outputKey: 'scale' } } }, outputs: {} } as unknown as GraphNode;
    const r = compileGraph({ nodes: [uv, t, out] });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toContain('trfUnturn');
  });
});
