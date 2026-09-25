/**
 * publishUserNode.ts — turn a group node + the user's choices into a
 * UserNodeDefinition. Pure: no store, no storage. The store action wraps this
 * and registers the result.
 */

import { GROUP_PORT_SENTINEL, type GraphNode, type SubgraphData, type DataType, type GroupInputPort } from '../../types/nodeGraph';
import type { UserNodeDefinition, UserNodeIterations, UserNodeParam, UserNodePort, UserNodeTexture } from '../../types/userNode';
import { flattenSubgraphToFunction, findTextureInputs } from '../../compiler/flattenSubgraph';
import { makeUserNodeId } from './userNodeRegistry';
import { parseCodeSource, describeEntry, renameAndCanonicalise, type CodeFunction } from './codeSource';

export interface PublishPortSpec {
  /** The subgraph port this socket maps to. */
  portKey: string;
  /** Socket key on the published node (a valid identifier, unique). */
  key: string;
  label: string;
  type: DataType;
  slider?: { min: number; max: number; step?: number; default: number } | null;
  hint?: string;
}

export interface PublishParamSpec extends UserNodeParam {
  sourcePath: string;
}

export interface PublishTextureSpec {
  /** Texture Input node id (subgraph source) or sampler2D parameter name (code source). */
  sourceKey: string;
  key: string;
  label: string;
  hint?: string;
}

export interface PublishUserNodeSpec {
  label: string;
  category: string;
  description?: string;
  inputs: PublishPortSpec[];
  outputs: PublishPortSpec[];
  params: PublishParamSpec[];
  /** Image slots, in argument order. */
  textures?: PublishTextureSpec[];
  /** Re-publish over an existing definition (keeps its id and function name). */
  existingId?: string;
  /** Expose the group's iteration count as a stepped slider (one pre-built variant per count in [min, max]). */
  iterations?: { key: string; label: string; min: number; max: number; default: number };
}

export type PublishResult =
  | { ok: true; def: UserNodeDefinition }
  | { ok: false; error: string };

function fnNameFor(id: string): string {
  // GLSL reserves identifiers with consecutive underscores.
  return id.replace(/[^A-Za-z0-9_]/g, '_').replace(/_{2,}/g, '_');
}

/** What gets published: a group node on the canvas, one Expression Block or Custom Function node,
 *  a subgraph built from a whole graph, or GLSL written by hand. */
export type PublishSource =
  | { kind: 'group'; node: GraphNode }
  | { kind: 'node'; node: GraphNode }
  | { kind: 'subgraph'; subgraph: SubgraphData; label: string; iterations?: number }
  | { kind: 'code'; code: string; entry?: string; label: string };

/** Node types that can be published on their own, without grouping first. */
export const SINGLE_NODE_PUBLISH_TYPES: ReadonlySet<string> = new Set(['exprNode', 'customFn']);

/** The sockets an Expression Block / Custom Function declares (they are dynamic, from params.inputs). */
export interface DynamicInputSpec { name: string; type: string; slider?: { min: number; max: number } | null }

export function dynamicInputs(node: GraphNode): DynamicInputSpec[] {
  const raw = node.params.inputs;
  return Array.isArray(raw) ? (raw as DynamicInputSpec[]).filter(i => i && typeof i.name === 'string') : [];
}

/** The label a single-node source publishes under. */
export function singleNodeLabel(node: GraphNode): string {
  const l = typeof node.params.label === 'string' ? node.params.label.trim() : '';
  return l || (node.type === 'customFn' ? 'Custom Function' : 'Expression');
}

/**
 * Wrap one Expression Block or Custom Function in a one-node subgraph so it
 * publishes exactly like a group would: every declared input becomes an input
 * port (wired or not — a slider input's current value is offered as the
 * port's slider default), `result` becomes the output port, and a Custom
 * Function's helper block travels along inside the node's params.
 */
export function nodeToSubgraph(node: GraphNode): SubgraphData {
  const inner = JSON.parse(JSON.stringify(node)) as GraphNode & { carryMode?: unknown; assignOp?: unknown };
  inner.position = { x: 0, y: 0 };
  delete inner.carryMode;
  delete inner.assignOp;
  const inputPorts: GroupInputPort[] = [];
  for (const spec of dynamicInputs(node)) {
    const sock = inner.inputs[spec.name];
    if (!sock) continue;
    const type = (sock.type || spec.type) as DataType;
    inner.inputs[spec.name] = { ...sock, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: spec.name } };
    inputPorts.push({ key: spec.name, type, label: spec.name, toNodeId: inner.id, toInputKey: spec.name });
  }
  // Carry sockets (`<name>_init`) only mean something inside a loop.
  for (const k of Object.keys(inner.inputs)) if (k.endsWith('_init') && !inputPorts.some(p => p.key === k)) delete inner.inputs[k];
  const declared = typeof node.params.outputType === 'string' ? node.params.outputType : undefined;
  const outType = (declared || node.outputs.result?.type || 'float') as DataType;
  inner.outputs = { result: { type: outType, label: 'Result' } };
  return {
    nodes: [inner],
    inputPorts,
    outputPorts: [{ key: 'result', type: outType, label: 'Result', fromNodeId: inner.id, fromOutputKey: 'result' }],
  };
}

