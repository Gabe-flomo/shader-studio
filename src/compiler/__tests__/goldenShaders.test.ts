/**
 * Golden shaders (Pass node plan, phase 0: docs/pass-node-plan.md). Every
 * bundled example compiled today: its fragment shader (sha256 + length), the
 * uniform names it declares, its slider bindings, isStateful and echo; and, for each example with a Play setup, the web export's
 * bundle JSON and the "not supported" list.
 *
 * These snapshots are the zero-change guarantee for the Pass node: a graph
 * without a Pass must compile byte for byte as it did before. A change to
 * `__snapshots__/goldenShaders.test.ts.snap` is only acceptable in a commit
 * that deliberately changes the compiler for every graph, and must say why.
 * Examples that have a Pass node or an Agents-family node are left out (they
 * take the multi-program path; docs/agents-plan.md section 10).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { PASS_EXAMPLE_KEYS } from '../../store/passExamples';
import { TIME_CUBE_EXAMPLE_KEYS } from '../../store/timeCubeExamples';
import { parsePlayRecord } from '../../types/play';
import { webInputFrom } from '../../play/webInput';
import { playBundle } from '../../play/exportHtml';

/** cyrb53 (a fast 53-bit string hash) under two seeds, plus the length: enough to catch any change. */
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
const sorted = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).sort();

type Nodes = Array<{ type: string; params?: Record<string, unknown> }>;
/** The node types that send a graph down the multi-program path (Pass, and the Agents family: docs/agents-plan.md). */
const MULTI_PROGRAM = new Set(['pass', 'agentsGroup', 'trailField', 'drawAgents', 'agentDeposit', 'agentEmit']);
/**
 * Has a Pass or Agents-family node (at any depth)? The guarantee is about graphs without
 * one; passGraph.test.ts and agentGraph.test.ts cover those.
 */
const hasPass = (nodes: Nodes): boolean => nodes.some(nd => MULTI_PROGRAM.has(nd.type) || hasPass(((nd.params?.subgraph as { nodes?: Nodes } | undefined)?.nodes) ?? []));
/**
 * The Passes folder is left out as a whole: its examples show the Pass feature (Passes 8 has no
 * Pass node, but reads a Texture Input's Texture output, phase 7); passGraph.test.ts,
 * passP7.test.ts and examples.test.ts cover them.
 */
const PASS_FOLDER = new Set(PASS_EXAMPLE_KEYS);
/** The Time cube examples (docs/time-cube.md) are new graphs: timeCube.test.ts covers them. The guarantee here is for graphs without its nodes. */
const TIME_CUBE_FOLDER = new Set(TIME_CUBE_EXAMPLE_KEYS);
const keys = Object.keys(EXAMPLE_GRAPHS).filter(k => !hasPass(EXAMPLE_GRAPHS[k].nodes) && !PASS_FOLDER.has(k) && !TIME_CUBE_FOLDER.has(k)).sort();

describe('golden shaders: every example compiles as it did', () => {
  it('has the examples', () => expect(keys.length).toBeGreaterThan(100));
  for (const k of keys) {
    it(k, () => {
      const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition);
      const r = compileGraph({ nodes });
      expect({
        success: r.success,
        errors: r.errors ?? null,
        fragmentShader: sha(r.fragmentShader),
        vertexShader: sha(r.vertexShader),
        paramUniforms: sorted(r.paramUniforms),
        paramValues: sha(JSON.stringify(Object.entries(r.paramUniforms).sort(([a], [b]) => (a < b ? -1 : 1)))),
        paramBindings: sha(JSON.stringify(Object.entries(r.paramBindings).sort(([a], [b]) => (a < b ? -1 : 1)))),
        textureUniforms: r.textureUniforms,
        audioUniforms: r.audioUniforms,
        liveUniforms: r.liveUniforms,
        videoUniforms: r.videoUniforms,
        isStateful: r.isStateful,
        echo: r.echo ?? null,
        nodeSlugs: r.nodeSlugMap ? sha(JSON.stringify([...r.nodeSlugMap].sort(([a], [b]) => (a < b ? -1 : 1)))) : null,
        passes: (r as { passes?: unknown }).passes ?? null,
      }).toMatchSnapshot();
    });
  }
});

describe('golden shaders: every Play example exports the same bundle', () => {
  const playKeys = keys.filter(k => EXAMPLE_GRAPHS[k].play);
  it('has Play examples', () => expect(playKeys.length).toBeGreaterThan(20));
  for (const k of playKeys) {
    it(k, () => {
      const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition);
      const r = compileGraph({ nodes });
      const play = parsePlayRecord(EXAMPLE_GRAPHS[k].play);
      const { input, missing } = webInputFrom(r, play, { title: EXAMPLE_GRAPHS[k].label ?? k, aspect: 'free' });
      expect({ bundle: sha(JSON.stringify(playBundle(input))), missing }).toMatchSnapshot();
    });
  }
});
