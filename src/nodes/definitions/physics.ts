import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

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
}`;

export const ChladniNode: NodeDefinition = {
  type: 'chladni',
  label: 'Chladni Plate',
  category: 'Physics',
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
  },
  glslFunction: CHLADNI_GLSL,
  defaultParams: {
    m:          3.0,
    n:          4.0,
    scale:      1.0,
    line_width: 1.5,
    aa:         1.0,
    turbulence: 0.0,
    turb_speed: 0.5,
    noise_mode: 'smooth',
    brightness: 1.0,
  },
  paramDefs: {
    m:          { label: 'm',           type: 'float',  min: -100, max: 100,  step: 0.001 },
    n:          { label: 'n',           type: 'float',  min: -100, max: 100,  step: 0.001 },
    scale:      { label: 'Scale',       type: 'float',  min: 0.1,  max: 1.5,  step: 0.01  },
    line_width: { label: 'Line Width',  type: 'float',  min: 0.1,  max: 8.0,  step: 0.05  },
    aa:         { label: 'AA Smooth',   type: 'float',  min: 0.0,  max: 4.0,  step: 0.1   },
    turbulence: { label: 'Turbulence',  type: 'float',  min: 0.0,  max: 0.3,  step: 0.001 },
    turb_speed: { label: 'Turb Speed',  type: 'float',  min: 0.0,  max: 3.0,  step: 0.05  },
    noise_mode: {
      label: 'Noise Mode', type: 'select',
      options: [
        { value: 'smooth', label: 'Smooth (drift)' },
        { value: 'swirl',  label: 'Swirl (curl)'   },
        { value: 'jump',   label: 'Jump (stutter)'  },
      ],
    },
    brightness: { label: 'Brightness',  type: 'float',  min: 0.1,  max: 5.0,  step: 0.05  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id         = node.id;
    const uvVar      = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar    = inputVars.time ?? '0.0';
    // m and n can come from wired inputs OR fall back to params
    const mVal       = inputVars.m    ?? f(typeof node.params.m === 'number' ? node.params.m : 3.0);
    const nVal       = inputVars.n    ?? f(typeof node.params.n === 'number' ? node.params.n : 4.0);
    const scale      = f(Math.min(typeof node.params.scale      === 'number' ? node.params.scale      : 1.0, 1.5));
    const lineWidth  = f(typeof node.params.line_width === 'number' ? node.params.line_width : 1.5);
    const aa         = f(typeof node.params.aa         === 'number' ? node.params.aa         : 1.0);
    const turbulence = f(typeof node.params.turbulence === 'number' ? node.params.turbulence : 0.0);
    const turbSpeed  = f(typeof node.params.turb_speed === 'number' ? node.params.turb_speed : 0.5);
    const noiseMode  = typeof node.params.noise_mode === 'string' ? node.params.noise_mode : 'smooth';
    const brightness = f(typeof node.params.brightness === 'number' ? node.params.brightness : 1.0);

    const hasTurb = parseFloat(turbulence) > 0.0;

    // Build noise offset lines based on mode:
    // smooth — gentle continuous drift (regular hash noise, same as before)
    // swirl  — curl-noise: rotate the noise vector 90° to create swirling motion
    // jump   — quantised time so the plate "stutters" rather than flows
    const turbLines = hasTurb ? (() => {
      if (noiseMode === 'jump') {
        // Quantise time to nearest 1/turb_speed second → discrete jumps
        return [
          `    float ${id}_qt = floor(${timeVar} * ${turbSpeed}) / ${turbSpeed};\n`,
          `    float ${id}_nx = fract(sin(dot(${id}_p * 4.0 + ${id}_qt, vec2(127.1, 311.7))) * 43758.5453);\n`,
          `    float ${id}_ny = fract(sin(dot(${id}_p * 4.0 + ${id}_qt + vec2(5.2, 1.3), vec2(269.5, 183.3))) * 43758.5453);\n`,
          `    ${id}_p += (vec2(${id}_nx, ${id}_ny) * 2.0 - 1.0) * ${turbulence};\n`,
        ];
      } else if (noiseMode === 'swirl') {
        // Curl: offset direction is perpendicular to hash gradient → swirl
        return [
          `    float ${id}_nx = fract(sin(dot(${id}_p * 3.0 + ${timeVar} * ${turbSpeed}, vec2(127.1, 311.7))) * 43758.5453);\n`,
          `    float ${id}_ny = fract(sin(dot(${id}_p * 3.0 + ${timeVar} * ${turbSpeed} + vec2(5.2, 1.3), vec2(269.5, 183.3))) * 43758.5453);\n`,
          // Rotate the noise 90° to make it perpendicular (curl-like)
          `    vec2 ${id}_curl = vec2(${id}_ny, -${id}_nx);\n`,
          `    ${id}_p += ${id}_curl * ${turbulence};\n`,
        ];
      } else {
        // smooth — plain drift
        return [
          `    float ${id}_nx = fract(sin(dot(${id}_p * 3.0 + ${timeVar} * ${turbSpeed}, vec2(127.1, 311.7))) * 43758.5453);\n`,
          `    float ${id}_ny = fract(sin(dot(${id}_p * 3.0 + ${timeVar} * ${turbSpeed} + vec2(5.2, 1.3), vec2(269.5, 183.3))) * 43758.5453);\n`,
          `    ${id}_p += (vec2(${id}_nx, ${id}_ny) * 2.0 - 1.0) * ${turbulence};\n`,
        ];
      }
    })() : [];

    const code = [
      `    vec2  ${id}_p = ${uvVar} * ${scale};\n`,
      ...turbLines,
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
      },
    };
  },
};

// ─── Electron Orbital Node (2D) ───────────────────────────────────────────────
//
// Renders the 2D probability density |ψ|² of hydrogen-like orbitals.
// Anti-aliased with fwidth() to prevent moiré at high n values.
//
// slice_z: take a cross-section through the 3D wavefunction by evaluating at
//   (x, y, slice_z) instead of (x, y, 0). Sliding this gives 2D cuts through
//   the full 3D orbital shape — for p/d/f orbitals this reveals the inner rings.

const ORBITAL_GLSL = `
// Associated Laguerre polynomial L_p^alpha(x), exact for p = 0..5
float laguerre(int p, float alpha, float x) {
    if (p <= 0) return 1.0;
    if (p == 1) return 1.0 + alpha - x;
    float Lprev2 = 1.0;
    float Lprev1 = 1.0 + alpha - x;
    float Lcur = 0.0;
    for (int k = 2; k <= 5; k++) {
        if (k > p) break;
        float kf = float(k);
        Lcur = ((2.0*kf - 1.0 + alpha - x)*Lprev1 - (kf - 1.0 + alpha)*Lprev2) / kf;
        Lprev2 = Lprev1;
        Lprev1 = Lcur;
    }
    return Lcur;
}

