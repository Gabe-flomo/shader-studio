/**
 * The Audio nodes in the compiler (docs/audio-tools.md): their numbers become live uniforms keyed by channel, their
 * pictures node textures with the `_px` define the texture tools read, the `audio` wire only joins Audio nodes,
 * every Audio example compiles, and the retired Audio Input is no longer offered. Audio Source's bands are outputs
 * that follow its params (added, renamed, removed: their wires go), and a phase-1 graph on the Test loop opens as File.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { migrateNodeParams, type GraphNode } from '../../types/nodeGraph';
import { newBand } from '../../lib/audioTools/bands';
import { newSound } from '../../lib/audioTools/learn';
import { compileGraph } from '../graphCompiler';
import { buildAudioExamples, AUDIO_EXAMPLE_KEYS } from '../../store/audioExamples';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { n } from '../../store/graphBuilder';
import { getOfferedDefinitions, getNodeDefinition } from '../../nodes/definitions';
import { typesCompatible } from '../../lib/typesCompatible';

const ex = buildAudioExamples();

describe('Audio nodes compile', () => {
  it('every Audio example compiles and is filed in the Audio folder', () => {
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Audio')?.keys).toEqual(AUDIO_EXAMPLE_KEYS);
    for (const k of AUDIO_EXAMPLE_KEYS) {
      const r = compileGraph({ nodes: ex[k].nodes });
      expect(r.errors ?? [], k).toEqual([]);
      expect(r.success, k).toBe(true);
      for (const node of ex[k].nodes) expect(typeof node.params.__comment, `${k}/${node.id} has a note`).toBe('string');
    }
  });

  it('numbers are live uniforms written by channel; the Kick band\'s trigger feeds the Envelope and Counter', () => {
    const r = compileGraph({ nodes: ex.audioKickRing.nodes });
    const lu = Object.entries(r.liveUniforms);
    for (const ch of ['level', 'time', 'kick_t', 'bass_v']) expect(lu.some(([u, k]) => k === `src::${ch}` && u.startsWith('u_aud_') && u.endsWith(`_${ch}`)), ch).toBe(true);
    const trig = lu.find(([, k]) => k === 'src::kick_t')![0];
    // The memory nodes run in their own pass: the trigger uniform is read there.
    const all = [r.fragmentShader, ...(r.passes ?? []).map(p => p.fragmentShader)].join('\n');
    expect(all).toContain(trig);
  });

  it('Hit\'s numbers are live uniforms too', () => {
    const r = compileGraph({ nodes: [
      n('audioSource', 'src', 0, 0),
      n('audioHit', 'kick', 0, 0, {}, { audio: ['src', 'audio'] }),
      n('envelope', 'env', 0, 0, { mode: 'trigger' }, { gate: ['kick', 'trigger'] }),
      n('output', 'out', 0, 0, {}, { color: ['env', 'value'] }),
    ] });
    expect(r.errors ?? []).toEqual([]);
    for (const ch of ['trigger', 'envelope', 'count', 'strength']) expect(Object.values(r.liveUniforms)).toContain(`kick::${ch}`);
  });

  it('pictures are node textures with a _px define, readable by Sample (texture)', () => {
    const r = compileGraph({ nodes: [
      n('audioSource', 'src', 0, 0),
      n('audioSpectrum', 'spec', 0, 0, { bins: '256' }, { audio: ['src', 'audio'] }),
      n('sampleTexture', 'samp', 0, 0, {}, { texture: ['spec', 'texture'] }),
      n('output', 'out', 0, 0, {}, { color: ['samp', 'color'] }),
    ] });
    expect(r.errors ?? []).toEqual([]);
    const sampler = Object.entries(r.textureUniforms).find(([, id]) => id === 'spec')?.[0];
    expect(sampler).toMatch(/^u_tex_/);
    expect(r.fragmentShader).toContain(`#define ${sampler}_px (vec2(1.0) / vec2(256.0, 1.0))`);
  });

  it('an unwired listener still compiles (silence)', () => {
    for (const t of ['audioBand', 'audioHit', 'audioSpectrum', 'audioSpectrogram', 'audioWaveform']) {
      const def = getNodeDefinition(t)!;
      const out = Object.entries(def.outputs).find(([, s]) => s.type === 'float')![0];
      const r = compileGraph({ nodes: [n(t, 'a', 0, 0), n('output', 'out', 0, 0, {}, { color: ['a', out] })] });
      expect(r.errors ?? [], t).toEqual([]);
    }
  });

  it('the audio wire only joins Audio nodes', () => {
    expect(typesCompatible('audio', 'audio')).toBe(true);
    for (const t of ['float', 'vec2', 'vec3', 'texture']) { expect(typesCompatible('audio', t)).toBe(false); expect(typesCompatible(t, 'audio')).toBe(false); }
  });

  it('Audio Input is retired: not offered, still registered', () => {
    const offered = getOfferedDefinitions().map(d => d.type);
    expect(offered).not.toContain('audioInput');
    expect(getNodeDefinition('audioInput')).toBeTruthy();
    for (const t of ['audioSource', 'audioBand', 'audioHit', 'audioSpectrum', 'audioSpectrogram', 'audioWaveform']) expect(offered).toContain(t);
  });
});

describe('Audio Source bands are outputs', () => {
  const st = () => useNodeGraphStore.getState();
  const src = () => st().nodes.find(x => x.id === 'src')!;
  const setUp = () => {
    useNodeGraphStore.setState({ nodes: [
      n('audioSource', 'src', 0, 0),
      n('envelope', 'env', 0, 0, { mode: 'trigger' }),
      n('output', 'out', 0, 0, {}, { color: ['env', 'value'] }),
    ], activeGroupPath: [], activeGroupId: null });
  };

  it('adding, renaming and removing a band adds, renames and removes its sockets; a removed band\'s wires go', () => {
    setUp();
    expect(Object.keys(src().outputs)).toEqual(['audio', 'level', 'time']);
    const kick = { ...newBand([], 'kick'), value: false };
    st().updateNodeParams('src', { bands: [kick] }, { immediate: true });
    expect(src().outputs[`${kick.id}_t`]?.label).toBe('Kick (trigger)');
    expect(src().outputs[`${kick.id}_v`]).toBeUndefined();
    // Wire it into the Envelope, then compile: it reads the band's live uniform.
    const env = st().nodes.find(x => x.id === 'env')!;
    useNodeGraphStore.setState({ nodes: st().nodes.map(x => x.id === 'env' ? { ...env, inputs: { ...env.inputs, gate: { ...env.inputs.gate, connection: { nodeId: 'src', outputKey: `${kick.id}_t` } } } } : x) });
    const r = compileGraph({ nodes: st().nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(Object.values(r.liveUniforms)).toContain(`src::${kick.id}_t`);
    // Renamed, and Value switched on: both sockets, the wire kept.
    st().updateNodeParams('src', { bands: [{ ...kick, name: 'Boom', value: true }] }, { immediate: true });
    expect(src().outputs[`${kick.id}_t`]?.label).toBe('Boom (trigger)');
    expect(src().outputs[`${kick.id}_v`]?.label).toBe('Boom');
    expect(st().nodes.find(x => x.id === 'env')!.inputs.gate.connection?.outputKey).toBe(`${kick.id}_t`);
    // Its Trigger switched off: that socket and its wire go.
    st().updateNodeParams('src', { bands: [{ ...kick, name: 'Boom', value: true, trigger: false }] }, { immediate: true });
    expect(src().outputs[`${kick.id}_t`]).toBeUndefined();
    expect(st().nodes.find(x => x.id === 'env')!.inputs.gate.connection).toBeUndefined();
    // Removed: back to the three fixed outputs.
    st().updateNodeParams('src', { bands: [] }, { immediate: true });
    expect(Object.keys(src().outputs)).toEqual(['audio', 'level', 'time']);
  });

  it('moving a band is live: the node changes, its sockets stay, nothing compiles', () => {
    setUp();
    const bass = newBand([], 'bass');
    st().updateNodeParams('src', { bands: [bass] }, { immediate: true });
    const outs = src().outputs;
    const compile = vi.spyOn(st(), 'compile');
    st().updateNodeParams('src', { bands: [{ ...bass, lo: 80, hi: 300 }] }, { immediate: true, live: true });
    expect((src().params.bands as Array<{ lo: number }>)[0].lo).toBe(80);
    expect(src().outputs).toBe(outs);
    expect(compile).not.toHaveBeenCalled();
    compile.mockRestore();
  });

  it('a phase-1 graph on the Test loop opens on File, empty, and compiles', () => {
    const old: GraphNode = {
      id: 'src', type: 'audioSource', position: { x: 0, y: 0 }, inputs: {},
      outputs: { audio: { type: 'audio', label: 'Audio' }, level: { type: 'float', label: 'Level' }, time: { type: 'float', label: 'Time' } },
      params: { source: 'loop', playing: true, loop: true, gain: 1, _fileName: '' },
    };
    const m = migrateNodeParams(old, getNodeDefinition);
    expect(m.params.source).toBe('file');
    expect(Object.keys(m.outputs)).toEqual(['audio', 'level', 'time']);
    const r = compileGraph({ nodes: [m, n('audioBand', 'b', 0, 0, {}, { audio: ['src', 'audio'] }), n('output', 'out', 0, 0, {}, { color: ['b', 'level'] })] });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });
});

describe('Audio Source learned sounds are outputs', () => {
  const st = () => useNodeGraphStore.getState();
  const src = () => st().nodes.find(x => x.id === 'src')!;
  const fp = { spec: Array.from({ length: 40 }, (_, i) => (i < 20 ? -0.1 : 0.1)), env: [1, 0.8, 0.6, 0.4] };

  it('a learned sound adds Trigger and Match outputs read as live uniforms; Match and Re-learn are live', () => {
    useNodeGraphStore.setState({ nodes: [
      n('audioSource', 'src', 0, 0, { bands: [{ ...newBand([], 'kick'), value: false }] }),
      n('envelope', 'env', 0, 0, { mode: 'trigger' }),
      n('output', 'out', 0, 0, {}, { color: ['env', 'value'] }),
    ], activeGroupPath: [], activeGroupId: null });
    const clap = { ...newSound([], fp, new Set(['b1'])), name: 'Clap' };
    st().updateNodeParams('src', { sounds: [clap] }, { immediate: true });
    expect(src().outputs[`${clap.id}_t`]?.label).toBe('Clap (trigger)');
    expect(src().outputs[`${clap.id}_m`]?.label).toBe('Clap (match)');
    // The band's outputs come first, then the sound's.
    expect(Object.keys(src().outputs)).toEqual(['audio', 'level', 'time', 'b1_t', `${clap.id}_t`, `${clap.id}_m`]);
    const env = st().nodes.find(x => x.id === 'env')!;
    useNodeGraphStore.setState({ nodes: st().nodes.map(x => x.id === 'env' ? { ...env, inputs: { ...env.inputs, gate: { ...env.inputs.gate, connection: { nodeId: 'src', outputKey: `${clap.id}_t` } } } } : x) });
    const r = compileGraph({ nodes: st().nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(Object.values(r.liveUniforms)).toEqual(expect.arrayContaining([`src::${clap.id}_t`, `src::${clap.id}_m`]));
    // Match, Cooldown and a new fingerprint: live, the sockets stay, nothing compiles.
    const outs = src().outputs;
    // (A spy left on the store by an earlier test keeps its calls: count from here.)
    const compile = vi.spyOn(st(), 'compile');
    compile.mockClear();
    st().updateNodeParams('src', { sounds: [{ ...clap, match: 0.6, cooldown: 300, spec: [...fp.spec].reverse() }] }, { immediate: true, live: true });
    expect(src().outputs).toBe(outs);
    expect(compile).not.toHaveBeenCalled();
    compile.mockRestore();
    // Its Trigger off: that socket and its wire go; removed: back to the band's.
    st().updateNodeParams('src', { sounds: [{ ...clap, trigger: false }] }, { immediate: true });
    expect(src().outputs[`${clap.id}_t`]).toBeUndefined();
    expect(st().nodes.find(x => x.id === 'env')!.inputs.gate.connection).toBeUndefined();
    st().updateNodeParams('src', { sounds: [] }, { immediate: true });
    expect(Object.keys(src().outputs)).toEqual(['audio', 'level', 'time', 'b1_t']);
  });

  it('the Learn a clap example opens with a Clap waiting to be learned, already wired', () => {
    const s = ex.audioLearnClap.nodes.find(x => x.id === 'src')!;
    expect(s.outputs.clap_t?.label).toBe('Clap (trigger)');
    expect(s.outputs.clap_m?.label).toBe('Clap (match)');
    expect(String(s.params.__comment)).toContain('Load a song, select one clap in the window, press Learn');
  });
});
