import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPreviewUniforms, type PreviewUniformSource } from '../previewUniforms';

const img = new THREE.Texture();
const vid = new THREE.Texture();
const store = (): PreviewUniformSource => ({
  paramUniforms: { u_p_speed: 2, u_p_tint: [1, 0.5, 0] },
  textureUniforms: { u_tex_a: 'imgNode' },
  videoUniforms: { u_vid_a: 'vidNode' },
  audioUniforms: { u_audio_bass: 'a1' },
  liveUniforms: { u_live_knob: 'midi:1' },
  nodeTextures: { imgNode: img },
  videoTextures: { vidNode: vid },
});

describe('buildPreviewUniforms (Rebuild, GPU recovery)', () => {
  const prevFrame = new THREE.Texture();
  const prev: Record<string, THREE.IUniform> = {
    u_time: { value: 12.5 },
    u_mouse: { value: new THREE.Vector2(40, 30) },
    u_prevFrame: { value: prevFrame },
    u_echo0: { value: prevFrame },
    u_p_speed: { value: 9 },          // a stale value: the store's wins
    u_live_knob: { value: 0.7 },      // written every frame by the input bus
    u_audio_bass: { value: 0.3 },
  };
  const font = { value: new THREE.Texture() };
  const u = buildPreviewUniforms(store(), prev, { width: 640, height: 360 }, { u_fontTexture: font });

  it('re-applies every param uniform and texture from the store', () => {
    expect(u.u_p_speed.value).toBe(2);
    expect(u.u_p_tint.value).toEqual([1, 0.5, 0]);
    expect(u.u_tex_a.value).toBe(img);
    expect(u.u_vid_a.value).toBe(vid);
  });

  it('keeps the clock and carries the per-frame values over', () => {
    expect(u.u_time.value).toBe(12.5);
    expect(u.u_live_knob.value).toBe(0.7);
    expect(u.u_audio_bass.value).toBe(0.3);
    expect((u.u_mouse.value as THREE.Vector2).toArray()).toEqual([40, 30]);
  });

  it('is a new object throughout: nothing points at the old program or its history', () => {
    for (const k of Object.keys(prev)) expect(u[k]).not.toBe(prev[k]);
    expect(u.u_mouse.value).not.toBe(prev.u_mouse.value);
    expect(u.u_prevFrame.value).toBeNull();
    for (let i = 0; i < 6; i++) expect(u[`u_echo${i}`].value).toBeNull();
    expect((u.u_resolution.value as THREE.Vector2).toArray()).toEqual([640, 360]);
  });

  it('keeps shared uniform objects as they are', () => {
    expect(u.u_fontTexture).toBe(font);
  });
});
