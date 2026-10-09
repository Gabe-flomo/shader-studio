/**
 * chain.ts — the Expression Builder's chain (docs/expression-builder-plan.md §3, phase 2): a seed
 * and the moves applied to it one after another, each step's holes as values, and the grid of
 * next moves for wherever the chain is.
 *
 *   UV (vec2) → fract(x * #a) → x - #a → length(x)        a grid of dots, one line per step
 *
 * A step keeps a copy of its move (template, signature, holes as values, where it came from), so
 * a chain stored on a block (`__exprChain`, phase 5 reopens it) doesn't depend on the catalogue
 * it was built from. The code of a step is `applyMove` on the previous step's local name, with its
 * holes either as numbers (the tiles' previews) or as the block's slider names (the output).
 *
 * The seed is an object rather than a choice of three, so phase 4 can seed from a socket: it
 * carries the type, the role, the dimension and the context the moves are looked up with.
 *
 * Pure: no store, no GPU.
 */
import { evaluate, formatNumber, parseExpr, type GlslType, type Role, type Value } from '../lib/glslPatterns';
import {
  applyMove, movesFor, moveLabel, sourceLabel, sourceRef, validMove,
  type Catalogue, type Dimension, type Feed, type Move, type MoveFamily, type MoveHole, type MoveSignature, type Seed, type SourceRef,
} from './moves';
import { rankByContext, type RankContext, type Scored } from './rank';
import { currentName, finishingBoost, type ChainName } from './naming';

// ── Seeds (seeds.ts: kept light, the Builders menu opens the window with one) ──

export { SEEDS, TIME_SEED, UV_SEED, WORLD_SEED, variableSeed, type ExprSeed, type SeedKind, type SeedType } from './seeds';
import type { ExprSeed } from './seeds';

// ── Steps ─────────────────────────────────────────────────────────────────────

/** A hole as the step has it: a number (a slider on the block) or a piece of code (`t`, `vec2(0.5)`). */
export type StepHole =
  | { name: string; kind: 'number'; value: number; min: number; max: number; int?: boolean; label?: string }
  | { name: string; kind: 'code'; code: string; type: GlslType };

export interface ChainStep {
  moveId: string;
  template: string;
  family: MoveFamily;
  /** "zoom", "repeat", "distance"… (moveLabel). */
  label: string;
  idiom?: string;
  sig: MoveSignature;
  holes: StepHole[];
  /** Where the move came from (up to three source labels); empty for generated moves. */
  sources: string[];
  /** How often the move was seen. */
  count: number;
  generated?: boolean;
  /** Part of a recipe (a mined compound replayed as steps): the recipe's template. */
  recipe?: string;
}

export interface Chain {
  seed: ExprSeed;
  steps: ChainStep[];
}

/** A float variable a move reads (`x * $u`) is a number to tune here: these are its slider and default. */
const VAR_SLIDER = { value: 0.5, min: 0, max: 1 };

/**
 * A number hole's slider: the catalogue's range (the usual values, 10th to 90th percentile, kept
 * to a sensible size for the role: `robustRange`), always with the default in it. One shader's
 * `x * 100000.0` doesn't stretch it; typing past the end still widens it.
 */
export function sliderRange(h: Extract<MoveHole, { kind: 'number' }>): { min: number; max: number } {
  return { min: Math.min(h.range.min, h.default), max: Math.max(h.range.max, h.default) };
}

/** A move's holes as values: numbers start at their most used value; a time is the block's `t`. */
export function stepHoles(holes: readonly MoveHole[]): StepHole[] {
  return holes.map(h => {
    if (h.kind === 'number') {
      const r = sliderRange(h);
      return { name: h.name, kind: 'number', value: h.default, min: r.min, max: r.max, ...(h.type === 'int' ? { int: true } : {}) };
    }
    if (h.role === 'time' && (h.type === 'float' || h.type === 'int')) return { name: h.name, kind: 'code', code: h.type === 'int' ? 'int(t)' : 't', type: h.type };
    if (h.type === 'float') return { name: h.name, kind: 'number', ...VAR_SLIDER, label: h.names[0] };
    return { name: h.name, kind: 'code', code: h.default, type: h.type };
  });
}

