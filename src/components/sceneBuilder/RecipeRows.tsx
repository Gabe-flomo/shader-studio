/**
 * RecipeRows — the Recipe tab's recipe as rows, styled like an Expression Block's lines
 * (docs/scene-builder.md, "Recipe"): one numbered row per clause; a combine's items each on their
 * own indented line under it, its `k=` on the closing line; long settings wrap with a hanging
 * indent under the shape's name. Words are coloured (RecipeCode).
 *
 * Click a row to change it (Enter keeps it, Shift+Enter a new line, Esc leaves it; suggestions and
 * the settings line as in the text editor); drag a row to move it (▲▼ on a touch screen); × deletes
 * it; + Add a clause at the end. Every change goes through `onChange` with the whole recipe, which
 * answers with the mistakes (none: the form followed).
 */
import { useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { useViewport } from '../../lib/viewport';
import { clauseTree, splitClauses, type ClauseNode } from '../../sceneBuilder/highlight';
import { deleteClause, moveClause, replaceClause } from '../../sceneBuilder/recipeRows';
import type { RecipeError } from '../../sceneBuilder/recipe';
import { recipeAssist } from '../../lang/complete';
import { AssistList, SignatureLine, useTypeAhead } from '../builders/TypeAhead';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RecipeCode } from './RecipeCode';

const NO_ERRORS: RecipeError[] = [];
const MONO = `12.5px/1.7 ${fontFamily.mono}`;

/** One line of a row: wraps with a hanging indent under its first word (a shape's name). */
function Line({ text, depth }: { text: string; depth: number }) {
  const hang = Math.min(14, (text.split(' ')[0]?.length ?? 0) + 1);
  return (
    <div data-recipe-line style={{ paddingLeft: `calc(${depth * 2}ch + ${hang}ch)`, textIndent: `-${hang}ch`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      <RecipeCode text={text} errors={NO_ERRORS} />
    </div>
  );
}

/** A clause drawn as its tree: head, items (one level in per combine), closing part. */
function Tree({ node, depth, last }: { node: ClauseNode; depth: number; last: boolean }) {
  if (!node.children) return <Line text={`${node.head}${depth > 0 && !last ? ',' : ''}`} depth={depth} />;
  return (
    <>
      <Line text={node.head} depth={depth} />
      {node.children.map((c, i) => <Tree key={i} node={c} depth={depth + 1} last={i === node.children!.length - 1} />)}
      <Line text={`${node.tail ?? ')'}${depth > 0 && !last ? ',' : ''}`} depth={depth} />
    </>
  );
}

function RowEditor({ initial, onCommit, onCancel, errors }: { initial: string; onCommit: (text: string) => void; onCancel: () => void; errors: string[] }) {
  const tk = useTokens();
  const [draft, setDraft] = useState(initial);
  const [caret, setCaret] = useState<number | null>(initial.length);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const ta = useTypeAhead(draft, caret, recipeAssist, (next, at) => {
    setDraft(next); setCaret(at);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(at, at); });
  });
  const track = () => setCaret(ref.current?.selectionStart ?? null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <textarea ref={ref} autoFocus data-recipe-row-editor data-captures-escape value={draft} spellCheck={false} aria-label="Change this clause"
        rows={Math.max(1, draft.split('\n').length)}
        onChange={e => { setDraft(e.target.value); setCaret(e.target.selectionStart); }}
        onKeyDown={e => {
          if (ta.onKeyDown(e)) return;
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit(draft); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done.current = true; onCancel(); }
        }}
        onKeyUp={track} onClick={track} onBlur={() => { if (!done.current) onCommit(draft); }}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '7px 10px', borderRadius: radius.md, outline: 'none',
          border: `1.5px solid ${errors.length ? tk.status.danger : tk.accent.base}`, background: tk.bg.panel, color: tk.text.primary, font: MONO,
        }} />
      {ta.signature && <SignatureLine sig={ta.signature} />}
      {ta.items.length > 0 && <AssistList items={ta.items} active={ta.active} onPick={ta.pick} onHover={ta.setActive} />}
      {errors.map((m, i) => <span key={i} data-recipe-row-error style={{ font: `12px ${fontFamily.ui}`, color: tk.status.danger }}>{m}</span>)}
    </div>
  );
}

