/**
 * publishUserNode.ts — turn a group node + the user's choices into a
 * UserNodeDefinition. Pure: no store, no storage. The store action wraps this
 * and registers the result.
 */

import type { GraphNode, SubgraphData, DataType } from '../../types/nodeGraph';
import type { UserNodeDefinition, UserNodeParam, UserNodePort } from '../../types/userNode';
import { flattenSubgraphToFunction } from '../../compiler/flattenSubgraph';
import { makeUserNodeId } from './userNodeRegistry';

export interface PublishPortSpec {
  /** The subgraph port this socket maps to. */
  portKey: string;
  /** Socket key on the published node (a valid identifier, unique). */
  key: string;
  label: string;
  type: DataType;
  slider?: { min: number; max: number; step?: number; default: number } | null;
}

export interface PublishParamSpec extends UserNodeParam {
  sourcePath: string;
}

export interface PublishUserNodeSpec {
  label: string;
  category: string;
  description?: string;
  inputs: PublishPortSpec[];
  outputs: PublishPortSpec[];
  params: PublishParamSpec[];
  /** Re-publish over an existing definition (keeps its id and function name). */
  existingId?: string;
}

export type PublishResult =
  | { ok: true; def: UserNodeDefinition }
  | { ok: false; error: string };

function fnNameFor(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

export function buildUserNodeDefinition(groupNode: GraphNode, spec: PublishUserNodeSpec): PublishResult {
  const subgraph = groupNode.params.subgraph as SubgraphData | undefined;
  if (!subgraph) return { ok: false, error: 'This group has no contents to publish.' };
  const label = spec.label.trim();
  if (!label) return { ok: false, error: 'Give the node a name.' };

  const keys = new Set<string>();
  for (const port of [...spec.inputs, ...spec.outputs, ...spec.params]) {
    if (!/^[A-Za-z_]\w*$/.test(port.key)) return { ok: false, error: `"${port.key}" is not a valid socket key.` };
    if (keys.has(port.key)) return { ok: false, error: `Two sockets or params share the key "${port.key}".` };
    keys.add(port.key);
  }

  const id = spec.existingId ?? makeUserNodeId(label);
  const fnName = fnNameFor(id);
  const iterations = typeof groupNode.params.iterations === 'number' ? groupNode.params.iterations : 1;

  const flat = flattenSubgraphToFunction({
    subgraph,
    iterations,
    fnName,
    inputs: spec.inputs.map(i => ({ key: i.key, portKey: i.portKey, type: i.type, label: i.label, slider: i.slider ?? null })),
    outputs: spec.outputs.map(o => ({ key: o.key, portKey: o.portKey, type: o.type, label: o.label })),
    params: spec.params,
  });
  if (!flat.ok) return flat;

  const inputs: UserNodePort[] = spec.inputs.map(i => ({ key: i.key, type: i.type, label: i.label, slider: i.type === 'float' ? (i.slider ?? null) : null }));
  const outputs: UserNodePort[] = spec.outputs.map(o => ({ key: o.key, type: o.type, label: o.label }));
  const params: UserNodeParam[] = spec.params.map(p => ({
    key: p.key, label: p.label, min: p.min, max: p.max, step: p.step, default: p.default, hint: p.hint, sourcePath: p.sourcePath,
  }));

  return {
    ok: true,
    def: {
      id,
      label,
      category: spec.category.trim() || 'My Nodes',
      description: spec.description?.trim() || undefined,
      inputs,
      outputs,
      params,
      fnName,
      functionCode: flat.functionCode,
      helperFunctions: flat.helperFunctions,
      implicitGlobals: flat.implicitGlobals,
      source: { kind: 'subgraph', subgraph, iterations },
      version: 1,
      savedAt: Date.now(),
    },
  };
}
