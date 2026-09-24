import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from './Icon';

/** Text field: bg.field at rest, white with a focus ring when focused. No borders. */
export function Field({
  suffix, prefix, mono = false, invalid = false, height = 34, style, onFocus, onBlur, ...rest
}: {
  suffix?: ReactNode;
  prefix?: ReactNode;
  mono?: boolean;
  invalid?: boolean;
  height?: number;
} & InputHTMLAttributes<HTMLInputElement>) {
  const tk = useTokens();
  const [focused, setFocused] = useState(false);
  const ring = invalid ? tk.status.danger : focused ? tk.accent.base : null;
  return (
    <label
      style={{
        height, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderRadius: radius.control, minWidth: 0,
        background: focused ? tk.bg.panel : tk.bg.field, boxShadow: ring ? `inset 0 0 0 1.5px ${ring}` : 'none',
        cursor: 'text', ...style,
      }}
    >
      {prefix}
      <input
        onFocus={e => { setFocused(true); onFocus?.(e); }}
        onBlur={e => { setFocused(false); onBlur?.(e); }}
        style={{
          flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', padding: 0, color: tk.text.primary,
          font: `500 12.5px ${mono ? fontFamily.mono : fontFamily.ui}`,
        }}
        {...rest}
      />
      {suffix && <span style={{ color: tk.text.faint, font: `500 12.5px ${fontFamily.mono}` }}>{suffix}</span>}
    </label>
  );
}

/**
 * Data-type picker. A native <select> sits transparently over the styled face, so keyboard and
 * screen-reader behaviour is the platform's. Always shows the type's colour dot.
 */
export function TypeSelect({
  value, options, onChange, ariaLabel = 'Type', height = 34,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  height?: number;
}) {
  const tk = useTokens();
  return (
    <span
      style={{
        position: 'relative', height, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 8px 0 10px',
        borderRadius: radius.control, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, flexShrink: 0,
        font: `500 12.5px ${fontFamily.mono}`, color: tk.text.primary,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: TYPE_COLORS[value] ?? tk.text.faint }} />
      {value}
      <Icon name="chevD" size={14} style={{ color: tk.text.faint }} />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', font: 'inherit' }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </span>
  );
}
