/**
 * apply.ts — a rule set onto an Agents group (pure: the store applies the results with undo).
 *
 * Rules mode: `params.ruleMode === 'rules'`, the rule set in `params.agentRules`, and the inside
 * (params.subgraph) generated from it for the group's Space (`params.rulesSpace`). The compiler
 * sees an ordinary group: the generated inside is what runs, in the app, on web pages and in
 * Play. **Open as nodes** keeps that inside and sets the mode to 'nodes', so the nodes are the
 * same nodes, wire for wire (and the same GLSL). The rule set is kept, so **Back to rules** can
 * generate the inside again (replacing any hand edits).
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { depositTargets } from '../compiler/agentGraph';
import { generateRulesInside, rulesGroupNote } from './generate';
import { type AgentRuleSet, defaultRuleSet, normalizeRuleSet, rulePorts, usesAction } from './spec';

export const isRulesGroup = (g: GraphNode | undefined) => g?.type === 'agentsGroup' && g.params.ruleMode === 'rules';
export const hasRules = (g: GraphNode | undefined) => g?.type === 'agentsGroup' && !!g.params.agentRules;
export const groupRules = (g: GraphNode): AgentRuleSet => normalizeRuleSet(g.params.agentRules);
const spaceOf = (g: GraphNode) => (g.params.space === '3d' ? '3d' : '2d');

/**
 * The group with its inside generated from `set`: rules mode, its Species from the set, a socket
 * for each port the rules read (a wire already in one of the same type is kept; the Emit is kept).
 */
export function applyRulesToGroup(g: GraphNode, set: AgentRuleSet): GraphNode {
  const d3 = g.params.space === '3d';
  const inside = generateRulesInside(set, { groupId: g.id, d3 });
  const ports = rulePorts(set);
  const inputs: GraphNode['inputs'] = { emit: g.inputs.emit ?? { type: 'emitter', label: 'Emit' } };
  for (const p of ports) {
    const was = g.inputs[p.key];
    inputs[p.key] = { type: p.type, label: p.label, ...(was?.connection && was.type === p.type ? { connection: was.connection } : {}) };
  }
  const sg = (g.params.subgraph as SubgraphData | undefined) ?? { nodes: [], inputPorts: [], outputPorts: [] };
  const innerIds = new Set(inside.map(x => x.id));
  const pinned = ((g.params.pinned ?? []) as string[]).filter(p => innerIds.has(p.split('::')[0]));
  return {
    ...g,
    inputs,
    params: {
      ...g.params,
      species: String(set.species.length),
      ruleMode: 'rules',
      agentRules: set,
      rulesSpace: spaceOf(g),
      pinned,
      subgraph: { ...sg, nodes: inside, inputPorts: [], outputPorts: [] },
    },
  };
}

/** Open as nodes: the same inside, now edited as nodes (the rules are kept for Back to rules). */
export function openRulesAsNodes(g: GraphNode): GraphNode {
  return { ...g, params: { ...g.params, ruleMode: 'nodes' } };
}

/** Back to rules (or Write as rules): the inside generated again from the kept rules (or a new rule set). */
export function backToRules(g: GraphNode): GraphNode {
  return applyRulesToGroup(g, g.params.agentRules ? groupRules(g) : defaultRuleSet());
}

/** A rules group whose inside was generated for another Space (2D ↔ 3D) and needs it again. */
export const rulesNeedRegenerating = (g: GraphNode) => isRulesGroup(g) && g.params.rulesSpace !== spaceOf(g);

/**
 * Spawn a child (the Emit mechanics): a rule's "spawn" lays a birth mark in trail channel 4; a
 * Births Emit (Rate, Field: born where the Trail's channel 4 is above Threshold, nowhere else)
 * chained in front of the group's Emit gives birth there. Returns the nodes with it added (when
 * the rules spawn and there is a Trail to read), or null when nothing is needed or it can't be.
 */
export function ensureBirthEmit(nodes: GraphNode[], groupId: string, nextId: () => string): { nodes: GraphNode[]; added: boolean; why?: string } {
  const g = nodes.find(x => x.id === groupId);
  if (!g || !g.params.agentRules || !usesAction(groupRules(g), 'spawn')) return { nodes, added: false };
  const byId = new Map(nodes.map(x => [x.id, x]));
  // Already there?
  let c = g.inputs.emit?.connection;
  const seen = new Set<string>();
  while (c && !seen.has(c.nodeId)) {
    seen.add(c.nodeId);
    const e = byId.get(c.nodeId);
    if (e?.type !== 'agentEmit') break;
    if (e.params.__rulesBirth === true) return { nodes, added: false };
    c = e.inputs.also?.connection;
  }
  const deposits = depositTargets(nodes);
  const dep = nodes.find(x => x.type === 'agentDeposit' && x.inputs.agents?.connection?.nodeId === groupId && deposits.has(x.id));
  const trailId = dep ? deposits.get(dep.id)! : undefined;
  if (!trailId) return { nodes, added: false, why: 'Spawn a child needs a Trail: wire the group into a Deposit and that into a Trail field, then edit the rules again.' };
  const at = { x: g.position.x - 460, y: g.position.y - 520 };
  const marksId = nextId(), emitId = nextId();
  const marks = n('exprNode', marksId, at.x - 420, at.y, {
    label: 'Birth marks',
    inputs: [{ name: 'ch', type: 'vec4', slider: null }], outputType: 'float', lines: [], result: 'ch.w', expr: 'ch.w',
    __comment: 'Birth marks (an Expression Block): the Trail\'s channel 4 where a walker might be born: the marks the rules\' "spawn a child" lay.\nresult: ch.w, the fourth channel (ch: the Trail\'s Channels here).',
  });
  marks.inputs = { ch: { type: 'vec4', label: 'ch (vec4)', connection: { nodeId: trailId, outputKey: 'channels' } } };
  marks.outputs = { result: { type: 'float', label: 'Result (float)' } };
  const birth = n('agentEmit', emitId, at.x, at.y, {
    mode: 'rate', rate: 2000, shape: 'field', threshold: 0.5, miss: 'skip', heading: 'random', life: 0, share: 1, __rulesBirth: true,
    __comment: 'Emit (Births): made by the rules\' "spawn a child". 2000 births a second, each where the Trail\'s channel 4 (Birth marks) is above 0.5, nowhere else (No place found: not born). A birth takes the place of the walker whose turn it is in the birth window, as every Rate birth does.\nIts "+ Another Emit" chains the group\'s own Emit: births are shared by Share.',
  }, { where: [marksId, 'result'] });
  if (g.inputs.emit?.connection) birth.inputs.also = { ...birth.inputs.also, connection: g.inputs.emit.connection };
  const out = nodes.map(x => (x.id === groupId ? { ...x, inputs: { ...x.inputs, emit: { ...(x.inputs.emit ?? { type: 'emitter', label: 'Emit' }), connection: { nodeId: emitId, outputKey: 'emitter' } } } } : x));
  return { nodes: [...out, marks, birth], added: true };
}

/** The group's note, rewritten from its rules (used by the starter and the examples). */
export const rulesNote = (set: AgentRuleSet) => rulesGroupNote(set);
