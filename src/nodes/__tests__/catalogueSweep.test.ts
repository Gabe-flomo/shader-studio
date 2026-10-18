/**
 * The 2026-10-17 catalogue sweep (docs/node-retirements.md, "The catalogue sweep"): the node library after the
 * effects sweep — old transforms, duplicate shapes and helpers retired, shapers and Chladni merged, search
 * aliases, categories and labels. Like effectSweep.test.ts: a retired type still loads (merged ones migrate with
 * the same maths, run on the CPU with glslEval.ts; hidden ones stay registered) and no example uses one.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../definitions';
import { NODE_ALIASES } from '../definitions/aliases';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { migrateLoadedNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { gpBindings } from '../../play/kit/gpuParticles.js';

/** Every node type an example uses, at any depth. */
function typesOf(nodes: GraphNode[], out: string[] = []): string[] {
  for (const nd of nodes) {
    out.push(nd.type);
    const sg = nd.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) typesOf(sg.nodes, out);
  }
  return out;
}

/** A saved node as an old graph holds it. */
export function saved(type: string, id: string, params: Record<string, unknown>, inputs: Record<string, [string, string] | null>, outputs: string[]): GraphNode {
  const def = getNodeDefinition(type);
  return {
    id, type, position: { x: 0, y: 0 }, params,
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, w]) => [k, { type: def?.inputs[k]?.type ?? 'float', label: k, ...(w ? { connection: { nodeId: w[0], outputKey: w[1] } } : {}) }])),
    outputs: Object.fromEntries(outputs.map(k => [k, { type: def?.outputs[k]?.type ?? 'float', label: k }])),
  } as GraphNode;
}

describe('T6: examples use current node types', () => {
  it('no example uses an old (aliased) type name or the retired Audio Input', () => {
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) {
      const old = typesOf(g.nodes).filter(t => NODE_ALIASES[t] || t === 'audioInput');
      expect(old, k).toEqual([]);
    }
  });

  it('the Chladni sand examples hear an Audio Source\'s six bands', () => {
    for (const key of ['particleChladniSand', 'particleCymatics3d']) {
      const r = compileGraph({ nodes: migrateLoadedNodes(EXAMPLE_GRAPHS[key].nodes) });
      expect(r.errors ?? [], key).toEqual([]);
      const [b] = gpBindings(r.fragmentShader!);
      expect(b.audio, key).toMatch(/^u_aud_\w+_level$/);
      expect(b.audioBands, key).toHaveLength(6);
      expect(b.audioBands[0], key).toMatch(/_b1_v$/);
    }
  });

  it('an Audio Input still wins over an Audio Source (old graphs hear what they heard)', () => {
    const fs = ['uniform float u_aud_src_level;', 'uniform float u_aud_src_time;', 'uniform float u_audio_old_0;', 'uniform sampler2D u_gpup_p; // gpu-particles {"p":{}}'].join('\n');
    expect(gpBindings(fs)[0].audio).toBe('u_audio_old_0');
  });

  it('a Band level alone is not taken for a source (it has no Time)', () => {
    const fs = ['uniform float u_aud_bass_level;', 'uniform float u_aud_bass_peak;', 'uniform sampler2D u_gpup_p; // gpu-particles {"p":{}}'].join('\n');
    expect(gpBindings(fs)[0].audio).toBeNull();
  });

  it('replaceGraph runs the load migrations (aliases, then params)', () => {
    useNodeGraphStore.getState().replaceGraph([
      saved('palettePreset', 'p', { preset: '3' }, { t: null }, ['color']),
      saved('smoothMin', 's', { k: 0.25 }, { a: null, b: null }, ['result']),
    ]);
    const [p, s] = useNodeGraphStore.getState().nodes;
    expect(p.type).toBe('palette');
    expect(p.inputs.value).toBeTruthy();
    expect(s.type).toBe('sdfUnion');
    // A Smooth Min saved with k (not smoothness) keeps it.
    expect(s.params.k).toBe(0.25);
  });

  it('Add (vec3) keeps its B when the three sliders agree', () => {
    const [n] = migrateLoadedNodes([saved('addVec3', 'a', { bx: 0.5, by: 0.5, bz: 0.5 }, { a: null, b: null }, ['result'])]);
    expect(n.type).toBe('add');
    expect(n.params.b).toBe(0.5);
    expect(n.params.bx).toBeUndefined();
  });
});
