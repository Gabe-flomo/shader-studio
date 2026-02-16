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
        float nx = fract(sin(dot(p*3.0+t*spd,       vec2(127.1,311.7)))*43758.5453);
        float ny = fract(sin(dot(p*3.0+t*spd+vec2(5.2,1.3), vec2(269.5,183.3)))*43758.5453);
        return vec2(ny, -nx); // curl: perpendicular → swirl
    }
    if (mode == 5) {
        float qt = floor(t*spd)/spd;
        float nx = fract(sin(dot(p*4.0+qt, vec2(127.1,311.7)))*43758.5453);
        float ny = fract(sin(dot(p*4.0+qt+vec2(5.2,1.3), vec2(269.5,183.3)))*43758.5453);
        return (vec2(nx,ny)*2.0-1.0);
    }
    // mode 0: classic hash drift
    float nx = fract(sin(dot(p*3.0+t*spd,       vec2(127.1,311.7)))*43758.5453);
    float ny = fract(sin(dot(p*3.0+t*spd+vec2(5.2,1.3), vec2(269.5,183.3)))*43758.5453);
    return (vec2(nx,ny)*2.0-1.0);
}`;

export const ChladniNode: NodeDefinition = {
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
    // Map noise_mode string to int for ch2_noise2()
    // 0=hash(smooth), 1=value, 2=voronoi, 3=fbm, 4=swirl, 5=jump
    const noiseModeInt2d = noiseMode === 'value' ? 1 : noiseMode === 'voronoi' ? 2 : noiseMode === 'fbm' ? 3 : noiseMode === 'swirl' ? 4 : noiseMode === 'jump' ? 5 : 0;
    const turbLines = hasTurb ? [
      `    ${id}_p += ch2_noise2(${id}_p, ${timeVar}, ${turbSpeed}, ${noiseModeInt2d}) * ${turbulence};\n`,
    ] : [];

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
        uv:      `${id}_p`,
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
  category: 'Science',
  description: '2D cross-section of a hydrogen-like electron orbital. slice_z takes cross-sections through the 3D shape — slide it to reveal inner rings. n=shell (1–6), l=subshell (0=s..4=g), m=magnetic. Gamma < 1 reveals faint outer rings.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV'   },
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    density:  { type: 'float', label: 'Density |ψ|²' },
    psi:      { type: 'float', label: 'Raw ψ'         },
    color:    { type: 'vec3',  label: 'Color'          },
    uv:       { type: 'vec2',  label: 'UV (scaled)'    },
  },
  glslFunction: ORBITAL_GLSL,
  defaultParams: {
    n:          2.0,
    l:          1.0,
    m_q:        1.0,  // 2px: Y_1^1 = sinT*cos(phi) — visible in the z=0 equatorial slice
    a0:         0.094, // sized so peak radius ≈ 0.5 screen units at scale 3
    scale:      3.0,
    slice_z:    0.0,
    brightness: 5.0,
    gamma:      0.45,
    aa:         1.0,
    edge_soft:  0.6,
    turbulence: 0.0,
    turb_speed: 0.3,
    noise_mode: 'hash',
  },
  paramDefs: {
    n:          { label: 'n (shell)',    type: 'float', min: 1,    max: 6,    step: 1     },
    l:          { label: 'l (subshell)', type: 'float', min: 0,    max: 5,    step: 1     },
    m_q:        { label: 'm (magnetic)', type: 'float', min: -5,   max: 5,    step: 1     },
    a0:         { label: 'Bohr radius',  type: 'float', min: 0.001, max: 0.3,  step: 0.001 },
    scale:      { label: 'Scale',        type: 'float', min: 0.5,  max: 12.0, step: 0.05  },
    slice_z:    { label: 'Slice Z',      type: 'float', min: -3.0, max: 3.0,  step: 0.01  },
    brightness: { label: 'Brightness',    type: 'float', min: 0.1,  max: 20.0, step: 0.1   },
    gamma:      { label: 'Gamma',         type: 'float', min: 0.05, max: 3.0,  step: 0.05  },
    aa:         { label: 'AA Smooth',     type: 'float', min: 0.0,  max: 4.0,  step: 0.1   },
    edge_soft:  { label: 'Edge Softness', type: 'float', min: 0.0,  max: 3.0,  step: 0.05  },
    turbulence: { label: 'Turbulence',    type: 'float', min: 0.0,  max: 0.2,  step: 0.005 },
    turb_speed: { label: 'Turb Speed',    type: 'float', min: 0.0,  max: 3.0,  step: 0.05  },
    noise_mode: {
      label: 'Noise Algorithm', type: 'select',
      options: [
        { value: 'hash',    label: 'Hash (classic)'   },
        { value: 'value',   label: 'Value (smooth)'   },
        { value: 'voronoi', label: 'Voronoi (clumpy)' },
        { value: 'fbm',     label: 'fBm (fractal)'    },
        { value: 'swirl',   label: 'Swirl (curl)'     },
      ],
    },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id         = node.id;
    const uvVar      = inputVars.uv   ?? 'vec2(0.0)';
    const timeVar    = inputVars.time ?? '0.0';
    const n          = f(typeof node.params.n          === 'number' ? node.params.n          : 2.0);
    const l          = f(typeof node.params.l          === 'number' ? node.params.l          : 1.0);
    const mq         = f(typeof node.params.m_q        === 'number' ? node.params.m_q        : 0.0);
    const a0Raw      = typeof node.params.a0           === 'number' ? node.params.a0         : 0.05;
    // a0 must be strictly positive — a zero or negative Bohr radius makes rho negative
    // which collapses pow(rho, l) to 0 for non-integer l → all black
    const a0         = f(Math.max(Math.abs(a0Raw), 0.001));
    const scale      = f(typeof node.params.scale      === 'number' ? node.params.scale      : 3.0);
    const sliceZ     = f(typeof node.params.slice_z    === 'number' ? node.params.slice_z    : 0.0);
    const brightness = f(typeof node.params.brightness === 'number' ? node.params.brightness : 3.0);
    const gamma      = f(Math.max(typeof node.params.gamma === 'number' ? node.params.gamma : 0.5, 0.05));
    const aa         = f(typeof node.params.aa         === 'number' ? node.params.aa         : 1.0);
    const edgeSoft   = f(typeof node.params.edge_soft  === 'number' ? node.params.edge_soft  : 0.8);
    const turbulence = f(typeof node.params.turbulence === 'number' ? node.params.turbulence : 0.0);
    const turbSpeed  = f(typeof node.params.turb_speed === 'number' ? node.params.turb_speed : 0.3);
    const noiseMode  = typeof node.params.noise_mode === 'string' ? node.params.noise_mode : 'hash';

    const hasTurb   = parseFloat(turbulence) > 0.0;
    const hasAA     = parseFloat(aa) > 0.0;
    const hasEdge   = parseFloat(edgeSoft) > 0.0;
    // Map noise_mode to int for ch2_noise2(): 0=hash, 1=value, 2=voronoi, 3=fbm, 4=swirl
    const noiseModeIntOrb = noiseMode === 'value' ? 1 : noiseMode === 'voronoi' ? 2 : noiseMode === 'fbm' ? 3 : noiseMode === 'swirl' ? 4 : 0;

    const code = [
      // Build 3D sample point: (uv.x, uv.y, slice_z) all scaled
      `    vec2  ${id}_uv2 = ${uvVar} * ${scale};\n`,
      `    vec3  ${id}_p   = vec3(${id}_uv2.x, ${id}_uv2.y, ${sliceZ});\n`,

      ...(hasTurb ? [
        `    ${id}_p.xy += ch2_noise2(${id}_p.xy * 2.0, ${timeVar}, ${turbSpeed}, ${noiseModeIntOrb}) * ${turbulence};\n`,
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
        uv:      `${id}_uv2`,
      },
    };
  },
};

// ─── Chladni 3D (Volumetric Nodal Surfaces) ───────────────────────────────────
//
// Extends the 2D Chladni formula to 3D:
//   f(x,y,z) = cos(n·π·x)·cos(m·π·y)·cos(l·π·z)
//            - cos(m·π·x)·cos(l·π·y)·cos(n·π·z)
//
// Raymarches a unit cube, accumulates glow wherever f≈0 (nodal surfaces).
// Lit by surface normal for depth. Camera orbits automatically or can be
// driven by orbit_angle input. l adds a 3rd mode axis for full 3D symmetry.

const CHLADNI3D_GLSL_FN = `
float chladni3d(vec3 p, float m, float n, float l) {
    // PI is already defined in the shader preamble as #define PI 3.1415926538
    return cos(n*PI*p.x)*cos(m*PI*p.y)*cos(l*PI*p.z)
         - cos(m*PI*p.x)*cos(l*PI*p.y)*cos(n*PI*p.z);
}
vec3 chladni3dNormal(vec3 p, float m, float n, float l) {
    float e = 0.01;
    return normalize(vec3(
        chladni3d(p+vec3(e,0,0),m,n,l) - chladni3d(p-vec3(e,0,0),m,n,l),
        chladni3d(p+vec3(0,e,0),m,n,l) - chladni3d(p-vec3(0,e,0),m,n,l),
        chladni3d(p+vec3(0,0,e),m,n,l) - chladni3d(p-vec3(0,0,e),m,n,l)
    ));
}
mat3 chladni3dCam(vec3 ro, vec3 ta) {
    vec3 cw = normalize(ta - ro);
    vec3 cu = normalize(cross(cw, vec3(0.0, 1.0, 0.0)));
    vec3 cv = cross(cu, cw);
    return mat3(cu, cv, cw);
}`;

export const Chladni3DNode: NodeDefinition = {
  type: 'chladni3d',
  label: 'Chladni 3D',
  category: 'Science',
  description: 'Volumetric 3D Chladni nodal surfaces. Raymarches a cube and renders thick, opaque surfaces wherever f=0. m, n, l are wirable — animate them for morphing resonance.',
  inputs: {
    uv:          { type: 'vec2',  label: 'UV'          },
    time:        { type: 'float', label: 'Time'         },
    m:           { type: 'float', label: 'm'            },
    n:           { type: 'float', label: 'n'            },
    l:           { type: 'float', label: 'l'            },
    orbit_angle: { type: 'float', label: 'Orbit Angle'  },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color'       },
    alpha: { type: 'float', label: 'Alpha'        },
    depth: { type: 'float', label: 'Depth'        },
    uv:    { type: 'vec2',  label: 'UV (pass-through)' },
  },
  glslFunction: CHLADNI3D_GLSL_FN,
  defaultParams: {
    m:           0.75,
    n:           1.0,
    l:           0.5,
    scale:       1.2,
    steps:       80,
    surface_width: 0.08,
    opacity:     0.92,
    orbit_speed: 0.3,
    orbit_pitch: 0.4,
    cam_dist:    2.2,
    color_mode:  'depth',
    bg_dark:     0.04,
  },
  paramDefs: {
    m:             { label: 'm',             type: 'float',  min: -2,  max: 2,   step: 0.01  },
    n:             { label: 'n',             type: 'float',  min: -2,  max: 2,   step: 0.01  },
    l:             { label: 'l',             type: 'float',  min: -2,  max: 2,   step: 0.01  },
    scale:         { label: 'Scale',         type: 'float',  min: 0.5,  max: 3.0,  step: 0.05  },
    steps:         { label: 'March Steps',   type: 'float',  min: 30,   max: 160,  step: 8     },
    surface_width: { label: 'Surface Width', type: 'float',  min: 0.01, max: 0.4,  step: 0.005 },
    opacity:       { label: 'Opacity',       type: 'float',  min: 0.0,  max: 1.0,  step: 0.02  },
    orbit_speed:   { label: 'Orbit Speed',   type: 'float',  min: -2.0, max: 2.0,  step: 0.05  },
    orbit_pitch:   { label: 'Orbit Pitch',   type: 'float',  min: -1.5, max: 1.5,  step: 0.05  },
    cam_dist:      { label: 'Cam Dist',      type: 'float',  min: 1.0,  max: 5.0,  step: 0.1   },
    bg_dark:       { label: 'BG Darkness',   type: 'float',  min: 0.0,  max: 0.3,  step: 0.01  },
    color_mode:    {
      label: 'Color Mode', type: 'select',
      options: [
        { value: 'depth',    label: 'Depth tinted'  },
        { value: 'normal',   label: 'Normal map'    },
        { value: 'white',    label: 'White glow'    },
        { value: 'rainbow',  label: 'Rainbow phase' },
      ],
    },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv          = inputVars.uv          ?? 'vec2(0.0)';
    const timeVar     = inputVars.time        ?? '0.0';
    const mVal        = inputVars.m           ?? f(typeof node.params.m     === 'number' ? node.params.m     : 3.0);
    const nVal        = inputVars.n           ?? f(typeof node.params.n     === 'number' ? node.params.n     : 4.0);
    const lVal        = inputVars.l           ?? f(typeof node.params.l     === 'number' ? node.params.l     : 2.0);
    const scale       = f(typeof node.params.scale          === 'number' ? node.params.scale          : 1.2);
    const steps       = Math.round(typeof node.params.steps === 'number' ? node.params.steps           : 80);
    const surfWidth   = f(typeof node.params.surface_width  === 'number' ? node.params.surface_width   : 0.08);
    const opacity     = f(typeof node.params.opacity        === 'number' ? node.params.opacity         : 0.92);
    const orbitSpeed  = f(typeof node.params.orbit_speed    === 'number' ? node.params.orbit_speed     : 0.3);
    const orbitPitch  = f(typeof node.params.orbit_pitch    === 'number' ? node.params.orbit_pitch     : 0.4);
    const camDist     = f(typeof node.params.cam_dist       === 'number' ? node.params.cam_dist        : 2.2);
    const bgDark      = f(typeof node.params.bg_dark        === 'number' ? node.params.bg_dark         : 0.04);
    const colorMode   = typeof node.params.color_mode === 'string' ? node.params.color_mode : 'depth';

    const hasOrbitInput = !!inputVars.orbit_angle;
    const angleExpr = hasOrbitInput
      ? inputVars.orbit_angle!
      : `${timeVar} * ${orbitSpeed}`;

    // Build surface colour from accumulated normal / depth / phase
    // These are weighted-average values from the compositing loop below.
    let surfColorExpr: string;
    if (colorMode === 'white') {
      surfColorExpr = `vec3(1.0)`;
    } else if (colorMode === 'normal') {
      surfColorExpr = `(${id}_norm * 0.5 + 0.5)`;
    } else if (colorMode === 'rainbow') {
      surfColorExpr = `(0.5 + 0.5*sin(vec3(0.0,2.094,4.189) + ${id}_phase * 6.28318))`;
    } else {
      // depth — blue-to-white gradient by normalised depth
      surfColorExpr = `mix(vec3(0.08,0.18,0.55), vec3(0.85,0.95,1.0), ${id}_depth / 4.0)`;
    }

    // Front-to-back alpha compositing:
    //   at each step we compute a surface density (smoothstep slab around f=0)
    //   and composite it over what we've seen so far.
    //   This gives opaque, layered sheets — much more visible than pure additive glow.
    const code = `
    // ── Chladni3D: camera ────────────────────────────────────────────────────
    float ${id}_ang   = ${angleExpr};
    float ${id}_cp    = cos(${orbitPitch}), ${id}_sp = sin(${orbitPitch});
    vec3  ${id}_ro    = vec3(cos(${id}_ang)*${id}_cp, ${id}_sp, sin(${id}_ang)*${id}_cp) * ${camDist};
    mat3  ${id}_cm    = chladni3dCam(${id}_ro, vec3(0.0));
    vec3  ${id}_rd    = normalize(${id}_cm * vec3(${uv}.x, ${uv}.y * (u_resolution.y / u_resolution.x), 1.5));

    // ── Raymarch (front-to-back compositing) ─────────────────────────────────
    float ${id}_m      = ${mVal};
    float ${id}_n      = ${nVal};
    float ${id}_l      = ${lVal};
    float ${id}_tFar   = 4.0;
    float ${id}_dt     = ${id}_tFar / float(${steps});
    // Accumulated colour + alpha (front-to-back)
    vec3  ${id}_accC   = vec3(0.0);
    float ${id}_accA   = 0.0;
    // Weighted accumulators for depth, normal, phase (for color modes)
    float ${id}_depth  = 0.0;
    vec3  ${id}_norm   = vec3(0.0);
    float ${id}_phase  = 0.0;
    float ${id}_wSum   = 0.0;
    // Per-step temps — declared here for GLSL ES 1.00 compliance
    float ${id}_t      = 0.0;
    float ${id}_fv     = 0.0;
    float ${id}_slab   = 0.0;
    float ${id}_stepA  = 0.0;
    float ${id}_contrib = 0.0;
    vec3  ${id}_ps     = vec3(0.0);
    vec3  ${id}_nn     = vec3(0.0);
    for (int ${id}_i = 0; ${id}_i < ${steps}; ${id}_i++) {
        if (${id}_accA > 0.99) { break; } // early exit when opaque
        ${id}_t  = float(${id}_i) * ${id}_dt;
        ${id}_ps = ${id}_ro + ${id}_rd * ${id}_t;
        // Skip samples outside the cube
        if (any(greaterThan(abs(${id}_ps), vec3(${scale})))) { continue; }
        ${id}_fv   = chladni3d(${id}_ps * (1.0/${scale}), ${id}_m, ${id}_n, ${id}_l);
        // Smooth slab density: 1 at f=0, falls to 0 over surface_width
        ${id}_slab = smoothstep(${surfWidth}, 0.0, abs(${id}_fv));
        ${id}_stepA = ${id}_slab * ${opacity};
        // Front-to-back: contrib = stepAlpha * (1 - accumulated)
        ${id}_contrib = ${id}_stepA * (1.0 - ${id}_accA);
        ${id}_accA   += ${id}_contrib;
        // Accumulate weighted metadata for surface colouring
        ${id}_nn       = chladni3dNormal(${id}_ps * (1.0/${scale}), ${id}_m, ${id}_n, ${id}_l);
        ${id}_norm    += ${id}_nn  * ${id}_contrib;
        ${id}_depth   += ${id}_t   * ${id}_contrib;
        ${id}_phase   += (${id}_ps.x + ${id}_ps.y + ${id}_ps.z) * ${id}_contrib;
        ${id}_wSum    += ${id}_contrib;
    }
    // Normalise weighted accumulators
    if (${id}_wSum > 0.001) {
        ${id}_norm  = normalize(${id}_norm);
        ${id}_depth = ${id}_depth / ${id}_wSum;
        ${id}_phase = ${id}_phase / ${id}_wSum;
    }

    // ── Colour ───────────────────────────────────────────────────────────────
    // Surface colour (from mode) × alpha, over a faint dark background
    vec3  ${id}_surfC  = ${surfColorExpr};
    // Simple diffuse shading from a fixed light direction
    vec3  ${id}_light  = normalize(vec3(1.0, 1.5, 2.0));
    float ${id}_diff   = clamp(dot(${id}_norm, ${id}_light), 0.15, 1.0);
    ${id}_surfC = ${id}_surfC * ${id}_diff;
    // Background: very dark tint so the cube space reads as 3D
    vec3  ${id}_bgC    = vec3(${bgDark});
    vec3  ${id}_color  = mix(${id}_bgC, ${id}_surfC, ${id}_accA);
    float ${id}_alpha  = ${id}_accA;
    ${id}_depth = ${id}_depth / ${id}_tFar; // normalise 0-1
    vec2  ${id}_uv_out = ${uv};
