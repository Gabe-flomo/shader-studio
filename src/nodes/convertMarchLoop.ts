/**
 * convertMarchLoop.ts — turn a March Loop Group into a GI Lit March Group and back
 * (docs/light-scene.md). The node keeps its id, its inside (the loop body), every setting the
 * two share (steps, distance, warp safety, jitter, colours…) and every wire whose socket exists
 * on both. Pure; the store (convertMarchLoop) runs it with undo, a compile and a toast.
 *
 * To GI Lit: GI lights the scene itself, so a Light the scene rig made for this loop
 * (`__lightRig`) is taken out, and an Output that showed it shows the GI Lit Color instead.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from './definitions';

export type MarchLoopType = 'marchLoopGroup' | 'giLitMarchGroup';
export const isMarchLoopType = (t: string): t is MarchLoopType => t === 'marchLoopGroup' || t === 'giLitMarchGroup';

export interface ConvertedLoop {
  nodes: GraphNode[];
  /** Wires from outputs the new type doesn't have (GI's AO, Shadow… going back to a plain loop). */
  dropped: number;
  /** Nodes of a Light the scene rig taken out (going to GI Lit). */
  removedRig: number;
}

export function convertMarchLoop(nodes: GraphNode[], id: string, to: MarchLoopType): ConvertedLoop | null {
  const old = nodes.find(nd => nd.id === id);
  const def = getNodeDefinition(to);
  if (!old || !def || !isMarchLoopType(old.type) || old.type === to) return null;

  const inputs: GraphNode['inputs'] = {};
  for (const [k, s] of Object.entries(def.inputs)) inputs[k] = { type: s.type, label: s.label, ...(old.inputs[k]?.connection ? { connection: old.inputs[k].connection } : {}) };
  // Ports the loop body added (extra inputs) stay as they are.
  for (const [k, s] of Object.entries(old.inputs)) if (!inputs[k] && !k.match(/^(ro|rd|scene|uv|time|bg|albedo|lightDir|lightColor|skyTop|skyBot)$/)) inputs[k] = s;
  const outputs: GraphNode['outputs'] = {};
  for (const [k, s] of Object.entries(def.outputs)) outputs[k] = { type: s.type, label: s.label };
  for (const [k, s] of Object.entries(old.outputs)) if (/^acc\d+$/.test(k)) outputs[k] = s;

  const params = { ...(def.defaultParams ?? {}), ...old.params };
  delete params._schemaVersion;
  if (def.version) params._schemaVersion = def.version;
  const converted: GraphNode = { ...old, type: to, inputs, outputs, params };

  // A rig made for this loop goes when the loop lights itself.
  const rig = to === 'giLitMarchGroup' ? new Set(nodes.filter(nd => nd.params.__lightRig === id).map(nd => nd.id)) : new Set<string>();
  let dropped = 0;
  const next = nodes.filter(nd => !rig.has(nd.id)).map(nd => {
    if (nd.id === id) return converted;
    let changed = false;
    const ins = Object.fromEntries(Object.entries(nd.inputs).map(([k, s]) => {
      const c = s.connection;
      if (!c) return [k, s];
      if (c.nodeId === id && !outputs[c.outputKey]) { dropped++; changed = true; return [k, { ...s, connection: undefined }]; }
      if (rig.has(c.nodeId)) {
        changed = true;
        // The Output showed the rig: show the GI picture instead.
        return [k, nd.type === 'output' && k === 'color' ? { ...s, connection: { nodeId: id, outputKey: 'color' } } : { ...s, connection: undefined }];
      }
      return [k, s];
    }));
    return changed ? { ...nd, inputs: ins } : nd;
  });
  return { nodes: next, dropped, removedRig: rig.size };
}
