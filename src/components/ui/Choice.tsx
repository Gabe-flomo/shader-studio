import type { ReactNode } from 'react';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { displayCombo } from '../../hooks/useShortcuts';

/** On/off switch. Replaces checkboxes everywhere. */
export function Toggle({
  checked, onChange, label, disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  // Light: white knob either way. Dark: light knob when off, dark knob on the blue track when on.
  const knob = dark ? (checked ? tk.bg.app : tk.text.primary) : tk.bg.panel;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, background: 'none', padding: 0,
        font: `12px ${fontFamily.ui}`, color: tk.text.secondary, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          position: 'relative', width: 30, height: 18, borderRadius: 9, flexShrink: 0, transition: 'background 0.15s',
          background: checked ? tk.accent.base : tk.border.strong,
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2, left: checked ? 14 : 2, width: 14, height: 14, borderRadius: '50%',
            background: knob,
            boxShadow: '0 1px 2px rgba(20,20,30,0.2)', transition: 'left 0.15s',
          }}
        />
      </span>
      {label}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Keyboard shortcut shown inside the segment ("v", "shift+c"). */
  shortcut?: string;
  /** Small second line, e.g. "native" under "1×". */
  sub?: ReactNode;
  /** Can't be chosen right now; `title` says why. */
  disabled?: boolean;
  title?: string;
}

/**
 * 2–5 mutually exclusive options. `fill` stretches the segments across the container; `sm` is
 * the compact form for card headers.
 */
export function Segmented<T extends string>({
  options, value, onChange, fill = false, size = 'md', ariaLabel,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  fill?: boolean;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  const sm = size === 'sm';
  const tk = useTokens();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ display: fill ? 'flex' : 'inline-flex', flexShrink: sm ? 0 : undefined, gap: 2, padding: sm ? 2 : 3, borderRadius: sm ? radius.md : radius.control, background: tk.bg.field }}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={o.disabled || undefined}
            title={o.title}
            onClick={() => { if (!o.disabled) onChange(o.value); }}
            style={{
              flex: fill ? 1 : undefined, border: 0, borderRadius: sm ? 6 : 7, padding: o.sub ? '5px 8px' : sm ? '3px 7px' : '4px 10px',
              cursor: o.disabled ? 'not-allowed' : 'pointer', opacity: o.disabled ? 0.4 : 1,
              background: on ? tk.bg.panel : 'transparent', boxShadow: on ? '0 1px 2px rgba(20,20,30,0.1)' : 'none',
              color: on ? tk.text.primary : tk.text.muted, font: `${on ? 600 : 500} ${sm ? 11.5 : 12}px ${fontFamily.ui}`,
              display: 'inline-flex', flexDirection: o.sub ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: o.sub ? 1 : 4,
              whiteSpace: 'nowrap',
            }}
          >
            <span>{o.label}</span>
            {o.shortcut && (
              <span style={{
                font: `600 10px ${fontFamily.mono}`, borderRadius: 4, padding: '1px 4px',
                color: on ? tk.accent.base : tk.text.faint, background: on ? tk.bg.selected : tk.border.subtle,
              }}>{displayCombo(o.shortcut)}</span>
            )}
            {o.sub && <span style={{ fontSize: 10.5, fontWeight: 500, color: tk.text.faint }}>{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}
