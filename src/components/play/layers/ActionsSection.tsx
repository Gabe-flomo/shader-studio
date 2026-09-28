/**
 * ActionsSection — "When this happens, do that to a layer": a key, a beat, a
 * MIDI note, an audio hit, an OSC message, a shape (clicked, entered,
 * filled), a hand gesture or two things coming close bursts particles, steps
 * a text to its next line, drops bodies, clears the brush or shows and hides
 * a layer, once or over and over while it lasts. Stored in the record's
 * `actions`; the engine fires them, the layer kit carries them out.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { actionsForLayer, SIGNAL_ACTION, type ActionKind, type PlayAction, type PlayLayer, type PlayRecord, type TriggerSpec } from '../../../types/play';
import { SignalPicker } from '../ConditionFields';
import { playEngine } from '../../../lib/playEngine';
import { playId } from '../../../play/playControls';
import { addSignal } from '../../../play/pairs';
import { Button, IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { FirePicker, TriggerPicker } from '../TriggerPicker';
import { withFire } from '../../../play/playSources';
import { actionLabel } from './help';
import { padName } from '../../../types/playLayers';


const actionsFor = (l: PlayLayer | undefined): readonly ActionKind[] => actionsForLayer(l);
/** The first signal, made when the setup has none (a Send a signal action always sends one). */
function withSignal(p: PlayRecord): { play: PlayRecord; signal: string } {
  const first = p.signals?.[0]?.id;
  if (first) return { play: p, signal: first };
  const r = addSignal(p);
  return { play: r.play, signal: r.id };
}
const defaultAction = (l: PlayLayer): ActionKind => actionsFor(l)[0];

/** A new action (Space bursts the last layer, or sends a signal when there are no layers), added at the end; its id. */
export function addAction(p: PlayRecord): { play: PlayRecord; id: string } {
  const l = p.layers[p.layers.length - 1];
  const id = playId('act');
  if (l) return { id, play: { ...p, actions: [...(p.actions ?? []), { id, trigger: { on: 'key', code: 'Space' }, do: defaultAction(l), layerId: l.id, amount: l.kind === 'drumpad' ? 1 : 60, enabled: true }] } };
  // With no layers yet, an action can still send a signal.
  const { play: q, signal } = withSignal(p);
  return { id, play: { ...q, actions: [...(q.actions ?? []), { id, trigger: { on: 'key', code: 'Space' }, do: SIGNAL_ACTION, layerId: '', amount: 1, enabled: true, signal }] } };
}

