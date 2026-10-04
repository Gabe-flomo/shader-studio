/**
 * agentGraph.ts — the Agents family in compilePassGraph (docs/agents-plan.md §3).
 *
 * A graph with an Agents-family node (an Agents group, Emit, Deposit, Trail
 * field or Draw agents, at any depth) goes through compilePassGraph, which
 * already cuts a graph into several programs sharing one slug map and one
 * uniform table. This file adds what agents need there:
 *
 *  - Trail field and Draw agents are SOURCES in every program that reads them
 *    (as a Pass is): the copy has no Deposit / Agents wire, so its GLSL only
 *    samples the engine's texture. That also cuts the one legal loop, a
 *    Trail's texture going back into the group whose Deposit fills it.
 *  - Each Agents group becomes one update shader: the group's inside, plus
 *    the outer nodes wired into its ports and its Emit chain, compiled with
 *    today's compiler under the `agentProgram` option. Agent Output is
 *    replaced by the program's sink (agentStepOut), which also takes the Emit.
 *  - Deposit, Trail and Draw are fixed engine shaders (lib/agentRunner.ts,
 *    play/kit/agentShaders.js); the compile hands the engine their settings,
 *    as numbers or the uniforms their sliders write.
 */
import type { GraphNode, NodeDefinition, SubgraphData } from '../types/nodeGraph';
import type { AgentDepositProgram, AgentDrawProgram, AgentListener, AgentParam, AgentTrailProgram } from './types';
import { getNodeDefinitionFor } from '../nodes/definitions';
import { patchNodeParamsForUniforms } from './uniformPatcher';
import { typesCompatible } from '../lib/typesCompatible';
import { fieldChainProblems, fieldInputKeys } from './fieldSockets';
import { topologicalSort } from './topoSort';
import { computeNodeSlug } from './nodeSlug';
import { AGENT_TIERS, AGENTS_GROUP_TYPE, DRAW_COLOR_BY, DRAW_STYLES, GP_PALETTE_NAMES, TRAIL_RESOLUTIONS } from '../nodes/definitions/agents';

/** Node types that send a graph down this path (at any depth). */
export const AGENTS_FAMILY = new Set([AGENTS_GROUP_TYPE, 'trailField', 'drawAgents', 'agentDeposit', 'agentEmit']);
/** Most Agents groups and Trails in one graph. */
export const MAX_AGENT_GROUPS = 4;
export const MAX_TRAILS = 4;

type Sub = { nodes?: GraphNode[] } | undefined;

/** Does the graph have an Agents-family node (at the top level or inside a group)? */
export function hasAgentsNode(nodes: GraphNode[]): boolean {
  for (const n of nodes) {
    if (AGENTS_FAMILY.has(n.type)) return true;
    const sg = n.params?.subgraph as Sub;
    if (sg?.nodes && hasAgentsNode(sg.nodes)) return true;
  }
  return false;
}

/** Nodes compiled only as sources (the engine fills their texture). */
export const isAgentSource = (n: GraphNode | undefined) => n?.type === 'trailField' || n?.type === 'drawAgents';
/** Nodes no program compiles: the engine runs them. Wires out of them carry agents, emitters or deposits. */
export const isAgentEngineOnly = (n: GraphNode | undefined) => n?.type === AGENTS_GROUP_TYPE || n?.type === 'agentDeposit' || n?.type === 'agentEmit';

/** A Trail or Draw as a source: Trail keeps no inputs, Draw only its Over (an ordinary picture). */
export function asAgentSource(n: GraphNode): GraphNode {
  if (n.type === 'drawAgents') return { ...n, inputs: n.inputs.over ? { over: n.inputs.over } : {}, bypassed: false };
  return { ...n, inputs: {}, bypassed: false };
}

/** A wire the slug sort leaves out: out of a group, a Deposit or an Emit (the engine's side of the loop). */
export const isAgentLoopWire = (c: { nodeId: string }, byId: Map<string, GraphNode>) => isAgentEngineOnly(byId.get(c.nodeId));

