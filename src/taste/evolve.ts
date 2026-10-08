/**
 * evolve.ts — Evolve (docs/taste.md): pick one of two, round after round, and the taste model learns.
 *
 *   Round 1   two fresh inspired graphs (leaning on the taste model).
 *   Pick one  the model learns the pair (Bradley–Terry), and the next round shows
 *             (a) Refine: the pick mutated — settings nudged within their interesting ranges, sometimes one
 *                 technique swapped for another of the same family, sometimes a post step added;
 *             (b) Branch: a new inspired graph that uses the pick as one of its sources, biased by the
 *                 model's per-stage preferences.
 *   Keep      commits the one chosen (the caller makes it one undo step).
 *   Escape    restores the original exactly (the same array).
 *
 * Pure: the state machine takes a generator and the model and returns new ones. The same seed and the same
 * model make the same rounds.
 */
import type { GraphNode } from '../types/nodeGraph';
import { deriveSeed, makeRng, type Rng } from '../lib/surprise/rng';
import { compileProblem, inspire, realisePlan, withSource, type Composition, type InspPool, type Plan } from '../lang/inspired/compose';
import { stageChoice, type Fragment, type Stage } from '../lang/inspired/fragments';
import { getNodeDefinitionFor } from '../nodes/definitions';
import { randomizedParams } from '../nodes/randomizeParams';
import { tasteBias } from './bias';
import { compositionFeatures, type Features } from './features';
import { learnPair, learnSignal, stageMultiplier, type TasteModel } from './model';

export type EvolveKind = 'fresh' | 'refine' | 'branch';

export interface EvolveCand {
  /** Unique within a session: `r<round><a|b>`. */
  id: string;
  kind: EvolveKind;
  comp: Composition;
  seed: number;
  /** What changed, in words ("nudged 3 settings", "swapped Exp falloff → Smoothstep glow"). */
  changes: string[];
  /** Image metrics etc. the caller adds once it has drawn it. */
  extra?: { metrics?: Features; why?: string[] };
}

export interface EvolveGen {
  fresh(seed: number, model: TasteModel, tag: string): EvolveCand;
  refine(pick: EvolveCand, seed: number, model: TasteModel, tag: string): EvolveCand;
  branch(pick: EvolveCand, seed: number, model: TasteModel, tag: string): EvolveCand;
}

export interface EvolveOptions {
  /** Why a graph isn't worth showing (a GPU compile, a blank frame), or null. */
  check?: (nodes: GraphNode[]) => string | null;
  /** Names new nodes (default: a counter per candidate, so a seed makes the same ids). */
  nextId?: () => string;
  /** Features of a candidate (default: its composition's; the app adds image metrics). */
  features?: (c: EvolveCand) => Features;
}

const counter = (tag: string) => { let k = 0; return () => `ev${tag}_${++k}`; };

/** Nudge a few nodes' settings (a window of 25% of the interesting range round the current value). */
export function nudgeSettings(nodes: GraphNode[], rng: Rng, howMany = rng.int(1, 3)): { nodes: GraphNode[]; nudged: number } {
  const able = nodes.filter(n => !['uv', 'time', 'output'].includes(n.type) && getNodeDefinitionFor(n)?.paramDefs && Object.keys(getNodeDefinitionFor(n)!.paramDefs!).length);
  const pick = new Set(rng.sample(able, Math.min(howMany, able.length)).map(n => n.id));
  let nudged = 0;
  const out = nodes.map(n => {
    if (!pick.has(n.id)) return n;
    const def = getNodeDefinitionFor(n)!;
    const changed = randomizedParams({ ...n, params: { ...n.params, __randAmount: 0.25 } }, def, () => rng.next());
    // Colours stay (a palette is a choice, not a setting to nudge).
    const kept = Object.fromEntries(Object.entries(changed).filter(([, v]) => typeof v === 'number'));
    if (!Object.keys(kept).length) return n;
    nudged += Object.keys(kept).length;
    return { ...n, params: { ...n.params, ...kept } };
  });
  return { nodes: out, nudged };
}

