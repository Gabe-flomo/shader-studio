import { displayCombo } from '../../hooks/useShortcuts';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';

/** A key combo as a keycap. `combo` uses the shortcut format ("cmd+g", "shift+f"). `onDark` is for tooltips. */
export function Kbd({ combo, onDark = false }: { combo: string; onDark?: boolean }) {
  const tk = useTokens();
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 6px', borderRadius: radius.xs + 1,
        font: `600 10.5px ${fontFamily.mono}`, whiteSpace: 'nowrap',
        color: onDark ? tk.tooltip.text : tk.text.muted,
        background: onDark ? alpha('#ffffff', 0.12) : tk.bg.hover,
        boxShadow: onDark ? 'none' : `inset 0 -1px 0 ${tk.border.strong}`,
      }}
    >
      {displayCombo(combo)}
    </span>
  );
}
