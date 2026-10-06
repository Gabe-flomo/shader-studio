/**
 * GLSL for the "Show as" previews (docs/node-previews.md). Both programs are the graph's own
 * fragment shader with its last line replaced, the way the probes read a node's variable
 * (ShaderCanvas buildProbeShader): no per-node-type code, so any upstream chain works.
 *
 *  - The value program writes the node's raw value (and, for a float, its primary input) into a
 *    small float target that is read back asynchronously for the range, the slice and the arrows.
 *  - The display program draws the value in the chosen mode at full size for the eye preview.
 *    Colour maps match valueField.ts (the node card paints the same pictures on the CPU).
 */
import { DIVERGING } from './valueField';

const v3 = (c: readonly number[]) => `vec3(${c.map(x => x.toFixed(3)).join(', ')})`;

/** Mode numbers the display program takes in u_pvMode. */
export const MODE_CODE: Record<string, number> = { auto: 0, slice: 1, contours: 2, grid: 0, arrows: 1, wheel: 2 };

export const DISPLAY_UNIFORMS = ['u_pvMode', 'u_pvMin', 'u_pvMax', 'u_pvStep', 'u_pvMag', 'u_pvFlat', 'u_pvGrid'] as const;

const HELPERS = `
uniform float u_pvMode;
uniform float u_pvMin;
uniform float u_pvMax;
uniform float u_pvStep;
uniform float u_pvMag;
uniform float u_pvFlat;
uniform vec2 u_pvGrid; // checker squares, grid lines per unit (Detail)
vec3 pvz_div(float v) {
  float t;
  if (v < 0.0) {
    t = u_pvMin < 0.0 ? clamp(v / u_pvMin, 0.0, 1.0) : 0.0;
    return t < 0.5 ? mix(${v3(DIVERGING.zero)}, ${v3(DIVERGING.negMid)}, t * 2.0) : mix(${v3(DIVERGING.negMid)}, ${v3(DIVERGING.negEnd)}, t * 2.0 - 1.0);
  }
  t = u_pvMax > 0.0 ? clamp(v / u_pvMax, 0.0, 1.0) : 0.0;
  return t < 0.5 ? mix(${v3(DIVERGING.zero)}, ${v3(DIVERGING.posMid)}, t * 2.0) : mix(${v3(DIVERGING.posMid)}, ${v3(DIVERGING.posEnd)}, t * 2.0 - 1.0);
}
vec3 pvz_range(float v) {
  if (u_pvMin < 0.0 && u_pvMax > u_pvMin) return pvz_div(v);
  float t = u_pvMax > u_pvMin ? clamp((v - u_pvMin) / (u_pvMax - u_pvMin), 0.0, 1.0) : 0.5;
  return vec3(0.04 + 0.92 * t);
}
vec3 pvz_hsv(float h, float s, float v) {
  vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
  return v - v * s * max(min(min(k, 4.0 - k), 1.0), 0.0);
}
vec3 pvz_wheel(vec2 p) {
  float a = atan(p.y, p.x) / 6.28318530718;
  float m = u_pvMag > 0.0 ? clamp(length(p) / u_pvMag, 0.0, 1.0) : 0.0;
  return pvz_hsv(a < 0.0 ? a + 1.0 : a, 0.85, m);
}
vec3 pvz_grid(vec2 p, vec2 w) {
  w = max(w, vec2(1e-6));
  float checks = max(u_pvGrid.x, 1.0), lines = max(u_pvGrid.y, 1.0);
  vec2 c = floor(p * checks);
  float chk = mod(c.x + c.y, 2.0);
  float fade = 1.0 - smoothstep(0.3, 1.0, max(w.x, w.y) * checks);
  float shade = 0.24 + (chk - 0.5) * 0.14 * fade;
  vec2 f = fract(p);
  vec3 col = vec3(shade + f.x * 0.22, shade + 0.02, shade + f.y * 0.26);
  vec2 l = abs(fract(p * lines + 0.5) - 0.5) / (w * lines);
  col = mix(col, vec3(0.82, 0.84, 0.9), (1.0 - smoothstep(0.5, 1.5, min(l.x, l.y))) * 0.55);
  col = mix(col, vec3(0.3, 0.95, 0.45), 1.0 - smoothstep(0.75, 2.0, abs(p.x) / w.x));
  col = mix(col, vec3(1.0, 0.35, 0.35), 1.0 - smoothstep(0.75, 2.0, abs(p.y) / w.y));
  return col;
}
vec4 pvz_showF(float v) {
  float fv = v / max(u_pvStep, 1e-12);
  float fw = fwidth(fv);
  if (isnan(v) || isinf(v)) return vec4(0.5, 0.0, 0.5, 1.0);
  if (u_pvFlat > 0.5) return vec4(0.16, 0.16, 0.18, 1.0);
  vec3 col = pvz_range(v);
  if (u_pvMode > 0.5 && u_pvMode < 1.5) col *= 0.45;
  if (u_pvMode > 1.5) {
    float d = abs(fract(fv + 0.5) - 0.5) / max(fw, 1e-6);
    float line = 1.0 - smoothstep(0.5, 1.5, d);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum > 0.55 ? 0.06 : 0.94), line * 0.85);
  }
  return vec4(col, 1.0);
}
vec4 pvz_showV(vec2 p) {
  vec2 w = fwidth(p);
  if (any(isnan(p)) || any(isinf(p))) return vec4(0.5, 0.0, 0.5, 1.0);
  if (u_pvMode < 0.5) return vec4(pvz_grid(p, w), 1.0);
  if (u_pvMode < 1.5) return vec4(pvz_wheel(p) * 0.35, 1.0);
  return vec4(pvz_wheel(p), 1.0);
}
`;

const MAIN_RE = /\bvoid\s+main\s*\(/;

/** `fs` with `helpers` before main() and its last statement block ending in `tail`. Null if fs has no main. */
function inject(fs: string, helpers: string, tail: string): string | null {
  const m = MAIN_RE.exec(fs);
  const end = fs.lastIndexOf('}');
  if (!m || end < m.index) return null;
  return fs.slice(0, m.index) + helpers + fs.slice(m.index, end) + tail + '\n}';
}

/** The eye preview's display program: the node's value drawn in the mode u_pvMode picks. */
export function buildDisplayShader(fs: string, varName: string, type: 'float' | 'vec2'): string | null {
  return inject(fs, HELPERS, `  gl_FragColor = ${type === 'vec2' ? 'pvz_showV' : 'pvz_showF'}(${varName});`);
}

/**
 * The value program: the node's raw value into R (float) or RG (vec2); a float node's primary
 * input into G when given (the slice plot's grey "before" line).
 */
export function buildValueShader(fs: string, varName: string, type: 'float' | 'vec2' | 'vec3' | 'vec4', inputVar?: string | null): string | null {
  const packed = type === 'vec2' ? `vec4(${varName}, 0.0, 1.0)`
    : type === 'vec3' ? `vec4(${varName}, 1.0)`
    : type === 'vec4' ? `vec4((${varName}).rgb, 1.0)`
    : `vec4(${varName}, ${inputVar ? `float(${inputVar})` : '0.0'}, 0.0, 1.0)`;
  return inject(fs, '', `  gl_FragColor = ${packed};`);
}
