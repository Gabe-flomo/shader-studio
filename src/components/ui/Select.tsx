import type { CSSProperties } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from './Icon';
import { clampLines } from './textFit';

/** `group`: options in a row with the same group sit under one heading (an <optgroup>). */
export interface SelectOption { value: string; label: string; group?: string; disabled?: boolean; /** The option's tooltip (a formula, say). */ hint?: string }

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
  // A long choice wraps to a second line (the box grows from `height`) rather than being cut short; the full text is the title.
  return (
    <span
      data-select-face
      title={current}
      style={{
        position: 'relative', minHeight: height, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 6px 2px 10px', minWidth: 0, boxSizing: 'border-box',
        borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary,
        font: `500 12.5px/1.2 ${mono ? fontFamily.mono : fontFamily.ui}`, ...style,
      }}
    >
      <span data-select-label style={{ flex: 1, ...clampLines(2) }}>{current}</span>
      <Icon name="chevD" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
      <select
        title={current}
        aria-label={ariaLabel}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', font: 'inherit' }}
      >
        {groupOptions(options).map((g, i) => g.group
          ? <optgroup key={`g${i}`} label={g.group}>{g.options.map(o => <option key={o.value} value={o.value} disabled={o.disabled} title={o.hint}>{o.label}</option>)}</optgroup>
          : g.options.map(o => <option key={o.value} value={o.value} disabled={o.disabled} title={o.hint}>{o.label}</option>))}
      </select>
    </span>
  );
}

/** Runs of options that share a group (ungrouped options make runs of their own). */
function groupOptions(options: readonly SelectOption[]): { group?: string; options: SelectOption[] }[] {
  const out: { group?: string; options: SelectOption[] }[] = [];
  for (const o of options) {
    const last = out[out.length - 1];
    if (last && last.group === o.group) last.options.push(o);
    else out.push({ group: o.group, options: [o] });
  }
  return out;
}
