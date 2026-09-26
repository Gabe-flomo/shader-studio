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

  it('a wired Scene Output decides the return, over the legacy fields, extra float outputs and later floats', () => {
    const nodes = withSceneSubgraph(gi, sg => {
      const inner = sg.nodes;
      const sphere = inner.find(n => n.type === 'sphereSDF3D')!;
      const pos = inner.find(n => n.type === 'scenePos')!;
      const stray: GraphNode = {
        id: 'stray', type: 'sphereSDF3D', position: { x: 0, y: 0 }, params: { radius: 2 },
        inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: pos.id, outputKey: 'pos' } }, radius: { type: 'float', label: 'Radius' } },
        outputs: { dist: { type: 'float', label: 'Distance' } },
      };
      const out: GraphNode = {
        id: 'sout', type: 'sceneOutput', position: { x: 0, y: 0 }, params: {},
        inputs: { dist: { type: 'float', label: 'Distance', connection: { nodeId: sphere.id, outputKey: 'dist' } } },
        outputs: { dist: { type: 'float', label: 'Distance' } },
      };
      return {
        ...sg,
        nodes: [...inner.filter(n => n.type !== 'sceneOutput'), out, stray],
        outputPorts: [{ key: 'extra', type: 'float', label: 'Extra', fromNodeId: 'stray', fromOutputKey: 'dist' }],
      };
    });
    const r = compileGraph({ nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    const fn = r.fragmentShader.match(/float mapScene_\w+\(vec3 p[^)]*\) \{([\s\S]*?)return (\w+);\s*\}/)!;
    const sphereVar = fn[1].match(/float (\w+_dist) = sdf3d_sphere\(p, 0\.[0-9]+\);/)?.[1];
    expect(sphereVar).toBeTruthy();
    expect(fn[1]).toMatch(new RegExp(`float ${fn[2]} = ${sphereVar};`));
  });

  it('a march loop whose Scene Group is empty, or with no scene at all, compiles: every ray misses', () => {
    const emptied = withSceneSubgraph(gi, sg => ({ ...sg, nodes: [] }));
    const unwired = gi.map(n => n.type === 'giLitMarchGroup' || n.type === 'marchLoopGroup'
      ? { ...n, inputs: { ...n.inputs, scene: { ...n.inputs.scene, connection: undefined } } }
      : n);
    for (const nodes of [emptied, unwired]) {
      const r = compileGraph({ nodes });
      expect(r.success).toBe(true);
      expect(r.fragmentShader).not.toMatch(/MISSING_SCENE/);
      expect(r.fragmentShader).toMatch(/float mapScene_none\(vec3 p\)/);
    }
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
