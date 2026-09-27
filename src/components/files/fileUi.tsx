/**
 * Small pieces the Files page shares: an icon per kind of thing, the
 * checkbox, the size readout and "when" text.
 */
import type { CSSProperties } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import type { FileNode } from '../../files/inventory';
import { formatSize } from '../../utils/library';
import { iconFor, tintFor } from './fileUiShared';

export function IconTile({ node, size = 28 }: { node: FileNode; size?: number }) {
  const tk = useTokens();
  const c = tintFor(tk, node);
  return (
    <span style={{ width: size, height: size, borderRadius: size > 32 ? 11 : 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(c, 0.12), color: c }}>
      <Icon name={iconFor(node)} size={size > 32 ? 19 : 15} />
    </span>
  );
}

/** A square checkbox (selection in lists; the app's Toggle is for settings). `mixed` = some of what's inside. */
export function Check({ checked, mixed = false, disabled = false, onChange, label }: { checked: boolean; mixed?: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  const tk = useTokens();
  const on = checked || mixed;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      style={{
        width: 22, height: 22, flexShrink: 0, padding: 0, border: 0, background: 'none', cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? tk.accent.base : tk.bg.panel, boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${tk.border.strong}`, color: tk.bg.panel,
        transition: 'background 0.1s',
      }}>
        {checked ? <Icon name="check" size={12} /> : mixed ? <span style={{ width: 8, height: 2, borderRadius: 1, background: tk.bg.panel }} /> : null}
      </span>
    </button>
  );
}

export function Size({ n, style }: { n: number; style?: CSSProperties }) {
  const tk = useTokens();
  return <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted, whiteSpace: 'nowrap', ...style }}>{n ? formatSize(n) : '—'}</span>;
}

/** A thin bar: how big this is next to the biggest beside it. */
export function SizeBar({ value, max, width = 56 }: { value: number; max: number; width?: number }) {
  const tk = useTokens();
  return (
    <span style={{ width, height: 3, borderRadius: 2, background: tk.bg.field, overflow: 'hidden', display: 'block' }}>
      <span style={{ display: 'block', height: '100%', width: `${max ? Math.max(value ? 4 : 0, (value / max) * 100) : 0}%`, background: alpha(tk.accent.base, 0.7), borderRadius: 2 }} />
    </span>
  );
}

