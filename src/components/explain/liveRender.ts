/**
 * The explain view's live picture (LineExplainView.tsx): one program that draws any row of a line's
 * build-up (its inputs, steps and result), picked by a uniform, so stepping through the rows never
 * recompiles. It is the build-up pictures' copy of the block (buildUpHost.rowsCopy: the lines above,
 * then each row as its own variable `pv_s0`, `pv_s1`…), drawn at full size every frame instead of
 * read back once.
 *
 * Overrides ("what the line reads", set by hand): each overridden name gets a uniform `u_xo0`,
 * `u_xo1`… and a line `name = u_xo0;` right before the rows, after the lines above. So an input, a
 * slider and an earlier line's variable (`flick`) are all replaced the same way: whatever the block
 * computed for it is overwritten before this line reads it. Changing an override's value only
 * changes a uniform; switching one on or off (live) is a new program.
 *
 * The program also draws for display: u_pvRaw = 0 maps the value to a colour the way the build-up
 * pictures do (rowPicture.ts: a float grey over its range, a vec2 red / green, a colour as itself);
 * u_pvRaw = 1 writes the raw value, which the canvas reads back from a small float target now and
 * then to measure the range. Pure: compiled here, drawn by ExplainLiveCanvas.tsx.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { compileNodePreviewGraph } from '../../lib/compileNodePreviewShader';
import { inject } from '../../lib/nodePreview/previewGlsl';
import type { Value } from '../../lib/glslPatterns';
import { rowsCopy, type RenderRow } from './buildUpHost';

/** The types an override (and a row) can have. */
export type LiveType = 'float' | 'vec2' | 'vec3' | 'vec4';

export interface LiveProgram {
  /** The fragment shader, with the display mapping and the row picker. */
  fs: string;
  /** The compile's own uniforms (sliders and other params), as values. */
  uniforms: Record<string, number | number[]>;
  /** Which `u_pvSel` draws a row, by row key (rows with the same expression share one). */
  slots: Map<string, number>;
  /** Each row slot's type (how it is shown). */
  slotTypes: string[];
  /** The uniform standing for each overridden name. */
  overrideUniforms: Record<string, string>;
  /** Changes only when the program does (not with an override's value). */
  key: string;
}

/** Components shown for a type: 1 (grey), 2 (red / green) or 3 (colour). */
export const compsOf = (type: string) => (type === 'vec2' ? 2 : type === 'vec3' || type === 'vec4' ? 3 : 1);

/** A row's value packed into a vec4: float → R, vec2 → RG, vec3 / vec4 → RGB. */
const pack = (v: string, type: string) =>
  type === 'vec2' ? `vec4(${v}, 0.0, 1.0)` : type === 'vec3' ? `vec4(${v}, 1.0)` : type === 'vec4' ? `vec4((${v}).rgb, 1.0)` : `vec4(float(${v}), 0.0, 0.0, 1.0)`;

const HELPERS = `uniform float u_pvSel;
uniform float u_pvRaw;
uniform vec2 u_pvRange;
uniform float u_pvComps;
vec4 pvx_show(vec4 v) {
  float k = u_pvRange.y > u_pvRange.x ? 1.0 / (u_pvRange.y - u_pvRange.x) : 0.0;
  if (u_pvComps < 1.5) { float g = k > 0.0 ? (v.r - u_pvRange.x) * k : 0.5; return vec4(vec3(clamp(g, 0.0, 1.0)), 1.0); }
  if (u_pvComps < 2.5) { vec2 g = k > 0.0 ? (v.rg - u_pvRange.x) * k : vec2(0.5); return vec4(clamp(g, 0.0, 1.0), 0.0, 1.0); }
  return vec4(clamp(v.rgb, 0.0, 1.0), 1.0);
}
`;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}

/**
 * The live program for line `at` of `node` (in `nodes`, which holds it): every row drawable, and
 * the overridden names (name → type) replaced by uniforms. Null when it doesn't compile.
 */
export function liveProgram(
  node: GraphNode, nodes: readonly GraphNode[], at: number | 'return',
  rows: readonly RenderRow[], overridden: ReadonlyArray<{ name: string; type: LiveType }>,
): LiveProgram | null {
  const distinct: Array<{ expr: string; type: string }> = [];
  const slots = new Map<string, number>();
  const byExpr = new Map<string, number>();
  for (const r of rows) {
    if (r.type === 'unknown' || !r.expr.trim()) continue;
    const k = `${r.type}|${r.expr}`;
    if (!byExpr.has(k)) { byExpr.set(k, distinct.length); distinct.push({ expr: r.expr, type: r.type }); }
    slots.set(r.key, byExpr.get(k)!);
  }
  if (!distinct.length) return null;
  const copy = rowsCopy(node, at, distinct);
  // The overrides go after the lines above and before the rows: `name = u_xo0;`
  const names = [...overridden].sort((a, b) => a.name.localeCompare(b.name));
  const overrideUniforms: Record<string, string> = {};
  const assigns = names.map((o, i) => { overrideUniforms[o.name] = `u_xo${i}`; return { lhs: o.name, op: '=', rhs: `u_xo${i}` }; });
  const lines = copy.params.lines as Array<{ lhs: string; op: string; rhs: string }>;
  const above = lines.length - distinct.length;
  copy.params = { ...copy.params, lines: [...lines.slice(0, above), ...assigns, ...lines.slice(above)] };
  const compiled = compileNodePreviewGraph(copy.id, nodes.map(n => (n.id === copy.id ? copy : n)));
  if (!compiled) return null;
  const vars = compiled.nodeOutputVars.get(copy.id) ?? {};
  const outs = distinct.map((_, i) => vars[`pv_s${i}`]);
  if (outs.some(n => !n)) return null;
  const decls = names.map(o => `uniform ${o.type} ${overrideUniforms[o.name]};\n`).join('');
  const pick = outs.map((v, i) => `  ${i ? 'else ' : ''}if (u_pvSel < ${i}.5) pv_v = ${pack(v!, distinct[i].type)};`).join('\n');
  const tail = `  vec4 pv_v = vec4(0.0);\n${pick}\n  gl_FragColor = u_pvRaw > 0.5 ? pv_v : pvx_show(pv_v);`;
  const fs = inject(compiled.fragmentShader, HELPERS + decls, tail);
  if (!fs) return null;
  return {
    fs,
    uniforms: compiled.paramUniforms as Record<string, number | number[]>,
    slots,
    slotTypes: distinct.map(d => d.type),
    overrideUniforms,
    key: `${djb2(fs)}|${fs.length}`,
  };
}

/** The uniform values the program draws with: its own, then each override's value. */
export function liveUniformValues(p: LiveProgram, overrides: Readonly<Record<string, Value>>): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = { ...p.uniforms };
  for (const [name, u] of Object.entries(p.overrideUniforms)) {
    const v = overrides[name];
    if (v !== undefined) out[u] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

/** The range of a raw read-back (RGBA floats) over the first `comps` components; null when nothing is finite. */
export function rawRange(data: Float32Array, comps: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < comps; c++) {
      const x = data[i + c];
      if (!Number.isFinite(x)) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}
