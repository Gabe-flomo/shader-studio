/**
 * boost.ts — the next-stage lean (docs/structure-hints.md): moves and nodes that belong to the
 * stage the flow strip hints next rank a little higher. Small on purpose: it breaks near-ties, it
 * never beats a confident preview finding or a strong habit of yours.
 *
 *  - Suggestions strip: +STAGE_BOOST on a move's score (kind fit 0.4…1, usage ×3, finding ×4).
 *  - Search and the Do… bar's node list: +STAGE_SEARCH_POINTS (match tiers are 10–20 apart).
 *  - Quick add: a matching pick rises at most one place.
 */
import { inFlow, stageOfType } from './stages';
import type { StageTarget } from './hintsStore';

/** Added to a suggestion's score when its node is in the next stage. */
export const STAGE_BOOST = 0.35;
/** Added to a search score (tiers are 10–20 points apart; usage adds up to 15). */
export const STAGE_SEARCH_POINTS = 4;

/** Whether a node type belongs to the target stage (read in the target's flow). */
export function inTargetStage(type: string | undefined, target: StageTarget | null | undefined): boolean {
  if (!type || !target) return false;
  return inFlow(stageOfType(type), target.flow)?.stage === target.stage;
}

/** A list with each item of the target stage moved up at most one place (stable otherwise). */
export function nudgeByStage<T>(list: readonly T[], typeOf: (x: T) => string | undefined, target: StageTarget | null | undefined): T[] {
  const out = [...list];
  if (!target) return out;
  for (let i = 1; i < out.length; i++) {
    if (inTargetStage(typeOf(out[i]), target) && !inTargetStage(typeOf(out[i - 1]), target)) {
      [out[i - 1], out[i]] = [out[i], out[i - 1]];
    }
  }
  return out;
}
