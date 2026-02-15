import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';
import { PALETTE_GLSL_FN, PALETTE_PRESET_OPTIONS } from './color';

// ─── Shared GLSL helpers for fractal nodes ────────────────────────────────────

// Palette presets (mirrors PALETTE_PRESETS in color.ts — keep in sync)
const FRACTAL_PALETTE_PRESETS = [
  { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.0,0.1,0.2] },   // 0 IQ Blue-Teal
  { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.0,0.33,0.67] },  // 1 IQ Rainbow
  { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,1.0], d:[0.3,0.2,0.2] },    // 2 IQ Warm
  { a:[0.5,0.5,0.5], b:[0.5,0.5,0.5], c:[1.0,1.0,0.5], d:[0.8,0.9,0.3] },    // 3 IQ Lemon
  { a:[0.5,0.5,0.5], b:[0.4431,0.4235,0.4235], c:[1.0,0.7,0.4], d:[0.0,0.15,0.2] }, // 4 Sunset
  { a:[0.5,0.5,0.5], b:[0.4431,0.4235,0.4235], c:[2.0,1.0,0.0], d:[0.5,0.2,0.25] }, // 5 Fire
  { a:[0.8,0.5,0.4], b:[0.2,0.4,0.2], c:[2.0,1.0,1.0], d:[0.0,0.25,0.25] },  // 6 Forest
  { a:[0.721,0.328,0.542], b:[0.659,0.181,0.896], c:[0.612,0.14,0.196], d:[0.538,0.978,0.7] }, // 7 Purple Haze
  { a:[0.412,0.102,0.491], b:[0.397,0.13,0.485],  c:[0.612,0.14,0.196], d:[0.538,0.978,0.7] }, // 8 Deep Purple
  { a:[0.412,0.202,0.491], b:[0.397,0.13,0.485],  c:[1.147,1.557,1.197], d:[1.956,5.039,2.541] }, // 9 Psychedelic
];

function paletteVec(v: number[]): string {
  return `vec3(${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)})`;
}

// Shared GLSL helpers: complex power via polar form, complex multiply
const FRACTAL_GLSL_HELPERS = `
vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
}
vec2 cpow2(vec2 z) {
    return vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
}
vec2 cpow3(vec2 z) {
    return vec2(z.x*(z.x*z.x - 3.0*z.y*z.y), z.y*(3.0*z.x*z.x - z.y*z.y));
}
vec2 cpow_polar(vec2 z, float k) {
    float r = length(z);
    float a = atan(z.y, z.x);
    return pow(max(r, 0.00001), k) * vec2(cos(k*a), sin(k*a));
}`;

// Combine with PALETTE_GLSL_FN so the compiler deduplicates the palette fn
const MANDELBROT_GLSL = FRACTAL_GLSL_HELPERS + '\n' + PALETTE_GLSL_FN;

// ─── MandelbrotNode ───────────────────────────────────────────────────────────