export function RecipeRows({ text, onChange }: { text: string; onChange: (next: string) => RecipeError[] }) {
  const tk = useTokens();
  const touch = useViewport(s => s.touchSeen);
  const clauses = splitClauses(text);
  const [editing, setEditing] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const commit = (i: number, draft: string) => {
    const was = clauses[i]?.text ?? '';
    if (draft.trim() === was.trim()) { setEditing(null); setErrors([]); return; }
    const errs = onChange(replaceClause(text, i, draft));
    if (errs.length) { setErrors(errs.map(e => e.message)); return; }
    setEditing(null); setErrors([]);
  };
  const move = (from: number, to: number) => { if (from !== to) onChange(moveClause(text, from, to)); };
  const rows = [...clauses.map(c => c.text), ...(editing === clauses.length ? [''] : [])];
  return (
    <div data-recipe-rows style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((c, i) => (
        <div key={i} data-recipe-row={i}
          draggable={!touch && editing === null}
          onDragStart={e => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
          onDragOver={e => { if (dragFrom !== null) { e.preventDefault(); setOver(i); } }}
          onDragLeave={() => setOver(o => (o === i ? null : o))}
          onDrop={e => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); setOver(null); }}
          onDragEnd={() => { setDragFrom(null); setOver(null); }}
          style={{
            display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 8, alignItems: 'start',
            opacity: dragFrom === i ? 0.4 : 1, boxShadow: over === i && dragFrom !== null && dragFrom !== i ? `0 ${dragFrom < i ? 2 : -2}px 0 ${tk.accent.base}` : 'none',
          }}>
          <span style={{ paddingTop: 8, textAlign: 'right', font: `600 11px ${fontFamily.mono}`, color: tk.text.disabled, userSelect: 'none' }}>{i + 1}</span>
          {editing === i ? (
            <RowEditor initial={c} errors={errors} onCommit={d => commit(i, d)} onCancel={() => { setEditing(null); setErrors([]); }} />
          ) : (
            <div role="button" tabIndex={0} data-recipe-row-text title="Click to change this clause"
              onClick={() => { setEditing(i); setErrors([]); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditing(i); } }}
              style={{
                minWidth: 0, padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary, font: MONO, cursor: 'text',
                boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`,
              }}>
              <Tree node={clauseTree(c)} depth={0} last />
            </div>
          )}
          <span style={touch ? { display: 'grid', gridTemplateColumns: 'auto auto', gridAutoFlow: 'column', gridTemplateRows: 'auto auto', gap: 0, paddingTop: 2 } : { display: 'flex', gap: 2, paddingTop: 3 }}>
            {touch ? (
              <>
                <IconButton icon="chevU" size="sm" label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)} />
                <IconButton icon="chevD" size="sm" label="Move down" disabled={i >= clauses.length - 1} onClick={() => move(i, i + 1)} />
              </>
            ) : (
              <span title="Drag to move this clause" aria-hidden style={{ display: 'flex', alignItems: 'center', padding: '6px 2px', color: tk.text.faint, cursor: 'grab' }}><Icon name="grip" size={14} /></span>
            )}
            <IconButton icon="close" size="sm" label="Delete this clause" onClick={() => { setEditing(null); onChange(deleteClause(text, i)); }} />
          </span>
        </div>
      ))}
      {editing === null && (
        <button type="button" data-recipe-add onClick={() => { setEditing(clauses.length); setErrors([]); }}
          style={{ alignSelf: 'flex-start', marginLeft: 30, border: 0, background: 'none', padding: '4px 6px', borderRadius: radius.md, color: tk.accent.base, font: `500 12px ${fontFamily.ui}`, cursor: 'pointer' }}>
          + Add a clause
        </button>
      )}
      <span style={{ marginLeft: 30, font: `11.5px ${fontFamily.ui}`, color: alpha(tk.text.muted, 0.9) }}>
        {touch ? 'Tap a row to change it; ▲▼ move it.' : 'Click a row to change it (Enter keeps it, Shift+Enter adds a line); drag a row to move it.'}
      </span>
    </div>
  );
}
