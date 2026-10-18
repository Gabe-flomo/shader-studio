/**
 * actions.ts — the Agent Builder's store side (docs/agent-builder.md): making a group from the
 * start page, taking it away again (Back), the graph settings its cards edit that aren't rules
 * (Born: the Emit and the group's Count; Trail: the Trail field; Look: Draw agents), and presets.
 * Each with undo: making the setup is a step of its own, and each burst of edits after it another.
 */
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore, undoManager } from '../store/useNodeGraphStore';
import { freshIds } from '../store/agentSetup';
import { placeSetupInView } from '../store/placement';
import { graphOutput } from '../nodes/scene3dDefaults';
import { applyRulesToGroup, groupRules, isRulesGroup } from '../agentRules/apply';
import { agentsViewOf } from '../agentRules/outputs';
import { rulesTemplate, rulesTemplateNodes } from '../agentRules/templates';
import { rescaleForSpace } from '../agentRules/space3d';
import { applyGroupRules } from '../agentRules/storeActions';
import { type AgentRuleSet, WALKER_KINDS, kindOf } from '../agentRules/spec';
import { type StartCard } from './kinds';
import { builderPreset } from './presets';

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
 * A 2D template's whole example setup (agentRules/templates.ts rulesTemplateNodes: its Emits, the
 * group, Deposit, Trail, picture and Draw agents), fresh ids, placed in free space and wired to
 * the Output, as one undo step. Returns the group's id.
 */
function addTemplateSetup(card: StartCard): string | null {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const before = useNodeGraphStore.getState().nodes;
  const all = rulesTemplateNodes(card.template, 'ab', 0, 0, true);
  if (!all.length) return null;
  const outNode = all.find(x => x.type === 'output');
  const out = outNode?.inputs.color?.connection;
  const { nodes: fresh, idOf } = freshIds(all.filter(x => x !== outNode), () => st.newNodeId());
  // Centred in the visible canvas, off any card there (store/placement.ts).
  const placed = placeSetupInView(before, fresh, st._viewportRectGetter?.() ?? null, { at: st._viewportCenterGetter?.() });
  undoManager.push(before, { label: `Added an Agents group (${card.label})` });
  const output = graphOutput(before);
  let nodes = [...before, ...placed];
  if (output && out) nodes = nodes.map(x => (x.id === output.id ? { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: idOf(out.nodeId), outputKey: out.outputKey } } } } : x));
  useNodeGraphStore.setState({ nodes });
  useNodeGraphStore.getState().compile();
  const id = idOf('abAgents');
  useNodeGraphStore.getState().focusNode(id);
  return id;
}

/**
 * A new group for a start-page card, in 2D or 3D, wired to the Output (one undo step: "Added an
 * Agents group"). 2D: Trail followers is the rules starter with the slime template; the other
 * kinds are their template's own example setup (with its Draw agents). 3D: the card's 3D setup
 * (Crowds: the 3D flock's setup with the crowd's rules, rescaled). Returns its id and the nodes
 * before (for Back).
 */
