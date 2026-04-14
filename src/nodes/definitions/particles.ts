import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── GLSL helpers ─────────────────────────────────────────────────────────────

// Hash without sine — consistent across all WebGL/GLSL ES hardware (no trig, no uint required).
// Based on "Hash without Sine" (Dave Hoskins / Fabrice Neyret).
const PARTICLE_HASH_GLSL = `
float phash(float n, float seed) {
    vec2 hv = fract(vec2(n, seed) * vec2(0.1031, 0.1030));
    hv += dot(hv, hv.yx + 33.33);
    return fract((hv.x + hv.y) * hv.x);
}
float phash2(float n, float seed) {
    vec2 hv = fract(vec2(n + 0.5, seed + 0.5) * vec2(0.1031, 0.1030));
    hv += dot(hv, hv.yx + 33.33);
    return fract((hv.x + hv.y) * hv.y);
}

// 4-octave FBM using the built-in valueNoise (always available in shader preamble).
float pfbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * valueNoise(p);
        p  = p * 2.0 + vec2(31.41, 27.18);
        a *= 0.5;
    }
    return v;
}

// Returns a direction angle for position p at time t.
//   mode 0 : FBM value noise  (slow meander)
//   mode 1 : curl of FBM      (swirling vortex)
float flowAngle(vec2 p, float scale, float t, float speed, int mode) {
    vec2 sp = p * scale + t * speed;
    if (mode == 1) {
        float eps = 0.02;
        float nx  = pfbm(sp + vec2(eps, 0.0));
        float ny  = pfbm(sp + vec2(0.0, eps));
        float n   = pfbm(sp);
        return atan(nx - n, -(ny - n));   // curl: (-dF/dy, dF/dx)
    }
    return pfbm(sp) * 6.28318;
}

// Forward Euler integration through noise field — 6 steps.
// seed_pos is the particle's birth position (in g_uv centred space).
vec2 particleFlowPos(int pidx, float t, vec2 seed_pos, float spd, float lifetime,
    float noise_scale, float noise_speed, float seed_p, int noise_mode) {

    float fi    = float(pidx);
    float si    = phash(fi, seed_p);
    float birth = fract(si * 17.23) * lifetime;
    float age   = mod(t - birth, lifetime);

    vec2  pos = seed_pos;
    float dt  = age / 6.0;
    for (int step = 0; step < 6; step++) {
        float a = flowAngle(pos, noise_scale,
                            t - age + float(step) * dt,
                            noise_speed, noise_mode);
        pos += vec2(cos(a), sin(a)) * spd * dt;
    }
    return pos;
}

// Spawn-point (linear) mode — particles fan out from a fixed position.
vec2 particlePos(int pidx, float t,
    vec2 spawn, float spd, float lifetime,
    float angle_dir, float angle_spread,
    vec2 grav, float seed_p, float despawn_r) {

    float fi    = float(pidx);
    float si    = phash(fi, seed_p);
    float birth = fract(si * 17.23) * lifetime;
    float age   = mod(t - birth, lifetime);

    float rand_a   = phash2(fi, seed_p) * 6.28318;
    float launch_a = mix(rand_a, angle_dir, 1.0 - angle_spread);
    vec2  dir      = vec2(cos(launch_a), sin(launch_a));
    float speed_i  = spd * (0.6 + 0.4 * phash(fi, seed_p + 0.7));

    vec2  pos    = spawn + dir * speed_i * age + 0.5 * grav * age * age;
    float travel = length(pos - spawn);
    if (travel > despawn_r) pos = vec2(9999.0);
    return pos;
}`;

const VF_NOISE_GLSL = `
float _vfhash(vec2 p2) {
    p2 = fract(p2 * vec2(127.1, 311.7));
    p2 += dot(p2, p2 + 19.19);
    return fract(p2.x * p2.y);
}
float _vfnoise(vec2 p2) {
    vec2 i2 = floor(p2);
    vec2 f2 = fract(p2);
    f2 = f2 * f2 * (3.0 - 2.0 * f2);
    return mix(
        mix(_vfhash(i2),               _vfhash(i2 + vec2(1.0, 0.0)), f2.x),
        mix(_vfhash(i2 + vec2(0.0, 1.0)), _vfhash(i2 + vec2(1.0, 1.0)), f2.x),
        f2.y);
}`;

