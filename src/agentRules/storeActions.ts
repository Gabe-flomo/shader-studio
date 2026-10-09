/**
 * The store side of Agent Rules (docs/agent-rules.md): edits from the rules editor, Open as
 * nodes, Back to rules, each with undo and a compile; and the inside generated again when a
 * rules group's Space changes (2D ↔ 3D: the heading is an angle in one and a direction in the other).
 */
import { useNodeGraphStore, undoManager } from '../store/useNodeGraphStore';
import { toast } from '../components/ui/toastStore';
import { applyRulesToGroup, backToRules, ensureBirthEmit, openRulesAsNodes, rulesNeedRegenerating } from './apply';
import type { AgentRuleSet } from './spec';
import type { AgentSurprise } from './surprise';
import { setAgentsView, type AgentsView } from './outputs';
import { openAgentRulesWindow } from '../builders/windows';
import { type AgentSpace, applyTemplate3d, convertGroupSpace } from './space3d';

/** Open a rules group's rules editor (the card's Edit rules, its title double-click, Write as rules, the Builders section). */
export const openAgentRulesEditor = (groupId: string) => openAgentRulesWindow(groupId);

let last = { id: '', at: 0 };

/** The rules editor's change: the group's inside generated again (one undo step per burst of edits). */
export function applyGroupRules(groupId: string, set: AgentRuleSet, label = 'Edited agent rules'): void {
  const st = useNodeGraphStore.getState();
  const before = st.nodes;
  if (!before.some(x => x.id === groupId)) return;
  const now = Date.now();
  if (last.id !== groupId || now - last.at > 1500) undoManager.push(before, { label });
  last = { id: groupId, at: now };
  let nodes = before.map(x => (x.id === groupId ? applyRulesToGroup(x, set) : x));
  const birth = ensureBirthEmit(nodes, groupId, () => st.newNodeId());
  nodes = birth.nodes;
  if (birth.added) toast.info('Births Emit added', { message: 'A rule spawns children: a Births Emit now gives birth where the rules lay birth marks (trail channel 4). It is chained in front of the group\'s Emit.' });
  else if (birth.why) toast.info('Spawn a child needs a Trail', { message: birth.why });
  useNodeGraphStore.setState({ nodes });
  st.compile();
}

/**
 * Surprise me (agentRules/surprise.ts): the group's rules, and the Trail field that feeds it
 * (Half-life, Diffuse) and the Stops Palette that colours that trail, in one undo step.
 */
export function surpriseGroupRules(groupId: string, s: AgentSurprise, label = 'Surprise: agent rules'): boolean {
  const st = useNodeGraphStore.getState();
  const before = st.nodes;
  const g = before.find(x => x.id === groupId);
  if (!g) return false;
  undoManager.push(before, { label });
  last = { id: '', at: 0 };
  // The Trail field the group's walkers deposit into (group → Deposit → Trail field), wired or not:
  // a rule set that senses nothing has no Trail port, so the wire may be gone since an earlier surprise.
  const reads = (x: { inputs: Record<string, { connection?: { nodeId: string } }> }, id: string) => Object.values(x.inputs).some(i => i.connection?.nodeId === id);
  const deposits = before.filter(x => x.type === 'agentDeposit' && reads(x, groupId)).map(x => x.id);
  const trailId = g.inputs.trail?.connection?.nodeId ?? before.find(x => x.type === 'trailField' && deposits.some(d => reads(x, d)))?.id;
  const trail = trailId ? before.find(x => x.id === trailId && x.type === 'trailField') : undefined;
  const paletteIds = new Set(trail ? before.filter(x => x.type === 'stopPalette' && reads(x, trail.id)).map(x => x.id) : []);
  const nodes = before.map(x => {
    if (x.id === groupId) {
      const ng = applyRulesToGroup(x, s.set);
      // The Trail port came back: wire it to the Trail field again.
      if (trail && ng.inputs.trail && !ng.inputs.trail.connection) return { ...ng, inputs: { ...ng.inputs, trail: { ...ng.inputs.trail, connection: { nodeId: trail.id, outputKey: 'texture' } } } };
      return ng;
    }
    if (trail && x.id === trail.id) return { ...x, params: { ...x.params, halfLife: s.trail.halfLife, diffuse: s.trail.diffuse } };
    if (paletteIds.has(x.id)) return { ...x, params: { ...x.params, ...Object.fromEntries(s.palette.map((c, i) => [`color${i}`, c])) } };
    return x;
  });
  useNodeGraphStore.setState({ nodes });
  st.compile();
  return true;
}

