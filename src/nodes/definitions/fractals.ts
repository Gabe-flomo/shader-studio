import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, p } from './helpers';
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

// ─── Double-Single (DS) arithmetic helpers ────────────────────────────────────
// Represents an extended-precision number as (hi + lo) where hi is the main
// float32 value and lo is the rounding error term.  Gives ~48 bits of mantissa
// (≈14-15 decimal digits) using only float32 operations — no float64 needed.
//
// Implements the Dekker / Veltkamp algorithms (Knuth 1969, Dekker 1971).
// Works on GLSL ES 1.00 (no fma, no double).
const DS_GLSL_HELPERS = `
// Veltkamp splitter: split a into (hi, lo) such that a = hi + lo exactly.
// Uses the factor 2^12+1 = 4097 for float32 (24-bit mantissa → split at bit 12).
vec2 ds_split(float a) {
    float c = 4097.0 * a;
    float ahi = c - (c - a);
    float alo = a - ahi;
    return vec2(ahi, alo);
}

// DS addition: (a.x + a.y) + (b.x + b.y) → result.x + result.y (exact to DS precision)
vec2 ds_add(vec2 a, vec2 b) {
    float s = a.x + b.x;
    float v = s - a.x;
    float e = (a.x - (s - v)) + (b.x - v) + a.y + b.y;
    return vec2(s, e);
}

// DS subtraction
vec2 ds_sub(vec2 a, vec2 b) {
    float s = a.x - b.x;
    float v = s - a.x;
    float e = (a.x - (s - v)) + (-b.x - v) + a.y - b.y;
    return vec2(s, e);
}

// DS multiplication: uses Veltkamp splitting to recover the rounding error of a.x*b.x
vec2 ds_mul(vec2 a, vec2 b) {
    float p = a.x * b.x;
    vec2 sa = ds_split(a.x);
    vec2 sb = ds_split(b.x);
    float e = ((sa.x * sb.x - p) + sa.x * sb.y + sa.y * sb.x) + sa.y * sb.y;
    e += a.x * b.y + a.y * b.x;
    return vec2(p, e);
}

// Multiply DS number by 2.0 exactly (power-of-2 scale is always exact)
vec2 ds_scale2(vec2 a) { return vec2(a.x * 2.0, a.y * 2.0); }

// Convert float to DS (lo = 0)
vec2 ds_float(float a) { return vec2(a, 0.0); }`;

