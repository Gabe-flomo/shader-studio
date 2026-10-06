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
  // The Particles node's own ways: fast ones take the palette's start; the heading once round it.
  else if (u_colorBy == 6) k = 1.0 - clamp(B.z / max(u_speedRef, 1e-4), 0.0, 1.0);
  else if (u_colorBy == 7) k = fract(atan(B.y, B.x) / 6.2831853 + 0.5);
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

/*
 * Readings (P6): a group's walkers summed on the GPU into a 2 × 1 target, read back a frame or two
 * later without a stall (gpReadback). Two halves side by side, each summing 8 × 8 blocks a pass:
 * half 0 = (live walkers, Σx, Σy, Σ(x² + y²)), half 1 = (Σ speed, live of species 1, 2, 3).
 * The first pass reads the state (A, B and, with per-walker state, C for the species), the next
 * ones sum the previous pass, until one texel is left in each half (agReadPlan, agReadDecode).
 */
export const AG_READ_BLOCK = 8;

export const AG_READ_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform highp sampler2D u_c;
uniform int u_side, u_species, u_stateC, u_w, u_deep;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int half_ = p.x >= u_w ? 1 : 0;
  ivec2 b = ivec2(p.x - half_ * u_w, p.y) * ${AG_READ_BLOCK};
  vec4 s = vec4(0.0);
  for (int j = 0; j < ${AG_READ_BLOCK}; j++) for (int i = 0; i < ${AG_READ_BLOCK}; i++) {
    ivec2 t = b + ivec2(i, j);
    if (t.x >= u_side || t.y >= u_side) continue;
    vec4 B = texelFetch(u_b, t, 0);
    if (B.w <= 0.0) continue;
    if (half_ == 0) {
      vec2 q = texelFetch(u_a, t, 0).xy;
      s += vec4(1.0, q, dot(q, q));
    } else {
      float sp = u_stateC == 1 ? texelFetch(u_c, t, 0).x : float((t.y * u_side + t.x) % u_species);
      // Speed: in 3D (u_deep) its depth counts too; Centre and Spread are across and up the picture in both.
      s += vec4(length(u_deep == 1 ? B.xyz : vec3(B.xy, 0.0)), vec3(equal(ivec3(int(sp + 0.5)), ivec3(0, 1, 2))));
    }
  }
  o = s;
}`;

export const AG_SUM_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_src;
uniform int u_inW, u_inH, u_w;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int half_ = p.x >= u_w ? 1 : 0;
  ivec2 b = ivec2(p.x - half_ * u_w, p.y) * ${AG_READ_BLOCK};
  vec4 s = vec4(0.0);
  for (int j = 0; j < ${AG_READ_BLOCK}; j++) for (int i = 0; i < ${AG_READ_BLOCK}; i++) {
    ivec2 t = b + ivec2(i, j);
    if (t.x >= u_inW || t.y >= u_inH) continue;
    s += texelFetch(u_src, ivec2(t.x + half_ * u_inW, t.y), 0);
  }
  o = s;
}`;

/*
 * 3D (docs/agents-plan.md "3D"). A 3D group's state is the Particles engine's layout: A = (pos.xyz,
 * age), B = (vel.xyz, life), in a box x ±aspect, y ±1, z ±1. A Trail it fills is a volume: its
 * z-slices side by side in one half-float texture (kit/agentPlan.js agVolLayout), `u_vol` =
 * (columns, rows, slices, slices across). Deposit adds one voxel per walker; the step spreads over
 * the 3 × 3 × 3 neighbours; a projection (summed through the depth) is what the picture samples.
 */

/** The atlas texel of voxel v (each z-slice a tile, tiles row by row). */
export const AG_VOL_TEXEL_GLSL = `ivec2 agVolTexel(ivec3 v, ivec3 n, int tx) { return ivec2((v.z % tx) * n.x + v.x, (v.z / tx) * n.y + v.y); }`;

