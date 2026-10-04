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

import { GP_LIGHTS, GP_SHADERS, gpFade, gpPaletteGlsl } from './gpuParticles.js';

/** A Particles-engine shader as a GLSL 3 body (its `#version` line dropped; the text is otherwise as is). */
export function agBody(src) {
  return src.replace(/^#version 300 es\n/, '');
}

/** A full-picture triangle pair from three's plane (position in clip space). */
export const AG_FULL_VERT = `precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Deposit: one point per live agent, added into the Trail: its species' channel × amount; with
 * per-walker state (u_stateC) its own deposit (state D) × amount; in Velocity mode (u_what 1) its
 * velocity × amount in the first two channels and the amount (a count) in the third.
 */
export const AG_DEPOSIT_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform highp sampler2D u_d;
uniform int u_side, u_species, u_stateC, u_what;
uniform float u_aspect, u_amount, u_size;
out vec4 v_dep;
void main() {
  int id = gl_VertexID;
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  if (B.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_dep = vec4(0.0); return; }
  gl_Position = vec4(A.x / u_aspect, A.y, 0.0, 1.0);
  gl_PointSize = u_size;
  if (u_what == 1) v_dep = vec4(B.xy, 1.0, 0.0) * u_amount;
  else if (u_stateC == 1) v_dep = texelFetch(u_d, t, 0) * u_amount;
  else v_dep = vec4(equal(ivec4(id % u_species), ivec4(0, 1, 2, 3))) * u_amount;
}`;

export const AG_DEPOSIT_FRAG = `precision highp float;
in vec4 v_dep;
out vec4 o;
void main() { o = v_dep; }`;

/**
 * The trail's spread: the 3×3 mean (Jones), or with k5 a 5×5 binomial blur (1 4 6 4 1, a
 * Gaussian-like kernel for soft fields). Exact texel reads, wrapping or clamping at the edges.
 * Shared by the fixed trail step below and a Trail's own step program (Add / Block wired).
 */
export const AG_TRAIL_MEAN_GLSL = `vec4 agTrailMean(highp sampler2D s, ivec2 p, ivec2 size, int wrap, int k5) {
  vec4 m = vec4(0.0);
  if (k5 == 0) {
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec2 q = p + ivec2(i, j);
      q = wrap == 1 ? (q + size) % size : clamp(q, ivec2(0), size - 1);
      m += texelFetch(s, q, 0);
    }
    return m / 9.0;
  }
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    ivec2 q = p + ivec2(i, j);
    q = wrap == 1 ? (q + 2 * size) % size : clamp(q, ivec2(0), size - 1);
    float wi = i == 0 ? 6.0 : abs(i) == 1 ? 4.0 : 1.0, wj = j == 0 ? 6.0 : abs(j) == 1 ? 4.0 : 1.0;
    m += texelFetch(s, q, 0) * (wi * wj);
  }
  return m / 256.0;
}`;

/**
 * Trail step: t' = mix(t, spread(t), diffuse) · keep, where keep = 2^(−dt / halfLife). A signed
 * trail (velocity deposits) keeps its negative values; any other is kept at 0 or above.
 */
export const AG_TRAIL_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_src;
uniform float u_diffuse, u_keep;
uniform int u_wrap, u_k5, u_signed;
out vec4 o;
${AG_TRAIL_MEAN_GLSL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 t = mix(texelFetch(u_src, p, 0), agTrailMean(u_src, p, textureSize(u_src, 0), u_wrap, u_k5), clamp(u_diffuse, 0.0, 1.0)) * u_keep;
  o = u_signed == 1 ? t : max(t, vec4(0.0));
}`;

/**
 * Draw agents: one soft point per live agent (GP_DRAW_FRAG draws it), or with
 * u_prim = 1 a line from it back along its velocity (Streaks: two vertices an
 * agent, gl.LINES). Its colour along the Particles palette (u_usePal) or
 * between A and B, by species, speed, heading or age; lit by the Particles
 * engine's lights (GP_LIGHTS, its text as is) and faded over its life (gpFade).
 * Additive, like the Particles node's Light look; .a counts how much light
 * landed (Density). Ink (u_ink): the Particles node's absorbance instead.
 */
export const AG_DRAW_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform highp sampler2D u_c;
uniform int u_side, u_species, u_colorBy, u_prim, u_ink, u_fade, u_usePal, u_rainbow, u_lights, u_stateC;
uniform float u_aspect, u_size, u_bright, u_speedRef, u_thread;
uniform vec3 u_colA, u_colB;
uniform vec3 u_pal[4];
uniform vec4 u_light[4];
uniform vec4 u_lightZ;
uniform vec3 u_lightCol[4];
// Agents are flat: the lights' depth is ignored (GP_LIGHTS reads this).
const int u_deep = 0;
out vec4 v_col;
out float v_dist;
${gpPaletteGlsl('agPalette', 'u_rainbow', 'u_pal')}
void main() {
  // Points: one vertex an agent. Streaks: two, its head and a tail back along its velocity.
  int id = u_prim == 1 ? gl_VertexID >> 1 : gl_VertexID;
  int end = u_prim == 1 ? (gl_VertexID & 1) : 0;
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  v_dist = 0.0;
  if (B.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_col = vec4(0.0); return; }
  // Its age as a share of its life (0 for agents that live for ever).
  float a = B.w > 1.0e20 ? 0.0 : clamp(A.w / B.w, 0.0, 1.0);
  float fade = u_fade == 1 && B.w < 1.0e20 ? ${gpFade('a')} : 1.0;
  float k = 0.0;
  // Per-walker state: its species and its own colour (state C), not its index.
  vec4 C = u_stateC == 1 ? texelFetch(u_c, t, 0) : vec4(float(id % u_species), 0.0, 0.0, 16777215.0);
  if (u_colorBy == 1) k = u_species > 1 ? C.x / float(u_species - 1) : 0.0;
  else if (u_colorBy == 2) k = clamp(B.z / max(u_speedRef, 1e-4), 0.0, 1.0);
  else if (u_colorBy == 3) k = 0.5 + 0.5 * cos(A.z);
  else if (u_colorBy == 4) k = a;
  vec3 c = u_usePal == 1 ? agPalette(k) : mix(u_colA, u_colB, k);
  if (u_colorBy == 5) {
    // Agent: the colour its rule set (Agent Output's Colour), 8 bits a channel packed in C.w.
    float b = floor(C.w / 65536.0), g = floor((C.w - b * 65536.0) / 256.0);
    c = vec3(C.w - b * 65536.0 - g * 256.0, g, b) / 255.0;
  }
  vec4 P = vec4(A.xy, 0.0, A.w);
${GP_LIGHTS}
  vec2 pos = A.xy - B.xy * (u_thread * float(end));
  float s = u_size * (1.0 + 0.35 * min(near, 4.0));
  float w = fade * u_bright;
  // A point smaller than a pixel still covers one: its light (ink) goes down with its area instead.
  w *= u_prim == 1 ? 1.0 : min(1.0, s * s);
  gl_Position = vec4(pos.x / u_aspect, pos.y, 0.0, 1.0);
  gl_PointSize = clamp(s, 1.0, 64.0);
  v_col = u_ink == 1 ? vec4(c * L * w, w * (L.r + L.g + L.b) / 3.0) : vec4(c * L * w, w);
}`;

/** The Particles engine's point, glow and compose shaders, unchanged (gpEngineShaders.test.ts). */
export const AG_DRAW_FRAG = agBody(GP_SHADERS.GP_DRAW_FRAG);
export const AG_DOWN_FRAG = agBody(GP_SHADERS.GP_DOWN);
export const AG_BLUR_FRAG = agBody(GP_SHADERS.GP_BLUR);
export const AG_COMPOSE_FRAG = agBody(GP_SHADERS.GP_COMPOSE);

/**
 * An Agents group card's live thumbnail (P4): every u_stride-th walker as one additive point,
 * amber, at its place in the picture (dead ones off screen). Not part of any picture.
 */
export const AG_THUMB_DOTS_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform int u_side, u_stride;
uniform float u_aspect;
void main() {
  int id = gl_VertexID * u_stride;
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  if (B.w <= 0.0 || t.y >= u_side) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = vec4(A.x / u_aspect, A.y, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;
export const AG_THUMB_DOTS_FRAG = `precision highp float;
uniform float u_gain;
out vec4 o_col;
void main() { o_col = vec4(vec3(1.0, 0.72, 0.32) * u_gain, 1.0); }`;
