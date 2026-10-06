/**
 * usage.ts — the "usually connected to" co-occurrence table (docs/suggestions.md, audit §10).
 *
 * A wire is one pair: from-type.output → to-type.input ("circleSDF.distance>light.distance").
 * Ends are normalised so renamed and merged nodes count as one: an old type key goes to its
 * canonical node (nodes/definitions/aliases.ts) with its socket keys renamed, `__param_x`
 * (a slider wired on a group's inside) is `x`. Expression Blocks, Custom Functions and groups are
 * wildcards: a wire into one says nothing about which dedicated node to suggest, so it isn't
 * counted. Each graph counts a pair once (how many of your graphs wire X into Y, not how many
 * times), into groups at any depth.
 *
 * Pure: the learning store (learning.ts) feeds it graphs and keeps the per-graph results.
 */
import { NODE_ALIASES } from '../nodes/definitions/aliases';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Node types that say nothing about what to suggest next to them. */
export const WILDCARD_TYPES = new Set(['exprNode', 'customFn', 'group', 'forLoop']);

/** A node type and one of its socket keys, aliases resolved. */
export function normaliseEnd(type: string, key: string, dir: 'in' | 'out'): { type: string; key: string } {
  let k = key.startsWith('__param_') ? key.slice('__param_'.length) : key;
  const alias = NODE_ALIASES[type];
  if (!alias) return { type, key: k };
  const map = dir === 'in' ? alias.inputs : alias.outputs;
  if (map?.[k]) k = map[k];
  return { type: alias.to, key: k };
}

export const pairKey = (fromType: string, outKey: string, toType: string, inKey: string) => `${fromType}.${outKey}>${toType}.${inKey}`;

export interface PairParts { fromType: string; outKey: string; toType: string; inKey: string }
export function splitPair(pair: string): PairParts | null {
  const m = /^([^.>]+)\.([^>]+)>([^.>]+)\.(.+)$/.exec(pair);
  return m ? { fromType: m[1], outKey: m[2], toType: m[3], inKey: m[4] } : null;
}

/** Every distinct pair a graph's wires make (its node list, as saved), into subgraphs. */
export function graphPairs(nodes: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (list: unknown) => {
    const scope = arr(list).map(obj).filter((n): n is Obj => !!n);
    const byId = new Map(scope.map(n => [str(n.id) ?? '', n]));
    for (const n of scope) {
      const type = str(n.type);
      if (!type) continue;
      const sub = obj(obj(n.params)?.subgraph);
      if (sub) walk(sub.nodes);
      if (WILDCARD_TYPES.has(type)) continue;
      for (const [inKey, input] of Object.entries(obj(n.inputs) ?? {})) {
        const c = obj(obj(input)?.connection);
        const fromId = str(c?.nodeId), outKey = str(c?.outputKey);
        if (!fromId || !outKey || fromId === GROUP_PORT_SENTINEL) continue;
        const from = byId.get(fromId);
        const fromType = str(from?.type);
        if (!fromType || WILDCARD_TYPES.has(fromType)) continue;
        const a = normaliseEnd(fromType, outKey, 'out');
        const b = normaliseEnd(type, inKey, 'in');
        out.add(pairKey(a.type, a.key, b.type, b.key));
      }
    }
  };
  walk(nodes);
  return out;
}

/** The shape of a graph's wiring, for spotting near-identical templates (sorted pairs). */
export const pairSignature = (pairs: Iterable<string>) => [...pairs].sort().join('|');

// ── The table ───────────────────────────────────────────────────────────────

export interface PairStat {
  /** Weighted count of this pair. */
  count: number;
  /** P(this input | this output): count / everything that output fed. */
  p: number;
  /** How much more often than chance: P(to | from) / P(to). */
  lift: number;
}

