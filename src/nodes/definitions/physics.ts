import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f, p, withParamSockets } from './helpers';

// Deterministic per-node offset for "off the plate" sentinel values. Using a
// shared constant (e.g. plain 4.0) for every masked node is dangerous: if two
// masked outputs are later combined (Subtract, Weighted Average — the exact
// manual-composition path this file encourages), identical sentinels cancel
// to exactly 0 outside the plate, which Field to Lines reads as "on the
// line" — a spurious line traced around the whole boundary. Hashing the
// node's id into the sentinel keeps every instance's off-plate value unique.
function plateMaskSentinel(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return f(4.0 + (h % 1000) / 100);
}

// ─── Chladni Node ─────────────────────────────────────────────────────────────
//
// Renders Chladni plate nodal lines as a smooth density field.
// Formula: cos(n·π·x)·cos(m·π·y) − cos(m·π·x)·cos(n·π·y)
//
// m and n are continuous floats in [-100, 100] — non-integer values produce
// quasi-periodic, fractal-like interference patterns.
// Both m and n also have wirable socket inputs so other nodes can drive them.

const CHLADNI_GLSL = `
float chladni(vec2 p, float m, float n) {
    return cos(n * 3.14159265 * p.x) * cos(m * 3.14159265 * p.y)
         - cos(m * 3.14159265 * p.x) * cos(n * 3.14159265 * p.y);
}
// ── 2D noise helpers for Chladni turbulence ──────────────────────────────────
float ch2_hash1(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
}
float ch2_valueNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(
        mix(ch2_hash1(i+vec2(0,0)), ch2_hash1(i+vec2(1,0)), u.x),
        mix(ch2_hash1(i+vec2(0,1)), ch2_hash1(i+vec2(1,1)), u.x),
        u.y);
}
float ch2_voronoi(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float minD = 10.0;
    for (int ch2_y = -1; ch2_y <= 1; ch2_y++) {
        for (int ch2_x = -1; ch2_x <= 1; ch2_x++) {
            vec2 nb = vec2(float(ch2_x), float(ch2_y));
            vec2 pt = vec2(ch2_hash1(i+nb), ch2_hash1(i+nb+0.1));
            vec2 df = nb + pt - f;
            float d = dot(df, df);
            if (d < minD) minD = d;
        }
    }
    return sqrt(minD);
}
float ch2_fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int ch2_i = 0; ch2_i < 4; ch2_i++) {
        v += a * ch2_valueNoise(p);
        p = p * 2.1 + vec2(5.2, 1.3); a *= 0.5;
    }
    return v;
}
// Returns a 2D noise offset. mode: 0=hash, 1=value, 2=voronoi, 3=fbm, 4=swirl, 5=jump
vec2 ch2_noise2(vec2 p, float t, float spd, int mode) {
    if (mode == 1) {
        return vec2(ch2_valueNoise(p*3.0+t*spd), ch2_valueNoise(p*3.0+t*spd+vec2(7.3,2.1)))*2.0-1.0;
    }
    if (mode == 2) {
        return vec2(ch2_voronoi(p*3.0+t*spd), ch2_voronoi(p*3.0+t*spd+vec2(4.1,1.7)))*2.0-1.0;
    }
    if (mode == 3) {
        return vec2(ch2_fbm(p*3.0+t*spd), ch2_fbm(p*3.0+t*spd+vec2(5.2,1.3)))*2.0-1.0;
    }
    if (mode == 4) {
        // Smooth curl via finite differences of value noise — gradual speed modulation
        float eps = 0.08;
        vec2 q = p * 3.0 + t * spd;
        float dy = ch2_valueNoise(q + vec2(eps, 0.0)) - ch2_valueNoise(q - vec2(eps, 0.0));
        float dx = ch2_valueNoise(q + vec2(0.0, eps)) - ch2_valueNoise(q - vec2(0.0, eps));
        return vec2(dy, -dx) * (1.0 / eps) * 0.5;
    }
    if (mode == 5) {
        float qt = floor(t*spd)/spd;
        float nx = fract(sin(dot(p*4.0+qt, vec2(127.1,311.7)))*43758.5453);
        float ny = fract(sin(dot(p*4.0+qt+vec2(5.2,1.3), vec2(269.5,183.3)))*43758.5453);
        return (vec2(nx,ny)*2.0-1.0);
    }
    // mode 0: per-pixel hash — grainy particle look.
    // x and y use fully different dot-product coefficients so they're uncorrelated
    // (shared seed was the cause of the original diagonal-streak artifact).
    vec2 q = p * 8.0 + t * spd;
    float hx = fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453);
    float hy = fract(sin(dot(q, vec2(269.5, 183.3))) * 43758.5453);
    return vec2(hx, hy) * 2.0 - 1.0;
}`;

