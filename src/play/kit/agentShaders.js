// agentShaders.js — the Agents engine's fixed GLSL (docs/agents-plan.md §3.4).
//
// The update shader is compiled from the group's inside; everything else the
// engine runs is fixed and lives here: Deposit (one point per agent, added
// into a Trail), the Trail's spread-and-fade step, and Draw agents (points,
// with the Particles engine's own glow and compose shaders reused unchanged
// through GP_SHADERS). All are GLSL 3 bodies without the `#version` line: the
// host adds it (three.js RawShaderMaterial with glslVersion GLSL3).
//
// State layout, shared with the Particles engine's: A = (pos.xy, heading, age),
// B = (vel.xy, speed, life); a texel with life ≤ 0 is dead. Positions are the
// picture's centred coordinates (y −1…1, x ±aspect).

import { GP_SHADERS } from './gpuParticles.js';

/** A Particles-engine shader as a GLSL 3 body (its `#version` line dropped; the text is otherwise as is). */
export function agBody(src) {
  return src.replace(/^#version 300 es\n/, '');
}

/** A full-picture triangle pair from three's plane (position in clip space). */
export const AG_FULL_VERT = `precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Deposit: one point per live agent, its species' channel × amount, added into the Trail. */
export const AG_DEPOSIT_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform int u_side, u_species;
uniform float u_aspect, u_amount, u_size;
out vec4 v_dep;
void main() {
  int id = gl_VertexID;
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  if (B.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_dep = vec4(0.0); return; }
  gl_Position = vec4(A.x / u_aspect, A.y, 0.0, 1.0);
  gl_PointSize = u_size;
  v_dep = vec4(equal(ivec4(id % u_species), ivec4(0, 1, 2, 3))) * u_amount;
}`;

export const AG_DEPOSIT_FRAG = `precision highp float;
in vec4 v_dep;
out vec4 o;
void main() { o = v_dep; }`;

/**
 * Trail step: t' = mix(t, mean3×3(t), diffuse) · keep, where keep = 2^(−dt / halfLife).
 * Exact texel reads (texelFetch), wrapping or clamping at the edges.
 */
export const AG_TRAIL_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_src;
uniform float u_diffuse, u_keep;
uniform int u_wrap;
out vec4 o;
vec4 agAt(ivec2 p, ivec2 size) {
  p = u_wrap == 1 ? (p + size) % size : clamp(p, ivec2(0), size - 1);
  return texelFetch(u_src, p, 0);
}
void main() {
  ivec2 size = textureSize(u_src, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(u_src, p, 0);
  vec4 m = vec4(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) m += agAt(p + ivec2(i, j), size);
  o = max(mix(c, m / 9.0, clamp(u_diffuse, 0.0, 1.0)) * u_keep, vec4(0.0));
}`;

/**
 * Draw agents: one soft point per live agent (GP_DRAW_FRAG draws it), its
 * colour between A and B by species, speed or heading. Additive, like the
 * Particles node's Light look; .a counts how much light landed (Density).
 */
export const AG_DRAW_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform int u_side, u_species, u_colorBy;
uniform float u_aspect, u_size, u_bright, u_speedRef;
uniform vec3 u_colA, u_colB;
out vec4 v_col;
out float v_dist;
void main() {
  int id = gl_VertexID;
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  v_dist = 0.0;
  if (B.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_col = vec4(0.0); return; }
  float k = 0.0;
  if (u_colorBy == 1) k = u_species > 1 ? float(id % u_species) / float(u_species - 1) : 0.0;
  else if (u_colorBy == 2) k = clamp(B.z / max(u_speedRef, 1e-4), 0.0, 1.0);
  else if (u_colorBy == 3) k = 0.5 + 0.5 * cos(A.z);
  vec3 c = mix(u_colA, u_colB, k);
  gl_Position = vec4(A.x / u_aspect, A.y, 0.0, 1.0);
  gl_PointSize = clamp(u_size, 1.0, 64.0);
  v_col = vec4(c * u_bright, u_bright);
}`;

/** The Particles engine's point, glow and compose shaders, unchanged (gpEngineShaders.test.ts). */
export const AG_DRAW_FRAG = agBody(GP_SHADERS.GP_DRAW_FRAG);
export const AG_DOWN_FRAG = agBody(GP_SHADERS.GP_DOWN);
export const AG_BLUR_FRAG = agBody(GP_SHADERS.GP_BLUR);
export const AG_COMPOSE_FRAG = agBody(GP_SHADERS.GP_COMPOSE);