/** Weighted pair counts with the margins needed for P(next | this) and lift. */
export class CoTable {
  readonly pairs = new Map<string, number>();
  /** By from-end ("type.out") and to-end ("type.in"). */
  readonly fromTotals = new Map<string, number>();
  readonly toTotals = new Map<string, number>();
  /** Node-level: "fromType>toType", and from-type totals. */
  readonly typePairs = new Map<string, number>();
  readonly fromTypeTotals = new Map<string, number>();
  readonly toTypeTotals = new Map<string, number>();
  total = 0;

  add(pair: string, w: number): void {
    if (!(w > 0)) return;
    const parts = splitPair(pair);
    if (!parts) return;
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + w);
    bump(this.pairs, pair);
    bump(this.fromTotals, `${parts.fromType}.${parts.outKey}`);
    bump(this.toTotals, `${parts.toType}.${parts.inKey}`);
    bump(this.typePairs, `${parts.fromType}>${parts.toType}`);
    bump(this.fromTypeTotals, parts.fromType);
    bump(this.toTypeTotals, parts.toType);
    this.total += w;
  }

  /** One socket-level pair. */
  stat(fromType: string, outKey: string, toType: string, inKey: string): PairStat {
    const count = this.pairs.get(pairKey(fromType, outKey, toType, inKey)) ?? 0;
    const from = this.fromTotals.get(`${fromType}.${outKey}`) ?? 0;
    const to = this.toTotals.get(`${toType}.${inKey}`) ?? 0;
    return stat(count, from, to, this.total);
  }

  /** Node-level: how often anything of `fromType` feeds anything of `toType`. */
  typeStat(fromType: string, toType: string): PairStat {
    const count = this.typePairs.get(`${fromType}>${toType}`) ?? 0;
    return stat(count, this.fromTypeTotals.get(fromType) ?? 0, this.toTypeTotals.get(toType) ?? 0, this.total);
  }

  /** What an output usually feeds, best first: [to-type, in-key, stat]. */
  next(fromType: string, outKey: string, limit = 5): Array<{ toType: string; inKey: string } & PairStat> {
    const prefix = `${fromType}.${outKey}>`;
    const out: Array<{ toType: string; inKey: string } & PairStat> = [];
    for (const [pair] of this.pairs) {
      if (!pair.startsWith(prefix)) continue;
      const p = splitPair(pair)!;
      out.push({ toType: p.toType, inKey: p.inKey, ...this.stat(fromType, outKey, p.toType, p.inKey) });
    }
    return out.sort((a, b) => strength(b) - strength(a)).slice(0, limit);
  }

  /** What usually feeds an input, best first. */
  prev(toType: string, inKey: string, limit = 5): Array<{ fromType: string; outKey: string } & PairStat> {
    const suffix = `>${toType}.${inKey}`;
    const out: Array<{ fromType: string; outKey: string } & PairStat> = [];
    for (const [pair] of this.pairs) {
      if (!pair.endsWith(suffix)) continue;
      const p = splitPair(pair)!;
      out.push({ fromType: p.fromType, outKey: p.outKey, ...this.stat(p.fromType, p.outKey, toType, inKey) });
    }
    return out.sort((a, b) => strength(b) - strength(a)).slice(0, limit);
  }

  /** Every pair whose node-level from-type is `type`, summed by to-type (for a node with no socket context). */
  followers(fromType: string): Map<string, number> {
    const out = new Map<string, number>();
    const prefix = `${fromType}>`;
    for (const [k, v] of this.typePairs) if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v);
    return out;
  }
}

function stat(count: number, from: number, to: number, total: number): PairStat {
  if (!count || !from || !to || !total) return { count, p: 0, lift: 0 };
  const p = count / from;
  return { count, p, lift: p / (to / total) };
}

/**
 * One number for "how strongly this follows that": P(next | this), damped when the pair is
 * rare (a single wire is weak evidence) and when it is only as common as chance (lift near 1:
 * everything feeds the Output). 0…1.
 */
export function strength(s: PairStat): number {
  if (!s.count) return 0;
  const evidence = s.count / (s.count + 1.5);
  const surprise = Math.min(1, Math.max(0.25, (s.lift - 0.5) / 3));
  return s.p * evidence * surprise;
}