/** Retired: Chladni Plate is Chladni with Mix −1, Aspect Fill, Bounded Infinite and Wobble on (aliases.ts). Not registered. */
export const ChladniNode: NodeDefinition = withParamSockets({
  type: 'chladni',
  label: 'Chladni Plate',
  category: 'Science',
  description: 'Chladni plate resonance pattern. m and n are wirable float inputs — wire a Sin or Expr node to animate the mode. Anti-aliased via fwidth().',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
    m:    { type: 'float', label: 'm'    },
    n:    { type: 'float', label: 'n'    },
  },
  outputs: {
    density: { type: 'float', label: 'Density'  },
    field:   { type: 'float', label: 'Raw Field' },
    color:   { type: 'vec3',  label: 'Color'     },
    uv:      { type: 'vec2',  label: 'UV (scaled)' },
  },
  glslFunction: CHLADNI_GLSL,
  defaultParams: {
    m:          0.75,
    n:          1.0,
    scale:      1.0,
    line_width: 1.5,
    aa:         1.0,
    turbulence: 0.0,
    turb_speed: 0.5,
    noise_mode: 'smooth',
    brightness: 1.0,
  },
  paramDefs: {
    m:          { label: 'm',           type: 'float',  min: -2, max: 2,  step: 0.001 },
    n:          { label: 'n',           type: 'float',  min: -2, max: 2,  step: 0.001 },
    scale:      { label: 'Scale',       type: 'float',  min: 0.1,  max: 1.5,  step: 0.01  },
    line_width: { label: 'Line Width',  type: 'float',  min: 0.1,  max: 8.0,  step: 0.05  },
    aa:         { label: 'AA Smooth',   type: 'float',  min: 0.0,  max: 4.0,  step: 0.1   },
    turbulence: { label: 'Turbulence',  type: 'float',  min: 0.0,  max: 0.3,  step: 0.001 },
    turb_speed: { label: 'Turb Speed',  type: 'float',  min: 0.0,  max: 3.0,  step: 0.05  },
    noise_mode: {
      label: 'Noise Mode', type: 'select',
      options: [
        { value: 'smooth',   label: 'Hash (drift)'     },
        { value: 'value',    label: 'Value (smooth)'   },
        { value: 'voronoi',  label: 'Voronoi (clumpy)' },
        { value: 'fbm',      label: 'fBm (fractal)'    },
        { value: 'swirl',    label: 'Swirl (curl)'     },
        { value: 'jump',     label: 'Jump (stutter)'   },
      ],
    },
    brightness: { label: 'Brightness',  type: 'float',  min: 0.1,  max: 5.0,  step: 0.05  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id         = node.id;
    const uvVar      = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar    = inputVars.time ?? '0.0';
    // m and n can come from wired inputs OR fall back to params
    const mVal       = inputVars.m    ?? p(node.params.m, 3.0);
    const nVal       = inputVars.n    ?? p(node.params.n, 4.0);
    const scale      = p(node.params.scale, 1.0);
    const lineWidth  = p(node.params.line_width, 1.5);
    const aa         = p(node.params.aa, 1.0);
    const turbulence = p(node.params.turbulence, 0.0);
    const turbSpeed  = p(node.params.turb_speed, 0.5);
    const noiseMode  = typeof node.params.noise_mode === 'string' ? node.params.noise_mode : 'smooth';
    const brightness = p(node.params.brightness, 1.0);

    // Map noise_mode string to int for ch2_noise2()
    // 0=hash(smooth), 1=value, 2=voronoi, 3=fbm, 4=swirl, 5=jump
    const noiseModeInt2d = noiseMode === 'value' ? 1 : noiseMode === 'voronoi' ? 2 : noiseMode === 'fbm' ? 3 : noiseMode === 'swirl' ? 4 : noiseMode === 'jump' ? 5 : 0;

    const code = [
      `    vec2  ${id}_p = ${uvVar} * ${scale};\n`,
      // Turbulence: always emitted — multiply by 0 is a no-op when disabled
      `    ${id}_p += ch2_noise2(${id}_p, ${timeVar}, ${turbSpeed}, ${noiseModeInt2d}) * ${turbulence};\n`,
      // Use runtime variables for m and n so wired inputs work
      `    float ${id}_m     = ${mVal};\n`,
      `    float ${id}_n     = ${nVal};\n`,
      `    float ${id}_field = chladni(${id}_p, ${id}_m, ${id}_n);\n`,
      // Anti-aliased line density via fwidth
      `    float ${id}_fw      = fwidth(${id}_field);\n`,
      `    float ${id}_thresh  = ${id}_fw * max(${aa}, 0.01);\n`,
      `    float ${id}_density = 1.0 - smoothstep(0.0, ${id}_thresh * ${lineWidth}, abs(${id}_field));\n`,
      `    vec3  ${id}_color   = vec3(${id}_density * ${brightness});\n`,
    ].join('');

    return {
      code,
      outputVars: {
        density: `${id}_density`,
        field:   `${id}_field`,
        color:   `${id}_color`,
        uv:      `${id}_p`,
      },
    };
  },
}, ['scale', 'line_width', 'aa', 'turbulence', 'turb_speed', 'brightness']);

// ─── Wave Term ────────────────────────────────────────────────────────────────
//
// Single standing-wave interference term: cos(n·π·x)·cos(m·π·y).
// This is the atomic building block the Chladni node hardcodes internally
// (as two of these subtracted). Exposing it as its own node lets you compose
// multi-mode superpositions by hand — wire 2+ Wave Terms into a Subtract or
// Weighted Average node, then into Field to Lines to draw the result.
//
// Also useful standalone for moiré / plasma-style interference textures that
// have nothing to do with Chladni plates.

