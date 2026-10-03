/**
 * gpuParticles.js — the Particles node's engine: up to 4M particles simulated
 * and drawn on the GPU, lit by point lights, with a built-in glow, in the
 * graph's picture space (a picture height is 2, x runs ±aspect). See
 * docs/gpu-particles-plan.md.
 *
 * How it works, per frame:
 *   1. Simulate: the state lives in two pairs of float textures, one texel a
 *      particle (pos.xyz + age, vel.xyz + life). One fullscreen pass with two
 *      render targets moves every particle (gravity, curl-noise turbulence,
 *      swirl, an attractor, drag) and gives birth to the texels in the
 *      emission window: a ring [head, head + n) that walks round the pool, so
 *      emitting is a uniform, not a search. A frame's dt is split into equal
 *      substeps of at most 1/60 s; randomness is hashed from the particle's
 *      index and the substep count, so a render is the same every time.
 *   2. Draw: one draw call of N points, each reading its state with
 *      texelFetch(gl_VertexID): soft additive points into a half-float target,
 *      brightened by up to four point lights (Σ colour · power / (1 + (d/r)²))
 *      and a little bigger near them.
 *   3. Glow: the drawn particles at 1/4 and 1/16 size, blurred, added back,
 *      with each light's halo. The result (rgb light, a density) is the
 *      texture the graph samples, before the picture is dithered.
 *
 * Hosts: the app runs it on ShaderCanvas's three.js context (then resets
 * three's state) and binds the result as a THREE.ExternalTexture
 * (play/gpuParticlesTexture.ts); the web runtime runs it on its own WebGL2
 * context. Both find the nodes in the compiled shader (gpBindings) and read
 * the nodes' numbers from their uniforms, so sliders, Play controls and
 * mappings drive it in both. Needs WebGL2 and float or half-float render
 * targets (gpSupport); without them the node passes its picture through.
 *
 * Part of the layer kit: exportHtml.ts inlines it into web exports, so every
 * top-level name keeps the `gp`/`GP_` prefix.
 */

/** Particle counts: the state texture's side for each. */
export const GP_TIERS = { '64k': 256, '256k': 512, '1m': 1024, '4m': 2048 };
/** Emitter shapes, in the order the simulation shader numbers them. */
export const GP_SHAPES = ['point', 'line', 'ring', 'disk', 'sphere', 'ball', 'box'];
/** Colour gradients over 0…1 (life, speed or heading): four stops each, linear light. */
export const GP_PALETTES = {
  ember: [[1.0, 0.86, 0.55], [1.0, 0.45, 0.1], [0.75, 0.12, 0.04], [0.22, 0.02, 0.08]],
  ice: [[0.85, 0.96, 1.0], [0.35, 0.72, 1.0], [0.12, 0.28, 0.95], [0.12, 0.04, 0.4]],
  aurora: [[0.65, 1.0, 0.75], [0.1, 0.9, 0.6], [0.15, 0.4, 1.0], [0.6, 0.15, 0.9]],
  neon: [[1.0, 0.3, 0.85], [0.55, 0.25, 1.0], [0.1, 0.75, 1.0], [0.2, 1.0, 0.6]],
  gold: [[1.0, 0.95, 0.8], [1.0, 0.78, 0.38], [0.85, 0.5, 0.16], [0.35, 0.16, 0.05]],
  mono: [[1.0, 1.0, 1.0], [0.8, 0.82, 0.88], [0.5, 0.52, 0.58], [0.2, 0.2, 0.25]],
  rainbow: null,
};
/**
 * Every setting and its default: the node's defaults (nodes/definitions/gpuParticles.ts).
 * Numbers are clamped to [min, max] when read (gpParams).
 */
export const GP_DEFAULTS = {
  count: '256k', emitter: 'ring', emit: 'stream', follow: 'none',
  emitSize: 0.4, life: 4, speed: 0.08, spread: 0.4,
  gravity: 0, turbulence: 0.4, swirl: 0.3, attract: 0, drag: 1.0,
  size: 2, brightness: 1, palette: 'ember', colorBy: 'life', glow: 0.8,
  lights: '4', lightColor: [1, 0.55, 0.25], lightPower: 1.6, lightReach: 0.3, halo: 0.5, lightMotion: 'orbit',
};
/** The number settings' ranges (physical limits, not the sliders'). */
export const GP_LIMITS = {
  emitSize: [0, 4], life: [0.05, 60], speed: [-10, 10], spread: [0, 1],
  gravity: [-20, 20], turbulence: [0, 20], swirl: [-20, 20], attract: [-20, 20], drag: [0, 20],
  size: [0.25, 32], brightness: [0, 50], glow: [0, 10], lightPower: [0, 50], lightReach: [0.01, 10], halo: [0, 10],
};
const GP_CHOICES = {
  count: Object.keys(GP_TIERS), emitter: GP_SHAPES, emit: ['stream', 'burst'], follow: ['none', 'emitter', 'attractor', 'lights'],
  palette: Object.keys(GP_PALETTES), colorBy: ['life', 'speed', 'heading'], lights: ['0', '1', '2', '3', '4'], lightMotion: ['orbit', 'still'],
};
/** Longest a frame's step may be (a stall doesn't fling the particles), and the substep. */
export const GP_MAX_DT = 0.1;
export const GP_SUBSTEP = 1 / 60;
/** Pre-roll on a reset: this much simulated time at most, at 1/30 s steps, so the cloud starts full. */
export const GP_PREROLL = 6;