/** Deposit into a volume: one voxel per live walker inside the box (its state D, species or velocity, as in 2D). */
export const AG_DEPOSIT3_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform highp sampler2D u_d;
uniform int u_side, u_species, u_stateC, u_what;
uniform float u_aspect, u_amount;
uniform vec4 u_vol;
uniform vec2 u_atlas;
out vec4 v_dep;
${AG_VOL_TEXEL_GLSL}
void main() {
  int id = gl_VertexID;
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  ivec3 n = ivec3(u_vol.xyz + 0.5);
  vec3 g = (A.xyz / vec3(u_aspect, 1.0, 1.0) * 0.5 + 0.5) * vec3(n);
  if (B.w <= 0.0 || any(lessThan(g, vec3(0.0))) || any(greaterThanEqual(g, vec3(n)))) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_dep = vec4(0.0); return; }
  ivec2 at = agVolTexel(ivec3(floor(g)), n, int(u_vol.w + 0.5));
  gl_Position = vec4((vec2(at) + 0.5) / u_atlas * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  if (u_what == 1) v_dep = vec4(B.xyz, 1.0) * u_amount;
  else if (u_stateC == 1) v_dep = texelFetch(u_d, t, 0) * u_amount;
  else v_dep = vec4(equal(ivec4(id % u_species), ivec4(0, 1, 2, 3))) * u_amount;
}`;

/**
 * A volume's step: t' = mix(t, spread(t), diffuse) · keep. The spread (k5 0) is the mean of the cell
 * and its 6 face neighbours (Jones' 3 × 3 mean in 3D, 7 reads instead of 27: the step is the
 * volume's biggest cost), or with k5 the softer binomial (1 2 1)³ / 64 over all 27. Wrapping or
 * clamping on every axis; texels past the last slice stay empty.
 */
export const AG_TRAIL3_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_src;
uniform float u_diffuse, u_keep;
uniform int u_wrap, u_k5, u_signed;
uniform vec4 u_vol;
out vec4 o;
${AG_VOL_TEXEL_GLSL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec3 n = ivec3(u_vol.xyz + 0.5);
  int tx = int(u_vol.w + 0.5);
  ivec2 tile = p / n.xy;
  int z = tile.y * tx + tile.x;
  if (z >= n.z) { o = vec4(0.0); return; }
  ivec2 xy = p - tile * n.xy;
  ivec2 base = p - xy;
  vec4 c = texelFetch(u_src, p, 0);
  vec4 m;
  if (u_k5 == 0) {
    // The cell and its 6 face neighbours: across and up inside its slice, then the slices either side.
    ivec2 xm = xy - ivec2(1, 0), xp = xy + ivec2(1, 0), ym = xy - ivec2(0, 1), yp = xy + ivec2(0, 1);
    int zm = z - 1, zp = z + 1;
    if (u_wrap == 1) { xm.x = (xm.x + n.x) % n.x; xp.x = xp.x % n.x; ym.y = (ym.y + n.y) % n.y; yp.y = yp.y % n.y; zm = (zm + n.z) % n.z; zp = zp % n.z; }
    else { xm.x = max(xm.x, 0); xp.x = min(xp.x, n.x - 1); ym.y = max(ym.y, 0); yp.y = min(yp.y, n.y - 1); zm = max(zm, 0); zp = min(zp, n.z - 1); }
    m = c + texelFetch(u_src, base + xm, 0) + texelFetch(u_src, base + xp, 0) + texelFetch(u_src, base + ym, 0) + texelFetch(u_src, base + yp, 0)
      + texelFetch(u_src, ivec2((zm % tx) * n.x, (zm / tx) * n.y) + xy, 0) + texelFetch(u_src, ivec2((zp % tx) * n.x, (zp / tx) * n.y) + xy, 0);
    m /= 7.0;
  } else {
    ivec3 q0 = ivec3(xy, z);
    m = vec4(0.0);
    for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec3 q = q0 + ivec3(i, j, k);
      q = u_wrap == 1 ? (q + n) % n : clamp(q, ivec3(0), n - 1);
      float w = float((i == 0 ? 2 : 1) * (j == 0 ? 2 : 1) * (k == 0 ? 2 : 1));
      m += texelFetch(u_src, agVolTexel(q, n, tx), 0) * w;
    }
    m /= 64.0;
  }
  vec4 t = mix(c, m, clamp(u_diffuse, 0.0, 1.0)) * u_keep;
  o = u_signed == 1 ? t : max(t, vec4(0.0));
}`;