const WAVE_TERM_GLSL = `
float waveTerm(vec2 p, float n, float m) {
    // PI is already defined in the shader preamble as #define PI 3.1415926538
    return cos(n * PI * p.x) * cos(m * PI * p.y);
}`;

/** Retired: Wave Term is Chladni with Mix 0 (aliases.ts). Not registered. */
export const WaveTermNode: NodeDefinition = {
  type: 'waveTerm',
  label: 'Wave Term',
  category: 'Science',
  description: 'A single 2D standing-wave interference term: cos(n·π·x)·cos(m·π·y). The building block behind Chladni patterns — combine several (Subtract for the classic 2-term mix, Weighted Average for multi-term superposition) then feed the result into Field to Lines. Also useful on its own for moiré and plasma-style textures.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV'    },
    n:     { type: 'float', label: 'n'     },
    m:     { type: 'float', label: 'm'     },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
    uv:    { type: 'vec2',  label: 'UV (scaled)' },
  },
  glslFunction: WAVE_TERM_GLSL,
  defaultParams: { n: 3.0, m: 4.0, scale: 1.0, aspect: 'square', bounded: 'plate' },
  paramDefs: {
    n:     { label: 'n',     type: 'float', min: -2,  max: 2,   step: 0.01 },
    m:     { label: 'm',     type: 'float', min: -2,  max: 2,   step: 0.01 },
    scale: { label: 'Scale', type: 'float', min: 0.1, max: 4.0, step: 0.01, hint: 'With Bounded on, this is the term\'s physical size (bigger Scale = smaller patch on screen). n/m only change the pattern inside that fixed edge, not the edge itself.' },
    aspect: {
      label: 'Aspect', type: 'select',
      hint: 'Square: n and m always mean the same number of repetitions per axis, so changing them reads as a uniform zoom. Fill: uses the raw viewport-stretched UV.',
      options: [
        { value: 'square', label: 'Square (uniform zoom)' },
        { value: 'fill',   label: 'Fill viewport (stretches)' },
      ],
    },
    bounded: {
      label: 'Bounded', type: 'select',
      hint: 'Plate: masks everything outside a fixed-size edge (set by Scale), so changing n/m only reorganizes the pattern inside that fixed boundary instead of reading as a zoom. Infinite: no edge, tiles forever (the old behavior).',
      options: [
        { value: 'plate',    label: 'Plate (fixed edge)' },
        { value: 'infinite', label: 'Infinite (tiles forever)' },
      ],
    },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvVar   = inputVars.uv    ?? 'vec2(0.0)';
    const nVal    = inputVars.n     ?? p(node.params.n, 3.0);
    const mVal    = inputVars.m     ?? p(node.params.m, 4.0);
    const scale   = inputVars.scale ?? p(node.params.scale, 1.0);
    const aspectMode = typeof node.params.aspect === 'string' ? node.params.aspect : 'square';
    const bounded = typeof node.params.bounded === 'string' ? node.params.bounded : 'plate';

    // Same fix as Chladni Field: undo the global aspect-correct x-stretch so
    // n/m always mean "repeats per axis" regardless of viewport shape.
    const baseUv = aspectMode === 'square'
      ? `vec2(${uvVar}.x / (u_resolution.x / u_resolution.y), ${uvVar}.y)`
      : uvVar;

    const code = [
      `    vec2  ${id}_p     = ${baseUv} * ${scale};\n`,
      `    float ${id}_n     = ${nVal};\n`,
      `    float ${id}_m     = ${mVal};\n`,
      `    float ${id}_value = waveTerm(${id}_p, ${id}_n, ${id}_m);\n`,
    ];
    if (bounded === 'plate') {
      // Same fixed-edge idea as Chladni Field: |p|>1 is off the plate, masked
      // out — so n/m only reorganize the pattern inside a boundary that stays
      // put, instead of reading as the camera zooming.
      code.push(`    if (abs(${id}_p.x) > 1.0 || abs(${id}_p.y) > 1.0) { ${id}_value = ${plateMaskSentinel(id)}; }\n`);
    }

    return {
      code: code.join(''),
      outputVars: { value: `${id}_value`, uv: `${id}_p` },
    };
  },
};

// ─── Chladni Superposition ────────────────────────────────────────────────────
//
// The "in-between" node: starts as a single mode (n1,m1), same as Chladni
// Field with mix=0. Raising Terms progressively reveals more (n,m,weight)
// groups via showWhen — the "Add Term" workflow the UI asked for, without
// needing to wire up separate Wave Term + combiner nodes by hand. Each
// higher term comes with a sensible default (n,m,weight) already populated
// so bumping Terms immediately looks like something, not zeros.
//
// Outputs a raw field, same contract as Chladni Field — pipe into Field to
// Lines to draw it.

