/**
 * finishPresets.ts — the Finish presets that come with the app (docs/finish-stack.md, "Presets").
 *
 * One kind of preset for the whole picture: a Finish stack. The grade's Looks (Teal & orange,
 * Bleach bypass…) are presets of a one-effect stack, a Grade set to that look, and a few
 * starting stacks put several whole-picture effects together. They load like your own stack
 * presets (Replace stack or Add to stack) wherever the Finish is edited: Play's Finish rail, the
 * builder's Finish card and the Studio's Finish button. Graph-building effects (Long exposure,
 * Trails, Datamosh…) are groups of nodes, so they stay under Effects in the Library.
 */
import { GRADE_LOOKS, applyLook, newFinishEffect, type FinishEffect, type FinishKind } from '../types/playFinish';
import type { StackPreset } from './finishLibrary';

export interface BuiltInFinishPreset extends StackPreset {
  /** One line about it. */
  description: string;
  /** From the grade's Looks (a Grade set to that look). */
  look?: string;
}

const fx = (kind: FinishKind, values: Record<string, number> = {}): FinishEffect => ({ ...newFinishEffect(kind, `fx_${kind}`), ...values });
const graded = (lookId: string): FinishEffect => {
  const look = GRADE_LOOKS.find(l => l.id === lookId)!;
  return applyLook(newFinishEffect('grade', 'fx_grade'), look);
};

/** Ids start with `fp-` (built in), so they never collide with saved presets (`stack_…`). */
export const BUILTIN_FINISH_PRESETS: readonly BuiltInFinishPreset[] = [
  ...GRADE_LOOKS.map((l): BuiltInFinishPreset => ({
    id: `fp-look-${l.id}`, name: l.name, description: l.description, look: l.id, savedAt: 0,
    finish: { on: true, effects: [graded(l.id)] },
  })),
  {
    id: 'fp-film', name: 'Film', description: 'Warm film grade, a little grain and soft dark corners', savedAt: 0,
    finish: { on: true, effects: [graded('warm-film'), fx('grain', { amount: 0.25 }), fx('vignette', { amount: 0.35 })] },
  },
  {
    id: 'fp-old-tv', name: 'Old TV', description: 'A curved CRT screen with its mask, and grain', savedAt: 0,
    finish: { on: true, effects: [fx('crt'), fx('grain', { amount: 0.2 })] },
  },
  {
    id: 'fp-dream', name: 'Dreamy', description: 'A faded print with a deep glow round the bright parts', savedAt: 0,
    finish: { on: true, effects: [graded('faded-print'), fx('deepglow')] },
  },
  {
    id: 'fp-lens', name: 'Cheap lens', description: 'Colour fringes toward the edges and a vignette', savedAt: 0,
    finish: { on: true, effects: [fx('chroma'), fx('vignette')] },
  },
];

export function builtInFinishPreset(id: string): BuiltInFinishPreset | undefined {
  return BUILTIN_FINISH_PRESETS.find(p => p.id === id);
}
