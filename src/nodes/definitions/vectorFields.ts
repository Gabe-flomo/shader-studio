import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

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

// ─── VectorFieldNode ──────────────────────────────────────────────────────────

export const VectorFieldNode: NodeDefinition = {
  type: 'vectorField',
  label: 'Vector Field',
  category: '2D Space', subcategory: 'Warp',
  description:
    'Noise-driven vec2 direction field. Each pixel gets a direction based on its position and time. ' +
    'Use it as displacement for UV Warp, Displace, or any vec2 socket. ' +
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
    octaves:  { label: 'Octaves',  type: 'float', min: 1,   max: 6,    step: 1, compileTime: true, hint: 'Recompiles when changed.' },
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
  category: '2D Space', subcategory: 'Warp',
  description:
    'Point-attractor force field. Outputs a vec2 pointing toward (attract), away from (repel), ' +
    'or tangentially around (orbit) an attractor position. ' +
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
  category: '2D Space', subcategory: 'Warp',
  description:
    'Combines inward pull and tangential rotation into a spiral force field. ' +
    'Ratio=0 is pure inward pull. Ratio=1 is pure orbit. 0.5 = balanced spiral. ' +
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