const CHLADNI_SUPERPOSITION_TERM_DEFAULTS: Record<number, { n: number; m: number; w: number }> = {
  2: { n: 3.0, m: 8.0, w: 0.5  },
  3: { n: 7.0, m: 2.0, w: 0.3  },
  4: { n: 5.0, m: 5.0, w: 0.2  },
  5: { n: 2.0, m: 9.0, w: 0.15 },
  6: { n: 8.0, m: 3.0, w: 0.1  },
};

/** Retired: Chladni Superposition is Chladni with Mix 0 (aliases.ts). Not registered. */
export const ChladniSuperpositionNode: NodeDefinition = withParamSockets({
  type: 'chladniSuperposition',
  label: 'Chladni Superposition',
  category: 'Science',
  description: 'Self-contained multi-term Chladni field. Starts as a single mode (n1,m1) — wirable, so you can animate or Quantize-snap it; raise Terms to progressively add more (n,m,weight) modes stacked on top — the "Add Term" workflow without wiring separate Wave Term nodes by hand. Outputs a raw field; pipe into Field to Lines to draw it.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV'    },
    n1:    { type: 'float', label: 'n1'    },
    m1:    { type: 'float', label: 'm1'    },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: {
    field: { type: 'float', label: 'Field' },
    uv:    { type: 'vec2',  label: 'UV (scaled)' },
  },
  glslFunction: WAVE_TERM_GLSL,
  defaultParams: {
    scale: 1.0,
    geometry: 'square',
    aspect: 'square',
    bounded: 'plate',
    terms: '1',
    n1: 6.0, m1: 4.0,
    n2: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[2].n, m2: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[2].m, w2: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[2].w,
    n3: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[3].n, m3: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[3].m, w3: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[3].w,
    n4: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[4].n, m4: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[4].m, w4: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[4].w,
    n5: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[5].n, m5: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[5].m, w5: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[5].w,
    n6: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[6].n, m6: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[6].m, w6: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[6].w,
  },
  paramDefs: {
    scale:    { label: 'Scale',    type: 'float', min: 0.1, max: 4.0, step: 0.01, hint: 'With Bounded on, this is the plate\'s physical size (bigger Scale = smaller plate on screen). Mode numbers only change the pattern inside that fixed edge, not the edge itself.' },
    geometry: {
      label: 'Geometry', type: 'select',
      options: [
        { value: 'square',   label: 'Square Plate'   },
        { value: 'circular', label: 'Circular Plate' },
      ],
    },
    aspect: {
      label: 'Aspect', type: 'select',
      hint: 'Square: mode counts always mean the same number of repetitions per axis, so changing them reads as a uniform zoom — matches a real plate. Fill: uses the raw viewport-stretched UV.',
      options: [
        { value: 'square', label: 'Square (uniform zoom)' },
        { value: 'fill',   label: 'Fill viewport (stretches)' },
      ],
    },
    bounded: {
      label: 'Bounded', type: 'select',
      hint: 'Plate: draws a fixed-size edge (set by Scale) and masks everything outside it, so raising Terms/mode numbers only reorganizes the pattern inside that fixed boundary — like a real plate at a fixed size, not a camera zooming. Infinite: no edge, tiles forever (the old behavior).',
      options: [
        { value: 'plate',    label: 'Plate (fixed edge)' },
        { value: 'infinite', label: 'Infinite (tiles forever)' },
      ],
    },
    terms: {
      label: 'Terms', type: 'select', hint: 'Raise this to reveal more (n,m,weight) mode groups below — "Add Term".',
      options: [
        { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
        { value: '4', label: '4' }, { value: '5', label: '5' }, { value: '6', label: '6' },
      ],
    },
    n1: { label: 'n1', type: 'float', min: -2, max: 2, step: 0.01 },
    m1: { label: 'm1', type: 'float', min: -2, max: 2, step: 0.01 },
    n2: { label: 'n2', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['2','3','4','5','6'] } },
    m2: { label: 'm2', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['2','3','4','5','6'] } },
    w2: { label: 'Weight 2', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['2','3','4','5','6'] } },
    n3: { label: 'n3', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['3','4','5','6'] } },
    m3: { label: 'm3', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['3','4','5','6'] } },
    w3: { label: 'Weight 3', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['3','4','5','6'] } },
    n4: { label: 'n4', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['4','5','6'] } },
    m4: { label: 'm4', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['4','5','6'] } },
    w4: { label: 'Weight 4', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['4','5','6'] } },
    n5: { label: 'n5', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['5','6'] } },
    m5: { label: 'm5', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['5','6'] } },
    w5: { label: 'Weight 5', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['5','6'] } },
    n6: { label: 'n6', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['6'] } },
    m6: { label: 'm6', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['6'] } },
    w6: { label: 'Weight 6', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'terms', value: ['6'] } },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv ?? 'vec2(0.0)';
    const scale    = inputVars.scale ?? p(node.params.scale, 1.0);
    const geometry = typeof node.params.geometry === 'string' ? node.params.geometry : 'square';
    const aspectMode = typeof node.params.aspect === 'string' ? node.params.aspect : 'square';
    const bounded  = typeof node.params.bounded === 'string' ? node.params.bounded : 'plate';
    const termsRaw = parseInt(typeof node.params.terms === 'string' ? node.params.terms : '1', 10);
    const termsCount = Math.max(1, Math.min(6, Number.isFinite(termsRaw) ? termsRaw : 1));

    const n1 = inputVars.n1 ?? p(node.params.n1, 6.0);
    const m1 = inputVars.m1 ?? p(node.params.m1, 4.0);

    // See Chladni Field for why this matters: undoing the global aspect-correct
    // x-stretch so n/m always mean "repeats per axis" regardless of viewport shape.
    const baseUv = aspectMode === 'square'
      ? `vec2(${uvVar}.x / (u_resolution.x / u_resolution.y), ${uvVar}.y)`
      : uvVar;
    const code: string[] = [`    vec2  ${id}_p = ${baseUv} * ${scale};\n`];
    let sumExpr: string;

    if (geometry === 'circular') {
      // Same per-term formula as Chladni Field's circular branch, summed:
      // f(r,θ) = Σ w_i · cos(n_i·θ)·cos(m_i·π·r), masked to the unit disc.
      code.push(
        `    float ${id}_r     = length(${id}_p);\n`,
        `    float ${id}_theta = atan(${id}_p.y, ${id}_p.x);\n`,
      );
      sumExpr = `cos(${n1} * ${id}_theta) * cos(${m1} * PI * ${id}_r)`;
      for (let i = 2; i <= termsCount; i++) {
        const fallback = CHLADNI_SUPERPOSITION_TERM_DEFAULTS[i];
        const nVal = p(node.params[`n${i}`], fallback.n);
        const mVal = p(node.params[`m${i}`], fallback.m);
        const wVal = p(node.params[`w${i}`], fallback.w);
        sumExpr += ` + ${wVal} * cos(${nVal} * ${id}_theta) * cos(${mVal} * PI * ${id}_r)`;
      }
      code.push(`    float ${id}_field = ${sumExpr};\n`);
      if (bounded === 'plate') {
        code.push(`    if (${id}_r > 1.0) { ${id}_field = ${plateMaskSentinel(id)}; }\n`);
      }
    } else {
      sumExpr = `waveTerm(${id}_p, ${n1}, ${m1})`;
      for (let i = 2; i <= termsCount; i++) {
        const fallback = CHLADNI_SUPERPOSITION_TERM_DEFAULTS[i];
        const nVal = p(node.params[`n${i}`], fallback.n);
        const mVal = p(node.params[`m${i}`], fallback.m);
        const wVal = p(node.params[`w${i}`], fallback.w);
        sumExpr += ` + ${wVal} * waveTerm(${id}_p, ${nVal}, ${mVal})`;
      }
      code.push(`    float ${id}_field = ${sumExpr};\n`);
      if (bounded === 'plate') {
        code.push(`    if (abs(${id}_p.x) > 1.0 || abs(${id}_p.y) > 1.0) { ${id}_field = ${plateMaskSentinel(id)}; }\n`);
      }
    }

    return {
      code: code.join(''),
      outputVars: { field: `${id}_field`, uv: `${id}_p` },
    };
  },
}, ['n2', 'm2', 'w2', 'n3', 'm3', 'w3', 'n4', 'm4', 'w4', 'n5', 'm5', 'w5', 'n6', 'm6', 'w6']);

