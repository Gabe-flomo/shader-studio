/**
 * agentExampleKit.ts — small builders shared by the Agents presets and examples
 * (agentExamples.ts, agentExamplesP3.ts): the plain-language note every node
 * carries, Expression Blocks with named lines, and the group node.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

/** A node's note (params.__comment): what it does in this setup, why it is there, what to try. */
export const note = (lines: string[]) => ({ __comment: lines.join('\n') });

/** A node's sockets, its definition's, with a few made by hand (Agent Inputs' added ports). */
export function withOutputs(node: GraphNode, extra: Record<string, { type: GraphNode['outputs'][string]['type']; label: string }>): GraphNode {
  return { ...node, outputs: { ...node.outputs, ...extra } };
}

type ExprType = 'float' | 'vec2' | 'vec3' | 'vec4';

/**
 * An Expression Block (exprNode) with named lines, as the app saves one: its sockets are
 * its inputs, its result one output of `outputType`. `wires` connect its inputs by name.
 * An input with a `slider` reads its value from `values` when unwired. `exposed` lines
 * (their names) are extra output sockets, as the block's "Show as output" makes them.
 */
export function expr(id: string, x: number, y: number, o: {
  label: string; inputs: Array<{ name: string; type: ExprType; slider?: { min: number; max: number } }>; lines: Array<[string, string]>;
  result: string; outputType: ExprType; wires?: Record<string, [string, string]>; note: string[];
  values?: Record<string, number>; exposed?: Array<{ name: string; type: ExprType }>;
}): GraphNode {
  const node = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(i => ({ name: i.name, type: i.type, slider: i.slider ?? null })),
    outputType: o.outputType,
    lines: o.lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result: o.result,
    expr: o.result,
    ...(o.values ?? {}),
    ...(o.exposed?.length ? { outputs: o.exposed.map(e => e.name) } : {}),
    ...note(o.note),
  });
  node.inputs = Object.fromEntries(o.inputs.map(i => [i.name, {
    type: i.type, label: `${i.name} (${i.type})`,
    ...(o.wires?.[i.name] ? { connection: { nodeId: o.wires[i.name][0], outputKey: o.wires[i.name][1] } } : {}),
  }]));
  node.outputs = {
    result: { type: o.outputType, label: `Result (${o.outputType})` },
    ...Object.fromEntries((o.exposed ?? []).map(e => [e.name, { type: e.type, label: `${e.name} (${e.type})` }])),
  };
  return node;
}

/** The group node: its inside and settings, Emit wired in. */
export function agentsGroup(id: string, x: number, y: number, emitId: string, inside: GraphNode[], params: Record<string, unknown>): GraphNode {
  return n('agentsGroup', id, x, y, {
    tier: '1m', species: '1', stepsPerFrame: 2, seed: 1, preroll: 0,
    subgraph: { nodes: inside, inputPorts: [], outputPorts: [] },
    ...params,
  }, { emit: [emitId, 'emitter'] });
}

/** Wires a group's added input (an Agent Inputs port) to an outer socket. */
export function groupInput(g: GraphNode, key: string, type: GraphNode['inputs'][string]['type'], label: string, from: [string, string]): GraphNode {
  return { ...g, inputs: { ...g.inputs, [key]: { type, label, connection: { nodeId: from[0], outputKey: from[1] } } } };
}
