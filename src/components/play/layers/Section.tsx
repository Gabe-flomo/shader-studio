import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';

/** A small heading with a rule, between groups of settings in a layer editor. */
export function Section({ title }: { title: string }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 2px' }}>
      <span style={{ color: tk.text.secondary, font: `650 11px ${fontFamily.ui}` }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: tk.border.default }} />
    </div>
  );
}