// ─── ParticleEmitterNode ──────────────────────────────────────────────────────

export const ParticleEmitterNode: NodeDefinition = {
  type: 'particleEmitter',
  label: 'Particle Emitter',
  category: 'Effects',
  description:
    'GPU particle emitter — three modes:\n' +
    '• LINEAR (default): particles fan out from spawn position, driven by angle/spread/wind.\n' +
    '• NOISE: forward Euler integration through internal curl/FBM noise field — no external node needed.\n' +
    '• GRAVITY: backward-trace via external Field Dir socket (connect a Gravity Field or Vector Field).\n' +
    'Wire nearest_uv → CircleSDF for shaped dots. Wire nearest_age → Palette for age-based colour.',
  inputs: {
    position:     { type: 'vec2',  label: 'Spawn / Center' },
    time:         { type: 'float', label: 'Time'           },
    field:        { type: 'vec2',  label: 'Field Dir'      },   // gravity mode only
    lifetime:     { type: 'float', label: 'Lifetime'       },
    speed:        { type: 'float', label: 'Speed'          },
    angle_dir:    { type: 'float', label: 'Angle'          },
    angle_spread: { type: 'float', label: 'Spread'         },
  },
  outputs: {
    nearest_dist: { type: 'float', label: 'Nearest Dist' },
    nearest_uv:   { type: 'vec2',  label: 'Nearest UV'   },
    nearest_age:  { type: 'float', label: 'Age'           },
    density:      { type: 'float', label: 'Density'       },
  },
  defaultParams: {
    flow_mode:      'linear',
    max_particles:  50,
    lifetime:       2.0,
    speed:          0.3,
    // linear mode
    angle_dir:      90,
    angle_spread:   1.0,
    gravity_x:      0.0,
    gravity_y:      0.0,
    despawn_radius: 1.5,
    // noise mode
    noise_scale:    2.0,
    noise_speed:    0.3,
    noise_type:     'curl',
    spawn_radius:   1.2,
    // gravity mode
    field_strength: 1.2,
    // shared
    seed:           0.0,
    density_radius: 0.05,
  },
  paramDefs: {
    flow_mode: { label: 'Mode', type: 'select', options: [
      { value: 'linear',  label: 'Linear (spawn point)' },
      { value: 'noise',   label: 'Noise (flow field)'   },
      { value: 'gravity', label: 'Gravity (field socket)'},
    ]},
    max_particles:  { label: 'Count',          type: 'float', min: 1,    max: 100,  step: 1    },
    lifetime:       { label: 'Lifetime (s)',   type: 'float', min: 0.1,  max: 10.0, step: 0.1  },
    speed:          { label: 'Speed',          type: 'float', min: 0.0,  max: 2.0,  step: 0.01 },
    // linear mode params
    angle_dir:      { label: 'Angle (°)',      type: 'float', min: 0,    max: 360,  step: 1    },
    angle_spread:   { label: 'Spread',         type: 'float', min: 0.0,  max: 1.0,  step: 0.01 },
    gravity_x:      { label: 'Wind X',         type: 'float', min: -2.0, max: 2.0,  step: 0.01 },
    gravity_y:      { label: 'Wind Y',         type: 'float', min: -2.0, max: 2.0,  step: 0.01 },
    despawn_radius: { label: 'Despawn Radius', type: 'float', min: 0.1,  max: 5.0,  step: 0.05 },
    // noise mode params
    noise_type: { label: 'Noise Type', type: 'select', options: [
      { value: 'curl',  label: 'Curl (swirling)' },
      { value: 'value', label: 'FBM (meandering)' },
    ]},
    noise_scale:    { label: 'Noise Scale',    type: 'float', min: 0.1,  max: 10.0, step: 0.1  },
    noise_speed:    { label: 'Noise Speed',    type: 'float', min: 0.0,  max: 2.0,  step: 0.05 },
    spawn_radius:   { label: 'Spawn Radius',   type: 'float', min: 0.05, max: 3.0,  step: 0.05 },
    // gravity mode params
    field_strength: { label: 'Field Strength', type: 'float', min: 0.0,  max: 3.0,  step: 0.05 },
    // shared
    seed:           { label: 'Seed',           type: 'float', min: 0,    max: 100,  step: 1    },
    density_radius: { label: 'Dot Radius',     type: 'float', min: 0.01, max: 0.3,  step: 0.005},
  },
  glslFunctions: [PARTICLE_HASH_GLSL],

  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const posVar  = inputVars.position ?? 'vec2(0.0)';
    const timeVar = inputVars.time     ?? '0.0';
    const fieldVar = inputVars.field;           // only used in gravity mode

    // flow_mode is a compile-time constant — drives GLSL branch selection.
    const flowMode = (node.params.flow_mode as string) ?? 'linear';

    // Compile-time constant — loop bound must be a literal (not a uniform).
    const maxP = Math.max(1, Math.min(100, Math.round(Number(node.params.max_particles ?? 50))));

    // ── Shared params ──────────────────────────────────────────────────────
    const lifetime = p(node.params.lifetime, 2.0);
    const seed     = p(node.params.seed,     0.0);
    const densR    = p(node.params.density_radius, 0.05);

    // Automatable via input sockets
    const lifetimeVar = inputVars.lifetime ?? lifetime;
    const speedVar    = inputVars.speed    ?? p(node.params.speed, 0.3);

    // ── Linear mode params ─────────────────────────────────────────────────
    const angleDir    = `(${p(node.params.angle_dir, 90.0)} * 3.14159265 / 180.0)`;
    const spread      = p(node.params.angle_spread, 1.0);
    const gravX       = p(node.params.gravity_x, 0.0);
    const gravY       = p(node.params.gravity_y, 0.0);
    const despawn     = p(node.params.despawn_radius, 1.5);
    const gravVec     = `vec2(${gravX}, ${gravY})`;
    const angleDirVar = inputVars.angle_dir    ?? angleDir;
    const spreadVar   = inputVars.angle_spread ?? spread;

    // ── Noise mode params ──────────────────────────────────────────────────
    const noiseScale  = p(node.params.noise_scale,  2.0);
    const noiseSpeed  = p(node.params.noise_speed,  0.3);
    const spawnRadius = p(node.params.spawn_radius, 1.2);
    const noiseMode   = (node.params.noise_type as string) === 'curl' ? '1' : '0';

    // ── Gravity mode params ────────────────────────────────────────────────
    const fieldStr    = p(node.params.field_strength, 1.2);

    // ── Common loop header ─────────────────────────────────────────────────
    const header = [
      `    float ${id}_nd   = 1e9;\n`,
      `    vec2  ${id}_nuv  = vec2(0.0);\n`,
      `    float ${id}_nage = 0.0;\n`,
      `    float ${id}_dens = 0.0;\n`,
      `    for (int ${id}_pi = 0; ${id}_pi < ${maxP}; ${id}_pi++) {\n`,
      `        float ${id}_fi = float(${id}_pi);\n`,
    ].join('');

    // ── Common nearest-check + density tally ──────────────────────────────
    // Expects ${id}_pp (vec2 particle position) and ${id}_cage (float [0,1] age).
    const check = [
      `        float ${id}_d = length(g_uv - ${id}_pp);\n`,
      `        if (${id}_d < ${id}_nd) {\n`,
      `            ${id}_nd   = ${id}_d;\n`,
      `            ${id}_nuv  = g_uv - ${id}_pp;\n`,
      `            ${id}_nage = ${id}_cage;\n`,
      `        }\n`,
      `        if (${id}_d < ${densR}) ${id}_dens += 1.0;\n`,
      `    }\n`,
      `    ${id}_dens /= float(${maxP});\n`,
    ].join('');

    let inner: string;

    if (flowMode === 'noise') {
      // ── Noise (Flow Field) Mode ──────────────────────────────────────────
      // Seeds are distributed in g_uv space around posVar with spawn_radius.
      // Each particle is forward-Euler integrated through the internal noise field.
      inner = [
        `        float ${id}_sx = (phash(${id}_fi, ${seed} + 1.0) - 0.5) * 2.0 * ${spawnRadius};\n`,
        `        float ${id}_sy = (phash2(${id}_fi, ${seed} + 1.0) - 0.5) * 2.0 * ${spawnRadius};\n`,
        `        vec2  ${id}_sp = ${posVar} + vec2(${id}_sx, ${id}_sy);\n`,
        `        vec2  ${id}_pp = particleFlowPos(${id}_pi, ${timeVar}, ${id}_sp,\n`,
        `            ${speedVar}, ${lifetimeVar}, ${noiseScale}, ${noiseSpeed},\n`,
        `            ${seed}, ${noiseMode});\n`,
        // Age for colour/fade output:
        `        float ${id}_si2  = phash(${id}_fi, ${seed});\n`,
        `        float ${id}_b2   = fract(${id}_si2 * 17.23) * ${lifetimeVar};\n`,
        `        float ${id}_cage = clamp(mod(${timeVar} - ${id}_b2, ${lifetimeVar}) / ${lifetimeVar}, 0.0, 1.0);\n`,
      ].join('');

    } else if (flowMode === 'gravity') {
      // ── Gravity (Field-Socket) Mode ──────────────────────────────────────
      // Seeds distributed in g_uv space around posVar.
      // Backward trace: traced = g_uv - field(g_uv) * fieldStr * age
      // A particle is "at" pixel P when traced ≈ seed position.
      const fieldExpr = fieldVar ?? 'vec2(0.0)';
      inner = [
        `        float ${id}_sx = (phash(${id}_fi, ${seed} + 1.0) - 0.5) * 2.0 * ${spawnRadius};\n`,
        `        float ${id}_sy = (phash2(${id}_fi, ${seed} + 1.0) - 0.5) * 2.0 * ${spawnRadius};\n`,
        `        vec2  ${id}_sp = ${posVar} + vec2(${id}_sx, ${id}_sy);\n`,
        `        float ${id}_si2  = phash(${id}_fi, ${seed});\n`,
        `        float ${id}_b2   = fract(${id}_si2 * 17.23) * ${lifetimeVar};\n`,
        `        float ${id}_age  = mod(${timeVar} - ${id}_b2, ${lifetimeVar});\n`,
        `        float ${id}_cage = clamp(${id}_age / ${lifetimeVar}, 0.0, 1.0);\n`,
        `        vec2  ${id}_traced = g_uv\n`,
        `            - ${fieldExpr} * ${fieldStr} * ${id}_age\n`,
        `            - 0.5 * ${gravVec} * ${id}_age * ${id}_age;\n`,
        // For gravity mode, distance is to traced (not to g_uv directly)
        `        vec2  ${id}_pp = ${id}_traced;\n`,
      ].join('') +
      // Override check to use traced-vs-seed distance
      [
        `        float ${id}_d = length(${id}_traced - ${id}_sp);\n`,
        `        if (${id}_d < ${id}_nd) {\n`,
        `            ${id}_nd   = ${id}_d;\n`,
        `            ${id}_nuv  = ${id}_traced - ${id}_sp;\n`,
        `            ${id}_nage = ${id}_cage;\n`,
        `        }\n`,
        `        if (${id}_d < ${densR}) ${id}_dens += 1.0;\n`,
        `    }\n`,
        `    ${id}_dens /= float(${maxP});\n`,
      ].join('');

      return {
        code: header + inner,
        outputVars: {
          nearest_dist: `${id}_nd`,
          nearest_uv:   `${id}_nuv`,
          nearest_age:  `${id}_nage`,
          density:      `${id}_dens`,
        },
      };

    } else {
      // ── Linear (Spawn-Point) Mode ────────────────────────────────────────
      // Particles emit from posVar, fan out by angle/spread, arc under gravity/wind.
      inner = [
        `        vec2  ${id}_pp = particlePos(${id}_pi, ${timeVar},\n`,
        `            ${posVar}, ${speedVar}, ${lifetimeVar},\n`,
        `            ${angleDirVar}, ${spreadVar},\n`,
        `            ${gravVec}, ${seed}, ${despawn});\n`,
        `        float ${id}_si2  = phash(${id}_fi, ${seed});\n`,
        `        float ${id}_b2   = fract(${id}_si2 * 17.23) * ${lifetimeVar};\n`,
        `        float ${id}_cage = clamp(mod(${timeVar} - ${id}_b2, ${lifetimeVar}) / ${lifetimeVar}, 0.0, 1.0);\n`,
      ].join('');
    }

    return {
      code: header + inner + check,
      outputVars: {
        nearest_dist: `${id}_nd`,
        nearest_uv:   `${id}_nuv`,
        nearest_age:  `${id}_nage`,
        density:      `${id}_dens`,
      },
    };
  },
};

