/**
 * ActionsSection — "When this happens, do that to a layer": a key, a beat, a
 * MIDI note, an audio hit, an OSC message or a shape (clicked, entered,
 * filled) bursts particles, steps a text to its next line, drops bodies,
 * clears the brush or shows and hides a layer. Stored in the record's
 * `actions`; the engine fires them, the layer kit carries them out.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { ACTIONS_FOR, type ActionKind, type PlayAction, type PlayLayer, type PlayRecord, type TriggerSpec } from '../../../types/play';
import { playEngine } from '../../../lib/playEngine';
import { playId } from '../../../play/playControls';
import { Button, IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { TriggerPicker } from '../TriggerPicker';
import { ACTION_LABELS } from './help';


const actionsFor = (l: PlayLayer | undefined): readonly ActionKind[] => (l ? ACTIONS_FOR[l.kind] ?? ACTIONS_FOR.other : ACTIONS_FOR.other);
const defaultAction = (l: PlayLayer): ActionKind => actionsFor(l)[0];

export function ActionsSection({ play, onChange }: { play: PlayRecord; onChange: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const tk = useTokens();
  const actions = play.actions ?? [];
  const [learning, setLearning] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const update = (id: string, patch: Partial<PlayAction>) => onChange(p => ({ ...p, actions: (p.actions ?? []).map(a => a.id === id ? { ...a, ...patch } : a) }));
  const remove = (id: string) => onChange(p => { const rest = (p.actions ?? []).filter(a => a.id !== id); const out: PlayRecord = { ...p, actions: rest }; if (!rest.length) delete out.actions; return out; });
  const add = () => {
    const l = play.layers[play.layers.length - 1];
    if (!l) return;
    const a: PlayAction = { id: playId('act'), trigger: { on: 'key', code: 'Space' }, do: defaultAction(l), layerId: l.id, amount: 60, enabled: true };
    onChange(p => ({ ...p, actions: [...(p.actions ?? []), a] }));
  };
  const learn = (id: string) => {
    cancel.current?.();
    if (learning === id) { setLearning(null); return; }
    setLearning(id);
    cancel.current = playEngine.startLearnTrigger((trigger: TriggerSpec) => { update(id, { trigger }); setLearning(null); cancel.current = null; });
  };
  const shapes = play.layers.filter(l => l.kind === 'shape').map(l => ({ id: l.id, label: l.label }));
  const numStyle: React.CSSProperties = { width: 52, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' };
  const label: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 38, flexShrink: 0 };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px' }}>
        <span style={{ font: `650 12.5px ${fontFamily.ui}` }}>Actions</span>
        {actions.length > 0 && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{actions.length}</span>}
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="plus" disabled={!play.layers.length} onClick={add}>Add action</Button>
      </div>
      {actions.length === 0 && (
        <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, padding: '2px 2px 6px' }}>
          When something happens, do something to a layer: a key bursts particles, the kick drum steps a word to the next line, a click on a shape drops the letters again.
        </div>
      )}
      {actions.map(a => {
        const layer = play.layers.find(l => l.id === a.layerId);
        const kinds = actionsFor(layer);
        return (
          <div key={a.id} style={{ marginTop: 6, padding: '8px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${learning === a.id ? tk.accent.base : tk.border.default}`, opacity: a.enabled ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={label}>When</span>
              <TriggerPicker trigger={a.trigger} shapes={shapes} numStyle={numStyle} onChange={trigger => update(a.id, { trigger })} />
              <span style={{ flex: 1 }} />
              <IconButton icon="spark" label={learning === a.id ? 'Listening… press a key, play a note, click the picture' : 'Learn: the next key, note, click or OSC message'} size="sm" active={learning === a.id} onClick={() => learn(a.id)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <span style={label}>Do</span>
              <Select ariaLabel="Action" value={kinds.includes(a.do) ? a.do : kinds[0]} options={kinds.map(k => ({ value: k, label: ACTION_LABELS[k] }))} onChange={v => update(a.id, { do: v as ActionKind })} height={26} />
              <Select ariaLabel="Layer" value={a.layerId} options={play.layers.map(l => ({ value: l.id, label: l.label }))} onChange={v => { const l = play.layers.find(x => x.id === v); update(a.id, { layerId: v, do: l && actionsFor(l).includes(a.do) ? a.do : l ? defaultAction(l) : a.do }); }} height={26} />
              {(a.do === 'burst' || a.do === 'scatter') && (
                <NumberInput value={a.amount} min={0} max={a.do === 'burst' ? 5000 : 10} step={a.do === 'burst' ? 10 : 0.5} title={a.do === 'burst' ? 'How many particles' : 'How hard'} onCommit={n => update(a.id, { amount: Math.max(0, n) })} style={numStyle} />
              )}
              <span style={{ flex: 1 }} />
              <Toggle checked={a.enabled} onChange={enabled => update(a.id, { enabled })} />
              <IconButton icon="trash" label="Remove action" size="sm" tone="danger" onClick={() => remove(a.id)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
