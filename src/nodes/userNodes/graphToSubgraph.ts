/**
 * graphToSubgraph.ts — turn a whole graph (the current project, or a saved
 * one) into the subgraph shape the publisher understands.
 *
 * A graph ends in an Output node; a node type ends in output ports. So:
 *   - the Output node's wired colour becomes the single output port,
 *   - the Output node itself is dropped,
 *   - optionally, every UV source node is replaced by one `vec2` input port
 *     (so the published node can be fed a warped UV instead of always reading
 *     the screen), and every Time node by one `float` input port.
 *
 * Nodes that read globals directly (pixelUV, resolution, mouse…) stay as they
 * are; inside the flattened function those globals are still in scope.
 */

import { GROUP_PORT_SENTINEL, type GraphNode, type SubgraphData, type GroupInputPort, type DataType } from '../../types/nodeGraph';

export interface GraphToSubgraphOptions {
  /** Replace UV source nodes with a `vec2` input port named "UV". Default true. */
  exposeUv?: boolean;
  /** Replace Time source nodes with a `float` input port named "Time". Default false. */
  exposeTime?: boolean;
}

export type GraphToSubgraphResult =
  | { ok: true; subgraph: SubgraphData; outputLabel: string }
  | { ok: false; error: string };

const OUTPUT_TYPES = new Set(['output', 'vec4Output']);

/**
 * Rewire every connection that reads `(fromNodeId, fromKey)` to read the
 * group port `portKey` instead, and drop the source node.
 */
function replaceSourceWithPort(nodes: GraphNode[], sourceIds: Set<string>, portKey: string): GraphNode[] {
  return nodes
    .filter(n => !sourceIds.has(n.id))
    .map(n => {
      let changed = false;
      const inputs = Object.fromEntries(Object.entries(n.inputs).map(([k, inp]) => {
        if (inp.connection && sourceIds.has(inp.connection.nodeId)) {
          changed = true;
          return [k, { ...inp, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: portKey } }];
        }
        return [k, inp];
      }));
      return changed ? { ...n, inputs } : n;
    });
}

export function graphToSubgraph(graphNodes: GraphNode[], opts: GraphToSubgraphOptions = {}): GraphToSubgraphResult {
  const exposeUv = opts.exposeUv ?? true;
  const exposeTime = opts.exposeTime ?? false;

  const outputs = graphNodes.filter(n => OUTPUT_TYPES.has(n.type));
  if (outputs.length === 0) return { ok: false, error: 'The graph has no Output node, so there is nothing to publish.' };
  const output = outputs[0];
  const colorIn = output.inputs.color;
  if (!colorIn?.connection) return { ok: false, error: 'Nothing is wired into the Output node.' };

  const source = graphNodes.find(n => n.id === colorIn.connection!.nodeId);
  if (!source) return { ok: false, error: 'The Output node is wired to a node that no longer exists.' };
  const outType: DataType = (source.outputs[colorIn.connection.outputKey]?.type ?? colorIn.type) as DataType;

  let nodes = graphNodes.filter(n => !OUTPUT_TYPES.has(n.type) && n.type !== 'scope');
  const inputPorts: GroupInputPort[] = [];

  if (exposeUv) {
    const uvIds = new Set(nodes.filter(n => n.type === 'uv').map(n => n.id));
    if (uvIds.size > 0) {
      nodes = replaceSourceWithPort(nodes, uvIds, 'in_uv');
      inputPorts.push({ key: 'in_uv', type: 'vec2', label: 'UV', toNodeId: '', toInputKey: '' });
    }
  }
  if (exposeTime) {
    const timeIds = new Set(nodes.filter(n => n.type === 'time').map(n => n.id));
    if (timeIds.size > 0) {
      nodes = replaceSourceWithPort(nodes, timeIds, 'in_time');
      inputPorts.push({ key: 'in_time', type: 'float', label: 'Time', toNodeId: '', toInputKey: '' });
    }
  }

  if (nodes.length === 0) return { ok: false, error: 'The graph has no nodes left once the Output (and exposed sources) are removed.' };

  // Deep-copy so the published source can't alias the live graph.
  const cloned = JSON.parse(JSON.stringify(nodes)) as GraphNode[];
  const outputLabel = outType === 'vec4' ? 'Color (RGBA)' : outType === 'vec3' ? 'Color' : 'Value';

  return {
    ok: true,
    outputLabel,
    subgraph: {
      nodes: cloned,
      inputPorts,
      outputPorts: [{ key: 'out0', type: outType, label: outputLabel, fromNodeId: source.id, fromOutputKey: colorIn.connection.outputKey }],
    },
  };
}
