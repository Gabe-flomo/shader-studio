/**
 * graphWalk.ts — every Audio node in a graph, groups included, and the Audio Source each one listens to.
 *
 * Groups keep their nodes in `params.subgraph.nodes`. A node inside a group whose Audio comes in through one of the
 * group's input ports is wired to GROUP_PORT_SENTINEL (outputKey = the port's key): follow the group's own input
 * out, one level at a time. A wire from a group's output goes in through its output port. Plain, iterated and nested
 * groups all keep their nodes this way, so the engine (engine.ts) hears all of them; the compiler names their
 * uniforms after the same original node ids (compiler/shaderAssembler.ts).
 */
import { GROUP_PORT_SENTINEL, type GraphNode, type SubgraphData } from '../../types/nodeGraph';
import { AUDIO_SOURCE_TYPE, isAudioToolType } from '../../nodes/definitions/audioTools';

export interface AudioNodeRef {
  node: GraphNode;
  /** The Audio Source it listens to (itself for a source), or null when its Audio isn't wired to one. */
  sourceId: string | null;
  /** The groups it sits in, outermost first ([] at the top level). */
  path: string[];
}

interface Scope { group: GraphNode; list: readonly GraphNode[] }

const subOf = (n: GraphNode): SubgraphData | undefined => {
  const sg = n.params?.subgraph as SubgraphData | undefined;
  return sg && Array.isArray(sg.nodes) ? sg : undefined;
};

/** Follow an `audio` wire to the Audio Source it starts at, through group ports both ways. */
function resolve(conn: { nodeId: string; outputKey: string } | undefined, list: readonly GraphNode[], parents: readonly Scope[], depth = 0): string | null {
  if (!conn || depth > 16) return null;
  if (conn.nodeId === GROUP_PORT_SENTINEL) {
    const p = parents[parents.length - 1];
    if (!p) return null;
    return resolve(p.group.inputs[conn.outputKey]?.connection, p.list, parents.slice(0, -1), depth + 1);
  }
  const src = list.find(x => x.id === conn.nodeId);
  if (!src) return null;
  if (src.type === AUDIO_SOURCE_TYPE) return src.id;
  const sg = subOf(src);
  const port = sg?.outputPorts?.find(p => p.key === conn.outputKey);
  if (sg && port) return resolve({ nodeId: port.fromNodeId, outputKey: port.fromOutputKey }, sg.nodes, [...parents, { group: src, list }], depth + 1);
  return null;
}

/** Every Audio node in the graph, at any depth, with its source. */
export function collectAudioNodes(nodes: readonly GraphNode[]): AudioNodeRef[] {
  const out: AudioNodeRef[] = [];
  const walk = (list: readonly GraphNode[], parents: Scope[]) => {
    for (const n of list) {
      if (isAudioToolType(n.type)) {
        out.push({
          node: n,
          sourceId: n.type === AUDIO_SOURCE_TYPE ? n.id : resolve(n.inputs.audio?.connection, list, parents),
          path: parents.map(p => p.group.id),
        });
      }
      const sg = subOf(n);
      if (sg) walk(sg.nodes, [...parents, { group: n, list }]);
    }
  };
  walk(nodes, []);
  return out;
}

/** A node anywhere in the graph, by id (the Audio Source window opens on a source inside a group too). */
export function findNodeDeep(nodes: readonly GraphNode[], id: string): GraphNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const sg = subOf(n);
    const hit = sg ? findNodeDeep(sg.nodes, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}
