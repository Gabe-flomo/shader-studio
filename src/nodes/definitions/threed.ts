import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, vec3Str } from './helpers';
import { PALETTE_GLSL_FN, PALETTE_PRESET_OPTIONS } from './color';

// ─── Shared 3D GLSL helpers ───────────────────────────────────────────────────

// 3D value noise (hash + smooth interpolation)
const NOISE3D_GLSL = `
float hash3(vec3 p) {
    p = fract(p * vec3(127.1, 311.7, 74.7));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i+vec3(0,0,0)), hash3(i+vec3(1,0,0)), u.x),
                   mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), u.x), u.y),
               mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), u.x),
                   mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm3(vec3 p, int octaves, float lacunarity, float gain) {
    float v = 0.0; float a = 0.5; float f2 = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        v += a * noise3(p * f2);
        a *= gain; f2 *= lacunarity;
    }
    return v;
}`;

// SDF primitives
const SDF3D_GLSL = `
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox3(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}
float sdTorus(vec3 p, float R, float r) {
    return length(vec2(length(p.xz) - R, p.y)) - r;
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 ab = b - a; vec3 ap = p - a;
    float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    return length(ap - ab * t) - r;
}
float sdPlane(vec3 p, float height) { return p.y - height; }
// Smooth min for SDF blending
float sminSDF(float a, float b, float k) {
    float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
    return mix(b, a, h) - k*h*(1.0-h);
}
// Repetition
vec3 opRep(vec3 p, vec3 c) { return mod(p + 0.5*c, c) - 0.5*c; }`;

// Camera setup utilities
const CAMERA3D_GLSL = `
// Build a look-at camera matrix. ro=ray origin, ta=target, cr=up roll angle
mat3 setCamera(vec3 ro, vec3 ta, float cr) {
    vec3 cw = normalize(ta - ro);
    vec3 cp = vec3(sin(cr), cos(cr), 0.0);
    vec3 cu = normalize(cross(cw, cp));
    vec3 cv = normalize(cross(cu, cw));
    return mat3(cu, cv, cw);
}`;

// Volumetric cloud density
const CLOUD_GLSL = NOISE3D_GLSL + `
// Turbulence = sum of abs(noise) — gives billowy cloud texture
float turbulence(vec3 p, int oct) {
    float v = 0.0; float a = 0.5; float f = 1.0;
    for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        v += a * abs(noise3(p * f) * 2.0 - 1.0);
        a *= 0.5; f *= 2.0;
    }
    return v;
}
// Cloud density at point p (height-modulated with turbulence)
float cloudDensity(vec3 p, float coverage, float puffiness, float scale) {
    float base = -p.y * 0.5 + coverage;  // height falloff
    float turb = turbulence(p * scale, 4);
    float d = base - turb * puffiness;
    return max(d, 0.0);
}`;

// ─── Raymarch Node ────────────────────────────────────────────────────────────
// Full raymarch setup: camera, ray generation, SDF scene, lighting, fog

const RAYMARCH_GLSL = SDF3D_GLSL + CAMERA3D_GLSL + NOISE3D_GLSL;

// Palette presets (local copy, same as color.ts)
const RM_PALETTE_PRESETS = [
  { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.0,0.1,0.2] },
  { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.0,0.33,0.67] },
  { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.3,0.2,0.2] },
  { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,0.5], d:[0.8,0.9,0.3] },
  { a:[0.5,0.5,0.5], b:[0.4431,0.4235,0.4235], c:[1.0,0.7,0.4], d:[0.0,0.15,0.2] },
  { a:[0.5,0.5,0.5], b:[0.4431,0.4235,0.4235], c:[2.0,1.0,0.0], d:[0.5,0.2,0.25] },
  { a:[0.8,0.5,0.4], b:[0.2,0.4,0.2], c:[2.0,1.0,1.0], d:[0.0,0.25,0.25] },
  { a:[0.721,0.328,0.542], b:[0.659,0.181,0.896], c:[0.612,0.14,0.196], d:[0.538,0.978,0.7] },
  { a:[0.412,0.102,0.491], b:[0.397,0.13,0.485], c:[0.612,0.14,0.196], d:[0.538,0.978,0.7] },
  { a:[0.412,0.202,0.491], b:[0.397,0.13,0.485], c:[1.147,1.557,1.197], d:[1.956,5.039,2.541] },
];

function rmPalVec(v: number[]): string {
  return `vec3(${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)})`;
}

