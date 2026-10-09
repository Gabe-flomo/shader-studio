/**
 * actions.ts — the Agent Builder's store side (docs/agent-builder.md): making a group from the
 * start page, taking it away again (Back), the graph settings its cards edit that aren't rules
 * (Born: the Emit and the group's Count; Trail: the Trail field), and presets. Each with undo.
 */
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore, undoManager } from '../store/useNodeGraphStore';
import { applyRulesToGroup, groupRules } from '../agentRules/apply';
import { agentsViewOf } from '../agentRules/outputs';
import { rulesTemplate } from '../agentRules/templates';
import { rescaleForSpace } from '../agentRules/space3d';
import { applyGroupRules } from '../agentRules/storeActions';
import type { AgentRuleSet } from '../agentRules/spec';
import { type StartCard } from './kinds';
import { trailPreset } from './presets';

/**
 * The setup round a start card's 2D group, as its template's example has it (templates.ts): the
 * Slime mold's small disc facing outward, Deposit 4 (256k walkers leave what a million would at
 * 1), and a 1024-row trail that fades fast (half-life 0.05 s) and is shown softly (Gain 0.04).
 */
const SETUP_2D: Partial<Record<StartCard['id'], { emit: Record<string, unknown>; deposit: Record<string, unknown>; trail: Record<string, unknown> }>> = {
  trail: {
    emit: { mode: 'fill', shape: 'disc', heading: 'outward', x: 0, y: 0, size: 0.15, life: 0 },
    deposit: { amount: 4 },
    trail: { resolution: '1024', diffuse: 1, halfLife: 0.05, gain: 0.04 },
  },
};

/**
 * A new group for a start-page card, in 2D or 3D, wired to the Output (one undo step: "Added an
 * Agents group"). 2D: the rules starter with the card's template; 3D: the card's 3D setup.
 * Returns its id and the nodes before (for Back).
 */
export function makeAgentGroup(card: StartCard, space: '2d' | '3d'): { groupId: string; before: GraphNode[] } | null {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const before = useNodeGraphStore.getState().nodes;
  const id = useNodeGraphStore.getState().addAgentsStarter(space === '3d' ? 'rules3d' : 'rules', undefined, space === '3d' ? card.template3d : undefined);
  if (!id) return null;
  const t = space === '2d' ? rulesTemplate(card.template) : undefined;
  if (t) {
    // Folded into the starter's own undo step: undo takes the whole group away.
    const set = t.set();
    const tune = SETUP_2D[card.id];
    const now = useNodeGraphStore.getState().nodes;
    const near = tune ? setupOf(now, id) : {};
    useNodeGraphStore.setState({ nodes: now.map(nd => {
      if (nd.id === id) return applyRulesToGroup({ ...nd, params: { ...nd.params, label: t.label } }, set);
      if (tune && nd.id === near.emit?.id) return { ...nd, params: { ...nd.params, ...tune.emit } };
      if (tune && nd.id === near.deposit?.id) return { ...nd, params: { ...nd.params, ...tune.deposit } };
      if (tune && nd.id === near.trail?.id) return { ...nd, params: { ...nd.params, ...tune.trail } };
      return nd;
    }) });
    useNodeGraphStore.getState().compile();
  }
  return { groupId: id, before };
}

/** Back from a group the builder just made: the graph as it was (undo brings the group back). */
export function discardAgentGroup(before: GraphNode[]): void {
  const st = useNodeGraphStore.getState();
  undoManager.push(st.nodes, { label: 'Agent Builder: back to the start' });
  useNodeGraphStore.setState({ nodes: before });
  st.compile();
}

/** The nodes round a group the cards edit: its Emit, Deposit and Trail field. */
export function setupOf(nodes: readonly GraphNode[], groupId: string): { group?: GraphNode; emit?: GraphNode; deposit?: GraphNode; trail?: GraphNode } {
  const group = nodes.find(x => x.id === groupId);
  const emitId = group?.inputs.emit?.connection?.nodeId;
  const emit = emitId ? nodes.find(x => x.id === emitId && x.type === 'agentEmit') : undefined;
  const deposit = nodes.find(x => x.type === 'agentDeposit' && x.inputs.agents?.connection?.nodeId === groupId);
  const trail = agentsViewOf(nodes as GraphNode[], groupId).trail ?? undefined;
  return { group, emit, deposit, trail };
}

/** A setting on a node round the group (the Emit's Shape, the Trail's Half-life, the group's Count): one undo step a burst. */
export function setSetupParam(nodeId: string | undefined, patch: Record<string, unknown>): void {
  if (!nodeId) return;
  useNodeGraphStore.getState().updateNodeParams(nodeId, patch);
}

/** A preset onto the group: its rule set (rescaled in 3D, a shape's Collide kept), one undo step. */
export function applyBuilderPreset(groupId: string, key: string): AgentRuleSet | null {
  const p = trailPreset(key);
  const g = useNodeGraphStore.getState().nodes.find(x => x.id === groupId);
  if (!p || !g) return null;
  const d3 = g.params.space === '3d';
  let set = p.set();
  if (d3) set = rescaleForSpace(set, '3d');
  const was = groupRules(g);
  if (was.collide) set = { ...set, collide: was.collide };
  applyGroupRules(groupId, set, `Agent Builder: ${p.label}`, true);
  return set;
}
