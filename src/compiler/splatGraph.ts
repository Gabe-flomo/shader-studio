/**
 * splatGraph.ts — each Splat Scene node's probe program (docs/splat-scene.md "The camera").
 *
 * The splats are drawn by a raster pass before the picture (lib/splats/engine.ts), so their camera and placement
 * must be known before the picture's program runs. The probe is a small program of the picture's kind: the chain
 * wired into the node's Ray Origin, Ray Dir, Position, Rotation and Scale, ending in the node itself as
 * SplatProbeOut (same id and params, so its slider uniforms are the node's: the engine draws it with the picture's
 * own uniforms). Drawn over an 8 × 1 target, texel x reads g_uv (0, 0), except texel 2 (0.5, 0) and texel 3 (0, 0.5).
 *
 * Only top-level Splat Scene nodes get one (a node inside a group sees the default camera; the card says so).
 */
import type { GraphNode, NodeGraph } from '../types/nodeGraph';
import type { SplatProbeProgram } from './types';
import { topologicalSort } from './topoSort';
import { generateFragmentShader } from './shaderAssembler';
import { SPLAT_PROBE_TYPE, SPLAT_SCENE_TYPE } from '../nodes/definitions/splatScene';

const PIXEL_PRELUDE = '    vec2 g_uv = (vUv - 0.5) * 2.0;\n    g_uv.x *= u_resolution.x / u_resolution.y;\n';
/**
 * The probe's g_uv per texel, and its 0–1 place (nodes that read vUv directly, such as the UV node a March Camera is
 * often wired from, read this instead of the texel's own vUv).
 */
export const SPLAT_PROBE_PRELUDE = '    int splatProbeTexel = int(gl_FragCoord.x);\n    vec2 g_uv = splatProbeTexel == 2 ? vec2(0.5, 0.0) : splatProbeTexel == 3 ? vec2(0.0, 0.5) : vec2(0.0);\n    vec2 splatProbeUv = g_uv / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5;\n';

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

/** The probe programs of a graph's top-level Splat Scene nodes (slugs as the picture's, so uniforms match). */
export function compileSplatProbes(graph: NodeGraph, slugs?: Map<string, string>): { programs: SplatProbeProgram[]; errors: string[] } {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const programs: SplatProbeProgram[] = [];
  const errors: string[] = [];
  for (const n of graph.nodes) {
    if (n.type !== SPLAT_SCENE_TYPE) continue;
    try {
      const sink = splatProbeSink(n);
      const wires = PROBE_INPUTS.flatMap(k => (sink.inputs[k]?.connection ? [sink.inputs[k].connection!] : []));
      const list = [...upstream(wires, byId).values(), sink];
      const r = generateFragmentShader(topologicalSort(list), list, slugs ? { slugs } : undefined);
      programs.push({ nodeId: n.id, fragmentShader: toSplatProbe(r.fragmentShader), paramUniforms: r.paramUniforms, textureUniforms: r.textureUniforms, videoUniforms: r.videoUniforms });
    } catch (e) {
      errors.push(`Node ${n.id}: Splat Scene: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { programs, errors };
}
