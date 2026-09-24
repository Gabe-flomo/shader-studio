/**
 * flattenSubgraph.ts — compile a group subgraph into ONE standalone GLSL function.
 *
 * This is what turns a graph into a publishable node type. The existing group
 * compiler inlines a subgraph at every instance; here we run that same
 * machinery exactly once, with the group's input ports bound to function
 * parameters instead of outer variables, and wrap the emitted body:
 *
 *   vec3 un_ripple_x1(vec2 g_uv, vec2 in_uv, float p_scale, out float out_mask) {
 *       ...the subgraph's compiled statements, unchanged...
 *       out_mask = <var>;
 *       return <var>;
 *   }
 *
 * Params inside the subgraph fall into two buckets:
 *   - surfaced (spec.params): the inner param value is replaced with the
 *     argument name (`p_<key>`); the `p()` helper passes strings through, so
 *     the node definition doesn't know the difference.
 *   - everything else: BAKED. The uniform patcher still turns eligible floats
 *     into `u_p_*` names while compiling, so afterwards each uniform is
 *     substituted back with its literal value.
 *
 * The result is pure GLSL with no reference to the source graph, so a
 * published node that contains other published nodes just carries their
 * functions as helpers — definitions never nest.
 */

import type { DataType, GraphNode, InputSocket, OutputSocket, SubgraphData } from '../types/nodeGraph';
import type { UserNodeParam, UserNodePort } from '../types/userNode';
import { ShaderAssembler } from './shaderAssembler';
import { PARTICLE_PIPELINE_TYPES } from './particleAssembler';
import { getNodeDefinition } from '../nodes/definitions';
import { f, vec3Str } from '../nodes/definitions/helpers';

/** Phantom source node id whose "outputs" are the function's input parameters. */
const FN_ARG_SENTINEL = '__fnarg__';
const ROOT_ID = 'un_root';

/** `main()`-scope variables a flattened body may reference. Each becomes a
 *  leading hidden argument when present, passed through at the call site. */
const IMPLICIT_GLOBALS: Array<{ name: string; type: string }> = [
  { name: 'g_uv', type: 'vec2' },
];

/**
 * Node types a flattened function can't contain. These are compiled by the
 * assembler outside the normal per-node path (particles), depend on per-frame
 * framebuffer state (feedback / blur family), or register per-instance
 * sampler uniforms (media inputs). A clear refusal beats a broken shader.
 */
const STATEFUL_TYPES = new Set([
  'prevFrame', 'echo', 'radianceCascadesApprox',
  'gaussianBlur', 'bloom', 'radialBlur', 'tiltShiftBlur', 'lensBlur', 'motionBlur', 'depthOfField',
]);
// textureInput is allowed: each one becomes a sampler2D argument (see spec.textures).
const MEDIA_TYPES = new Set(['audioInput', 'videoInput']);
const OUTPUT_TYPES = new Set(['output', 'vec4Output', 'scope']);

export interface FlattenSpec {
  subgraph: SubgraphData;
  /** Group-level iteration count (the group node's `iterations` param). */
  iterations?: number;
  fnName: string;
  /** Sockets of the published node, in order. `key` is the socket key on the
   *  node; `portKey` is the subgraph port it maps to. */
  inputs: Array<UserNodePort & { portKey: string }>;
  outputs: Array<UserNodePort & { portKey: string }>;
  /** Inner params to expose as live arguments. `sourcePath` is required here. */
  params: Array<UserNodeParam & { sourcePath: string }>;
  /** Texture Input nodes inside the group, each becoming a `sampler2D in_tex_<key>` argument.
   *  `sourceId` is the inner node's id. Every textureInput in the group must be listed. */
  textures?: Array<{ sourceId: string; key: string }>;
}

export type FlattenResult =
  | { ok: true; functionCode: string; helperFunctions: string[]; implicitGlobals: string[] }
  | { ok: false; error: string };

/** Texture Input nodes anywhere in the subgraph (one level of nesting), in order. */
export function findTextureInputs(subgraph: SubgraphData): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const visit = (nodes: GraphNode[], prefix: string) => {
    for (const n of nodes) {
      if (n.type === 'textureInput') out.push({ id: n.id, label: (typeof n.params.label === 'string' && n.params.label) || `${prefix}Texture ${out.length + 1}` });
      if (n.type === 'group') {
        const inner = n.params.subgraph as SubgraphData | undefined;
        if (inner) visit(inner.nodes, `${(typeof n.params.label === 'string' && n.params.label) || 'Group'} › `);
      }
    }
  };
  visit(subgraph.nodes, '');
  return out;
}

const TEX_MARK = 'texslot';

/**
 * Clone the subgraph giving every Texture Input a marker label, so the
 * sampler identifier the group compiler emits (`u_tex_<prefix>texslot<i>_<n>`)
 * can be mapped back to its slot after compilation.
 */