export const MandelbrotNode: NodeDefinition = {
  type: 'mandelbrot',
  label: 'Mandelbrot / Julia',
  category: 'Presets',
  description: [
    'Generalized Mandelbrot (z^k + c) or Julia set. ',
    'Smooth coloring via IQ log/log formula. ',
    'Distance estimation from derivative tracking. ',
    'Orbit trap coloring (point, line, ring, cross). ',
    'Wire Mouse UV → c_pos for interactive Julia morphing.',
  ].join(''),
  inputs: {
    uv:    { type: 'vec2',  label: 'UV'         },
    c_pos: { type: 'vec2',  label: 'c (Julia)'  },  // Julia constant or Mandelbrot seed offset
    time:  { type: 'float', label: 'Time'        },  // unused by default but available for animated c
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color'           },
    iter:  { type: 'float', label: 'Smooth Iter'     },
    dist:  { type: 'float', label: 'Distance (SDF)'  },
    trap:  { type: 'float', label: 'Orbit Trap'      },
  },
  glslFunction: MANDELBROT_GLSL,
  defaultParams: {
    mode:           'mandelbrot',
    power:          2,
    max_iter:       150,
    bailout:        256.0,
    cx:             -0.7269,
    cy:              0.1889,
    zoom:           1.0,
    zoom_exp:       0.0,
    offset_x:       0.0,
    offset_y:       0.0,
    orbit_trap:     'none',
    trap_x:         0.0,
    trap_y:         0.0,
    trap_r:         0.5,
    palette_preset: '1',
    color_scale:    0.3,
    color_offset:   0.0,
  },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'mandelbrot', label: 'Mandelbrot' },
      { value: 'julia',      label: 'Julia'      },
    ]},
    power:          { label: 'Power (k)',       type: 'float', min: 2,     max: 8,    step: 1    },
    max_iter:       { label: 'Max Iterations',  type: 'float', min: 20,    max: 500,  step: 5    },
    bailout:        { label: 'Bailout Radius',  type: 'float', min: 2,     max: 1000, step: 10   },
    zoom:           { label: 'Zoom',            type: 'float', min: 0.01,  max: 50000, step: 0.05 },
    zoom_exp:       { label: 'Zoom (log₂)',     type: 'float', min: 0,     max: 20,   step: 0.05 },
    offset_x:       { label: 'Offset X',        type: 'float', min: -3,    max: 3,    step: 0.01 },
    offset_y:       { label: 'Offset Y',        type: 'float', min: -3,    max: 3,    step: 0.01 },
    cx:             { label: 'Julia c.x',       type: 'float', min: -2,    max: 2,    step: 0.001 },
    cy:             { label: 'Julia c.y',       type: 'float', min: -2,    max: 2,    step: 0.001 },
    orbit_trap:     { label: 'Orbit Trap',  type: 'select', options: [
      { value: 'none',  label: 'None'         },
      { value: 'point', label: 'Point'        },
      { value: 'line',  label: 'Line (y=0)'   },
      { value: 'ring',  label: 'Ring'         },
      { value: 'cross', label: 'Cross'        },
    ]},
    trap_x:         { label: 'Trap X',          type: 'float', min: -2,    max: 2,    step: 0.01 },
    trap_y:         { label: 'Trap Y',          type: 'float', min: -2,    max: 2,    step: 0.01 },
    trap_r:         { label: 'Trap Radius',     type: 'float', min: 0.0,   max: 2,    step: 0.01 },
    palette_preset: { label: 'Palette',         type: 'select', options: PALETTE_PRESET_OPTIONS },
    color_scale:    { label: 'Color Scale',     type: 'float', min: 0.01,  max: 5,    step: 0.01 },
    color_offset:   { label: 'Color Offset',    type: 'float', min: 0.0,   max: 1.0,  step: 0.01 },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar   = inputVars.uv    ?? 'vec2(0.0)';
    const cPosVar = inputVars.c_pos ?? 'vec2(0.0)';

    const mode      = (node.params.mode as string) ?? 'mandelbrot';
    const power     = Math.max(2, Math.round(typeof node.params.power    === 'number' ? node.params.power    : 2));
    const maxIter   = Math.max(20, Math.round(typeof node.params.max_iter === 'number' ? node.params.max_iter : 150));
    const bailout   = f(typeof node.params.bailout   === 'number' ? node.params.bailout   : 256.0);
    // zoom_exp (log₂ scale) takes priority over zoom if > 0, enabling deep zoom via a compact slider
    const zoomRaw   = typeof node.params.zoom     === 'number' ? node.params.zoom     : 1.0;
    const zoomExp   = typeof node.params.zoom_exp === 'number' ? node.params.zoom_exp : 0.0;
    const zoom      = zoomExp > 0 ? `pow(2.0, ${f(zoomExp)})` : f(zoomRaw);
    const offsetX   = f(typeof node.params.offset_x  === 'number' ? node.params.offset_x  : 0.0);
    const offsetY   = f(typeof node.params.offset_y  === 'number' ? node.params.offset_y  : 0.0);
    const cx        = f(typeof node.params.cx        === 'number' ? node.params.cx        : -0.7269);
    const cy        = f(typeof node.params.cy        === 'number' ? node.params.cy        : 0.1889);
    const orbitTrap = (node.params.orbit_trap as string) ?? 'none';
    const trapX     = f(typeof node.params.trap_x    === 'number' ? node.params.trap_x    : 0.0);
    const trapY     = f(typeof node.params.trap_y    === 'number' ? node.params.trap_y    : 0.0);
    const trapR     = f(typeof node.params.trap_r    === 'number' ? node.params.trap_r    : 0.5);
    const colorScale  = f(typeof node.params.color_scale  === 'number' ? node.params.color_scale  : 0.3);
    const colorOffset = f(typeof node.params.color_offset === 'number' ? node.params.color_offset : 0.0);
    const presIdx = parseInt((node.params.palette_preset as string) ?? '1', 10);
    const pres = FRACTAL_PALETTE_PRESETS[Math.min(presIdx, FRACTAL_PALETTE_PRESETS.length - 1)] ?? FRACTAL_PALETTE_PRESETS[1];
    const pA = paletteVec(pres.a); const pB = paletteVec(pres.b);
    const pC = paletteVec(pres.c); const pD = paletteVec(pres.d);

    // Choose cpow variant inline
    let zpow: string;
    if (power === 2) {
      zpow = `cpow2(${id}_z)`;
    } else if (power === 3) {
      zpow = `cpow3(${id}_z)`;
    } else {
      zpow = `cpow_polar(${id}_z, ${power}.0)`;
    }

    // Derivative step — for distance estimation
    // dz_{n+1} = k * z^{k-1} * dz_n  (+ 1 for Mandelbrot)
    // For k=2: k*z^{k-1} = 2*z, so: dz = cmul(2.0*z, dz)
    // For k=3: k*z^{k-1} = 3*z^2, so: dz = cmul(3.0*cpow2(z), dz)
    // For k≥4: k*z^{k-1} = k * polar(z, k-1), so: dz = cmul(k.0*cpow_polar(z, k-1), dz)
    let dzMul: string;
    if (power === 2) {
      dzMul = `cmul(2.0 * ${id}_z, ${id}_dz)`;
    } else if (power === 3) {
      dzMul = `cmul(3.0 * cpow2(${id}_z), ${id}_dz)`;
    } else {
      dzMul = `cmul(${power}.0 * cpow_polar(${id}_z, ${power - 1}.0), ${id}_dz)`;
    }

    // Orbit trap expression inside loop
    let trapExpr = '';
    if (orbitTrap === 'point') {
      trapExpr = `    ${id}_trap = min(${id}_trap, length(${id}_z - vec2(${trapX}, ${trapY})));\n`;
    } else if (orbitTrap === 'line') {
      trapExpr = `    ${id}_trap = min(${id}_trap, abs(${id}_z.y - ${trapY}));\n`;
    } else if (orbitTrap === 'ring') {
      trapExpr = `    ${id}_trap = min(${id}_trap, abs(length(${id}_z - vec2(${trapX}, ${trapY})) - ${trapR}));\n`;
    } else if (orbitTrap === 'cross') {
      trapExpr = `    ${id}_trap = min(${id}_trap, min(abs(${id}_z.x - ${trapX}), abs(${id}_z.y - ${trapY})));\n`;
    }

    // Build the code block
    const isJulia = mode === 'julia';
    const cExpr = isJulia
      ? (inputVars.c_pos ? cPosVar : `vec2(${cx}, ${cy})`)
      : `${id}_c`;   // Mandelbrot: c = UV position
    const z0Expr = isJulia ? `${uvVar} / ${zoom} + vec2(${offsetX}, ${offsetY})` : `vec2(0.0)`;
    const c0Expr = isJulia ? cExpr   : `${uvVar} / ${zoom} + vec2(${offsetX}, ${offsetY})`;
    const dzInit = isJulia ? `vec2(1.0, 0.0)` : `vec2(0.0)`;
    const dzMandelbrotAdd = isJulia ? '' : `    ${id}_dz += vec2(1.0, 0.0);\n`;

    const code = [
      `    // Mandelbrot/Julia node (${mode}, power=${power}, maxIter=${maxIter})\n`,
      `    vec2 ${id}_c  = ${c0Expr};\n`,
      `    vec2 ${id}_z  = ${z0Expr};\n`,
      `    vec2 ${id}_dz = ${dzInit};\n`,
      `    float ${id}_n    = 0.0;\n`,
      `    float ${id}_trap = 1e20;\n`,
      `    float ${id}_B2   = ${bailout} * ${bailout};\n`,
      `    for (float ${id}_i = 0.0; ${id}_i < ${maxIter}.0; ${id}_i++) {\n`,
      `        ${id}_dz = ${dzMul};\n`,
      dzMandelbrotAdd ? `        ${id}_dz += vec2(1.0, 0.0);\n` : '',
      `        ${id}_z  = ${zpow} + ${id}_c;\n`,
      trapExpr ? `        ${trapExpr.replace(/^\s{4}/, '        ')}` : '',
      `        if (dot(${id}_z, ${id}_z) > ${id}_B2) break;\n`,
      `        ${id}_n += 1.0;\n`,
      `    }\n`,
      // Smooth iteration count (IQ formula, generalized)
      `    float ${id}_iter;\n`,
      `    float ${id}_lz2 = dot(${id}_z, ${id}_z);\n`,
      `    if (${id}_n >= ${maxIter}.0) {\n`,
      `        ${id}_iter = ${maxIter}.0;\n`,
      `    } else {\n`,
      `        ${id}_iter = ${id}_n - log(log(${id}_lz2) * 0.5) / log(${power}.0);\n`,
      `    }\n`,
      // Distance estimation (IQ formula)
      `    float ${id}_dist = 0.0;\n`,
      `    float ${id}_ldz2 = dot(${id}_dz, ${id}_dz);\n`,
      `    if (${id}_ldz2 > 0.0 && ${id}_lz2 > 0.0) {\n`,
      `        ${id}_dist = sqrt(${id}_lz2 / ${id}_ldz2) * 0.5 * log(${id}_lz2);\n`,
      `    }\n`,
      // Built-in coloring with palette
      `    float ${id}_t = ${id}_iter * ${colorScale} + ${colorOffset};\n`,
      `    vec3 ${id}_color;\n`,
      `    if (${id}_n >= ${maxIter}.0) {\n`,
      `        ${id}_color = vec3(0.0);\n`,   // inside the set = black
      `    } else {\n`,
      `        ${id}_color = palette(${id}_t, ${pA}, ${pB}, ${pC}, ${pD});\n`,
      `    }\n`,
    ];

    // Orbit trap coloring blend (if enabled, modulate color by trap distance)
    if (orbitTrap !== 'none') {
      code.push(
        `    // Orbit trap blend\n`,
        `    float ${id}_trapNorm = clamp(${id}_trap * 2.0, 0.0, 1.0);\n`,
        `    ${id}_color = mix(${id}_color, palette(${id}_trap * ${colorScale}, ${pA}, ${pB}, ${pC}, ${pD}), 1.0 - ${id}_trapNorm);\n`,
      );
    }

    return {
      code: code.join(''),
      outputVars: {
        color: `${id}_color`,
        iter:  `${id}_iter`,
        dist:  `${id}_dist`,
        trap:  `${id}_trap`,
      },
    };
  },
};