export function ActionsSection({ play, onChange, only, bare = false }: {
  play: PlayRecord;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** Just this action's card (the full-width Actions page edits one beside its list). */
  only?: string;
  /** No heading or explainer: the page around it has its own. */
  bare?: boolean;
}) {
  const tk = useTokens();
  const all = play.actions ?? [];
  const actions = only === undefined ? all : all.filter(a => a.id === only);
  const [learning, setLearning] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const update = (id: string, patch: Partial<PlayAction>) => onChange(p => ({ ...p, actions: (p.actions ?? []).map(a => a.id === id ? { ...a, ...patch } : a) }));
  const remove = (id: string) => onChange(p => { const rest = (p.actions ?? []).filter(a => a.id !== id); const out: PlayRecord = { ...p, actions: rest }; if (!rest.length) delete out.actions; return out; });
  const add = () => onChange(p => addAction(p).play);
  // Do: a layer's actions, then Send a signal. Picking it clears the layer; picking a layer action brings one back.
  const doOptions = (layer: PlayLayer | undefined, kinds: readonly ActionKind[]) => [...kinds.map(k => ({ value: k, label: actionLabel(k, layer) })), { value: SIGNAL_ACTION, label: 'Send a signal' }];
  const setDo = (a: PlayAction, v: string) => {
    if (v === SIGNAL_ACTION) {
      onChange(p => {
        const { play: q, signal } = withSignal(p);
        return { ...q, actions: (q.actions ?? []).map(x => (x.id === a.id ? { ...x, do: SIGNAL_ACTION, layerId: '', amount: 1, signal: x.signal || signal } : x)) };
      });
      return;
    }
    const l = play.layers.find(x => x.id === a.layerId) ?? play.layers[play.layers.length - 1];
    if (!l) return;
    update(a.id, { do: v as ActionKind, layerId: l.id, signal: undefined, ...(v === 'goto' || v === 'pad' ? { amount: 1 } : a.do === SIGNAL_ACTION ? { amount: 60 } : {}) });
  };
  const learn = (id: string) => {
    cancel.current?.();
    if (learning === id) { setLearning(null); return; }
    setLearning(id);
    // Learn picks what fires it; how it fires (once, every frame…) stays.
    const was = all.find(a => a.id === id)?.trigger.fire;
    cancel.current = playEngine.startLearnTrigger((trigger: TriggerSpec) => { update(id, { trigger: withFire(trigger, was) }); setLearning(null); cancel.current = null; });
  };
  const layerRefs = play.layers.map(l => ({ id: l.id, label: l.label, kind: l.kind }));
  const numStyle: React.CSSProperties = { width: 52, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' };
  const label: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 38, flexShrink: 0 };
  return (
    <div style={{ marginTop: bare ? 0 : 14 }}>
      {!bare && <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px' }}>
        <span style={{ font: `650 12.5px ${fontFamily.ui}` }}>Actions</span>
        {actions.length > 0 && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{actions.length}</span>}
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="plus" onClick={add}>Add action</Button>
      </div>}
      {actions.length === 0 && !bare && (
        <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, padding: '2px 2px 6px' }}>
          When something happens, do something to a layer: a key bursts particles, the kick drum steps a word to the next line, a click on a shape drops the letters again. Or send a signal that other actions and mappings listen for.
        </div>
      )}
      {actions.map(a => {
        const layer = play.layers.find(l => l.id === a.layerId);
        const kinds = actionsFor(layer);
        return (
          <div key={a.id} style={{ marginTop: 6, padding: '8px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${learning === a.id ? tk.accent.base : tk.border.default}`, opacity: a.enabled ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={label}>When</span>
              <TriggerPicker trigger={a.trigger} layers={layerRefs} numStyle={numStyle} onChange={trigger => update(a.id, { trigger })} />
              <span style={{ flex: 1 }} />
              <IconButton icon="spark" label={learning === a.id ? 'Listening… press a key, play a note, click the picture' : 'Learn: the next key, note, click or OSC message'} size="sm" active={learning === a.id} onClick={() => learn(a.id)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6 }}>
              <span style={{ ...label, lineHeight: '26px' }}>Fires</span>
              <FirePicker trigger={a.trigger} what={a.do} numStyle={numStyle} onChange={trigger => update(a.id, { trigger })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <span style={label}>Do</span>
              <Select ariaLabel="Action" value={a.do === SIGNAL_ACTION || kinds.includes(a.do) ? a.do : kinds[0]} options={layer || a.do !== SIGNAL_ACTION ? doOptions(layer, kinds) : doOptions(play.layers[play.layers.length - 1], play.layers.length ? actionsFor(play.layers[play.layers.length - 1]) : [])} onChange={v => setDo(a, v)} height={26} />
              {a.do === SIGNAL_ACTION
                ? <SignalPicker value={a.signal ?? ''} onChange={signal => update(a.id, { signal })} />
                : <Select ariaLabel="Layer" value={a.layerId} options={play.layers.map(l => ({ value: l.id, label: l.label }))} onChange={v => { const l = play.layers.find(x => x.id === v); update(a.id, { layerId: v, do: l && actionsFor(l).includes(a.do) ? a.do : l ? defaultAction(l) : a.do }); }} height={26} />}
              {(a.do === 'burst' || a.do === 'scatter') && (
                <NumberInput value={a.amount} min={0} max={a.do === 'burst' ? 5000 : 10} step={a.do === 'burst' ? 10 : 0.5} title={a.do === 'burst' ? 'How many particles' : 'How hard'} onCommit={n => update(a.id, { amount: Math.max(0, n) })} style={numStyle} />
              )}
              {a.do === 'pad' && layer?.kind === 'drumpad' && (
                // Play pad N, counting from 1.
                <Select ariaLabel="Which pad" value={String(Math.max(1, Math.min(16, Math.round(a.amount))))} height={26}
                  options={layer.pads.map((p, i) => ({ value: String(i + 1), label: `${i + 1} · ${padName(p, i)}` }))}
                  onChange={v => update(a.id, { amount: Number(v) })} />
              )}
              {a.do === 'goto' && layer?.kind === 'data' && (
                // Go to row N, counting from 1.
                <NumberInput value={Math.max(1, Math.round(a.amount))} min={1} max={100000} step={1} title="Which row, counting from 1" onCommit={n => update(a.id, { amount: Math.max(1, Math.round(n)) })} style={numStyle} />
              )}
              {a.do === 'goto' && layer?.kind === 'background' && (
                // Go to N: which source, counting from 1 (the queue's numbers).
                <Select ariaLabel="Which source" value={String(Math.max(1, Math.round(a.amount)))} height={26}
                  options={(layer.sources.length ? layer.sources : [{ id: '', name: 'the first' }]).map((s, i) => ({ value: String(i + 1), label: `${i + 1} · ${s.name}` }))}
                  onChange={v => update(a.id, { amount: Number(v) })} />
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