/** The marker the node writes in the compiled shader, before its JSON. */
export const GP_MARK = '// gpu-particles ';

/** Side of the state texture for a count tier (256k when unknown). */
export function gpTierSide(tier) {
  return GP_TIERS[tier] || GP_TIERS['256k'];
}

/**
 * The Particles nodes a compiled shader declares: each one's sampler uniform
 * and its settings as the node wrote them (a number, a uniform's name, or a
 * choice). Read from the `uniform sampler2D u_gpup_…; // gpu-particles {…}`
 * lines; each sampler once.
 */
export function gpBindings(fragmentShader) {
  const out = [], seen = new Set();
  const re = /uniform\s+sampler2D\s+(\w+)\s*;\s*\/\/ gpu-particles (\{[^\n]*\})/g;
  let m;
  while ((m = re.exec(fragmentShader || ''))) {
    if (seen.has(m[1])) continue;
    let cfg;
    try { cfg = JSON.parse(m[2]); } catch (e) { continue; }
    if (!cfg || typeof cfg !== 'object') continue;
    seen.add(m[1]);
    out.push({ uniform: m[1], params: cfg.p && typeof cfg.p === 'object' ? cfg.p : {} });
  }
  return out;
}

const gpNum = v => (typeof v === 'number' && isFinite(v) ? v : null);
/** A uniform's value as a number or [r, g, b] (three.js vectors and colours too). */
function gpValue(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    if (typeof v.r === 'number') return [v.r, v.g, v.b];
    if (typeof v.x === 'number') return [v.x, v.y, v.z || 0];
  }
  return null;
}

/**
 * The settings for this frame: each one from the node (a number as it is, a
 * uniform's name through `read`, a choice checked against the list), its
 * default when missing or unreadable (a keyframed number), numbers clamped.
 */
export function gpParams(raw, read) {
  const p = {};
  for (const key in GP_DEFAULTS) {
    const def = GP_DEFAULTS[key];
    let v = raw ? raw[key] : undefined;
    if (GP_CHOICES[key]) {
      p[key] = GP_CHOICES[key].indexOf(String(v)) >= 0 ? String(v) : def;
      continue;
    }
    if (typeof v === 'string' && read && /^u_\w+$/.test(v)) v = gpValue(read(v));
    if (Array.isArray(def)) {
      p[key] = Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(x => gpNum(x) !== null) ? [v[0], v[1], v[2]] : def.slice();
      continue;
    }
    const n = gpNum(v);
    const lim = GP_LIMITS[key];
    p[key] = n === null ? def : lim ? Math.min(lim[1], Math.max(lim[0], n)) : n;
  }
  return p;
}

/**
 * Equal substeps of at most GP_SUBSTEP covering dt (clamped to GP_MAX_DT): { n, h }; n = 0 for no
 * time. At most `max` of them (a big pool takes longer steps rather than more: a slow frame must not
 * make the next one slower still).
 */
export function gpSubsteps(dt, max) {
  const t = Math.min(GP_MAX_DT, Math.max(0, +dt || 0));
  if (t <= 0) return { n: 0, h: 0 };
  const n = Math.min(Math.max(1, max || Infinity), Math.max(1, Math.ceil(t / GP_SUBSTEP - 1e-6)));
  return { n, h: t / n };
}

/** How many substeps a frame may take for a pool of n: fewer for the big ones. */
export function gpMaxSubsteps(n) {
  return n > 1100000 ? 1 : n > 300000 ? 2 : 4;
}

/** A fresh emitter: the ring's head, the fractional births carried over, the burst clock. */
export function gpEmitterState() {
  return { head: 0, carry: 0, clock: 0, burst: -1 };
}

/**
 * This substep's births: the window [start, start + count) of the ring (it
 * wraps), advancing `st`. Stream: the pool turns over once a longest life
 * (count / (life · (1 + lifeVar))), so no particle is reborn while it lives.
 * Burst: the whole pool at once, every longest life.
 */
export function gpEmit(st, mode, n, life, lifeVar, h) {
  const span = Math.max(0.05, life * (1 + lifeVar));
  st.clock += h;
  if (mode === 'burst') {
    // (The clock is a sum of substeps: a hair of slack keeps float error off the boundaries.)
    const k = Math.floor((st.clock - h) / span + 1e-6);
    if (k !== st.burst) { st.burst = k; return { start: 0, count: n }; }
    return { start: 0, count: 0 };
  }
  st.carry += n / span * h;
  const count = Math.min(n, Math.floor(st.carry));
  st.carry -= count;
  const start = st.head;
  st.head = (st.head + count) % n;
  return { start, count };
}

