import type { ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { Icon } from '../../ui/Icon';
import { Toggle } from '../../ui/Choice';
import { Tooltip } from '../../ui/Tooltip';
import { usePlayUi } from '../playUi';

/**
 * A foldable group of settings in a layer editor: click the heading to fold
 * it (remembered for every layer of that kind). With `on`, the heading
 * carries a switch, and the settings only show while it is on (Flocking,
 * Sequence…).
 */
export function Section({ kind, title, hint, on, onToggle, children }: {
  /** The layer kind, so folding "Look" folds it on every particles layer. */
  kind: string;
  title: string;
  hint?: string;
  on?: boolean;
  onToggle?: (on: boolean) => void;
  children?: ReactNode;
}) {
  const tk = useTokens();
  const key = `${kind}:${title}`;
  const folded = usePlayUi(s => !!s.folded[key]);
  const toggleFold = usePlayUi(s => s.toggleFold);
  const switched = onToggle !== undefined;
  const showBody = !folded && (!switched || on);
  const heading = <span style={{ color: tk.text.secondary, font: `650 11px ${fontFamily.ui}` }}>{title}</span>;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 2px', minHeight: 22 }}>
        <button
          type="button"
          aria-expanded={!folded}
          aria-label={`${folded ? 'Show' : 'Fold'} ${title}`}
          onClick={() => toggleFold(key)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, border: 0, background: 'none', padding: 0, cursor: 'pointer', flex: 1, minWidth: 0 }}
        >
          <Icon name={folded ? 'chevR' : 'chevD'} size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
          {hint ? <Tooltip label={title} description={hint} placement="top">{heading}</Tooltip> : heading}
          <span style={{ flex: 1, height: 1, marginLeft: 4, background: tk.border.default }} />
        </button>
        {switched && <Toggle checked={!!on} onChange={v => onToggle(v)} />}
      </div>
      {showBody && children}
    </div>
  );
}