// ─── IFSNode — Iterated Function System ──────────────────────────────────────

// IFS approach: fold-based (inverse IFS) per pixel.
// Each preset uses a "random walk" simulation: loop N times, each iteration
// pick a transform via hash(i), apply to running point, accumulate glow
// at the FINAL point's distance from the current UV.
//
// Actually we use the more visually reliable "chaos game" method:
// Each pixel independently runs a chaos game starting near UV position,
// then glows if any step lands near the attractor.
//
// For GLSL efficiency: we instead do the "checkerboard IFS distance" approach
// which is: apply inverse transforms repeatedly to a candidate point (UV),
// stopping when |p| escapes or reaches a fixpoint. This gives a smooth
// membership indicator.

// IFS GLSL helpers — 2D hash for chaos game
const IFS_HELPERS = `
float ifsHash(float n) {
    return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}
vec2 ifsHash2(vec2 p) {
    float h = ifsHash(p.x + p.y * 57.0);
    return vec2(h, ifsHash(h + 1.0));
}`;

// Barnsley Fern GLSL (classic 4-transform IFS)
const FERN_TRANSFORMS = `
// Barnsley Fern 4 transforms
// w1 (1%):  x' = 0,       y' = 0.16*y
// w2 (85%): x' = 0.85*x + 0.04*y,   y' = -0.04*x + 0.85*y + 1.6
// w3 (7%):  x' = 0.2*x  - 0.26*y,  y' =  0.23*x + 0.22*y + 1.6
// w4 (7%):  x' = -0.15*x + 0.28*y, y' = 0.26*x + 0.24*y + 0.44
vec2 ifsFern(vec2 p, float r) {
    if (r < 0.01) {
        return vec2(0.0, 0.16 * p.y);
    } else if (r < 0.86) {
        return vec2(0.85*p.x + 0.04*p.y, -0.04*p.x + 0.85*p.y + 1.6);
    } else if (r < 0.93) {
        return vec2(0.2*p.x - 0.26*p.y,  0.23*p.x + 0.22*p.y + 1.6);
    } else {
        return vec2(-0.15*p.x + 0.28*p.y, 0.26*p.x + 0.24*p.y + 0.44);
    }
}`;

