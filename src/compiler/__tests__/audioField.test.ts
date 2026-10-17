/**
 * The Spectrogram's Field (docs/audio-tools.md, "The Spectrogram as a field"): a float of position that plugs into
 * field sockets (ƒ) and warps, thresholds or lights a picture; its Scale, Offset and Gain are uniforms (live), Edges
 * a choice; and the new Audio examples compile with a note on every node.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import type { GraphNode } from '../../types/nodeGraph';
import { n } from '../../store/graphBuilder';
import { compileGraph } from '../graphCompiler';
import { agentsGroup } from '../../store/agentExampleKit';
import { buildAudioExamples } from '../../store/audioExamples';
import { getNodeDefinition } from '../../nodes/definitions';

const src = () => n('audioSource', 'src', 0, 0);
const gram = (params: Record<string, unknown> = {}) => n('audioSpectrogram', 'gram', 200, 0, params, { audio: ['src', 'audio'] });
const ok = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  return r;
};

describe('the Spectrogram\'s Field', () => {
  it('is a function of position: wired into Height Light\'s Height ƒ it is compiled into a field function that samples the history', () => {
    const r = ok([
      src(), gram(),
      n('heightLight', 'hl', 400, 0, {}, { height: ['gram', 'field'] }),
      n('output', 'out', 600, 0, {}, { color: ['hl', 'color'] }),
    ]);
    const fn = r.fragmentShader.match(/float (fieldfn_\w+)\(vec2 g_uv[^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(fn, 'a field function').toBeTruthy();
    const sampler = Object.entries(r.textureUniforms).find(([, id]) => id === 'gram')![0];
    expect(fn![0]).toContain(`texture2D(${sampler}`);
  });

  it('thresholds into shapes and warps a picture (the example warps stripes), and its Scale, Offset and Gain are uniforms', () => {
    const r = ok([
      src(), gram({ fieldScale: 2, fieldOffsetY: -0.25, fieldGain: 1.5 }),
      n('step', 'cut', 400, 0, { edge: 0.5 }, { x: ['gram', 'field'] }),
      n('output', 'out', 600, 0, {}, { color: ['cut', 'result'] }),
    ]);
    for (const k of ['fieldScale', 'fieldOffsetX', 'fieldOffsetY', 'fieldGain']) expect(r.paramBindings[`gram::${k}`], k).toBeTruthy();
    expect(r.paramUniforms[r.paramBindings['gram::fieldGain']]).toBe(1.5);
  });

  it('Edges: clamp, repeat (fract) or mirror', () => {
    const shader = (edges: string) => ok([src(), gram({ fieldEdges: edges }), n('output', 'out', 400, 0, {}, { color: ['gram', 'field'] })]).fragmentShader;
    expect(shader('repeat')).toMatch(/fract\(\w+_fq\)/);
    expect(shader('mirror')).toMatch(/mod\(\w+_fq, 2\.0\)/);
    expect(shader('clamp')).toMatch(/clamp\(\w+_fq, 0\.0, 1\.0\)/);
  });

  it('rides as a path and is sensed: Ride a path\'s Path ƒ and a Shape Field\'s Where ƒ inside an Agents group', () => {
    const inside = [
      n('agentInputs', 'ain', 0, 0, { _groupOriginal: true, extraInputs: [] }),
      n('audioSpectrogram', 'igram', 0, 200, {}),
      n('agentRidePath', 'ride', 300, 0, { level: 0.3 }, { path: ['igram', 'field'] }),
      n('agentOutput', 'aout', 600, 0, { _groupOriginal: true }, { position: ['ride', 'position'], velocity: ['ride', 'velocity'] }),
    ];
    const r = compileGraph({ nodes: [
      n('agentEmit', 'emit', 0, 0, { mode: 'fill', shape: 'screen', life: 0 }),
      agentsGroup('ag', 300, 0, 'emit', inside, { tier: '16k' }),
      n('drawAgents', 'draw', 600, 0, {}, { agents: ['ag', 'agents'] }),
      n('output', 'out', 900, 0, {}, { color: ['draw', 'color'] }),
    ] });
    expect(r.errors ?? []).toEqual([]);
    // The walkers' program calls the Field as a function and samples the history; the sampler is the node's texture.
    const programs = JSON.stringify(r.agents);
    expect(programs).toMatch(/fieldfn_\w+_field\(/);
    const sampler = Object.entries(r.textureUniforms).find(([, id]) => id === 'igram')?.[0];
    expect(sampler).toBeTruthy();
    expect(programs).toContain(`texture2D(${sampler}`);
  });

  it('a Spectrogram saved before the Field output gains it', () => {
    const def = getNodeDefinition('audioSpectrogram')!;
    const old = { ...n('audioSpectrogram', 'g', 0, 0), outputs: { value: { type: 'float' as const, label: 'Value' }, texture: { type: 'texture' as const, label: 'Texture' } } };
    expect(Object.keys(def.syncSockets!(old).outputs)).toEqual(['value', 'texture', 'field']);
  });
});

describe('the new Audio examples', () => {
  const ex = buildAudioExamples();
  it('wire their effects into the picture: the filter\'s Level, the bank\'s energies, the frozen waterfall, the field', () => {
    const live = (k: string) => Object.values(ok(ex[k].nodes).liveUniforms);
    expect(live('audioFilterSweep')).toContain('filt::level');
    expect(live('audioResonatorRings')).toEqual(expect.arrayContaining(['res::e0', 'res::e7', 'res::loudest']));
    const freeze = ex.audioSpectralFreeze.nodes.find(x => x.id === 'gram')!;
    expect(freeze.inputs.audio.connection).toEqual({ nodeId: 'spx', outputKey: 'audio' });
    expect(ok(ex.audioSpectrogramField.nodes).fragmentShader).toMatch(/float fieldfn_\w+\(vec2 g_uv/);
  });
});