/** Up to three places a move was seen, to open (a label each, as `moveSources`). */
export function moveSourceRefs(m: Move, cat: Pick<Catalogue, 'docs'>): SourceRef[] {
  const out: SourceRef[] = [];
  const labels = new Set<string>();
  for (const s of m.sources) {
    const r = sourceRef(cat, s);
    if (!r || labels.has(r.label)) continue;
    labels.add(r.label);
    out.push(r);
    if (out.length === 3) break;
  }
  return out;
}

/** Up to three places a move was seen, as labels ("Fractal Rings", "your import: Tunnel"). */
export function moveSources(m: Move, cat: Pick<Catalogue, 'docs'>): string[] {
  const out: string[] = [];
  for (const s of m.sources) {
    const l = sourceLabel(cat, s);
    if (!out.includes(l)) out.push(l);
    if (out.length === 3) break;
  }
  return out;
}

export function stepFromMove(m: Move, cat: Pick<Catalogue, 'docs'>, recipe?: string): ChainStep {
  return {
    moveId: m.id, template: m.template, family: m.family, label: moveLabel(m), ...(m.idiom ? { idiom: m.idiom } : {}),
    sig: { ...m.sig }, holes: stepHoles(m.holes), sources: moveSources(m, cat), count: m.count,
    ...(m.generated ? { generated: true } : {}), ...(recipe ? { recipe } : {}),
  };
}

/** A step's hole values set from a map (`#a` → 4); unknown names are ignored. */
export function withValues(step: ChainStep, values: Record<string, number> | undefined): ChainStep {
  if (!values) return step;
  return { ...step, holes: step.holes.map(h => (h.kind === 'number' && typeof values[h.name] === 'number' ? { ...h, value: values[h.name], min: Math.min(h.min, values[h.name]), max: Math.max(h.max, values[h.name]) } : h)) };
}

/** The block's slider for a step's number hole: `s2_a` for step 2's `#a`. */
export const sliderName = (stepIndex: number, hole: { name: string }) => `s${stepIndex + 1}_${hole.name.replace(/^[#$]/, '')}`;
/** The block's local for a step's result: `s1`, `s2`… */
export const localName = (stepIndex: number) => `s${stepIndex + 1}`;

/** Does a number hole become a slider on the block? (An int hole stays a literal: GLSL wants a constant there.) */
export const isSliderHole = (h: StepHole): h is Extract<StepHole, { kind: 'number' }> => h.kind === 'number' && !h.int;

/**
 * A step's code applied to `input`: number holes as literals (`'literal'`), or as the block's
 * slider names (`'slider'`, with the step's index).
 */
export function stepCode(step: Pick<ChainStep, 'template' | 'holes'>, input: string, mode: { sliders: false } | { sliders: true; index: number } = { sliders: false }): string {
  const given: Record<string, string> = {};
  for (const h of step.holes) {
    if (h.kind === 'code') given[h.name] = h.code;
    else if (mode.sliders && !h.int) given[h.name] = sliderName(mode.index, h);
    else given[h.name] = formatNumber(h.int ? Math.round(h.value) : h.value, !!h.int);
  }
  // Every hole is passed as code (applyMove grafts it in place, with the parentheses it needs).
  const holes: MoveHole[] = step.holes.map(h => ({ name: h.name, kind: 'var', type: 'float', role: 'value', names: [], default: given[h.name] }));
  return applyMove(input, { template: step.template, holes }, given);
}

