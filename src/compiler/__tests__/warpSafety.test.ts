import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import type { GraphNode } from '../../types/nodeGraph';

const loops = Object.entries(EXAMPLE_GRAPHS).filter(([, g]) => g.nodes.some(n => n.type === 'marchLoopGroup' && !n.params.volumetric));
const withSafety = (nodes: GraphNode[], mode: string, extra: Record<string, unknown> = {}) =>
  nodes.map(n => (n.type === 'marchLoopGroup' ? { ...n, params: { ...n.params, warpSafety: mode, ...extra } } : n));

describe('warp safety on the March Loop', () => {
  it('there are 3D examples to try it on', () => expect(loops.length).toBeGreaterThan(10));

  it('Off (or unset) builds exactly the shader as before', () => {
    const [, g] = loops[0];
    const nodes = resolveNodeAliases(g.nodes, getNodeDefinition);
    const a = compileGraph({ nodes });
    const b = compileGraph({ nodes: withSafety(nodes, 'off') });
    expect(b.fragmentShader).toBe(a.fragmentShader);
    expect(a.fragmentShader).not.toContain('_lip');
  });

  it.each(['auto', 'careful', 'high'])('%s compiles on every 3D example', mode => {
    const bad: string[] = [];
    for (const [k, g] of loops) {
      const r = compileGraph({ nodes: withSafety(resolveNodeAliases(g.nodes, getNodeDefinition), mode, { showSteps: 'steps' }) });
      if (!r.success) bad.push(`${k}: ${String(r.errors)}`);
      else expect(r.fragmentShader).toContain('_lip');
    }
    expect(bad).toEqual([]);
  });

  it('careful measures the gradient; auto does not', () => {
    const [, g] = loops[0];
    const nodes = resolveNodeAliases(g.nodes, getNodeDefinition);
    const auto = compileGraph({ nodes: withSafety(nodes, 'auto') }).fragmentShader;
    const careful = compileGraph({ nodes: withSafety(nodes, 'careful') }).fragmentShader;
    expect(auto).not.toMatch(/_k\.xyy/);
    expect(careful).toMatch(/_k\.xyy/);
    const high = compileGraph({ nodes: withSafety(nodes, 'high') }).fragmentShader;
    expect(high).toMatch(/_k\.xyy/);
    expect(high).toContain('* 0.7');
  });

  it('Steps heatmap replaces the final picture', () => {
    const [, g] = loops[0];
    const nodes = resolveNodeAliases(g.nodes, getNodeDefinition);
    const fs = compileGraph({ nodes: withSafety(nodes, 'auto', { showSteps: 'steps' }) }).fragmentShader;
    expect(fs.trim().split('\n').slice(-2).join('\n')).toMatch(/gl_FragColor = vec4\(\w+_color, 1\.0\);/);
  });

  it('March Camera takes one vec3 Target; an older camera keeps a float target only while it is wired', () => {
    const def = getNodeDefinition('marchCamera')!;
    expect(def.inputs.target.type).toBe('vec3');
    expect(def.inputs.targetX).toBeUndefined();
    const old = { id: 'c', type: 'marchCamera', position: { x: 0, y: 0 }, params: {}, outputs: {}, inputs: {
      targetX: { type: 'float', label: 'Target X', connection: { nodeId: 'n', outputKey: 'out' } },
      targetY: { type: 'float', label: 'Target Y' },
    } } as unknown as GraphNode;
    const synced = def.syncSockets!(old);
    expect(Object.keys(synced.inputs)).toEqual(['targetX']);
  });
});
