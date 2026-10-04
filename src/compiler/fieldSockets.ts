/**
 * Field sockets — shared by validate.ts and the assembler.
 *
 * A field socket receives the wired node's code as a function of position
 * rather than its value (see docs/field-sockets.md). The "field chain" is the
 * wired node plus everything upstream of it; the assembler compiles that
 * chain a second time inside `T fieldfn_…(vec2 g_uv, …)`, where the
 * parameter named g_uv makes every UV node and every unwired-position
 * default relative to the call.
 *
 * A node can only be part of a chain if it is a pure function of position,
 * time and uniforms. Nodes that read the previous frame, render their own
 * passes, or are 3D containers compiled by their own paths are rejected.
 * A Group is allowed (its subgraph is compiled into the function, iterations
 * and all) as long as nothing inside it is rejected.
 */
import type { GraphNode, NodeDefinition, SubgraphData } from '../types/nodeGraph';

const READS_FRAME = 'it reads the previous frame';
const CONTAINER = 'a 3D group renders its own scene, not a function of 2D position';

/** Node type → why it can't be part of a field chain. */
export const FIELD_IMPURE: Record<string, string> = {
  echo: READS_FRAME,
  prevFrame: READS_FRAME,
  previousFrame: READS_FRAME,
  radianceCascadesApprox: READS_FRAME,
  gaussianBlur: READS_FRAME,
  bloom: READS_FRAME,
  radialBlur: READS_FRAME,
  tiltShiftBlur: READS_FRAME,
  lensBlur: READS_FRAME,
  motionBlur: READS_FRAME,
  depthOfField: READS_FRAME,
  playLayers: 'it composites Play layers, which are whole pictures, not a function of position',
  // docs/field-sockets.md lists particles among the rejected nodes; this entry is what enforces it.
  gpuParticles: 'its particles are simulated and drawn by an engine outside the shader, not a function of position',
  sceneGroup: CONTAINER,
  marchLoopGroup: CONTAINER,
  giLitMarchGroup: CONTAINER,
  spaceWarpGroup: CONTAINER,
};

/**
 * The first node inside `group`'s subgraph (nested groups included) that can't
 * be part of a field chain, with the reason, or null when the whole group can.
 */
export function impureInsideGroup(group: GraphNode, defOf: (n: GraphNode) => NodeDefinition | undefined): { label: string; reason: string } | null {
  const sub = group.params.subgraph as SubgraphData | undefined;
  for (const n of sub?.nodes ?? []) {
    const reason = FIELD_IMPURE[n.type];
    if (reason) return { label: (typeof n.params.label === 'string' && n.params.label.trim()) || defOf(n)?.label || n.type, reason };
    if (n.type === 'group') {
      const hit = impureInsideGroup(n, defOf);
      if (hit) return hit;
    }
  }
  return null;
}

/** Why `n` can't be part of a field chain, or undefined when it can. */
export function fieldProblemOf(n: GraphNode, defOf: (n: GraphNode) => NodeDefinition | undefined): string | undefined {
  const reason = FIELD_IMPURE[n.type];
  if (reason) return reason;
  if (n.type === 'group') {
    const hit = impureInsideGroup(n, defOf);
    if (hit) return `it contains ${hit.label}, ${hit.reason.startsWith('it ') ? `which ${hit.reason.slice(3)}` : `and ${hit.reason}`}`;
  }
  return undefined;
}

/** Input keys of a definition that are field sockets. */
export function fieldInputKeys(def: NodeDefinition | undefined): string[] {
  if (!def) return [];
  return Object.entries(def.inputs).filter(([, s]) => s.field).map(([k]) => k);
}

/** Ids of the node `startId` and everything upstream of it (nodes missing from `nodeMap` are skipped). */
export function collectFieldChain(startId: string, nodeMap: ReadonlyMap<string, GraphNode>): Set<string> {
  const chain = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    if (chain.has(id)) continue;
    const n = nodeMap.get(id);
    if (!n) continue;
    chain.add(id);
    for (const inp of Object.values(n.inputs)) if (inp.connection) stack.push(inp.connection.nodeId);
  }
  return chain;
}

/**
 * Problems with the chain wired into `consumer`'s field socket `key`, as
 * `Node <id>: …` messages (the format nodeErrors.ts attributes to cards).
 */
export function fieldChainProblems(
  consumer: GraphNode,
  key: string,
  nodeMap: ReadonlyMap<string, GraphNode>,
  defOf: (n: GraphNode) => NodeDefinition | undefined,
): string[] {
  const conn = consumer.inputs[key]?.connection;
  if (!conn) return [];
  const consumerDef = defOf(consumer);
  const consumerLabel = (typeof consumer.params.label === 'string' && consumer.params.label.trim()) || consumerDef?.label || consumer.type;
  const socketLabel = consumerDef?.inputs[key]?.label ?? key;
  const out: string[] = [];
  for (const id of collectFieldChain(conn.nodeId, nodeMap)) {
    const n = nodeMap.get(id)!;
    const reason = fieldProblemOf(n, defOf);
    if (!reason) continue;
    const label = (typeof n.params.label === 'string' && n.params.label.trim()) || defOf(n)?.label || n.type;
    out.push(`Node ${n.id}: ${label} can't be part of a shape wired into ${consumerLabel}'s ${socketLabel}: ${reason}.`);
  }
  return out;
}
