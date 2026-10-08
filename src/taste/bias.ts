/**
 * bias.ts — the taste model leaning on the inspired generator (docs/taste.md "Where it's used"):
 * a stage's choices by P(choice | stage) and the learned weights, sources by ratings (liked graphs and
 * GLSL weigh more), and a plan's taste for steering fresh seeds. Pure.
 */
import type { Plan, PlanBias } from '../lang/inspired/compose';
import { stageChoice } from '../lang/inspired/fragments';
import { sourceWeight, stageMultiplier, tasteScore, confidence, type TasteModel } from './model';
import type { Features } from './features';
import { bans, effectiveModel, isBannedChoice, type Steering } from './steering';

/** The lean for a plan. Undefined for an empty model, so the generator is exactly the unbiased one. */
export function tasteBias(m: TasteModel, extra: Partial<PlanBias> = {}): PlanBias | undefined {
  const empty = !Object.keys(m.w).length && !Object.keys(m.ratings).length && !Object.keys(m.stages).length;
  if (empty) return Object.keys(extra).length ? extra : undefined;
  return {
    stage: (stage, choice, family) => stageMultiplier(m, stage, choice, family),
    source: id => sourceWeight(m, id),
    ...extra,
  };
}

/** What the model can see of a plan before it's realised (its stages, families and sources). */
export function planFeatures(plan: Plan): Features {
  const f: Features = { _bias: 1 };
  for (const [stage, fr] of plan.assign) {
    f[`st:${stage}=${stageChoice(fr)}`] = 1;
    if (fr.family !== 'code') f[`fam:${fr.family}`] = 1;
    f[`src:${fr.sourceId}`] = 1;
  }
  return f;
}

/** A plan's taste, for steering a fresh seed (0 while the model knows nothing). */
export function planBonus(m: TasteModel): ((plan: Plan) => number) | undefined {
  const c = confidence(m);
  if (!c) return undefined;
  // Comparable to a repetition point or two at full confidence.
  return plan => 2 * c * Math.tanh(tasteScore(m, planFeatures(plan)));
}

/**
 * The lean with your steering on top (docs/taste.md "Steering"): the learned model plus the steering layer,
 * times the lean, and bans made hard: a banned stage choice, technique, family or source weighs 0, which
 * `planFor` never picks. Without steering it is exactly `tasteBias(m)`.
 */
export function steeredBias(m: TasteModel, s: Steering | undefined, extra: Partial<PlanBias> = {}): PlanBias | undefined {
  if (!s) return tasteBias(m, extra);
  const base = tasteBias(effectiveModel(m, s), extra);
  const banned = bans(s);
  if (!banned.size) return base;
  return {
    ...base,
    stage: (stage, choice, family) => (isBannedChoice(banned, stage, choice, family) ? 0 : base?.stage?.(stage, choice, family) ?? 1),
    source: id => (banned.has(`src:${id}`) ? 0 : base?.source?.(id) ?? 1),
  };
}
