/**
 * NotesCard — the notes a Play setup carries (PlayRecord.notes), at the top
 * of the Play page. The Play folder's examples use them to say what each one
 * shows, how it's built and what to try; anyone can write their own, and they
 * travel with play files.
 *
 * The text is plain with three marks: a blank line starts a paragraph, a line
 * starting with "• " (or "- ") is a bullet, and **bold** is bold.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';

const OPEN_KEY = 'shader-studio:play:notesOpen';

/** **bold** runs → <strong>. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul'; items: string[] };

/** Paragraphs split on blank lines; bullet lines inside one become a list. */
function parseNotes(notes: string): Block[] {
  const blocks: Block[] = [];
  for (const para of notes.replace(/\r/g, '').split(/\n\s*\n/)) {
    let cur: Block | null = null;
    for (const raw of para.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^[•-]\s+/.exec(line);
      if (bullet) {
        if (cur?.kind !== 'ul') blocks.push(cur = { kind: 'ul', items: [] });
        cur.items.push(line.slice(bullet[0].length));
      } else {
        if (cur?.kind !== 'p') blocks.push(cur = { kind: 'p', lines: [] });
        cur.lines.push(line);
      }
    }
  }
  return blocks;
}

export function NotesCard({ notes, title, editing, onEdit, onChange }: {
  notes: string;
  /** Shown in the header: the example's name, when there is one. */
  title?: string;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onChange: (notes: string) => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
  });
  const toggle = () => setOpen(o => {
    try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* preference only */ }
    return !o;
  });
  const [draft, setDraft] = useState(notes);
  const startEdit = () => { setDraft(notes); if (!open) toggle(); onEdit(true); };
  const done = () => { onChange(draft.trim()); onEdit(false); };

  return (
    // Shrinks (and scrolls) before the controls under it do: long notes never squeeze the panel shut.
    <div style={{ flexShrink: 1, minHeight: 34, display: 'flex', flexDirection: 'column', margin: '8px 12px 2px', borderRadius: radius.lg, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, overflow: 'hidden' }}>
      <div onClick={editing ? undefined : toggle} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 10px', cursor: editing ? 'default' : 'pointer', userSelect: 'none' }}>
        <Icon name={open || editing ? 'chevD' : 'chevR'} size={13} style={{ color: tk.text.faint }} />
        <Icon name="info" size={13} style={{ color: tk.accent.base }} />
        <span style={{ font: `650 12px ${fontFamily.ui}` }}>Notes</span>
        {title && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{title}</span>}
        <span style={{ flex: 1 }} />
        <span onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
          {editing
            ? <IconButton icon="check" label="Done editing notes" onClick={done} />
            : <IconButton icon="edit" label="Edit these notes (they're saved with the graph and in play files)" onClick={startEdit} />}
        </span>
      </div>
      {editing ? (
        <div style={{ minHeight: 0, overflowY: 'auto', padding: '0 10px 10px' }}>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onEdit(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) done(); }}
            rows={Math.min(14, Math.max(5, draft.split('\n').length + 1))}
            placeholder={'What this setup shows and how to play it.\n\nA blank line starts a paragraph. Start a line with • for a bullet, and wrap words in **stars** for bold.'}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', borderRadius: 8, border: 0, padding: '8px 10px', background: tk.bg.field, color: tk.text.primary, font: `12.5px/1.5 ${fontFamily.ui}` }}
          />
          <div style={{ color: tk.text.faint, fontSize: 11, marginTop: 4 }}>⌘/Ctrl + Enter to save · Esc to cancel</div>
        </div>
      ) : open && (
        <div style={{ minHeight: 0, maxHeight: 240, overflowY: 'auto', padding: '0 12px 10px 12px', color: tk.text.secondary, lineHeight: 1.5 }}>
          {parseNotes(notes).map((b, i) => b.kind === 'p'
            ? <p key={i} style={{ margin: '0 0 6px' }}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>
            : <ul key={i} style={{ margin: '0 0 6px', paddingLeft: 18 }}>{b.items.map((it, j) => <li key={j} style={{ margin: '1px 0' }}>{inline(it)}</li>)}</ul>)}
        </div>
      )}
    </div>
  );
}