const labelOf = (n: GraphNode, def?: NodeDefinition) => (typeof n.params.label === 'string' && n.params.label.trim()) || def?.label || n.type;

/**
 * A node's settings for the engine: each float / colour param as the uniform
 * its slider writes (the same name every program uses), else its value.
 * Also returns the uniforms and bindings to merge into the compile's tables.
 */
export function engineParams(n: GraphNode, slug: string): { params: Record<string, AgentParam | number[]>; uniforms: Record<string, number | number[]>; bindings: Record<string, string> } {
  const def = getNodeDefinitionFor(n);
  if (!def) return { params: {}, uniforms: {}, bindings: {} };
  const { patchedNode, uniforms, bindings } = patchNodeParamsForUniforms({ ...n, id: slug }, def, undefined, n.id);
  const params: Record<string, AgentParam | number[]> = {};
  for (const key of Object.keys(def.paramDefs ?? {})) {
    const v = patchedNode.params[key] ?? def.defaultParams?.[key];
    if (typeof v === 'number' || typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'number'))) params[key] = v as AgentParam | number[];
  }
  return { params, uniforms, bindings };
}

const choice = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;

/** A group's count tier as the state texture's side. */
export const groupSide = (g: GraphNode) => AGENT_TIERS[String(g.params.tier ?? '256k')] ?? AGENT_TIERS['256k'];
export const groupSpecies = (g: GraphNode) => Math.max(1, Math.min(4, Math.round(Number(g.params.species ?? 1)) || 1));

/**
 * The node list of a group's update shader, before compiling:
 *  - the inside, with Agent Inputs' added ports rewired to what is wired
 *    into the group outside (dropped when nothing is);
 *  - the sink (agentStepOut) in place of Agent Output, with the group's Emit;
 *  - the outer nodes upstream of the group's ports and Emit (gathered by the caller's `collect`).
 * `innerIds` are the inside nodes, for the placement and purity rules.
 */
export function agentStepNodes(group: GraphNode): { inner: GraphNode[]; sink: GraphNode; starts: Array<{ nodeId: string; outputKey: string }>; problems: string[]; stateC: boolean } {
  const sg = group.params.subgraph as SubgraphData | undefined;
  const nodes = sg?.nodes ?? [];
  const problems: string[] = [];
  const inputsNode = nodes.find(n => n.type === 'agentInputs');
  const outputNode = nodes.find(n => n.type === 'agentOutput');
  const extras = new Set(((inputsNode?.params.extraInputs ?? []) as Array<{ key: string }>).map(e => e.key));
  const starts: Array<{ nodeId: string; outputKey: string }> = [];
  for (const [key, inp] of Object.entries(group.inputs)) if (inp.connection && (key === 'emit' || extras.has(key))) starts.push(inp.connection);
  const rewire = (n: GraphNode): GraphNode => {
    if (!inputsNode) return n;
    let changed = false;
    const inputs = Object.fromEntries(Object.entries(n.inputs).map(([k, inp]) => {
      const c = inp.connection;
      if (!c || c.nodeId !== inputsNode.id || !extras.has(c.outputKey)) return [k, inp];
      changed = true;
      const outer = group.inputs[c.outputKey]?.connection;
      if (outer) return [k, { ...inp, connection: outer }];
      const { connection: _drop, ...rest } = inp;
      return [k, rest];
    }));
    return changed ? { ...n, inputs } : n;
  };
  const inner = nodes.filter(n => n.type !== 'agentOutput').map(rewire);
  const out = outputNode ? rewire(outputNode) : null;
  const sinkInputs: GraphNode['inputs'] = {};
  const SINK_TYPES: Record<string, 'vec2' | 'float' | 'vec3' | 'vec4'> = {
    position: 'vec2', velocity: 'vec2', heading: 'float', speed: 'float', alive: 'float', memory: 'vec2', deposit: 'vec4', colour: 'vec3',
  };
  for (const [key, type] of Object.entries(SINK_TYPES)) {
    const inp = out?.inputs[key];
    if (!inp?.connection && !['position', 'velocity', 'heading', 'speed', 'alive'].includes(key)) continue;
    sinkInputs[key] = { type, label: key, ...(inp?.connection ? { connection: inp.connection } : {}) };
  }
  if (group.inputs.emit?.connection) sinkInputs.emit = { type: 'emitter', label: 'Emit', connection: group.inputs.emit.connection };
  const stateC = needsStateC(group, nodes, out);
  const sink: GraphNode = { id: `${group.id}__step`, type: 'agentStepOut', position: { x: 0, y: 0 }, params: stateC ? { stateC: true } : {}, outputs: {}, inputs: sinkInputs };
  if (!outputNode) problems.push(`Node ${group.id}: ${labelOf(group)} has no Agent Output inside; open it and Start over, or add the preset again.`);
  return { inner, sink, starts, problems, stateC };
}

