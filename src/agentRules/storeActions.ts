/**
 * The store side of Agent Rules (docs/agent-rules.md): edits from the rules editor, Open as
 * nodes, Back to rules, each with undo and a compile; and the inside generated again when a
 * rules group's Space changes (2D ↔ 3D: the heading is an angle in one and a direction in the other).
 */
import { useNodeGraphStore, undoManager } from '../store/useNodeGraphStore';
import { toast } from '../components/ui/toastStore';
import { applyRulesToGroup, backToRules, ensureBirthEmit, openRulesAsNodes, rulesNeedRegenerating } from './apply';
import type { AgentRuleSet } from './spec';
import { setAgentsView, type AgentsView } from './outputs';

/** Ask a rules group's card to open its editor (the card's title double-click; Write as rules). */
export const openAgentRulesEditor = (groupId: string) => window.dispatchEvent(new CustomEvent('agent-rules-open', { detail: groupId }));

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
