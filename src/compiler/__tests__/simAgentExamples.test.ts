/**
 * The Simulations: agents examples (store/agentExamplesSim.ts, docs/simulations-agents.md): a folder
 * of their own, built only from existing nodes, every node with a plain-language note, each
 * compiling with every program live and its rule keeping per-walker Memory (state C), and every
 * Play control aimed at a live param (examples.test.ts checks the targets for every example).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../../store/exampleIndex';
import { SIM_AGENT_EXAMPLE_KEYS } from '../../store/agentExamplesSim';
import type { GraphNode } from '../../types/nodeGraph';

const walk = (nodes: GraphNode[], visit: (nd: GraphNode) => void) => {
  for (const nd of nodes) { visit(nd); const sg = nd.params?.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes, visit); }
};
const compile = (k: string) => compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition) });
const inside = (k: string) => (EXAMPLE_GRAPHS[k].nodes.find(nd => nd.type === 'agentsGroup')!.params.subgraph as { nodes: GraphNode[] }).nodes;

describe('the Simulations: agents examples', () => {
  it('are a folder of their own, eight of them, listed in the index', () => {
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Simulations: agents')?.keys).toEqual(SIM_AGENT_EXAMPLE_KEYS);
    expect(SIM_AGENT_EXAMPLE_KEYS).toEqual([
      'simAgentPredatorPrey', 'simAgentDla', 'simAgentSandDrift', 'simAgentCrowd',
      'simAgentPainters', 'simAgentTermites', 'simAgentFireflies', 'simAgentInfection',
    ]);
    for (const k of SIM_AGENT_EXAMPLE_KEYS) {
      expect(EXAMPLE_INDEX[k]?.label, k).toBeTruthy();
      expect(EXAMPLE_INDEX[k]?.play, k).toBe(true);
    }
  });

  it('use only registered node types, and nothing inside the groups but the rule, math and readers', () => {
    for (const k of SIM_AGENT_EXAMPLE_KEYS) {
      walk(EXAMPLE_GRAPHS[k].nodes, nd => expect(getNodeDefinition(nd.type), `${k}: ${nd.type}`).toBeTruthy());
      // The custom rule is the point: no prebuilt Steer, no forces, no presets inside.
      for (const nd of inside(k)) expect(['agentSteer', 'agentCurl', 'agentIntegrate', 'agentAttract', 'agentVortex', 'agentFlow'], `${k}: ${nd.id}`).not.toContain(nd.type);
    }
  });

  it.each(SIM_AGENT_EXAMPLE_KEYS)('%s compiles, every program live, its rule keeping Memory', k => {
    const r = compile(k);
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.agents!.groups.every(g => g.live)).toBe(true);
    expect(r.agents!.trails.every(t => t.live)).toBe(true);
    expect(r.agents!.groups[0].stateC).toBe(true);
    // Agent Output's Memory is wired (the walker's state is the rule's), but in the crowd, which needs none: its Colour is its own.
    const out = inside(k).find(nd => nd.type === 'agentOutput')!;
    expect(k === 'simAgentCrowd' ? out.inputs.colour.connection : out.inputs.memory.connection, k).toBeTruthy();
  });

  it('every node has a plain-language note, and Expression Blocks explain each named line', () => {
    const missing: string[] = [];
    for (const k of SIM_AGENT_EXAMPLE_KEYS) walk(EXAMPLE_GRAPHS[k].nodes, nd => {
      const text = String(nd.params?.__comment ?? '');
      if (text.trim().length < 20) missing.push(`${k}: ${nd.id} (${nd.type})`);
      if (nd.type !== 'exprNode') return;
      for (const line of (nd.params.lines ?? []) as Array<{ lhs: string }>) {
        const name = line.lhs.trim().split(/\s+/).pop()!;
        if (!new RegExp(`(^|\\W)${name}:`, 'm').test(text)) missing.push(`${k}/${nd.id}: line "${name}"`);
      }
    });
    expect(missing).toEqual([]);
  });

  it('each has Play notes and controls whose targets are live uniforms', () => {
    for (const k of SIM_AGENT_EXAMPLE_KEYS) {
      const play = EXAMPLE_GRAPHS[k].play!;
      expect(play.notes, k).toMatch(/\*\*What it shows\.\*\*/);
      expect(play.controls.length, k).toBeGreaterThanOrEqual(4);
      const bindings = compile(k).paramBindings ?? {};
      for (const c of play.controls) {
        const key = c.target.split('::').slice(-2).join('::');
        if (key.endsWith('::restart')) continue;
        expect(key in bindings, `${k}: ${c.target}`).toBe(true);
      }
    }
  });

  it('chance tests never fire at a chance of 0 (1 − step(p, roll), not step(roll, p))', () => {
    for (const k of SIM_AGENT_EXAMPLE_KEYS) walk(EXAMPLE_GRAPHS[k].nodes, nd => {
      if (nd.type !== 'exprNode') return;
      for (const line of (nd.params.lines ?? []) as Array<{ rhs: string }>) expect(line.rhs, `${k}/${nd.id}`).not.toMatch(/step\((roll|rnd|fract\(r)/);
    });
  });

  it('the trails that must never fade keep exactly everything (Half-life past 400,000 s, no spread)', () => {
    for (const [k, id] of [['simAgentTermites', 'tmTrail'], ['simAgentSandDrift', 'sdTrail']] as const) {
      const t = EXAMPLE_GRAPHS[k].nodes.find(nd => nd.id === id)!;
      expect(t.params.halfLife as number).toBeGreaterThan(4e5);
      expect(t.params.diffuse).toBe(0);
    }
  });
});