// Combine with PALETTE_GLSL_FN so the compiler deduplicates the palette fn
const MANDELBROT_GLSL = FRACTAL_GLSL_HELPERS + '\n' + DS_GLSL_HELPERS + '\n' + PALETTE_GLSL_FN;

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
    precision:      'standard',
    power:          2,
    max_iter:       256,
    bailout:        256.0,
    cx:             -0.7269,
    cy:              0.1889,
    zoom:           1.0,
    zoom_exp:       0.0,
    center_x:       -0.5,
    center_y:        0.0,
    orbit_trap:     'none',
    trap_x:         0.0,
    trap_y:         0.0,
    trap_r:         0.5,
    palette_preset: '1',
    color_scale:    3.0,   // 3 palette cycles over [0, max_iter]
    color_offset:   0.0,
    dist_shade:     0.0,   // 0 = off; darken near-set boundary using distance estimation
  },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', options: [
      { value: 'mandelbrot', label: 'Mandelbrot' },
      { value: 'julia',      label: 'Julia'      },
    ]},
    precision: { label: 'Precision', type: 'select', options: [
      { value: 'standard', label: 'Standard (fast, zoom ≤ 10⁶)' },
      { value: 'high',     label: 'High (DS, zoom ≤ 10¹²)'     },
    ]},
    power:          { label: 'Power (k)',       type: 'float', min: 2,     max: 8,    step: 1    },
    max_iter:       { label: 'Max Iterations',  type: 'float', min: 20,    max: 2000, step: 5    },
    bailout:        { label: 'Bailout Radius',  type: 'float', min: 2,     max: 1000, step: 10   },
    zoom:           { label: 'Zoom',            type: 'float', min: 0.01,  max: 50000, step: 0.05 },
    zoom_exp:       { label: 'Zoom (log₂)',     type: 'float', min: 0,     max: 60,   step: 0.1  },
    center_x:       { label: 'Center X',        type: 'float', min: -3,    max: 3,    step: 0.0001 },
    center_y:       { label: 'Center Y',        type: 'float', min: -3,    max: 3,    step: 0.0001 },
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
    color_scale:    { label: 'Color Cycles',    type: 'float', min: 0.1,   max: 20,   step: 0.1  },
    color_offset:   { label: 'Color Offset',    type: 'float', min: 0.0,   max: 1.0,  step: 0.01 },
    dist_shade:     { label: 'Edge Shading',    type: 'float', min: 0.0,   max: 20,   step: 0.1  },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar   = inputVars.uv    ?? 'vec2(0.0)';
    const cPosVar = inputVars.c_pos ?? 'vec2(0.0)';

    // Note: 'mandelbrot' is in SKIP_UNIFORM_TYPES so all params arrive here as
    // raw numbers (never replaced with uniform name strings by the patcher).
    const mode      = (node.params.mode as string) ?? 'mandelbrot';
    const precision = (node.params.precision as string) ?? 'standard';
    const useDS     = precision === 'high';
    const power     = Math.max(2, Math.round((node.params.power    as number) || 2));
    const maxIter   = Math.max(20, Math.round((node.params.max_iter as number) || 150));
    const bailout   = f((node.params.bailout as number) || 256.0);

    // zoom_exp (log₂ scale) takes priority over zoom if non-zero
    const zoomRaw   = (node.params.zoom     as number) || 1.0;
    const zoomExp   = (node.params.zoom_exp as number) || 0.0;
    const zoom      = zoomExp > 0 ? `pow(2.0, ${f(zoomExp)})` : f(zoomRaw);

    // Center coordinates — full JS float64, split into DS pairs for high precision mode.
    // Math.fround() rounds to nearest float32; the difference is the lo (error) term.
    const centerXf64 = typeof node.params.center_x === 'number' ? node.params.center_x : -0.5;
    const centerYf64 = typeof node.params.center_y === 'number' ? node.params.center_y :  0.0;
    const cxHi = Math.fround(centerXf64);
    const cxLo = centerXf64 - cxHi;
    const cyHi = Math.fround(centerYf64);
    const cyLo = centerYf64 - cyHi;

    const cx        = p(node.params.cx, -0.7269);
    const cy        = p(node.params.cy, 0.1889);
    const orbitTrap = (node.params.orbit_trap as string) ?? 'none';
    const trapX     = p(node.params.trap_x, 0.0);
    const trapY     = p(node.params.trap_y, 0.0);
    const trapR     = p(node.params.trap_r, 0.5);
    const colorScale  = p(node.params.color_scale, 0.3);
    const colorOffset = p(node.params.color_offset, 0.0);
    const distShade   = (node.params.dist_shade as number) || 0.0;
    const presIdx = parseInt((node.params.palette_preset as string) ?? '1', 10);
    const pres = FRACTAL_PALETTE_PRESETS[Math.min(presIdx, FRACTAL_PALETTE_PRESETS.length - 1)] ?? FRACTAL_PALETTE_PRESETS[1];
    const pA = paletteVec(pres.a); const pB = paletteVec(pres.b);
    const pC = paletteVec(pres.c); const pD = paletteVec(pres.d);

    const isJulia = mode === 'julia';

    // ── Standard float32 iteration path ───────────────────────────────────────
    let zpow: string;
    if (power === 2) {
      zpow = `cpow2(${id}_z)`;
    } else if (power === 3) {
      zpow = `cpow3(${id}_z)`;
    } else {
      zpow = `cpow_polar(${id}_z, ${power}.0)`;
    }

    let dzMul: string;
    if (power === 2) {
      dzMul = `cmul(2.0 * ${id}_z, ${id}_dz)`;
    } else if (power === 3) {
      dzMul = `cmul(3.0 * cpow2(${id}_z), ${id}_dz)`;
    } else {
      dzMul = `cmul(${power}.0 * cpow_polar(${id}_z, ${power - 1}.0), ${id}_dz)`;
    }

    // Orbit trap update (reads float z components)
    let trapExpr = '';
    if (orbitTrap === 'point') {
      trapExpr = `${id}_trap = min(${id}_trap, length(${id}_z - vec2(${trapX}, ${trapY})));`;
    } else if (orbitTrap === 'line') {
      trapExpr = `${id}_trap = min(${id}_trap, abs(${id}_z.y - ${trapY}));`;
    } else if (orbitTrap === 'ring') {
      trapExpr = `${id}_trap = min(${id}_trap, abs(length(${id}_z - vec2(${trapX}, ${trapY})) - ${trapR}));`;
    } else if (orbitTrap === 'cross') {
      trapExpr = `${id}_trap = min(${id}_trap, min(abs(${id}_z.x - ${trapX}), abs(${id}_z.y - ${trapY})));`;
    }
    const trapLine = trapExpr ? `        ${trapExpr}\n` : '';

    const code: string[] = [];

    if (!useDS) {
      // ── Standard mode: float32 Mandelbrot ────────────────────────────────────
      const cExpr = isJulia
        ? (inputVars.c_pos ? cPosVar : `vec2(${cx}, ${cy})`)
        : `${id}_c`;
      const z0    = isJulia ? `${uvVar} / ${zoom} + vec2(${f(cxHi)}, ${f(cyHi)})` : `vec2(0.0)`;
      const c0    = isJulia ? cExpr  : `${uvVar} / ${zoom} + vec2(${f(cxHi)}, ${f(cyHi)})`;
      const dzInit = isJulia ? `vec2(1.0, 0.0)` : `vec2(0.0)`;
      const dzMandelbrotAdd = isJulia ? '' : `        ${id}_dz += vec2(1.0, 0.0);\n`;

      code.push(
        `    // Mandelbrot/Julia (standard float32, ${mode}, power=${power})\n`,
        `    vec2 ${id}_c  = ${c0};\n`,
        `    vec2 ${id}_z  = ${z0};\n`,
        `    vec2 ${id}_dz = ${dzInit};\n`,
        `    float ${id}_n = 0.0, ${id}_trap = 1e20;\n`,
        `    float ${id}_B2 = ${bailout} * ${bailout};\n`,
        `    for (float ${id}_i = 0.0; ${id}_i < ${maxIter}.0; ${id}_i++) {\n`,
        `        ${id}_dz = ${dzMul};\n`,
        dzMandelbrotAdd,
        `        ${id}_z = ${zpow} + ${id}_c;\n`,
        trapLine,
        `        if (dot(${id}_z, ${id}_z) > ${id}_B2) break;\n`,
        `        ${id}_n += 1.0;\n`,
        `    }\n`,
      );
    } else {
      // ── High precision mode: DS (double-single) arithmetic ────────────────────
      // c is computed as a DS pair: center (hi+lo) + uv/zoom
      // The iteration runs entirely in DS so precision holds to zoom ~10^12.
      //
      // DS layout: vec2(hi, lo) where true value = hi + lo.
      //
      // For Julia mode the c constant doesn't benefit from DS (it's wired in as
      // float), but z still uses DS which helps when zoom is large.

      const scaleExpr = zoomExp > 0 ? `pow(2.0, -${f(zoomExp)})` : `1.0 / ${f(zoomRaw)}`;

      code.push(
        `    // Mandelbrot/Julia (DS high-precision, ${mode}, power=${power})\n`,
        // Compute scale (1/zoom) — power-of-2 scales are exact in float32
        `    float ${id}_scale = ${scaleExpr};\n`,
      );

      if (isJulia) {
        // Julia: c is wired input (float), z starts at UV position in DS
        const juliaCExpr = inputVars.c_pos ? cPosVar : `vec2(${cx}, ${cy})`;
        code.push(
          // z0 = center + uv * scale  in DS
          `    vec2 ${id}_cx_ds = ds_add(vec2(${f(cxHi)}, ${f(cxLo)}), ds_float((${uvVar}).x * ${id}_scale));\n`,
          `    vec2 ${id}_cy_ds = ds_add(vec2(${f(cyHi)}, ${f(cyLo)}), ds_float((${uvVar}).y * ${id}_scale));\n`,
          // z and c
          `    vec2 ${id}_zx = ${id}_cx_ds;\n`,
          `    vec2 ${id}_zy = ${id}_cy_ds;\n`,
          `    vec2 ${id}_cx_c = ds_float((${juliaCExpr}).x);\n`,
          `    vec2 ${id}_cy_c = ds_float((${juliaCExpr}).y);\n`,
        );
      } else {
        // Mandelbrot: c = center + uv * scale, z starts at 0
        code.push(
          `    vec2 ${id}_cx_c = ds_add(vec2(${f(cxHi)}, ${f(cxLo)}), ds_float((${uvVar}).x * ${id}_scale));\n`,
          `    vec2 ${id}_cy_c = ds_add(vec2(${f(cyHi)}, ${f(cyLo)}), ds_float((${uvVar}).y * ${id}_scale));\n`,
          `    vec2 ${id}_zx = vec2(0.0, 0.0);\n`,
          `    vec2 ${id}_zy = vec2(0.0, 0.0);\n`,
        );
      }

      // Derivative for distance estimation runs in float32 (close enough)
      const dzInitDS  = isJulia ? `vec2(1.0, 0.0)` : `vec2(0.0)`;
      const dzAddLine = isJulia ? '' : `        ${id}_dz += vec2(1.0, 0.0);\n`;

      code.push(
        `    vec2 ${id}_dz = ${dzInitDS};\n`,
        `    float ${id}_n = 0.0, ${id}_trap = 1e20;\n`,
        `    float ${id}_B2 = ${bailout} * ${bailout};\n`,
        `    for (float ${id}_i = 0.0; ${id}_i < ${maxIter}.0; ${id}_i++) {\n`,
        // DS squaring: z_new_x = zx^2 - zy^2 + cx
        //              z_new_y = 2*zx*zy + cy
        `        vec2 ${id}_zx2 = ds_mul(${id}_zx, ${id}_zx);\n`,
        `        vec2 ${id}_zy2 = ds_mul(${id}_zy, ${id}_zy);\n`,
        `        vec2 ${id}_zxy = ds_mul(${id}_zx, ${id}_zy);\n`,
        power === 2
          ? `        vec2 ${id}_nx = ds_add(ds_sub(${id}_zx2, ${id}_zy2), ${id}_cx_c);\n` +
            `        vec2 ${id}_ny = ds_add(ds_scale2(${id}_zxy), ${id}_cy_c);\n`
          : // Higher powers fall back to float (DS for power>2 would be very expensive)
            `        vec2 ${id}_zfloat = vec2(${id}_zx.x, ${id}_zy.x);\n` +
            `        vec2 ${id}_zpowed = ${power === 3 ? `cpow3(${id}_zfloat)` : `cpow_polar(${id}_zfloat, ${power}.0)`};\n` +
            `        vec2 ${id}_nx = ds_add(ds_float(${id}_zpowed.x), ${id}_cx_c);\n` +
            `        vec2 ${id}_ny = ds_add(ds_float(${id}_zpowed.y), ${id}_cy_c);\n`,
        `        ${id}_zx = ${id}_nx;\n`,
        `        ${id}_zy = ${id}_ny;\n`,
        // Derivative + trap use float z alias (hi component only — close enough)
        // Use _zhi suffix to avoid any redeclaration conflicts across GLSL drivers
        `        vec2 ${id}_zhi = vec2(${id}_zx.x, ${id}_zy.x);\n`,
        `        ${id}_dz = ${dzMul.replace(new RegExp(`${id}_z\\b`, 'g'), `${id}_zhi`)};\n`,
        dzAddLine,
        trapLine ? `        ${trapLine.trim().replace(new RegExp(`${id}_z\\b`, 'g'), `${id}_zhi`)}\n` : '',
        // Bailout test on hi components
        `        float ${id}_r2 = ${id}_zx.x * ${id}_zx.x + ${id}_zy.x * ${id}_zy.x;\n`,
        `        if (${id}_r2 > ${id}_B2) break;\n`,
        `        ${id}_n += 1.0;\n`,
        `    }\n`,
        // Final float z for smooth iter / distance code
        `    vec2 ${id}_z = vec2(${id}_zx.x, ${id}_zy.x);\n`,
      );
    }

    // ── Shared: smooth iter count, distance estimation, coloring ──────────────
    code.push(
      `    float ${id}_iter;\n`,
      `    float ${id}_lz2 = dot(${id}_z, ${id}_z);\n`,
      `    if (${id}_n >= ${maxIter}.0) {\n`,
      `        ${id}_iter = ${maxIter}.0;\n`,
      `    } else {\n`,
      // IQ smooth iteration formula with bailout correction:
      // μ = n - log(log(|z|²)·0.5 / log(B)) / log(d)
      // The /log(B) term normalises the offset so the value is exactly 0
      // when |z|² = B² at escape (no discontinuity at the boundary).
      `        ${id}_iter = ${id}_n - log(log(max(${id}_lz2, 1.0)) * 0.5 / log(${bailout})) / log(${power}.0);\n`,
      `    }\n`,
      `    float ${id}_dist = 0.0;\n`,
      `    float ${id}_ldz2 = dot(${id}_dz, ${id}_dz);\n`,
      `    if (${id}_ldz2 > 0.0 && ${id}_lz2 > 0.0) {\n`,
      `        ${id}_dist = sqrt(${id}_lz2 / ${id}_ldz2) * 0.5 * log(${id}_lz2);\n`,
      `    }\n`,
      // Normalize iter by max_iter before applying color_scale.
      // This makes color_scale zoom-independent: 1.0 = one full palette cycle
      // over the entire [0, max_iter] range regardless of how deep you've zoomed.
      `    float ${id}_t = (${id}_iter / ${maxIter}.0) * ${colorScale} + ${colorOffset};\n`,
      `    vec3 ${id}_color;\n`,
      `    if (${id}_n >= ${maxIter}.0) {\n`,
      `        ${id}_color = vec3(0.0);\n`,
      `    } else {\n`,
      `        ${id}_color = palette(${id}_t, ${pA}, ${pB}, ${pC}, ${pD});\n`,
      `    }\n`,
    );

    // IQ distance estimation shading: darken exterior near the set boundary.
    // dist is in world-space; multiplying by zoom converts to ~pixel-space so
    // the shading strength is consistent regardless of zoom level.
    // dist_shade = 0 disables it entirely (no-op branch).
    if (distShade > 0) {
      code.push(
        `    if (${id}_n < ${maxIter}.0 && ${id}_dist > 0.0) {\n`,
        `        float ${id}_shade = 1.0 - exp(-${f(distShade)} * ${id}_dist * ${zoom});\n`,
        `        ${id}_color *= clamp(${id}_shade, 0.0, 1.0);\n`,
        `    }\n`,
      );
    }

    if (orbitTrap !== 'none') {
      code.push(
        `    float ${id}_trapNorm = clamp(${id}_trap * 2.0, 0.0, 1.0);\n`,
        `    ${id}_color = mix(${id}_color, palette((${id}_trap / ${maxIter}.0) * ${colorScale}, ${pA}, ${pB}, ${pC}, ${pD}), 1.0 - ${id}_trapNorm);\n`,
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
    const glowVal   = p(node.params.glow, 0.004);
    const scale     = p(node.params.scale, 1.0);
    const offX      = p(node.params.offset_x, 0.0);
    const offY      = p(node.params.offset_y, -0.5);
    const animSpeed = p(node.params.anim_speed, 0.0);
    const colorScale  = p(node.params.color_scale, 1.0);
    const colorOffset = p(node.params.color_offset, 0.0);
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

// ─── Newton Fractal ───────────────────────────────────────────────────────────

const NEWTON_EXTRAS = `
vec2 cdiv(vec2 a, vec2 b) {
    float d = dot(b, b);
    return vec2(dot(a, b), a.y*b.x - a.x*b.y) / max(d, 1e-20);
}`;

const NEWTON_GLSL = FRACTAL_GLSL_HELPERS + '\n' + NEWTON_EXTRAS + '\n' + PALETTE_GLSL_FN;

export const NewtonFractalNode: NodeDefinition = {
  type: 'newtonFractal',
  label: 'Newton Fractal',
  category: 'Presets',
  description: 'Newton\'s method root-finding on complex polynomials. Color = which root + convergence speed.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'     },
    time: { type: 'float', label: 'Time'   },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color'      },
    iter:  { type: 'float', label: 'Smooth Iter' },
    root:  { type: 'float', label: 'Root Index'  },
  },
  glslFunction: NEWTON_GLSL,
  defaultParams: {
    polynomial:     'z3-1',
    max_iter:       48,
    zoom:           1.5,
    center_x:       0.0,
    center_y:       0.0,
    palette_preset: '1',
    shade_power:    1.5,
    convergence:    0.001,
  },
  paramDefs: {
    polynomial: { label: 'Polynomial', type: 'select', options: [
      { value: 'z3-1', label: 'z³ - 1' },
      { value: 'z4-1', label: 'z⁴ - 1' },
      { value: 'z5-1', label: 'z⁵ - 1' },
      { value: 'z6-1', label: 'z⁶ - 1' },
    ]},
    max_iter:       { label: 'Max Iterations', type: 'float', min: 8,    max: 128, step: 4     },
    zoom:           { label: 'Zoom',           type: 'float', min: 0.1,  max: 10,  step: 0.05  },
    center_x:       { label: 'Center X',       type: 'float', min: -3,   max: 3,   step: 0.001 },
    center_y:       { label: 'Center Y',       type: 'float', min: -3,   max: 3,   step: 0.001 },
    palette_preset: { label: 'Palette',        type: 'select', options: PALETTE_PRESET_OPTIONS },
    shade_power:    { label: 'Shade Power',    type: 'float', min: 0.5,  max: 4,   step: 0.1   },
    convergence:    { label: 'Convergence ε',  type: 'float', min: 0.0001, max: 0.01, step: 0.0001 },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar  = inputVars.uv   ?? 'vec2(0.0)';

    const poly      = (node.params.polynomial as string) ?? 'z3-1';
    const maxIter   = Math.max(8, Math.round(typeof node.params.max_iter === 'number' ? node.params.max_iter : 48));
    const zoom      = p(node.params.zoom, 1.5);
    const cx        = p(node.params.center_x, 0.0);
    const cy        = p(node.params.center_y, 0.0);
    const shadePow  = p(node.params.shade_power, 1.5);
    const eps       = p(node.params.convergence, 0.001);
    const presIdx   = parseInt((node.params.palette_preset as string) ?? '1', 10);
    const pres      = FRACTAL_PALETTE_PRESETS[Math.min(presIdx, FRACTAL_PALETTE_PRESETS.length - 1)];
    const [pA, pB, pC, pD] = [paletteVec(pres.a), paletteVec(pres.b), paletteVec(pres.c), paletteVec(pres.d)];

    type PolyDef = {
      iterCode: string;
      numRoots: number;
      rootsCode: string;
      rootFn: string;
    };

    function makePolyDef(polyKey: string): PolyDef {
      const z = `${id}_z`;
      switch (polyKey) {
        case 'z4-1': return {
          iterCode: `vec2 ${id}_z2 = cmul(${z}, ${z}); vec2 ${id}_fz = cmul(${id}_z2, ${id}_z2) - vec2(1.0, 0.0); vec2 ${id}_fpz = 4.0 * cmul(${id}_z2, ${z});`,
          numRoots: 4,
          rootsCode: `float ${id}_d0=length(${z}-vec2(1.0,0.0)); float ${id}_d1=length(${z}-vec2(0.0,1.0)); float ${id}_d2=length(${z}-vec2(-1.0,0.0)); float ${id}_d3=length(${z}-vec2(0.0,-1.0));`,
          rootFn: `(${id}_d0<=${id}_d1&&${id}_d0<=${id}_d2&&${id}_d0<=${id}_d3)?0.0:(${id}_d1<=${id}_d2&&${id}_d1<=${id}_d3)?1.0:(${id}_d2<=${id}_d3)?2.0:3.0`,
        };
        case 'z5-1': return {
          iterCode: `vec2 ${id}_z2 = cmul(${z}, ${z}); vec2 ${id}_z4 = cmul(${id}_z2, ${id}_z2); vec2 ${id}_fz = cmul(${id}_z4, ${z}) - vec2(1.0, 0.0); vec2 ${id}_fpz = 5.0 * ${id}_z4;`,
          numRoots: 5,
          rootsCode: `float ${id}_d0=length(${z}-vec2(1.0,0.0)); float ${id}_d1=length(${z}-vec2(0.30902,0.95106)); float ${id}_d2=length(${z}-vec2(-0.80902,0.58779)); float ${id}_d3=length(${z}-vec2(-0.80902,-0.58779)); float ${id}_d4=length(${z}-vec2(0.30902,-0.95106));`,
          rootFn: `(${id}_d0<=${id}_d1&&${id}_d0<=${id}_d2&&${id}_d0<=${id}_d3&&${id}_d0<=${id}_d4)?0.0:(${id}_d1<=${id}_d2&&${id}_d1<=${id}_d3&&${id}_d1<=${id}_d4)?1.0:(${id}_d2<=${id}_d3&&${id}_d2<=${id}_d4)?2.0:(${id}_d3<=${id}_d4)?3.0:4.0`,
        };
        case 'z6-1': return {
          iterCode: `vec2 ${id}_z2 = cmul(${z}, ${z}); vec2 ${id}_z3 = cmul(${id}_z2, ${z}); vec2 ${id}_fz = cmul(${id}_z3, ${id}_z3) - vec2(1.0, 0.0); vec2 ${id}_fpz = 6.0 * cmul(${id}_z3, ${id}_z2);`,
          numRoots: 6,
          rootsCode: `float ${id}_d0=length(${z}-vec2(1.0,0.0)); float ${id}_d1=length(${z}-vec2(0.5,0.86603)); float ${id}_d2=length(${z}-vec2(-0.5,0.86603)); float ${id}_d3=length(${z}-vec2(-1.0,0.0)); float ${id}_d4=length(${z}-vec2(-0.5,-0.86603)); float ${id}_d5=length(${z}-vec2(0.5,-0.86603));`,
          rootFn: `(${id}_d0<=${id}_d1&&${id}_d0<=${id}_d2&&${id}_d0<=${id}_d3&&${id}_d0<=${id}_d4&&${id}_d0<=${id}_d5)?0.0:(${id}_d1<=${id}_d2&&${id}_d1<=${id}_d3&&${id}_d1<=${id}_d4&&${id}_d1<=${id}_d5)?1.0:(${id}_d2<=${id}_d3&&${id}_d2<=${id}_d4&&${id}_d2<=${id}_d5)?2.0:(${id}_d3<=${id}_d4&&${id}_d3<=${id}_d5)?3.0:(${id}_d4<=${id}_d5)?4.0:5.0`,
        };
        default: // z3-1
          return {
            iterCode: `vec2 ${id}_z2 = cmul(${z}, ${z}); vec2 ${id}_fz = cmul(${id}_z2, ${z}) - vec2(1.0, 0.0); vec2 ${id}_fpz = 3.0 * ${id}_z2;`,
            numRoots: 3,
            rootsCode: `float ${id}_d0=length(${z}-vec2(1.0,0.0)); float ${id}_d1=length(${z}-vec2(-0.5,0.86603)); float ${id}_d2=length(${z}-vec2(-0.5,-0.86603));`,
            rootFn: `(${id}_d0<=${id}_d1&&${id}_d0<=${id}_d2)?0.0:(${id}_d1<=${id}_d2)?1.0:2.0`,
          };
      }
    }

    const pd = makePolyDef(poly);
    const nRootsF = f(pd.numRoots);

    let minDExpr: string;
    if (pd.numRoots === 3) {
      minDExpr = `min(${id}_d0, min(${id}_d1, ${id}_d2))`;
    } else if (pd.numRoots === 4) {
      minDExpr = `min(${id}_d0, min(${id}_d1, min(${id}_d2, ${id}_d3)))`;
    } else if (pd.numRoots === 5) {
      minDExpr = `min(${id}_d0, min(${id}_d1, min(${id}_d2, min(${id}_d3, ${id}_d4))))`;
    } else {
      minDExpr = `min(${id}_d0, min(${id}_d1, min(${id}_d2, min(${id}_d3, min(${id}_d4, ${id}_d5)))))`;
    }

    const code = [
      `    // Newton Fractal (${poly})\n`,
      `    vec2 ${id}_z = ${uvVar} / ${zoom} + vec2(${cx}, ${cy});\n`,
      `    float ${id}_t = 0.0;\n`,
      `    float ${id}_rootIdx = 0.0;\n`,
      `    bool ${id}_conv = false;\n`,
      `    for (float ${id}_i = 0.0; ${id}_i < ${maxIter}.0; ${id}_i++) {\n`,
      `        ${pd.iterCode}\n`,
      `        float ${id}_denom = dot(${id}_fpz, ${id}_fpz);\n`,
      `        if (${id}_denom < 1e-20) break;\n`,
      `        ${id}_z -= cdiv(${id}_fz, ${id}_fpz);\n`,
      `        ${pd.rootsCode}\n`,
      `        float ${id}_minD = ${minDExpr};\n`,
      `        if (${id}_minD < ${eps}) {\n`,
      `            ${id}_t = ${id}_i / ${maxIter}.0;\n`,
      `            ${id}_rootIdx = ${pd.rootFn};\n`,
      `            ${id}_conv = true;\n`,
      `            break;\n`,
      `        }\n`,
      `    }\n`,
      `    float ${id}_hue = ${id}_conv ? ${id}_rootIdx / ${nRootsF} : 0.0;\n`,
      `    float ${id}_shade = ${id}_conv ? pow(1.0 - ${id}_t, ${shadePow}) : 0.0;\n`,
      `    vec3 ${id}_palcol = palette(${id}_hue, ${pA}, ${pB}, ${pC}, ${pD});\n`,
      `    vec3 ${id}_color = ${id}_palcol * ${id}_shade;\n`,
      `    float ${id}_iter = ${id}_t;\n`,
      `    float ${id}_root = ${id}_rootIdx / max(${nRootsF} - 1.0, 1.0);\n`,
    ];

    return {
      code: code.join(''),
      outputVars: { color: `${id}_color`, iter: `${id}_iter`, root: `${id}_root` },
    };
  },
};

