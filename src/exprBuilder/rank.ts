/**
 * rank.ts — what usually comes next (docs/expression-builder-plan.md §4.1, phase 3).
 *
 * A candidate's score is the log of how likely it is to be the next move, from the order statistics
 * (which move followed which, by context), backing off from specific to general when the data is
 * thin (Witten–Bell: a level with N follow-ups of T kinds keeps N / (N + T) of the weight and passes
 * the rest down):
 *
 *   1. after the chain's last move, in this dimension, on a value fed like this one (UV, a position…)
 *   2. after the last move, in this dimension
 *   3. after the last move, anywhere
 *   4. after any move of the last move's family (any `repeat`, say), in this dimension
 *   5. the base: how often the move was seen, weighted by how well the contexts it was seen in match
 *      the chain's (the dimension, what fed it, what it went into, the techniques around it);
 *      generated moves count as seen a little
 *
 * At the seed (no move yet) only the base speaks. Then the chain's name (naming.ts) can lift its
 * usual finishing moves (a cell repeat → centre it, measure a distance), and the dull-move filter
 * (dull.ts) sinks what wouldn't show and lifts what changes the picture most.
 *
 * Everything per catalogue is counted once (`rankIndex`, cached); scoring a pool of a few hundred
 * moves is a few map lookups each. Pure.
 */
import type { Role } from '../lib/glslPatterns';
import type { Catalogue, Dimension, Feed, Into, Move, MoveFamily } from './moves';

export interface RankContext {
  dimension: Dimension;
  /** What the value stands for: moves for another role still come, lower (`OTHER_ROLE`). */
  role?: Role;
  /** What fed the value the next move acts on (the seed's feeds, or what the chain made of it). */
  feeds?: readonly Feed[];
  /** What the result goes into (a socket seed knows; phase 4). */
  into?: readonly Into[];
  /** Techniques around it (pattern index; a socket seed knows). */
  techniques?: readonly string[];
  /** The move the chain's last step is (its id), when there is one. */
  prev?: string | null;
  /** Its family (for backing off when the move itself has no follow-ups). */
  prevFamily?: MoveFamily | null;
  /** Moves to lift (ids → a factor), e.g. the finishing moves of what the chain has become. */
  boost?: ReadonlyMap<string, number>;
}

type Counts = Map<string, number>;
interface Level { counts: Counts; total: number; kinds: number }

export interface RankIndex {
  byId: Map<string, Move>;
  /** `${from}|${dim}|${feed}` → to → n */
  fdf: Map<string, Counts>;
  /** `${from}|${dim}` → to → n */
  fd: Map<string, Counts>;
  /** from → to → n */
  f: Map<string, Counts>;
  /** `${family}|${dim}` → to → n */
  famd: Map<string, Counts>;
}

const add = (m: Map<string, Counts>, k: string, to: string, n: number) => {
  let c = m.get(k);
  if (!c) { c = new Map(); m.set(k, c); }
  c.set(to, (c.get(to) ?? 0) + n);
};

const indexes = new WeakMap<Catalogue, RankIndex>();

/** The catalogue's order statistics, counted by context (once per catalogue). */
export function rankIndex(cat: Catalogue): RankIndex {
  let ix = indexes.get(cat);
  if (ix) return ix;
  const byId = new Map(cat.moves.map(m => [m.id, m]));
  ix = { byId, fdf: new Map(), fd: new Map(), f: new Map(), famd: new Map() };
  for (const o of cat.order) {
    add(ix.fdf, `${o.from}|${o.dim}|${o.feed}`, o.to, o.n);
    add(ix.fd, `${o.from}|${o.dim}`, o.to, o.n);
    add(ix.f, o.from, o.to, o.n);
    const fam = byId.get(o.from)?.family;
    if (fam) add(ix.famd, `${fam}|${o.dim}`, o.to, o.n);
  }
  indexes.set(cat, ix);
  return ix;
}

/** A level's counts kept to the pool (what can be picked here). */
function level(c: Counts | undefined, pool: ReadonlySet<string>): Level {
  const counts: Counts = new Map();
  let total = 0;
  if (c) for (const [k, n] of c) if (pool.has(k)) { counts.set(k, n); total += n; }
  return { counts, total, kinds: counts.size };
}

