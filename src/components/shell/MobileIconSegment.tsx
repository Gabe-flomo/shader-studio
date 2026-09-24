import { useTokens } from '../../theme/themeStore';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';

/** Icon-only segmented control for the phone bottom bar (layout, keyframe tools). */
export function MobileIconSegment<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: readonly { value: T; icon: IconName; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const tk = useTokens();
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, background: tk.bg.hover, flexShrink: 0 }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            style={{
              width: 36, height: 32, padding: 0, border: 0, borderRadius: 8, cursor: 'pointer', touchAction: 'manipulation',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: on ? tk.bg.panel : 'transparent', boxShadow: on ? '0 1px 2px rgba(20,20,30,0.1)' : 'none',
              color: on ? tk.text.primary : tk.text.faint,
            }}
          >
            <Icon name={o.icon} size={16} />
          </button>
        );
      })}
    </div>
  );
}