/** Another technique of the same family for one stage (by taste), or a post step added; null when none. */
export function mutatePlan(pool: InspPool, plan: Plan, rng: Rng, model: TasteModel): { plan: Plan; change: string } | null {
  const swappable: Array<{ stage: Stage; from: Fragment; options: Fragment[] }> = [];
  for (const [stage, f] of plan.assign) {
    const whats = pool.byStage.get(stage)?.get(f.family);
    if (!whats) continue;
    const options = [...whats.values()].map(fs => fs[0]).filter(o => stageChoice(o) !== stageChoice(f) || (f.family === 'code' && o.key !== f.key));
    if (options.length) swappable.push({ stage, from: f, options });
  }
  const canPost = !plan.assign.has('post') && plan.stages.includes('post') && (pool.byStage.get('post')?.size ?? 0) > 0;
  if (canPost && (rng.chance(0.35) || !swappable.length)) {
    const posts = [...pool.byStage.get('post')!.values()].flatMap(w => [...w.values()].map(fs => fs[0]));
    const f = rng.weighted(posts.map(p => [p, stageMultiplier(model, 'post', stageChoice(p), p.family)] as const));
    const assign = new Map(plan.assign);
    assign.set('post', f);
    return { plan: { ...plan, assign }, change: `added ${stageChoice(f)} (post)` };
  }
  if (!swappable.length) return null;
  const s = rng.pick(swappable);
  const to = rng.weighted(s.options.map(o => [o, stageMultiplier(model, s.stage, stageChoice(o), o.family)] as const));
  const assign = new Map(plan.assign);
  assign.set(s.stage, to);
  return { plan: { ...plan, assign, sources: [...new Set([...plan.sources, to.sourceId])] }, change: `swapped ${stageChoice(s.from)} → ${stageChoice(to)}` };
}

/** Settings carried from the pick to a re-realised plan, node by node (where they came from in the plan). */
function carrySettings(from: Composition, to: Composition): GraphNode[] {
  const byOrigin = new Map<string, GraphNode>();
  for (const n of from.nodes) { const o = from.origin[n.id]; if (o) byOrigin.set(o, n); }
  return to.nodes.map(n => {
    const src = byOrigin.get(to.origin[n.id] ?? '');
    return src && src.type === n.type ? { ...n, params: { ...n.params, ...Object.fromEntries(Object.entries(src.params).filter(([k]) => k !== '__comment')) } } : n;
  });
}

export function makeEvolveGen(pool: InspPool, o: EvolveOptions = {}): EvolveGen {
  const ok = (nodes: GraphNode[]) => (compileProblem(nodes) ?? o.check?.(nodes) ?? null) === null;
  const idFor = (tag: string) => o.nextId ?? counter(tag);
  return {
    fresh(seed, model, tag) {
      const res = inspire({ pool, seed, tries: 6, check: o.check, nextId: idFor(tag), bias: tasteBias(model) });
      return { id: tag, kind: 'fresh', comp: res, seed: res.seed, changes: [] };
    },
    refine(pick, seed, model, tag) {
      for (let a = 0; a < 4; a++) {
        const rng = makeRng(deriveSeed(seed, a));
        const changes: string[] = [];
        let comp: Composition = pick.comp;
        let nodes = pick.comp.nodes;
        // Sometimes a technique swap (or a post step); always a few settings nudged.
        if (pick.comp.plan.assign.size && rng.chance(0.5)) {
          const m = mutatePlan(pool, pick.comp.plan, rng, model);
          const next = m && realisePlan(m.plan, pick.comp.seed, idFor(`${tag}.${a}`));
          if (m && next) { comp = next; nodes = carrySettings(pick.comp, next); changes.push(m.change); }
        }
        const nudged = nudgeSettings(nodes, rng);
        if (nudged.nudged) changes.push(`nudged ${nudged.nudged} setting${nudged.nudged === 1 ? '' : 's'}`);
        nodes = nudged.nodes;
        if (!ok(nodes)) continue;
        return { id: tag, kind: 'refine', comp: { ...comp, nodes }, seed, changes };
      }
      return { id: tag, kind: 'refine', comp: pick.comp, seed, changes: ['unchanged (nothing else compiled)'] };
    },
    branch(pick, seed, model, tag) {
      const srcId = `evolve:${pick.id}`;
      const p2 = withSource(pool, { id: srcId, label: 'Your pick', kind: 'graph', nodes: pick.comp.nodes });
      const res = inspire({ pool: p2, seed, tries: 6, check: o.check, nextId: idFor(tag), bias: tasteBias(model, p2.bySource.has(srcId) ? { mustUse: srcId } : {}) });
      return { id: tag, kind: 'branch', comp: res, seed: res.seed, changes: [p2.bySource.has(srcId) ? 'grown from your pick' : 'a new branch'] };
    },
  };
}