/** A volume seen from the front: each column summed through the depth (one texel per column), what the picture samples. */
export const AG_PROJ3_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_src;
uniform vec4 u_vol;
out vec4 o;
${AG_VOL_TEXEL_GLSL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec3 n = ivec3(u_vol.xyz + 0.5);
  int tx = int(u_vol.w + 0.5);
  vec4 s = vec4(0.0);
  for (int z = 0; z < 512; z++) {
    if (z >= n.z) break;
    s += texelFetch(u_src, agVolTexel(ivec3(p, z), n, tx), 0);
  }
  o = s;
}`;

/**
 * Draw agents in 3D: each walker seen through a camera (u_camSrc 0: the built-in one, its eye and
 * axes as uniforms; 1: a ray-marched scene's, rebuilt from its ray origin and three rays in u_cam,
 * as the Particles node's gpSceneCamera does), with the Particles node's depth of field: a point
 * grows to its circle of confusion and keeps its light, and points wider than u_cap are thinned at
 * random, each survivor heavier (blur costs no fill rate). Flatten blends to an orthographic lens.
 * Streaks (u_prim 1) draw the sharp share as lines; a points pass (u_thread > 0) the blurred share.
 * v_dist is the distance from the eye: behind a scene's surface (GP_DRAW_FRAG's u_depth) it is hidden.
 */
export const AG_DRAW3_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform highp sampler2D u_c;
uniform highp sampler2D u_cam;
uniform int u_side, u_species, u_colorBy, u_prim, u_ink, u_fade, u_usePal, u_rainbow, u_lights, u_stateC, u_camSrc;
uniform float u_aspect, u_size, u_bright, u_speedRef, u_thread;
uniform vec3 u_colA, u_colB;
uniform vec3 u_pal[4];
uniform vec4 u_light[4];
uniform vec4 u_lightZ;
uniform vec3 u_lightCol[4];
uniform vec3 u_eye, u_fwd, u_right, u_up;
uniform float u_lens, u_ortho, u_camDist, u_focus, u_coc, u_cap;
// The lights are in the walkers' space (GP_LIGHTS reads this).
const int u_deep = 1;
out vec4 v_col;
out float v_dist;
${gpPaletteGlsl('agPalette', 'u_rainbow', 'u_pal')}
uint agThinHash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
void agCull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_col = vec4(0.0); v_dist = 0.0; }
void main() {
  int id = u_prim == 1 ? gl_VertexID >> 1 : gl_VertexID;
  int end = u_prim == 1 ? (gl_VertexID & 1) : 0;
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  if (B.w <= 0.0) { agCull(); return; }
  float a = B.w > 1.0e20 ? 0.0 : clamp(A.w / B.w, 0.0, 1.0);
  float fade = u_fade == 1 && B.w < 1.0e20 ? ${gpFade('a')} : 1.0;
  float sp = length(B.xyz);
  float k = 0.0;
  vec4 C = u_stateC == 1 ? texelFetch(u_c, t, 0) : vec4(float(id % u_species), 0.0, 0.0, 16777215.0);
  if (u_colorBy == 1) k = u_species > 1 ? C.x / float(u_species - 1) : 0.0;
  else if (u_colorBy == 2) k = clamp(sp / max(u_speedRef, 1e-4), 0.0, 1.0);
  else if (u_colorBy == 3) k = sp > 1e-9 ? 0.5 + 0.5 * B.x / sp : 0.5;
  else if (u_colorBy == 4) k = a;
  else if (u_colorBy == 6) k = 1.0 - clamp(sp / max(u_speedRef, 1e-4), 0.0, 1.0);
  else if (u_colorBy == 7) k = fract(atan(B.y, B.x) / 6.2831853 + 0.5);
  vec3 c = u_usePal == 1 ? agPalette(k) : mix(u_colA, u_colB, k);
  if (u_colorBy == 5) {
    float b = floor(C.w / 65536.0), g = floor((C.w - b * 65536.0) / 256.0);
    c = vec3(C.w - b * 65536.0 - g * 256.0, g, b) / 255.0;
  }
  vec4 P = vec4(A.xyz, A.w);
${GP_LIGHTS}
  vec3 eye = u_eye, f = u_fwd, r = u_right, u = u_up;
  float lens = u_lens, cd = u_camDist, focus = u_focus;
  if (u_camSrc == 1) {
    // A ray-marched scene's camera: its origin, and its rays at the centre, half a picture right and half up.
    eye = texelFetch(u_cam, ivec2(0, 0), 0).xyz;
    f = normalize(texelFetch(u_cam, ivec2(1, 0), 0).xyz);
    vec3 rx = normalize(texelFetch(u_cam, ivec2(2, 0), 0).xyz), ry = normalize(texelFetch(u_cam, ivec2(3, 0), 0).xyz);
    float cx = dot(rx, f), cy = clamp(dot(ry, f), -0.9999, 0.9999);
    lens = 0.5 / tan(acos(cy));
    r = normalize(rx - cx * f);
    u = normalize(ry - cy * f);
    u = normalize(u - dot(r, u) * r);
    cd = max(0.1, dot(-eye, f));
    focus = max(0.05, u_focus * cd);
  }
  vec3 pos = A.xyz - B.xyz * (u_thread * float(end));
  vec3 d = pos - eye;
  float z = dot(d, f);
  float fl = clamp(u_ortho, 0.0, 1.0);
  if (z < 0.06 && fl < 0.999) { agCull(); return; }
  float w = mix(z, cd, fl);
  vec2 q = vec2(dot(d, r), dot(d, u)) * lens / w;
  v_dist = length(d);
  float s = u_size * (1.0 + 0.35 * min(near, 4.0)) * cd / w;
  float wt = fade * u_bright;
  // Depth of field: the circle of confusion. The point grows to it and keeps its light, so out of focus is haze.
  float coc = u_coc * abs(z - focus) / max(z, 0.06);
  float se = max(s, coc);
  float sharp = 1.0 / (1.0 + coc * coc * 0.25);
  float share = u_prim == 1 ? sharp : u_thread > 0.0 ? 1.0 - sharp : 1.0;
  if (share < 0.04) { agCull(); return; }
  wt *= share;
  wt *= max(s * s, 1.0) / max(se * se, 1.0);
  if (u_prim == 0 && se > u_cap) {
    float keep = (u_cap * u_cap) / (se * se);
    if (float(agThinHash(uint(id) * 2246822519u + 3266489917u) >> 8) / 16777216.0 > keep) { agCull(); return; }
    wt /= keep;
  }
  // Very near the lens a walker fades rather than filling the screen.
  wt *= mix(smoothstep(0.06, 0.4, z), 1.0, fl);
  gl_Position = vec4(q.x / u_aspect, q.y, 0.0, 1.0);
  gl_PointSize = clamp(se, 1.0, 64.0);
  wt *= u_prim == 1 ? 1.0 : min(1.0, se * se);
  v_col = u_ink == 1 ? vec4(c * L * wt, wt * (L.r + L.g + L.b) / 3.0) : vec4(c * L * wt, wt);
}`;
