/**
 * RulesSummary — the setup's rules under the layer list, as sentences with
 * lamps; one opens the Rules page on it, + Rule starts Quick rule with the
 * selected layer's actions first.
 */
import { useMemo } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord } from '../../../types/play';
import { asRules } from '../../../play/rules';
import { Button } from '../../ui/Button';
import { goToSignal, startRule } from '../playSplit';
import { usePlayUi } from '../playUi';
import { reactionText } from './reactionChoices';
import { useLamps } from './useLamps';
import { Lamp } from './Lamp';

export function RulesSummary({ play: raw }: { play: PlayRecord }) {
  const tk = useTokens();
  const play = useMemo(() => asRules(raw), [raw]);
  const rules = play.signals ?? [];
  const selected = usePlayUi(s => s.selected);
  const { on, flash } = useLamps(rules.map(r => r.id));
  return (
    <div data-rules-summary="" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px' }}>
        <span style={{ font: `650 12.5px ${fontFamily.ui}` }}>Rules</span>
        {rules.length > 0 && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{rules.length}</span>}
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="plus" onClick={() => startRule({ layerId: selected || undefined })}>Rule</Button>
      </div>
      {!rules.length && <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, padding: '2px 2px 6px' }}>When something happens, do something: a pinch bursts the sparks, the kick steps the text. + Rule, do the thing, pick what happens.</div>}
      {rules.map(r => (
        <button key={r.id} type="button" onClick={() => goToSignal(r.id)} data-rule-summary={r.id}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 32, marginTop: 2, padding: '4px 8px', border: 0, borderRadius: radius.md, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
          <Lamp on={!!on[r.id]} flash={flash[r.id] ?? 0} size={8} />
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', font: `12px ${fontFamily.ui}`, color: tk.text.primary }}>
            {r.name}
            <span style={{ color: tk.text.muted }}>{(r.do ?? []).length ? ` → ${(r.do ?? []).map(x => reactionText(x, play)).join(', ')}` : ''}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
