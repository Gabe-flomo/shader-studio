/**
 * graphBuilder.ts — build example graphs from the node definitions.
 *
 * Sockets come from the definition and params are the defaults plus what
 * the example changes, so a bundled graph can't drift from the node it
 * uses. Used by the Learn folder (learnExamples.ts) and the generated Node
 * Combos (comboExamples.ts).
 */
import type { GraphNode, GroupInputPort, GroupOutputPort } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import type { PlayControl, PlayRecord } from '../types/play';
import { getNodeDefinition } from '../nodes/definitions';

// ── Graph builder ───────────────────────────────────────────────────────────

type Wire = [fromId: string, outputKey: string];
type Wires = Record<string, Wire>;

/** A node of `type` at (x, y): sockets from its definition, params = defaults + `params`, inputs wired per `wires`. */
export function n(type: string, id: string, x: number, y: number, params: Record<string, unknown> = {}, wires: Wires = {}, extra: Partial<GraphNode> = {}): GraphNode {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`learnExamples: unknown node type ${type}`);
  const inputs: GraphNode['inputs'] = {};
  for (const [k, v] of Object.entries(def.inputs ?? {})) {
    inputs[k] = { type: v.type, label: v.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) };
  }
  for (const k of Object.keys(wires)) if (!inputs[k]) throw new Error(`learnExamples: ${type} has no input ${k}`);
  const outputs: GraphNode['outputs'] = {};
  for (const [k, v] of Object.entries(def.outputs ?? {})) outputs[k] = { type: v.type, label: v.label };
  return { id, type, position: { x, y }, inputs, outputs, params: { ...(def.defaultParams ?? {}), ...params }, ...extra };
}

/** An iterated group: ports in and out, a subgraph, and how many times it runs. */
export function group(id: string, x: number, y: number, o: {
  label: string; iterations: number;
  inputs: Array<{ key: string; type: GraphNode['inputs'][string]['type']; label: string; from: Wire }>;
  outputs: Array<{ key: string; type: GraphNode['outputs'][string]['type']; label: string; from: Wire }>;
  nodes: GraphNode[];
}): GraphNode {
  const inputs: GraphNode['inputs'] = {};
  const inputPorts: GroupInputPort[] = [];
  for (const p of o.inputs) {
    inputs[p.key] = { type: p.type, label: p.label, connection: { nodeId: p.from[0], outputKey: p.from[1] } };
    // The live wiring is the subgraph nodes that read GROUP_PORT_SENTINEL/p.key; toNodeId is the back-compat display target.
    const reader = o.nodes.find(sn => Object.values(sn.inputs).some(i => i.connection?.nodeId === GROUP_PORT_SENTINEL && i.connection.outputKey === p.key));
    const readerKey = reader ? Object.entries(reader.inputs).find(([, i]) => i.connection?.nodeId === GROUP_PORT_SENTINEL && i.connection.outputKey === p.key)![0] : '';
    inputPorts.push({ key: p.key, type: p.type, label: p.label, toNodeId: reader?.id ?? '', toInputKey: readerKey } as GroupInputPort);
  }
  const outputs: GraphNode['outputs'] = {};
  const outputPorts: GroupOutputPort[] = [];
  for (const p of o.outputs) {
    outputs[p.key] = { type: p.type, label: p.label };
    outputPorts.push({ key: p.key, type: p.type, label: p.label, fromNodeId: p.from[0], fromOutputKey: p.from[1] });
  }
  return { id, type: 'group', position: { x, y }, inputs, outputs, params: { label: o.label, iterations: o.iterations, subgraph: { nodes: o.nodes, inputPorts, outputPorts } } };
}

/** A reference to a group port, for wiring subgraph nodes. */
export const port = (key: string): Wire => [GROUP_PORT_SENTINEL, key];

export const ctl = (id: string, target: string, label: string, min: number, max: number, step?: number): PlayControl =>
  ({ id, target, kind: 'float', label, min, max, ...(step ? { step } : {}) });
export const colourCtl = (id: string, target: string, label: string): PlayControl => ({ id, target, kind: 'color', label, min: 0, max: 1 });

export function play(controls: PlayControl[], notes: string): PlayRecord {
  return { version: 1, controls, mappings: [], layers: [], notes };
}

export const uv = (x = 40, y = 220) => n('uv', 'uv', x, y);
export const time = (x = 40, y = 420) => n('time', 'time', x, y);
export const out = (from: Wire, x: number, y = 220) => n('output', 'out', x, y, {}, { color: from });
