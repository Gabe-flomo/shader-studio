/**
 * splatGraph.ts — each Splat Scene node's probe program (docs/splat-scene.md "The camera"), and its modifier program
 * (docs/splat-scene.md "Per-splat modifiers").
 *
 * The splats are drawn by a raster pass before the picture (lib/splats/engine.ts), so their camera and placement
 * must be known before the picture's program runs. The probe is a small program of the picture's kind: the chain
 * wired into the node's Ray Origin, Ray Dir, Position, Rotation and Scale, ending in the node itself as
 * SplatProbeOut (same id and params, so its slider uniforms are the node's: the engine draws it with the picture's
 * own uniforms). Drawn over a 10 × 1 target, texel x reads g_uv (0, 0), except texels 2 and 8 (0.5, 0) and 3 and 9 (0, 0.5).
 *
 * The modifier program is the chain wired into the node's Modifier (splat nodes: nodes/definitions/splatModifiers.ts,
 * and any ordinary nodes between them), ending in SplatModOut. Also of the picture's kind, the way an Agents group's
 * update shader is (compiler/agentGraph.ts): drawn over one texel per splat, its prelude reads that splat and sets the
 * per-splat globals the splat nodes read. The picture compiles without the chain (pictureGraphOf), and the chain's
 * uniforms join the picture's table, so its sliders, Play mappings and keyframes work as anywhere else.
 *
 * Only top-level Splat Scene nodes get one (a node inside a group sees the default camera; the card says so).
 */
import type { GraphNode, NodeGraph } from '../types/nodeGraph';
import type { SplatModifierProgram, SplatProbeProgram } from './types';
import { topologicalSort } from './topoSort';
import { generateFragmentShader } from './shaderAssembler';
import { SPLAT_PROBE_TYPE, SPLAT_SCENE_TYPE, splatFlipOf, splatModifierOf } from '../nodes/definitions/splatScene';
import { SPLAT_MOD_OUT_TYPE, SPLAT_NODE_TYPES, splatMoveGate } from '../nodes/definitions/splatModifiers';

const PIXEL_PRELUDE = '    vec2 g_uv = (vUv - 0.5) * 2.0;\n    g_uv.x *= u_resolution.x / u_resolution.y;\n';
/**
 * The probe's g_uv per texel, and its 0–1 place (nodes that read vUv directly, such as the UV node a March Camera is
 * often wired from, read this instead of the texel's own vUv).
 */
export const SPLAT_PROBE_PRELUDE = '    int splatProbeTexel = int(gl_FragCoord.x);\n    vec2 g_uv = splatProbeTexel == 2 || splatProbeTexel == 8 ? vec2(0.5, 0.0) : splatProbeTexel == 3 || splatProbeTexel == 9 ? vec2(0.0, 0.5) : vec2(0.0);\n    vec2 splatProbeUv = g_uv / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5;\n';

/** The probe's text from the picture-kind program: its prelude, and vUv read as the probe's point inside main(). */
export function toSplatProbe(fs: string): string {
  if (!fs.includes(PIXEL_PRELUDE)) throw new Error('the probe program could not be assembled');
  const at = fs.indexOf('void main() {');
  const head = fs.slice(0, at), body = fs.slice(at).replace(PIXEL_PRELUDE, SPLAT_PROBE_PRELUDE);
  const [pre, rest] = [body.slice(0, body.indexOf(SPLAT_PROBE_PRELUDE) + SPLAT_PROBE_PRELUDE.length), body.slice(body.indexOf(SPLAT_PROBE_PRELUDE) + SPLAT_PROBE_PRELUDE.length)];
  return head + pre + rest.replace(/\bvUv\b/g, 'splatProbeUv');
}
/** Inputs the probe reads. */
const PROBE_INPUTS = ['ro', 'rd', 'position', 'rotation', 'scale'] as const;

export const hasSplatScene = (nodes: readonly GraphNode[]): boolean => nodes.some(n => n.type === SPLAT_SCENE_TYPE);

/** Everything upstream of these wires (inside groups is the group's business: a group joins whole). */
function upstream(starts: Array<{ nodeId: string }>, byId: Map<string, GraphNode>): Map<string, GraphNode> {
  const out = new Map<string, GraphNode>();
  const stack = starts.map(s => s.nodeId);
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    const n = byId.get(id);
    if (!n) continue;
    out.set(id, n);
    for (const inp of Object.values(n.inputs)) if (inp.connection) stack.push(inp.connection.nodeId);
  }
  return out;
}

