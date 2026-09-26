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
 * passes, or are containers compiled by their own paths are rejected.
 */
import type { GraphNode, NodeDefinition } from '../types/nodeGraph';
import { PARTICLE_PIPELINE_TYPES } from './particleAssembler';

const READS_FRAME = 'it reads the previous frame';
const CONTAINER = 'groups can’t be part of a field chain yet';

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
  vParticles: 'particles are drawn in their own pass',
  group: CONTAINER,
  sceneGroup: CONTAINER,
  marchLoopGroup: CONTAINER,
  giLitMarchGroup: CONTAINER,
  spaceWarpGroup: CONTAINER,
};
for (const t of PARTICLE_PIPELINE_TYPES) FIELD_IMPURE[t] = 'particles are drawn in their own pass';

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
    const reason = FIELD_IMPURE[n.type];
    if (!reason) continue;
    const label = (typeof n.params.label === 'string' && n.params.label.trim()) || defOf(n)?.label || n.type;
    out.push(`Node ${n.id}: ${label} can't be part of a shape wired into ${consumerLabel}'s ${socketLabel}: ${reason}.`);
  }
  return out;
}
