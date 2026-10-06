/**
 * Suggestions (docs/suggestions.md): context-aware next moves for the selected node, ranked by
 * your own graphs. Deterministic and offline; nothing leaves this browser.
 */
import type { GraphNode } from '../types/nodeGraph';
import { learnedTable, personalTable, priorTable, reconcileSavedGraphs } from './learning';
import { rankMoves, type RankTables, type RankedMove, type RankOptions } from './rank';
// Taught moves register themselves with the moves library (offered and ranked with the rest).
import './taught';

export type { ValueKind } from './kinds';
export type { Move, MoveArg } from './moves';
export type { RankedMove, RankTables } from './rank';
export type { OutputMeasurement } from './outputRules';
export { MOVES, MOVES_BY_ID, movesFor, moveById, allMoves } from './moves';
export { applyMove, type AppliedMove, type MoveTarget } from './applyMove';
export { rankMoves, learnedNext, affinity } from './rank';
export { measureField, outputSuggestions } from './outputRules';
export { outputKinds, spaceInputs, primaryKind, socketKind } from './kinds';
export {
  LEARNING_KEY, learnGraph, learnSaved, recordWireBetween, resetLearning, learningSummary, subscribeLearning, learningVersion, textSignature,
} from './learning';

/** The tables every ranking uses now. */
export function rankTables(): RankTables {
  return { table: learnedTable().table, personal: personalTable(), prior: priorTable() };
}

/** The ranked moves for a node in `scope` (its graph level). */
export function suggestionsFor(node: GraphNode, scope: GraphNode[], opts: RankOptions = {}): RankedMove[] {
  startLearning();
  return rankMoves(node, scope, rankTables(), opts);
}

let started = false;
/**
 * Read the saved graphs once (when the browser is idle), and again whenever they change
 * (a save, an import, a workspace folder bringing graphs in). Safe to call often.
 */
export function startLearning(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const run = () => { try { reconcileSavedGraphs(); } catch { /* learning is a nicety */ } };
      const idle = (window as unknown as { requestIdleCallback?: (fn: () => void) => void }).requestIdleCallback;
      if (idle) idle(run); else run();
    }, ms);
  };
  later(300);
  window.addEventListener('saved-graphs-changed', () => later(1500));
  window.addEventListener('storage', e => { if (e.key?.startsWith('shader-studio:')) later(3000); });
}