export const RaymarchNode: NodeDefinition = {
  type: 'raymarch3d',
  label: 'Raymarch 3D',
  category: 'Effects',
  description: [
    '3D raymarcher with configurable scene, camera, and lighting. ',
    'Scene: sphere, box, torus, or repeat+blend. ',
    'Lighting: diffuse + specular Phong + ambient + fog. ',
    'Wire UV + Time for animated camera orbit. ',
    'Outputs: color, depth, normal, occlusion, fog mask.',
  ].join(''),
  inputs: {
    uv:        { type: 'vec2',  label: 'UV'           },
    time:      { type: 'float', label: 'Time'         },
    cam_dist:  { type: 'float', label: 'Camera Dist'  },
    cam_height:{ type: 'float', label: 'Cam Height'   },
    cam_speed: { type: 'float', label: 'Orbit Speed'  },
    shape_r:   { type: 'float', label: 'Shape Radius' },
    blend_k:   { type: 'float', label: 'Blend K'      },
    light_pos: { type: 'vec2',  label: 'Light XZ'     },
    fog_dist:  { type: 'float', label: 'Fog Distance' },
    noise_scale:{ type: 'float',label: 'Noise Scale'  },
  },
  outputs: {
    color:  { type: 'vec3',  label: 'Color'        },
    depth:  { type: 'float', label: 'Depth'        },
    normal: { type: 'vec3',  label: 'Normal'       },
    occ:    { type: 'float', label: 'Occlusion'    },
    fog:    { type: 'float', label: 'Fog Mask'     },
  },
  glslFunction: RAYMARCH_GLSL + '\n' + PALETTE_GLSL_FN,
  defaultParams: {
    scene:       'spheres',
    max_steps:   80,
    max_dist:    30.0,
    surf_dist:   0.001,
    cam_dist:    4.0,
    cam_height:  1.5,
    cam_speed:   0.3,
    cam_fov:     1.5,
    shape_r:     0.8,
    blend_k:     0.3,
    repeat_x:    3.0,
    repeat_z:    3.0,
    light_x:     2.0,
    light_y:     5.0,
    light_z:     3.0,
    ambient:     0.05,
    specular:    32.0,
    fog_dist:    15.0,
    fog_color:   [0.7, 0.75, 0.85],
    palette_preset: '4',
    bg_preset:   '0',
    ao_steps:    5,
    noise_scale: 1.5,
    noise_strength: 0.3,
  },
  paramDefs: {
    scene: { label: 'Scene', type: 'select', options: [
      { value: 'spheres',     label: 'Sphere(s)'       },
      { value: 'boxes',       label: 'Box(es)'         },
      { value: 'torus',       label: 'Torus'           },
      { value: 'blend',       label: 'Sphere+Box Blend'},
      { value: 'repeat',      label: 'Repeat Grid'     },
      { value: 'noisy_sphere',label: 'Noisy Sphere'    },
    ]},
    max_steps:      { label: 'Max Steps',     type: 'float', min: 20,    max: 200,  step: 5      },
    max_dist:       { label: 'Max Distance',  type: 'float', min: 5,     max: 100,  step: 1      },
    surf_dist:      { label: 'Surface Eps',   type: 'float', min: 0.0001,max: 0.01, step: 0.0001 },
    cam_dist:       { label: 'Camera Dist',   type: 'float', min: 1,     max: 20,   step: 0.1    },
    cam_height:     { label: 'Camera Height', type: 'float', min: -5,    max: 10,   step: 0.1    },
    cam_speed:      { label: 'Orbit Speed',   type: 'float', min: 0,     max: 2,    step: 0.01   },
    cam_fov:        { label: 'FOV',           type: 'float', min: 0.5,   max: 3,    step: 0.05   },
    shape_r:        { label: 'Shape Radius',  type: 'float', min: 0.1,   max: 3,    step: 0.05   },
    blend_k:        { label: 'Blend K',       type: 'float', min: 0.01,  max: 2,    step: 0.01   },
    repeat_x:       { label: 'Repeat X',      type: 'float', min: 1,     max: 10,   step: 0.5    },
    repeat_z:       { label: 'Repeat Z',      type: 'float', min: 1,     max: 10,   step: 0.5    },
    light_x:        { label: 'Light X',       type: 'float', min: -10,   max: 10,   step: 0.1    },
    light_y:        { label: 'Light Y',       type: 'float', min: 0,     max: 20,   step: 0.1    },
    light_z:        { label: 'Light Z',       type: 'float', min: -10,   max: 10,   step: 0.1    },
    ambient:        { label: 'Ambient',       type: 'float', min: 0,     max: 0.5,  step: 0.01   },
    specular:       { label: 'Spec Power',    type: 'float', min: 2,     max: 128,  step: 2      },
    fog_dist:       { label: 'Fog Distance',  type: 'float', min: 1,     max: 50,   step: 0.5    },
    fog_color:      { label: 'Fog Color',     type: 'vec3',  min: 0,     max: 1,    step: 0.01   },
    palette_preset: { label: 'Object Palette',type: 'select', options: PALETTE_PRESET_OPTIONS },
    bg_preset:      { label: 'BG Palette',    type: 'select', options: PALETTE_PRESET_OPTIONS },
    ao_steps:       { label: 'AO Steps',      type: 'float', min: 0,     max: 10,   step: 1      },
    noise_scale:    { label: 'Noise Scale',   type: 'float', min: 0.1,   max: 5,    step: 0.1    },
    noise_strength: { label: 'Noise Warp',    type: 'float', min: 0,     max: 1,    step: 0.01   },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;

    // Inputs (wirable, else fall back to params)
    const uvVar      = inputVars.uv          ?? 'vec2(0.0)';
    const timeVar    = inputVars.time        ?? '0.0';
    const camDist    = inputVars.cam_dist    ?? f(typeof node.params.cam_dist    === 'number' ? node.params.cam_dist    : 4.0);
    const camHeight  = inputVars.cam_height  ?? f(typeof node.params.cam_height  === 'number' ? node.params.cam_height  : 1.5);
    const camSpeed   = inputVars.cam_speed   ?? f(typeof node.params.cam_speed   === 'number' ? node.params.cam_speed   : 0.3);
    const shapeR     = inputVars.shape_r     ?? f(typeof node.params.shape_r     === 'number' ? node.params.shape_r     : 0.8);
    const blendK     = inputVars.blend_k     ?? f(typeof node.params.blend_k     === 'number' ? node.params.blend_k     : 0.3);
    const fogDist    = inputVars.fog_dist    ?? f(typeof node.params.fog_dist    === 'number' ? node.params.fog_dist    : 15.0);
    const noiseScale = inputVars.noise_scale ?? f(typeof node.params.noise_scale === 'number' ? node.params.noise_scale : 1.5);

    // Params (non-wirable)
    const scene        = (node.params.scene as string) ?? 'spheres';
    const maxSteps     = Math.max(20, Math.round(typeof node.params.max_steps     === 'number' ? node.params.max_steps     : 80));
    const maxDist      = f(typeof node.params.max_dist      === 'number' ? node.params.max_dist      : 30.0);
    const surfDist     = f(typeof node.params.surf_dist     === 'number' ? node.params.surf_dist     : 0.001);
    const camFov       = f(typeof node.params.cam_fov       === 'number' ? node.params.cam_fov       : 1.5);
    const repX         = f(typeof node.params.repeat_x      === 'number' ? node.params.repeat_x      : 3.0);
    const repZ         = f(typeof node.params.repeat_z      === 'number' ? node.params.repeat_z      : 3.0);
    const lightX       = f(typeof node.params.light_x       === 'number' ? node.params.light_x       : 2.0);
    const lightY       = f(typeof node.params.light_y       === 'number' ? node.params.light_y       : 5.0);
    const lightZ       = f(typeof node.params.light_z       === 'number' ? node.params.light_z       : 3.0);
    const ambient      = f(typeof node.params.ambient       === 'number' ? node.params.ambient       : 0.05);
    const specPow      = f(typeof node.params.specular      === 'number' ? node.params.specular      : 32.0);
    const noiseStrength= f(typeof node.params.noise_strength === 'number' ? node.params.noise_strength : 0.3);
    const aoSteps      = Math.round(typeof node.params.ao_steps       === 'number' ? node.params.ao_steps       : 5);

    const fogColorArr  = Array.isArray(node.params.fog_color) ? node.params.fog_color as number[] : [0.7, 0.75, 0.85];

    // Palettes
    const presIdx    = parseInt((node.params.palette_preset as string) ?? '4', 10);
    const bgPresIdx  = parseInt((node.params.bg_preset       as string) ?? '0', 10);
    const pres   = RM_PALETTE_PRESETS[Math.min(presIdx,   RM_PALETTE_PRESETS.length - 1)];
    const bgPres = RM_PALETTE_PRESETS[Math.min(bgPresIdx, RM_PALETTE_PRESETS.length - 1)];
    const [pA, pB, pC, pD]     = [rmPalVec(pres.a),   rmPalVec(pres.b),   rmPalVec(pres.c),   rmPalVec(pres.d)];
    const [bgA, bgB, bgC, bgD] = [rmPalVec(bgPres.a), rmPalVec(bgPres.b), rmPalVec(bgPres.c), rmPalVec(bgPres.d)];

    // Build the SDF scene expression based on chosen scene type
    // p = query position
    let sdfExpr: string;
    switch (scene) {
      case 'boxes':
        sdfExpr = `sdBox3(${id}_p, vec3(${shapeR}))`;
        break;
      case 'torus':
        sdfExpr = `sdTorus(${id}_p, ${shapeR}, max(${shapeR} * 0.3, 0.1))`;
        break;
      case 'blend':
        sdfExpr = `sminSDF(sdSphere(${id}_p, ${shapeR}), sdBox3(${id}_p - vec3(0.0, 0.0, 0.3), vec3(${shapeR} * 0.8)), ${blendK})`;
        break;
      case 'repeat':
        sdfExpr = `sdSphere(opRep(${id}_p, vec3(${repX}, 100.0, ${repZ})), ${shapeR} * 0.4)`;
        break;
      case 'noisy_sphere':
        sdfExpr = `sdSphere(${id}_p, ${shapeR} + noise3(${id}_p * ${noiseScale}) * ${noiseStrength})`;
        break;
      default: // spheres
        sdfExpr = `sdSphere(${id}_p, ${shapeR})`;
    }

    // Normal estimation via tetrahedron method (4 samples, compact)
    // AO loop: march small steps along normal, compare to scene
    const aoCode = aoSteps > 0 ? [
      `    float ${id}_ao = 0.0;\n`,
      `    for (int ${id}_aoi = 1; ${id}_aoi <= ${aoSteps}; ${id}_aoi++) {\n`,
      `        float ${id}_aoh = float(${id}_aoi) * 0.08;\n`,
      `        vec3 ${id}_aop = ${id}_hp + ${id}_nm * ${id}_aoh;\n`,
      `        float ${id}_aod = ${sdfExpr.replace(`${id}_p`, `${id}_aop`)};\n`,
      `        ${id}_ao += clamp(${id}_aoh - ${id}_aod, 0.0, 1.0) / ${id}_aoh;\n`,
      `    }\n`,
      `    ${id}_ao = 1.0 - ${id}_ao / float(${aoSteps});\n`,
    ].join('') : `    float ${id}_ao = 1.0;\n`;

    // Light source - optionally driven by light_pos input (XZ plane)
    const lightPosExpr = inputVars.light_pos
      ? `vec3(${inputVars.light_pos}.x, ${lightY}, ${inputVars.light_pos}.y)`
      : `vec3(${lightX}, ${lightY}, ${lightZ})`;

    const code = [
      `    // ── Raymarch 3D (${scene}) ──\n`,

      // Camera setup: orbit around origin
      `    float ${id}_angle = ${timeVar} * ${camSpeed};\n`,
      `    vec3  ${id}_ro    = vec3(cos(${id}_angle) * ${camDist}, ${camHeight}, sin(${id}_angle) * ${camDist});\n`,
      `    vec3  ${id}_ta    = vec3(0.0, 0.0, 0.0);\n`,
      `    mat3  ${id}_cam   = setCamera(${id}_ro, ${id}_ta, 0.0);\n`,
      // Ray direction from UV ([-1,1] range → normalized)
      `    vec3  ${id}_rd    = normalize(${id}_cam * vec3(${uvVar}.x, ${uvVar}.y, ${camFov}));\n`,

      // Raymarching loop
      `    float ${id}_t  = 0.001;\n`,
      `    float ${id}_d  = 0.0;\n`,
      `    bool  ${id}_hit = false;\n`,
      `    for (int ${id}_si = 0; ${id}_si < ${maxSteps}; ${id}_si++) {\n`,
      `        vec3 ${id}_p = ${id}_ro + ${id}_rd * ${id}_t;\n`,
      `        ${id}_d = ${sdfExpr};\n`,
      // Add a ground plane (y = -1)
      `        ${id}_d = min(${id}_d, sdPlane(${id}_p, -1.0));\n`,
      `        if (${id}_d < ${surfDist}) { ${id}_hit = true; break; }\n`,
      `        if (${id}_t > ${maxDist}) break;\n`,
      `        ${id}_t += ${id}_d;\n`,
      `    }\n`,

      // Hit point and normal (tetrahedron offset method)
      `    vec3 ${id}_hp = ${id}_ro + ${id}_rd * ${id}_t;\n`,
      `    vec3 ${id}_nm = vec3(0.0);\n`,
      `    if (${id}_hit) {\n`,
      `        vec2 ${id}_e = vec2(${surfDist} * 2.0, -${surfDist} * 2.0);\n`,
      // Temporary inner scope for SDF normal estimation using xyy/yyx/yxy/xxx trick
      `        float ${id}_nm_h0, ${id}_nm_h1, ${id}_nm_h2, ${id}_nm_h3;\n`,
      `        { vec3 ${id}_p = ${id}_hp + vec3(${id}_e.x, ${id}_e.y, ${id}_e.y); ${id}_nm_h0 = ${sdfExpr}; }\n`,
      `        { vec3 ${id}_p = ${id}_hp + vec3(${id}_e.y, ${id}_e.y, ${id}_e.x); ${id}_nm_h1 = ${sdfExpr}; }\n`,
      `        { vec3 ${id}_p = ${id}_hp + vec3(${id}_e.y, ${id}_e.x, ${id}_e.y); ${id}_nm_h2 = ${sdfExpr}; }\n`,
      `        { vec3 ${id}_p = ${id}_hp + vec3(${id}_e.x, ${id}_e.x, ${id}_e.x); ${id}_nm_h3 = ${sdfExpr}; }\n`,
      `        ${id}_nm = normalize(vec3(${id}_e.x,${id}_e.y,${id}_e.y)*${id}_nm_h0 + vec3(${id}_e.y,${id}_e.y,${id}_e.x)*${id}_nm_h1 + vec3(${id}_e.y,${id}_e.x,${id}_e.y)*${id}_nm_h2 + vec3(${id}_e.x,${id}_e.x,${id}_e.x)*${id}_nm_h3);\n`,
      `    }\n`,

      // AO
      aoCode,

      // Lighting
      `    vec3  ${id}_lp    = ${lightPosExpr};\n`,
      `    vec3  ${id}_ldir  = normalize(${id}_lp - ${id}_hp);\n`,
      `    float ${id}_diff  = max(dot(${id}_nm, ${id}_ldir), 0.0);\n`,
      `    vec3  ${id}_hv    = normalize(${id}_ldir - ${id}_rd);\n`,
      `    float ${id}_spec  = pow(max(dot(${id}_nm, ${id}_hv), 0.0), ${specPow});\n`,

      // Object color from palette (based on depth/distance)
      `    float ${id}_colt  = ${id}_t / ${maxDist};\n`,
      `    vec3  ${id}_objcol = palette(${id}_colt, ${pA}, ${pB}, ${pC}, ${pD});\n`,

      // Shaded color when hit, bg palette otherwise
      `    vec3  ${id}_litcol = ${id}_objcol * (${ambient} + (1.0 - ${ambient}) * ${id}_diff * ${id}_ao) + vec3(${id}_spec * 0.3);\n`,
      `    vec3  ${id}_bgcol  = palette(${uvVar}.y * 0.5 + 0.5, ${bgA}, ${bgB}, ${bgC}, ${bgD});\n`,
      `    vec3  ${id}_hitcol = ${id}_hit ? ${id}_litcol : ${id}_bgcol;\n`,

      // Exponential fog
      `    float ${id}_fog = exp(-${id}_t / ${fogDist});\n`,
      `    vec3  ${id}_fogc = ${vec3Str(fogColorArr)};\n`,
      `    vec3  ${id}_color = mix(${id}_fogc, ${id}_hitcol, ${id}_fog);\n`,

      // Depth (normalize 0..1 by maxDist)
      `    float ${id}_depth = clamp(${id}_t / ${maxDist}, 0.0, 1.0);\n`,
    ];

    return {
      code: code.join(''),
      outputVars: {
        color:  `${id}_color`,
        depth:  `${id}_depth`,
        normal: `${id}_nm`,
        occ:    `${id}_ao`,
        fog:    `${id}_fog`,
      },
    };
  },
};

