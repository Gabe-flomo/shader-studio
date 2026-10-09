/**
 * actions.ts — the Expression Builder joined to the graph: open it, and Add to graph (the chain as
 * an Expression Block, its seed wired from a UV or Time node; block.ts does the work).
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { placeInFreeSpace } from '../store/agentSetup';
import { toast } from '../components/ui/toastStore';
import type { GraphNode } from '../types/nodeGraph';
import { useExprBuilder } from './store';
import { chainGraph } from './block';
import type { Chain } from './chain';

export { openExpressionBuilder } from './store';

/**
 * Add the chain's first `upTo` steps to the top level of `graph` as an Expression Block (with a
 * UV / Time node for its seed). A colour result goes into an Output whose Color is free. Pure.
 */
export function addChain(graph: GraphNode[], chain: Chain, opts: { nextId: () => string; upTo?: number; at?: { x: number; y: number } }): { nodes: GraphNode[]; blockId: string; wiredOutput: boolean } {
  const made = chainGraph(chain, { nextId: opts.nextId, upTo: opts.upTo });
  const placed = placeInFreeSpace(graph, made.nodes, opts.at ?? { x: 0, y: 0 });
  let nodes = [...graph, ...placed];
  const block = placed.find(n => n.id === made.blockId)!;
  let wiredOutput = false;
  const out = graph.find(n => n.type === 'output' && n.inputs?.color && !n.inputs.color.connection);
  if (out && block.params.outputType === 'vec3') {
    nodes = nodes.map(n => (n.id !== out.id ? n : { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { nodeId: block.id, outputKey: 'result' } } } }));
    wiredOutput = true;
  }
  return { nodes, blockId: made.blockId, wiredOutput };
}

/** Add to graph from the open builder. */
export function addBuilderChainToGraph(): string | null {
  const xb = useExprBuilder.getState();
  if (!xb.at) { toast.info('Pick a move first', { message: 'The block is the seed plus at least one move.' }); return null; }
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const now = useNodeGraphStore.getState();
  const r = addChain(now.nodes, xb.chain, { nextId: () => useNodeGraphStore.getState().newNodeId(), upTo: xb.at, at: xb.place ?? undefined });
  now.setNodesRewritten(r.nodes, 'Added a built expression');
  useNodeGraphStore.getState().focusNode(r.blockId);
  toast.success('Expression Block added', {
    message: `${xb.at} step${xb.at === 1 ? '' : 's'}, one line each with a note; the moves' numbers are its sliders.${r.wiredOutput ? ' Its colour goes to the Output.' : ''}`,
  });
  return r.blockId;
}
