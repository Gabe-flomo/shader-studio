/**
 * The editors' side of jump to source: take this node's pending jump (jumpStore.ts)
 * and show the line, selected and flashed.
 */
import { useEffect, useState } from 'react';
import { takeNodeJump, type NodeJump } from '../../codeExplorer/jumpStore';
import { exprFieldLabel, offsetOf } from '../../codeExplorer/jump';

/** Select a span in a field and bring it into view with a short flash. */
export function showSpan(el: HTMLInputElement | HTMLTextAreaElement, start: number, length: number): void {
  el.scrollIntoView({ block: 'center' });
  el.focus({ preventScroll: true });
  const end = Math.min(el.value.length, start + Math.max(0, length));
  try { el.setSelectionRange(start, end); } catch { /* not a text field */ }
  el.animate?.([{ outline: '2px solid rgba(80,130,255,0.9)', outlineOffset: '1px' }, { outline: '2px solid rgba(80,130,255,0)', outlineOffset: '1px' }], { duration: 1600, easing: 'ease-out' });
}

/** Expression Block editor: the line's expression field (by its aria-label) at the column. */
export function useExprBlockJump(nodeId: string): void {
  useEffect(() => {
    const j = takeNodeJump(nodeId);
    if (!j) return;
    const label = exprFieldLabel(j.field);
    if (!label) return;
    // After the modal has laid out.
    const t = setTimeout(() => {
      const el = [...document.querySelectorAll<HTMLInputElement>(`[aria-label="${label}"]`)].pop();
      if (el) showSpan(el, Math.max(0, j.column - 1), j.length);
    }, 60);
    return () => clearTimeout(t);
  }, [nodeId]);
}

/** Custom Function editor: which field to show (body or helper functions) and the CodeField flash for its line. */
export function useCustomFnJump(nodeId: string, onField?: (field: 'body' | 'glslFunctions') => void): { field: string | null; flash: { lines: ReadonlyArray<[number, number]>; key: number } | null } {
  const [jump, setJump] = useState<NodeJump | null>(null);
  useEffect(() => {
    const j = takeNodeJump(nodeId);
    if (!j || (j.field !== 'body' && j.field !== 'glslFunctions')) return;
    onField?.(j.field);
    setJump(j);
    const label = j.field === 'body' ? 'Function body' : 'Helper functions';
    const t = setTimeout(() => {
      const el = [...document.querySelectorAll<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)].pop();
      if (!el) return;
      el.focus({ preventScroll: true });
      const at = offsetOf(el.value, j.line, j.column);
      try { el.setSelectionRange(at, at + j.length); } catch { /* ignore */ }
    }, 80);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, [nodeId]);
  return { field: jump?.field ?? null, flash: jump ? { lines: [[jump.line - 1, jump.line - 1]], key: jump.n } : null };
}
