import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';

// The store module reads localStorage when it loads
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
const { buildCostVariants, measureNodeCosts } = await import('../nodeCost');

const mk = (id: string, type: string, x: number, params: Record<string, unknown> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  return { id, type, position: { x, y: 0 }, inputs: JSON.parse(JSON.stringify(def.inputs)), outputs: JSON.parse(JSON.stringify(def.outputs)), params: { ...def.defaultParams, ...params } };
};

function graph(): GraphNode[] {
  const uv = mk('uv', 'uv', 0); const c = mk('c', 'circleSDF', 200); const g = mk('g', 'glowLayer', 400); const o = mk('o', 'output', 600);
  c.inputs.position.connection = { nodeId: 'uv', outputKey: 'uv' };
  g.inputs.d.connection = { nodeId: 'c', outputKey: 'distance' };
  o.inputs.color.connection = { nodeId: 'g', outputKey: 'result' };
  return [uv, c, g, o];
}

describe('nodeCost', () => {
  it('makes one bypass variant per measurable node and skips sources and the output', () => {
    const { variants, skipped } = buildCostVariants(graph(), []);
    expect(variants.map(v => v.nodeId)).toEqual(['c', 'g']);
    expect(skipped).toEqual(['uv', 'o']);
    expect(variants[0].nodes.find(n => n.id === 'c')?.bypassed).toBe(true);
    expect(variants[0].nodes.find(n => n.id === 'g')?.bypassed).toBeUndefined();
  });

  it('turns measured frame times into per-node costs sorted by size', async () => {
    const times: Record<string, number> = { full: 4, c: 3.5, g: 1 };
    let call = 0;
    // Calls arrive as: baseline, variant c, variant g, baseline again
    const measure = async () => {
      call++;
      if (call === 1 || call === 4) return times.full;
      return call === 2 ? times.c : times.g;
    };
    const report = await measureNodeCosts({ nodes: graph(), scopePath: [], measure, size: { width: 100, height: 50 } });
    expect(report).not.toBeNull();
    expect(report!.baselineMs).toBe(4);
    expect(report!.costs.map(c => c.nodeId)).toEqual(['g', 'c']);
    expect(report!.costs[0].ms).toBe(3);
    expect(report!.costs[0].share).toBe(0.75);
  });

  it('times the whole program list with Pass nodes, and never bypasses a Pass', async () => {
    const uv = mk('uv', 'uv', 0); const c = mk('c', 'circleSDF', 200); const f = mk('f', 'floatToVec3', 300);
    const p = mk('p', 'pass', 400, { scale: '0.5' }); const b = mk('b', 'blurTexture', 500); const o = mk('o', 'output', 600);
    c.inputs.position.connection = { nodeId: 'uv', outputKey: 'uv' };
    f.inputs.input.connection = { nodeId: 'c', outputKey: 'distance' };
    p.inputs.color.connection = { nodeId: 'f', outputKey: 'rgb' };
    b.inputs.texture.connection = { nodeId: 'p', outputKey: 'texture' };
    o.inputs.color.connection = { nodeId: 'b', outputKey: 'color' };
    const nodes = [uv, c, f, p, b, o];
    const { variants, skipped } = buildCostVariants(nodes, []);
    expect(skipped).toContain('p');
    expect(variants.map(v => v.nodeId)).not.toContain('p');
    const seen: Array<number | null> = [];
    const measure = async (_fs: string, _vs: string, _signal?: AbortSignal, passes?: readonly { scale: number }[]) => { seen.push(passes ? passes.length : null); return 1; };
    await measureNodeCosts({ nodes, scopePath: [], measure, size: { width: 100, height: 50 } });
    // Every measurement (baselines and the variants) is handed the pass programs.
    expect(seen.length).toBe(variants.length + 2);
    expect(seen.every(k => k === 1)).toBe(true);
  });
});
