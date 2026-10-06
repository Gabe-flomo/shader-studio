/**
 * jump.ts — where an instance's provenance leads (docs/code-explorer-plan.md §10.3). Pure.
 *
 *   example / saved / open graph → load the graph (unless it is the open one),
 *       enter the groups on the node's path, select the node, open its editor
 *       (Expression Block, Custom Function, or the input's expression), and
 *       scroll to the line
 *   saved shader / linked file   → the GLSL page, the line selected
 *   Convert source               → the Convert page with that shader
 *   presentation                 → the Present page, on that presentation
 *   preset / Builder function    → the Files page / the Function Builder
 */
import type { Provenance } from './types';

export type GraphRef = { kind: 'example'; key: string } | { kind: 'saved'; name: string } | { kind: 'open' };

export type JumpPlan =
  | {
    to: 'graph';
    graph: GraphRef;
    /** Groups to enter, top level first (the node's own id not included). */
    groupPath: string[];
    nodeId: string;
    /** Which editor shows the code. */
    editor: 'exprBlock' | 'customFn' | 'inputExpr' | null;
    field: string;
    line: number;
    column: number;
  }
  | { to: 'shader'; id: string; line: number; column: number }
  | { to: 'file'; docId: string; folderId: string; path: string; line: number; column: number }
  | { to: 'convert'; key: string | null }
  | { to: 'present'; name: string }
  | { to: 'files' }
  | { to: 'builder' }
  | { to: 'none'; why: string };

const after = (id: string, prefix: string) => id.slice(prefix.length);

export function planJump(p: Provenance): JumpPlan {
  const id = p.docId;
  const graphRef: GraphRef | null = id.startsWith('example:') ? { kind: 'example', key: after(id, 'example:') }
    : id.startsWith('saved:') ? { kind: 'saved', name: after(id, 'saved:') }
    : id.startsWith('open:') ? { kind: 'open' } : null;
  if (graphRef) {
    if (!p.nodeId) return { to: 'none', why: 'No node to show.' };
    const path = p.nodePath ?? [p.nodeId];
    const editor = p.field.startsWith('__inExpr_') ? 'inputExpr'
      : p.nodeType === 'exprNode' ? 'exprBlock'
      : p.nodeType === 'customFn' ? 'customFn' : null;
    return { to: 'graph', graph: graphRef, groupPath: path.slice(0, -1), nodeId: p.nodeId, editor, field: p.field, line: p.line, column: p.column };
  }
  if (id.startsWith('shader:')) return { to: 'shader', id: after(id, 'shader:'), line: p.line, column: p.column };
  if (id.startsWith('file:')) {
    const rest = after(id, 'file:');
    const slash = rest.indexOf('/');
    return { to: 'file', docId: id, folderId: rest.slice(0, slash), path: rest.slice(slash + 1), line: p.line, column: p.column };
  }
  if (id.startsWith('example-convert:')) return { to: 'convert', key: after(id, 'example-convert:') };
  if (id === 'convert:current') return { to: 'convert', key: null };
  if (id.startsWith('present:')) return { to: 'present', name: after(id, 'present:') };
  if (id.startsWith('builder:')) return { to: 'builder' };
  if (id.startsWith('preset:')) return { to: 'files' };
  return { to: 'none', why: 'Not something that can be opened.' };
}

/** Which Expression Block line (0-based) a field names: `lines[3].rhs` → 3, `result` → -1, else null. */
export function exprLineIndex(field: string): number | null {
  if (field === 'result') return -1;
  const m = /^lines\[(\d+)\]/.exec(field);
  return m ? Number(m[1]) : null;
}

/** The aria-label of the Expression Block editor's input that holds a field. */
export function exprFieldLabel(field: string): string | null {
  const i = exprLineIndex(field);
  if (i === null) return null;
  return i < 0 ? 'Return expression' : `Line ${i + 1} expression`;
}

/** Offset of (1-based line, column) in a text. */
export function offsetOf(text: string, line: number, column: number): number {
  let off = 0;
  for (let l = 1; l < line; l++) { const nl = text.indexOf('\n', off); if (nl < 0) return text.length; off = nl + 1; }
  return Math.min(text.length, off + Math.max(0, column - 1));
}
