import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily } from '../../../theme/tokens';
import { SIGNAL_SHAPE_LABELS, type SignalShape } from '../signalFlow';
import { Icon } from '../../ui/Icon';

/** Where a rule sits among the others: starts a chain, in a chain, ends one, branches, merges, in a loop. */
export function ShapeBadge({ shape }: { shape: SignalShape }) {
  const tk = useTokens();
  const loop = shape === 'loop';
  return (
    <span data-shape={shape} title="Where it sits among the rules that feed one another" style={{ flexShrink: 0, height: 17, padding: '0 6px', borderRadius: 5, display: 'inline-flex', alignItems: 'center', gap: 3, background: loop ? alpha(tk.accent.base, 0.14) : tk.bg.field, color: loop ? tk.accent.text : tk.text.muted, font: `600 10px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
      {loop && <Icon name="loop" size={10} />}{SIGNAL_SHAPE_LABELS[shape]}
    </span>
  );
}