// ─── Lyapunov Fractal ─────────────────────────────────────────────────────────

export const LyapunovNode: NodeDefinition = {
  type: 'lyapunov',
  label: 'Lyapunov Fractal',
  category: 'Presets',
  description: 'Lyapunov exponent of the logistic map with alternating r-values. Blue=stable, gold=chaotic.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    color:     { type: 'vec3',  label: 'Color'     },
    stability: { type: 'float', label: 'Stability' },
  },
  glslFunction: PALETTE_GLSL_FN,
  defaultParams: {
    sequence:   'AB',
    r_min:      2.0,
    r_max:      4.0,
    warmup:     24,
    iterations: 48,
    lyap_scale: 1.5,
  },
  paramDefs: {
    sequence: { label: 'Sequence', type: 'select', options: [
      { value: 'AB',   label: 'AB (standard)'    },
      { value: 'AABB', label: 'AABB'              },
      { value: 'ABAB', label: 'ABAB'              },
      { value: 'ABBA', label: 'ABBA (symmetric)'  },
      { value: 'AAAB', label: 'AAAB'              },
    ]},
    r_min:      { label: 'r Min',      type: 'float', min: 1.0, max: 3.9, step: 0.01 },
    r_max:      { label: 'r Max',      type: 'float', min: 2.0, max: 4.0, step: 0.01 },
    warmup:     { label: 'Warmup',     type: 'float', min: 0,   max: 100, step: 4    },
    iterations: { label: 'Iterations', type: 'float', min: 16,  max: 256, step: 8    },
    lyap_scale: { label: 'Scale',      type: 'float', min: 0.1, max: 5.0, step: 0.1  },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar = inputVars.uv ?? 'vec2(0.0)';

    const seq       = (node.params.sequence as string) ?? 'AB';
    const rMin      = p(node.params.r_min, 2.0);
    const rMax      = p(node.params.r_max, 4.0);
    const warmup    = Math.max(0, Math.round(typeof node.params.warmup     === 'number' ? node.params.warmup     : 24));
    const iters     = Math.max(4, Math.round(typeof node.params.iterations === 'number' ? node.params.iterations : 48));
    const lyapScale = p(node.params.lyap_scale, 1.5);

    const seqArr = seq.split('').map(c => c === 'A' ? '0.0' : '1.0');
    const seqLen = seqArr.length;

    const totalIters = warmup + iters;

    // Build warmup sequence selection code using ${id}_wi loop variable
    let seqCodeWarmup = '';
    for (let k = 0; k < seqLen; k++) {
      const isFirst = k === 0;
      const condition = `mod(${id}_wi, ${seqLen}.0) < ${k + 1}.0`;
      seqCodeWarmup += `        ${isFirst ? '' : 'else '}if (${condition}) { ${id}_r = ${seqArr[k] === '0.0' ? `${id}_ra` : `${id}_rb`}; }\n`;
    }
    seqCodeWarmup += `        else { ${id}_r = ${id}_ra; }\n`;

    // Build accumulation sequence selection code using ${id}_si loop variable
    let seqCodeAccum = '';
    for (let k = 0; k < seqLen; k++) {
      const isFirst = k === 0;
      const condition = `mod(${id}_si, ${seqLen}.0) < ${k + 1}.0`;
      seqCodeAccum += `        ${isFirst ? '' : 'else '}if (${condition}) { ${id}_r = ${seqArr[k] === '0.0' ? `${id}_ra` : `${id}_rb`}; }\n`;
    }
    seqCodeAccum += `        else { ${id}_r = ${id}_ra; }\n`;

    const code = [
      `    // Lyapunov Fractal (seq=${seq})\n`,
      `    float ${id}_ra = ${uvVar}.x * (${rMax} - ${rMin}) + ${rMin};\n`,
      `    float ${id}_rb = ${uvVar}.y * (${rMax} - ${rMin}) + ${rMin};\n`,
      `    float ${id}_x = 0.5;\n`,
      `    float ${id}_lyap = 0.0;\n`,
      `    float ${id}_r = ${id}_ra;\n`,
      warmup > 0 ? [
        `    for (float ${id}_wi = 0.0; ${id}_wi < ${warmup}.0; ${id}_wi++) {\n`,
        seqCodeWarmup,
        `        ${id}_x = ${id}_r * ${id}_x * (1.0 - ${id}_x);\n`,
        `    }\n`,
      ].join('') : '',
      `    for (float ${id}_si = ${warmup}.0; ${id}_si < ${totalIters}.0; ${id}_si++) {\n`,
      seqCodeAccum,
      `        ${id}_x = ${id}_r * ${id}_x * (1.0 - ${id}_x);\n`,
      `        float ${id}_deriv = abs(${id}_r * (1.0 - 2.0 * ${id}_x));\n`,
      `        ${id}_lyap += log(max(${id}_deriv, 1e-10));\n`,
      `    }\n`,
      `    ${id}_lyap /= ${iters}.0;\n`,
      `    float ${id}_nt = clamp(-${id}_lyap / ${lyapScale}, 0.0, 1.0);\n`,
      `    float ${id}_ct = clamp(${id}_lyap  / ${lyapScale}, 0.0, 1.0);\n`,
      `    vec3  ${id}_stable  = mix(vec3(0.0, 0.0, 0.0), vec3(0.05, 0.25, 1.0), sqrt(${id}_nt));\n`,
      `    vec3  ${id}_chaotic = mix(vec3(0.0, 0.0, 0.0), vec3(1.0, 0.75, 0.0), sqrt(${id}_ct));\n`,
      `    vec3  ${id}_color   = ${id}_lyap < 0.0 ? ${id}_stable : ${id}_chaotic;\n`,
      `    float ${id}_stability = 1.0 / (1.0 + exp(${id}_lyap * 3.0));\n`,
    ];

    return {
      code: code.join(''),
      outputVars: { color: `${id}_color`, stability: `${id}_stability` },
    };
  },
};