// ─── Volumetric Clouds Node ───────────────────────────────────────────────────
// XorDev-style sunset volumetric raymarching through a cloud slab

const VOLUME_CLOUDS_GLSL = CLOUD_GLSL + CAMERA3D_GLSL;

export const VolumeCloudsNode: NodeDefinition = {
  type: 'volumeClouds',
  label: 'Volume Clouds',
  category: 'Effects',
  description: [
    'Volumetric cloud slab via raymarching + turbulence density field. ',
    'Inspired by XorDev\'s sunset shader. ',
    'Outputs sky color with integrated cloud color, cloud density (mask), and sun disk.',
  ].join(''),
  inputs: {
    uv:       { type: 'vec2',  label: 'UV'            },
    time:     { type: 'float', label: 'Time'          },
    cam_speed:{ type: 'float', label: 'Cam Speed'     },
    coverage: { type: 'float', label: 'Coverage'      },
    density:  { type: 'float', label: 'Density Scale' },
    sun_angle:{ type: 'float', label: 'Sun Angle'     },
  },
  outputs: {
    color:      { type: 'vec3',  label: 'Sky+Clouds'    },
    cloud_mask: { type: 'float', label: 'Cloud Density' },
    sun:        { type: 'float', label: 'Sun Disk'      },
    sky:        { type: 'vec3',  label: 'Sky Only'      },
  },
  glslFunction: VOLUME_CLOUDS_GLSL,
  defaultParams: {
    steps:          40,
    cloud_min_y:    1.5,
    cloud_max_y:    5.0,
    coverage:       0.3,
    puffiness:      0.6,
    density_scale:  0.8,
    cloud_scale:    0.4,
    scatter:        0.3,
    cam_speed:      0.1,
    sun_angle:      0.5,
    sun_size:       0.03,
    sky_top:        [0.1, 0.2, 0.5],
    sky_horizon:    [0.8, 0.5, 0.3],
    sky_ground:     [0.3, 0.15, 0.05],
    cloud_col:      [1.0, 0.95, 0.85],
    sun_col:        [1.0, 0.85, 0.4],
  },
  paramDefs: {
    steps:        { label: 'March Steps',  type: 'float', min: 8,    max: 80,  step: 2     },
    cloud_min_y:  { label: 'Cloud Min Y',  type: 'float', min: 0,    max: 10,  step: 0.1   },
    cloud_max_y:  { label: 'Cloud Max Y',  type: 'float', min: 0,    max: 20,  step: 0.1   },
    coverage:     { label: 'Coverage',     type: 'float', min: -1,   max: 1,   step: 0.01  },
    puffiness:    { label: 'Puffiness',    type: 'float', min: 0,    max: 2,   step: 0.05  },
    density_scale:{ label: 'Density',      type: 'float', min: 0.1,  max: 5,   step: 0.05  },
    cloud_scale:  { label: 'Cloud Scale',  type: 'float', min: 0.05, max: 2,   step: 0.05  },
    scatter:      { label: 'Scatter',      type: 'float', min: 0,    max: 1,   step: 0.01  },
    cam_speed:    { label: 'Wind Speed',   type: 'float', min: 0,    max: 1,   step: 0.01  },
    sun_angle:    { label: 'Sun Angle',    type: 'float', min: -3.14,max: 3.14,step: 0.01  },
    sun_size:     { label: 'Sun Size',     type: 'float', min: 0.005,max: 0.2, step: 0.005 },
    sky_top:      { label: 'Sky Top',      type: 'vec3',  min: 0,    max: 1,   step: 0.01  },
    sky_horizon:  { label: 'Sky Horizon',  type: 'vec3',  min: 0,    max: 1,   step: 0.01  },
    sky_ground:   { label: 'Sky Ground',   type: 'vec3',  min: 0,    max: 1,   step: 0.01  },
    cloud_col:    { label: 'Cloud Color',  type: 'vec3',  min: 0,    max: 1,   step: 0.01  },
    sun_col:      { label: 'Sun Color',    type: 'vec3',  min: 0,    max: 1,   step: 0.01  },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;

    const uvVar      = inputVars.uv        ?? 'vec2(0.0)';
    const timeVar    = inputVars.time      ?? '0.0';
    const camSpeed   = inputVars.cam_speed ?? f(typeof node.params.cam_speed   === 'number' ? node.params.cam_speed   : 0.1);
    const coverage   = inputVars.coverage  ?? f(typeof node.params.coverage    === 'number' ? node.params.coverage    : 0.3);
    const densityIn  = inputVars.density   ?? f(typeof node.params.density_scale === 'number' ? node.params.density_scale : 0.8);
    const sunAngle   = inputVars.sun_angle ?? f(typeof node.params.sun_angle   === 'number' ? node.params.sun_angle   : 0.5);

    const steps      = Math.max(8, Math.round(typeof node.params.steps      === 'number' ? node.params.steps      : 40));
    const cloudMinY  = f(typeof node.params.cloud_min_y  === 'number' ? node.params.cloud_min_y  : 1.5);
    const cloudMaxY  = f(typeof node.params.cloud_max_y  === 'number' ? node.params.cloud_max_y  : 5.0);
    const puffiness  = f(typeof node.params.puffiness    === 'number' ? node.params.puffiness    : 0.6);
    const cloudScale = f(typeof node.params.cloud_scale  === 'number' ? node.params.cloud_scale  : 0.4);
    const scatter    = f(typeof node.params.scatter      === 'number' ? node.params.scatter      : 0.3);
    const sunSize    = f(typeof node.params.sun_size     === 'number' ? node.params.sun_size     : 0.03);

    const skyTop    = Array.isArray(node.params.sky_top)     ? node.params.sky_top     as number[] : [0.1, 0.2, 0.5];
    const skyHoriz  = Array.isArray(node.params.sky_horizon) ? node.params.sky_horizon as number[] : [0.8, 0.5, 0.3];
    const skyGround = Array.isArray(node.params.sky_ground)  ? node.params.sky_ground  as number[] : [0.3, 0.15, 0.05];
    const cloudCol  = Array.isArray(node.params.cloud_col)   ? node.params.cloud_col   as number[] : [1.0, 0.95, 0.85];
    const sunCol    = Array.isArray(node.params.sun_col)     ? node.params.sun_col     as number[] : [1.0, 0.85, 0.4];

    const code = [
      `    // ── Volume Clouds ──\n`,

      // Camera ray: pinhole from (0,0,0) looking forward, UV as screen angle
      `    vec3 ${id}_rd = normalize(vec3(${uvVar}.x, ${uvVar}.y, 1.5));\n`,

      // Sun direction (rotates over time via sun_angle)
      `    float ${id}_sa = ${sunAngle} + ${timeVar} * 0.0;\n`,  // static angle by default
      `    vec3  ${id}_sunDir = normalize(vec3(sin(${id}_sa), 0.25, cos(${id}_sa)));\n`,

      // Sky gradient (based on ray y)
      `    float ${id}_skyT = clamp(${id}_rd.y * 0.5 + 0.5, 0.0, 1.0);\n`,
      `    vec3  ${id}_sky  = mix(${vec3Str(skyGround)}, ${vec3Str(skyHoriz)}, smoothstep(0.0, 0.4, ${id}_skyT));\n`,
      `    ${id}_sky = mix(${id}_sky, ${vec3Str(skyTop)}, smoothstep(0.3, 1.0, ${id}_skyT));\n`,

      // Sun disk
      `    float ${id}_sunDot  = dot(${id}_rd, ${id}_sunDir);\n`,
      `    float ${id}_sun     = smoothstep(${sunSize} + 0.005, ${sunSize}, acos(clamp(${id}_sunDot, -1.0, 1.0)));\n`,
      `    ${id}_sky += ${vec3Str(sunCol)} * ${id}_sun * 3.0;\n`,

      // Volumetric cloud marching
      // Only march rays that point upward enough to intersect cloud slab
      `    float ${id}_cloudAccum = 0.0;\n`,
      `    vec3  ${id}_cloudCol   = vec3(0.0);\n`,
      `    if (${id}_rd.y > 0.01) {\n`,
      `        float ${id}_tMin = ${cloudMinY} / ${id}_rd.y;\n`,
      `        float ${id}_tMax = ${cloudMaxY} / ${id}_rd.y;\n`,
      `        float ${id}_dt   = (${id}_tMax - ${id}_tMin) / float(${steps});\n`,
      `        vec3  ${id}_windOff = vec3(${timeVar} * ${camSpeed}, 0.0, 0.0);\n`,
      `        for (int ${id}_ci = 0; ${id}_ci < ${steps}; ${id}_ci++) {\n`,
      `            float ${id}_mt = ${id}_tMin + (float(${id}_ci) + 0.5) * ${id}_dt;\n`,
      `            vec3  ${id}_cp = ${id}_rd * ${id}_mt + ${id}_windOff;\n`,
      `            float ${id}_dens = cloudDensity(${id}_cp, ${coverage}, ${puffiness}, ${cloudScale}) * ${densityIn};\n`,
      `            if (${id}_dens > 0.001) {\n`,
      // In-scatter: sun direction scatter
      `                float ${id}_lightDens = cloudDensity(${id}_cp + ${id}_sunDir * 0.5, ${coverage}, ${puffiness}, ${cloudScale});\n`,
      `                float ${id}_shadow = exp(-${id}_lightDens * 2.0);\n`,
      `                vec3  ${id}_lit = ${vec3Str(cloudCol)} * (${id}_shadow + ${scatter}) + ${vec3Str(sunCol)} * pow(max(${id}_sunDot, 0.0), 4.0) * ${id}_shadow;\n`,
      `                float ${id}_alpha = min(${id}_dens * ${id}_dt * 8.0, 1.0 - ${id}_cloudAccum);\n`,
      `                ${id}_cloudCol   += ${id}_lit * ${id}_alpha;\n`,
      `                ${id}_cloudAccum += ${id}_alpha;\n`,
      `                if (${id}_cloudAccum > 0.99) break;\n`,
      `            }\n`,
      `        }\n`,
      `    }\n`,

      // Composite sky + clouds
      `    vec3 ${id}_color      = mix(${id}_sky, ${id}_cloudCol / max(${id}_cloudAccum, 0.001), ${id}_cloudAccum);\n`,
      `    float ${id}_cloud_mask = ${id}_cloudAccum;\n`,
    ];

    return {
      code: code.join(''),
      outputVars: {
        color:      `${id}_color`,
        cloud_mask: `${id}_cloud_mask`,
        sun:        `${id}_sun`,
        sky:        `${id}_sky`,
      },
    };
  },
};

