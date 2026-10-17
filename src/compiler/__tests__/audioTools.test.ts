/**
 * The Audio nodes in the compiler (docs/audio-tools.md): their numbers become live uniforms keyed by channel, their
 * pictures node textures with the `_px` define the texture tools read, the `audio` wire only joins Audio nodes,
 * every Audio example compiles, and the retired Audio Input is no longer offered.
 */
import { describe, expect, it } from 'vitest';
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

  it('numbers are live uniforms written by channel; Hit\'s Trigger feeds the Envelope and Counter', () => {
    const r = compileGraph({ nodes: ex.audioKickRing.nodes });
    const lu = Object.entries(r.liveUniforms);
    for (const ch of ['trigger', 'envelope', 'count', 'strength']) expect(lu.some(([u, k]) => k === `kick::${ch}` && u.startsWith('u_aud_') && u.endsWith(`_${ch}`))).toBe(true);
    expect(lu.some(([, k]) => k === 'src::level')).toBe(true);
    expect(lu.some(([, k]) => k === 'bass::level')).toBe(true);
    const trig = lu.find(([, k]) => k === 'kick::trigger')![0];
    // The memory nodes run in their own pass: the trigger uniform is read there.
    const all = [r.fragmentShader, ...(r.passes ?? []).map(p => p.fragmentShader)].join('\n');
    expect(all).toContain(trig);
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