// Sierpinski triangle (3 transforms, equal weight)
const SIERPINSKI_TRANSFORMS = `
vec2 ifsSierpinski(vec2 p, float r) {
    if (r < 0.333) {
        return p * 0.5;
    } else if (r < 0.667) {
        return p * 0.5 + vec2(0.5, 0.0);
    } else {
        return p * 0.5 + vec2(0.25, 0.5);
    }
}`;

// Dragon curve (2 transforms)
const DRAGON_TRANSFORMS = `
vec2 ifsDragon(vec2 p, float r) {
    if (r < 0.5) {
        return vec2(p.x + p.y, p.y - p.x) * 0.7071;
    } else {
        return vec2(p.x - p.y - 1.0, p.y + p.x) * 0.7071;
    }
}`;

// Koch-like (4 transforms)
const KOCH_TRANSFORMS = `
vec2 ifsKoch(vec2 p, float r) {
    if (r < 0.25) {
        return p * 0.333;
    } else if (r < 0.5) {
        mat2 rot60 = mat2(0.5, 0.866, -0.866, 0.5);
        return rot60 * p * 0.333 + vec2(0.333, 0.0);
    } else if (r < 0.75) {
        mat2 rotm60 = mat2(0.5, -0.866, 0.866, 0.5);
        return rotm60 * p * 0.333 + vec2(0.5, 0.2887);
    } else {
        return p * 0.333 + vec2(0.667, 0.0);
    }
}`;