// ─── Chladni Mode Frequency ────────────────────────────────────────────────────
//
// Real Chladni plates are driven by a single frequency, not independent n/m
// mode numbers — sweeping that one frequency crosses many resonances, giving
// huge pattern variety from one knob. This approximates that: n = Frequency,
// m = Frequency × an irrational-ish ratio picked by Seed. Because the ratio
// never simplifies to a clean fraction, n and m never lock into a repeating
// relationship as Frequency sweeps — the pattern keeps evolving instead of
// cycling through a handful of shapes. A different Seed picks a differently-
// evolving family. Wire n/m into Chladni Field's or Chladni Superposition's
// n/m sockets.

const CHLADNI_MODE_FREQ_GLSL = `
float chladniSeedRatio(float seed) {
    float f = fract(sin(seed * 12.9898) * 43758.5453);
    return 1.15 + f * 1.55;
}
float chladniSeedPhase(float seed) {
    float f = fract(sin(seed * 78.233) * 43758.5453);
    return f * 5.0;
}`;

export const ChladniModeFreqNode: NodeDefinition = {
  type: 'chladniModeFreq',
  label: 'Chladni Mode Frequency',
  aliases: ['Plate frequency', 'Resonance frequency'],
  category: 'Science',
  description: 'Single-knob Chladni mode selection — approximates how a real plate is driven by one frequency instead of independent n/m mode numbers. n = Frequency, m = Frequency × an irrational-ish ratio picked by Seed, so sweeping Frequency alone drifts continuously through a rich, non-repeating family of patterns instead of jumping between a handful of discrete shapes. A different Seed picks a differently-evolving family. Wire n and m into a Chladni node\'s n and m.',
  inputs: {
    frequency: { type: 'float', label: 'Frequency' },
    seed:      { type: 'float', label: 'Seed' },
  },
  outputs: {
    n: { type: 'float', label: 'n' },
    m: { type: 'float', label: 'm' },
  },
  glslFunction: CHLADNI_MODE_FREQ_GLSL,
  defaultParams: { frequency: 5.0, seed: 0.0 },
  paramDefs: {
    frequency: { label: 'Frequency', type: 'float', min: -20, max: 20, step: 0.01 },
    seed:      { label: 'Seed',      type: 'float', min: 0,   max: 50, step: 1, hint: 'Picks a different n:m ratio — same Frequency sweep, differently-evolving pattern family.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const freqVal = inputVars.frequency ?? p(node.params.frequency, 5.0);
    const seedVal = inputVars.seed      ?? p(node.params.seed, 0.0);

    const code = [
      `    float ${id}_ratio = chladniSeedRatio(${seedVal});\n`,
      `    float ${id}_phase = chladniSeedPhase(${seedVal});\n`,
      `    float ${id}_n     = ${freqVal};\n`,
      `    float ${id}_m     = ${freqVal} * ${id}_ratio + ${id}_phase;\n`,
    ].join('');

    return {
      code,
      outputVars: { n: `${id}_n`, m: `${id}_m` },
    };
  },
};

// ─── Chladni (one node: Plate, Field, Superposition and Wave Term) ─────────────
//
// The one Chladni node (docs/node-retirements.md). Its type id stays 'chladniField', so graphs saved with Chladni
// Field load unchanged; Chladni Plate, Chladni Superposition and Wave Term are aliases onto it (aliases.ts):
//
//   field = waveTerm(n, m) + Mix · waveTerm(m, n) + Σ (Terms 2…6) Weight_i · waveTerm(n_i, m_i)   (square plate)
//   field = cos(n·θ + Mix·π)·cos(m·π·r) + Σ Weight_i · cos(n_i·θ)·cos(m_i·π·r)                   (circular plate)
//
//  - Mix −1 is the classic Chladni plate (cos nπx cos mπy − cos mπx cos nπy, the old Plate); Mix 0 one term (Wave Term).
//  - Wobble (the old Plate's turbulence) pushes the point by a noise before the field is read; off, no noise code.
//  - Lines is the field's zero set drawn anti-aliased (fwidth), Line Width wide: the old Plate's Density.
// The old generators below this one are not registered; they stay so the migration tests can run the old code.

/** Line Width / AA / Brightness / Turbulence settings, shared by Lines and Wobble. */
const NOISE_MODES = [
  { value: 'smooth',   label: 'Hash (drift)'     },
  { value: 'value',    label: 'Value (smooth)'   },
  { value: 'voronoi',  label: 'Voronoi (clumpy)' },
  { value: 'fbm',      label: 'fBm (fractal)'    },
  { value: 'swirl',    label: 'Swirl (curl)'     },
  { value: 'jump',     label: 'Jump (stutter)'   },
];
const ON_WOBBLE = { param: 'wobble', value: 'on' };
const TERM_KEYS = ['n2', 'm2', 'w2', 'n3', 'm3', 'w3', 'n4', 'm4', 'w4', 'n5', 'm5', 'w5', 'n6', 'm6', 'w6'];
const termsFrom = (i: number) => ['2', '3', '4', '5', '6'].filter(t => Number(t) >= i);

export const ChladniFieldNode: NodeDefinition = withParamSockets({
  type: 'chladniField',
  label: 'Chladni',
  category: 'Science',
  aliases: ['Chladni Plate', 'Chladni Field', 'Chladni Superposition', 'Wave Term', 'Cymatics', 'Standing wave', 'Nodal lines', 'Vibrating plate', 'Resonance'],
  description: 'The pattern of a vibrating plate: n and m are the mode numbers, Mix blends in the swapped mode (−1 is the classic plate, 0 a single wave, +1 the X / diamond), and Terms adds up to five more modes with their own weights. Geometry picks a square or round plate. Field is the raw value (0 on the still lines); Lines draws those lines; Wobble shakes the point with a noise first. Chladni Mode Frequency drives n and m from one Frequency knob.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV'    },
    time:  { type: 'float', label: 'Time', hint: 'Moves the Wobble noise.' },
    n:     { type: 'float', label: 'n'     },
    m:     { type: 'float', label: 'm'     },
    mix:   { type: 'float', label: 'Mix'   },
    scale: { type: 'float', label: 'Scale' },
  },
  socketsOnDemand: { time: ['wobble'] },
  outputs: {
    field: { type: 'float', label: 'Field', hint: 'The plate\'s raw value: 0 on the still (nodal) lines. Into Field to Lines, a palette or a mask.' },
    lines: { type: 'float', label: 'Lines', hint: 'The still lines drawn: 1 on a line, 0 between, anti-aliased (Line Width, AA).' },
    color: { type: 'vec3',  label: 'Color', hint: 'Lines × Brightness, as a grey colour.' },
    uv:    { type: 'vec2',  label: 'UV (scaled)' },
  },
  glslFunction: WAVE_TERM_GLSL,
  glslFunctionsFor: node => (node.params.wobble === 'on' ? [CHLADNI_GLSL] : []),
  defaultParams: {
    n: 6.0, m: 4.0, mix: 1.0, scale: 1.0, geometry: 'square', aspect: 'square', bounded: 'plate', terms: '1',
    n2: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[2].n, m2: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[2].m, w2: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[2].w,
    n3: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[3].n, m3: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[3].m, w3: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[3].w,
    n4: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[4].n, m4: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[4].m, w4: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[4].w,
    n5: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[5].n, m5: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[5].m, w5: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[5].w,
    n6: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[6].n, m6: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[6].m, w6: CHLADNI_SUPERPOSITION_TERM_DEFAULTS[6].w,
    line_width: 1.5, aa: 1.0, brightness: 1.0,
    wobble: 'off', turbulence: 0.0, turb_speed: 0.5, noise_mode: 'smooth',
  },
  paramDefs: {
    n:        { label: 'n',        type: 'float', min: -2,  max: 2,   step: 0.01, hint: 'The first mode number: how many times the wave repeats across (x), or round the circle.' },
    m:        { label: 'm',        type: 'float', min: -2,  max: 2,   step: 0.01, hint: 'The second mode number: up the plate (y), or out from the middle.' },
    mix:      { label: 'Mix',      type: 'float', min: -2,  max: 2,   step: 0.01, hint: 'Square plate: how much of the swapped (m, n) mode is added. −1 is the classic Chladni plate, 0 a plain grid, +1 the X / diamond. Round plate: a turn between the two matching modes.' },
    scale:    { label: 'Scale',    type: 'float', min: 0.1, max: 4.0, step: 0.01, hint: 'With Bounded on, the plate\'s size (bigger Scale = smaller plate on screen). n and m only change the pattern inside that fixed edge.' },
    geometry: {
      label: 'Geometry', type: 'select',
      options: [
        { value: 'square',   label: 'Square Plate'   },
        { value: 'circular', label: 'Circular Plate' },
      ],
    },
    aspect: {
      label: 'Aspect', type: 'select',
      hint: 'Square: n and m mean the same number of repeats on both axes, like a real plate. Fill: the picture\'s stretched UV, so the counts differ per axis on a wide picture.',
      options: [
        { value: 'square', label: 'Square (uniform zoom)' },
        { value: 'fill',   label: 'Fill viewport (stretches)' },
      ],
    },
    bounded: {
      label: 'Bounded', type: 'select',
      hint: 'Plate: an edge of fixed size (set by Scale), nothing drawn outside, so changing n and m reorganises the pattern inside it instead of zooming. Infinite: no edge, the pattern tiles forever.',
      options: [
        { value: 'plate',    label: 'Plate (fixed edge)' },
        { value: 'infinite', label: 'Infinite (tiles forever)' },
      ],
    },
    terms: {
      label: 'Terms', type: 'select', section: 'More modes', hint: 'How many modes are added up: 1 is n, m (and Mix); each more brings its own n, m and Weight.',
      options: [
        { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
        { value: '4', label: '4' }, { value: '5', label: '5' }, { value: '6', label: '6' },
      ],
    },
    n2: { label: 'n2', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(2) } },
    m2: { label: 'm2', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(2) } },
    w2: { label: 'Weight 2', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(2) } },
    n3: { label: 'n3', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(3) } },
    m3: { label: 'm3', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(3) } },
    w3: { label: 'Weight 3', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(3) } },
    n4: { label: 'n4', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(4) } },
    m4: { label: 'm4', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(4) } },
    w4: { label: 'Weight 4', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(4) } },
    n5: { label: 'n5', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(5) } },
    m5: { label: 'm5', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(5) } },
    w5: { label: 'Weight 5', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(5) } },
    n6: { label: 'n6', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(6) } },
    m6: { label: 'm6', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(6) } },
    w6: { label: 'Weight 6', type: 'float', min: -2, max: 2, step: 0.01, section: 'More modes', showWhen: { param: 'terms', value: termsFrom(6) } },
    line_width: { label: 'Line Width', type: 'float', min: 0.1, max: 8.0, step: 0.05, section: 'Lines', hint: 'How wide the Lines output draws the still lines, in pixels (roughly).' },
    aa:         { label: 'AA Smooth',  type: 'float', min: 0.0, max: 4.0, step: 0.1,  section: 'Lines', hint: 'How soft the lines\' edges are.' },
    brightness: { label: 'Brightness', type: 'float', min: 0.1, max: 5.0, step: 0.05, section: 'Lines', hint: 'Color is Lines × Brightness.' },
    wobble: {
      label: 'Wobble', type: 'select', section: 'Wobble', hint: 'On: the point is shaken by a noise before the plate is read, so the lines wander and fray (Time moves it).',
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
    },
    turbulence: { label: 'Turbulence', type: 'float', min: 0.0, max: 0.3, step: 0.001, section: 'Wobble', showWhen: ON_WOBBLE, hint: 'How far the noise pushes the point.' },
    turb_speed: { label: 'Turb Speed', type: 'float', min: 0.0, max: 3.0, step: 0.05,  section: 'Wobble', showWhen: ON_WOBBLE, hint: 'How fast the noise moves with Time.' },
    noise_mode: { label: 'Noise Mode', type: 'select', section: 'Wobble', showWhen: ON_WOBBLE, options: NOISE_MODES },
  },
  sectionSummary: (section, params) => {
    if (section === 'More modes') return params.terms && params.terms !== '1' ? `${params.terms} modes` : 'one mode';
    if (section === 'Wobble') return params.wobble === 'on' ? 'on' : 'off';
    return undefined;
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv   ?? 'vec2(0.0)';
    const nVal     = inputVars.n    ?? p(node.params.n, 6.0);
    const mVal     = inputVars.m    ?? p(node.params.m, 4.0);
    const mixVal   = inputVars.mix  ?? p(node.params.mix, 1.0);
    const scale    = inputVars.scale ?? p(node.params.scale, 1.0);
    const geometry = typeof node.params.geometry === 'string' ? node.params.geometry : 'square';
    const aspectMode = typeof node.params.aspect === 'string' ? node.params.aspect : 'square';
    const bounded  = typeof node.params.bounded === 'string' ? node.params.bounded : 'plate';
    const termsRaw = parseInt(typeof node.params.terms === 'string' ? node.params.terms : '1', 10);
    const termsCount = Math.max(1, Math.min(6, Number.isFinite(termsRaw) ? termsRaw : 1));
    const term = (i: number) => {
      const fb = CHLADNI_SUPERPOSITION_TERM_DEFAULTS[i];
      return { n: p(node.params[`n${i}`], fb.n), m: p(node.params[`m${i}`], fb.m), w: p(node.params[`w${i}`], fb.w) };
    };

    // The global UV is aspect-corrected (x *= resolution.x/resolution.y) so shapes don't skew; for a periodic
    // pattern that means n and m stop meaning "the same repeat count per axis" unless the canvas is square.
    // Square (default) undoes that x-stretch, so changing n and m reads as a uniform zoom, like a real plate.
    const baseUv = aspectMode === 'square'
      ? `vec2(${uvVar}.x / (u_resolution.x / u_resolution.y), ${uvVar}.y)`
      : uvVar;
    const code: string[] = [`    vec2  ${id}_p = ${baseUv} * ${scale};\n`];
    if (node.params.wobble === 'on') {
      const noiseMode = typeof node.params.noise_mode === 'string' ? node.params.noise_mode : 'smooth';
      // ch2_noise2's modes: 0 hash (smooth), 1 value, 2 voronoi, 3 fbm, 4 swirl, 5 jump.
      const mode = noiseMode === 'value' ? 1 : noiseMode === 'voronoi' ? 2 : noiseMode === 'fbm' ? 3 : noiseMode === 'swirl' ? 4 : noiseMode === 'jump' ? 5 : 0;
      code.push(`    ${id}_p += ch2_noise2(${id}_p, ${inputVars.time ?? '0.0'}, ${p(node.params.turb_speed, 0.5)}, ${mode}) * ${p(node.params.turbulence, 0.0)};\n`);
    }

    if (geometry === 'circular') {
      // f(r,θ) = cos(n·θ + Mix·π)·cos(m·π·r) + Σ w_i·cos(n_i·θ)·cos(m_i·π·r), masked to the unit disc.
      let sum = `cos(${nVal} * ${id}_theta + ${mixVal} * PI) * cos(${mVal} * PI * ${id}_r)`;
      for (let i = 2; i <= termsCount; i++) { const t = term(i); sum += ` + ${t.w} * cos(${t.n} * ${id}_theta) * cos(${t.m} * PI * ${id}_r)`; }
      code.push(
        `    float ${id}_r     = length(${id}_p);\n`,
        `    float ${id}_theta = atan(${id}_p.y, ${id}_p.x);\n`,
        `    float ${id}_field = ${sum};\n`,
      );
      // A fixed disc edge: r > 1 is off the plate, so raising n and m reorganises the pattern inside it.
      if (bounded === 'plate') code.push(`    if (${id}_r > 1.0) { ${id}_field = ${plateMaskSentinel(id)}; }\n`);
    } else {
      let sum = `waveTerm(${id}_p, ${nVal}, ${mVal}) + ${mixVal} * waveTerm(${id}_p, ${mVal}, ${nVal})`;
      for (let i = 2; i <= termsCount; i++) { const t = term(i); sum += ` + ${t.w} * waveTerm(${id}_p, ${t.n}, ${t.m})`; }
      code.push(`    float ${id}_field = ${sum};\n`);
      // The same idea, square edge: |p.x| > 1 or |p.y| > 1 is off the plate.
      if (bounded === 'plate') code.push(`    if (abs(${id}_p.x) > 1.0 || abs(${id}_p.y) > 1.0) { ${id}_field = ${plateMaskSentinel(id)}; }\n`);
    }
    // Lines: the zero set, anti-aliased with fwidth (the old Plate's Density); only when wired.
    const lines = `(1.0 - smoothstep(0.0, fwidth(${id}_field) * max(${p(node.params.aa, 1.0)}, 0.01) * ${p(node.params.line_width, 1.5)}, abs(${id}_field)))`;
    return {
      code: code.join(''),
      outputVars: { field: `${id}_field`, lines, color: `vec3(${lines} * ${p(node.params.brightness, 1.0)})`, uv: `${id}_p` },
    };
  },
}, [...TERM_KEYS, 'line_width', 'aa', 'brightness', 'turbulence', 'turb_speed']);