/** Is particle `i` in the window? (The simulation shader's test, for the tests.) */
export function gpInWindow(i, start, count, n) {
  return ((i - start) % n + n) % n < count;
}

/** `rgb` turned round the hue circle by `turns` (luma kept, as a YIQ rotation). */
export function gpHueRotate(rgb, turns) {
  const a = turns * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
  const y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const i = 0.596 * rgb[0] - 0.274 * rgb[1] - 0.322 * rgb[2];
  const q = 0.211 * rgb[0] - 0.523 * rgb[1] + 0.312 * rgb[2];
  const i2 = i * c - q * s, q2 = i * s + q * c;
  return [
    Math.max(0, y + 0.956 * i2 + 0.621 * q2),
    Math.max(0, y - 0.272 * i2 - 0.647 * q2),
    Math.max(0, y - 1.106 * i2 + 1.703 * q2),
  ];
}

/**
 * Where the emitter, the attractor and the lights are at `time`, in picture
 * space. `mouse` is the pointer in 0…1 of the picture (y up), or null. The
 * lights orbit the emitter (or stand still round it), each the light colour's
 * neighbour on the hue circle (alternately either side, so they stay near it).
 * "Mouse moves" puts one of them (or the emitter, or the attractor) under the
 * pointer.
 */
export function gpPlace(p, time, mouse, aspect) {
  const m = mouse ? [(mouse[0] * 2 - 1) * aspect, mouse[1] * 2 - 1] : null;
  const emitAt = p.follow === 'emitter' && m ? m : [0, 0];
  const attractAt = p.follow === 'attractor' && m ? m : [0, 0];
  const n = +p.lights || 0, lights = [];
  const R = Math.min(1.2, 0.2 + p.emitSize * 0.7);
  const centre = p.follow === 'lights' && m ? m : emitAt;
  for (let k = 0; k < n; k++) {
    let x, y;
    if (p.follow === 'lights' && m && k === 0) { x = m[0]; y = m[1]; }
    else if (p.lightMotion === 'still') {
      const a = k / n * Math.PI * 2 + Math.PI / 4;
      x = centre[0] + Math.cos(a) * R * 0.8; y = centre[1] + Math.sin(a) * R * 0.8;
    } else {
      const dir = k % 2 ? -1 : 1;
      const a = k / n * Math.PI * 2 + dir * time * (0.32 + 0.09 * k);
      const r = R * (0.75 + 0.3 * Math.sin(time * 0.37 + k * 1.9));
      x = centre[0] + Math.cos(a) * r; y = centre[1] + Math.sin(a) * r * 0.8;
    }
    lights.push({ x, y, reach: p.lightReach, power: p.lightPower, colour: gpHueRotate(p.lightColor, (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05) });
  }
  return { emitAt, attractAt, lights };
}

/** How bright one particle is, so the cloud looks about as bright at every count and size. */
export function gpUnitBrightness(n, size) {
  const area = Math.max(1, 0.2 * size * size);
  // A little steeper than 1/√n: a big pool piles up more where it is dense.
  return 0.1 * Math.pow(262144 / Math.max(1, n), 0.65) / Math.sqrt(area);
}

/** Why the engine can't run on `gl` (a sentence for the person), or null when it can. */
export function gpUnsupported(gl) {
  if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
    return 'Particles need WebGL2, which this browser does not offer here.';
  }
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
    return 'Particles need float render targets (EXT_color_buffer_float), which this GPU does not offer.';
  }
  return null;
}

const GP_QUAD_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const GP_HASH = `
uint gpHash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float gpRnd(inout uint s) { s = gpHash(s); return float(s >> 8) / 16777216.0; }
vec3 gpUnit(inout uint s) { float z = gpRnd(s) * 2.0 - 1.0, a = gpRnd(s) * 6.2831853, r = sqrt(max(0.0, 1.0 - z * z)); return vec3(r * cos(a), r * sin(a), z); }
`;