/** The chain's type and role after `upTo` steps (all when omitted). */
export function chainEnd(chain: Chain, upTo = chain.steps.length): { type: GlslType; role: Role; name: string } {
  let type: GlslType = chain.seed.type, role: Role = chain.seed.role;
  const n = Math.min(upTo, chain.steps.length);
  for (let i = 0; i < n; i++) {
    const s = chain.steps[i];
    // A move that keeps the role (a swizzle of space is still space, of a colour a colour) keeps
    // it; one that says nothing keeps it while the type stays.
    role = s.sig.keep ? role : s.sig.outRole !== 'unknown' ? s.sig.outRole : s.sig.out === type ? role : 'unknown';
    type = s.sig.out;
  }
  return { type, role, name: n ? localName(n - 1) : chain.seed.name };
}

/** The dimension moves are looked up in after `upTo` steps (a time seed turned into a vector is drawn as a picture). */
export function chainDimension(chain: Chain, upTo = chain.steps.length): Dimension {
  const { type } = chainEnd(chain, upTo);
  if (chain.seed.dimension === '1d-time' && type !== 'float' && type !== 'int') return '2d';
  return chain.seed.dimension;
}

/** The chain's end as a `movesFor` seed. */
export function seedForMoves(chain: Chain, upTo = chain.steps.length): Seed {
  const end = chainEnd(chain, upTo);
  return {
    type: end.type, dimension: chainDimension(chain, upTo),
    ...(end.role !== 'unknown' && end.role !== 'value' ? { role: end.role } : {}),
  };
}

// ── The grid of next moves ────────────────────────────────────────────────────

export interface Tile {
  /** Stable while the catalogue is the same: the move's id. */
  key: string;
  kind: 'step' | 'recipe';
  /** The moves it applies, in order (one for a step, the compound's steps for a recipe). */
  moves: Move[];
  /** The move itself (the compound for a recipe). */
  move: Move;
  label: string;
  /** The template shown on the tile (the compound's for a recipe). */
  template: string;
  outType: GlslType;
  sources: string[];
  /** Where those came from, to open them (Find uses / the Code explorer). */
  sourceRefs: SourceRef[];
  count: number;
  /** The ranking's score (log of the chance of coming next, with boosts); higher first. */
  score: number;
}

export interface NextMoves {
  /** Moves that keep the type (vec2 → vec2). */
  same: Tile[];
  /** Moves that change it (`x.x`, `length(x)`, a colour from space). */
  changing: Tile[];
  /** Mined compounds, replayed as their steps. */
  recipes: Tile[];
  /** What the chain is called now (naming.ts), whose finishing moves were lifted. */
  name: ChainName | null;
}

export type { RankContext };

/** A ranker: the pool scored and in order, best first (rank.ts's `rankByContext` by default). */
export type Ranker = (pool: readonly Move[], ctx: RankContext, cat: Catalogue) => Scored[];

/**
 * Phase 2's order, kept as the baseline the ranking is measured against: moves seen in the seed's
 * dimension and feed first, then by how often they were seen. Stable.
 */
export const simpleRank: Ranker = (moves, ctx) => {
  const match = (m: Move) => m.contexts.some(c => c.dim === ctx.dimension && (!ctx.feeds?.length || ctx.feeds.includes(c.feed)));
  return moves.map((m, i) => ({ m, i, hit: match(m) && !m.generated ? 1 : 0 }))
    .sort((a, b) => b.hit - a.hit || b.m.count - a.m.count || a.i - b.i)
    .map((x, i) => ({ move: x.m, score: -i, follow: 0 }));
};

/** What fed the value at the chain's end: the seed's feeds while it is still what the seed was, else what it became. */
export function chainFeeds(chain: Chain, upTo = chain.steps.length): Feed[] | undefined {
  const end = chainEnd(chain, upTo);
  if (end.type === chain.seed.type && end.role === chain.seed.role) return chain.seed.feeds;
  const byRole: Partial<Record<Role, Feed>> = { distance: 'distance', colour: 'colour', mask: 'mask', cell: 'cell', time: 'time', direction: 'normal', value: 'value' };
  if (end.role === 'space') return end.type === 'vec3' || chain.seed.kind === 'world' ? ['position'] : ['uv', 'fragCoord'];
  const f = byRole[end.role];
  return f ? [f] : undefined;
}

