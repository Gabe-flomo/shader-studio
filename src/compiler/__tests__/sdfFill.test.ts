import { describe, expect, it } from 'vitest';
import { compileGraph } from '../graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';

const mk = (id: string, type: string, x: number, params: Record<string, unknown> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  return { id, type, position: { x, y: 0 }, inputs: JSON.parse(JSON.stringify(def.inputs)), outputs: JSON.parse(JSON.stringify(def.outputs)), params: { ...def.defaultParams, ...params } };
};

describe('sdfFill', () => {
  it('compiles with every stroke alignment and resolves the old sdfOutline type', () => {
    for (const strokeAlign of ['center', 'inside', 'outside']) {
      const uv = mk('uv', 'uv', 0); const c = mk('c', 'circleSDF', 200); const f = mk('f', 'sdfFill', 400, { strokeAlign, strokeWidth: 0.03 }); const o = mk('o', 'output', 600);
      c.inputs.position.connection = { nodeId: 'uv', outputKey: 'uv' };
      f.inputs.d.connection = { nodeId: 'c', outputKey: 'distance' };
      o.inputs.color.connection = { nodeId: 'f', outputKey: 'result' };
      const r = compileGraph({ nodes: [uv, c, f, o] } as never);
      expect(r.errors, strokeAlign).toBeUndefined();
      expect(r.fragmentShader).toMatch(/_fill\s*=\s*1\.0 - smoothstep/);
    }
    expect(getNodeDefinition('sdfOutline')?.type).toBe('sdfFill');
  });
});