/**
 * Does a group need per-walker state (state C and D, docs/agents-plan.md §3.3)? When it has more
 * than one species (each keeps the species its Emit gave it), when Agent Output sets Memory,
 * Deposit or Colour, or when anything inside reads Agent Inputs' Memory or Colour. Otherwise the
 * update shader is exactly P1's: two outputs, the species from the index.
 */
export function needsStateC(group: GraphNode, inside: GraphNode[], out: GraphNode | null | undefined): boolean {
  if (groupSpecies(group) > 1) return true;
  if (out && ['memory', 'deposit', 'colour'].some(k => out.inputs[k]?.connection)) return true;
  const inputsId = inside.find(n => n.type === 'agentInputs')?.id;
  return !!inputsId && inside.some(n => Object.values(n.inputs).some(i => i.connection?.nodeId === inputsId && (i.connection.outputKey === 'memory' || i.connection.outputKey === 'colour')));
}

/** Slugs for each group's inside, after the top level's (the same `used` set, so none collide). */
export function insideSlugs(groups: GraphNode[], used: Set<string>, slugs: Map<string, string>): void {
  for (const g of groups) {
    const nodes = ((g.params.subgraph as SubgraphData | undefined)?.nodes ?? []);
    let order: GraphNode[];
    try { order = topologicalSort(nodes); } catch { order = nodes; }
    for (const n of order) if (!slugs.has(n.id)) slugs.set(n.id, computeNodeSlug(n, used));
  }
}

/** Wire type and field-chain problems in a program's node list (validateGraph checks only the top level). */
export function checkProgramWires(list: GraphNode[]): string[] {
  const byId = new Map(list.map(n => [n.id, n]));
  const out: string[] = [];
  for (const n of list) {
    const def = getNodeDefinitionFor(n);
    if (!def) { out.push(`Unknown node type: ${n.type}`); continue; }
    if (n.type === 'customFn') continue;
    for (const [key, inp] of Object.entries(n.inputs)) {
      const c = inp.connection;
      if (!c) continue;
      const src = byId.get(c.nodeId);
      if (!src) continue;
      const srcDef = getNodeDefinitionFor(src);
      const from = (src.type === 'exprNode' || src.type === 'customFn') && c.outputKey === 'result'
        ? ((src.params?.outputType as string | undefined) ?? src.outputs[c.outputKey]?.type)
        : (src.outputs[c.outputKey]?.type ?? srcDef?.outputs[c.outputKey]?.type);
      const to = inp.type ?? def.inputs[key]?.type;
      if (!from || !to) continue;
      if (!typesCompatible(from, to)) out.push(`Node ${n.id} [source:${src.id}]: type mismatch on input "${key}". Expected ${to}, got ${from}`);
    }
    for (const key of fieldInputKeys(def)) out.push(...fieldChainProblems(n, key, byId, getNodeDefinitionFor));
  }
  return out;
}

/** Trails' Deposit chains: deposit id → trail id (a Deposit reaching no Trail does nothing). */
export function depositTargets(nodes: GraphNode[]): Map<string, string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = new Map<string, string>();
  for (const t of nodes) {
    if (t.type !== 'trailField') continue;
    let c = t.inputs.deposit?.connection;
    const seen = new Set<string>();
    while (c && !seen.has(c.nodeId)) {
      seen.add(c.nodeId);
      const d = byId.get(c.nodeId);
      if (d?.type !== 'agentDeposit') break;
      if (!out.has(d.id)) out.set(d.id, t.id);
      c = d.inputs.also?.connection;
    }
  }
  return out;
}

