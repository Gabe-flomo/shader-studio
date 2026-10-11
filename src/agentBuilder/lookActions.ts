/**
 * lookActions.ts — the Look section's store side (docs/agent-builder.md "Look"): a Draw agents for
 * a group that has none (the trail was the picture), and the trail's palette, each one undo step.
 * The other Look settings are Draw agents' params (actions.ts setSetupParam) or the rule set.
 */
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore, undoManager } from '../store/useNodeGraphStore';
import { placeSetupInView } from '../store/placement';
import { n } from '../store/graphBuilder';
import { graphOutput } from '../nodes/scene3dDefaults';
import { agentsViewOf } from '../agentRules/outputs';
import { CAMERA_3D } from '../agentRules/space3d';
import { setupOf } from './actions';

/** The Stops Palette (or any palette) that shows the group's trail, when there is one. */
export function trailPaletteOf(nodes: readonly GraphNode[], groupId: string): GraphNode | undefined {
  const r = agentsViewOf(nodes as GraphNode[], groupId).reader;
  const nd = r ? nodes.find(x => x.id === r.nodeId) : undefined;
  return nd?.type === 'stopPalette' ? nd : undefined;
}

/**
 * Draw the walkers too: a Draw agents over what the Output shows now (the trail's picture), and the
 * Output showing it, as one undo step. Returns its id.
 */
export function addDrawAgents(groupId: string): string | null {
  const st = useNodeGraphStore.getState();
  const before = st.nodes;
  const g = before.find(x => x.id === groupId);
  if (!g || setupOf(before, groupId).draw) return null;
  const out = graphOutput(before as GraphNode[]);
  const over = out?.inputs.color?.connection;
  const d3 = g.params.space === '3d';
  const id = st.newNodeId();
  const draw = n('drawAgents', id, g.position.x + 900, g.position.y + 300, {
    style: 'points', colorBy: 'state', palette: 'ab', size: 1.2, brightness: 0.6, scaleBy: 'walker', fade: 'on',
    ...(d3 ? { ...CAMERA_3D, agentSpace: '3d' } : {}),
    __comment: 'Draw agents (added by the Agent Builder\'s Look): every walker drawn over the picture that was there, in its kind\'s colour (Colour by State). Look sets its style, size, colour and palette.',
  }, { agents: [groupId, 'agents'], ...(over ? { over: [over.nodeId, over.outputKey] as [string, string] } : {}) });
  const [placed] = placeSetupInView(before, [draw], st._viewportRectGetter?.() ?? null, { at: { x: g.position.x + 1100, y: g.position.y + 360 } });
  undoManager.push(before, { label: 'Agent Builder: draw the walkers' });
  let nodes = [...before, placed];
  if (out) nodes = nodes.map(x => (x.id === out.id ? { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: id, outputKey: 'color' } } } } : x));
  useNodeGraphStore.setState({ nodes });
  st.compile();
  return id;
}

/**
 * Take "Draw the walkers too" back: the Draw agents goes, and whatever read its picture (the Output) reads the
 * picture it was drawn over again (the trail), as one undo step. Only when there is such a picture to fall back to.
 */
export function removeDrawAgents(groupId: string): boolean {
  const st = useNodeGraphStore.getState();
  const before = st.nodes;
  const draw = setupOf(before, groupId).draw;
  const over = draw?.inputs.over?.connection;
  if (!draw || !over) return false;
  undoManager.push(before, { label: 'Agent Builder: stop drawing the walkers' });
  const nodes = before.filter(x => x.id !== draw.id).map(x => {
    let changed = false;
    const inputs = { ...x.inputs };
    for (const [k, sock] of Object.entries(x.inputs)) {
      if (sock.connection?.nodeId === draw.id) { inputs[k] = { ...sock, connection: { ...over } }; changed = true; }
    }
    return changed ? { ...x, inputs } : x;
  });
  useNodeGraphStore.setState({ nodes });
  st.compile();
  return true;
}

/** The trail's palette set to these colours (its stop count follows), one undo step. */
export function setTrailPalette(paletteId: string, stops: Array<[number, number, number]>): void {
  const st = useNodeGraphStore.getState();
  const nd = st.nodes.find(x => x.id === paletteId);
  if (!nd) return;
  const patch: Record<string, unknown> = { stops: String(stops.length) };
  stops.forEach((c, i) => { patch[`color${i}`] = c; });
  undoManager.batch(st.nodes, () => st.updateNodeParams(paletteId, patch), { label: 'Agent Builder: the trail\'s palette', nodeIds: [paletteId] });
}
