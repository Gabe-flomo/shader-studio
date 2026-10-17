/**
 * Audio nodes inside groups (docs/audio-tools.md): an Audio Source at the top level wired through a group's port
 * into Hit, Band level and Spectrum inside it (a plain group, an iterated one, and a group inside a group). The
 * compiler binds their uniforms and textures to their own ids, the engine finds them (graphWalk.ts) with the
 * source, and writes exactly the channels the compiler reads.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { GROUP_PORT_SENTINEL, type GraphNode } from '../../../types/nodeGraph';
import { group, n } from '../../../store/graphBuilder';
import { compileGraph } from '../../../compiler/graphCompiler';
import { collectAudioNodes, findNodeDeep } from '../graphWalk';
import { audioToolsEngine } from '../engine';

const port = (key: string): [string, string] => [GROUP_PORT_SENTINEL, key];

/** Audio Source → a group (Iterations `iters`) holding Hit, Band level and Spectrum; out: their sum. */
function graph(iters: number): GraphNode[] {
  return [
    n('audioSource', 'src', 0, 0),
    n('uv', 'uv', 0, 200),
    group('grp', 300, 0, {
      label: 'Listens', iterations: iters,
      inputs: [{ key: 'snd', type: 'audio', label: 'Audio', from: ['src', 'audio'] }, { key: 'p', type: 'vec2', label: 'UV', from: ['uv', 'uv'] }],
      outputs: [{ key: 'v', type: 'float', label: 'Value', from: ['mix', 'result'] }],
      nodes: [
        n('audioHit', 'ghit', 0, 0, {}, { audio: port('snd') }),
        n('audioBand', 'gband', 0, 100, {}, { audio: port('snd') }),
        n('audioSpectrum', 'gspec', 0, 200, { bins: '64' }, { audio: port('snd'), uv: port('p') }),
        n('add', 'mix0', 200, 0, {}, { a: ['ghit', 'envelope'], b: ['gband', 'level'] }),
        n('add', 'mix', 300, 0, {}, { a: ['mix0', 'result'], b: ['gspec', 'value'] }),
      ],
    }),
    n('output', 'out', 600, 0, {}, { color: ['grp', 'v'] }),
  ];
}

/** The same group, put inside another group that passes the Audio in through its own port. */
function nested(): GraphNode[] {
  const g = graph(1);
  const inner = g.find(x => x.id === 'grp')!;
  const wired = {
    ...inner,
    inputs: { snd: { ...inner.inputs.snd, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: 'outerSnd' } }, p: { ...inner.inputs.p, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: 'outerP' } } },
  };
  return [
    g[0], g[1],
    group('outer', 300, 0, {
      label: 'Outer', iterations: 1,
      inputs: [{ key: 'outerSnd', type: 'audio', label: 'Audio', from: ['src', 'audio'] }, { key: 'outerP', type: 'vec2', label: 'UV', from: ['uv', 'uv'] }],
      outputs: [{ key: 'v', type: 'float', label: 'Value', from: ['grp', 'v'] }],
      nodes: [wired],
    }),
    n('output', 'out', 600, 0, {}, { color: ['outer', 'v'] }),
  ];
}

describe('Audio nodes inside groups', () => {
  it('the walk finds every Audio node at any depth with its source', () => {
    for (const nodes of [graph(1), nested()]) {
      const refs = collectAudioNodes(nodes);
      expect(refs.map(r => [r.node.id, r.sourceId])).toEqual([['src', 'src'], ['ghit', 'src'], ['gband', 'src'], ['gspec', 'src']]);
      expect(findNodeDeep(nodes, 'gspec')?.type).toBe('audioSpectrum');
    }
  });

  it('a wire out of a group\'s output port reaches the source inside it', () => {
    const nodes: GraphNode[] = [
      group('box', 0, 0, { label: 'Box', iterations: 1, inputs: [], outputs: [{ key: 'a', type: 'audio', label: 'Audio', from: ['inner', 'audio'] }], nodes: [n('audioSource', 'inner', 0, 0)] }),
      n('audioHit', 'top', 300, 0, {}, { audio: ['box', 'a'] }),
    ];
    expect(collectAudioNodes(nodes).find(r => r.node.id === 'top')?.sourceId).toBe('inner');
  });

  for (const [name, nodes] of [['a plain group', graph(1)], ['an iterated group', graph(3)], ['a group in a group', nested()]] as const) {
    it(`compiles in ${name}: live uniforms and the texture are bound to the inner nodes' ids`, () => {
      const r = compileGraph({ nodes: [...nodes] });
      expect(r.errors ?? []).toEqual([]);
      expect(r.success).toBe(true);
      const live = Object.values(r.liveUniforms);
      for (const ch of ['trigger', 'envelope', 'count', 'strength']) expect(live).toContain(`ghit::${ch}`);
      for (const ch of ['level', 'peak']) expect(live).toContain(`gband::${ch}`);
      const sampler = Object.entries(r.textureUniforms).find(([, id]) => id === 'gspec')?.[0];
      expect(sampler).toMatch(/^u_tex_/);
      const all = [r.fragmentShader, ...(r.passes ?? []).map(p => p.fragmentShader)].join('\n');
      expect(all).toContain(`#define ${sampler}_px`);
      // Every uniform the shader reads for them is declared and bound.
      for (const [u, ch] of Object.entries(r.liveUniforms)) if (ch.startsWith('ghit::') || ch.startsWith('gband::')) expect(all).toContain(`uniform float ${u};`);
    });
  }

  it('the engine runs them: each has a slot with the source, the Spectrum a texture, and the channels the compiler reads are written', () => {
    const nodes = nested();
    const set = new Map<string, unknown>();
    audioToolsEngine.setHost({ setTexture: (id, tex) => { set.set(id, tex); }, requestRender: () => {} });
    try {
      audioToolsEngine.sync(nodes);
      const slots = audioToolsEngine.slots();
      expect(slots.sources).toEqual(['src']);
      expect(slots.listeners).toEqual([
        { id: 'ghit', sourceId: 'src', texture: false },
        { id: 'gband', sourceId: 'src', texture: false },
        { id: 'gspec', sourceId: 'src', texture: true },
      ]);
      expect(set.get('gspec')).toBeTruthy();
      const written = new Set<string>();
      audioToolsEngine.tickInputs(1 / 60, 0, key => { written.add(key); });
      const r = compileGraph({ nodes });
      for (const ch of Object.values(r.liveUniforms)) expect(written, ch).toContain(ch);
      // Taken out of the graph: its slots go.
      audioToolsEngine.sync([nodes[0]]);
      expect(audioToolsEngine.slots().listeners).toEqual([]);
    } finally {
      audioToolsEngine.sync([]);
      audioToolsEngine.setHost(null);
    }
  });
});
