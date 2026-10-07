/**
 * goldens.ts — what a Do… bar sentence does to its graph, in short (docs/playfield-language-plan.md
 * §11.0): how its clauses read, whether it runs, and a digest of the level it leaves (graphDigest).
 */
import type { GraphNode } from '../../types/nodeGraph';
import { estimateNodeHeight } from '../../store/graphLayout';
import { execCommand, type CommandPlan } from '../../suggestions/doCommands';
import { graphDigest } from './graphDigest';

export interface Golden {
  reads: string;
  ok: boolean;
  /** The node types added and removed (sorted), for a readable diff. */
  added: string[];
  removed: string[];
  /** A hash of the level's digest. */
  hash: string;
  /** How many nodes are put in a group afterwards. */
  group?: number;
}

const H = (nd: GraphNode) => estimateNodeHeight(nd);

/** FNV-1a, as 8 hex digits. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const reads = (p: CommandPlan) => p.clauses.map(c => `${c.verb}${c.status === 'ok' ? '' : `!${c.status}`}`).join(' ');

/** Run a sentence the way the bar does (stand-in ids, estimated card heights). */
export function runSentence(text: string, nodes: GraphNode[], selected: string[]): CommandPlan {
  let k = 0;
  return execCommand(text, nodes, { selected, heightOf: H, nextId: () => `t${++k}` });
}

export function goldenOf(p: CommandPlan, before: GraphNode[]): Golden {
  const was = new Set(before.map(nd => nd.id));
  const now = new Set(p.nodes.map(nd => nd.id));
  const g: Golden = {
    reads: reads(p),
    ok: p.ok,
    added: p.nodes.filter(nd => !was.has(nd.id)).map(nd => nd.type).sort(),
    removed: before.filter(nd => !now.has(nd.id)).map(nd => nd.type).sort(),
    hash: hash(graphDigest(p.nodes).join('\n')),
  };
  if (p.group) g.group = p.group.ids.length;
  return g;
}
