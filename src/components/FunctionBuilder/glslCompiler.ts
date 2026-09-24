import type { FnDef } from './useFunctionBuilder';
import {
  BUILTIN_HELPERS_GLSL,
  GLSL_SMIN, GLSL_SD_BOX, GLSL_SD_SEGMENT,
  GLSL_OP_REPEAT, GLSL_OP_REPEAT_POLAR,
} from '../../compiler/shaderAssembler';
import type { ThemeMode } from '../../theme/tokens';

// Plot colours per app theme. Curves f1..f6 cycle through `curves`; the editor cards use the
// same list for their colour dots.
export interface PlotTheme { bg: string; grid: string; axis: string; curves: readonly string[] }

export const PLOT_THEMES: Readonly<Record<ThemeMode, PlotTheme>> = {
  light: { bg: '#ffffff', grid: '#eef0f3', axis: '#c3c5cf', curves: ['#3a6ff7', '#fe640b', '#40a02b', '#ea76cb', '#8839ef', '#df8e1d'] },
  dark:  { bg: '#181825', grid: '#28293b', axis: '#585b70', curves: ['#89b4fa', '#fab387', '#a6e3a1', '#f5c2e7', '#cba6f7', '#f9e2af'] },
};

export function curveColor(index: number, mode: ThemeMode): string {
  const { curves } = PLOT_THEMES[mode];
  return curves[index % curves.length];
}

/** `#rrggbb` → `vec3(r, g, b)` literal. */
function vec3Of(hex: string): string {
  const c = [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3));
  return `vec3(${c.join(', ')})`;
}

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
    return `float ${fn.name}(float _x) {
  float x = _x;
  float t = u_time;
  vec2 uv = vec2(_x, 0.0);
  return ${expr};
}`;
  }
  return `${fn.returnType} ${fn.name}(vec2 _uv) {
  float x = _uv.x;
  float t = u_time;
  vec2 uv = _uv;
  return ${expr};
}`;
}

/** Plots every float function; curve colours follow each function's position in the list, like the cards. */
function floatVizMain(functions: FnDef[], theme: PlotTheme, pixelRatio: number): string {
  // Half the curve's stroke, in device pixels (2.5 CSS px wide).
  const halfWidth = (1.25 * pixelRatio).toFixed(2);
  const curves = functions.map((fn, i) => fn.returnType !== 'float' ? '' : `  {
    // Distance to the curve in pixels, measured along its normal so steep parts keep their width.
    float e = yVal - ${fn.name}(xVal);
    float d = abs(e) / (length(vec2(dFdx(e), dFdy(e))) + 0.0001);
    float line = 1.0 - smoothstep(${halfWidth} - 0.75, ${halfWidth} + 0.75, d);
    col = mix(col, ${vec3Of(theme.curves[i % theme.curves.length])}, line);
  }`).filter(Boolean).join('\n');

  return `void main() {
  float xVal = mix(u_xMin, u_xMax, vUv.x);
  float yVal = mix(u_yMin, u_yMax, vUv.y);

  vec3 col = ${vec3Of(theme.bg)};

  // Grid lines at the axis-label step: a power of two giving ~6 lines per axis (see AxisLabels)
  float sx = exp2(floor(log2((u_xMax - u_xMin) / 6.0) + 0.5));
  float sy = exp2(floor(log2((u_yMax - u_yMin) / 6.0) + 0.5));
  float gx = abs(fract(xVal / sx - 0.5) - 0.5) * sx / (abs(dFdx(xVal)) + 0.0001);
  float gy = abs(fract(yVal / sy - 0.5) - 0.5) * sy / (abs(dFdy(yVal)) + 0.0001);
  col = mix(col, ${vec3Of(theme.grid)}, 1.0 - smoothstep(0.5, 1.5, min(gx, gy)));

  // Axes
  float ax = abs(xVal) / (abs(dFdx(xVal)) + 0.0001);
  float ay = abs(yVal) / (abs(dFdy(yVal)) + 0.0001);
  col = mix(col, ${vec3Of(theme.axis)}, 1.0 - smoothstep(0.8, 2.0, ay));
  col = mix(col, ${vec3Of(theme.axis)}, 1.0 - smoothstep(0.8, 2.0, ax));

${curves}

  gl_FragColor = vec4(col, 1.0);
}`;
}

function vec3VizMain(activeName: string): string {
  return `void main() {
  vec3 col = ${activeName}(vUv);
  gl_FragColor = vec4(col, 1.0);
}`;
}

function vec2VizMain(activeName: string): string {
  return `void main() {
  vec2 warped = ${activeName}(vUv);
  float checker = mod(floor(warped.x * 8.0) + floor(warped.y * 8.0), 2.0);
  vec3 col = mix(vec3(0.12), vec3(0.88), checker);
  gl_FragColor = vec4(col, 1.0);
}`;
}

export interface CompileResult {
  source: string;
  errors: string[];
  /** 1-based, inclusive source lines of each session function, by id — maps compiler errors to cards. */
  fnLines: Record<string, [number, number]>;
}

/** The function a WebGL log line ("ERROR: 0:42: …") points into, if any. */
export function errorOwner(error: string, fnLines: CompileResult['fnLines']): string | null {
  const m = /^ERROR:\s*\d+:(\d+):/i.exec(error);
  if (!m) return null;
  const line = Number(m[1]);
  for (const [id, [start, end]] of Object.entries(fnLines)) if (line >= start && line <= end) return id;
  return null;
}

export function buildShader(
  functions: FnDef[],
  activeId: string,
  _xRange: [number, number],
  _yRange: [number, number],
  libraryFns: FnDef[] = [],
  theme: PlotTheme = PLOT_THEMES.dark,
  pixelRatio = 1,
): CompileResult {
  if (functions.length === 0) return { source: '', errors: ['No functions defined'], fnLines: {} };

  const activeFn = functions.find(f => f.id === activeId) ?? functions[functions.length - 1];
  const errors: string[] = [];

  // Library fns that aren't overridden by session fns come first
  const sessionNames = new Set(functions.map(f => f.name));
  const libFnsToInclude = libraryFns.filter(f => !sessionNames.has(f.name));
  const userFns = [...libFnsToInclude.map(emitFunction), ...functions.map(emitFunction)].join('\n\n');

  let mainGlsl: string;
  if (activeFn.returnType === 'float') {
    mainGlsl = floatVizMain(functions, theme, pixelRatio);
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

  const lines = source.split('\n');
  const fnLines: CompileResult['fnLines'] = {};
  for (const fn of functions) {
    const emitted = emitFunction(fn).split('\n');
    const at = lines.lastIndexOf(emitted[0]);
    if (at >= 0) fnLines[fn.id] = [at + 1, at + emitted.length];
  }

  return { source, errors, fnLines };
}
