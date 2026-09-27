/**
 * Saved things → what the node builder (PublishNodeModal) publishes: a whole
 * saved graph, a group inside one, a group preset, a Custom Function or an
 * Expression Block. Pure: callers read storage and pass the records in.
 */
import type { CustomFnPreset } from '../types/customFnPreset';
import type { ExprPreset } from '../types/exprPreset';
import type { GroupPreset } from '../types/groupPreset';
import type { DataType, GraphNode, InputSocket } from '../types/nodeGraph';
import type { PublishSource } from '../nodes/userNodes/publishUserNode';

/** A Custom Function preset as the node it places (what the palette's double-click adds). */
export function customFnNode(p: CustomFnPreset): GraphNode {
  return presetNode('customFn', p.inputs, p.outputType, { label: p.label, inputs: p.inputs, outputType: p.outputType, body: p.body, glslFunctions: p.glslFunctions });
}

/** An Expression Block preset as the node it places. */
export function exprNode(p: ExprPreset): GraphNode {
  return presetNode('exprNode', p.inputs, p.outputType, { label: p.label, inputs: p.inputs, outputType: p.outputType, lines: p.lines, result: p.result });
}

function presetNode(type: 'customFn' | 'exprNode', inputs: Array<{ name: string; type: DataType; slider?: { min: number; max: number } | null }>, outputType: DataType, params: Record<string, unknown>): GraphNode {
  const sockets: Record<string, InputSocket> = {};
  const values: Record<string, unknown> = {};
  for (const i of inputs) {
    sockets[i.name] = { type: i.type, label: i.name };
    // A slider input starts in the middle of its range, as a freshly placed node does.
    if (i.slider && i.type === 'float') values[i.name] = (i.slider.min + i.slider.max) / 2;
  }
  return {
    id: `pk_${type}`, type, position: { x: 0, y: 0 },
    inputs: sockets, outputs: { result: { type: outputType, label: 'Result' } },
    params: { ...values, ...params },
  };
}

export function customFnSource(p: CustomFnPreset): PublishSource { return { kind: 'node', node: customFnNode(p) }; }
export function exprSource(p: ExprPreset): PublishSource { return { kind: 'node', node: exprNode(p) }; }
export function groupPresetSource(p: GroupPreset): PublishSource { return { kind: 'subgraph', subgraph: p.subgraph, label: p.label }; }

export interface GraphGroup {
  node: GraphNode;
  label: string;
  /** "Outer › Inner" for a group inside a group. */
  path: string;
  nodeCount: number;
}

/** Every plain group in a graph, nested ones too (scene groups and march loops publish differently, so they aren't offered). */
export function groupsIn(nodes: readonly GraphNode[], prefix = ''): GraphGroup[] {
  const out: GraphGroup[] = [];
  for (const n of nodes) {
    const sub = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (n.type !== 'group' || !sub?.nodes) continue;
    const label = (typeof n.params.label === 'string' && n.params.label.trim()) || 'Group';
    const path = prefix ? `${prefix} › ${label}` : label;
    out.push({ node: n, label, path, nodeCount: sub.nodes.length });
    out.push(...groupsIn(sub.nodes, path));
  }
  return out;
}
