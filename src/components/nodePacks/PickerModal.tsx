/**
 * PickerModal — choose one saved thing (a graph, a group, a function, a
 * presentation…) from a searchable list. Used by the pack workspace for
 * "add a node from…" and "add an extra".
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';

export interface PickItem {
  id: string;
  label: string;
  detail?: string;
  icon?: IconName;
  /** Already in the pack: shown, not pickable. */
  disabled?: boolean;
  tag?: string;
}

export function PickerModal({ title, subtitle, icon = 'search', items, onPick, onClose, empty, footer }: {
  title: string;
  subtitle?: ReactNode;
  icon?: IconName;
  items: PickItem[];
  onPick: (item: PickItem) => void;
  onClose: () => void;
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  const tk = useTokens();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter(i => i.label.toLowerCase().includes(t) || i.detail?.toLowerCase().includes(t)) : items;
  }, [items, q]);
  return (
    <Modal title={title} subtitle={subtitle} icon={icon} onClose={onClose} width={460} height={Math.min(560, typeof window !== 'undefined' ? window.innerHeight - 32 : 560)} footer={footer}>
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        {items.length > 6 && <Field autoFocus aria-label="Search" placeholder="Search" height={32} value={q} onChange={e => setQ(e.target.value)} leading={<Icon name="search" size={14} />} />}
        <div role="listbox" aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {shown.map(it => (
            <button key={it.id} type="button" role="option" aria-selected={false} disabled={it.disabled} onClick={() => onPick(it)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, padding: '6px 10px', border: 0, borderRadius: radius.md, textAlign: 'left',
                background: 'transparent', cursor: it.disabled ? 'default' : 'pointer', opacity: it.disabled ? 0.5 : 1, color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}`,
              }}
              onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = tk.bg.hover; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              {it.icon && <Icon name={it.icon} size={15} style={{ color: tk.text.muted, flexShrink: 0 }} />}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                {it.detail && <span style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.detail}</span>}
              </span>
              {it.tag && <span style={{ font: `600 10.5px ${fontFamily.ui}`, color: tk.text.faint, background: tk.bg.field, padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>{it.tag}</span>}
            </button>
          ))}
          {!shown.length && <div style={{ padding: '14px 10px', fontSize: 12.5, color: tk.text.faint, lineHeight: 1.5 }}>{items.length ? `Nothing matches “${q}”.` : empty ?? 'Nothing saved yet.'}</div>}
        </div>
      </div>
    </Modal>
  );
}
