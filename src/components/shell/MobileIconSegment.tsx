import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';

/**
 * Icon segmented control for the phone bottom bar (layout, keyframe tools). With `captions`, each
 * option's `short` word sits under its icon (Preview / Both / Graph / Code), so the way between
 * the picture and the graph reads at a glance instead of being four bare pictograms.
 */
export function MobileIconSegment<T extends string>({ value, options, onChange, ariaLabel, captions = false, dense = false }: {
  value: T;
  options: readonly { value: T; icon: IconName; label: string; short?: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  captions?: boolean;
  /** Narrower buttons, when two segments share the bar (the keyframe tools beside the layout). */
  dense?: boolean;
}) {
  const tk = useTokens();
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, background: tk.bg.hover, flexShrink: 0 }}>
      {options.map(o => {
        const on = o.value === value;
        const caption = captions && o.short;
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
              width: caption ? 46 : dense ? 32 : 36, height: caption ? 40 : 32, padding: 0, border: 0, borderRadius: 8, cursor: 'pointer', touchAction: 'manipulation',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
              background: on ? tk.bg.panel : 'transparent', boxShadow: on ? '0 1px 2px rgba(20,20,30,0.1)' : 'none',
              color: on ? tk.text.primary : tk.text.faint,
            }}
          >
            <Icon name={o.icon} size={caption ? 15 : 16} />
            {caption && <span aria-hidden style={{ font: `${on ? 600 : 500} 10.5px/1.1 ${fontFamily.ui}`, color: on ? tk.text.primary : tk.text.muted }}>{o.short}</span>}
          </button>
        );
      })}
    </div>
  );
}