// ─── VectorFieldNode ──────────────────────────────────────────────────────────

export const VectorFieldNode: NodeDefinition = {
  type: 'vectorField',
  label: 'Vector Field',
  category: 'Spaces',
  description:
    'Noise-driven vec2 direction field. Each pixel gets a direction based on its position and time. ' +
    'Connect to Particle Emitter "field" (gravity mode) for field-driven particle motion. ' +
    'Also works as displacement for UV Warp, Displace, or any vec2 socket. ' +
    'Modes: FBM noise, Curl noise, Radial (outward), Vortex (rotational), Sin Wave.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    dir:   { type: 'vec2',  label: 'Direction'   },
    angle: { type: 'float', label: 'Angle (rad)' },
    str:   { type: 'float', label: 'Strength'    },
  },
  defaultParams: {
    scale:    2.0,
    speed:    0.3,
    strength: 1.0,
    mode:     'fbm',
    octaves:  3,
  },
  paramDefs: {
    mode: { label: 'Field Type', type: 'select', options: [
      { value: 'fbm',     label: 'FBM Noise'          },
      { value: 'curl',    label: 'Curl Noise'          },
      { value: 'radial',  label: 'Radial (outward)'    },
      { value: 'vortex',  label: 'Vortex (rotational)' },
      { value: 'sinwave', label: 'Sin Wave'             },
    ]},
    scale:    { label: 'Scale',    type: 'float', min: 0.1, max: 20.0, step: 0.1  },
    speed:    { label: 'Speed',    type: 'float', min: 0.0, max: 5.0,  step: 0.05 },
    strength: { label: 'Strength', type: 'float', min: 0.0, max: 5.0,  step: 0.05 },
    octaves:  { label: 'Octaves',  type: 'float', min: 1,   max: 6,    step: 1    },
  },
  glslFunctions: [VF_NOISE_GLSL],

  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv   ?? 'g_uv';
    const timeVar  = inputVars.time ?? '0.0';
    const scale    = p(node.params.scale,    2.0);
    const speed    = p(node.params.speed,    0.3);
    const strength = p(node.params.strength, 1.0);
    const mode     = (node.params.mode as string) ?? 'fbm';

    let angleCode: string;
    switch (mode) {
      case 'curl':
        angleCode = [
          `    float ${id}_nx  = _vfnoise(${uvVar} * ${scale} + vec2(0.0, 0.1) + ${timeVar} * ${speed});\n`,
          `    float ${id}_ny  = _vfnoise(${uvVar} * ${scale} + vec2(0.1, 0.0) + ${timeVar} * ${speed});\n`,
          `    float ${id}_ang = atan(${id}_ny - ${id}_nx, ${id}_nx - ${id}_ny);\n`,
        ].join('');
        break;
      case 'radial':
        angleCode = `    float ${id}_ang = atan(${uvVar}.y - 0.5, ${uvVar}.x - 0.5);\n`;
        break;
      case 'vortex':
        angleCode = `    float ${id}_ang = atan(${uvVar}.y - 0.5, ${uvVar}.x - 0.5) + 1.5708;\n`;
        break;
      case 'sinwave':
        angleCode = `    float ${id}_ang = sin(${uvVar}.x * ${scale} + ${timeVar} * ${speed}) * 3.14159;\n`;
        break;
      default: // fbm
        angleCode = `    float ${id}_ang = _vfnoise(${uvVar} * ${scale} + ${timeVar} * ${speed}) * 6.28318;\n`;
    }

    const code = angleCode + [
      `    vec2  ${id}_dir = vec2(cos(${id}_ang), sin(${id}_ang)) * ${strength};\n`,
      `    float ${id}_str = ${strength};\n`,
    ].join('');

    return {
      code,
      outputVars: {
        dir:   `${id}_dir`,
        angle: `${id}_ang`,
        str:   `${id}_str`,
      },
    };
  },
};

