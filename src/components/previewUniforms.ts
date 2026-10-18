import * as THREE from 'three';

/** What the preview's uniforms are built from: the store's last compile and its media. */
export interface PreviewUniformSource {
  paramUniforms: Record<string, unknown>;
  textureUniforms: Record<string, string>;
  videoUniforms: Record<string, string>;
  audioUniforms: Record<string, unknown>;
  liveUniforms: Record<string, unknown>;
  nodeTextures: Record<string, THREE.Texture | null | undefined>;
  videoTextures: Record<string, THREE.Texture | null | undefined>;
}

/**
 * A new uniforms object for the preview's program (Rebuild, GPU recovery). Everything the
 * compile produced comes from the store again: param values, image and video textures. What
 * is written every frame (the clock, the mouse, audio bands, MIDI and Play-driven values) is
 * carried over from `prev`, so the first frame after already has it. Feedback and echo inputs
 * start empty: their history was thrown away. `shared` holds uniforms whose objects are shared
 * with other code (the font atlas, the Layers texture) and are kept as they are.
 */
export function buildPreviewUniforms(
  st: PreviewUniformSource,
  prev: Record<string, THREE.IUniform>,
  size: { width: number; height: number },
  shared: Record<string, THREE.IUniform>,
): Record<string, THREE.IUniform> {
  const mouse = prev.u_mouse?.value as THREE.Vector2 | undefined;
  const u: Record<string, THREE.IUniform> = {};
  // Everything else the old program had (a Data node's table, a Particles engine's state, a Baked
  // node's texel size, anything bound outside the compile) is carried over as a new object, so the
  // first frame finds it: the frame loop writes `uniforms.x.value` and a missing one would throw.
  // A render target's texture belonged to a target that is being thrown away: it starts empty.
  for (const [name, p] of Object.entries(prev)) {
    const v: unknown = p?.value;
    u[name] = { value: (v as { isRenderTargetTexture?: boolean } | null)?.isRenderTargetTexture ? null : v };
  }
  Object.assign(u, {
    u_time:       { value: prev.u_time?.value ?? 0 },
    // The frame's length and the button: written every frame and on every press (ShaderCanvas).
    u_frameDt:    { value: prev.u_frameDt?.value ?? 0 },
    u_mousebtn:   { value: prev.u_mousebtn?.value ?? 0 },
    u_resolution: { value: new THREE.Vector2(size.width || 1, size.height || 1) },
    u_mouse:      { value: mouse ? mouse.clone() : new THREE.Vector2(0, 0) },
    u_prevFrame:  { value: null },
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`u_echo${i}`, { value: null }])),
    u_echoCap:    { value: 0 },
    ...shared,
  });
  for (const [name, value] of Object.entries(st.paramUniforms)) u[name] = { value };
  for (const [name, nodeId] of Object.entries(st.textureUniforms)) u[name] = { value: st.nodeTextures[nodeId] ?? null };
  for (const [name, nodeId] of Object.entries(st.videoUniforms)) u[name] = { value: st.videoTextures[nodeId] ?? null };
  for (const name of [...Object.keys(st.audioUniforms), ...Object.keys(st.liveUniforms)]) u[name] = { value: prev[name]?.value ?? 0 };
  return u;
}
