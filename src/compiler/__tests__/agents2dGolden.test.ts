/**
 * 3D Agents' zero-change guarantee for 2D (docs/agents-plan.md §10, "3D"): every multi-program
 * example (the Agents examples and presets, the Pass examples) and every Particles preset opened as
 * nodes in 2D compiles to exactly what it did before 3D Agents: the picture, every pass, every
 * update shader and Trail step program, the whole agents spec, uniforms and bindings, and the web
 * bundle's agents part. The snapshot was written on main before 3D Agents changed anything; a
 * change to it means a 2D graph compiles differently, which 3D must never do.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { GP_DEFAULTS, GP_PRESETS, gpPreset } from '../../play/kit/gpuParticles.js';
import { particlesAsNodes } from '../../store/particlesAsNodes';
import { webAgents } from '../../play/webInput';
import { n } from '../../store/graphBuilder';

function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
const sha = (s: string) => `${cyrb53(s, 1)}${cyrb53(s, 7)}:${s.length}`;
const entries = (o: Record<string, unknown> | undefined) => Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));

type Nodes = Array<{ type: string; params?: Record<string, unknown> }>;
const MULTI = new Set(['pass', 'agentsGroup', 'trailField', 'drawAgents', 'agentDeposit', 'agentEmit']);
const multi = (nodes: Nodes): boolean => nodes.some(nd => MULTI.has(nd.type) || multi(((nd.params?.subgraph as { nodes?: Nodes } | undefined)?.nodes) ?? []));

/** Everything a compile hands the hosts, hashed (Maps as sorted entries). */
function digest(r: ReturnType<typeof compileGraph>) {
  return {
    success: r.success,
    errors: r.errors ?? null,
    fragmentShader: sha(r.fragmentShader),
    paramUniforms: sha(JSON.stringify(entries(r.paramUniforms))),
    paramBindings: sha(JSON.stringify(entries(r.paramBindings))),
    textureUniforms: sha(JSON.stringify(entries(r.textureUniforms))),
    passes: sha(JSON.stringify(r.passes ?? null)),
    agents: sha(JSON.stringify(r.agents ?? null)),
    web: r.agents ? sha(JSON.stringify(webAgents(r.agents))) : null,
  };
}

/** A graph with a 3D Agents group (agents3d.test.ts and the examples test cover those: this file is about 2D). */
const has3d = (nodes: Nodes): boolean => nodes.some(nd => (nd.type === 'agentsGroup' && nd.params?.space === '3d') || has3d(((nd.params?.subgraph as { nodes?: Nodes } | undefined)?.nodes) ?? []));
const keys = Object.keys(EXAMPLE_GRAPHS).filter(k => multi(EXAMPLE_GRAPHS[k].nodes) && !has3d(EXAMPLE_GRAPHS[k].nodes)).sort();

describe('2D agents and pass graphs compile as they did before 3D', () => {
  it('has the examples', () => expect(keys.length).toBeGreaterThan(20));
  for (const k of keys) {
    it(k, () => {
      const r = compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition) });
      expect(digest(r)).toMatchSnapshot();
    });
  }
});

describe('2D Particles presets opened as nodes compile as they did', () => {
  const names = Object.keys(GP_PRESETS).filter(name => (gpPreset(name) as { space?: string }).space !== '3d').sort();
  for (const name of names) {
    it(name, () => {
      let k = 0;
      const src = n('gpuParticles', 'gp', 100, 100, { ...GP_DEFAULTS, ...gpPreset(name)! });
      const o = particlesAsNodes(src, () => `n${k++}`, { x: 0, y: 0 });
      const out = n('output', 'out', 0, 0, {}, { color: [o.outputs.color!.nodeId, o.outputs.color!.outputKey] });
      expect(digest(compileGraph({ nodes: [...o.nodes, out] }))).toMatchSnapshot();
    });
  }
});