// ─── GravityFieldNode ─────────────────────────────────────────────────────────

export const GravityFieldNode: NodeDefinition = {
  type: 'gravityField',
  label: 'Gravity Field',
  category: 'Spaces',
  description:
    'Point-attractor force field. Outputs a vec2 pointing toward (attract), away from (repel), ' +
    'or tangentially around (orbit) an attractor position. ' +
    'Connect to Particle Emitter "field" (gravity mode) for gravitational particle trails. ' +
    'Or connect to UV Warp for gravitational lens distortion effects.',
  inputs: {
    uv:       { type: 'vec2',  label: 'UV'            },
    attractor:{ type: 'vec2',  label: 'Attractor Pos' },
    strength: { type: 'float', label: 'Strength'      },
  },
  outputs: {
    dir:     { type: 'vec2',  label: 'Direction' },
    dist:    { type: 'float', label: 'Distance'  },
    falloff: { type: 'float', label: 'Falloff'   },
  },
  defaultParams: {
    strength: 1.0,
    falloff:  'squared',
    mode:     'attract',
    min_dist: 0.01,
  },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'attract', label: 'Attract'         },
      { value: 'repel',   label: 'Repel'            },
      { value: 'orbit',   label: 'Orbit (tangent)'  },
    ]},
    falloff: { label: 'Falloff', type: 'select', options: [
      { value: 'none',    label: 'Constant'     },
      { value: 'linear',  label: 'Linear 1/d'   },
      { value: 'squared', label: 'Squared 1/d²' },
    ]},
    strength: { label: 'Strength', type: 'float', min: 0.0,   max: 5.0, step: 0.05 },
    min_dist: { label: 'Min Dist', type: 'float', min: 0.001, max: 0.5, step: 0.005 },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvVar   = inputVars.uv        ?? 'g_uv';
    const attrVar = inputVars.attractor ?? 'vec2(0.0)';
    const strVar  = inputVars.strength  ?? p(node.params.strength, 1.0);
    const minDist = p(node.params.min_dist, 0.01);
    const falloff = (node.params.falloff as string) ?? 'squared';
    const mode    = (node.params.mode   as string) ?? 'attract';

    let falloffExpr: string;
    switch (falloff) {
      case 'linear':  falloffExpr = `(${strVar} / max(${id}_dist, ${minDist}))`; break;
      case 'squared': falloffExpr = `(${strVar} / max(${id}_dist * ${id}_dist, ${minDist}))`; break;
      default:        falloffExpr = strVar;
    }

    let dirExpr: string;
    switch (mode) {
      case 'repel': dirExpr = `(-${id}_rawdir)`; break;
      case 'orbit': dirExpr = `(vec2(-${id}_rawdir.y, ${id}_rawdir.x))`; break;
      default:      dirExpr = `(${id}_rawdir)`;
    }

    const code = [
      `    vec2  ${id}_delta   = ${attrVar} - ${uvVar};\n`,
      `    float ${id}_dist    = max(length(${id}_delta), ${minDist});\n`,
      `    vec2  ${id}_rawdir  = ${id}_delta / ${id}_dist;\n`,
      `    float ${id}_falloff = ${falloffExpr};\n`,
      `    vec2  ${id}_dir     = ${dirExpr} * ${id}_falloff;\n`,
    ].join('');

    return {
      code,
      outputVars: {
        dir:     `${id}_dir`,
        dist:    `${id}_dist`,
        falloff: `${id}_falloff`,
      },
    };
  },
};

