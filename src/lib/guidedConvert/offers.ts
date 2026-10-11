/**
 * Guided Convert, which recognised patterns a selection offers as library nodes (docs/guided-convert.md,
 * "Recognised patterns"): each pattern in the selected lines, tried on its own, kept only when the node
 * was really made (not swallowed by code the converter keeps as text) and the picture stays the same
 * as the plain conversion's: by construction for the exact recipes, by the CPU pixel check for the rest.
 */
import type { Analysis } from './analyse';
import { scopeUnits } from './analyse';
import { buildGuided, type GuidedBuild } from './build';
import { graphDifference, SAME } from './check';
import { recognise, type Recognition } from './recognise';
import { openedHelpers, type ConvertStep, type RecognisedChoice, type Step } from './stage';

export interface Offer {
  rec: Recognition;
  /** Offered as its node: made, and the same picture. */
  ok: boolean;
  /** The pixel check's largest difference (0–1), null when it couldn't run. */
  diff: number | null;
  /** Why it isn't offered. */
  why?: string;
}

/** The recognised patterns in a draft step's lines, each with whether it is offered. */
export function offersFor(a: Analysis, steps: readonly Step[], draft: ConvertStep): Offer[] {
  if (draft.mode !== 'nodes') return [];
  const opened = openedHelpers(steps);
  const units = scopeUnits(a, draft.fn);
  const recs = draft.units.flatMap(i => (units[i] ? recognise(a, units[i], opened) : []));
  if (!recs.length) return [];
  const plain = buildGuided(a, [...steps, { ...draft, recognised: {} }]);
  if (!plain.ok) return recs.map(rec => ({ rec, ok: false, diff: null, why: 'these lines can’t be cut here' }));
  return recs.map(rec => {
    const trial = buildGuided(a, [...steps, { ...draft, recognised: { [rec.id]: 'node' } }]);
    if (!trial.ok) return { rec, ok: false, diff: null, why: trial.error };
    const made = trial.recognised.find(r => r.id === rec.id);
    if (!made) return { rec, ok: false, diff: null, why: 'it sits in code the converter keeps as text (a loop it can’t unroll)' };
    if (made.as !== 'node') return { rec, ok: false, diff: null, why: `${rec.node} can’t take these values` };
    if (trial.compileErrors.length) return { rec, ok: false, diff: null, why: 'the graph wouldn’t compile' };
    const d = graphDifference(a, trial, plain);
    if (d === null) return { rec, ok: rec.exact, diff: null, ...(rec.exact ? {} : { why: 'the picture can’t be checked here, and the node isn’t the same arithmetic' }) };
    return d <= SAME ? { rec, ok: true, diff: d } : { rec, ok: false, diff: d, why: `the picture would change (by up to ${Math.max(1, Math.round(d * 255))}/255)` };
  });
}

/** The step's `recognised` for these offers: offered ones as nodes unless turned down (`plain`). */
export function recognisedChoices(offers: readonly Offer[], plain: ReadonlySet<string>): Record<string, RecognisedChoice> {
  const out: Record<string, RecognisedChoice> = {};
  for (const o of offers) if (o.ok) out[o.rec.id] = plain.has(o.rec.id) ? 'block' : 'node';
  return out;
}

/** The node a recognised pattern became in a build, when it did. */
export const recognisedNode = (b: GuidedBuild, id: string) => b.recognised.find(r => r.id === id);
