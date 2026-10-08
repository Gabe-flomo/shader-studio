import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import type { GraphNode } from '../../types/nodeGraph';
import { buildSceneGraph, buildStandaloneGraph } from '../../sceneBuilder/build';

import { parseRecipe, printRecipe } from '../../sceneBuilder/recipe';
import { starterSpec } from '../../sceneBuilder/spec';

const loops = Object.entries(EXAMPLE_GRAPHS).filter(([, g]) => g.nodes.some(n => n.type === 'marchLoopGroup' && !n.params.volumetric));
const volLoops = Object.entries(EXAMPLE_GRAPHS).filter(([, g]) => g.nodes.some(n => n.type === 'marchLoopGroup' && n.params.volumetric));
const giLoops = Object.entries(EXAMPLE_GRAPHS).filter(([, g]) => g.nodes.some(n => n.type === 'giLitMarchGroup'));
const withSafety = (nodes: GraphNode[], mode: string, extra: Record<string, unknown> = {}) =>
  nodes.map(n => (n.type === 'marchLoopGroup' || n.type === 'giLitMarchGroup' ? { ...n, params: { ...n.params, warpSafety: mode, ...extra } } : n));

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

  it.each(['auto', 'high'])('%s compiles on volumetric and GI Lit examples', mode => {
    expect(volLoops.length).toBeGreaterThan(0);
    expect(giLoops.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const [k, g] of [...volLoops, ...giLoops]) {
      const r = compileGraph({ nodes: withSafety(resolveNodeAliases(g.nodes, getNodeDefinition), mode, { showSteps: 'steps' }) });
      if (!r.success) bad.push(`${k}: ${String(r.errors)}`);
      else expect(r.fragmentShader).toContain('_lip');
    }
    expect(bad).toEqual([]);
  });

  it('GI Lit: shadow, bounce and reflection rays divide by the stretch', () => {
    const [, g] = giLoops[0];
    const fs = compileGraph({ nodes: withSafety(resolveNodeAliases(g.nodes, getNodeDefinition), 'auto') }).fragmentShader;
    expect(fs).toMatch(/_sht \+= \w+_shd \/ \w+_lip/);
    expect(fs).toMatch(/_gt \+= \w+_gd \/ \w+_lip/);
    expect(fs).toMatch(/_rt \+= \w+_rd2 \/ \w+_lip/);
  });

  it('Scene Builder: quality warp= round-trips and wires Stretch into the shadows and AO', () => {
    const spec = starterSpec();
    spec.quality.warp = 'careful';
    spec.look.mode = 'surface'; spec.look.shadows = 16; spec.look.ao = 0.06;
    const text = printRecipe(spec);
    expect(text).toContain('warp=careful');
    expect(parseRecipe(text).spec.quality.warp).toBe('careful');
    const built = buildSceneGraph(spec);
    const loop = built.nodes.find(n => n.type === 'marchLoopGroup' || n.type === 'giLitMarchGroup')!;
    expect(loop.params.warpSafety).toBe('careful');
    const shadow = built.nodes.find(n => n.type === 'softShadow');
    expect(shadow?.inputs.stretch?.connection?.outputKey).toBe('stretch');
    expect(built.nodes.find(n => n.type === 'sdfAo')?.inputs.stretch?.connection?.outputKey).toBe('stretch');
    const r = compileGraph({ nodes: buildStandaloneGraph(spec).nodes });
    expect([r.success, String(r.errors ?? '')]).toEqual([true, '']);
  });
});
