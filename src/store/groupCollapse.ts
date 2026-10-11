/**
 * groupCollapse — the pure part of "Group" (the store's groupNodes): nodes of one
 * scope collapsed into a Group node. Wires that cross into the selection become
 * input ports, wires read from outside become output ports, every float slider
 * inside gets a ps_ socket, and the subgraph gets its Loop Index. The store adds
 * undo and the active-group path; the Guided Convert page (docs/guided-convert.md)
 * groups a converted graph with it without touching the store.
 */
import { GROUP_PORT_SENTINEL, type GraphNode } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';

// ─── Smart param surfacing heuristics ─────────────────────────────────────────
/** Param keys that are HIGH priority to surface (size/intensity knobs). */
const SURFACE_HIGH = new Set([
  'radius', 'scale', 'size', 'amount', 'strength', 'boost',
  'outmin', 'outmax', 'value', 'freq', 'amp', 'frequency', 'amplitude',
  'mix', 'blur', 'weight', 'intensity', 'density', 'speed',
]);
/** Param keys that should NOT be auto-surfaced (positional / rarely tweaked). */
const SURFACE_EXCLUDE = new Set([
  'posx', 'posy', 'positionx', 'positiony', 'inmin', 'inmax', 'seed',
]);

/**
 * Given a freshly-created group node whose subgraph may contain inner group nodes,
 * auto-select up to 2 params per inner group (max 8 total) as surfaced params.
 */
export function pickSurfacedParams(
  subgraphNodes: GraphNode[],
): import('../types/nodeGraph').SurfacedParam[] {
  const result: import('../types/nodeGraph').SurfacedParam[] = [];
  let total = 0;

  for (const innerGroupNode of subgraphNodes) {
    if (innerGroupNode.type !== 'group') continue;
    if (total >= 8) break;
    const innerSub = innerGroupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    if (!innerSub) continue;

    let perGroup = 0;

    // Collect all candidate (nodeId, paramKey, paramDef) triples from inner nodes
    type Candidate = { nodeId: string; paramKey: string; label: string; priority: number };
    const candidates: Candidate[] = [];

    for (const inn of innerSub.nodes) {
      if (inn.type === 'loopIndex' || inn.type === 'loopCarry') continue;
      const innDef = getNodeDefinitionFor(inn);
      if (!innDef?.paramDefs) continue;
      const floatParams = Object.entries(innDef.paramDefs).filter(
        ([, pd]) => pd.type === 'float' && pd.step !== 1,
      );
      for (const [paramKey, paramDef] of floatParams) {
        const low = paramKey.toLowerCase();
        if (SURFACE_EXCLUDE.has(low)) continue;
        const priority = SURFACE_HIGH.has(low) ? 0 : 1;
        candidates.push({ nodeId: inn.id, paramKey, label: paramDef.label, priority });
      }
    }

    // Sort by priority (HIGH first), then alphabetically
    candidates.sort((a, b) =>
      a.priority !== b.priority ? a.priority - b.priority : a.paramKey.localeCompare(b.paramKey),
    );

    // Surface up to 2 (or 1 if only 1 candidate total in the inner group)
    const limit = Math.min(candidates.length === 1 ? 1 : 2, candidates.length);
    for (let i = 0; i < limit && perGroup < 2 && total < 8; i++) {
      result.push({
        innerGroupId: innerGroupNode.id,
        nodeId: candidates[i].nodeId,
        paramKey: candidates[i].paramKey,
        label: candidates[i].label,
      });
      perGroup++;
      total++;
    }
  }
  return result;
}

/**
 * Collapse `nodeIds` (of `workingNodes`, one scope) into a Group node. Null when
 * nothing is selected or an Output is among them. `nextId` makes the Loop Index's
 * id, then the group's.
 */