const IFS_GLSL = IFS_HELPERS + '\n' + FERN_TRANSFORMS + '\n'
  + SIERPINSKI_TRANSFORMS + '\n' + DRAGON_TRANSFORMS + '\n' + KOCH_TRANSFORMS
  + '\n' + PALETTE_GLSL_FN;

export const IFSNode: NodeDefinition = {
  type: 'ifs',
  label: 'IFS Fractal',
  category: 'Presets',
  description: [
    'Iterated Function System fractal via chaos game simulation. ',
    'Presets: Sierpinski triangle, Barnsley Fern, Koch, Dragon curve. ',
    'Each pixel runs N chaos game steps and glows if near the attractor.',
  ].join(''),
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    glow:  { type: 'float', label: 'Glow (raw)' },
  },
  glslFunction: IFS_GLSL,
  defaultParams: {
    preset:         'fern',
    iterations:     60,
    glow:           0.008,
    scale:          1.0,
    offset_x:       0.0,
    offset_y:       -0.5,
    palette_preset: '7',
    color_scale:    1.0,
    color_offset:   0.0,
    anim_speed:     0.0,
  },
  paramDefs: {
    preset: { label: 'Preset', type: 'select', options: [
      { value: 'fern',       label: 'Barnsley Fern'   },
      { value: 'sierpinski', label: 'Sierpinski'      },
      { value: 'dragon',     label: 'Dragon Curve'    },
      { value: 'koch',       label: 'Koch (snowflake)'},
    ]},
    iterations:     { label: 'Iterations',  type: 'float', min: 10,   max: 150,  step: 1    },
    glow:           { label: 'Glow',        type: 'float', min: 0.001, max: 0.1,  step: 0.001 },
    scale:          { label: 'Scale',       type: 'float', min: 0.1,  max: 5.0,  step: 0.05 },
    offset_x:       { label: 'Offset X',    type: 'float', min: -3,   max: 3,    step: 0.01 },
    offset_y:       { label: 'Offset Y',    type: 'float', min: -3,   max: 3,    step: 0.01 },
    anim_speed:     { label: 'Anim Speed',  type: 'float', min: 0.0,  max: 1.0,  step: 0.01 },
    palette_preset: { label: 'Palette',     type: 'select', options: PALETTE_PRESET_OPTIONS },
    color_scale:    { label: 'Color Scale', type: 'float', min: 0.01, max: 5.0,  step: 0.01 },
    color_offset:   { label: 'Color Offset',type: 'float', min: 0.0,  max: 1.0,  step: 0.01 },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const uvVar   = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar = inputVars.time ?? '0.0';

    const preset    = (node.params.preset as string) ?? 'fern';
    const iters     = Math.max(10, Math.round(typeof node.params.iterations === 'number' ? node.params.iterations : 40));
    const glowVal   = f(typeof node.params.glow         === 'number' ? node.params.glow         : 0.004);
    const scale     = f(typeof node.params.scale        === 'number' ? node.params.scale        : 1.0);
    const offX      = f(typeof node.params.offset_x     === 'number' ? node.params.offset_x     : 0.0);
    const offY      = f(typeof node.params.offset_y     === 'number' ? node.params.offset_y     : -0.5);
    const animSpeed = f(typeof node.params.anim_speed   === 'number' ? node.params.anim_speed   : 0.0);
    const colorScale  = f(typeof node.params.color_scale  === 'number' ? node.params.color_scale  : 1.0);
    const colorOffset = f(typeof node.params.color_offset === 'number' ? node.params.color_offset : 0.0);
    const presIdx = parseInt((node.params.palette_preset as string) ?? '7', 10);
    const pres = FRACTAL_PALETTE_PRESETS[Math.min(presIdx, FRACTAL_PALETTE_PRESETS.length - 1)] ?? FRACTAL_PALETTE_PRESETS[7];
    const pA = paletteVec(pres.a); const pB = paletteVec(pres.b);
    const pC = paletteVec(pres.c); const pD = paletteVec(pres.d);

    // Choose the IFS transform function name
    const presetFn: Record<string, string> = {
      fern:       'ifsFern',
      sierpinski: 'ifsSierpinski',
      dragon:     'ifsDragon',
      koch:       'ifsKoch',
    };
    const fn = presetFn[preset] ?? 'ifsFern';

    // UV coordinate mapping — each preset's attractor lives in a specific space
    // Fern:       x∈[-3,3], y∈[0,10]   → center y at 5
    // Sierpinski: triangle (0,0)→(1,0)→(0.5,1) → center at (0.5, 0.5)
    // Dragon:     x∈[-0.5,1.5], y∈[-0.5,1.0] → offset to center
    // Koch:       x∈[0,1], thin y band  → center horizontally
    let uvSetup: string;
    if (preset === 'fern') {
      uvSetup = `    vec2 ${id}_uv = ${uvVar} * ${scale} * 5.0 + vec2(${offX}, ${offY} + 5.0);\n`;
    } else if (preset === 'sierpinski') {
      uvSetup = `    vec2 ${id}_uv = ${uvVar} * ${scale} * 0.5 + vec2(0.5 + ${offX}, 0.5 + ${offY});\n`;
    } else if (preset === 'dragon') {
      uvSetup = `    vec2 ${id}_uv = ${uvVar} * ${scale} + vec2(0.5 + ${offX}, 0.25 + ${offY});\n`;
    } else {
      // Koch
      uvSetup = `    vec2 ${id}_uv = ${uvVar} * ${scale} * 0.5 + vec2(0.5 + ${offX}, 0.15 + ${offY});\n`;
    }

    const totalIters = iters + 20;

    const code = [
      uvSetup,
      // Chaos game (CORRECTED):
      // All pixels share the same seed (time-only, NOT UV) and start from (0,0).
      // This means all pixels trace the SAME random walk on the attractor.
      // Each pixel glows if the shared wandering point passes near its UV.
      `    float ${id}_seed = ifsHash(${timeVar} * ${animSpeed} + 0.5);\n`,
      `    vec2 ${id}_p = vec2(0.0);\n`,
      // Warmup: 20 iters to converge onto the attractor (no glow)
      `    for (float ${id}_i = 0.0; ${id}_i < 20.0; ${id}_i++) {\n`,
      `        float ${id}_r = fract(${id}_seed + ${id}_i * 0.61803);\n`,
      `        ${id}_p = ${fn}(${id}_p, ${id}_r);\n`,
      `    }\n`,
      // Glow accumulation: does p land near THIS pixel's UV?
      `    float ${id}_glow = 0.0;\n`,
      `    for (float ${id}_i = 20.0; ${id}_i < ${totalIters}.0; ${id}_i++) {\n`,
      `        float ${id}_r = fract(${id}_seed + ${id}_i * 0.61803);\n`,
      `        ${id}_p = ${fn}(${id}_p, ${id}_r);\n`,
      `        ${id}_glow += ${glowVal} / max(length(${id}_uv - ${id}_p), 0.00001);\n`,
      `    }\n`,
      `    ${id}_glow = tanh(${id}_glow);\n`,
      // Color by palette
      `    float ${id}_t = ${id}_glow * ${colorScale} + ${colorOffset};\n`,
      `    vec3 ${id}_color = palette(${id}_t, ${pA}, ${pB}, ${pC}, ${pD}) * ${id}_glow;\n`,
    ];

    return {
      code: code.join(''),
      outputVars: { color: `${id}_color`, glow: `${id}_glow` },
    };
  },
};