/** The engine's view of a Trail field. */
export function trailSpec(n: GraphNode, slug: string, params: Record<string, AgentParam | number[]>): Omit<AgentTrailProgram, 'live'> {
  const res = TRAIL_RESOLUTIONS[String(n.params.resolution ?? '0.5')] ?? TRAIL_RESOLUTIONS['0.5'];
  return {
    nodeId: n.id, slug, label: labelOf(n, getNodeDefinitionFor(n)),
    scale: res.scale ?? null, rows: res.rows ?? null,
    edges: choice(n.params.edges, ['wrap', 'clamp'] as const, 'wrap'),
    kernel: choice(String(n.params.kernel ?? '3'), ['3', '5'] as const, '3') === '5' ? 5 : 3,
    signed: false,
    params: params as Record<string, AgentParam>,
  };
}

/** The engine's view of a Draw agents node. */
export function drawSpec(n: GraphNode, slug: string, groupSlug: string, params: Record<string, AgentParam | number[]>): Omit<AgentDrawProgram, 'live'> {
  return {
    nodeId: n.id, slug, group: groupSlug,
    style: choice(n.params.style, DRAW_STYLES, 'points'),
    colorBy: choice(n.params.colorBy, DRAW_COLOR_BY, 'heading'),
    palette: choice(n.params.palette, ['ab', ...GP_PALETTE_NAMES], 'ab'),
    lights: Math.max(0, Math.min(4, Math.round(Number(n.params.lights ?? 0)) || 0)),
    lightMotion: choice(n.params.lightMotion, ['orbit', 'still'] as const, 'orbit'),
    fade: choice(n.params.fade, ['on', 'off'] as const, 'on') === 'on',
    scaleBy: choice(n.params.scaleBy, ['walker', 'crowd'] as const, 'walker'),
    params,
  };
}

export function depositSpec(n: GraphNode, slug: string, groupSlug: string, trailSlug: string, params: Record<string, AgentParam | number[]>): AgentDepositProgram {
  return { nodeId: n.id, slug, group: groupSlug, trail: trailSlug, what: choice(n.params.what, ['trail', 'velocity'] as const, 'trail'), params: params as Record<string, AgentParam> };
}

/** A Trail with Add or Block wired gets a step program of its own (its spread and fade, plus those). */
export const trailHasStepProgram = (n: GraphNode) => !!(n.inputs.add?.connection || n.inputs.block?.connection);

/** The end of a Trail's step program (TrailStepOutNode), wired to what its Add and Block are. */
export function trailStepSink(n: GraphNode, slug: string): GraphNode {
  const inputs: GraphNode['inputs'] = {};
  if (n.inputs.add?.connection) inputs.add = { type: 'vec4', label: 'Add', connection: n.inputs.add.connection };
  if (n.inputs.block?.connection) inputs.block = { type: 'float', label: 'Block', connection: n.inputs.block.connection };
  return { id: `${n.id}__trail`, type: 'trailStepOut', position: { x: 0, y: 0 }, params: { trail: slug }, outputs: {}, inputs };
}

/** The head of a group's Emit chain decides how births go (Fill, Rate or Keep full) and carries Burst. */
export function emitMode(group: GraphNode, byId: Map<string, GraphNode>, slugOf: (id: string) => string): { mode: 'fill' | 'rate' | 'respawn'; rate: AgentParam; burst: AgentParam } {
  const head = byId.get(group.inputs.emit?.connection?.nodeId ?? '');
  if (head?.type !== 'agentEmit') return { mode: 'fill', rate: 0, burst: 0 };
  const mode = choice(head.params.mode, ['fill', 'rate', 'respawn'] as const, 'fill');
  const { params } = engineParams(head, slugOf(head.id));
  const num = (v: unknown): AgentParam => (typeof v === 'number' || typeof v === 'string' ? v : 0);
  return { mode, rate: num(params.rate), burst: num(params.burst) };
}