// Gradient noise with its derivatives (after Inigo Quilez): .x the value, .yzw d/dx, d/dy, d/dz.
const GP_NOISE = `
vec3 gpGrad(vec3 p) {
  uvec3 q = uvec3(ivec3(p) + 32768);
  // One hash, three bytes: a gradient in the unit cube (no trigonometry; this runs 16 times a particle).
  uint h = gpHash(q.x * 73856093u ^ q.y * 19349663u ^ q.z * 83492791u);
  return vec3(uvec3(h, h >> 8, h >> 16) & 255u) / 127.5 - 1.0;
}
vec4 gpNoised(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec3 ga = gpGrad(i), gb = gpGrad(i + vec3(1, 0, 0)), gc = gpGrad(i + vec3(0, 1, 0)), gd = gpGrad(i + vec3(1, 1, 0));
  vec3 ge = gpGrad(i + vec3(0, 0, 1)), gf = gpGrad(i + vec3(1, 0, 1)), gg = gpGrad(i + vec3(0, 1, 1)), gh = gpGrad(i + vec3(1, 1, 1));
  float va = dot(ga, f), vb = dot(gb, f - vec3(1, 0, 0)), vc = dot(gc, f - vec3(0, 1, 0)), vd = dot(gd, f - vec3(1, 1, 0));
  float ve = dot(ge, f - vec3(0, 0, 1)), vf = dot(gf, f - vec3(1, 0, 1)), vg = dot(gg, f - vec3(0, 1, 1)), vh = dot(gh, f - vec3(1, 1, 1));
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * (va - vb - vc + vd)
    + u.y * u.z * (va - vc - ve + vg) + u.z * u.x * (va - vb - ve + vf) + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);
  vec3 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd)
    + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
    + du * (vec3(vb - va, vc - va, ve - va) + u.yzx * vec3(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf)
    + u.zxy * vec3(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg) + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh));
  return vec4(v, d);
}
`;

const GP_SIM = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_pos;
uniform highp sampler2D u_vel;
uniform int u_side;
uniform float u_n, u_start, u_count, u_dt, u_time;
uniform uint u_seed;
uniform int u_shape;
uniform vec2 u_emitAt, u_attractAt;
uniform float u_emitSize, u_life, u_lifeVar, u_speed, u_spread;
uniform float u_gravity, u_turb, u_swirl, u_attract, u_drag;
layout(location = 0) out vec4 o_pos;
layout(location = 1) out vec4 o_vel;
${GP_HASH}
${GP_NOISE}
void gpSpawn(float i, out vec4 P, out vec4 V) {
  uint s = gpHash(uint(i) * 1664525u ^ gpHash(u_seed + 1013904223u));
  vec3 p = vec3(0.0), n = vec3(0.0, 1.0, 0.0);
  float a = gpRnd(s) * 6.2831853;
  if (u_shape == 1) { p = vec3(gpRnd(s) * 2.0 - 1.0, 0.0, 0.0); }
  else if (u_shape == 2) { n = vec3(cos(a), sin(a), 0.0); p = n * (1.0 + (gpRnd(s) - 0.5) * 0.04); }
  else if (u_shape == 3) { n = vec3(cos(a), sin(a), 0.0); p = n * sqrt(gpRnd(s)); }
  else if (u_shape == 4) { n = gpUnit(s); p = n; }
  else if (u_shape == 5) { n = gpUnit(s); p = n * pow(gpRnd(s), 1.0 / 3.0); }
  else if (u_shape == 6) { p = vec3(gpRnd(s), gpRnd(s), gpRnd(s)) * 2.0 - 1.0; n = gpUnit(s); }
  vec3 dir = normalize(mix(n, gpUnit(s), u_spread) + vec3(0.0, 1e-4, 0.0));
  float sp = u_speed * (0.55 + 0.9 * gpRnd(s));
  float life = max(0.05, u_life * (1.0 + u_lifeVar * (gpRnd(s) * 2.0 - 1.0)));
  // Born at a random point of this substep, so a stream has no stripes.
  float lead = gpRnd(s) * u_dt;
  P = vec4(vec3(u_emitAt, 0.0) + p * u_emitSize + dir * sp * lead, lead);
  V = vec4(dir * sp, life);
}
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  float i = float(t.y * u_side + t.x);
  vec4 P = texelFetch(u_pos, t, 0), V = texelFetch(u_vel, t, 0);
  if (mod(i - u_start + u_n, u_n) < u_count) { gpSpawn(i, P, V); o_pos = P; o_vel = V; return; }
  if (V.w <= 0.0 || P.w >= V.w) { o_pos = P; o_vel = vec4(0.0); return; }
  vec3 p = P.xyz, v = V.xyz;
  vec3 f = vec3(0.0, -u_gravity, 0.0);
  if (u_turb != 0.0) {
    // Curl noise: divergence-free in the picture's plane, so it curls without bunching up.
    vec3 q = p * 2.4 + vec3(0.0, 0.0, u_time * 0.15);
    vec4 a = gpNoised(q), b = gpNoised(q * 2.03 + vec3(17.1, 5.3, 31.4));
    vec3 c = vec3(a.z, -a.y, a.w * 0.4) + 0.5 * vec3(b.z, -b.y, b.w * 0.4);
    f += c * u_turb;
  }
  vec2 d = p.xy - u_emitAt;
  float r = length(d) + 1e-4;
  f.xy += u_swirl * vec2(-d.y, d.x) / r * (r / (0.25 + r * r));
  vec3 g = vec3(u_attractAt, 0.0) - p;
  float ra = length(g) + 1e-4;
  f += u_attract * g / ra / (0.2 + ra);
  v += f * u_dt;
  v *= exp(-u_drag * u_dt);
  p += v * u_dt;
  o_pos = vec4(p, P.w + u_dt);
  o_vel = vec4(v, V.w);
}`;

const GP_DRAW_VERT = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_pos;
uniform highp sampler2D u_vel;
uniform int u_side;
uniform float u_aspect, u_size, u_bright, u_px, u_speed;
uniform vec3 u_pal[4];
uniform int u_rainbow, u_colorBy, u_lights;
uniform vec4 u_light[4];
uniform vec3 u_lightCol[4];
out vec3 v_col;
vec3 gpPalette(float t) {
  if (u_rainbow == 1) return clamp(abs(fract(t + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  t = clamp(t, 0.0, 1.0) * 3.0;
  int k = int(min(floor(t), 2.0));
  return mix(u_pal[k], u_pal[k + 1], t - float(k));
}
void main() {
  ivec2 t = ivec2(gl_VertexID % u_side, gl_VertexID / u_side);
  vec4 P = texelFetch(u_pos, t, 0), V = texelFetch(u_vel, t, 0);
  v_col = vec3(0.0);
  if (V.w <= 0.0 || P.w >= V.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float a = P.w / V.w;
  float fade = smoothstep(0.0, 0.06, a) * (1.0 - smoothstep(0.5, 1.0, a));
  float k = a;
  if (u_colorBy == 1) k = 1.0 - clamp(length(V.xyz) / max(0.05, 2.5 * abs(u_speed) + 0.25), 0.0, 1.0);
  else if (u_colorBy == 2) k = fract(atan(V.y, V.x) / 6.2831853 + 0.5);
  vec3 c = gpPalette(k);
  vec3 L = vec3(u_lights > 0 ? 0.22 : 1.0);
  float near = 0.0;
  for (int j = 0; j < 4; j++) {
    if (j >= u_lights) break;
    vec2 d = P.xy - u_light[j].xy;
    float q = dot(d, d) / (u_light[j].z * u_light[j].z);
    float e = u_light[j].w / (1.0 + q);
    L += u_lightCol[j] * e;
    near += e;
  }
  float s = u_size * u_px * (1.0 + 0.35 * min(near, 4.0)) * clamp(1.0 + 0.3 * P.z, 0.5, 1.8);
  gl_PointSize = clamp(s, 1.0, 48.0);
  // A point smaller than a pixel still covers one: its light goes down with its area instead.
  float sub = min(1.0, s * s);
  v_col = c * L * fade * u_bright * sub;
  gl_Position = vec4(P.x / u_aspect, P.y, 0.0, 1.0);
}`;