/** How much a generated move (never seen, never followed) counts as seen, for the base. */
export const GENERATED_PRIOR = 1.5;
/** Every move's base gets this much on top (no move is impossible). */
const SMOOTH = 0.5;
/** Contexts in another dimension still count, a little. */
const OTHER_DIM = 0.15;
/** A context fed like the chain's value counts this much more; one fed by something else, this much. */
const FEED_MATCH = 3, FEED_OTHER = 0.2;
/** Feeds that say little (a plain value), neither matched nor penalised. */
const NEUTRAL_FEEDS: ReadonlySet<Feed> = new Set(['unknown', 'value', 'constant']);
/** A move for another role (a value's move on a distance) counts this much in the base. */
export const OTHER_ROLE = 0.3;

/** How well one of a move's contexts matches the chain's (1 = same dimension, nothing else known). */
function contextWeight(c: Move['contexts'][number], ctx: RankContext): number {
  let w = c.dim === ctx.dimension ? 1 : OTHER_DIM;
  // Fed the same way (a March Loop's position, not a 3D agent's): much more alike. Fed by
  // something else that is known: less.
  if (ctx.feeds?.length) w *= ctx.feeds.includes(c.feed) ? FEED_MATCH : NEUTRAL_FEEDS.has(c.feed) ? 1 : FEED_OTHER;
  if (ctx.into?.length && ctx.into.includes(c.into)) w *= 1.5;
  if (ctx.techniques?.length && c.techniques.some(t => ctx.techniques!.includes(t))) w *= 1.5;
  return w;
}

/** The base weight: uses, by how well their contexts match (generated moves: a small prior). */
export function baseWeight(m: Move, ctx: RankContext): number {
  const role = !ctx.role || ctx.role === 'unknown' || m.sig.role === 'unknown' || m.sig.role === ctx.role ? 1 : OTHER_ROLE;
  if (m.generated) return (GENERATED_PRIOR + SMOOTH) * role;
  let w = 0;
  for (const c of m.contexts) w += c.n * contextWeight(c, ctx);
  return (w + SMOOTH) * role;
}

export interface Scored { move: Move; score: number; /** The order-statistics share before the base (0 when nothing followed). */ follow: number }

/**
 * Every move of the pool scored for the context (log-probability of coming next, plus boosts). Pure;
 * the catalogue's index is cached.
 */
export function scoreMoves(pool: readonly Move[], ctx: RankContext, cat: Catalogue): Scored[] {
  const ix = rankIndex(cat);
  const ids = new Set(pool.map(m => m.id));
  // The base: a distribution over the pool.
  const base = new Map<string, number>();
  let baseTotal = 0;
  for (const m of pool) { const w = baseWeight(m, ctx); base.set(m.id, w); baseTotal += w; }
  // The order levels, most specific first.
  const levels: Level[] = [];
  const prev = ctx.prev ?? null;
  if (prev) {
    const feeds = ctx.feeds?.length ? ctx.feeds : null;
    if (feeds) {
      // Several feeds (UV or fragCoord): their follow-ups together.
      const merged: Counts = new Map();
      for (const f of feeds) for (const [k, n] of ix.fdf.get(`${prev}|${ctx.dimension}|${f}`) ?? []) merged.set(k, (merged.get(k) ?? 0) + n);
      levels.push(level(merged, ids));
    }
    levels.push(level(ix.fd.get(`${prev}|${ctx.dimension}`), ids));
    levels.push(level(ix.f.get(prev), ids));
  }
  if (ctx.prevFamily) levels.push(level(ix.famd.get(`${ctx.prevFamily}|${ctx.dimension}`), ids));
  const out: Scored[] = pool.map(m => {
    // Witten–Bell, from the base up.
    let p = (base.get(m.id) ?? SMOOTH) / Math.max(baseTotal, 1e-9);
    let follow = 0;
    for (let i = levels.length - 1; i >= 0; i--) {
      const L = levels[i];
      if (!L.total) continue;
      const lambda = L.total / (L.total + L.kinds);
      const ml = (L.counts.get(m.id) ?? 0) / L.total;
      p = lambda * ml + (1 - lambda) * p;
      if (ml) follow = Math.max(follow, ml);
    }
    const boost = ctx.boost?.get(m.id) ?? 1;
    return { move: m, score: Math.log(p * boost), follow };
  });
  return out;
}

/** The pool in ranked order (best first; ties by how often seen, then as given). Pure. */
export function rankByContext(pool: readonly Move[], ctx: RankContext, cat: Catalogue): Scored[] {
  return scoreMoves(pool, ctx, cat)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.score - a.s.score || b.s.move.count - a.s.move.count || a.i - b.i)
    .map(x => x.s);
}