/** The ranking's view of where the chain is (its last move, what fed it, the seed's context). */
export function rankContext(chain: Chain, upTo = chain.steps.length): RankContext {
  const last = upTo ? chain.steps[upTo - 1] : null;
  return {
    dimension: chainDimension(chain, upTo),
    feeds: chainFeeds(chain, upTo),
    into: chain.seed.into,
    techniques: chain.seed.techniques,
    prev: last?.moveId ?? null,
    prevFamily: last?.family ?? null,
  };
}

/**
 * The moves that can come next: those for the chain's type in its dimension, the chain's role
 * first; other roles come too (the ranking puts them lower, `OTHER_ROLE`) — a component of space
 * can go on as a plain value.
 */
export function candidatePool(seed: Seed, cat: Catalogue): Move[] {
  const pool = movesFor(seed, cat);
  if (!seed.role) return pool;
  const have = new Set(pool.map(m => m.id));
  return [...pool, ...movesFor({ type: seed.type, dimension: seed.dimension }, cat).filter(m => !have.has(m.id))];
}
/** A recipe's score: its first step's, plus a little for how often the whole was seen. */
const RECIPE_COUNT_WEIGHT = 0.25;

/**
 * The candidate moves for the chain after `upTo` steps, grouped and ranked: what usually comes
 * next by context (rank.ts), with the finishing moves of what the chain has become lifted
 * (naming.ts). Every move here type-checks strictly on the chain's type (moves.ts `validMove`).
 */
export function nextMoves(chain: Chain, cat: Catalogue, upTo = chain.steps.length, rank: Ranker = rankByContext): NextMoves {
  const seed = seedForMoves(chain, upTo);
  const pool = candidatePool(seed, cat);
  const name = currentName(chain, upTo);
  const ctx: RankContext = { ...rankContext(chain, upTo), role: seed.role, boost: finishingBoost(name, pool) };
  const ranked = rank(pool, ctx, cat);
  const scoreOf = new Map(ranked.map(r => [r.move.id, r.score]));
  const byId = new Map(cat.moves.map(m => [m.id, m]));
  const out: NextMoves = { same: [], changing: [], recipes: [], name };
  const seen = new Set<string>();
  for (const { move: m, score } of ranked) {
    if (seen.has(`${m.sig.in}|${m.template}`)) continue;
    const tileOf = (kind: Tile['kind'], moves: Move[], sc: number): Tile => ({
      key: m.id, kind, moves, move: m, label: moveLabel(m), template: m.template, outType: m.sig.out,
      sources: moveSources(m, cat), sourceRefs: moveSourceRefs(m, cat), count: m.count, score: sc,
    });
    if (m.step || m.generated) {
      seen.add(`${m.sig.in}|${m.template}`);
      (m.sig.out === m.sig.in ? out.same : out.changing).push(tileOf('step', [m], score));
    } else if (m.steps && m.steps.length >= 2) {
      const steps = m.steps.map(id => byId.get(id));
      // Replayable only when every step is there, valid, and each one's type follows on from the last.
      if (steps.some(s => !s || !validMove(s))) continue;
      let t: GlslType = seed.type, ok = true;
      for (const s of steps as Move[]) { if (s.sig.in !== t) { ok = false; break; } t = s.sig.out; }
      if (!ok || t !== m.sig.out) continue;
      seen.add(`${m.sig.in}|${m.template}`);
      const first = scoreOf.get(steps[0]!.id) ?? score;
      out.recipes.push(tileOf('recipe', steps as Move[], first + RECIPE_COUNT_WEIGHT * Math.log1p(m.count)));
    }
  }
  out.recipes.sort((a, b) => b.score - a.score || b.count - a.count);
  return out;
}

