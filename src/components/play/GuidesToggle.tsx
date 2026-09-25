/**
 * GuidesToggle — show or hide what the picture draws for editing (null
 * markers, handles, zone outlines, particle fields), to see it as it
 * performs. H does the same on the Play page.
 */
import { useTokens } from '../../theme/themeStore';
import { alpha, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { usePlayUi } from './playUi';

export function GuidesToggle({ onPanel = false }: { onPanel?: boolean }) {
  const tk = useTokens();
  const on = usePlayUi(s => s.guides);
  const toggle = usePlayUi(s => s.toggleGuides);
  const colour = on ? (onPanel ? tk.text.muted : alpha('#ffffff', 0.7)) : tk.accent.base;
  return (
    <Tooltip label={on ? 'Hide guides' : 'Show guides'} description="Null markers, handles, zone outlines and particle fields on the picture." shortcut="H">
      <button
        type="button"
        aria-pressed={!on}
        aria-label={on ? 'Hide guides' : 'Show guides'}
        onClick={toggle}
        style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: radius.md, cursor: 'pointer', color: colour, background: on ? 'transparent' : onPanel ? tk.bg.field : alpha('#ffffff', 0.12) }}
      >
        <Icon name={on ? 'target' : 'eye'} size={15} />
      </button>
    </Tooltip>
  );
}