// ─── Apollonian Gasket ────────────────────────────────────────────────────────

const APOLLONIAN_GLSL = FRACTAL_GLSL_HELPERS + '\n' + PALETTE_GLSL_FN;

export const ApollonianNode: NodeDefinition = {
  type: 'apollonian',
  label: 'Apollonian Gasket',
  category: 'Presets',
  description: 'Circle-inversion fractal (Apollonian gasket / Kleinian group limit set). Outputs SDF and color.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    color:    { type: 'vec3',  label: 'Color'    },
    distance: { type: 'float', label: 'Distance' },
    orbit:    { type: 'float', label: 'Orbit'    },
  },
  glslFunction: APOLLONIAN_GLSL,
  defaultParams: {
    iterations:     8,
    scale:          1.3,
    zoom:           1.0,
    center_x:       0.0,
    center_y:       0.0,
    palette_preset: '0',
    color_scale:    1.0,
    color_offset:   0.0,
    animate:        0.0,
  },
  paramDefs: {
    iterations:     { label: 'Iterations',   type: 'float', min: 1,   max: 24,  step: 1    },
    scale:          { label: 'Scale',        type: 'float', min: 1.0, max: 3.0, step: 0.01 },
    zoom:           { label: 'Zoom',         type: 'float', min: 0.1, max: 10,  step: 0.05 },
    center_x:       { label: 'Center X',     type: 'float', min: -5,  max: 5,   step: 0.01 },
    center_y:       { label: 'Center Y',     type: 'float', min: -5,  max: 5,   step: 0.01 },
    animate:        { label: 'Animate',      type: 'float', min: 0.0, max: 1.0, step: 0.01 },
    palette_preset: { label: 'Palette',      type: 'select', options: PALETTE_PRESET_OPTIONS },
    color_scale:    { label: 'Color Scale',  type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    color_offset:   { label: 'Color Offset', type: 'float', min: 0.0,  max: 1.0, step: 0.01 },
  },

  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar   = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar = inputVars.time ?? '0.0';

    const iters       = Math.max(1, Math.round(typeof node.params.iterations === 'number' ? node.params.iterations : 8));
    const scale       = p(node.params.scale, 1.3);
    const zoom        = p(node.params.zoom, 1.0);
    const cx          = p(node.params.center_x, 0.0);
    const cy          = p(node.params.center_y, 0.0);
    const animate     = p(node.params.animate, 0.0);
    const colorScale  = p(node.params.color_scale, 1.0);
    const colorOffset = p(node.params.color_offset, 0.0);
    const presIdx     = parseInt((node.params.palette_preset as string) ?? '0', 10);
    const pres        = FRACTAL_PALETTE_PRESETS[Math.min(presIdx, FRACTAL_PALETTE_PRESETS.length - 1)];
    const [pA, pB, pC, pD] = [paletteVec(pres.a), paletteVec(pres.b), paletteVec(pres.c), paletteVec(pres.d)];

    const code = [
      `    // Apollonian Gasket\n`,
      `    vec2 ${id}_p = ${uvVar} / ${zoom} + vec2(${cx}, ${cy});\n`,
      `    ${id}_p += ${animate} * vec2(cos(${timeVar} * 0.3), sin(${timeVar} * 0.2)) * 0.1;\n`,
      `    float ${id}_s = 1.0;\n`,
      `    float ${id}_orbit = 1e10;\n`,
      `    for (float ${id}_i = 0.0; ${id}_i < ${iters}.0; ${id}_i++) {\n`,
      `        ${id}_p = abs(${id}_p);\n`,
      `        ${id}_p -= 0.5;\n`,
      `        float ${id}_r2 = dot(${id}_p, ${id}_p);\n`,
      `        float ${id}_k = ${scale} / max(${id}_r2, 0.001);\n`,
      `        ${id}_p *= ${id}_k;\n`,
      `        ${id}_s *= ${id}_k;\n`,
      `        ${id}_orbit = min(${id}_orbit, length(${id}_p));\n`,
      `    }\n`,
      `    float ${id}_distance = (length(${id}_p) - 0.25) / ${id}_s;\n`,
      `    float ${id}_t = log(${id}_orbit) * ${colorScale} + ${colorOffset};\n`,
      `    vec3  ${id}_color = palette(${id}_t, ${pA}, ${pB}, ${pC}, ${pD});\n`,
      `    ${id}_color *= 1.0 - exp(-${id}_s * 0.01);\n`,
    ];

    return {
      code: code.join(''),
      outputVars: { color: `${id}_color`, distance: `${id}_distance`, orbit: `${id}_orbit` },
    };
  },
};