`;

    return {
      code,
      outputVars: {
        color: `${id}_color`,
        alpha: `${id}_alpha`,
        depth: `${id}_depth`,
        uv:    `${id}_uv_out`,
      },
    };
  },
};

// ─── Chladni 3D Particles (Orbital-style density cloud) ───────────────────────
//
// Instead of raymarching clean surfaces, this node scatters virtual particles
// through the volume. Each particle drifts on a noise field but is attracted
// toward f(x,y,z)=0 nodal surfaces. The result is a turbulent particle-cloud
// that reveals the 3D field topology — similar to electron orbital probability
// density visualisations.
//
// Four noise algorithms let the user swap the turbulence character:
//   hash   — classic sin/dot hash (smooth drift, occasionally bands)
//   value  — smooth value noise (rounder, softer clouds)
//   cell   — Voronoi cellular (clumpy blobs, strong structure)
//   fbm    — 4-octave fBm value noise (fractal, most detail, slowest)

const CHLADNI3D_PARTICLES_GLSL_FN = `
// ── noise helpers ────────────────────────────────────────────────────────────
float c3p_hash1(vec3 p) {
    p = fract(p * vec3(127.1, 311.7, 74.7));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}
vec3 c3p_hash3(vec3 p) {
    return vec3(
        c3p_hash1(p),
        c3p_hash1(p + vec3(1.0)),
        c3p_hash1(p + vec3(2.0))
    );
}
float c3p_valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f*f*(3.0 - 2.0*f);
    float v000 = c3p_hash1(i + vec3(0,0,0));
    float v100 = c3p_hash1(i + vec3(1,0,0));
    float v010 = c3p_hash1(i + vec3(0,1,0));
    float v110 = c3p_hash1(i + vec3(1,1,0));
    float v001 = c3p_hash1(i + vec3(0,0,1));
    float v101 = c3p_hash1(i + vec3(1,0,1));
    float v011 = c3p_hash1(i + vec3(0,1,1));
    float v111 = c3p_hash1(i + vec3(1,1,1));
    return mix(
        mix(mix(v000,v100,u.x), mix(v010,v110,u.x), u.y),
        mix(mix(v001,v101,u.x), mix(v011,v111,u.x), u.y),
        u.z
    );
}
float c3p_fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int c3p_i = 0; c3p_i < 4; c3p_i++) {
        v += a * c3p_valueNoise(p);
        p = p * 2.1 + vec3(5.2, 1.3, 2.7);
        a *= 0.5;
    }
    return v;
}
float c3p_voronoi(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float minD = 10.0;
    for (int c3p_z = -1; c3p_z <= 1; c3p_z++) {
        for (int c3p_y = -1; c3p_y <= 1; c3p_y++) {
            for (int c3p_x = -1; c3p_x <= 1; c3p_x++) {
                vec3 nb  = vec3(float(c3p_x), float(c3p_y), float(c3p_z));
                vec3 pt  = c3p_hash3(i + nb);
                vec3 df  = nb + pt - f;
                float d  = dot(df, df);
                if (d < minD) minD = d;
            }
        }
    }
    return sqrt(minD);
}
// Returns a noise vec3 offset. mode: 0=hash, 1=value, 2=voronoi, 3=fbm
vec3 c3p_noise3(vec3 p, int mode) {
    if (mode == 1) {
        return vec3(
            c3p_valueNoise(p),
            c3p_valueNoise(p + vec3(7.3, 2.1, 5.5)),
            c3p_valueNoise(p + vec3(3.7, 8.9, 1.4))
        ) * 2.0 - 1.0;
    }
    if (mode == 2) {
        return vec3(
            c3p_voronoi(p),
            c3p_voronoi(p + vec3(4.1, 1.7, 3.3)),
            c3p_voronoi(p + vec3(2.3, 6.5, 0.9))
        ) * 2.0 - 1.0;
    }
    if (mode == 3) {
        return vec3(
            c3p_fbm(p),
            c3p_fbm(p + vec3(5.2, 1.3, 2.7)),
            c3p_fbm(p + vec3(1.7, 9.2, 4.4))
        ) * 2.0 - 1.0;
    }
    // mode == 0: classic sin hash
    return vec3(
        fract(sin(dot(p,             vec3(127.1,311.7, 74.7)))*43758.5453),
        fract(sin(dot(p + 1.0,       vec3(269.5,183.3,246.1)))*43758.5453),
        fract(sin(dot(p + vec3(2.0), vec3(113.5,271.9,124.6)))*43758.5453)
    ) * 2.0 - 1.0;
}
// ── Chladni 3D field helpers (duplicated here so this node is self-contained) ─
float c3p_chladni3d(vec3 p, float m, float n, float l) {
    return cos(n*PI*p.x)*cos(m*PI*p.y)*cos(l*PI*p.z)
         - cos(m*PI*p.x)*cos(l*PI*p.y)*cos(n*PI*p.z);
}
vec3 c3p_chladni3dNormal(vec3 p, float m, float n, float l) {
    float e = 0.01;
    return normalize(vec3(
        c3p_chladni3d(p+vec3(e,0,0),m,n,l) - c3p_chladni3d(p-vec3(e,0,0),m,n,l),
        c3p_chladni3d(p+vec3(0,e,0),m,n,l) - c3p_chladni3d(p-vec3(0,e,0),m,n,l),
        c3p_chladni3d(p+vec3(0,0,e),m,n,l) - c3p_chladni3d(p-vec3(0,0,e),m,n,l)
    ));
}
mat3 c3p_cam(vec3 ro, vec3 ta) {
    vec3 cw = normalize(ta - ro);
    vec3 cu = normalize(cross(cw, vec3(0.0, 1.0, 0.0)));
    vec3 cv = cross(cu, cw);
    return mat3(cu, cv, cw);
}
`;

export const Chladni3DParticlesNode: NodeDefinition = {
  type: 'chladni3dParticles',
  label: 'Chladni 3D Particles',
  category: 'Science',
  description: 'Orbital-style turbulent particle cloud for 3D Chladni fields. Particles drift on a noise field but concentrate near f=0 nodal surfaces — like electron probability density. 4 noise algorithms: hash, value, voronoi, fBm.',
  inputs: {
    uv:          { type: 'vec2',  label: 'UV'         },
    time:        { type: 'float', label: 'Time'        },
    m:           { type: 'float', label: 'm'           },
    n:           { type: 'float', label: 'n'           },
    l:           { type: 'float', label: 'l'           },
    orbit_angle: { type: 'float', label: 'Orbit Angle' },
  },
  outputs: {
    color:   { type: 'vec3',  label: 'Color'   },
    density: { type: 'float', label: 'Density' },
    uv:      { type: 'vec2',  label: 'UV (pass-through)' },
  },
  glslFunction: CHLADNI3D_PARTICLES_GLSL_FN,
  defaultParams: {
    m:            0.75,
    n:            1.0,
    l:            0.5,
    scale:        1.2,
    steps:        60,
    turbulence:   0.18,
    noise_speed:  0.4,
    surface_pull: 6.0,
    brightness:   3.0,
    orbit_speed:  0.25,
    orbit_pitch:  0.4,
    cam_dist:     2.2,
    noise_mode:   'hash',
    color_mode:   'field',
  },
  paramDefs: {
    m:            { label: 'm',              type: 'float',  min: -2,    max: 2,    step: 0.01  },
    n:            { label: 'n',              type: 'float',  min: -2,    max: 2,    step: 0.01  },
    l:            { label: 'l',              type: 'float',  min: -2,    max: 2,    step: 0.01  },
    scale:        { label: 'Scale',          type: 'float',  min: 0.5,   max: 3.0,  step: 0.05  },
    steps:        { label: 'March Steps',    type: 'float',  min: 20,    max: 120,  step: 4     },
    turbulence:   { label: 'Turbulence',     type: 'float',  min: 0.0,   max: 0.6,  step: 0.005 },
    noise_speed:  { label: 'Noise Speed',    type: 'float',  min: 0.0,   max: 2.0,  step: 0.05  },
    surface_pull: { label: 'Surface Pull',   type: 'float',  min: 0.5,   max: 20.0, step: 0.5   },
    brightness:   { label: 'Brightness',     type: 'float',  min: 0.1,   max: 10.0, step: 0.1   },
    orbit_speed:  { label: 'Orbit Speed',    type: 'float',  min: -2.0,  max: 2.0,  step: 0.05  },
    orbit_pitch:  { label: 'Orbit Pitch',    type: 'float',  min: -1.5,  max: 1.5,  step: 0.05  },
    cam_dist:     { label: 'Cam Dist',       type: 'float',  min: 1.0,   max: 5.0,  step: 0.1   },
    noise_mode: {
      label: 'Noise Algorithm', type: 'select',
      options: [
        { value: 'hash',  label: 'Hash (classic)'   },
        { value: 'value', label: 'Value (smooth)'   },
        { value: 'cell',  label: 'Voronoi (clumpy)' },
        { value: 'fbm',   label: 'fBm (fractal)'    },
      ],
    },
    color_mode: {
      label: 'Color Mode', type: 'select',
      options: [
        { value: 'field',  label: 'Field sign'    },
        { value: 'depth',  label: 'Depth tinted'  },
        { value: 'normal', label: 'Normal map'    },
        { value: 'hot',    label: 'Hot (density)' },
      ],
    },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv          = inputVars.uv          ?? 'vec2(0.0)';
    const timeVar     = inputVars.time        ?? '0.0';
    const mVal        = inputVars.m           ?? f(typeof node.params.m     === 'number' ? node.params.m     : 0.75);
    const nVal        = inputVars.n           ?? f(typeof node.params.n     === 'number' ? node.params.n     : 1.0);
    const lVal        = inputVars.l           ?? f(typeof node.params.l     === 'number' ? node.params.l     : 0.5);
    const scale       = f(typeof node.params.scale        === 'number' ? node.params.scale        : 1.2);
    const steps       = Math.round(typeof node.params.steps === 'number' ? node.params.steps       : 60);
    const turbulence  = f(typeof node.params.turbulence   === 'number' ? node.params.turbulence    : 0.18);
    const noiseSpeed  = f(typeof node.params.noise_speed  === 'number' ? node.params.noise_speed   : 0.4);
    const surfPull    = f(typeof node.params.surface_pull === 'number' ? node.params.surface_pull  : 6.0);
    const brightness  = f(typeof node.params.brightness   === 'number' ? node.params.brightness    : 3.0);
    const orbitSpeed  = f(typeof node.params.orbit_speed  === 'number' ? node.params.orbit_speed   : 0.25);
    const orbitPitch  = f(typeof node.params.orbit_pitch  === 'number' ? node.params.orbit_pitch   : 0.4);
    const camDist     = f(typeof node.params.cam_dist     === 'number' ? node.params.cam_dist      : 2.2);
    const noiseMode   = typeof node.params.noise_mode === 'string' ? node.params.noise_mode : 'hash';
    const colorMode   = typeof node.params.color_mode === 'string' ? node.params.color_mode : 'field';

    const noiseModeInt = noiseMode === 'value' ? 1 : noiseMode === 'cell' ? 2 : noiseMode === 'fbm' ? 3 : 0;

    const hasOrbitInput = !!inputVars.orbit_angle;
    const angleExpr = hasOrbitInput
      ? inputVars.orbit_angle!
      : `${timeVar} * ${orbitSpeed}`;

    let colorExpr: string;
    if (colorMode === 'depth') {
      colorExpr = `mix(vec3(0.05,0.12,0.45), vec3(1.0,0.95,0.85), clamp(${id}_depthW, 0.0, 1.0))`;
    } else if (colorMode === 'normal') {
      colorExpr = `${id}_normW * 0.5 + 0.5`;
    } else if (colorMode === 'hot') {
      colorExpr = `vec3(clamp(${id}_dens*2.0,0.0,1.0), clamp(${id}_dens*2.0-0.5,0.0,1.0), clamp(${id}_dens*3.0-2.0,0.0,1.0))`;
    } else {
      // field sign — warm vs cool by which side of the surface
      colorExpr = `mix(vec3(0.3,0.6,1.0), vec3(1.0,0.55,0.2), ${id}_signW * 0.5 + 0.5)`;
    }

    const code = `
    // ── Chladni3DParticles: camera ───────────────────────────────────────────
    float ${id}_ang  = ${angleExpr};
    float ${id}_cp   = cos(${orbitPitch}), ${id}_sp = sin(${orbitPitch});
    vec3  ${id}_ro   = vec3(cos(${id}_ang)*${id}_cp, ${id}_sp, sin(${id}_ang)*${id}_cp) * ${camDist};
    mat3  ${id}_cm   = c3p_cam(${id}_ro, vec3(0.0));
    vec3  ${id}_rd   = normalize(${id}_cm * vec3(${uv}.x, ${uv}.y * (u_resolution.y / u_resolution.x), 1.5));

    // ── Particle density march ────────────────────────────────────────────────
    float ${id}_m     = ${mVal};
    float ${id}_n_    = ${nVal};
    float ${id}_l_    = ${lVal};
    float ${id}_tFar  = 4.0;
    float ${id}_dt    = ${id}_tFar / float(${steps});
    float ${id}_dens  = 0.0;
    float ${id}_wSum  = 0.0;
    float ${id}_depthW = 0.0;
    vec3  ${id}_normW  = vec3(0.0);
    float ${id}_signW  = 0.0;
    float ${id}_t      = 0.0;
    float ${id}_fv     = 0.0;
    float ${id}_fvP    = 0.0;
    float ${id}_w      = 0.0;
    vec3  ${id}_ps     = vec3(0.0);
    vec3  ${id}_pn     = vec3(0.0);
    vec3  ${id}_nn     = vec3(0.0);
    for (int ${id}_i = 0; ${id}_i < ${steps}; ${id}_i++) {
        ${id}_t  = float(${id}_i) * ${id}_dt;
        ${id}_ps = ${id}_ro + ${id}_rd * ${id}_t;
        if (any(greaterThan(abs(${id}_ps), vec3(${scale})))) { continue; }
        // Perturb sample by noise — particles drift but concentrate near f=0
        ${id}_pn  = ${id}_ps + c3p_noise3(${id}_ps * 3.0 + ${timeVar} * ${noiseSpeed}, ${noiseModeInt}) * ${turbulence};
        ${id}_fvP = c3p_chladni3d(${id}_pn * (1.0/${scale}), ${id}_m, ${id}_n_, ${id}_l_);
        // Gaussian density peaked at f=0 (surface_pull = sharpness/inverse width)
        ${id}_w   = exp(-${id}_fvP * ${id}_fvP * ${surfPull} * ${surfPull});
        ${id}_dens    += ${id}_w * ${id}_dt;
        // Unperturbed values for surface colour metadata
        ${id}_fv  = c3p_chladni3d(${id}_ps * (1.0/${scale}), ${id}_m, ${id}_n_, ${id}_l_);
        ${id}_nn  = c3p_chladni3dNormal(${id}_ps * (1.0/${scale}), ${id}_m, ${id}_n_, ${id}_l_);
        ${id}_normW  += ${id}_nn          * ${id}_w;
        ${id}_depthW += (${id}_t / ${id}_tFar) * ${id}_w;
        ${id}_signW  += sign(${id}_fv)    * ${id}_w;
        ${id}_wSum   += ${id}_w;
    }
    if (${id}_wSum > 0.001) {
        ${id}_normW  = normalize(${id}_normW);
        ${id}_depthW = ${id}_depthW / ${id}_wSum;
        ${id}_signW  = ${id}_signW  / ${id}_wSum;
    }
    ${id}_dens = clamp(${id}_dens * ${brightness}, 0.0, 1.0);

    // ── Colour ───────────────────────────────────────────────────────────────
    vec3  ${id}_color   = (${colorExpr}) * ${id}_dens;
    float ${id}_density = ${id}_dens;
    vec2  ${id}_uv_out  = ${uv};
`;

    return {
      code,
      outputVars: {
        color:   `${id}_color`,
        density: `${id}_density`,
        uv:      `${id}_uv_out`,
      },
    };
  },
};
