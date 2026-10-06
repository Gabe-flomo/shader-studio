/**
 * connectionCheck.ts — "Is this typical?" (docs/suggestions.md): how often a wire, or a chain of
 * wired nodes, appears in your graphs, your imports and the examples, from the same weighted
 * usage table the suggestions rank with. On demand: the Do… bar ("is this typical?") and a
 * right-click on a wire's + badge.
 *
 *  - Common: "Seen in 12 of your graphs (3 imported), 36 in the examples; usually followed by
 *    Palette."
 *  - Rare: says so, and lists the nearest common alternatives for that output (what it usually
 *    feeds) and for that input (what usually feeds it).
 *  - A chain you build again and again (in 3 or more of your graphs) offers "Teach this?".
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { normaliseEnd, pairKey, strength, WILDCARD_TYPES } from './usage';
import { pairSources } from './learning';
import type { RankTables } from './rank';

export interface Wire4 { fromType: string; outKey: string; toType: string; inKey: string }

export interface ConnectionReport {
  /** What was checked, in words ("Circle SDF → SDF Glow"). */
  what: string;
  saved: number;
  imported: number;
  live: number;
  examples: number;
  /** P(this input | this output) across everything learned, 0…1. */
  p: number;
  rare: boolean;
  /** The one-paragraph answer. */
  message: string;
  /** What the last node is usually followed by. */
  followedBy: string[];
  /** Common alternatives when rare: "→ Palette (Value)", "UV → …". */
  alternatives: string[];
  /** A chain seen in 3+ of your graphs: worth teaching as a phrase. */
  teach: boolean;
  wildcard: boolean;
}

const label = (type: string) => getNodeDefinition(type)?.label ?? type;
const sockLabel = (type: string, key: string, dir: 'in' | 'out') => {
  const d = getNodeDefinition(type);
  return (dir === 'in' ? d?.inputs[key]?.label : d?.outputs[key]?.label) ?? key;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The wires among `ids` in `nodes` (a chain or any connected selection), in data-flow order. */
export function wiresAmong(nodes: GraphNode[], ids: string[]): Wire4[] {
  const set = new Set(ids);
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const out: Wire4[] = [];
  for (const nd of nodes) {
    if (!set.has(nd.id)) continue;
    for (const [inKey, i] of Object.entries(nd.inputs)) {
      const c = i.connection;
      if (!c || !set.has(c.nodeId)) continue;
      out.push({ fromType: byId.get(c.nodeId)!.type, outKey: c.outputKey, toType: nd.type, inKey });
    }
  }
  return out;
}

/** Check one wire or a chain of them. */
export function checkConnection(wires: Wire4[], t: RankTables): ConnectionReport | null {
  if (!wires.length) return null;
  const ends = wires.map(w => ({ a: normaliseEnd(w.fromType, w.outKey, 'out'), b: normaliseEnd(w.toType, w.inKey, 'in') }));
  const wildcard = wires.some(w => WILDCARD_TYPES.has(w.fromType) || WILDCARD_TYPES.has(w.toType));
  const pairs = ends.map(e => pairKey(e.a.type, e.a.key, e.b.type, e.b.key));
  const src = pairSources(pairs);
  const first = ends[0], last = ends[ends.length - 1];
  const chain = wires.length > 1;
  const types = [first.a.type, ...ends.map(e => e.b.type)].filter((x, i, a) => a.indexOf(x) === i);
  const what = chain ? types.map(label).join(' → ') : `${label(first.a.type)} · ${sockLabel(first.a.type, first.a.key, 'out')} → ${label(first.b.type)} · ${sockLabel(first.b.type, first.b.key, 'in')}`;
  // Conditional probability of each wire; a chain's is the weakest link.
  const stats = ends.map(e => t.table.stat(e.a.type, e.a.key, e.b.type, e.b.key));
  const p = Math.min(...stats.map(s => s.p));
  const yours = src.saved + src.imported;
  const total = yours + src.live + src.examples;
  const rare = !wildcard && (total < 2 || (p < 0.05 && Math.min(...stats.map(strength)) < 0.02));

  // What the last node usually feeds next.
  const followers = [...t.table.followers(last.b.type).entries()]
    .filter(([ty]) => !/^(output|vec4Output)$/.test(ty) && !WILDCARD_TYPES.has(ty))
    .sort((x, y) => y[1] - x[1]).slice(0, 2).map(([ty]) => label(ty));

  const alternatives: string[] = [];
  if (rare) {
    const w = ends[ends.length - 1];
    for (const x of t.table.next(w.a.type, w.a.key, 4)) {
      if (x.toType === w.b.type || WILDCARD_TYPES.has(x.toType)) continue;
      alternatives.push(`${label(w.a.type)} → ${label(x.toType)} · ${sockLabel(x.toType, x.inKey, 'in')}`);
      if (alternatives.length >= 2) break;
    }
    for (const x of t.table.prev(w.b.type, w.b.key, 4)) {
      if (x.fromType === w.a.type || WILDCARD_TYPES.has(x.fromType)) continue;
      alternatives.push(`${label(x.fromType)} · ${sockLabel(x.fromType, x.outKey, 'out')} → ${label(w.b.type)}`);
      if (alternatives.length >= 4) break;
    }
  }

  const seen: string[] = [];
  if (src.saved) seen.push(`in ${src.saved} of your graphs`);
  if (src.imported) seen.push(`${plural(src.imported, 'imported graph')}`);
  if (src.live) seen.push(`wired ${plural(src.live, 'time')} lately`);
  if (src.examples) seen.push(`about ${src.examples} in the examples`);
  let message: string;
  if (wildcard) message = 'An Expression Block, Custom Function or group is on this wire: they can do anything, so usage says nothing about it.';
  else if (!seen.length) message = `Not seen before: not in your graphs, your imports or the examples.`;
  else message = `Seen ${seen.join(', ')}.`;
  if (!wildcard && !rare && followers.length) message += ` Usually followed by ${followers.join(' or ')}.`;
  if (rare && !wildcard) message += alternatives.length ? ' That is rare. Nearer the usual:' : ' That is rare.';
  return { what, ...src, p, rare, message, followedBy: followers, alternatives, teach: chain && src.saved >= 3, wildcard };
}
