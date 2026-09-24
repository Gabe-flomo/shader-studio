import { describe, expect, it } from 'vitest';
import { compileGraph } from '../graphCompiler';
import { audioUniformName, audioUniformNamesByNode } from '../audioUniformNames';
import type { GraphNode } from '../../types/nodeGraph';

// Two-band AudioInput feeding the output. The node id is deliberately not
// its GLSL slug (node_5 → audio_5): the audio engine used to build uniform
// names from the raw id and never reached the shader.
const audio: GraphNode = {
  id: 'node_5', type: 'audioInput', position: { x: 0, y: 0 },
  inputs: { band_0_center: { type: 'float', label: 'Band 0 Hz' }, band_1_center: { type: 'float', label: 'Band 1 Hz' } },
  outputs: { amplitude_0: { type: 'float', label: 'Band 0' }, amplitude_1: { type: 'float', label: 'Band 1' } },
  params: { freq_range: 200, mode: 'band', _bands: [200, 2000], _soloedBand: -1, _fileName: 'x.wav', _hasFile: true },
};
const f2v: GraphNode = {
  id: 'node_6', type: 'floatToVec3', position: { x: 200, y: 0 },
  inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'node_5', outputKey: 'amplitude_1' } } },
  outputs: { vec: { type: 'vec3', label: 'Vec3' } },
  params: {},
};
const out: GraphNode = {
  id: 'node_9', type: 'output', position: { x: 400, y: 0 },
  inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'node_6', outputKey: 'vec' } } },
  outputs: {}, params: {},
};

describe('AudioInput uniforms', () => {
  it('compiles one slug-named uniform per band, declared and read by the shader', () => {
    const r = compileGraph({ nodes: [audio, f2v, out] } as never);
    expect(r.success).toBe(true);
    const slug = 'audio_5';
    expect(r.nodeSlugMap?.get('node_5')).toBe(slug);
    expect(r.audioUniforms).toEqual({
      [audioUniformName(slug, 0)]: 'node_5',
      [audioUniformName(slug, 1)]: 'node_5',
    });
    for (const name of Object.keys(r.audioUniforms)) {
      expect(r.fragmentShader).toContain(`uniform float ${name};`);
      expect(r.fragmentShader).toMatch(new RegExp(`= ${name};`));
    }
    // The raw-id spelling the engine used to emit is not a uniform.
    expect(r.fragmentShader).not.toContain('u_audio_node_5_');
  });

  it('inverts audioUniforms into the per-band names the engine ticks with', () => {
    const r = compileGraph({ nodes: [audio, f2v, out] } as never);
    const byNode = audioUniformNamesByNode(r.audioUniforms);
    const names = byNode.get('node_5')!;
    expect(names).toHaveLength(2);
    // What a tick writes: names[band] for each band, in band order — every
    // one must be a key of the compiled map.
    for (let band = 0; band < 2; band++) {
      expect(r.audioUniforms[names[band]]).toBe('node_5');
      expect(names[band]).toBe(audioUniformName('audio_5', band));
    }
  });

  it('keeps band indices stable for labelled and collision-suffixed slugs', () => {
    const byNode = audioUniformNamesByNode({
      u_audio_my_beat_5_1: 'node_5',
      u_audio_my_beat_5_0: 'node_5',
      u_audio_audio_12_c2_0: 'node_12',
    });
    expect(byNode.get('node_5')).toEqual(['u_audio_my_beat_5_0', 'u_audio_my_beat_5_1']);
    expect(byNode.get('node_12')).toEqual(['u_audio_audio_12_c2_0']);
  });
});
