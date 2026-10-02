/**
 * ReactionEditor — one thing a rule does: what (a layer's action, or send a
 * signal), how much, and, folded under More, how it fires (once as the rule
 * starts, continuously, when it stops, every Nth time…). Reuses the action
 * pieces of the old Actions editor.
 */
import { useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { SIGNAL_ACTION, type PlayReaction, type PlayRecord, type TriggerSpec } from '../../../types/play';
import { padName } from '../../../types/playLayers';
import { IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { SignalPicker } from '../ConditionFields';
import { FirePicker } from '../TriggerPicker';
import { fireOf } from '../../../play/playSources';
import { defaultAmount, doChoices, doValue } from './reactionChoices';

export function ReactionEditor({ ruleId, r, play, onPatch, onRemove }: {
  ruleId: string;
  r: PlayReaction;
  play: PlayRecord;
  onPatch: (patch: Partial<PlayReaction>) => void;
  onRemove: () => void;
}) {
  const tk = useTokens();
  const [more, setMore] = useState(false);
  const layer = play.layers.find(l => l.id === r.layerId);
  const choices = doChoices(play, r.layerId);
  const value = doValue(r);
  const options = choices.some(c => c.value === value) ? choices : [{ value, label: 'A missing layer’s action', layerId: '', do: r.do }, ...choices];
  const numStyle: React.CSSProperties = { width: 52, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' };
  // The firing mode is edited as a trigger on this rule's signal (FirePicker's words).
  const asTrigger: TriggerSpec = { on: 'signal', signal: ruleId, ...(r.fire ? { fire: r.fire } : {}) };
  const fireWord = { once: 'as it starts', held: 'continuously', every: 'every few', release: 'when it stops', nth: 'every Nth time', within: 'N times in a while' }[fireOf(asTrigger).mode];
  return (
    <div data-reaction={r.id} style={{ padding: '6px 0', opacity: r.enabled ? 1 : 0.55, borderTop: `1px solid ${tk.border.subtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Select ariaLabel="Do" value={value} height={26} style={{ minWidth: 150, maxWidth: 240 }} options={options.map(c => ({ value: c.value, label: c.label }))} onChange={v => {
          const c = choices.find(x => x.value === v);
          if (!c) return;
          const l = play.layers.find(x => x.id === c.layerId);
          onPatch({ do: c.do, layerId: c.layerId, amount: c.do === r.do ? r.amount : defaultAmount(c.do, l), ...(c.do === SIGNAL_ACTION ? { signal: r.signal ?? play.signals?.find(s => s.id !== ruleId)?.id ?? '' } : {}) });
        }} />
        {r.do === SIGNAL_ACTION && <SignalPicker value={r.signal ?? ''} onChange={signal => onPatch({ signal })} />}
        {(r.do === 'burst' || r.do === 'scatter' || r.do === 'multiply' || r.do === 'cull') && (
          <NumberInput value={r.amount} min={0} max={r.do === 'scatter' ? 10 : 5000} step={r.do === 'scatter' ? 0.5 : 10}
            title={r.do === 'burst' ? 'How many particles' : r.do === 'scatter' ? 'How hard' : r.do === 'multiply' ? 'How many to bud' : 'How many to remove, youngest first'}
            onCommit={n => onPatch({ amount: Math.max(0, n) })} style={numStyle} />
        )}
        {r.do === 'pad' && layer?.kind === 'drumpad' && (
          <Select ariaLabel="Which pad" value={String(Math.max(1, Math.min(16, Math.round(r.amount))))} height={26}
            options={layer.pads.map((p, i) => ({ value: String(i + 1), label: `${i + 1} · ${padName(p, i)}` }))}
            onChange={v => onPatch({ amount: Number(v) })} />
        )}
        {r.do === 'goto' && layer?.kind === 'background' && (
          <Select ariaLabel="Which source" value={String(Math.max(1, Math.round(r.amount)))} height={26}
            options={(layer.sources.length ? layer.sources : [{ id: '', name: 'the first' }]).map((s, i) => ({ value: String(i + 1), label: `${i + 1} · ${s.name}` }))}
            onChange={v => onPatch({ amount: Number(v) })} />
        )}
        {r.do === 'goto' && layer?.kind === 'data' && (
          <NumberInput value={Math.max(1, Math.round(r.amount))} min={1} max={100000} step={1} title="Which row, counting from 1" onCommit={n => onPatch({ amount: Math.max(1, Math.round(n)) })} style={numStyle} />
        )}
        <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more} title="How it fires" style={{ border: 0, background: 'none', padding: '0 2px', cursor: 'pointer', color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>
          {more ? '▾' : '▸'} {fireWord}
        </button>
        <span style={{ flex: 1 }} />
        <Toggle checked={r.enabled} onChange={enabled => onPatch({ enabled })} />
        <IconButton icon="trash" label="Remove" size="sm" tone="danger" onClick={onRemove} />
      </div>
      {more && (
        <div style={{ marginTop: 6 }}>
          <FirePicker trigger={asTrigger} what={r.do} numStyle={numStyle} onChange={t => onPatch({ fire: t.fire })} />
        </div>
      )}
    </div>
  );
}