/** The probe's end: the node itself, as SplatProbeOut, with only the probe's inputs. */
export function splatProbeSink(n: GraphNode): GraphNode {
  const inputs: GraphNode['inputs'] = {};
  for (const k of PROBE_INPUTS) if (n.inputs[k]) inputs[k] = n.inputs[k];
  return { ...n, type: SPLAT_PROBE_TYPE, inputs, outputs: {} };
}

/** Every uniform table a program fills (the modifier chains' are merged into the picture's by the caller). */
export type SplatTables = Pick<SplatModifierProgram, 'paramUniforms' | 'paramBindings' | 'textureUniforms' | 'videoUniforms' | 'audioUniforms' | 'liveUniforms'>;
const TABLE_KEYS = ['paramUniforms', 'paramBindings', 'textureUniforms', 'videoUniforms', 'audioUniforms', 'liveUniforms'] as const;

/**
 * The probe programs of a graph's top-level Splat Scene nodes (slugs as the picture's, so uniforms match), and each
 * one's modifier program when its Modifier is wired. A chain's own nodes are not in the picture (pictureGraphOf), so
 * their uniforms come back in `tables`, for the caller to merge into the picture's.
 */
export function compileSplatProbes(graph: NodeGraph, slugs?: Map<string, string>): { programs: SplatProbeProgram[]; errors: string[]; tables: SplatTables } {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const programs: SplatProbeProgram[] = [];
  const errors: string[] = [];
  const tables: SplatTables = { paramUniforms: {}, paramBindings: {}, textureUniforms: {}, videoUniforms: {}, audioUniforms: {}, liveUniforms: {} };
  // Slugs taken so far: the picture's, then each modifier program's, so two chains never share a uniform by accident.
  const taken = new Map(slugs ?? []);
  for (const n of graph.nodes) {
    if (n.type !== SPLAT_SCENE_TYPE) continue;
    try {
      const sink = splatProbeSink(n);
      const wires = PROBE_INPUTS.flatMap(k => (sink.inputs[k]?.connection ? [sink.inputs[k].connection!] : []));
      const list = [...upstream(wires, byId).values(), sink];
      const r = generateFragmentShader(topologicalSort(list), list, slugs ? { slugs } : undefined);
      const program: SplatProbeProgram = { nodeId: n.id, fragmentShader: toSplatProbe(r.fragmentShader), paramUniforms: r.paramUniforms, textureUniforms: r.textureUniforms, videoUniforms: r.videoUniforms };
      if (splatModifierOf(n)) {
        const mod = compileSplatModifier(n, byId, taken);
        for (const [id, slug] of mod.slugs) taken.set(id, slug);
        for (const k of TABLE_KEYS) Object.assign(tables[k], mod.program[k]);
        program.modifier = mod.program;
      }
      programs.push(program);
    } catch (e) {
      errors.push(`Node ${n.id}: Splat Scene: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { programs, errors, tables };
}

// ── Per-splat modifiers ──────────────────────────────────────────────────────

/** The modifier targets' width: one texel per splat, this many to a row. */
export const SPLAT_MOD_WIDTH = 2048;

/**
 * A Splat Scene's names for its modifier program's own uniforms: the splat data, its probe, the splat count, and the
 * scan's box (its middle in its own coordinates and its core radius: what "relative to the scan" measures by).
 */
export function splatModUniformNames(nodeId: string): { data: string; probe: string; count: string; box: string } {
  const k = nodeId.replace(/[^A-Za-z0-9]/g, 'x');
  return { data: `u_spd_${k}`, probe: `u_spp_${k}`, count: `u_spn_${k}`, box: `u_spb_${k}` };
}

/**
 * The prelude that makes one fragment one splat: its index from the texel, its data (lib/splats/pack.ts layout), the
 * scan's placement (the probe's texels 4–7), and the per-splat globals the splat nodes read (`sp_*`). `flip` is the
 * Splat Scene's "Up is: −Y" turn, so "In the scan" has +Y up.
 */
export function splatModPrelude(nodeId: string, flip: boolean): string {
  const u = splatModUniformNames(nodeId);
  const F = flip ? 'vec3(1.0, -1.0, -1.0)' : 'vec3(1.0)';
  return [
    `    int sp_i = int(gl_FragCoord.y) * ${SPLAT_MOD_WIDTH} + int(gl_FragCoord.x);\n`,
    `    uvec4 sp_a = texelFetch(${u.data}, ivec2((sp_i & 1023) << 1, sp_i >> 10), 0);\n`,
    `    uvec4 sp_b = texelFetch(${u.data}, ivec2(((sp_i & 1023) << 1) | 1, sp_i >> 10), 0);\n`,
    `    vec4 sp_c0 = texelFetch(${u.probe}, ivec2(4, 0), 0), sp_c1 = texelFetch(${u.probe}, ivec2(5, 0), 0), sp_c2 = texelFetch(${u.probe}, ivec2(6, 0), 0);\n`,
    `    mat3 sp_M = mat3(sp_c0.xyz, sp_c1.xyz, sp_c2.xyz);\n`,
    `    sp_T = texelFetch(${u.probe}, ivec2(7, 0), 0).xyz;\n`,
    `    vec3 sp_p = uintBitsToFloat(sp_a.xyz);\n`,
    `    float sp_scale = length(sp_c0.xyz);\n`,
    `    sp_local = sp_p * ${F} * sp_scale;\n`,
    `    vec4 sp_rgba = vec4(float(sp_a.w & 255u), float((sp_a.w >> 8) & 255u), float((sp_a.w >> 16) & 255u), float(sp_a.w >> 24)) / 255.0;\n`,
    `    vec2 sp_u1 = unpackHalf2x16(sp_b.x), sp_u2 = unpackHalf2x16(sp_b.y), sp_u3 = unpackHalf2x16(sp_b.z);\n`,
    // The covariance is stored ×4 (pack.ts); trace / 3 is the mean variance along an axis, then Splat size and Scale.
    `    sp_radius = sqrt(max(0.25 * (sp_u1.x + sp_u2.y + sp_u3.y), 0.0) / 3.0) * sp_c0.w * sp_scale;\n`,
    `    uint sp_h = uint(sp_i) * 747796405u + 2891336453u;\n`,
    `    sp_h = ((sp_h >> ((sp_h >> 28u) + 4u)) ^ sp_h) * 277803737u;\n`,
    `    sp_h = (sp_h >> 22u) ^ sp_h;\n`,
    `    sp_rand = float(sp_h >> 8u) / 16777216.0;\n`,
    `    sp_index = float(sp_i);\n`,
    `    sp_count = ${u.count};\n`,
    // The scan's middle (in the scan, and in the scene) and its size (core radius × Scale), for nodes set to measure
    // relative to the scan: a scan metres across and a small object then dissolve, wave and crop alike.
    `    sp_mid = ${u.box}.xyz * ${F} * sp_scale;\n`,
    `    sp_midW = sp_M * ${u.box}.xyz + sp_T;\n`,
    `    sp_unit = max(${u.box}.w * sp_scale, 1e-4);\n`,
    `    sp_base = mat3(sp_M * sp_p + sp_T, sp_rgba.rgb, vec3(sp_rgba.a, 1.0, 0.0));\n`,
    `    vec2 g_uv = vec2(0.0);\n`,
    `    vec2 splatModUv = vec2(0.5);\n`,
  ].join('');
}

/** The modifier program's head: integer precision, its uniforms, the second target and the per-splat globals. */
export function splatModHeader(nodeId: string): string {
  const u = splatModUniformNames(nodeId);
  return [
    'precision highp int;',
    `uniform highp usampler2D ${u.data};`,
    `uniform highp sampler2D ${u.probe};`,
    `uniform float ${u.count};`,
    `uniform vec4 ${u.box};`,
    'layout(location = 1) out highp vec4 splatModOut1;',
    'mat3 sp_base; vec3 sp_local; vec3 sp_T; float sp_index; float sp_rand; float sp_count; float sp_radius; vec3 sp_mid; vec3 sp_midW; float sp_unit;',
    '',
  ].join('\n');
}

const MOD_UV_LINE = '    vec2 splatModUv = vec2(0.5);\n';

/** The picture-kind program turned into a modifier program (as toAgentProgram does for an Agents group). */
export function toSplatModProgram(fs: string, nodeId: string, flip: boolean): string {
  if (!fs.includes(PIXEL_PRELUDE) || !fs.includes('\nvarying vec2 vUv;\n')) throw new Error('the modifier program could not be assembled');
  const at = fs.indexOf('void main() {');
  const head = fs.slice(0, at).replace('\nvarying vec2 vUv;\n', `\n${splatModHeader(nodeId)}varying vec2 vUv;\n`);
  const body = fs.slice(at).replace(PIXEL_PRELUDE, splatModPrelude(nodeId, flip));
  const cut = body.indexOf(MOD_UV_LINE) + MOD_UV_LINE.length;
  return head + body.slice(0, cut) + body.slice(cut).replace(/\bvUv\b/g, 'splatModUv');
}

/** The chain wired into a Splat Scene's Modifier, compiled into its modifier program. */
export function compileSplatModifier(scene: GraphNode, byId: Map<string, GraphNode>, slugs: Map<string, string>): { program: SplatModifierProgram; slugs: Map<string, string> } {
  const wire = splatModifierOf(scene)!;
  const chain = [...upstream([wire], byId).values()];
  if (chain.some(n => n.type === SPLAT_SCENE_TYPE)) throw new Error('a Splat Scene can\'t be part of another one\'s Modifier chain');
  // Splat nodes read the per-splat globals here (anywhere else, a pretend splat at the pixel).
  const marked = chain.map(n => (SPLAT_NODE_TYPES.has(n.type) ? { ...n, params: { ...n.params, __splatProgram: true } } : n));
  const sink: GraphNode = {
    id: `${scene.id}__mod`, type: SPLAT_MOD_OUT_TYPE, position: scene.position, outputs: {},
    params: { __splatProgram: true },
    inputs: { splat: { type: 'splat', label: 'Splat', connection: wire } },
  };
  const list = [...marked, sink];
  const r = generateFragmentShader(topologicalSort(list), list, { slugs });
  // What moves the splats: the engine sorts by the moved positions while any of these is non-zero.
  let always = false;
  const gates: string[] = [];
  for (const n of chain) {
    const g = splatMoveGate(n);
    if (!g) continue;
    if ('always' in g) { always = true; continue; }
    for (const key of g.params) {
      const uniform = r.paramBindings[`${n.id}::${key}`];
      if (uniform) { gates.push(uniform); continue; }
      // A literal (or a keyframed param, which moves on its own): anything but 0 moves.
      if (n.params[key] !== 0) always = true;
    }
  }
  return {
    program: {
      nodeId: scene.id,
      fragmentShader: toSplatModProgram(r.fragmentShader, scene.id, splatFlipOf(scene)),
      uniforms: splatModUniformNames(scene.id),
      paramUniforms: r.paramUniforms, paramBindings: r.paramBindings, textureUniforms: r.textureUniforms,
      videoUniforms: r.videoUniforms, audioUniforms: r.audioUniforms, liveUniforms: r.liveUniforms,
      moves: { always, gates },
    },
    slugs: r.nodeSlugMap,
  };
}

/**
 * The graph the picture compiles: without the Modifier chains (they run in their own programs), keeping any node of
 * one that also feeds something else. A graph with no Modifier wired comes back as it is (the same object).
 */
export function pictureGraphOf(graph: NodeGraph): NodeGraph {
  const scenes = graph.nodes.filter(n => n.type === SPLAT_SCENE_TYPE && splatModifierOf(n));
  if (scenes.length === 0) return graph;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const chains = upstream(scenes.map(n => splatModifierOf(n)!), byId);
  const keep = new Set(graph.nodes.filter(n => !chains.has(n.id)).map(n => n.id));
  const stack = [...keep];
  while (stack.length) {
    const n = byId.get(stack.pop()!);
    if (!n) continue;
    for (const [k, inp] of Object.entries(n.inputs)) {
      if (!inp.connection || (n.type === SPLAT_SCENE_TYPE && k === 'modifier')) continue;
      if (!keep.has(inp.connection.nodeId)) { keep.add(inp.connection.nodeId); stack.push(inp.connection.nodeId); }
    }
  }
  const nodes = graph.nodes.filter(n => keep.has(n.id)).map(n => {
    if (n.type !== SPLAT_SCENE_TYPE || !n.inputs.modifier?.connection) return n;
    const { connection: _drop, ...rest } = n.inputs.modifier;
    return { ...n, inputs: { ...n.inputs, modifier: rest } };
  });
  return { ...graph, nodes };
}