/** The nodes of a group's inside that listen (Sound kick, Chladni), for the engine. */
export function listenersOf(inner: GraphNode[], slugOf: (id: string) => string, engine: (n: GraphNode) => Record<string, AgentParam | number[]>): AgentListener[] {
  const out: AgentListener[] = [];
  for (const n of inner) {
    if (n.type !== 'agentSoundKick' && n.type !== 'agentChladni') continue;
    const params = engine(n) as Record<string, AgentParam>;
    const soundFrom = typeof n.params.soundFrom === 'string' ? n.params.soundFrom : 'graph';
    if (n.type === 'agentSoundKick') { out.push({ nodeId: n.id, slug: slugOf(n.id), kind: 'kick', soundFrom, params }); continue; }
    out.push({
      nodeId: n.id, slug: slugOf(n.id), kind: 'plate', soundFrom, params,
      shape: choice(n.params.shape, ['square', 'circle'] as const, 'square'),
      modeFrom: choice(n.params.modeFrom, ['manual', 'sound'] as const, 'manual'),
      symmetry: choice(n.params.symmetry, ['minus', 'plus'] as const, 'minus'),
    });
  }
  return out;
}

/**
 * The eye preview of a node inside an Agents group (docs/agents-plan.md §12): "what an agent
 * standing at each pixel would see". A per-agent value has no picture of its own, so the target
 * and the inside nodes it depends on are compiled into the PICTURE program, marked
 * `__agentEye`: there the agent globals are this pixel (a_pos = g_uv, heading 0, species 0,
 * nothing remembered; ShaderAssemblerOptions.agentEye), so Sense's readings, a Flow or Collide
 * field, a Steer's turn show as a picture. The added ports are rewired to what is wired into the
 * group outside (a Trail reads this frame's trail). Everything else in the graph stays, so the
 * simulation keeps running under the preview. Returns null when the node isn't inside `groupId`.
 * `promote` wires the chosen output into a fresh Output (the store's buildPreviewGraph).
 */
export function agentEyeNodes(nodes: GraphNode[], groupId: string, innerId: string): { copies: GraphNode[]; rest: GraphNode[] } | null {
  const group = nodes.find(n => n.id === groupId);
  if (group?.type !== AGENTS_GROUP_TYPE) return null;
  const sg = group.params.subgraph as SubgraphData | undefined;
  const inside = sg?.nodes ?? [];
  if (!inside.some(n => n.id === innerId)) return null;
  const inputsNode = inside.find(n => n.type === 'agentInputs');
  const extras = new Set(((inputsNode?.params.extraInputs ?? []) as Array<{ key: string }>).map(e => e.key));
  const byId = new Map(inside.map(n => [n.id, n]));
  const want = new Set<string>();
  const stack = [innerId];
  while (stack.length) {
    const id = stack.pop()!;
    if (want.has(id)) continue;
    const n = byId.get(id);
    if (!n || n.type === 'agentOutput') continue;
    want.add(id);
    for (const inp of Object.values(n.inputs)) if (inp.connection && byId.has(inp.connection.nodeId)) stack.push(inp.connection.nodeId);
  }
  const copies = inside.filter(n => want.has(n.id)).map(n => {
    const inputs = Object.fromEntries(Object.entries(n.inputs).map(([k, inp]) => {
      const c = inp.connection;
      if (!c || !inputsNode || c.nodeId !== inputsNode.id || !extras.has(c.outputKey)) return [k, inp];
      const outer = group.inputs[c.outputKey]?.connection;
      if (outer) return [k, { ...inp, connection: outer }];
      const { connection: _drop, ...restInp } = inp;
      return [k, restInp];
    }));
    return { ...n, inputs, params: { ...n.params, __agentEye: true } };
  });
  return { copies, rest: nodes.filter(n => n.type !== 'output' && n.type !== 'vec4Output') };
}
