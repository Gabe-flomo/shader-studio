/**
 * GroupPorts.tsx — the one look for group sockets (docs/groups.md, "Group sockets").
 *
 * Every group-like node (Group, Scene Group, March Loop, GI Lit March, Agents)
 * and its inner inputs / outputs cards draw a socket's name with
 * <GroupPortName>, and offer new sockets with <AddGroupPort>:
 *
 *   - built in: a small lock before the name, in the muted text colour; it
 *     can't be renamed or removed (the node type always has it);
 *   - added:    the name in the primary text colour and its type in words;
 *     double-click the name to rename it, × removes it (× sits on the side away
 *     from the socket);
 *   - adding:   a full-width "+ Add an input" / "+ Add an output" button at the
 *     bottom of the list, opening Name + type + Cancel / Add.
 *
 * Which sockets are which comes from nodes/groupPorts.ts.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { DataType } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { PORT_TYPE_CHOICES, PORT_TYPE_WORDS, type PortOrigin } from '../../nodes/groupPorts';

export const BUILT_IN_TIP = 'Built in: this group always has it, so it can\'t be renamed or removed.';

export function GroupPortName({
  label, type, origin, socketSide, onRename, onRemove, size = 12.5, style, detail,
}: {
  label: string;
  type?: string;
  origin: PortOrigin;
  /** Which side of the row the socket dot is on: × goes on the other side. */
  socketSide: 'left' | 'right';
  onRename?: (label: string) => void;
  onRemove?: () => void;
  size?: number;
  style?: CSSProperties;
  /** Shown after the name (e.g. where a Group output is wired from), before × on a left-socket row. */
  detail?: ReactNode;
}) {
  const tk = useTokens();
  const [editing, setEditing] = useState<string | null>(null);
  const added = origin === 'added';
  const remove = added && onRemove ? (
    <IconButton icon="close" label={`Remove ${label}`} size="sm" tone="danger" tooltip={false}
      data-port-remove=""
      style={{ width: 20, height: 20, flexShrink: 0 }}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onRemove(); }} />
  ) : null;
  const commit = () => {
    if (editing !== null && editing.trim() && editing.trim() !== label) onRename?.(editing.trim());
    setEditing(null);
  };
  const name = editing !== null ? (
    <input
      autoFocus
      aria-label="Socket name"
      value={editing}
      onChange={e => setEditing(e.target.value)}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(null);
      }}
      style={{
        width: 110, height: 22, fontSize: size - 0.5, background: tk.bg.panel, border: 0, outline: 'none', borderRadius: 5,
        boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.text.primary, padding: '0 6px', fontFamily: fontFamily.ui,
      }}
    />
  ) : (
    <span
      data-port-origin={origin}
      title={added ? (onRename ? `${label}: added to this group. Double-click to rename.` : `${label}: added to this group.`) : `${label}. ${BUILT_IN_TIP}`}
      onDoubleClick={added && onRename ? e => { e.stopPropagation(); setEditing(label); } : undefined}
      // A renamable name keeps its clicks: a card whose label click disconnects the wire mustn't do it on a rename.
      onMouseUp={added && onRename ? e => e.stopPropagation() : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, whiteSpace: 'nowrap',
        fontSize: size, color: added ? tk.text.primary : tk.text.secondary, cursor: added && onRename ? 'text' : 'default',
      }}
    >
      {!added && <span aria-label="Built in" style={{ display: 'inline-flex', color: tk.text.faint, flexShrink: 0 }}><Icon name="lock" size={10} /></span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {added && type && <span style={{ fontSize: size - 1.5, color: tk.text.faint, flexShrink: 0 }}>{PORT_TYPE_WORDS[type] ?? type}</span>}
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, ...style }}>
      {socketSide === 'right' && remove}
      {name}
      {detail}
      {socketSide === 'left' && remove}
    </span>
  );
}

/** "+ Add an input" / "+ Add an output" and its form (name, type, Cancel / Add). Sits at the bottom of a port list. */
export function AddGroupPort({
  dir, types, defaultType, title, placeholder = 'Name', onAdd, bordered = true,
}: {
  dir: 'in' | 'out';
  types: readonly DataType[];
  defaultType?: DataType;
  /** What adding one does here (the button's tooltip). */
  title?: string;
  placeholder?: string;
  onAdd: (name: string, type: DataType) => void;
  /** A line above it, separating it from the sockets. */
  bordered?: boolean;
}) {
  const tk = useTokens();
  const [form, setForm] = useState<{ name: string; type: DataType } | null>(null);
  const word = dir === 'in' ? 'input' : 'output';
  const submit = () => {
    if (!form || !form.name.trim()) return;
    onAdd(form.name.trim(), form.type);
    setForm(null);
  };
  return (
    <div
      data-add-port={dir}
      style={{ borderTop: bordered ? `1px solid ${tk.border.subtle}` : undefined, padding: 8 }}
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    >
      {form ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            autoFocus
            aria-label={`New ${word} name`}
            placeholder={placeholder}
            value={form.name}
            onChange={e => setForm(f => f ? { ...f, name: e.target.value } : f)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Escape') setForm(null);
              if (e.key === 'Enter') submit();
            }}
            style={{
              width: '100%', boxSizing: 'border-box', height: 30, fontSize: 12.5, background: tk.bg.field, border: 0, borderRadius: 6,
              color: tk.text.primary, padding: '0 8px', outline: 'none', fontFamily: fontFamily.ui,
            }}
          />
          {types.length > 1 && (
            <Segmented
              fill size="sm" wrap={types.length > 5} ariaLabel={`What the ${word} carries`}
              value={form.type}
              options={types.map(t => ({ value: t, label: PORT_TYPE_CHOICES[t] ?? t }))}
              onChange={t => setForm(f => f ? { ...f, type: t } : f)}
            />
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" style={{ height: 28 }} onClick={() => setForm(null)}>Cancel</Button>
            <Button size="sm" variant="primary" style={{ height: 28 }} disabled={!form.name.trim()} onClick={submit}>Add</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" icon="plus" style={{ width: '100%', height: 28 }} title={title}
          onClick={() => setForm({ name: '', type: defaultType ?? types[0] })}>Add an {word}</Button>
      )}
    </div>
  );
}
