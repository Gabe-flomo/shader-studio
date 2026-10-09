/**
 * examples.ts — chains written as templates (the help cards' worked examples): looked up in the
 * catalogue by template and input type, so they carry the moves' real sources; a template the
 * catalogue doesn't have is made into a move on the spot (typed with the glslPatterns checker).
 */
import { formatNumber, parseExpr, type GlslType } from '../lib/glslPatterns';
import { moveId, typeOfExpr, type Catalogue, type Move, type MoveHole } from './moves';
import { stepFromMove, withValues, type ChainStep, type ExprSeed } from './chain';
import { familyOf } from './shared';


export interface TemplateStep { template: string; values?: Record<string, number> }

export interface WorkedExample { label: string; seed: ExprSeed['kind']; steps: TemplateStep[] }

/** "Start from UV → Repeat → Centre → Circle: a grid of dots." */
export const WORKED_EXAMPLE: WorkedExample = {
  label: 'UV → Repeat → Centre → Circle',
  seed: 'uv',
  steps: [
    { template: 'fract(x * #a)', values: { '#a': 4 } },
    { template: 'x - #a', values: { '#a': 0.5 } },
    { template: 'length(x)' },
  ],
};

/** A move made from a template alone (number holes `#a`… only). */
function adHocMove(template: string, inType: GlslType, values: Record<string, number>): Move | null {
  const names = [...new Set(template.match(/#[a-z]\d*/g) ?? [])];
  const env: Record<string, GlslType> = { x: inType };
  for (const n of names) env[n] = 'float';
  const out = typeOfExpr(template, env);
  if (out === 'unknown') return null;
  const holes: MoveHole[] = names.map(n => {
    const v = values[n] ?? 1;
    return { name: n, kind: 'number', type: 'float', default: v, range: { min: Math.min(0, v), max: Math.max(1, v * 2) }, seenMin: v, seenMax: v, vals: [] };
  });
  const parsed = parseExpr(template);
  const sig = { in: inType, out, role: 'unknown' as const, outRole: 'unknown' as const };
  return {
    id: moveId(`adhoc|${inType}|${template}`), key: `adhoc|${inType}|${template}`, template, holes, sig,
    family: parsed.ok ? familyOf(parsed.expr, sig) : 'other', count: 0, sources: [], sourceCount: 0, contexts: [], step: true, generated: true,
  };
}

/** Template steps as chain steps from `seed`, each the catalogue's move when it has one. */
export function resolveTemplateSteps(steps: readonly TemplateStep[], seed: ExprSeed, cat: Catalogue): ChainStep[] {
  const out: ChainStep[] = [];
  let type: GlslType = seed.type;
  for (const s of steps) {
    const found: Move | null = cat.moves
      .filter(m => m.template === s.template && m.sig.in === type)
      .sort((a, b) => Number(b.contexts.some(c => c.dim === seed.dimension)) - Number(a.contexts.some(c => c.dim === seed.dimension)) || b.count - a.count)[0]
      ?? adHocMove(s.template, type, s.values ?? {});
    if (!found) break;
    out.push(withValues(stepFromMove(found, cat), s.values));
    type = found.sig.out;
  }
  return out;
}

/** A template step as text, for a help card's button (`fract(x * 4.0)`). */
export function templateText(s: TemplateStep): string {
  return s.template.replace(/#[a-z]\d*/g, n => (s.values?.[n] !== undefined ? formatNumber(s.values[n]) : n));
}