export function makeAgentGroup(card: StartCard, space: '2d' | '3d'): { groupId: string; before: GraphNode[] } | null {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const before = useNodeGraphStore.getState().nodes;
  if (space === '2d' && card.id !== 'trail') {
    const id = addTemplateSetup(card);
    return id ? { groupId: id, before } : null;
  }
  const id = useNodeGraphStore.getState().addAgentsStarter(space === '3d' ? 'rules3d' : 'rules', undefined, space === '3d' ? card.template3d : undefined);
  if (!id) return null;
  const t = rulesTemplate(card.template);
  const crowd3d = space === '3d' && card.id === 'crowd';
  if (t && (space === '2d' || crowd3d)) {
    // Folded into the starter's own undo step: undo takes the whole group away.
    const set = crowd3d ? rescaleForSpace(t.set(), '3d') : t.set();
    const tune = space === '2d' ? SETUP_2D[card.id] : undefined;
    const now = useNodeGraphStore.getState().nodes;
    const near = tune ? setupOf(now, id) : {};
    useNodeGraphStore.setState({ nodes: now.map(nd => {
      if (nd.id === id) return applyRulesToGroup({ ...nd, params: { ...nd.params, label: crowd3d ? 'Crowd in 3D' : t.label } }, set);
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

/** The nodes round a group the cards edit: its Emit, Deposit, Trail field and Draw agents. */
export function setupOf(nodes: readonly GraphNode[], groupId: string): { group?: GraphNode; emit?: GraphNode; deposit?: GraphNode; trail?: GraphNode; draw?: GraphNode } {
  const group = nodes.find(x => x.id === groupId);
  const emitId = group?.inputs.emit?.connection?.nodeId;
  const emit = emitId ? nodes.find(x => x.id === emitId && x.type === 'agentEmit') : undefined;
  const deposit = nodes.find(x => x.type === 'agentDeposit' && x.inputs.agents?.connection?.nodeId === groupId);
  const trail = agentsViewOf(nodes as GraphNode[], groupId).trail ?? undefined;
  const draw = nodes.find(x => x.type === 'drawAgents' && x.inputs.agents?.connection?.nodeId === groupId);
  return { group, emit, deposit, trail, draw };
}

let burst = { key: '', at: 0 };
/** The next setting starts an undo step of its own (a diagram drag just ended: its step is closed). */
export function endSetupBurst(): void { burst = { key: '', at: 0 }; }

/**
 * A setting on a node round the group (the Emit's Shape, the Trail's Half-life, the group's Count,
 * Draw agents' Size): one undo step a burst of the same setting, of its own (never folded into
 * the step that made the setup, or into another setting's).
 */
export function setSetupParam(nodeId: string | undefined, patch: Record<string, unknown>, label = 'Agent Builder: setting'): void {
  if (!nodeId) return;
  const st = useNodeGraphStore.getState();
  const key = `${nodeId}:${Object.keys(patch).sort().join(',')}`;
  const now = Date.now();
  const fresh = burst.key !== key || now - burst.at > 1500;
  burst = { key, at: now };
  // Immediate, as a card's own slider is: a slider whose uniform is compiled (Draw agents' camera, Size,
  // Brightness…) reaches the picture this frame without a recompile, anything else compiles now. Without it
  // every tick re-armed a 500 ms compile, so nothing moved while a slider was dragged (Distance, Angle,
  // Orbit speed "did nothing") and each pause recompiled the whole agents spec.
  if (fresh) undoManager.batch(st.nodes, () => st.updateNodeParams(nodeId, patch, { immediate: true }), { label, nodeIds: [nodeId] });
  else undoManager.quietly(() => st.updateNodeParams(nodeId, patch, { immediate: true }));
}

/** A preset onto the group: its rule set (rescaled in 3D, a shape's Collide kept), one undo step. */
export function applyBuilderPreset(groupId: string, key: string): AgentRuleSet | null {
  const p = builderPreset(key);
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

// ── Your presets (builders/userPresets.ts, kind 'agents'): the group's rules, saved as text ──

/** A rules group's setup as preset text: its rules and the space they were made in. */
export function agentPresetText(groupId: string): string {
  const g = useNodeGraphStore.getState().nodes.find(x => x.id === groupId);
  if (!g) return '';
  return JSON.stringify({ space: g.params.space === '3d' ? '3d' : '2d', set: groupRules(g) });
}

/** Load preset text into a group (one undo step), rescaled when it was saved in the other space. Null when it can't be read. */
export function applyAgentPresetText(groupId: string, text: string, label: string): AgentRuleSet | null {
  const g = useNodeGraphStore.getState().nodes.find(x => x.id === groupId);
  if (!g) return null;
  let parsed: { space?: string; set?: AgentRuleSet };
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed?.set || typeof parsed.set !== 'object') return null;
  const to = g.params.space === '3d' ? '3d' : '2d';
  let set = parsed.set;
  if ((parsed.space === '3d' ? '3d' : '2d') !== to) set = rescaleForSpace(set, to);
  applyGroupRules(groupId, set, `Agent Builder: ${label}`, true);
  return set;
}

// ── Opening the builder on a graph that already has groups; clearing the graph ──

/** A builder group on the top level (a rules Agents group), as the "Edit this one / Start over / Add another" prompt lists it. */
export interface BuilderGroup { id: string; label: string; kind: string; d3: boolean }

/** The rules Agents groups on the top level of `nodes` (the ones the Agent Builder makes and edits). */
export function builderGroups(nodes: readonly GraphNode[]): BuilderGroup[] {
  return nodes.filter(isRulesGroup).map(g => ({
    id: g.id,
    label: (typeof g.params.label === 'string' && g.params.label) || 'Agents',
    kind: WALKER_KINDS[kindOf(groupRules(g))].label,
    d3: g.params.space === '3d',
  }));
}

const isOutput = (n: GraphNode) => n.type === 'output' || n.type === 'vec4Output';

/** How many nodes the start page's "Clear the graph first" would take away (all but the Output). */
export const clearableCount = (nodes: readonly GraphNode[]) => nodes.filter(n => !isOutput(n)).length;

export const unwired = (n: GraphNode, gone: (id: string) => boolean): GraphNode => ({
  ...n, inputs: Object.fromEntries(Object.entries(n.inputs).map(([k, v]) => [k, v.connection && gone(v.connection.nodeId) ? { ...v, connection: undefined } : v])),
});

/**
 * The start page's "Clear the graph first": everything but the Output (unwired), one undo step of its
 * own ("Agent Builder: cleared the graph"). Returns the graph as it was, for Back.
 */
export function clearGraphForBuilder(label = 'Agent Builder: cleared the graph'): GraphNode[] {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const before = useNodeGraphStore.getState().nodes;
  undoManager.push(before, { label });
  const nodes = before.filter(isOutput).map(n => unwired(n, () => true));
  useNodeGraphStore.setState({ nodes, selectedNodeId: null, selectedNodeIds: [] });
  useNodeGraphStore.getState().compile();
  return before;
}

/**
 * The nodes that belong to a group's setup and nothing else: the group, then (until nothing changes)
 * every node only the setup reads from (its Emit, a picture wired only into it) and every node that
 * reads only from the setup (Deposit, Trail field, its palette, Draw agents). The Output and nodes
 * with no wires at all are never part of it. Pure.
 */
export function agentSetupIds(nodes: readonly GraphNode[], groupId: string): Set<string> {
  if (!nodes.some(n => n.id === groupId)) return new Set();
  const ids = new Set<string>([groupId]);
  const sources = (n: GraphNode) => Object.values(n.inputs).map(i => i.connection?.nodeId).filter((x): x is string => !!x);
  const readers = new Map<string, string[]>();
  for (const n of nodes) for (const s of sources(n)) readers.set(s, [...(readers.get(s) ?? []), n.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (ids.has(n.id) || isOutput(n)) continue;
      const from = sources(n), to = readers.get(n.id) ?? [];
      const downstream = from.length > 0 && from.every(x => ids.has(x));
      const upstream = to.length > 0 && to.every(x => ids.has(x));
      if (downstream || upstream) { ids.add(n.id); grew = true; }
    }
  }
  return ids;
}

/** "Start over": take a group and its setup away (agentSetupIds), one undo step. */
export function removeAgentSetup(groupId: string, label = 'Agent Builder: started over'): boolean {
  return removeSetupNodes(agentSetupIds(useNodeGraphStore.getState().nodes, groupId), label);
}

/**
 * Take a set of nodes away (and the wires into them), one undo step: "Start over" on any kind of
 * builder-made scene (builders/sceneKinds.ts). False when there is nothing to take.
 */
export function removeSetupNodes(gone: ReadonlySet<string>, label: string): boolean {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const before = useNodeGraphStore.getState().nodes;
  if (!gone.size || !before.some(n => gone.has(n.id))) return false;
  undoManager.push(before, { label });
  const nodes = before.filter(n => !gone.has(n.id)).map(n => unwired(n, id => gone.has(id)));
  useNodeGraphStore.setState({ nodes, selectedNodeId: null, selectedNodeIds: [] });
  useNodeGraphStore.getState().compile();
  return true;
}