function markTextureInputs(subgraph: SubgraphData, slotIndex: Map<string, number>): SubgraphData {
  const mark = (nodes: GraphNode[]): GraphNode[] => nodes.map(n => {
    if (n.type === 'textureInput') {
      const idx = slotIndex.get(n.id);
      return idx === undefined ? n : { ...n, params: { ...n.params, label: `${TEX_MARK}${idx}` } };
    }
    if (n.type === 'group') {
      const inner = n.params.subgraph as SubgraphData | undefined;
      if (inner) return { ...n, params: { ...n.params, subgraph: { ...inner, nodes: mark(inner.nodes) } } };
    }
    return n;
  });
  return { ...subgraph, nodes: mark(subgraph.nodes) };
}

/** Walk the subgraph (and nested groups) and return the first unsupported type, if any. */
export function findUnsupportedNode(subgraph: SubgraphData, depth = 0): { node: GraphNode; reason: string } | null {
  for (const n of subgraph.nodes) {
    if (PARTICLE_PIPELINE_TYPES.has(n.type)) return { node: n, reason: 'particle pipeline nodes compile outside the main shader' };
    if (STATEFUL_TYPES.has(n.type)) return { node: n, reason: 'it reads the previous frame' };
    if (MEDIA_TYPES.has(n.type)) return { node: n, reason: 'texture, audio and video inputs are bound per instance' };
    if (OUTPUT_TYPES.has(n.type)) return { node: n, reason: 'output nodes belong to the graph, not a node' };
    if (!getNodeDefinition(n.type)) return { node: n, reason: `unknown node type "${n.type}"` };
    if (n.type === 'group') {
      // The published node is itself the outer group, so a group here is
      // already level 2 — the compiler inlines at most two levels deep.
      if (depth >= 1) return { node: n, reason: 'groups inside groups nest too deep for one node — ungroup the inner one first' };
      const inner = n.params.subgraph as SubgraphData | undefined;
      if (inner) {
        const hit = findUnsupportedNode(inner, depth + 1);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function zeroFor(type: string): string {
  switch (type) {
    case 'vec2': return 'vec2(0.0)';
    case 'vec3': return 'vec3(0.0)';
    case 'vec4': return 'vec4(0.0)';
    case 'mat2': return 'mat2(1.0)';
    case 'mat3': return 'mat3(1.0)';
    default: return '0.0';
  }
}

const GLSL_TYPES = new Set(['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3']);

function isGlslType(t: DataType | string): boolean {
  return GLSL_TYPES.has(t as string);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function flattenSubgraphToFunction(spec: FlattenSpec): FlattenResult {
  if (!spec.subgraph || spec.subgraph.nodes.length === 0) return { ok: false, error: 'The group is empty.' };

  // Every Texture Input must have a slot, otherwise its sampler would be an undeclared uniform.
  const texInputs = findTextureInputs(spec.subgraph);
  const slotByNode = new Map<string, number>();
  (spec.textures ?? []).forEach((t, i) => slotByNode.set(t.sourceId, i));
  for (const t of texInputs) {
    if (!slotByNode.has(t.id)) return { ok: false, error: `Texture Input "${t.label}" has no image slot on the node. Give it one in the Images section.` };
  }
  const subgraph = texInputs.length ? markTextureInputs(spec.subgraph, slotByNode) : spec.subgraph;
  if (spec.outputs.length === 0) return { ok: false, error: 'A node needs at least one output. Add an output port to the group first.' };

  const bad = findUnsupportedNode(subgraph);
  if (bad) {
    const def = getNodeDefinition(bad.node.type);
    const label = (typeof bad.node.params.label === 'string' && bad.node.params.label) || def?.label || bad.node.type;
    return { ok: false, error: `"${label}" can't be part of a published node: ${bad.reason}.` };
  }
  for (const port of [...spec.inputs, ...spec.outputs]) {
    if (!isGlslType(port.type)) return { ok: false, error: `Port "${port.label}" has type ${port.type}, which can't be a function argument.` };
  }
  if (!/^[A-Za-z_]\w*$/.test(spec.fnName)) return { ok: false, error: `"${spec.fnName}" is not a valid GLSL function name.` };

  // ── Synthetic root: a group node whose ports are wired to the phantom arg node ──
  const inputs: Record<string, InputSocket> = {};
  const argVars = new Map<string, string>(); // portKey → argument name
  for (const inp of spec.inputs) {
    const port = subgraph.inputPorts.find(p => p.key === inp.portKey);
    if (!port) return { ok: false, error: `Input port "${inp.portKey}" no longer exists in the group.` };
    const argName = `in_${inp.key}`;
    argVars.set(inp.portKey, argName);
    inputs[inp.portKey] = { type: port.type, label: port.label, connection: { nodeId: FN_ARG_SENTINEL, outputKey: inp.portKey } };
  }
  const outputs: Record<string, OutputSocket> = {};
  for (const out of spec.outputs) {
    const port = subgraph.outputPorts.find(p => p.key === out.portKey);
    if (!port) return { ok: false, error: `Output port "${out.portKey}" no longer exists in the group.` };
    outputs[out.portKey] = { type: port.type, label: port.label };
  }

  // Surfaced params: override the inner value with the argument name. The
  // group compiler applies `params["innerId::key"]` (and the two-level form
  // for nested groups) as overrides before calling generateGLSL.
  const params: Record<string, unknown> = {
    subgraph,
    iterations: Math.max(1, Math.min(16, Math.round(spec.iterations ?? 1))),
  };
  for (const prm of spec.params) params[prm.sourcePath] = `p_${prm.key}`;

  const root: GraphNode = { id: ROOT_ID, type: 'group', position: { x: 0, y: 0 }, inputs, outputs, params };

  const seed = new Map<string, Record<string, string>>();
  seed.set(FN_ARG_SENTINEL, Object.fromEntries(Array.from(argVars.entries())));

  let parts: ReturnType<ShaderAssembler['assembleParts']>;
  try {
    parts = new ShaderAssembler([root], [root], { seedOutputs: seed }).assembleParts();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The group failed to compile.' };
  }

  // Texture Inputs the caller marked as slots register `u_tex_…texslot<i>…` samplers, which
  // become the function's sampler arguments below; any other sampler is a per-instance binding.
  const foreignSamplers = Object.keys(parts.textureUniforms).filter(k => !k.includes(TEX_MARK));
  if (parts.isStateful || foreignSamplers.length || Object.keys(parts.audioUniforms).length || Object.keys(parts.videoUniforms).length) {
    return { ok: false, error: 'The group depends on per-instance uniforms (media or previous frame) and can\'t be flattened.' };
  }

  let body = parts.body;
  if (!body.trim()) return { ok: false, error: 'The group produced no code.' };

  // ── Bake every non-surfaced float param back to its literal ──────────────────
  for (const [uniform, value] of Object.entries(parts.paramUniforms)) {
    // Float sliders bake to a float literal, colour / vec3 pickers to a vec3 literal.
    body = body.replace(new RegExp(`\\b${escapeRe(uniform)}\\b`, 'g'), Array.isArray(value) ? vec3Str(value) : f(value));
  }

  // ── Output variables ─────────────────────────────────────────────────────────
  const rootOut = parts.nodeOutputVars.get(ROOT_ID) ?? {};
  const outVars: string[] = [];
  for (const out of spec.outputs) {
    const v = rootOut[out.portKey];
    if (!v) return { ok: false, error: `Output "${out.label}" isn't wired to anything inside the group.` };
    outVars.push(v);
  }

  // ── Texture Inputs → sampler arguments ───────────────────────────────────────
  const textures = spec.textures ?? [];
  body = body.replace(new RegExp(`\\bu_tex_\\w*?${TEX_MARK}(\\d+)_\\d+\\b`, 'g'), (_m, idx: string) => {
    const t = textures[Number(idx)];
    return t ? `in_tex_${t.key}` : _m;
  });
  if (/\bu_tex_\w+/.test(body)) return { ok: false, error: 'A Texture Input inside the group could not be mapped to an image slot.' };

  // ── Hidden main()-scope arguments ────────────────────────────────────────────
  const implicitGlobals = IMPLICIT_GLOBALS.filter(g => new RegExp(`\\b${g.name}\\b`).test(body));

  // ── Assemble the function ────────────────────────────────────────────────────
  const args: string[] = [
    ...implicitGlobals.map(g => `${g.type} ${g.name}`),
    ...textures.map(t => `sampler2D in_tex_${t.key}`),
    ...spec.inputs.map(i => `${i.type} in_${i.key}`),
    ...spec.params.map(p => `float p_${p.key}`),
    ...spec.outputs.slice(1).map(o => `out ${o.type} out_${o.key}`),
  ];
  const [primary, ...rest] = spec.outputs;
  const lines: string[] = [];
  lines.push(`${primary.type} ${spec.fnName}(${args.join(', ')}) {`);
  lines.push(body.replace(/\n+$/, ''));
  rest.forEach((o, i) => lines.push(`    out_${o.key} = ${outVars[i + 1]};`));
  lines.push(`    return ${outVars[0]};`);
  lines.push('}');

  return {
    ok: true,
    functionCode: lines.join('\n'),
    helperFunctions: parts.helperBlocks,
    implicitGlobals: implicitGlobals.map(g => g.name),
  };
}

export { zeroFor as zeroLiteralFor, IMPLICIT_GLOBALS };