export function collapseToGroup(workingNodes: GraphNode[], nodeIds: readonly string[], opts: { label?: string; nextId: () => string }): { nodes: GraphNode[]; groupId: string } | null {
  const { label, nextId } = opts;
  const selectedSet = new Set(nodeIds);
  const selectedNodes = workingNodes.filter(n => selectedSet.has(n.id));
  if (selectedNodes.length === 0) return null;
  if (selectedNodes.some(n => n.type === 'output' || n.type === 'vec4Output')) return null;

  // ── Discover dangling connections ────────────────────────────────────────
  const inputPorts: import('../types/nodeGraph').GroupInputPort[] = [];
  const outputPorts: import('../types/nodeGraph').GroupOutputPort[] = [];
  // Track which outer connections feed into the group (for group node's input sockets)
  const groupInputSockets: Record<string, import('../types/nodeGraph').InputSocket> = {};
  // Track which outer nodes need their connections updated to point at the group
  const outerReplacements: Array<{ nodeId: string; inputKey: string; newConnection: { nodeId: string; outputKey: string } }> = [];

  let portIdx = 0;
  // nodeId -> inputKey -> portKey, so the dangling connection below can be
  // rewritten to the '__port__' sentinel instead of left pointing at the
  // (now-removed) outer node — see resolveGroupPortOverrides in
  // shaderAssembler.ts for why: it's what lets the port be reused by more
  // than one internal target, and lets the target be freely rewired or
  // disconnected from inside the group afterward.
  const danglingToPort = new Map<string, Map<string, string>>();

  // INPUT PORTS: selected node inputs wired to non-selected nodes
  for (const sn of selectedNodes) {
    for (const [key, inp] of Object.entries(sn.inputs)) {
      if (!inp.connection) continue;
      if (selectedSet.has(inp.connection.nodeId)) continue;
      // This is a dangling input — create an input port
      const portKey = `in${portIdx++}`;
      inputPorts.push({
        key: portKey,
        type: inp.type,
        label: inp.connection.outputKey !== key ? inp.connection.outputKey : key,
        toNodeId: sn.id,
        toInputKey: key,
      });
      if (!danglingToPort.has(sn.id)) danglingToPort.set(sn.id, new Map());
      danglingToPort.get(sn.id)!.set(key, portKey);
      groupInputSockets[portKey] = {
        type: inp.type,
        label: key,
        connection: { ...inp.connection },
      };
    }
  }

  // Add param input sockets for each inner node's float paramDefs
  for (const sn of selectedNodes) {
    const snDef = getNodeDefinitionFor(sn);
    const snParamDefs = snDef?.paramDefs ?? {};
    for (const [paramKey, paramDef] of Object.entries(snParamDefs)) {
      if (paramDef.type !== 'float') continue;
      if (paramDef.step === 1) continue; // skip integer params
      const psKey = `ps_${sn.id}_${paramKey}`;
      groupInputSockets[psKey] = {
        type: 'float' as import('../types/nodeGraph').DataType,
        label: paramDef.label,
      };
    }
  }

  // OUTPUT PORTS: non-selected nodes wired to selected node outputs
  const seenOutputs = new Set<string>(); // "fromNodeId:fromOutputKey"
  for (const n of workingNodes) {
    if (selectedSet.has(n.id)) continue;
    for (const [key, inp] of Object.entries(n.inputs)) {
      if (!inp.connection) continue;
      if (!selectedSet.has(inp.connection.nodeId)) continue;
      const sig = `${inp.connection.nodeId}:${inp.connection.outputKey}`;
      let portKey: string;
      const existing = outputPorts.find(p => `${p.fromNodeId}:${p.fromOutputKey}` === sig);
      if (existing) {
        portKey = existing.key;
      } else {
        // Determine the output type from the source node definition
        const srcNode = selectedNodes.find(sn => sn.id === inp.connection!.nodeId);
        const srcDef = srcNode ? getNodeDefinitionFor(srcNode) : undefined;
        const outType: import('../types/nodeGraph').DataType =
          srcNode?.outputs[inp.connection.outputKey]?.type ??
          srcDef?.outputs[inp.connection.outputKey]?.type ??
          'float';
        portKey = `out${portIdx++}`;
        outputPorts.push({
          key: portKey,
          type: outType,
          label: inp.connection.outputKey,
          fromNodeId: inp.connection.nodeId,
          fromOutputKey: inp.connection.outputKey,
        });
        seenOutputs.add(sig);
      }
      outerReplacements.push({ nodeId: n.id, inputKey: key, newConnection: { nodeId: '__group__', outputKey: portKey } });
    }
  }

  // Auto-create a float output port when no explicit outer connections were found.
  // Inside scene groups the SDF result flows implicitly, so nothing triggers the
  // scan above — we need to expose the terminal float output ourselves.
  if (outputPorts.length === 0) {
    const internallyConsumed = new Set<string>();
    for (const sn of selectedNodes) {
      for (const inp of Object.values(sn.inputs)) {
        if (inp.connection && selectedSet.has(inp.connection.nodeId)) {
          internallyConsumed.add(`${inp.connection.nodeId}:${inp.connection.outputKey}`);
        }
      }
    }
    let sinkNodeId = '';
    let sinkOutKey = '';
    for (const sn of selectedNodes) {
      if (sn.type === 'loopIndex') continue;
      const snDef = getNodeDefinitionFor(sn);
      if (!snDef) continue;
      for (const [outKey, outSock] of Object.entries(snDef.outputs)) {
        if (outSock.type !== 'float') continue;
        if (!internallyConsumed.has(`${sn.id}:${outKey}`)) {
          sinkNodeId = sn.id;
          sinkOutKey = outKey;
        }
      }
    }
    if (sinkNodeId) {
      const portKey = `out${portIdx++}`;
      outputPorts.push({ key: portKey, type: 'float', label: sinkOutKey, fromNodeId: sinkNodeId, fromOutputKey: sinkOutKey });
    }
  }

  // Build group output sockets
  const groupOutputSockets: Record<string, import('../types/nodeGraph').OutputSocket> = {};
  for (const p of outputPorts) {
    groupOutputSockets[p.key] = { type: p.type, label: p.label };
  }

  // Place group at bounding box centre of selected nodes
  const xs = selectedNodes.map(n => n.position.x);
  const ys = selectedNodes.map(n => n.position.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

  // Mark all original selected nodes as immutable within the group (only
  // the node itself can't be deleted — its wiring, incl. the dangling
  // inputs just turned into ports below, stays freely editable).
  const originalNodes = selectedNodes.map(n => {
    const portMap = danglingToPort.get(n.id);
    const inputs = portMap
      ? Object.fromEntries(Object.entries(n.inputs).map(([k, inp]) => {
          const portKey = portMap.get(k);
          return [k, portKey ? { ...inp, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: portKey } } : inp];
        }))
      : n.inputs;
    return { ...n, inputs, params: { ...n.params, _groupOriginal: true } };
  });

  // Auto-inject a LoopIndex node so iteration counter `i` is always accessible
  const loopIndexNode: import('../types/nodeGraph').GraphNode = {
    id: nextId(),
    type: 'loopIndex',
    position: { x: Math.min(...xs) - 220, y: Math.min(...ys) },
    inputs: {},
    outputs: { i: { type: 'float', label: 'i' } },
    params: { _groupOriginal: true },
  };

  const groupId = nextId();
  const subgraph: import('../types/nodeGraph').SubgraphData = {
    nodes: [...originalNodes, loopIndexNode],
    inputPorts,
    outputPorts,
  };
  // Auto-surface params from any inner group nodes
  const surfacedParams = pickSurfacedParams([...originalNodes, loopIndexNode]);

  // Add ps_ sockets for surfaced params from inner groups
  for (const sp of surfacedParams) {
    const psKey = `ps_${sp.innerGroupId}_${sp.nodeId}_${sp.paramKey}`;
    const innerGrpNode = selectedNodes.find(n => n.id === sp.innerGroupId);
    const innerSub = innerGrpNode?.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    const innNode = innerSub?.nodes.find(n => n.id === sp.nodeId);
    if (!innNode) continue;
    const innDef = getNodeDefinitionFor(innNode);
    const paramDef = innDef?.paramDefs?.[sp.paramKey];
    if (!paramDef) continue;
    groupInputSockets[psKey] = {
      type: 'float' as import('../types/nodeGraph').DataType,
      label: sp.label ?? paramDef.label,
    };
  }

  const groupNode: import('../types/nodeGraph').GraphNode = {
    id: groupId,
    type: 'group',
    position: { x: cx, y: cy },
    inputs: groupInputSockets,
    outputs: groupOutputSockets,
    params: {
      label: label ?? 'Group',
      subgraph,
      ...(surfacedParams.length > 0 ? { surfacedParams } : {}),
    },
  };

  // Replace outer connections that pointed into the group
  const updatedNodes = workingNodes
    .filter(n => !selectedSet.has(n.id))
    .map(n => {
      const replacements = outerReplacements.filter(r => r.nodeId === n.id);
      if (replacements.length === 0) return n;
      const newInputs = { ...n.inputs };
      for (const r of replacements) {
        newInputs[r.inputKey] = {
          ...newInputs[r.inputKey],
          connection: { nodeId: groupId, outputKey: r.newConnection.outputKey },
        };
      }
      return { ...n, inputs: newInputs };
    });

  const finalNodes = [...updatedNodes, groupNode];
  return { nodes: finalNodes, groupId };
}
