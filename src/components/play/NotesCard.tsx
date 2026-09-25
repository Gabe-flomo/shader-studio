/**
 * NotesCard — the notes a Play setup carries (PlayRecord.notes), at the top
 * of the Play page. The Play folder's examples use them to say what each one
 * shows, how it's built and what to try; anyone can write their own, and they
 * travel with play files.
 *
 * The text is plain with a few marks: a blank line starts a paragraph, a line
 * starting with "• " (or "- ") is a bullet, **bold** is bold, and
 * [[layer:<id>]] / [[control:<id>]] is a link (noteRefs.ts): drag a layer or
 * a control onto the card to add one, click it to go there.
 */
import { useState, type ReactNode } from 'react';
import { NOTE_REF_RE, NOTE_REF_TYPE, type NoteRefKind } from './noteRefs';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';

const OPEN_KEY = 'shader-studio:play:notesOpen';

/** What a link can point at: the record's layers and controls, by id. */
export interface NoteTargets {
  layers: ReadonlyArray<{ id: string; label: string }>;
  controls: ReadonlyArray<{ id: string; label: string }>;
}

type Chip = (kind: NoteRefKind, id: string, key: string) => ReactNode;

/** **bold** runs → <strong>, links → chips. */
function inline(text: string, chip: Chip): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).forEach((part, i) => {
    const bold = part.startsWith('**') && part.endsWith('**');
    const body = bold ? part.slice(2, -2) : part;
    const bits: ReactNode[] = [];
    let last = 0, k = 0;
    for (const m of body.matchAll(NOTE_REF_RE)) {
      if (m.index! > last) bits.push(body.slice(last, m.index));
      bits.push(chip(m[1] as NoteRefKind, m[2], `${i}:${k++}`));
      last = m.index! + m[0].length;
    }
    if (last < body.length) bits.push(body.slice(last));
    out.push(bold ? <strong key={i}>{bits}</strong> : <span key={i}>{bits}</span>);
  });
  return out;
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

export function NotesCard({ notes, title, editing, targets, onEdit, onChange, onOpen }: {
  notes: string;
  /** Shown in the header: the example's name, when there is one. */
  title?: string;
  editing: boolean;
  targets: NoteTargets;
  onEdit: (on: boolean) => void;
  onChange: (notes: string) => void;
  /** A link was clicked. */
  onOpen: (kind: NoteRefKind, id: string) => void;
}) {
  const tk = useTokens();
  const [big, setBig] = useState(false);
  const [dropping, setDropping] = useState(false);
  const chip: Chip = (kind, id, key) => {
    const hit = (kind === 'layer' ? targets.layers : targets.controls).find(x => x.id === id);
    return (
      <button
        key={key}
        type="button"
        onClick={() => hit && onOpen(kind, id)}
        title={hit ? `Go to ${kind === 'layer' ? 'the layer' : 'the control'} “${hit.label}”` : 'This was deleted'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'baseline', margin: '0 1px', padding: '0 6px 0 4px', height: 18, borderRadius: 9,
          border: 0, cursor: hit ? 'pointer' : 'default', font: `600 11.5px ${fontFamily.ui}`,
          background: hit ? alpha(tk.accent.base, 0.14) : tk.bg.field, color: hit ? tk.accent.text : tk.text.faint, textDecoration: hit ? 'none' : 'line-through',
        }}
      >
        <Icon name={kind === 'layer' ? 'layoutCanvas' : 'layout'} size={11} />
        {hit ? hit.label : kind === 'layer' ? 'deleted layer' : 'deleted control'}
      </button>
    );
  };
  // Links dropped from the Layers list or the control panel. In the editor the browser inserts the text where it lands.
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(NOTE_REF_TYPE);
  const onDragOver = (e: React.DragEvent) => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropping(true); };
  const onDrop = (e: React.DragEvent) => {
    setDropping(false);
    if (!accepts(e) || editing) return;
    e.preventDefault();
    const ref = e.dataTransfer.getData(NOTE_REF_TYPE);
    if (ref) onChange(notes ? `${notes.replace(/\s+$/, '')} ${ref}` : ref);
  };
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
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
      style={{
        flex: big ? '1 1 auto' : '0 1 auto', minHeight: 34, display: 'flex', flexDirection: 'column', margin: '8px 12px 2px', borderRadius: radius.lg,
        border: `1px solid ${dropping ? tk.accent.base : tk.border.default}`, background: dropping ? alpha(tk.accent.base, 0.06) : tk.bg.panel, overflow: 'hidden',
      }}
    >
      <div onClick={editing ? undefined : toggle} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 10px', cursor: editing ? 'default' : 'pointer', userSelect: 'none' }}>
        <Icon name={open || editing ? 'chevD' : 'chevR'} size={13} style={{ color: tk.text.faint }} />
        <Icon name="info" size={13} style={{ color: tk.accent.base }} />
        <span style={{ font: `650 12px ${fontFamily.ui}` }}>Notes</span>
        {title && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{title}</span>}
        <span style={{ flex: 1 }} />
        <span onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
          <IconButton icon={big ? 'minimap' : 'fit'} label={big ? 'Make the notes small again' : 'Make the notes bigger (a page of their own)'} onClick={() => { setBig(b => !b); if (!open) toggle(); }} />
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
            rows={big ? 24 : Math.min(14, Math.max(5, draft.split('\n').length + 1))}
            placeholder={'What this setup shows and how to play it.\n\nA blank line starts a paragraph. Start a line with • for a bullet, and wrap words in **stars** for bold.'}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', borderRadius: 8, border: 0, padding: '8px 10px', background: tk.bg.field, color: tk.text.primary, font: `12.5px/1.5 ${fontFamily.ui}` }}
          />
          <div style={{ color: tk.text.faint, fontSize: 11, marginTop: 4 }}>Drag a layer or a control here to link it · ⌘/Ctrl + Enter to save · Esc to cancel</div>
        </div>
      ) : open && (
        <div style={{ minHeight: 0, maxHeight: big ? 'none' : 240, flex: big ? 1 : undefined, overflowY: 'auto', padding: '0 12px 10px 12px', color: tk.text.secondary, lineHeight: 1.5 }}>
          {parseNotes(notes).map((b, i) => b.kind === 'p'
            ? <p key={i} style={{ margin: '0 0 6px' }}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, chip)}</span>)}</p>
            : <ul key={i} style={{ margin: '0 0 6px', paddingLeft: 18 }}>{b.items.map((it, j) => <li key={j} style={{ margin: '1px 0' }}>{inline(it, chip)}</li>)}</ul>)}
        </div>
      )}
    </div>
  );
}
