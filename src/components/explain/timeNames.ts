/**
 * timeNames — which names an Expression Block line reads that move with time, so the explain view
 * (LineExplainView.tsx) can offer its Time controls (play, scrub, speed, a filmstrip) when, and only
 * when, the line changes as time runs.
 *
 * A name moves with time when it is:
 *  - the block's clock `t` (no input of that name), or a time-like name with no other source (`time`);
 *  - an input wired from anything with a clock upstream (a Time node, a Clock, an LFO…, through any
 *    number of nodes between);
 *  - a variable an earlier line set from one of those.
 * Globals the line reads directly (`u_time`, `iTime`) count too. Pure.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { roleOfSourceNode } from '../../lib/glslPatterns';

type Line = { lhs: string; rhs: string; off?: boolean };
type InputDef = { name: string };

/** Node types whose output runs with the clock even when their role says otherwise (an LFO is a "value"). */
const CLOCKED = /^(time|clock|lfo|oscillator|beat|metronome|timeline|envelope)/i;

const words = (s: string) => new Set(s.match(/[A-Za-z_]\w*/g) ?? []);

/** Is there a clock anywhere upstream of this node (itself included)? */
function clockUpstream(start: string, byId: Map<string, GraphNode>, seen = new Set<string>()): boolean {
  if (seen.has(start)) return false;
  seen.add(start);
  const n = byId.get(start);
  if (!n) return false;
  if (CLOCKED.test(n.type) || roleOfSourceNode(n.type, 'float') === 'time') return true;
  return Object.values(n.inputs ?? {}).some(i => i.connection && clockUpstream(i.connection.nodeId, byId, seen));
}

/** The names that move with time as line `at` (or Return) sees them. */
export function timeNamesOf(node: GraphNode, at: number | 'return', nodes: readonly GraphNode[]): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const inputs = (node.params.inputs as InputDef[] | undefined) ?? [];
  const out = new Set<string>(['u_time', 'iTime']);
  const named = new Set(inputs.map(i => i.name));
  // The block's clock, unless an input took the name
  for (const clock of ['t', 'time']) if (!named.has(clock)) out.add(clock);
  for (const i of inputs) {
    const c = node.inputs?.[i.name]?.connection;
    if (c && clockUpstream(c.nodeId, byId)) out.add(i.name);
  }
  const lines = (node.params.lines as Line[] | undefined) ?? [];
  for (const l of at === 'return' ? lines : lines.slice(0, at)) {
    if (!l || l.off) continue;
    const target = /([A-Za-z_]\w*)\s*(?:\[.*\])?\s*$/.exec((l.lhs ?? '').replace(/\.\w+$/, ''))?.[1];
    if (!target) continue;
    const reads = words(l.rhs ?? '');
    if ([...reads].some(w => out.has(w))) out.add(target);
  }
  return out;
}

/** The time names a line actually reads ("" when it doesn't move with time). */
export function lineTimeNames(text: string, node: GraphNode, at: number | 'return', nodes: readonly GraphNode[]): string[] {
  const names = timeNamesOf(node, at, nodes);
  const expr = text.replace(/^[^=]*=(?!=)/, '');
  return [...words(at === 'return' ? text.replace(/^\s*return\s+/, '') : expr)].filter(w => names.has(w));
}
