/**
 * outputs.ts — what an Agents group's picture shows (docs/agent-rules.md, "What the picture shows"):
 * the trail (all channels, Amount), one trail channel (Channel 1–4), or the walkers' density
 * (Draw agents). The Agent Rules editor picks one; this rewires whatever reads the group's Trail
 * field (usually its Palette) to that socket. Pure: it returns the new nodes.
 */
import type { GraphNode } from '../types/nodeGraph';

export type AgentsView = 'amount' | 'ch1' | 'ch2' | 'ch3' | 'ch4' | 'density';

export const AGENT_VIEWS: Array<{ value: AgentsView; label: string; hint: string }> = [
  { value: 'amount', label: 'Trail', hint: 'The trail as laid (channel 1, softly scaled by Gain): the usual picture.' },
  { value: 'ch1', label: 'Channel 1', hint: 'Trail channel 1 alone.' },
  { value: 'ch2', label: 'Channel 2', hint: 'Trail channel 2 alone (species 2, or a second smell).' },
  { value: 'ch3', label: 'Channel 3', hint: 'Trail channel 3 alone.' },
  { value: 'ch4', label: 'Channel 4', hint: 'Trail channel 4 alone (birth marks when rules spawn).' },
  { value: 'density', label: 'Walker density', hint: 'Where the walkers are, from Draw agents\' Density.' },
];

const TRAIL_KEYS = new Set(['amount', 'raw', 'ch1', 'ch2', 'ch3', 'ch4']);

/** The group's Trail field, its Draw agents, and the input that shows the trail now. */
export function agentsViewOf(nodes: GraphNode[], groupId: string): {
  trail: GraphNode | null; draw: GraphNode | null; reader: { nodeId: string; inputKey: string } | null; current: AgentsView | null;
} {
  const deposits = nodes.filter(n => n.type === 'agentDeposit' && n.inputs.agents?.connection?.nodeId === groupId).map(n => n.id);
  const trail = nodes.find(n => n.type === 'trailField' && n.inputs.deposit?.connection && deposits.includes(n.inputs.deposit.connection.nodeId)) ?? null;
  const draw = nodes.find(n => n.type === 'drawAgents' && n.inputs.agents?.connection?.nodeId === groupId) ?? null;
  for (const n of nodes) {
    for (const [k, i] of Object.entries(n.inputs)) {
      const c = i.connection;
      if (!c) continue;
      if (trail && c.nodeId === trail.id && TRAIL_KEYS.has(c.outputKey)) return { trail, draw, reader: { nodeId: n.id, inputKey: k }, current: c.outputKey === 'raw' ? 'amount' : c.outputKey as AgentsView };
      if (draw && c.nodeId === draw.id && c.outputKey === 'density' && i.type === 'float') return { trail, draw, reader: { nodeId: n.id, inputKey: k }, current: 'density' };
    }
  }
  return { trail, draw, reader: null, current: null };
}

/** Show `view` instead: the reader's wire moved to that socket. An error says why it can't. */
export function setAgentsView(nodes: GraphNode[], groupId: string, view: AgentsView): { nodes: GraphNode[] } | { error: string } {
  const at = agentsViewOf(nodes, groupId);
  if (!at.reader) return { error: 'Nothing shows this group\'s trail: wire its Trail field\'s Amount into a Palette (the rules starter does).' };
  const src = view === 'density' ? at.draw : at.trail;
  if (!src) return { error: view === 'density' ? 'Walker density comes from Draw agents: add one for this group first.' : 'This group has no Trail field.' };
  const { nodeId, inputKey } = at.reader;
  return {
    nodes: nodes.map(n => (n.id !== nodeId ? n : { ...n, inputs: { ...n.inputs, [inputKey]: { ...n.inputs[inputKey], connection: { nodeId: src.id, outputKey: view } } } })),
  };
}
