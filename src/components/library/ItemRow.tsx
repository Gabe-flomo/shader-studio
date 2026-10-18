/**
 * ItemRow — one saved thing in a sidebar list (the Library, Nodes, Favorites): its icon or
 * picture, its name, a tag, and on hover its actions (export, edit, rename, delete). A saved item
 * that has a preview opens it under the row on click; double-click (or drag) places it.
 * SavedItemPreview is that card; RenameField the inline rename; EmptyHint a list's empty line.
 */
import React, { useState } from 'react';
import { nodeDragProps, nodeDragStyle, type DropPayload } from '../NodeGraph/nodeDrop';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { CreditTag } from '../ui/Credit';
import type { SourceCredit } from '../../types/credit';

// ── Saved-item row ────────────────────────────────────────────────────────────
export function ItemRow({ label, icon, color, onClick, onDoubleClick, selected = false, preview, onDelete, onRename, onEdit, editLabel = 'Edit', onExport, hint, tag, extra, thumb, source, drag, onDragDone }: {
  label: string; icon: IconName; color: string;
  /** Where an example comes from: a small credit line under the name. */
  source?: SourceCredit;
  /** Drawn in place of the icon (a saved function's rendered thumbnail). */
  thumb?: React.ReactNode;
  /** One line shown in the row's tooltip (an example's description) */
  hint?: string;
  /** Small pill after the name ("Play" for a graph that loads with a Play setup). */
  tag?: string;
  onClick: () => void;
  /** Saved items: click selects (showing `preview`), double-click places */
  onDoubleClick?: () => void;
  selected?: boolean;
  preview?: React.ReactNode;
  onDelete?: () => void;
  onRename?: () => void;
  /** Open the item for editing (distinct from renaming). */
  onEdit?: () => void;
  editLabel?: string;
  /** Save the item as a shareable file. */
  onExport?: () => void;
  /** Always shown before the hover actions (a saved graph's version count). */
  extra?: React.ReactNode;
  /** Pressing and moving drags the item onto the graph (nodeDrop.ts). */
  drag?: DropPayload | null;
  onDragDone?: () => void;
}) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  const row = (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minHeight: 32, display: 'flex', alignItems: 'center', gap: 9, padding: source ? '4px 4px 4px 8px' : '0 4px 0 8px', borderRadius: radius.md,
        background: selected ? tk.bg.selected : hovered ? tk.bg.hover : 'transparent',
      }}
    >
      {thumb ?? <Icon name={icon} size={15} style={{ color }} />}
      <button
        type="button"
        // The second click of a double-click shouldn't collapse the preview it just opened
        onClick={e => { if (onDoubleClick && e.detail > 1) return; onClick(); }}
        onDoubleClick={onDoubleClick}
        {...nodeDragProps(drag ?? null, onDragDone)}
        aria-expanded={preview !== undefined ? selected : undefined}
        title={`${hint ? `${label} — ${hint}` : label}${onDoubleClick ? ` · double-click to add${drag ? ' or drag onto the graph' : ''}` : ''}`}
        style={{
          flex: 1, minWidth: 0, height: source ? undefined : 32, alignSelf: 'stretch', border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer',
          color: tk.text.secondary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(drag ? nodeDragStyle : {}),
          ...(source ? { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 } : {}),
        }}
      >{source ? <><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span><CreditTag source={source} size={10.5} compact /></> : label}</button>
      {tag && (
        <span title={`Loads with a Play setup`} style={{ height: 18, padding: '0 6px', borderRadius: 5, display: 'inline-flex', alignItems: 'center', flexShrink: 0, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.02em' }}>{tag}</span>
      )}
      {extra}
      {(hovered || selected) && onExport && <IconButton icon="export" label="Export as a file" size="sm" onClick={e => { e.stopPropagation(); onExport(); }} />}
      {(hovered || selected) && onEdit && <IconButton icon="layoutGraph" label={editLabel} size="sm" onClick={e => { e.stopPropagation(); onEdit(); }} />}
      {(hovered || selected) && onRename && <IconButton icon="edit" label="Rename" size="sm" onClick={e => { e.stopPropagation(); onRename(); }} />}
      {(hovered || selected) && onDelete && <IconButton icon="trash" label="Delete" size="sm" tone="danger" onClick={e => { e.stopPropagation(); onDelete(); }} />}
    </div>
  );
  if (!selected || !preview) return row;
  return <div>{row}{preview}</div>;
}

/**
 * Card under a selected saved item: its name and kind, a one-line signature, the comment it was
 * saved with, and Add to graph (double-clicking the row does the same).
 */
export function SavedItemPreview({ name, kind, signature, comment, onAdd, picture }: {
  name: string; kind: string; signature?: string; comment?: string; onAdd: () => void;
  /** A larger picture beside the name (a saved function's thumbnail). */
  picture?: React.ReactNode;
}) {
  const tk = useTokens();
  return (
    <div style={{ margin: '4px 2px 8px', padding: '10px 12px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {picture ? (
        // The picture beside the name, with the kind under it: the sidebar is narrow, the name comes first.
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {picture}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <b style={{ fontWeight: 600, fontSize: 13, color: tk.text.primary, overflowWrap: 'anywhere' }}>{name}</b>
            <span style={{ fontSize: 11, color: tk.text.faint }}>{kind}</span>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b style={{ fontWeight: 600, fontSize: 13, color: tk.text.primary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</b>
          <span style={{ fontSize: 11, color: tk.text.faint }}>{kind}</span>
        </div>
      )}
      {signature && (
        <code style={{ font: `11.5px/1.5 ${fontFamily.mono}`, color: tk.text.secondary, background: tk.bg.field, borderRadius: 6, padding: '5px 8px', overflowWrap: 'anywhere' }}>{signature}</code>
      )}
      {comment ? (
        <div style={{ display: 'flex', gap: 7, fontSize: 12, lineHeight: 1.45, color: tk.text.secondary }}>
          <Icon name="comment" size={14} style={{ color: tk.text.faint, flexShrink: 0, marginTop: 1 }} />
          <span style={{ whiteSpace: 'pre-wrap' }}>{comment}</span>
        </div>
      ) : (
        <span style={{ fontSize: 11.5, color: tk.text.faint }}>No comment. Add one on the node before saving to see it here.</span>
      )}
      <Button size="sm" variant="primary" icon="plus" onClick={onAdd} style={{ alignSelf: 'flex-start' }}>Add to graph</Button>
    </div>
  );
}

export const signatureOf = (name: string, outputType: string, inputs: Array<{ name: string; type: string }>) =>
  `${outputType} ${name.replace(/\s+/g, '_')}(${inputs.map(i => `${i.type} ${i.name}`).join(', ')})`;

export function RenameField({ value, onChange, onCommit, onCancel }: {
  value: string; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void;
}) {
  return (
    <Field
      autoFocus
      value={value}
      height={30}
      onChange={e => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={e => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel(); e.stopPropagation(); }}
    />
  );
}

// ── EmptyHint ─────────────────────────────────────────────────────────────────
export function EmptyHint({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <div style={{ fontSize: 12, color: tk.text.faint, padding: '2px 4px', lineHeight: 1.5 }}>{children}</div>;
}

// ── TabSectionHeader ──────────────────────────────────────────────────────────
export function TabSectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: tk.border.subtle }} />
      {action}
    </div>
  );
}


