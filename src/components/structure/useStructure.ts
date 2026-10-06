/**
 * useStructure — the graph read against the flows (structure/flow.ts) and its order notices
 * (structure/notices.ts), for the flow strip and its phone chip. Recomputed a moment after the
 * wiring settles (not on every frame of a drag), and it keeps the store's next-stage target
 * current so the rankers can lean to it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import { readFlow, type FlowReading } from '../../structure/flow';
import { orderNotices, type OrderNotice } from '../../structure/notices';
import { graphKey, useStructureHints } from '../../structure/hintsStore';

/** The node whose picture the top-level Output shows (what feeds its colour). */
export function outputFeeder(nodes: readonly GraphNode[]): GraphNode | null {
  const out = nodes.find(n => n.type === 'output' || n.type === 'vec4Output');
  const c = out && Object.values(out.inputs ?? {}).find(i => i?.connection)?.connection;
  return (c && nodes.find(n => n.id === c.nodeId)) || null;
}

/** Wiring only: types, ids and connections (positions left out, so a drag doesn't recompute). */
function wiringSignature(nodes: readonly GraphNode[]): string {
  const parts: string[] = [];
  const walk = (list: readonly GraphNode[]) => {
    for (const n of list) {
      parts.push(n.id, n.type, n.bypassed ? 'b' : '');
      for (const [k, i] of Object.entries(n.inputs ?? {})) if (i?.connection) parts.push(k, i.connection.nodeId, i.connection.outputKey);
      const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) { parts.push('['); walk(sg.nodes); parts.push(']'); }
      if (n.params?.iterations) parts.push(`i${n.params.iterations}`);
    }
  };
  walk(nodes);
  return parts.join('|');
}

export interface Structure {
  reading: FlowReading | null;
  notices: OrderNotice[];
  /** Notices before dismissals (for the count of dismissed ones). */
  allNotices: OrderNotice[];
  graph: string;
}

export function useStructure(): Structure {
  const nodes = useNodeGraphStore(s => s.nodes);
  const graph = useNodeGraphStore(s => graphKey(s.currentGraph?.name));
  const noticesOn = useStructureHints(s => s.noticesOn);
  const stripOn = useStructureHints(s => s.stripOn);
  const dismissed = useStructureHints(s => s.dismissed[graph]);
  const setTarget = useStructureHints(s => s.setTarget);
  const sig = useMemo(() => wiringSignature(nodes), [nodes]);
  const [state, setState] = useState<{ reading: FlowReading | null; notices: OrderNotice[] }>({ reading: null, notices: [] });

  useEffect(() => {
    // Read the latest nodes when the wiring has settled for a moment.
    const t = window.setTimeout(() => {
      const now = useNodeGraphStore.getState().nodes;
      try {
        const reading = readFlow(now);
        setState({ reading, notices: orderNotices(now) });
      } catch { /* a malformed graph: no hints */ }
    }, 150);
    return () => window.clearTimeout(t);
  }, [sig]);

  useEffect(() => {
    const r = state.reading;
    setTarget(stripOn && r?.next ? { flow: r.flow, stage: r.next } : null);
  }, [state.reading, stripOn, setTarget]);

  const notices = useMemo(
    () => (noticesOn ? state.notices.filter(n => !(dismissed ?? []).includes(n.id)) : []),
    [state.notices, noticesOn, dismissed],
  );
  return { reading: state.reading, notices, allNotices: state.notices, graph };
}