// ── The state machine ────────────────────────────────────────────────────────

export interface EvolveState {
  seed: number;
  round: number;
  original: GraphNode[];
  pair: [EvolveCand, EvolveCand];
  picks: Array<{ round: number; chosen: string; other: string }>;
  status: 'open' | 'kept' | 'escaped';
  /** What the graph becomes: the kept candidate's nodes, or the original (the same array) on Escape. */
  result: GraphNode[] | null;
}

const featuresOf = (o: EvolveOptions, c: EvolveCand) => o.features?.(c) ?? compositionFeatures(c.comp);

export function startEvolve(original: GraphNode[], seed: number, gen: EvolveGen, model: TasteModel): EvolveState {
  const a = gen.fresh(deriveSeed(seed, 'r1a'), model, 'r1a');
  let b = gen.fresh(deriveSeed(seed, 'r1b'), model, 'r1b');
  // Two different pictures: another seed when both landed on the same plan.
  for (let k = 0; k < 3 && sameLook(a, b); k++) b = gen.fresh(deriveSeed(seed, `r1b${k}`), model, 'r1b');
  return { seed, round: 1, original, pair: [a, b], picks: [], status: 'open', result: null };
}

const sameLook = (a: EvolveCand, b: EvolveCand) => a.comp.stages.map(s => s.from).join() === b.comp.stages.map(s => s.from).join();

/** Pick one of the pair: the model learns it, and the next round is Refine and Branch of the pick. */
export function pickEvolve(s: EvolveState, which: 0 | 1, gen: EvolveGen, model: TasteModel, o: EvolveOptions = {}): { state: EvolveState; model: TasteModel } {
  if (s.status !== 'open') return { state: s, model };
  const chosen = s.pair[which], other = s.pair[1 - which];
  const learned = learnPair(model, featuresOf(o, chosen), featuresOf(o, other));
  const round = s.round + 1;
  const refine = gen.refine(chosen, deriveSeed(s.seed, `r${round}a`), learned, `r${round}a`);
  const branch = gen.branch(chosen, deriveSeed(s.seed, `r${round}b`), learned, `r${round}b`);
  return {
    state: { ...s, round, pair: [refine, branch], picks: [...s.picks, { round: s.round, chosen: chosen.id, other: other.id }] },
    model: learned,
  };
}

/** Keep one of the pair: it wins over the other, it counts as kept, and it's the result. */
export function keepEvolve(s: EvolveState, which: 0 | 1, model: TasteModel, o: EvolveOptions = {}): { state: EvolveState; model: TasteModel } {
  if (s.status !== 'open') return { state: s, model };
  const chosen = s.pair[which], other = s.pair[1 - which];
  const f = featuresOf(o, chosen);
  const m = learnSignal(learnPair(model, f, featuresOf(o, other)), 'kept', f);
  return { state: { ...s, status: 'kept', result: chosen.comp.nodes, picks: [...s.picks, { round: s.round, chosen: chosen.id, other: other.id }] }, model: m };
}

/** Escape: the original back, exactly; nothing more learned. */
export function escapeEvolve(s: EvolveState): EvolveState {
  if (s.status !== 'open') return s;
  return { ...s, status: 'escaped', result: s.original };
}