const GP_DRAW_FRAG = `#version 300 es
precision highp float;
in vec3 v_col;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 3.0);
  o = vec4(v_col * g, g * 0.06);
}`;

// A 4× smaller copy (each texel the mean of a 4×4 block, from four bilinear taps).
const GP_DOWN = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_texel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * 4.0 * u_texel;
  o = 0.25 * (texture(u_src, uv + u_texel * vec2(-1.0, -1.0)) + texture(u_src, uv + u_texel * vec2(1.0, -1.0))
    + texture(u_src, uv + u_texel * vec2(-1.0, 1.0)) + texture(u_src, uv + u_texel * vec2(1.0, 1.0)));
}`;

// A 9-tap Gaussian along u_dir, in five bilinear fetches.
const GP_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_dir;
uniform vec2 u_size;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size, s = u_dir / u_size;
  o = texture(u_src, uv) * 0.2270270270
    + (texture(u_src, uv + s * 1.3846153846) + texture(u_src, uv - s * 1.3846153846)) * 0.3162162162
    + (texture(u_src, uv + s * 3.2307692308) + texture(u_src, uv - s * 3.2307692308)) * 0.0702702703;
}`;

const GP_COMPOSE = `#version 300 es
precision highp float;
uniform sampler2D u_acc;
uniform sampler2D u_g1;
uniform sampler2D u_g2;
uniform vec2 u_size;
uniform float u_aspect, u_glow, u_halo;
uniform int u_lights;
uniform vec4 u_light[4];
uniform vec3 u_lightCol[4];
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec4 acc = texture(u_acc, uv);
  vec3 c = acc.rgb + u_glow * (0.6 * texture(u_g1, uv).rgb + 1.1 * texture(u_g2, uv).rgb);
  vec2 q = (uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);
  for (int j = 0; j < 4; j++) {
    if (j >= u_lights) break;
    vec2 d = q - u_light[j].xy;
    float r = u_light[j].z * 0.22;
    float e = dot(d, d) / (r * r);
    c += u_lightCol[j] * u_light[j].w * u_halo * (0.08 / (1.0 + e) + 0.6 * exp(-e * 2.0));
  }
  o = vec4(c, acc.a);
}`;

/**
 * One particle system on `gl`, or null where it can't run (gpUnsupported says
 * why, or a shader didn't compile). `frame` steps it by dt and draws it at
 * width × height; it returns the texture to sample (RGBA16F, linear, row 0
 * at the bottom), or null. It leaves the context's bindings as it found
 * them, except that a three.js host must still call renderer.resetState().
 */
