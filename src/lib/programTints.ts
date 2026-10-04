/**
 * programTints.ts — Show passes (docs/pass-node-plan.md "Wires and the boundary",
 * docs/agents-plan.md §5): which program each node runs in, for tinting its card.
 *
 * A graph with Pass nodes or an Agents group compiles into several programs. Each
 * Pass is one, each Agents group's update shader is one (its inside nodes, and the
 * outer nodes wired into its ports and Emit), the engine's Deposit / Trail / Draw
 * steps belong to the agents too, and the rest is the final picture. A node that
 * lands in two programs is compiled twice (striped on the card).
 */
import type { AgentsSpec, PassProgram } from '../compiler/types';

export type ProgramKind = 'pass' | 'agents' | 'final';
export interface ProgramTag { kind: ProgramKind; label: string; index: number }

/** Node id → the programs it runs in (empty map for a graph with one program). */
export function programTints(passes: PassProgram[] | null, agents: AgentsSpec | null, finalIds: string[] | null): Map<string, ProgramTag[]> {
  const out = new Map<string, ProgramTag[]>();
  if (!passes?.length && !agents) return out;
  const add = (id: string, tag: ProgramTag) => {
    const list = out.get(id) ?? [];
    if (!list.some(t => t.kind === tag.kind && t.index === tag.index)) list.push(tag);
    out.set(id, list);
  };
  (passes ?? []).forEach((p, i) => {
    add(p.nodeId, { kind: 'pass', label: p.label, index: i });
    for (const id of p.nodeIds) add(id, { kind: 'pass', label: p.label, index: i });
  });
  if (agents) {
    agents.groups.forEach((g, i) => {
      const tag: ProgramTag = { kind: 'agents', label: g.label, index: i };
      add(g.nodeId, tag);
      for (const id of g.nodeIds) add(id, tag);
    });
    const groupIndex = (slug: string) => Math.max(0, agents.groups.findIndex(g => g.slug === slug));
    for (const d of agents.deposits) add(d.nodeId, { kind: 'agents', label: agents.groups[groupIndex(d.group)]?.label ?? 'Agents', index: groupIndex(d.group) });
    for (const d of agents.draws) add(d.nodeId, { kind: 'agents', label: agents.groups[groupIndex(d.group)]?.label ?? 'Agents', index: groupIndex(d.group) });
    for (const t of agents.trails) {
      const dep = agents.deposits.find(d => d.trail === t.slug);
      const gi = dep ? groupIndex(dep.group) : 0;
      add(t.nodeId, { kind: 'agents', label: agents.groups[gi]?.label ?? t.label, index: gi });
      for (const id of t.stepNodeIds ?? []) add(id, { kind: 'agents', label: `${t.label} step`, index: gi });
    }
  }
  for (const id of finalIds ?? []) add(id, { kind: 'final', label: 'Picture', index: 0 });
  return out;
}

/** A tag's colour: passes by index on a cool ramp, agents amber, the picture neutral green. */
export function programTintColour(tag: ProgramTag): string {
  if (tag.kind === 'agents') return ['#e8913a', '#d9663b', '#e0b23a', '#c9573f'][tag.index % 4];
  if (tag.kind === 'final') return '#5fae7a';
  return ['#4f8ff0', '#8f6cf0', '#3fb6c9', '#c46ce0', '#6c7cf0', '#3fa3e0', '#a06cd0', '#4fc0a8'][tag.index % 8];
}

let cache: { key: [unknown, unknown, unknown]; map: Map<string, ProgramTag[]> } | null = null;
/** programTints, computed once per compile (every card asks). */
export function programTintsCached(passes: PassProgram[] | null, agents: AgentsSpec | null, finalIds: string[] | null): Map<string, ProgramTag[]> {
  if (cache && cache.key[0] === passes && cache.key[1] === agents && cache.key[2] === finalIds) return cache.map;
  cache = { key: [passes, agents, finalIds], map: programTints(passes, agents, finalIds) };
  return cache.map;
}