/** A tile's steps as they'd join the chain, with the hole values tuned on the tile (`"0:#a"` → step 0's #a). */
export function tileSteps(tile: Tile, cat: Pick<Catalogue, 'docs'>, values?: Record<string, number>): ChainStep[] {
  return tile.moves.map((m, i) => {
    const s = stepFromMove(m, cat, tile.kind === 'recipe' ? tile.template : undefined);
    if (!values) return s;
    const mine: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) { const [idx, name] = k.split(':'); if (Number(idx) === i) mine[name] = v; }
    return withValues(s, mine);
  });
}

/** Steps applied one inside the next to `input`, as one expression (a tile's preview). */
export function inlineSteps(steps: readonly ChainStep[], input: string): { expr: string; type: GlslType } {
  let expr = input;
  let type: GlslType = 'unknown';
  for (const s of steps) { expr = stepCode(s, expr); type = s.sig.out; }
  return { expr, type };
}

// ── Notes ─────────────────────────────────────────────────────────────────────

/** What a family of move does, in a few words, for a step's note. */
const FAMILY_WHAT: Record<MoveFamily, string> = {
  scale: 'scales it', offset: 'shifts it', repeat: 'repeats it in cells', fold: 'folds it (mirrors round zero)', warp: 'bends it with a wave of itself',
  wave: 'runs it through a wave', polar: 'turns it into angle and distance', rotate: 'turns it', distance: 'measures a distance',
  colour: 'makes a colour from it', cell: 'snaps it to whole cells', mask: 'makes a soft or hard edge', blend: 'blends it with another value',
  clamp: 'limits it', curve: 'bends its values with a curve', project: 'projects it onto a direction', normalize: 'makes it length 1',
  angle: 'measures an angle', noise: 'reads noise with it', sample: 'reads a texture with it', swizzle: 'reorders or picks its components',
  couple: 'lets one component drive another', product: 'multiplies its components together', build: 'builds a new vector from it', other: 'transforms it',
};

/** A step's note: what it does and where the move came from (`short`: the first source only, for the line itself). */
export function stepNote(step: ChainStep, short = false): string {
  const names = short && step.sources.length > 1 ? `${step.sources[0]}…` : step.sources.join(', ');
  const where = step.generated ? 'made by type' : step.sources.length ? `from ${names}` : 'from your code';
  return `${step.label}: ${FAMILY_WHAT[step.family] ?? 'transforms it'} (${where}${step.recipe ? `; recipe ${step.recipe}` : ''})`;
}

// ── 1D: a plot over time ──────────────────────────────────────────────────────

export interface ChainPlotData {
  /** [t, value…] samples. */
  samples: Array<{ t: number; v: number[] }>;
  type: GlslType;
}

/**
 * The chain (plus `extra` steps, a tile's) evaluated on the CPU for a time seed, t from 0 to
 * `to`. Null when a step can't be evaluated here (a helper the evaluator doesn't know).
 */
export function plotChain(chain: Chain, upTo: number, extra: readonly ChainStep[] = [], to = 2 * Math.PI, n = 96): ChainPlotData | null {
  const steps = [...chain.steps.slice(0, upTo), ...extra];
  const parsed = steps.map(s => parseExpr(stepCode(s, '__in')));
  if (parsed.some(p => !p.ok)) return null;
  const samples: ChainPlotData['samples'] = [];
  try {
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * to;
      let v: Value = t;
      for (const p of parsed) v = evaluate((p as Extract<typeof p, { ok: true }>).expr, { __in: v, t, u_time: t });
      const arr = Array.isArray(v) ? v : [v];
      if (arr.some(x => typeof x !== 'number' || !Number.isFinite(x))) return null;
      samples.push({ t, v: arr });
    }
  } catch { return null; }
  return { samples, type: steps.length ? steps[steps.length - 1].sig.out : chain.seed.type };
}