export function gpCreate(gl) {
  if (gpUnsupported(gl)) return null;
  const f32 = !!gl.getExtension('EXT_color_buffer_float');
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      if (typeof console !== 'undefined') console.warn('[gpuParticles] shader did not compile', gl.getShaderInfoLog(s));
      gl.deleteShader(s); return null;
    }
    return s;
  };
  const link = (vsSrc, fsSrc) => {
    const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) { if (vs) gl.deleteShader(vs); if (fs) gl.deleteShader(fs); return null; }
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (typeof console !== 'undefined') console.warn('[gpuParticles] program did not link', gl.getProgramInfoLog(p));
      gl.deleteProgram(p); return null;
    }
    const u = {}, count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };
  const progs = {
    sim: link(GP_QUAD_VERT, GP_SIM), draw: link(GP_DRAW_VERT, GP_DRAW_FRAG), down: link(GP_QUAD_VERT, GP_DOWN),
    blur: link(GP_QUAD_VERT, GP_BLUR), compose: link(GP_QUAD_VERT, GP_COMPOSE),
  };
  if (Object.values(progs).some(x => !x)) { for (const x of Object.values(progs)) if (x) gl.deleteProgram(x.p); return null; }
  const vao = gl.createVertexArray();
  const fbo = gl.createFramebuffer();
  const stateFormat = f32 ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA16F, gl.HALF_FLOAT];

  const tex = (internal, type, filter, w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    return t;
  };
  const attach = (a, b) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b || null, 0);
    gl.drawBuffers(b ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0]);
  };
  const clear = () => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };

  // The state: [pos, vel] read, [pos, vel] written, swapped each substep.
  let side = 0, state = null, broken = false;
  // The look: the drawn particles, two glow levels (each with a scratch for the blur), the result.
  let W = 0, H = 0, look = null;
  let emitter = gpEmitterState(), seed = 0, lastTime = NaN, needPreroll = true, pendingReset = false;

  const freeState = () => { if (state) for (const t of state.flat()) gl.deleteTexture(t); state = null; side = 0; };
  const freeLook = () => { if (look) for (const k in look) gl.deleteTexture(look[k].t); look = null; W = H = 0; };

  const ensureState = s => {
    if (s === side && state) return true;
    freeState();
    const mk = () => tex(stateFormat[0], stateFormat[1], gl.NEAREST, s, s);
    state = [[mk(), mk()], [mk(), mk()]];
    side = s;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (const pair of state) {
      attach(pair[0], pair[1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { freeState(); return false; }
      gl.viewport(0, 0, s, s); clear();
    }
    emitter = gpEmitterState(); seed = 0; needPreroll = true;
    return true;
  };
  const ensureLook = (w, h) => {
    if (look && w === W && h === H) return true;
    freeLook();
    const q1 = [Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4))];
    const q2 = [Math.max(1, Math.ceil(q1[0] / 4)), Math.max(1, Math.ceil(q1[1] / 4))];
    const mk = (sz) => ({ t: tex(gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR, sz[0], sz[1]), w: sz[0], h: sz[1] });
    look = { acc: mk([w, h]), g1: mk(q1), s1: mk(q1), g2: mk(q2), s2: mk(q2), out: mk([w, h]) };
    W = w; H = h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    attach(look.acc.t);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { freeLook(); return false; }
    return true;
  };

  const shapeIndex = name => Math.max(0, GP_SHAPES.indexOf(name));
  function substep(P, n, h, time, place) {
    const win = gpEmit(emitter, P.emit, n, P.life, 0.5, h);
    const sim = progs.sim, u = sim.u;
    gl.useProgram(sim.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state[0][0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, state[0][1]);
    gl.uniform1i(u.u_pos, 0); gl.uniform1i(u.u_vel, 1);
    gl.uniform1i(u.u_side, side); gl.uniform1f(u.u_n, n);
    gl.uniform1f(u.u_start, win.start); gl.uniform1f(u.u_count, win.count);
    gl.uniform1f(u.u_dt, h); gl.uniform1f(u.u_time, time); gl.uniform1ui(u.u_seed, seed >>> 0);
    gl.uniform1i(u.u_shape, shapeIndex(P.emitter));
    gl.uniform2f(u.u_emitAt, place.emitAt[0], place.emitAt[1]); gl.uniform2f(u.u_attractAt, place.attractAt[0], place.attractAt[1]);
    gl.uniform1f(u.u_emitSize, P.emitSize); gl.uniform1f(u.u_life, P.life); gl.uniform1f(u.u_lifeVar, 0.5);
    gl.uniform1f(u.u_speed, P.speed); gl.uniform1f(u.u_spread, P.spread);
    gl.uniform1f(u.u_gravity, P.gravity); gl.uniform1f(u.u_turb, P.turbulence); gl.uniform1f(u.u_swirl, P.swirl);
    gl.uniform1f(u.u_attract, P.attract); gl.uniform1f(u.u_drag, P.drag);
    attach(state[1][0], state[1][1]);
    gl.viewport(0, 0, side, side);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    state.reverse();
    seed++;
  }

  const lightUniforms = (u, place) => {
    const L = new Float32Array(16), C = new Float32Array(12);
    place.lights.forEach((l, k) => { L.set([l.x, l.y, l.reach, l.power], k * 4); C.set(l.colour, k * 3); });
    gl.uniform1i(u.u_lights, place.lights.length);
    if (u.u_light) gl.uniform4fv(u.u_light, L);
    if (u.u_lightCol) gl.uniform3fv(u.u_lightCol, C);
  };

  function quad(prog, target, w, h) {
    gl.useProgram(prog.p);
    attach(target);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render(P, n, aspect, place) {
    // 1. The particles, additive, into the half-float target.
    const d = progs.draw, u = d.u;
    gl.useProgram(d.p);
    attach(look.acc.t);
    gl.viewport(0, 0, W, H); clear();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state[0][0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, state[0][1]);
    gl.uniform1i(u.u_pos, 0); gl.uniform1i(u.u_vel, 1); gl.uniform1i(u.u_side, side);
    gl.uniform1f(u.u_aspect, aspect);
    // Sizes are in pixels of a 720-pixel-high picture, and sprites shrink as the count grows (fill rate).
    const maxSize = n > 1100000 ? 3 : n > 300000 ? 8 : 32;
    const size = Math.min(P.size, maxSize);
    gl.uniform1f(u.u_size, size); gl.uniform1f(u.u_px, Math.max(0.5, H / 720)); gl.uniform1f(u.u_speed, P.speed);
    gl.uniform1f(u.u_bright, P.brightness * gpUnitBrightness(n, size));
    const pal = GP_PALETTES[P.palette];
    gl.uniform1i(u.u_rainbow, pal ? 0 : 1);
    if (pal && u.u_pal) gl.uniform3fv(u.u_pal, new Float32Array(pal.flat()));
    gl.uniform1i(u.u_colorBy, ['life', 'speed', 'heading'].indexOf(P.colorBy));
    lightUniforms(u, place);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
    // 2. Glow: 1/4 and 1/16 size, each blurred across and down.
    const levels = [[look.acc, look.g1, look.s1], [look.g1, look.g2, look.s2]];
    for (const [src, dst, tmp] of levels) {
      gl.useProgram(progs.down.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t);
      gl.uniform1i(progs.down.u.u_src, 0); gl.uniform2f(progs.down.u.u_texel, 1 / src.w, 1 / src.h);
      quad(progs.down, dst.t, dst.w, dst.h);
      const b = progs.blur;
      gl.useProgram(b.p);
      gl.uniform1i(b.u.u_src, 0); gl.uniform2f(b.u.u_size, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, dst.t); gl.uniform2f(b.u.u_dir, 1, 0); quad(b, tmp.t, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, tmp.t); gl.uniform2f(b.u.u_dir, 0, 1); quad(b, dst.t, dst.w, dst.h);
    }
    // 3. The particles, their glow and the lights' halos.
    const c = progs.compose;
    gl.useProgram(c.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, look.acc.t);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, look.g1.t);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, look.g2.t);
    gl.uniform1i(c.u.u_acc, 0); gl.uniform1i(c.u.u_g1, 1); gl.uniform1i(c.u.u_g2, 2);
    gl.uniform2f(c.u.u_size, W, H); gl.uniform1f(c.u.u_aspect, aspect);
    gl.uniform1f(c.u.u_glow, P.glow); gl.uniform1f(c.u.u_halo, P.halo);
    lightUniforms(c.u, place);
    quad(c, look.out.t, W, H);
  }

  /**
   * Step by `dt` (0 holds still) and draw at width × height. `time` is the
   * setup's clock: going back (a rewind, a seek, a new render) starts over,
   * with a pre-roll so the cloud is already full.
   */
  function frame(o) {
    if (broken) return null;
    const P = o.params, w = Math.max(1, Math.round(o.width)), h = Math.max(1, Math.round(o.height));
    const aspect = w / h, time = +o.time || 0, s = gpTierSide(P.count), n = s * s;
    const saved = {
      fb: gl.getParameter(gl.FRAMEBUFFER_BINDING), vp: gl.getParameter(gl.VIEWPORT), prog: gl.getParameter(gl.CURRENT_PROGRAM),
      vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), active: gl.getParameter(gl.ACTIVE_TEXTURE),
      blend: gl.isEnabled(gl.BLEND), depth: gl.isEnabled(gl.DEPTH_TEST), scissor: gl.isEnabled(gl.SCISSOR_TEST), cull: gl.isEnabled(gl.CULL_FACE),
      bsrc: gl.getParameter(gl.BLEND_SRC_RGB), bdst: gl.getParameter(gl.BLEND_DST_RGB), basrc: gl.getParameter(gl.BLEND_SRC_ALPHA), badst: gl.getParameter(gl.BLEND_DST_ALPHA),
      beq: gl.getParameter(gl.BLEND_EQUATION_RGB), beqa: gl.getParameter(gl.BLEND_EQUATION_ALPHA), clear: gl.getParameter(gl.COLOR_CLEAR_VALUE),
      mask: gl.getParameter(gl.COLOR_WRITEMASK),
    };
    const units = [0, 1, 2].map(i => { gl.activeTexture(gl.TEXTURE0 + i); return gl.getParameter(gl.TEXTURE_BINDING_2D); });
    let result = null;
    try {
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.bindVertexArray(vao);
      if (!ensureState(s) || !ensureLook(w, h)) { broken = true; return null; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      if (o.reset || pendingReset || (isFinite(lastTime) && time < lastTime - 1e-4)) {
        pendingReset = false;
        gl.viewport(0, 0, side, side);
        for (const pair of state) { attach(pair[0], pair[1]); clear(); }
        emitter = gpEmitterState(); seed = 0; needPreroll = true;
      }
      lastTime = time;
      if (needPreroll) {
        needPreroll = false;
        // Coarser for the big pools: the pre-roll is one frame's work.
        const span = Math.min(GP_PREROLL, P.life * 1.5), rate = n > 1100000 ? 10 : n > 300000 ? 20 : 30;
        const steps = Math.ceil(span * rate);
        for (let k = 0; k < steps; k++) {
          const t = time - span + k / rate;
          substep(P, n, 1 / rate, t, gpPlace(P, t, o.mouse, aspect));
        }
      }
      const st = gpSubsteps(o.dt, gpMaxSubsteps(n));
      for (let k = 0; k < st.n; k++) {
        const t = time - (st.n - 1 - k) * st.h;
        substep(P, n, st.h, t, gpPlace(P, t, o.mouse, aspect));
      }
      render(P, n, aspect, gpPlace(P, time, o.mouse, aspect));
      result = look.out.t;
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[gpuParticles] frame failed', e);
      broken = true;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, saved.fb);
      gl.viewport(saved.vp[0], saved.vp[1], saved.vp[2], saved.vp[3]);
      gl.useProgram(saved.prog); gl.bindVertexArray(saved.vao);
      for (let i = 2; i >= 0; i--) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, units[i]); }
      gl.activeTexture(saved.active);
      gl.blendFuncSeparate(saved.bsrc, saved.bdst, saved.basrc, saved.badst);
      gl.blendEquationSeparate(saved.beq, saved.beqa);
      gl.clearColor(saved.clear[0], saved.clear[1], saved.clear[2], saved.clear[3]);
      gl.colorMask(saved.mask[0], saved.mask[1], saved.mask[2], saved.mask[3]);
      for (const [cap, on] of [[gl.BLEND, saved.blend], [gl.DEPTH_TEST, saved.depth], [gl.SCISSOR_TEST, saved.scissor], [gl.CULL_FACE, saved.cull]]) if (on) gl.enable(cap); else gl.disable(cap);
    }
    return result;
  }

  function dispose() {
    freeState(); freeLook();
    for (const x of Object.values(progs)) gl.deleteProgram(x.p);
    gl.deleteVertexArray(vao); gl.deleteFramebuffer(fbo);
    broken = true;
  }

  /** Start over on the next frame (with its pre-roll). */
  function reset() { pendingReset = true; }

  return { frame, dispose, reset, precision: f32 ? 'float' : 'half' };
}

