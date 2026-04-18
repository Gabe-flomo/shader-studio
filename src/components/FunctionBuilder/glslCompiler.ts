import type { FnDef } from './useFunctionBuilder';
import {
  BUILTIN_HELPERS_GLSL,
  GLSL_SMIN, GLSL_SD_BOX, GLSL_SD_SEGMENT,
  GLSL_OP_REPEAT, GLSL_OP_REPEAT_POLAR,
} from '../../compiler/shaderAssembler';
// Curve colors for multi-plot (f1..f6)
export const CURVE_COLORS: Array<[number, number, number]> = [
  [0.13, 0.67, 1.0],   // cyan-blue
  [1.0,  0.60, 0.20],  // orange
  [0.30, 0.90, 0.40],  // green
  [1.0,  0.40, 0.70],  // pink
  [0.70, 0.40, 1.0],   // purple
  [1.0,  0.90, 0.20],  // yellow
];


/** Strip 'return' prefix and trailing ';' to get bare expression. */
export function normalizeBodyExpr(body: string): string {
  let s = body.trim();
  s = s.replace(/^return\s+/, '');
  s = s.replace(/;$/, '').trim();
  return s;
}

export function emitFunction(fn: FnDef): string {
  const expr = normalizeBodyExpr(fn.body);
  if (fn.returnType === 'float') {
    return `float ${fn.name}(float _x, float _t) {
  float x = _x;
  float t = _t;
  vec2 uv = vec2(_x, 0.0);
  return ${expr};
}`;
  }
  return `${fn.returnType} ${fn.name}(vec2 _uv, float _t) {
  float x = _uv.x;
  float t = _t;
  vec2 uv = _uv;
  return ${expr};
}`;
}

function floatVizMain(floatFns: FnDef[]): string {
  const curves = floatFns.map((fn, i) => {
    const [r, g, b] = CURVE_COLORS[i % CURVE_COLORS.length];
    return `  {
    float fy = ${fn.name}(xVal, u_time);
    float d = abs(yVal - fy) / (abs(dFdy(yVal)) + 0.0001);
    float line = 1.0 - smoothstep(0.8, 2.0, d);
    col = mix(col, vec3(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}), line);
  }`;
  }).join('\n');

  return `void main() {
  float xVal = mix(u_xMin, u_xMax, vUv.x);
  float yVal = mix(u_yMin, u_yMax, vUv.y);

  vec3 col = vec3(0.07, 0.07, 0.11);

  // Grid lines (every 1 unit)
  float gx = abs(fract(xVal - 0.5) - 0.5) / (abs(dFdx(xVal)) + 0.0001);
  float gy = abs(fract(yVal - 0.5) - 0.5) / (abs(dFdy(yVal)) + 0.0001);
  col = mix(col, vec3(0.16), 1.0 - smoothstep(0.5, 1.5, min(gx, gy)));

  // Axes
  float ax = abs(xVal) / (abs(dFdx(xVal)) + 0.0001);
  float ay = abs(yVal) / (abs(dFdy(yVal)) + 0.0001);
  col = mix(col, vec3(0.32), 1.0 - smoothstep(0.8, 2.0, ay));
  col = mix(col, vec3(0.32), 1.0 - smoothstep(0.8, 2.0, ax));

${curves}

  gl_FragColor = vec4(col, 1.0);
}`;
}

function vec3VizMain(activeName: string): string {
  return `void main() {
  vec3 col = ${activeName}(vUv, u_time);
  gl_FragColor = vec4(col, 1.0);
}`;
}

function vec2VizMain(activeName: string): string {
  return `void main() {
  vec2 warped = ${activeName}(vUv, u_time);
  float checker = mod(floor(warped.x * 8.0) + floor(warped.y * 8.0), 2.0);
  vec3 col = mix(vec3(0.12), vec3(0.88), checker);
  gl_FragColor = vec4(col, 1.0);
}`;
}

export interface CompileResult {
  source: string;
  errors: string[];
}

export function buildShader(
  functions: FnDef[],
  activeId: string,
  xRange: [number, number],
  yRange: [number, number],
): CompileResult {
  if (functions.length === 0) return { source: '', errors: ['No functions defined'] };

  const activeFn = functions.find(f => f.id === activeId) ?? functions[functions.length - 1];
  const errors: string[] = [];

  const userFns = functions.map(emitFunction).join('\n\n');

  let mainGlsl: string;
  if (activeFn.returnType === 'float') {
    const floatFns = functions.filter(f => f.returnType === 'float');
    mainGlsl = floatVizMain(floatFns);
  } else if (activeFn.returnType === 'vec3') {
    mainGlsl = vec3VizMain(activeFn.name);
  } else {
    mainGlsl = vec2VizMain(activeFn.name);
  }

  const source = `#extension GL_OES_standard_derivatives : enable
precision highp float;
#define PI 3.1415926538
#define TAU 6.2831853072

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_xMin;
uniform float u_xMax;
uniform float u_yMin;
uniform float u_yMax;

varying vec2 vUv;

// ── Built-in helpers ──────────────────────────────────────────────────────────
${BUILTIN_HELPERS_GLSL}

${GLSL_SMIN}
${GLSL_SD_BOX}
${GLSL_SD_SEGMENT}
${GLSL_OP_REPEAT}
${GLSL_OP_REPEAT_POLAR}


// ── User functions ────────────────────────────────────────────────────────────
${userFns}

${mainGlsl}`.trim();

  return { source, errors };
}
