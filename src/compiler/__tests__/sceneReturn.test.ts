/**
 * A Scene Group compiles to `float mapScene_<slug>(vec3 p) { …; return <var>; }`.
 * The return value used to be "the last float any node emitted", which broke
 * the moment Union grew a second float output (Blend) after Distance: every
 * scene ending in a combiner returned a 0–1 blend factor and the march found
 * nothing. The GI examples went black this way.
 */
import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../graphCompiler';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

type LegacySceneSubgraph = SubgraphData & { outputNodeId?: string; outputKey?: string };

function sceneReturns(nodes: GraphNode[]): string[] {
  const r = compileGraph({ nodes });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  return [...r.fragmentShader.matchAll(/float mapScene_\w+\(vec3 p[^)]*\) \{[\s\S]*?return (\w+);\s*\}/g)].map(m => m[1]);
}

function withSceneSubgraph(nodes: GraphNode[], edit: (sg: LegacySceneSubgraph) => LegacySceneSubgraph): GraphNode[] {
  return nodes.map(n => n.type === 'sceneGroup'
    ? { ...n, params: { ...n.params, subgraph: edit({ ...(n.params.subgraph as LegacySceneSubgraph) }) } }
    : n);
}

describe('scene group return value', () => {
  const gi = EXAMPLE_GRAPHS.giSphereGround.nodes;

  it('honours the legacy outputNodeId / outputKey when present (GI: Sphere & Ground)', () => {
    const returns = sceneReturns(gi);
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatch(/_dist$/);
  });

  it('falls back to the tail node\'s Distance, not its Blend, when nothing names the return', () => {
    const nodes = withSceneSubgraph(gi, sg => { const rest = { ...sg }; delete rest.outputNodeId; delete rest.outputKey; return rest; });
    const returns = sceneReturns(nodes);
    expect(returns[0]).toMatch(/_dist$/);
    expect(returns[0]).not.toMatch(/_blend$/);
  });

  it('lets an explicit output pick a non-primary float', () => {
    const nodes = withSceneSubgraph(gi, sg => ({ ...sg, outputKey: 'blend' }));
    expect(sceneReturns(nodes)[0]).toMatch(/_blend$/);
  });

  it('no bundled example returns a Blend factor as its scene distance', () => {
    const bad: string[] = [];
    for (const [key, ex] of Object.entries(EXAMPLE_GRAPHS)) {
      const r = compileGraph({ nodes: ex.nodes });
      if (!r.success) continue;
      for (const m of r.fragmentShader.matchAll(/float (mapScene_\w+)\(vec3 p[^)]*\) \{[\s\S]*?return (\w+);\s*\}/g)) {
        if (/_blend$/.test(m[2])) bad.push(`${key}: ${m[1]} returns ${m[2]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