/**
 * Every Particles node of a shader on one context. `bind(fragmentShader)`
 * after each compile finds them (gpBindings) and keeps an engine per node;
 * `frame` runs them all and returns each sampler's texture (null where the
 * engine can't run: the node then reads nothing and passes its picture
 * through). `unsupported` is why, for the host to say once.
 */
export function gpHost(gl) {
  const reason = gpUnsupported(gl);
  let bindings = [];
  const engines = new Map();
  return {
    unsupported: reason,
    bind(fragmentShader) {
      bindings = gpBindings(fragmentShader);
      const want = new Set(bindings.map(b => b.uniform));
      for (const [k, e] of engines) if (!want.has(k)) { if (e) e.dispose(); engines.delete(k); }
      return bindings;
    },
    get bindings() { return bindings; },
    active() { return bindings.length > 0; },
    /** o: { width, height, dt, time, mouse: [x, y] in 0…1 (y up) | null, read: uniform name → value, reset? } */
    frame(o) {
      const out = [];
      for (const b of bindings) {
        let e = engines.get(b.uniform);
        if (e === undefined) { e = reason ? null : gpCreate(gl); engines.set(b.uniform, e); }
        const texture = e ? e.frame({ params: gpParams(b.params, o.read), width: o.width, height: o.height, dt: o.dt, time: o.time, mouse: o.mouse, reset: o.reset }) : null;
        out.push({ uniform: b.uniform, texture });
      }
      return out;
    },
    reset() { for (const e of engines.values()) if (e) e.reset(); },
    dispose() { for (const e of engines.values()) if (e) e.dispose(); engines.clear(); bindings = []; },
  };
}
