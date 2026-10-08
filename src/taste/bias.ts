/**
 * bias.ts — the taste model leaning on the inspired generator (docs/taste.md "Where it's used"):
 * a stage's choices by P(choice | stage) and the learned weights, sources by ratings (liked graphs and
 * GLSL weigh more), and a plan's taste for steering fresh seeds. Pure.
 */
import type { Plan, PlanBias } from '../lang/inspired/compose';
import { stageChoice } from '../lang/inspired/fragments';
import { sourceWeight, stageMultiplier, tasteScore, confidence, type TasteModel } from './model';
import type { Features } from './features';

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