// ─── SpiralFieldNode ──────────────────────────────────────────────────────────

export const SpiralFieldNode: NodeDefinition = {
  type: 'spiralField',
  label: 'Spiral Field',
  category: 'Spaces',
  description:
    'Combines inward pull and tangential rotation into a spiral force field. ' +
    'Ratio=0 is pure inward pull. Ratio=1 is pure orbit. 0.5 = balanced spiral. ' +
    'Connect to Particle Emitter "field" (gravity mode) for spiraling particle trails. ' +
    'Or connect to UV Warp for spiral lens distortion.',
  inputs: {
    uv:       { type: 'vec2',  label: 'UV'       },
    center:   { type: 'vec2',  label: 'Center'   },
    strength: { type: 'float', label: 'Strength' },
  },
  outputs: {
    dir:  { type: 'vec2',  label: 'Spiral Dir' },
    dist: { type: 'float', label: 'Distance'   },
  },
  defaultParams: {
    strength:     1.0,
    spiral_ratio: 0.5,
    falloff:      'linear',
    spin_dir:     'ccw',
  },
  paramDefs: {
    strength:     { label: 'Strength',     type: 'float', min: 0, max: 5, step: 0.05 },
    spiral_ratio: { label: 'Spiral Ratio', type: 'float', min: 0, max: 1, step: 0.01 },
    falloff: { label: 'Falloff', type: 'select', options: [
      { value: 'none',    label: 'Constant'    },
      { value: 'linear',  label: 'Linear 1/d'  },
      { value: 'squared', label: 'Squared 1/d²'},
    ]},
    spin_dir: { label: 'Spin', type: 'select', options: [
      { value: 'ccw', label: 'Counter-clockwise' },
      { value: 'cw',  label: 'Clockwise'         },
    ]},
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvVar   = inputVars.uv       ?? 'g_uv';
    const ctrVar  = inputVars.center   ?? 'vec2(0.0)';
    const strVar  = inputVars.strength ?? p(node.params.strength, 1.0);
    const ratio   = p(node.params.spiral_ratio, 0.5);
    const falloff = (node.params.falloff  as string) ?? 'linear';
    const spinDir = (node.params.spin_dir as string) ?? 'ccw';
    const spinSign = spinDir === 'cw' ? '-' : '';

    let falloffExpr: string;
    switch (falloff) {
      case 'linear':  falloffExpr = `(${strVar} / max(${id}_dist, 0.001))`; break;
      case 'squared': falloffExpr = `(${strVar} / max(${id}_dist * ${id}_dist, 0.001))`; break;
      default:        falloffExpr = strVar;
    }

    const code = [
      `    vec2  ${id}_delta   = ${ctrVar} - ${uvVar};\n`,
      `    float ${id}_dist    = max(length(${id}_delta), 0.001);\n`,
      `    vec2  ${id}_inward  = ${id}_delta / ${id}_dist;\n`,
      `    vec2  ${id}_tangent = ${spinSign}vec2(-${id}_inward.y, ${id}_inward.x);\n`,
      `    float ${id}_fo      = ${falloffExpr};\n`,
      `    vec2  ${id}_dir     = mix(${id}_inward, ${id}_tangent, ${ratio}) * ${id}_fo;\n`,
    ].join('');

    return {
      code,
      outputVars: {
        dir:  `${id}_dir`,
        dist: `${id}_dist`,
      },
    };
  },
};
