/**
 * preview.ts — the Warp Builder's big preview as a fragment shader (docs/warp-builder.md, "Preview").
 *
 * The stack is written once per shape (its rows, which blocks loop, the slider names) and every
 * number is a uniform: the sliders (`u_p`), Run × / Iterations (`u_n`), mute (`u_on`) and the
 * "space after this block" hover (`u_upto`). So dragging a slider, muting, changing Run × or hovering
 * never recompiles: only `source` changing does (previewShader's key).
 *
 * Views: Checkerboard (a warped grid), Ring (a glowing white ring seen through the warp), Vectors
 * (arrows from each cell's centre to where the warp sends it) and Heat (how far each point moves).
 * Pure: no WebGL here (WarpPreview.tsx draws it).
 */
import { BUILTIN_HELPERS_GLSL } from '../compiler/shaderAssembler';
import { checkBlock, clampTimes, MAX_LOOP_TIMES } from '../sceneBuilder2d/blocks';
import type { PreviewMode, WarpSpec } from './spec';

export const MAX_BLOCKS = 16;
export const MAX_PARAMS = 64;
/** How much of the plane the preview spans: ±VIEW across the short side. */
export const PREVIEW_VIEW = 1.1;

export interface PreviewShader {
  /** The fragment shader (GLSL ES 3.00). */
  source: string;
  /** Per block: its first slider's index in u_p (the slider order is the block's params). */
  offsets: number[];
}

export interface PreviewUniforms { p: Float32Array; n: Int32Array; on: Float32Array; upto: number }

const MODE_GLSL: Record<PreviewMode, string> = {
  checker: `
  vec2 q = w * 4.0;
  float checker = mod(floor(q.x) + floor(q.y), 2.0);
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  vec3 col = vec3(0.10, 0.11, 0.15) + vec3(0.30, 0.32, 0.38) * checker;
  col = mix(col, vec3(0.95, 0.55, 0.22), line * 0.85);
  if (any(isnan(w)) || any(isinf(w))) col = vec3(0.05);`,
  ring: `
  float d = abs(length(w) - 0.5) - 0.012;
  float px = fwidth(length(w)) + 1e-4;
  vec3 col = vec3(1.0) * (smoothstep(px, -px, d) + 0.018 / max(d, 0.004));
  col = col / (1.0 + col);
  col = pow(col, vec3(0.8));`,
  vectors: `
  float cell = 0.16;
  vec2 c = (floor(p / cell) + 0.5) * cell;
  vec2 D = warpAll(c) - c;
  float len = length(D);
  vec2 dir = len > 1e-5 ? D / len : vec2(0.0);
  // Inside its own cell (a cell draws only its own pixels): from the centre to just short of the edge.
  float show = min(len, cell * 0.42);
  vec2 tip = c + dir * show;
  float dl = sdSeg(p, c, tip);
  vec2 side = vec2(-dir.y, dir.x);
  float head = min(sdSeg(p, tip, tip - dir * cell * 0.22 + side * cell * 0.13), sdSeg(p, tip, tip - dir * cell * 0.22 - side * cell * 0.13));
  float px = 1.5 / u_res.y * 2.0 * ${PREVIEW_VIEW.toFixed(2)};
  float a = smoothstep(px, 0.0, min(dl, show > cell * 0.12 ? head : 1e3) - px * 0.4);
  float dot0 = smoothstep(px * 2.0, px, length(p - c) - px);
  vec3 tint = 0.6 + 0.4 * cos(6.2831 * (min(len * 2.0, 1.0) * 0.6 + vec3(0.0, 0.33, 0.67)));
  vec2 gq = abs(fract(p / cell) - 0.5);
  vec3 col = vec3(0.07, 0.08, 0.11) + 0.025 * step(0.49, max(gq.x, gq.y));
  col = mix(col, vec3(0.45), dot0 * 0.6);
  col = mix(col, tint, a);`,
  heat: `
  float m = length(w - p);
  float s = 1.0 - exp(-m * 3.0);
  vec3 col = vec3(0.5) + vec3(0.5) * cos(6.2831 * (vec3(1.0) * s * 0.9 + vec3(0.0, 0.1, 0.2)));
  col *= smoothstep(0.0, 0.08, s) * 0.85 + 0.15;
  float band = abs(fract(m * 8.0) - 0.5);
  col *= 0.85 + 0.15 * smoothstep(0.0, 0.08, band);
  if (any(isnan(w)) || any(isinf(w))) col = vec3(1.0, 1.0, 1.0);`,
};

/** The shader for a stack and a view. A block (or a row) that doesn't check is left out, as the build does. */
export function previewShader(spec: WarpSpec, mode: PreviewMode): PreviewShader {
  const offsets: number[] = [];
  const fns: string[] = [];
  let at = 0;
  const blocks = spec.blocks.slice(0, MAX_BLOCKS);
  blocks.forEach((item, b) => {
    const blk = item.block;
    offsets.push(at);
    const chk = checkBlock(blk);
    const decl = blk.params.map((p, j) => `  float ${p.name} = u_p[${Math.min(at + j, MAX_PARAMS - 1)}];`).join('\n');
    at += blk.params.length;
    const rows = chk.ok
      ? blk.lines.map((l, i) => ({ l, c: chk.lines[i] })).filter(x => !x.c.empty).map(x => `    ${x.l.target} ${x.l.op} ${x.c.glsl};`).join('\n')
      : '';
    const loop = blk.loop
      ? `    float fi = float(i_); float n = float(u_n[${b}]); float k = fi / max(n - 1.0, 1.0);\n`
      : '';
    fns.push(`vec2 warp${b}(vec2 uv) {
  float t = u_time;
${decl}
${blk.loop ? '  vec2 uv0 = uv;\n' : ''}  for (int i_ = 0; i_ < ${MAX_LOOP_TIMES}; i_++) {
    if (i_ >= u_n[${b}]) break;
${loop}${rows || '    // (this block does not check yet: it leaves uv as it is)'}
  }
  return uv;
}`);
  });
  const all = blocks.map((_, b) => `  if (${b} < u_upto) uv = mix(uv, warp${b}(uv), u_on[${b}]);`).join('\n');
  const source = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_p[${MAX_PARAMS}];
uniform int u_n[${MAX_BLOCKS}];
uniform float u_on[${MAX_BLOCKS}];
uniform int u_upto;
out vec4 fragColor;
#define PI 3.14159265359
#define TAU 6.28318530718
${BUILTIN_HELPERS_GLSL}
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return length(pa - ba * h); }
${fns.join('\n')}
vec2 warpAll(vec2 uv) {
${all}
  return uv;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / (0.5 * u_res.y) * ${PREVIEW_VIEW.toFixed(2)};
  vec2 w = warpAll(p);
${MODE_GLSL[mode]}
  fragColor = vec4(col, 1.0);
}
`;
  return { source, offsets };
}

/** The live numbers: every slider, Run ×, mute, and how many blocks to show (`upTo`: hover). */
export function previewUniforms(spec: WarpSpec, upTo: number | null = null): PreviewUniforms {
  const p = new Float32Array(MAX_PARAMS), n = new Int32Array(MAX_BLOCKS), on = new Float32Array(MAX_BLOCKS);
  let at = 0;
  spec.blocks.slice(0, MAX_BLOCKS).forEach((item, b) => {
    for (const q of item.block.params) { if (at < MAX_PARAMS) p[at] = q.value; at++; }
    n[b] = clampTimes(item.block.times, !!item.block.loop);
    on[b] = item.muted ? 0 : 1;
  });
  return { p, n, on, upto: upTo ?? spec.blocks.length };
}
