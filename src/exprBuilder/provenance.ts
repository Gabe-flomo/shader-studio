/**
 * provenance.ts — "used in: …" as links (docs/expression-builder-plan.md §4.4, phase 3): a move's
 * source as the Code explorer's provenance (so `jumpToSource` opens the graph at the node, its
 * editor at the line, or the GLSL page at a file), and its template as a Find uses pattern (the
 * Explain panel's "Where else?"). Pure.
 */
import { parseExpr, printExpr, allNodes } from '../lib/glslPatterns';
import type { Provenance, SourceKind } from '../codeExplorer/types';
import type { SourceRef } from './moves';

/** What kind of code a field is, by its name (`lines[2]` / `result`: an Expression Block…). */
function kindOf(ref: SourceRef): { sourceKind: SourceKind; nodeType?: string } {
  const f = ref.field ?? '';
  if (ref.docId.startsWith('file:')) return { sourceKind: 'file' };
  if (ref.docId.startsWith('shader:')) return { sourceKind: 'shader' };
  if (ref.docId.startsWith('example-convert:') || ref.docId.startsWith('convert:')) return { sourceKind: 'import' };
  if (ref.docId.startsWith('preset:')) return { sourceKind: 'preset' };
  if (f.startsWith('__inExpr_')) return { sourceKind: 'inputExpr' };
  if (/^lines\[\d+\](\.\w+)?$/.test(f) || f === 'result' || f === 'expr') return { sourceKind: 'expr', nodeType: 'exprNode' };
  if (f === 'body' || f === 'glslFunctions' || f === 'code') return { sourceKind: 'customFn', nodeType: 'customFn' };
  return { sourceKind: 'expr' };
}

/** A move's source as a provenance to jump to (codeExplorer/jumpRun.ts `jumpToSource`). */
export function sourceProvenance(ref: SourceRef): Provenance {
  const path = ref.nodePath ?? [];
  return {
    ...kindOf(ref), origin: ref.origin, docId: ref.docId, docLabel: ref.docLabel,
    ...(path.length ? { nodeId: path[path.length - 1], nodePath: path } : {}),
    field: ref.field ?? 'code', line: ref.line ?? 1, column: 1,
  };
}

/**
 * A template as a Find uses pattern: `x` (what the move acts on) matches any sub-expression,
 * number holes any number, other holes any expression. `fract(x * #a) - #b` → `fract($x * #a) - #b`.
 */
export function templatePattern(template: string): string {
  const r = parseExpr(template);
  if (!r.ok) return template;
  const subst = new Map<number, string>();
  for (const n of allNodes(r.expr)) if (n.kind === 'ident' && n.name === 'x') subst.set(n.id, '$x');
  return printExpr(r.expr, subst);
}
