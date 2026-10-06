/**
 * The "Rules (When … Do …)" choice when a bare Agents group is added: the Slime starter's setup
 * (Emit → Agents → Deposit → Trail field → palette), its group in rules mode with the default
 * rule set (turn toward its trail, wander, leave trail), so it moves the moment it is added.
 */
import type { GraphNode } from '../types/nodeGraph';
import { agentStarter } from '../store/agentSetup';
import { applyRulesToGroup } from './apply';
import { rulesGroupNote } from './generate';
import { defaultRuleSet } from './spec';

type Conn = { nodeId: string; outputKey: string };

export function rulesStarter(over: Conn | null): { nodes: GraphNode[]; out: Conn; groupId: string } {
  const s = agentStarter('slime', over);
  const set = defaultRuleSet();
  const nodes = s.nodes.map(nd => {
    if (nd.id !== s.groupId) return nd;
    const g = applyRulesToGroup({ ...nd, params: { ...nd.params, label: 'Agents (rules)' } }, set);
    return { ...g, params: { ...g.params, __comment: `${rulesGroupNote(set)}\nStart here: Edit rules, then + Add rule, or pick a template (Slime mold, Ants, Predator & prey, Infection…).` } };
  });
  return { ...s, nodes };
}