function replaceGroup(groupId: string, label: string, f: (g: Parameters<typeof backToRules>[0]) => Parameters<typeof backToRules>[0]): boolean {
  const st = useNodeGraphStore.getState();
  const before = st.nodes;
  const g = before.find(x => x.id === groupId);
  if (!g) return false;
  undoManager.push(before, { label });
  last = { id: '', at: 0 };
  useNodeGraphStore.setState({ nodes: before.map(x => (x.id === groupId ? f(x) : x)) });
  st.compile();
  return true;
}

/** Open as nodes: the rules' inside, now the group's own nodes to edit (and enter it). */
export function openGroupAsNodes(groupId: string): void {
  if (!replaceGroup(groupId, 'Opened agent rules as nodes', openRulesAsNodes)) return;
  useNodeGraphStore.getState().enterGroup(groupId);
  setTimeout(() => useNodeGraphStore.getState()._fitViewCallback?.(), 150);
  toast.info('Opened as nodes', { message: 'These are the nodes the rules made, every one with a note: Start, a block per rule, Finish, Move. Edit them freely; Back to rules on the card makes them from the rules again (replacing your edits).' });
}

/** Show another of the group's outputs (a trail channel, the walkers' density): one undo step. */
export function setGroupView(groupId: string, view: AgentsView): boolean {
  const st = useNodeGraphStore.getState();
  const r = setAgentsView(st.nodes, groupId, view);
  if ('error' in r) { toast.info('Can\'t show that', { message: r.error }); return false; }
  undoManager.push(st.nodes, { label: 'Changed what the agents picture shows' });
  last = { id: '', at: 0 };
  useNodeGraphStore.setState({ nodes: r.nodes });
  st.compile();
  return true;
}

/**
 * The editor's Space switch (agentRules/space3d.ts convertGroupSpace): the group and its setup in
 * 2D or 3D (rules rescaled, Emit's shape, the Trail, a camera view), one undo step.
 */
export function setGroupSpace(groupId: string, to: AgentSpace): boolean {
  const st = useNodeGraphStore.getState();
  const r = convertGroupSpace(st.nodes, groupId, to, () => st.newNodeId());
  if (!r) return false;
  undoManager.push(st.nodes, { label: to === '3d' ? 'Agents group to 3D' : 'Agents group to 2D' });
  last = { id: '', at: 0 };
  useNodeGraphStore.setState({ nodes: r.nodes });
  st.compile();
  toast.info(to === '3d' ? 'Agents in 3D' : 'Agents flat (2D)', { message: `${r.message} Undo switches it back.` });
  return true;
}

/** A 3D template onto the group and its setup (switching it to 3D first), one undo step. */
export function applyGroupTemplate3d(groupId: string, key: string): boolean {
  const st = useNodeGraphStore.getState();
  const r = applyTemplate3d(st.nodes, groupId, key, () => st.newNodeId());
  if (!r) return false;
  undoManager.push(st.nodes, { label: 'Agent rules: 3D template' });
  last = { id: '', at: 0 };
  useNodeGraphStore.setState({ nodes: r.nodes });
  st.compile();
  return true;
}

/** Back to rules (or, for a group that never had rules, Write as rules): the inside generated from rules again. */
export function groupBackToRules(groupId: string): void {
  replaceGroup(groupId, 'Agents group back to rules', backToRules);
}

// A rules group whose Space changed: generate its inside for the new space (no undo step of its own:
// undoing the Space change brings the old inside back with it).
let syncing = false;
useNodeGraphStore.subscribe((s, prev) => {
  if (syncing || s.nodes === prev.nodes) return;
  if (!s.nodes.some(rulesNeedRegenerating)) return;
  syncing = true;
  try {
    useNodeGraphStore.setState({ nodes: s.nodes.map(x => (rulesNeedRegenerating(x) ? backToRules(x) : x)) });
    useNodeGraphStore.getState().compile();
  } finally { syncing = false; }
});
