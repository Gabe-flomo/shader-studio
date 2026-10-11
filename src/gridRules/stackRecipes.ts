/**
 * stackRecipes.ts — a stacked-rules recipe (gridRules/stack.ts STACK_RECIPES) as the params it sets:
 * its base (as the presets strip sets it), anything else it needs (a still base, walls, a sparse
 * start) and its cards. Used by the Stacked rules section (components/gridRules/StackForm.tsx) and
 * the tests. Pure.
 */
import { COUNT_PRESETS, LOOKS, STAGES_PRESETS, presetPatch, type GridPreset } from './spec';
import { PATTERN_PRESETS } from './stencils';
import { STACK_RECIPES, readStack } from './stack';

type P = Record<string, unknown>;

const BASE_TABLES: Record<string, Record<string, GridPreset>> = { count: COUNT_PRESETS, stages: STAGES_PRESETS, patterns: PATTERN_PRESETS as Record<string, GridPreset> };

/** A recipe's whole patch: its base (as the presets strip sets it) and its cards. */
export function stackRecipePatch(key: string): P | null {
  const rc = STACK_RECIPES.find(r => r.key === key);
  const pr = rc ? BASE_TABLES[rc.base.ruleType]?.[rc.base.preset] : undefined;
  if (!rc || !pr) return null;
  return { ruleType: rc.base.ruleType, ...(rc.base.ruleType === 'count' ? { ...LOOKS.count, brushState: 1 } : {}), ...presetPatch(pr), ...(rc.extra ?? {}), stack: readStack(rc.stack) };
}