// Real spherical harmonic Y_l^m evaluated at (cosTheta, sinTheta, phi)
float realSH2d(int l, int m, float cosT, float sinT, float phi) {
    if (l == 0) return 0.2821;
    if (l == 1) {
        if (m ==  0) return 0.4886 * cosT;
        if (m ==  1) return 0.4886 * sinT * cos(phi);
        if (m == -1) return 0.4886 * sinT * sin(phi);
    }
    if (l == 2) {
        if (m ==  0) return 0.3153 * (3.0*cosT*cosT - 1.0);
        if (m ==  1) return 1.0925 * sinT * cosT * cos(phi);
        if (m == -1) return 1.0925 * sinT * cosT * sin(phi);
        if (m ==  2) return 0.5462 * sinT*sinT * cos(2.0*phi);
        if (m == -2) return 0.5462 * sinT*sinT * sin(2.0*phi);
    }
    if (l == 3) {
        if (m ==  0) return 0.3731 * cosT*(5.0*cosT*cosT - 3.0);
        if (m ==  1) return 0.4572 * sinT*(5.0*cosT*cosT - 1.0)*cos(phi);
        if (m == -1) return 0.4572 * sinT*(5.0*cosT*cosT - 1.0)*sin(phi);
        if (m ==  2) return 1.4457 * sinT*sinT*cosT*cos(2.0*phi);
        if (m == -2) return 1.4457 * sinT*sinT*cosT*sin(2.0*phi);
        if (m ==  3) return 0.5900 * sinT*sinT*sinT*cos(3.0*phi);
        if (m == -3) return 0.5900 * sinT*sinT*sinT*sin(3.0*phi);
    }
    // l == 4 (all m)
    float c2=cosT*cosT; float s2=sinT*sinT;
    if (m ==  0) return 0.1057*(35.0*c2*c2-30.0*c2+3.0);
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

// Full hydrogen wavefunction at 3D point (x, y, z)
float orbitalPsi3(vec3 p, float n, float l, float mq, float a0) {
    float r    = length(p);
    float cosT = (r < 0.00001) ? 1.0 : p.z / r;
    float sinT = sqrt(max(1.0 - cosT*cosT, 0.0));
    float phi  = atan(p.y, p.x);
    float rho  = 2.0 * r / max(n * a0, 0.0001);
    int   lInt = int(clamp(l, 0.0, 4.0));
    int   mInt = int(clamp(mq, -4.0, 4.0));
    int   lagp = min(max(int(n) - lInt - 1, 0), 5);
    float R    = pow(max(rho, 0.00001), l) * exp(-rho * 0.5)
                 * laguerre(lagp, 2.0*l + 1.0, rho);
    float Y    = realSH2d(lInt, mInt, cosT, sinT, phi);
    return R * Y;
}`;

export const ElectronOrbitalNode: NodeDefinition = {
  type: 'electronOrbital',
  label: 'Electron Orbital',
  category: 'Physics',
  description: '2D cross-section of a hydrogen-like electron orbital. slice_z takes cross-sections through the 3D shape — slide it to reveal inner rings. n=shell (1–6), l=subshell (0=s..4=g), m=magnetic. Gamma < 1 reveals faint outer rings.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    density:  { type: 'float', label: 'Density |ψ|²' },
    psi:      { type: 'float', label: 'Raw ψ'         },
    color:    { type: 'vec3',  label: 'Color'          },
  },
  glslFunction: ORBITAL_GLSL,
  defaultParams: {
    n:          2.0,
    l:          1.0,
    m_q:        0.0,
    a0:         0.05,
    scale:      3.0,
    slice_z:    0.0,
    brightness: 3.0,
    gamma:      0.5,
    aa:         1.0,
    edge_soft:  0.8,
    turbulence: 0.0,
    turb_speed: 0.3,
  },
  paramDefs: {
    n:          { label: 'n (shell)',    type: 'float', min: 1,    max: 6,    step: 1     },
    l:          { label: 'l (subshell)', type: 'float', min: 0,    max: 5,    step: 1     },
    m_q:        { label: 'm (magnetic)', type: 'float', min: -5,   max: 5,    step: 1     },
    a0:         { label: 'Bohr radius',  type: 'float', min: -0.2, max: 0.2,  step: 0.001 },
    scale:      { label: 'Scale',        type: 'float', min: 0.5,  max: 12.0, step: 0.05  },
    slice_z:    { label: 'Slice Z',      type: 'float', min: -3.0, max: 3.0,  step: 0.01  },
    brightness: { label: 'Brightness',    type: 'float', min: 0.1,  max: 20.0, step: 0.1   },
    gamma:      { label: 'Gamma',         type: 'float', min: 0.05, max: 3.0,  step: 0.05  },
    aa:         { label: 'AA Smooth',     type: 'float', min: 0.0,  max: 4.0,  step: 0.1   },
    edge_soft:  { label: 'Edge Softness', type: 'float', min: 0.0,  max: 3.0,  step: 0.05  },
    turbulence: { label: 'Turbulence',    type: 'float', min: 0.0,  max: 0.2,  step: 0.005 },
    turb_speed: { label: 'Turb Speed',    type: 'float', min: 0.0,  max: 3.0,  step: 0.05  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id         = node.id;
    const uvVar      = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar    = inputVars.time ?? '0.0';
    const n          = f(typeof node.params.n          === 'number' ? node.params.n          : 2.0);
    const l          = f(typeof node.params.l          === 'number' ? node.params.l          : 1.0);
    const mq         = f(typeof node.params.m_q        === 'number' ? node.params.m_q        : 0.0);
    const a0Raw      = typeof node.params.a0           === 'number' ? node.params.a0         : 0.05;
    // a0 must not be exactly 0 — clamp away from zero
    const a0         = f(Math.abs(a0Raw) < 0.001 ? 0.001 : a0Raw);
    const scale      = f(typeof node.params.scale      === 'number' ? node.params.scale      : 3.0);
    const sliceZ     = f(typeof node.params.slice_z    === 'number' ? node.params.slice_z    : 0.0);
    const brightness = f(typeof node.params.brightness === 'number' ? node.params.brightness : 3.0);
    const gamma      = f(Math.max(typeof node.params.gamma === 'number' ? node.params.gamma : 0.5, 0.05));
    const aa         = f(typeof node.params.aa         === 'number' ? node.params.aa         : 1.0);
    const edgeSoft   = f(typeof node.params.edge_soft  === 'number' ? node.params.edge_soft  : 0.8);
    const turbulence = f(typeof node.params.turbulence === 'number' ? node.params.turbulence : 0.0);
    const turbSpeed  = f(typeof node.params.turb_speed === 'number' ? node.params.turb_speed : 0.3);

    const hasTurb   = parseFloat(turbulence) > 0.0;
    const hasAA     = parseFloat(aa) > 0.0;
    const hasEdge   = parseFloat(edgeSoft) > 0.0;

    const code = [
      // Build 3D sample point: (uv.x, uv.y, slice_z) all scaled
      `    vec2  ${id}_uv2 = ${uvVar} * ${scale};\n`,
      `    vec3  ${id}_p   = vec3(${id}_uv2.x, ${id}_uv2.y, ${sliceZ});\n`,

      ...(hasTurb ? [
        `    float ${id}_tx = fract(sin(dot(${id}_p.xy * 2.0 + ${timeVar} * ${turbSpeed}, vec2(127.1, 311.7))) * 43758.5453);\n`,
        `    float ${id}_ty = fract(sin(dot(${id}_p.xy * 2.0 + ${timeVar} * ${turbSpeed} + vec2(3.7, 8.1), vec2(269.5, 183.3))) * 43758.5453);\n`,
        `    ${id}_p.xy += (vec2(${id}_tx, ${id}_ty) * 2.0 - 1.0) * ${turbulence};\n`,
      ] : []),

      `    float ${id}_psi     = orbitalPsi3(${id}_p, ${n}, ${l}, ${mq}, ${a0});\n`,
      `    float ${id}_density = ${id}_psi * ${id}_psi;\n`,

      ...(hasAA ? [
        `    float ${id}_fw     = max(fwidth(${id}_density), 1e-6);\n`,
        `    float ${id}_densAA = ${id}_density / (${id}_density + ${id}_fw * ${aa});\n`,
      ] : [
        `    float ${id}_densAA = ${id}_density;\n`,
      ]),

      // Radial gradient falloff: denser at centre, disperses toward edges
      // Edge noise gives irregular/particle-like boundary instead of hard circle
      ...(hasEdge ? [
        `    float ${id}_r     = length(${id}_uv2);\n`,
        `    float ${id}_enoise = fract(sin(dot(${id}_p.xy, vec2(127.1, 311.7))) * 43758.5453);\n`,
        `    float ${id}_efade = exp(-${id}_r * ${edgeSoft} * (1.0 + ${id}_enoise * 0.6));\n`,
        `    ${id}_densAA *= ${id}_efade;\n`,
      ] : []),

      `    float ${id}_vis   = pow(clamp(${id}_densAA, 0.0, 1.0), ${gamma}) * ${brightness};\n`,
      `    ${id}_vis         = ${id}_vis / (${id}_vis + 0.5);\n`,  // soft Reinhard — no hard clip

      // Subtle warm/cool tint by lobe sign
      `    float ${id}_sign  = sign(${id}_psi);\n`,
      `    vec3  ${id}_tint  = vec3(1.0 + ${id}_sign * 0.08, 1.0, 1.0 - ${id}_sign * 0.08);\n`,
      `    vec3  ${id}_color = ${id}_vis * ${id}_tint;\n`,
    ].join('');

    return {
      code,
      outputVars: {
        density: `${id}_density`,
        psi:     `${id}_psi`,
        color:   `${id}_color`,
      },
    };
  },
};
