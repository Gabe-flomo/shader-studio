/**
 * agentMemoryGpu.ts — the Agent Builder's Memory section on the GPU (docs/agent-builder.md "Memory"):
 *
 *  - the memory lens: while a memory is being edited, every live walker drawn as a dot coloured by
 *    that memory on Under the hood's heat map (black → red → yellow → white, its range lo → hi),
 *    through the species spotlight's canvas and projection (AG_SPOT_VERT, 2D and 3D);
 *  - the live range: 4096 walkers sampled evenly (every count ÷ 4096-th) into a 64 × 128 float
 *    target (rows 0–63 More memory E, rows 64–127 (alive, Memory x, Memory y, 0)), read back
 *    without a stall, and each memory number's min / max over the live ones.
 */
import { AG_SPOT_VERT } from '../play/kit/agentShaders.js';
import { MAP_STOPS } from '../agentBuilder/hood';

/** Samples a range pass reads (64 × 64). */
export const MEM_RANGE_N = 64;

const heatGlsl = (() => {
  const s = MAP_STOPS.heat;
  const n = s.length;
  return `vec3 memHeat(float t) {
  const vec3 S[${n}] = vec3[${n}](${s.map(c => `vec3(${c.map(x => x.toFixed(4)).join(', ')})`).join(', ')});
  float x = clamp(t, 0.0, 1.0) * ${(n - 1).toFixed(1)};
  int i = min(int(floor(x)), ${n - 2});
  return mix(S[i], S[i + 1], x - float(i));
}`;
})();

/** The lens: the spotlight's vertex shader, coloured by one memory number (u_memSrc 0: state C, 1: state E; u_memComp its channel). */
export const MEM_LENS_VERT = AG_SPOT_VERT
  .replace('uniform float u_aspect, u_px;', `uniform float u_aspect, u_px;
uniform highp sampler2D u_e;
uniform int u_memSrc, u_memComp;
uniform float u_lo, u_hi;
out vec3 v_col;
${heatGlsl}`)
  .replace('  gl_PointSize = u_px;', `  vec4 M = u_memSrc == 1 ? texelFetch(u_e, t, 0) : texelFetch(u_c, t, 0);
  v_col = memHeat((M[u_memComp] - u_lo) / max(u_hi - u_lo, 1e-6));
  gl_PointSize = u_px;`);

export const MEM_LENS_FRAG = `precision highp float;
in vec3 v_col;
out vec4 o_col;
void main() { o_col = vec4(v_col, 1.0); }`;

/** The range pass: sample i of 4096 is walker i × u_stride. */
export const MEM_RANGE_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_b;
uniform highp sampler2D u_c;
uniform highp sampler2D u_e;
uniform int u_side, u_stride, u_hasE;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int row = p.y % ${MEM_RANGE_N};
  int id = (row * ${MEM_RANGE_N} + p.x) * u_stride;
  ivec2 t = ivec2(id % u_side, id / u_side);
  if (t.y >= u_side) { o = vec4(0.0); return; }
  if (p.y >= ${MEM_RANGE_N}) {
    vec4 C = texelFetch(u_c, t, 0);
    o = vec4(texelFetch(u_b, t, 0).w > 0.0 ? 1.0 : 0.0, C.y, C.z, 0.0);
  } else o = u_hasE == 1 ? texelFetch(u_e, t, 0) : vec4(0.0);
}`;

/**
 * The sampled walkers' min / max of each memory number: [Memory x, Memory y, E.x, E.y, E.z, E.w],
 * each [lo, hi] (null when no sampled walker is alive).
 */
export function decodeMemRanges(px: Float32Array): Array<[number, number]> | null {
  const N = MEM_RANGE_N;
  const lo = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity], hi = lo.map(() => -Infinity);
  let any = false;
  for (let i = 0; i < N * N; i++) {
    const f = (N * N + i) * 4;
    if (!(px[f] > 0.5)) continue;
    any = true;
    const v = [px[f + 1], px[f + 2], px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]];
    v.forEach((x, k) => { if (Number.isFinite(x)) { if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; } });
  }
  return any ? lo.map((l, k) => [l, hi[k]] as [number, number]) : null;
}

/** A memory's place for the lens: 'E:2' → state E, channel z; 'C:1' → Memory x. */
export function parseMemSlot(s: string | undefined): { src: 0 | 1; comp: number } | null {
  const m = /^([CE]):([0-3])$/.exec(s ?? '');
  return m ? { src: m[1] === 'E' ? 1 : 0, comp: Number(m[2]) } : null;
}