// ─── Chromatic Aberration Node ────────────────────────────────────────────────
// Post-process: sample R, G, B at slightly offset UVs

export const ChromaticAberrationNode: NodeDefinition = {
  type: 'chromaticAberration',
  label: 'Chromatic Aberration',
  category: 'Effects',
  description: [
    'Chromatic aberration post-process. ',
    'Splits R/G/B channels by offsetting UVs radially from center. ',
    'Wire an existing color node into "color" and UV into "uv". ',
    'Strong radial distortion at edges, subtle at center.',
  ].join(''),
  inputs: {
    uv:       { type: 'vec2',  label: 'UV'       },
    time:     { type: 'float', label: 'Time'      },
    strength: { type: 'float', label: 'Strength'  },
  },
  outputs: {
    uv_r:   { type: 'vec2', label: 'UV (Red)'   },
    uv_g:   { type: 'vec2', label: 'UV (Green)' },
    uv_b:   { type: 'vec2', label: 'UV (Blue)'  },
    offset: { type: 'vec2', label: 'Offset'      },
  },
  defaultParams: {
    strength: 0.03,
    mode:     'radial',
    animate:  false,
    anim_speed: 0.5,
  },
  paramDefs: {
    strength:   { label: 'Strength',   type: 'float', min: 0.0,  max: 0.2,  step: 0.001 },
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'radial',     label: 'Radial (lens)'   },
      { value: 'horizontal', label: 'Horizontal'      },
      { value: 'diagonal',   label: 'Diagonal'        },
      { value: 'barrel',     label: 'Barrel Distort'  },
    ]},
    animate:    { label: 'Animate',    type: 'select', options: [
      { value: 'false', label: 'Off' },
      { value: 'true',  label: 'On'  },
    ]},
    anim_speed: { label: 'Anim Speed', type: 'float', min: 0.0,  max: 3.0,  step: 0.01  },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar      = inputVars.uv       ?? 'vec2(0.0)';
    const timeVar    = inputVars.time     ?? '0.0';
    const strengthIn = inputVars.strength ?? f(typeof node.params.strength   === 'number' ? node.params.strength   : 0.03);
    const animSpeed  = f(typeof node.params.anim_speed === 'number' ? node.params.anim_speed : 0.5);
    const mode       = (node.params.mode    as string) ?? 'radial';
    const animate    = (node.params.animate as string) ?? 'false';

    // Animated strength modulation
    const strengthExpr = animate === 'true'
      ? `(${strengthIn} * (0.8 + 0.2 * sin(${timeVar} * ${animSpeed})))`
      : strengthIn;

    let offsetExpr: string;
    switch (mode) {
      case 'horizontal':
        offsetExpr = `vec2(${strengthExpr}, 0.0)`;
        break;
      case 'diagonal':
        offsetExpr = `vec2(${strengthExpr}, ${strengthExpr}) * 0.7071`;
        break;
      case 'barrel': {
        // Barrel distortion offset — proportional to (r² * uv)
        offsetExpr = `(${uvVar} * dot(${uvVar}, ${uvVar}) * ${strengthExpr})`;
        break;
      }
      default: // radial — offset along UV direction from center
        offsetExpr = `normalize(${uvVar} + vec2(0.00001)) * ${strengthExpr} * length(${uvVar})`;
    }

    const code = [
      `    vec2 ${id}_offset = ${offsetExpr};\n`,
      `    vec2 ${id}_uv_r   = ${uvVar} + ${id}_offset;\n`,
      `    vec2 ${id}_uv_g   = ${uvVar};\n`,
      `    vec2 ${id}_uv_b   = ${uvVar} - ${id}_offset;\n`,
    ].join('');

    return {
      code,
      outputVars: {
        uv_r:   `${id}_uv_r`,
        uv_g:   `${id}_uv_g`,
        uv_b:   `${id}_uv_b`,
        offset: `${id}_offset`,
      },
    };
  },
};