export function sourceSubgraph(source: PublishSource): { subgraph: SubgraphData | undefined; iterations: number; label: string } {
  if (source.kind === 'group') {
    return {
      subgraph: source.node.params.subgraph as SubgraphData | undefined,
      iterations: typeof source.node.params.iterations === 'number' ? source.node.params.iterations : 1,
      label: typeof source.node.params.label === 'string' ? source.node.params.label : 'Group',
    };
  }
  if (source.kind === 'node') return { subgraph: nodeToSubgraph(source.node), iterations: 1, label: singleNodeLabel(source.node) };
  if (source.kind === 'code') return { subgraph: undefined, iterations: 1, label: source.label };
  return { subgraph: source.subgraph, iterations: source.iterations ?? 1, label: source.label };
}

/** The sockets a source offers, in a shape the publish dialog can turn into rows. */
export interface SourcePorts {
  /** `slider` is a suggested range for a float port: a single node's slider input offers its current value as the default. */
  inputs: Array<{ portKey: string; type: DataType; label: string; slider?: { min: number; max: number; default: number } }>;
  outputs: Array<{ portKey: string; type: DataType; label: string }>;
  textures: Array<{ sourceKey: string; label: string }>;
  /** Code sources: the functions found, and which one is the entry. */
  functions?: CodeFunction[];
  entry?: string;
  error?: string;
}

export const CODE_RETURN_PORT = '__return__';

export function describeSource(source: PublishSource): SourcePorts {
  if (source.kind === 'code') {
    const parsed = parseCodeSource(source.code);
    if (!parsed.ok) return { inputs: [], outputs: [], textures: [], error: parsed.error };
    const entry = parsed.functions.find(f => f.name === source.entry) ?? parsed.functions[0];
    const d = describeEntry(entry);
    if (!d.ok) return { inputs: [], outputs: [], textures: [], functions: parsed.functions, entry: entry.name, error: d.error };
    return {
      functions: parsed.functions,
      entry: entry.name,
      inputs: d.inputs.map(p => ({ portKey: p.name, type: p.type as DataType, label: p.name })),
      outputs: [
        { portKey: CODE_RETURN_PORT, type: entry.returnType as DataType, label: 'Result' },
        ...d.outs.map(p => ({ portKey: p.name, type: p.type as DataType, label: p.name })),
      ],
      textures: d.textures.map(p => ({ sourceKey: p.name, label: p.name })),
    };
  }
  const { subgraph } = sourceSubgraph(source);
  if (!subgraph) return { inputs: [], outputs: [], textures: [], error: 'This group has no contents.' };
  const sliderFor = (portKey: string) => {
    if (source.kind !== 'node') return undefined;
    const spec = dynamicInputs(source.node).find(i => i.name === portKey);
    if (!spec?.slider || spec.type !== 'float') return undefined;
    const v = source.node.params[portKey];
    return { min: spec.slider.min, max: spec.slider.max, default: typeof v === 'number' ? v : 0 };
  };
  return {
    inputs: subgraph.inputPorts.map(p => ({ portKey: p.key, type: p.type, label: p.label, slider: sliderFor(p.key) })),
    outputs: subgraph.outputPorts.map(p => ({ portKey: p.key, type: p.type, label: p.label })),
    textures: findTextureInputs(subgraph).map(t => ({ sourceKey: t.id, label: t.label })),
  };
}

