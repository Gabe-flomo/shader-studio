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

    vec2 pos = spawn
        + dir * speed_i * age
        + 0.5 * grav * age * age;

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
    'GPU particle emitter using hash-based virtual particles — no CPU, no texture feedback. ' +
    'Two modes: (1) SPAWN mode (speed > 0): particles emit from spawn position, fan out by angle/spread, arc under wind. ' +
    '(2) FIELD-FLOW mode (speed = 0, field connected): particles distributed across the screen follow field lines via backward trace. ' +
    'Wire nearest_uv → CircleSDF for shaped dots. Wire nearest_age → Palette for age-based color/fade. ' +
    'Count slider controls quality vs. performance (50 = real-time safe, 100 = max).',
  inputs: {
    position:     { type: 'vec2',  label: 'Spawn Position' },
    time:         { type: 'float', label: 'Time'           },
    field:        { type: 'vec2',  label: 'Field Dir'      },
    lifetime:     { type: 'float', label: 'Lifetime'       },
    speed:        { type: 'float', label: 'Speed'          },
    angle_dir:    { type: 'float', label: 'Angle'          },
    angle_spread: { type: 'float', label: 'Spread'         },
  },
  outputs: {
    nearest_dist: { type: 'float', label: 'Nearest Dist (SDF)' },
    nearest_uv:   { type: 'vec2',  label: 'Nearest UV'         },
    nearest_age:  { type: 'float', label: 'Age (0=new, 1=old)' },
    density:      { type: 'float', label: 'Density'            },
  },
  defaultParams: {
    max_particles:  50,
    lifetime:       2.0,
    speed:          0.3,
    angle_dir:      90,
    angle_spread:   1.0,
    gravity_x:      0.0,
    gravity_y:      0.0,
    field_strength: 1.0,
    despawn_radius: 1.5,
    seed:           0.0,
    density_radius: 0.05,
  },
  paramDefs: {
    max_particles:  { label: 'Count (50 fast, 100 max)', type: 'float', min: 1,    max: 100,  step: 1    },
    lifetime:       { label: 'Lifetime (s)',             type: 'float', min: 0.1,  max: 10.0, step: 0.1  },
    speed:          { label: 'Speed',                    type: 'float', min: 0.0,  max: 2.0,  step: 0.01 },
    angle_dir:      { label: 'Angle (°)',                type: 'float', min: 0,    max: 360,  step: 1    },
    angle_spread:   { label: 'Spread',                   type: 'float', min: 0.0,  max: 1.0,  step: 0.01 },
    gravity_x:      { label: 'Wind X',                   type: 'float', min: -2.0, max: 2.0,  step: 0.01 },
    gravity_y:      { label: 'Wind Y',                   type: 'float', min: -2.0, max: 2.0,  step: 0.01 },
    field_strength: { label: 'Field Strength',           type: 'float', min: 0.0,  max: 3.0,  step: 0.05 },
    despawn_radius: { label: 'Despawn Radius',           type: 'float', min: 0.1,  max: 5.0,  step: 0.05 },
    seed:           { label: 'Seed',                     type: 'float', min: 0,    max: 100,  step: 1    },
    density_radius: { label: 'Density Radius',           type: 'float', min: 0.01, max: 0.3,  step: 0.005},
  },
  glslFunctions: [PARTICLE_HASH_GLSL],

  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const posVar   = inputVars.position ?? 'vec2(0.5)';
    const timeVar  = inputVars.time     ?? '0.0';
    const fieldVar = inputVars.field;   // undefined = field not connected

    // Compile-time constant — loop bound must be a literal (not a uniform)
    const maxP = Math.max(1, Math.min(100, Math.round(Number(node.params.max_particles ?? 50))));

    const lifetime= p(node.params.lifetime,       2.0);
    const speed   = p(node.params.speed,          0.3);
    const angleDir= `(${p(node.params.angle_dir,  90.0)} * 3.14159265 / 180.0)`;
    const spread  = p(node.params.angle_spread,   1.0);
    const gravX   = p(node.params.gravity_x,      0.0);
    const gravY   = p(node.params.gravity_y,      0.0);
    const fieldStr= p(node.params.field_strength, 1.0);
    const despawn = p(node.params.despawn_radius, 1.5);
    const seed    = p(node.params.seed,           0.0);
    const densR   = p(node.params.density_radius, 0.05);

    // Automatable overrides — connected input socket takes precedence over param slider
    const lifetimeVar = inputVars.lifetime     ?? lifetime;
    const speedVar    = inputVars.speed        ?? speed;
    const angleDirVar = inputVars.angle_dir    ?? angleDir;
    const spreadVar   = inputVars.angle_spread ?? spread;

    const gravVec  = `vec2(${gravX}, ${gravY})`;

    // Mode detection: field connected + speed param = 0 → field-flow (backward trace)
    // Otherwise: spawn-point mode (particles fly from spawn position)
    const speedVal     = Number(node.params.speed ?? 0.3);
    const useFieldFlow = fieldVar !== undefined && speedVal < 0.001;

    let code: string;

    if (useFieldFlow) {
      // ── Field-Flow Mode ─────────────────────────────────────────────────────
      // Each virtual particle has a random seed position in [0,1]×[0,1].
      // At pixel g_uv, we trace backward along the field:
      //   traced = g_uv − field * fieldStr * age  (− gravity drift)
      // A particle is "visible" at g_uv when traced ≈ seed_pos.
      // This creates smooth flowing trails along any spatially-varying field.
      code = [
        `    float ${id}_nd   = 1e9;\n`,
        `    vec2  ${id}_nuv  = vec2(0.0);\n`,
        `    float ${id}_nage = 0.0;\n`,
        `    float ${id}_dens = 0.0;\n`,
        `    for (int ${id}_pi = 0; ${id}_pi < ${maxP}; ${id}_pi++) {\n`,
        `        float ${id}_fi    = float(${id}_pi);\n`,
        `        vec2  ${id}_seed  = vec2(phash(${id}_fi, ${seed} + 1.0), phash2(${id}_fi, ${seed} + 1.0));\n`,
        `        float ${id}_si    = phash(${id}_fi, ${seed});\n`,
        `        float ${id}_birth = fract(${id}_si * 17.23) * ${lifetimeVar};\n`,
        `        float ${id}_age   = mod(${timeVar} - ${id}_birth, ${lifetimeVar});\n`,
        `        vec2  ${id}_traced = g_uv\n`,
        `            - ${fieldVar} * ${fieldStr} * ${id}_age\n`,
        `            - 0.5 * ${gravVec} * ${id}_age * ${id}_age;\n`,
        `        float ${id}_d = length(${id}_traced - ${id}_seed);\n`,
        `        if (${id}_d < ${id}_nd) {\n`,
        `            ${id}_nd   = ${id}_d;\n`,
        `            ${id}_nuv  = ${id}_traced - ${id}_seed;\n`,
        `            ${id}_nage = clamp(${id}_age / ${lifetimeVar}, 0.0, 1.0);\n`,
        `        }\n`,
        `        if (${id}_d < ${densR}) ${id}_dens += 1.0;\n`,
        `    }\n`,
        `    ${id}_dens /= float(${maxP});\n`,
      ].join('');
    } else {
      // ── Spawn-Point Mode ────────────────────────────────────────────────────
      // Particles emit from a spawn position, spread by angle/spread, arc under wind (gravity_x/y).
      // Field connection is unused in this mode — set Wind X/Y for directional drift instead.
      code = [
        `    float ${id}_nd   = 1e9;\n`,
        `    vec2  ${id}_nuv  = vec2(0.0);\n`,
        `    float ${id}_nage = 0.0;\n`,
        `    float ${id}_dens = 0.0;\n`,
        `    for (int ${id}_pi = 0; ${id}_pi < ${maxP}; ${id}_pi++) {\n`,
        `        float ${id}_fi = float(${id}_pi);\n`,
        `        vec2 ${id}_pp = particlePos(${id}_pi, ${timeVar},\n`,
        `            ${posVar}, ${speedVar}, ${lifetimeVar},\n`,
        `            ${angleDirVar}, ${spreadVar},\n`,
        `            ${gravVec}, ${seed}, ${despawn});\n`,
        `        float ${id}_d = length(g_uv - ${id}_pp);\n`,
        `        if (${id}_d < ${id}_nd) {\n`,
        `            ${id}_nd  = ${id}_d;\n`,
        `            ${id}_nuv = g_uv - ${id}_pp;\n`,
        `            float ${id}_si2    = phash(${id}_fi, ${seed});\n`,
        `            float ${id}_birth2 = fract(${id}_si2 * 17.23) * ${lifetimeVar};\n`,
        `            ${id}_nage = clamp(mod(${timeVar} - ${id}_birth2, ${lifetimeVar}) / ${lifetimeVar}, 0.0, 1.0);\n`,
        `        }\n`,
        `        if (${id}_d < ${densR}) ${id}_dens += 1.0;\n`,
        `    }\n`,
        `    ${id}_dens /= float(${maxP});\n`,
      ].join('');
    }

    return {
      code,
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
    'Connect to Particle Emitter "field" (with speed=0) for flow-field particle motion. ' +
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
    'Connect to Particle Emitter "field" (with speed=0) for gravitational particle trails. ' +
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
    const attrVar = inputVars.attractor ?? 'vec2(0.5)';
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
    'Connect to Particle Emitter "field" (with speed=0) for spiraling particle trails. ' +
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
    const ctrVar  = inputVars.center   ?? 'vec2(0.5)';
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
