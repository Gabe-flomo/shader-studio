/**
 * graphWalk.ts — every Audio node in a graph, groups included, and the Audio Source each one listens to.
 *
 * Groups keep their nodes in `params.subgraph.nodes`. A node inside a group whose Audio comes in through one of the
 * group's input ports is wired to GROUP_PORT_SENTINEL (outputKey = the port's key): follow the group's own input
 * out, one level at a time; in an Agents group the wire comes from Agent Inputs' added port of that key instead (a
 * Sound port, docs/agents-group.md). A wire from a group's output goes in through its output port. Plain, iterated and nested
 * groups all keep their nodes this way, so the engine (engine.ts) hears all of them; the compiler names their
 * uniforms after the same original node ids (compiler/shaderAssembler.ts).
 */
import { GROUP_PORT_SENTINEL, type GraphNode, type SubgraphData } from '../../types/nodeGraph';
import { AUDIO_SOURCE_TYPE, isAudioProducerType, isAudioToolType } from '../../nodes/definitions/audioTools';

export interface AudioNodeRef {
  node: GraphNode;
  /** The node whose sound it takes: an Audio Source or an effect (Filter, Resonator bank, Spectral); itself for a source; null when its Audio isn't wired to one. */
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
  if (isAudioProducerType(src.type)) return src.id;
  // An Agents group's added input (Agent Inputs' "from outside the group" ports): the group's own socket of that key.
  if (src.type === 'agentInputs' && parents.length) {
    const p = parents[parents.length - 1];
    return resolve(p.group.inputs[conn.outputKey]?.connection, p.list, parents.slice(0, -1), depth + 1);
  }
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

/** Every node at any depth that `keep` takes (the Audio Source's Video tab lists the graph's video nodes). */
export function collectNodesDeep(nodes: readonly GraphNode[], keep: (n: GraphNode) => boolean): GraphNode[] {
  const out: GraphNode[] = [];
  const walk = (list: readonly GraphNode[]) => {
    for (const n of list) {
      if (keep(n)) out.push(n);
      const sg = subOf(n);
      if (sg) walk(sg.nodes);
    }
  };
  walk(nodes);
  return out;
}

/**
 * What plays through the speakers when effects (Filter, Resonator bank, Spectral) change an Audio Source's sound
 * (docs/audio-tools.md, "Audio → audio"). The rule:
 *  - an effect is heard when its Listen is on and no effect after it (fed by it, at any distance) has Listen on: the
 *    last listening node of each chain plays, the ones before it go quiet (no double playback);
 *  - an Audio Source's own (dry) sound goes quiet as soon as any effect after it has Listen on;
 *  - a Mic's chain is never played (it would feed back into the microphone), and its source never was.
 * Also each effect's root: the Audio Source its chain starts at (null when it isn't wired to one).
 */
export function audioHearing(refs: readonly AudioNodeRef[], kindOf: (sourceId: string) => string | null): {
  heard: Set<string>; dryMuted: Set<string>; rootOf: Map<string, string | null>;
} {
  const fx = new Map(refs.filter(r => r.node.type !== AUDIO_SOURCE_TYPE && isAudioProducerType(r.node.type)).map(r => [r.node.id, r]));
  const rootOf = new Map<string, string | null>();
  const root = (id: string, depth = 0): string | null => {
    if (rootOf.has(id)) return rootOf.get(id)!;
    const r = fx.get(id);
    const up = r?.sourceId ?? null;
    const out = !r ? null : up === null || depth > 64 ? null : fx.has(up) ? root(up, depth + 1) : kindOf(up) !== null ? up : null;
    rootOf.set(id, out);
    return out;
  };
  for (const id of fx.keys()) root(id);
  const listens = (id: string) => fx.get(id)?.node.params.listen !== false;
  const playable = (id: string) => { const s = rootOf.get(id); return !!s && kindOf(s) !== 'mic'; };
  // Effects that have a listening effect somewhere after them.
  const shadowed = new Set<string>();
  for (const id of fx.keys()) {
    if (!listens(id) || !playable(id)) continue;
    let up = fx.get(id)!.sourceId, guard = 0;
    while (up && fx.has(up) && guard++ < 64) { shadowed.add(up); up = fx.get(up)!.sourceId; }
  }
  const heard = new Set<string>(), dryMuted = new Set<string>();
  for (const id of fx.keys()) {
    if (!listens(id) || !playable(id)) continue;
    dryMuted.add(rootOf.get(id)!);
    if (!shadowed.has(id)) heard.add(id);
  }
  return { heard, dryMuted, rootOf };
}