export function buildUserNodeDefinition(source: PublishSource, spec: PublishUserNodeSpec): PublishResult {
  const label = spec.label.trim();
  if (!label) return { ok: false, error: 'Give the node a name.' };

  const keys = new Set<string>();
  for (const port of [...spec.inputs, ...spec.outputs, ...spec.params, ...(spec.textures ?? [])]) {
    if (!/^[A-Za-z_]\w*$/.test(port.key)) return { ok: false, error: `"${port.key}" is not a valid socket key.` };
    if (keys.has(port.key)) return { ok: false, error: `Two sockets or params share the key "${port.key}".` };
    keys.add(port.key);
  }

  const id = spec.existingId ?? makeUserNodeId(label);
  const fnName = fnNameFor(id);
  // A slider whose default sits outside its range draws no ticks around the
  // needle and clamps on first touch; fix the range up front instead.
  const tidyRange = <T extends { min: number; max: number; default: number }>(r: T): T => {
    const min = Math.min(r.min, r.max);
    const max = Math.max(r.min, r.max) === min ? min + 1 : Math.max(r.min, r.max);
    return { ...r, min, max, default: Math.min(max, Math.max(min, r.default)) };
  };
  const textures: UserNodeTexture[] = (spec.textures ?? []).map(t => ({ key: t.key, label: t.label, hint: t.hint?.trim() || undefined }));
  const inputs: UserNodePort[] = spec.inputs.map(i => ({
    key: i.key, type: i.type, label: i.label,
    slider: i.type === 'float' && i.slider ? tidyRange(i.slider) : null,
    hint: i.hint?.trim() || undefined,
  }));
  const outputs: UserNodePort[] = spec.outputs.map(o => ({ key: o.key, type: o.type, label: o.label, hint: o.hint?.trim() || undefined }));
  const common = {
    id, label,
    category: spec.category.trim() || 'My Nodes',
    description: spec.description?.trim() || undefined,
    inputs, outputs, fnName,
    textures: textures.length ? textures : undefined,
    version: 1 as const,
    savedAt: Date.now(),
  };

  // ── Hand-written GLSL ────────────────────────────────────────────────────────
  if (source.kind === 'code') {
    const ports = describeSource(source);
    if (ports.error || !ports.functions || !ports.entry) return { ok: false, error: ports.error ?? 'Could not read the code.' };
    if (spec.outputs.length === 0 || spec.outputs[0].portKey !== CODE_RETURN_PORT) return { ok: false, error: 'The first output must be the function’s return value.' };
    const renamed = renameAndCanonicalise(ports.functions, ports.entry, fnName, {
      textures: (spec.textures ?? []).map(t => t.sourceKey),
      inputs: spec.inputs.map(i => i.portKey),
      outs: spec.outputs.slice(1).map(o => o.portKey),
    });
    if ('error' in renamed) return { ok: false, error: renamed.error };
    const implicitGlobals = /\bg_uv\b/.test(renamed.entryCode + renamed.helpers.join('\n')) ? ['g_uv'] : [];
    return {
      ok: true,
      def: {
        ...common,
        params: [],
        functionCode: renamed.entryCode,
        helperFunctions: renamed.helpers,
        implicitGlobals,
        source: { kind: 'code', code: source.code, entry: ports.entry },
      },
    };
  }

  // ── A graph ──────────────────────────────────────────────────────────────────
  const { subgraph, iterations } = sourceSubgraph(source);
  if (!subgraph) return { ok: false, error: 'This group has no contents to publish.' };

  const flattenAt = (count: number, name: string) => flattenSubgraphToFunction({
    subgraph,
    iterations: count,
    fnName: name,
    inputs: spec.inputs.map(i => ({ key: i.key, portKey: i.portKey, type: i.type, label: i.label, slider: i.slider ?? null })),
    outputs: spec.outputs.map(o => ({ key: o.key, portKey: o.portKey, type: o.type, label: o.label })),
    params: spec.params,
    textures: (spec.textures ?? []).map(t => ({ sourceId: t.sourceKey, key: t.key })),
  });

  let iterationsOut: UserNodeIterations | undefined;
  let flat;
  if (spec.iterations) {
    const it = spec.iterations;
    const min = Math.max(1, Math.min(16, Math.round(it.min)));
    const max = Math.max(min, Math.min(16, Math.round(it.max)));
    const def = Math.max(min, Math.min(max, Math.round(it.default)));
    if (keys.has(it.key)) return { ok: false, error: `The iterations slider key "${it.key}" clashes with a socket or param.` };
    const functions: Record<string, string> = {};
    for (let n = min; n <= max; n++) {
      const r = flattenAt(n, `${fnName}_i${n}`);
      if (!r.ok) return r;
      functions[String(n)] = r.functionCode;
    }
    flat = flattenAt(def, `${fnName}_i${def}`);
    if (!flat.ok) return flat;
    iterationsOut = { key: it.key, label: it.label, min, max, default: def, functions };
  } else {
    flat = flattenAt(iterations, fnName);
    if (!flat.ok) return flat;
  }

  const params: UserNodeParam[] = spec.params.map(p => ({
    key: p.key, label: p.label, ...tidyRange({ min: p.min, max: p.max, default: p.default }), step: p.step, hint: p.hint?.trim() || undefined, sourcePath: p.sourcePath,
  }));

  return {
    ok: true,
    def: {
      ...common,
      params,
      functionCode: flat.functionCode,
      helperFunctions: flat.helperFunctions,
      implicitGlobals: flat.implicitGlobals,
      iterations: iterationsOut,
      // A single node publishes as the subgraph that wraps it: "Open source" places that group.
      source: { kind: 'subgraph', subgraph, iterations },
    },
  };
}