// ─── Combine RGB Channels Node ────────────────────────────────────────────────
// Takes three float/vec3 inputs and combines them into one vec3 with a given channel weight

export const CombineRGBNode: NodeDefinition = {
  type: 'combineRGB',
  label: 'Combine RGB',
  category: 'Effects',
  description: [
    'Combines three inputs (float or vec3) into a single vec3 color. ',
    'Channel mode: takes .r from R input, .g from G input, .b from B input. ',
    'Works with floats (e.g. glow values) or full vec3 colors. ',
    'Use with Chromatic Aberration to reassemble per-channel renders.',
  ].join(''),
  inputs: {
    r: { type: 'float', label: 'R source' },
    g: { type: 'float', label: 'G source' },
    b: { type: 'float', label: 'B source' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    full_r: { type: 'vec3', label: 'R full' },
    full_g: { type: 'vec3', label: 'G full' },
    full_b: { type: 'vec3', label: 'B full' },
  },
  defaultParams: { mode: 'channel' },
  paramDefs: {
    mode: { label: 'Combine Mode', type: 'select', options: [
      { value: 'channel', label: 'Extract R/G/B channels' },
      { value: 'add',     label: 'Add all three'          },
      { value: 'avg',     label: 'Average all three'      },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const rRaw = inputVars.r ?? '0.0';
    const gRaw = inputVars.g ?? '0.0';
    const bRaw = inputVars.b ?? '0.0';
    const mode = (node.params.mode as string) ?? 'channel';

    // Promote scalar or vec3 input to a reliable vec3 temp
    // Works whether the connected output is float or vec3
    const code = [
      `    vec3 ${id}_full_r = vec3(${rRaw});\n`,
      `    vec3 ${id}_full_g = vec3(${gRaw});\n`,
      `    vec3 ${id}_full_b = vec3(${bRaw});\n`,
    ];

    let colorExpr: string;
    if (mode === 'add') {
      colorExpr = `${id}_full_r + ${id}_full_g + ${id}_full_b`;
    } else if (mode === 'avg') {
      colorExpr = `(${id}_full_r + ${id}_full_g + ${id}_full_b) / 3.0`;
    } else {
      // channel: take .r from R input, .g from G input, .b from B input
      colorExpr = `vec3(${id}_full_r.r, ${id}_full_g.g, ${id}_full_b.b)`;
    }
    code.push(`    vec3 ${id}_color  = ${colorExpr};\n`);

    return {
      code: code.join(''),
      outputVars: {
        color:  `${id}_color`,
        full_r: `${id}_full_r`,
        full_g: `${id}_full_g`,
        full_b: `${id}_full_b`,
      },
    };
  },
};

// ─── 3D Electron Orbital (Volumetric) ────────────────────────────────────────
//
// Raymarches through the 3D probability density |ψ_nlm(r,θ,φ)|² of a
// hydrogen-like atom using the exact analytic wavefunction:
//
//   ψ_nlm(r,θ,φ) = R_nl(r) · Y_l^m(θ,φ)
//
//   R_nl(r): radial part via associated Laguerre polynomials
//   Y_l^m(θ,φ): real spherical harmonics (cos/sin basis)
//
// Integration: front-to-back alpha compositing along each ray.
// Camera orbits the origin automatically when time is wired in.

const ORBITAL3D_GLSL = `
// ── Laguerre polynomials (p=0..5, exact via recurrence) ──────────────────────
float lag3d(int p, float a, float x) {
    if (p <= 0) return 1.0;
    if (p == 1) return 1.0 + a - x;
    float Lprev2 = 1.0;
    float Lprev1 = 1.0 + a - x;
    float Lcur = 0.0;
    for (int k = 2; k <= 5; k++) {
        if (k > p) break;
        float kf = float(k);
        Lcur = ((2.0*kf - 1.0 + a - x) * Lprev1 - (kf - 1.0 + a) * Lprev2) / kf;
        Lprev2 = Lprev1;
        Lprev1 = Lcur;
    }
    return Lcur;
}

// ── Real spherical harmonics Y_l^m(θ,φ) up to l=4 ────────────────────────────
// Using: sph_theta = polar (0..π), sph_phi = azimuthal (0..2π)
float realSH(int l, int m, float cosT, float sinT, float phi) {
    // l=0
    if (l == 0) return 0.2821; // 1/sqrt(4π)
    // l=1
    if (l == 1) {
        if (m ==  0) return 0.4886 * cosT;
        if (m ==  1) return 0.4886 * sinT * cos(phi);
        if (m == -1) return 0.4886 * sinT * sin(phi);
    }
    // l=2
    if (l == 2) {
        if (m ==  0) return 0.3153 * (3.0*cosT*cosT - 1.0);
        if (m ==  1) return 1.0925 * sinT * cosT * cos(phi);
        if (m == -1) return 1.0925 * sinT * cosT * sin(phi);
        if (m ==  2) return 0.5462 * sinT*sinT * cos(2.0*phi);
        if (m == -2) return 0.5462 * sinT*sinT * sin(2.0*phi);
    }
    // l=3
    if (l == 3) {
        if (m ==  0) return 0.3731 * cosT*(5.0*cosT*cosT - 3.0);
        if (m ==  1) return 0.4572 * sinT*(5.0*cosT*cosT - 1.0)*cos(phi);
        if (m == -1) return 0.4572 * sinT*(5.0*cosT*cosT - 1.0)*sin(phi);
        if (m ==  2) return 1.4457 * sinT*sinT*cosT*cos(2.0*phi);
        if (m == -2) return 1.4457 * sinT*sinT*cosT*sin(2.0*phi);
        if (m ==  3) return 0.5900 * sinT*sinT*sinT*cos(3.0*phi);
        if (m == -3) return 0.5900 * sinT*sinT*sinT*sin(3.0*phi);
    }
    // l=4
    float c2 = cosT*cosT; float s2 = sinT*sinT;
    if (m ==  0) return 0.1057*(35.0*c2*c2 - 30.0*c2 + 3.0);
    if (m ==  1) return 0.4730*sinT*cosT*(7.0*c2-3.0)*cos(phi);
    if (m == -1) return 0.4730*sinT*cosT*(7.0*c2-3.0)*sin(phi);
    if (m ==  2) return 0.3345*s2*(7.0*c2-1.0)*cos(2.0*phi);
    if (m == -2) return 0.3345*s2*(7.0*c2-1.0)*sin(2.0*phi);
    if (m ==  3) return 1.2517*s2*sinT*cosT*cos(3.0*phi);
    if (m == -3) return 1.2517*s2*sinT*cosT*sin(3.0*phi);
    if (m ==  4) return 0.6267*s2*s2*cos(4.0*phi);
    if (m == -4) return 0.6267*s2*s2*sin(4.0*phi);
    return 0.0;
}

// ── Full hydrogen wavefunction |ψ_nlm|² at 3D point p ────────────────────────
float orbital3d(vec3 p, float n, float l, float m, float a0) {
    float r     = length(p);
    float cosT  = (r < 0.00001) ? 1.0 : p.z / r;
    float sinT  = sqrt(max(1.0 - cosT*cosT, 0.0));
    float phi   = atan(p.y, p.x);
    float rho   = 2.0 * r / max(n * a0, 0.0001);
    int   lInt  = int(clamp(l, 0.0, 4.0));
    int   mInt  = int(clamp(m, -4.0, 4.0));
    int   lag_p = max(int(n) - lInt - 1, 0);
    lag_p = min(lag_p, 5);
    float R  = pow(max(rho, 0.00001), l) * exp(-rho * 0.5)
               * lag3d(lag_p, 2.0*l + 1.0, rho);
    float Y  = realSH(lInt, mInt, cosT, sinT, phi);
    float psi = R * Y;
    return psi * psi; // probability density |ψ|²
}

// ── Simple camera look-at ──────────────────────────────────────────────────────
mat3 orbital3dCam(vec3 ro, vec3 ta) {
    vec3 cw = normalize(ta - ro);
    vec3 cu = normalize(cross(cw, vec3(0.0, 1.0, 0.0)));
    vec3 cv = cross(cu, cw);
    return mat3(cu, cv, cw);
}`;

export const OrbitalVolume3DNode: NodeDefinition = {
  type: 'orbitalVolume3d',
  label: 'Orbital 3D',
  category: '3D',
  description: 'Volumetric 3D hydrogen orbital — raymarches through |ψ_nlm(r,θ,φ)|² using real spherical harmonics. n=shell (1–5), l=subshell (0–4), m=magnetic (−l..l). Wire orbit_angle for manual rotation control.',
  inputs: {
    uv:          { type: 'vec2',  label: 'UV'          },
    time:        { type: 'float', label: 'Time'         },
    orbit_angle: { type: 'float', label: 'Orbit Angle'  },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color'        },
    alpha: { type: 'float', label: 'Alpha'         },
    depth: { type: 'float', label: 'Density Depth' },
  },
  glslFunction: ORBITAL3D_GLSL,
  defaultParams: {
    n:             2.0,
    l:             1.0,
    m:             0.0,
    a0:            0.5,
    scale:         0.3,
    steps:         80,
    step_size:     0.04,
    density_scale: 6.0,
    gamma:         0.4,
    edge_softness: 0.6,
    turbulence:    0.0,
    turb_speed:    0.3,
    cam_dist:      2.5,
    cam_speed:     0.2,
    cam_angle:     0.0,
    cam_pitch:     0.35,
    color_a:       [0.3, 0.6, 1.0],
    color_b:       [1.0, 0.4, 0.2],
  },
  paramDefs: {
    n:             { label: 'n (shell)',     type: 'float', min: 1,     max: 5,    step: 1     },
    l:             { label: 'l (subshell)',  type: 'float', min: 0,     max: 4,    step: 1     },
    m:             { label: 'm (magnetic)',  type: 'float', min: -4,    max: 4,    step: 1     },
    a0:            { label: 'Bohr radius',   type: 'float', min: 0.01,  max: 2.0,  step: 0.01  },
    scale:         { label: 'Scale',         type: 'float', min: 0.001, max: 1.0,  step: 0.001 },
    steps:         { label: 'March Steps',   type: 'float', min: 16,    max: 128,  step: 4     },
    step_size:     { label: 'Step Size',     type: 'float', min: 0.005, max: 0.15, step: 0.005 },
    density_scale: { label: 'Density Scale', type: 'float', min: 0.5,   max: 40.0, step: 0.25  },
    gamma:         { label: 'Gamma',         type: 'float', min: 0.05,  max: 2.0,  step: 0.05  },
    edge_softness: { label: 'Edge Softness', type: 'float', min: 0.0,   max: 2.0,  step: 0.05  },
    turbulence:    { label: 'Turbulence',    type: 'float', min: 0.0,   max: 0.5,  step: 0.01  },
    turb_speed:    { label: 'Turb Speed',    type: 'float', min: 0.0,   max: 3.0,  step: 0.05  },
    cam_dist:      { label: 'Cam Distance',  type: 'float', min: 0.5,   max: 10.0, step: 0.05  },
    cam_speed:     { label: 'Orbit Speed',   type: 'float', min: 0.0,   max: 1.0,  step: 0.01  },
    cam_angle:     { label: 'Orbit Angle',   type: 'float', min: 0.0,   max: 6.283,step: 0.01  },
    cam_pitch:     { label: 'Cam Pitch',     type: 'float', min: -1.57, max: 1.57, step: 0.01  },
    color_a:       { label: 'Color A',       type: 'vec3',  min: 0.0,   max: 1.0,  step: 0.01  },
    color_b:       { label: 'Color B',       type: 'vec3',  min: 0.0,   max: 1.0,  step: 0.01  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const uv   = inputVars.uv          ?? 'vec2(0.0)';
    const time = inputVars.time        ?? '0.0';
    // orbit_angle input overrides cam_angle param when wired
    const orbitAngleIn = inputVars.orbit_angle;

    const n            = f(typeof node.params.n             === 'number' ? node.params.n             : 2.0);
    const l            = f(typeof node.params.l             === 'number' ? node.params.l             : 1.0);
    const m            = f(typeof node.params.m             === 'number' ? node.params.m             : 0.0);
    const a0           = f(typeof node.params.a0            === 'number' ? node.params.a0            : 0.5);
    const scale        = f(Math.max(typeof node.params.scale === 'number' ? node.params.scale : 0.3, 0.001));
    const steps        = Math.round(typeof node.params.steps === 'number' ? node.params.steps : 80);
    const stepSize     = f(typeof node.params.step_size     === 'number' ? node.params.step_size     : 0.04);
    const densScale    = f(typeof node.params.density_scale === 'number' ? node.params.density_scale : 6.0);
    const gamma        = f(Math.max(typeof node.params.gamma === 'number' ? node.params.gamma : 0.4, 0.05));
    const edgeSoft     = f(typeof node.params.edge_softness === 'number' ? node.params.edge_softness : 0.6);
    const turbulence   = f(typeof node.params.turbulence    === 'number' ? node.params.turbulence    : 0.0);
    const turbSpeed    = f(typeof node.params.turb_speed    === 'number' ? node.params.turb_speed    : 0.3);
    const camDist      = f(typeof node.params.cam_dist      === 'number' ? node.params.cam_dist      : 2.5);
    const camSpeed     = f(typeof node.params.cam_speed     === 'number' ? node.params.cam_speed     : 0.2);
    const camAngle     = f(typeof node.params.cam_angle     === 'number' ? node.params.cam_angle     : 0.0);
    // cam_pitch: vertical angle in radians — 0=equatorial, π/2=top-down
    // Legacy cam_height kept as fallback if cam_pitch absent
    const camPitch     = f(typeof node.params.cam_pitch     === 'number' ? node.params.cam_pitch
                         : typeof node.params.cam_height    === 'number' ? Math.atan2(node.params.cam_height as number, parseFloat(camDist))
                         : 0.35);
    const pA = Array.isArray(node.params.color_a) ? node.params.color_a as number[] : [0.3, 0.6, 1.0];
    const pB = Array.isArray(node.params.color_b) ? node.params.color_b as number[] : [1.0, 0.4, 0.2];

    const hasTurb = parseFloat(turbulence) > 0.0;
    // If orbit_angle is wired in, use it directly (+ cam_angle offset); otherwise animate with time
    const angleExpr = orbitAngleIn
      ? `(${orbitAngleIn} + ${camAngle})`
      : `(${time} * ${camSpeed} + ${camAngle})`;

    const code = `
    // ── Orbital3D: camera (spherical: azimuth + pitch) ────────────────────────
    float ${id}_angle = ${angleExpr};
    // Spherical camera: pitch controls Y elevation independently of azimuth
    float ${id}_cp    = cos(${camPitch});
    float ${id}_sp    = sin(${camPitch});
    vec3  ${id}_ro    = vec3(cos(${id}_angle) * ${id}_cp * ${camDist},
                             ${id}_sp * ${camDist},
                             sin(${id}_angle) * ${id}_cp * ${camDist});
    mat3  ${id}_cm    = orbital3dCam(${id}_ro, vec3(0.0));
    vec3  ${id}_rd    = normalize(${id}_cm * vec3(${uv}.x, ${uv}.y * (u_resolution.y / u_resolution.x), 1.6));

    // ── Volume integration ────────────────────────────────────────────────────
    vec3  ${id}_color = vec3(0.0);
    float ${id}_alpha = 0.0;
    float ${id}_tdep  = 0.0;
    float ${id}_t     = 0.1;

    for (int ${id}_i = 0; ${id}_i < ${steps}; ${id}_i++) {
        if (${id}_alpha >= 0.98) break;
        vec3  ${id}_p  = ${id}_ro + ${id}_rd * ${id}_t;
        vec3  ${id}_ps = ${id}_p * ${scale};
        ${hasTurb ? `
        // Turbulence: jitter sample position with per-octave hash noise
        float ${id}_tnx = fract(sin(dot(${id}_ps + ${time} * ${turbSpeed}, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        float ${id}_tny = fract(sin(dot(${id}_ps + ${time} * ${turbSpeed} + vec3(5.2,1.3,9.7), vec3(269.5,183.3,341.1))) * 43758.5453);
        float ${id}_tnz = fract(sin(dot(${id}_ps + ${time} * ${turbSpeed} + vec3(3.1,7.4,2.9), vec3(113.5,271.9,93.3))) * 43758.5453);
        ${id}_ps += (vec3(${id}_tnx, ${id}_tny, ${id}_tnz) * 2.0 - 1.0) * ${turbulence};
        ` : ''}
        float ${id}_d  = orbital3d(${id}_ps, ${n}, ${l}, ${m}, ${a0});
        // Edge softness: radial gradient so outer extent disperses like real clouds
        // Adds noise-like irregularity proportional to edge_softness
        float ${id}_edgeR = length(${id}_ps);
        float ${id}_edgeN = fract(sin(dot(${id}_ps, vec3(127.1,311.7,74.7))) * 43758.5453);
        float ${id}_edgeFade = exp(-${id}_edgeR * ${edgeSoft} * (1.0 + ${id}_edgeN * 0.5));
        float ${id}_ds = pow(max(${id}_d, 0.0), ${gamma}) * ${densScale} * ${id}_edgeFade;
        float ${id}_sa = clamp(${id}_ds * ${stepSize}, 0.0, 1.0);
        if (${id}_sa > 0.001) {
            float ${id}_ax = dot(normalize(${id}_ps + vec3(0.0001)), vec3(0.0, 0.0, 1.0));
            vec3  ${id}_sc = mix(${vec3Str(pB)}, ${vec3Str(pA)}, clamp(${id}_ax * 0.5 + 0.5, 0.0, 1.0));
            // Fresnel-like rim brightening at silhouette edges
            float ${id}_fr = 1.0 - abs(dot(normalize(${id}_p - ${id}_ro), ${id}_rd));
            ${id}_sc *= 1.0 + ${id}_fr * 0.5;
            ${id}_color += (1.0 - ${id}_alpha) * ${id}_sa * ${id}_sc;
            ${id}_alpha += (1.0 - ${id}_alpha) * ${id}_sa;
            ${id}_tdep  += (1.0 - ${id}_alpha) * ${id}_t;
        }
        ${id}_t += ${stepSize};
    }
    // Soft tone-map: keep luminance but don't clip to solid white
    ${id}_color = ${id}_color / (${id}_color + vec3(0.6));
    ${id}_tdep  = ${id}_tdep / (float(${steps}) * ${stepSize});
`;

    return {
      code,
      outputVars: {
        color: `${id}_color`,
        alpha: `${id}_alpha`,
        depth: `${id}_tdep`,
      },
    };
  },
};
