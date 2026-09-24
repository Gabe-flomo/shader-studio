import type { CSSProperties } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from './Icon';

export interface SelectOption { value: string; label: string }

/**
 * Dropdown: a native <select> sits transparently over the styled face (as in TypeSelect), so
 * keyboard and screen-reader behaviour is the platform's.
 */
export function Select({
  value, options, onChange, ariaLabel, height = 30, mono = false, style,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  height?: number;
  mono?: boolean;
  style?: CSSProperties;
}) {
  const tk = useTokens();
  const current = options.find(o => o.value === value)?.label ?? value;
  return (
    <span
      style={{
        position: 'relative', height, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px 0 10px', minWidth: 0,
        borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary,
        font: `500 12.5px ${mono ? fontFamily.mono : fontFamily.ui}`, ...style,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current}</span>
      <Icon name="chevD" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', font: 'inherit' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}
