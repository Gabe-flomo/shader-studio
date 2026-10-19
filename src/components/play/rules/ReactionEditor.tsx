/**
 * ReactionEditor — one thing a rule does: what (a layer's action, or send a
 * signal), how much, and, folded under More, how it fires (once as the rule
 * starts, continuously, when it stops, every Nth time…). Reuses the action
 * pieces of the old Actions editor.
 */
import { useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { CONTROL_NUDGE_ACTION, LIVE_ACTION, NOTES_ACTION, SIGNAL_ACTION, defaultNotes, isControlAction, isLookAction, type PlayReaction, type PlayRecord, type TriggerSpec } from '../../../types/play';
import { settableControls } from '../../../play/controlActions';
import { NotesEditor } from './NotesEditor';
import { padHasSound, padName } from '../../../types/playLayers';
import { smNoteName, smNoteOfPad } from '../../../play/kit/sampler.js';
import { IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { SignalPicker } from '../ConditionFields';
import { FirePicker } from '../TriggerPicker';
import { fireOf } from '../../../play/playSources';
import { controlDefaults, defaultAmount, doChoices, doValue, lookDefaults, lookEffectOf } from './reactionChoices';
import { finishParamOf, finishParamsOf } from '../../../types/playFinish';
import { LiveDoFields, useLive } from '../live/LiveFields';
import { liveClient } from '../../../lib/liveClient';

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
  useLive();
  // Ableton Live's commands while it's connected (or this reaction already is one).
  const choices = doChoices(play, r.layerId, liveClient.isConnected() || r.do === LIVE_ACTION);
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
          // A Look action on another effect (or a new kind) starts from its defaults; the same one keeps its setting.
          const look = isLookAction(c.do) ? (c.do === r.do && c.layerId === r.layerId ? {} : { key: undefined, value: undefined, seconds: undefined, x: undefined, y: undefined, ...lookDefaults(c.do, c.layerId, play) }) : {};
          // Set or Nudge a control keeps its control when switching between them; anything else lets go of it.
          const ctl = isControlAction(c.do) ? (c.do === r.do ? {} : controlDefaults(c.do, play, r.control)) : r.control !== undefined ? { control: undefined } : {};
          onPatch({ do: c.do, layerId: c.layerId, amount: c.do === r.do ? r.amount : defaultAmount(c.do, l), ...look, ...ctl, ...(c.do === SIGNAL_ACTION ? { signal: r.signal ?? play.signals?.find(s => s.id !== ruleId)?.id ?? '' } : {}),
            ...(c.do === NOTES_ACTION && c.rackId ? { notes: r.notes ? { ...r.notes, rackId: c.rackId } : defaultNotes(c.rackId) } : {}),
            ...(c.do === LIVE_ACTION && c.liveCmd ? { live: { ...(r.live ?? {}), cmd: c.liveCmd } } : {}) });
        }} />
        {r.do === LIVE_ACTION && r.live && <LiveDoFields live={r.live} onChange={live => onPatch({ live })} />}
        {r.do === SIGNAL_ACTION && <SignalPicker value={r.signal ?? ''} exclude={ruleId} onChange={signal => onPatch({ signal })} />}
        {isControlAction(r.do) && <ControlFields r={r} play={play} numStyle={numStyle} onPatch={onPatch} />}
        {isLookAction(r.do) && <LookFields r={r} play={play} numStyle={numStyle} onPatch={onPatch} />}
        {(r.do === 'burst' || r.do === 'scatter' || r.do === 'multiply' || r.do === 'cull') && (
          <NumberInput value={r.amount} min={0} max={r.do === 'scatter' ? 10 : 5000} step={r.do === 'scatter' ? 0.5 : 10}
            title={r.do === 'burst' ? 'How many particles' : r.do === 'scatter' ? 'How hard' : r.do === 'multiply' ? 'How many to bud' : 'How many to remove, youngest first'}
            onCommit={n => onPatch({ amount: Math.max(0, n) })} style={numStyle} />
        )}
        {r.do === 'pad' && layer?.kind === 'sampler' && (
          <Select ariaLabel="Which pad" value={String(Math.max(1, Math.min(128, Math.round(r.amount))))} height={26}
            options={Array.from({ length: 128 }, (_, i) => {
              // Pad N is note (base + N − 1) mod 128: its note name, and its sound in the Drum view.
              const n = smNoteOfPad(i, layer.baseNote), p = layer.pads[i];
              return { value: String(i + 1), label: `${i + 1} · ${smNoteName(n)}${layer.view === 'drum' && padHasSound(p) ? ` · ${padName(p, i)}` : ''}` };
            })}
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
      {r.do === NOTES_ACTION && r.notes && <NotesEditor spec={r.notes} onChange={notes => onPatch({ notes })} />}
      {more && (
        <div style={{ marginTop: 6 }}>
          <FirePicker trigger={asTrigger} what={r.do} numStyle={numStyle} onChange={t => onPatch({ fire: t.fire })} />
        </div>
      )}
    </div>
  );
}

/**
 * Set or Nudge a control's own fields: which control, then "to" a value or "by" a step (negative
 * takes away) and whether a nudge stops at the ends of its range or goes round. A switch has on/off.
 */
function ControlFields({ r, play, numStyle, onPatch }: { r: PlayReaction; play: PlayRecord; numStyle: React.CSSProperties; onPatch: (patch: Partial<PlayReaction>) => void }) {
  const tk = useTokens();
  const w = (t: string) => <span style={{ color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>{t}</span>;
  const list = settableControls(play);
  const c = list.find(x => x.id === r.control);
  const nudge = r.do === CONTROL_NUDGE_ACTION;
  const v = typeof r.value === 'number' ? r.value : 0;
  const span = c ? Math.abs(c.max - c.min) || 1 : 1;
  return (
    <>
      <Select ariaLabel="Which control" value={c ? c.id : r.control ?? ''} height={26} style={{ maxWidth: 170 }}
        options={[...(c ? [] : [{ value: r.control ?? '', label: 'A removed control' }]), ...list.map(x => ({ value: x.id, label: x.label }))]}
        onChange={id => onPatch(controlDefaults(r.do, play, id))} />
      {c?.toggle
        ? (nudge ? w('on ↔ off') : <Select ariaLabel="On or off" value={v >= (c.min + c.max) / 2 ? 'on' : 'off'} height={26} options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]} onChange={o => onPatch({ value: o === 'on' ? c.max : c.min })} />)
        : <>
            {w(nudge ? 'by' : 'to')}
            {/* A set may go past the slider's range, as typing on the slider does; a nudge is a step, any size. */}
            <NumberInput value={v} min={nudge ? -span * 100 : -1e9} max={nudge ? span * 100 : 1e9} step={c?.step ?? (span / 100)}
              title={nudge ? 'How much each time: negative takes away' : c ? `The value it goes to (its slider runs ${c.min} to ${c.max})` : 'The value it goes to'}
              onCommit={n => onPatch({ value: n })} style={numStyle} />
            {nudge && <Select ariaLabel="At the ends" value={r.key === 'wrap' ? 'wrap' : 'stop'} height={26} style={{ maxWidth: 150 }}
              options={[{ value: 'stop', label: 'stops at the ends' }, { value: 'wrap', label: 'wraps round' }]}
              onChange={k => onPatch({ key: k === 'wrap' ? 'wrap' : undefined })} />}
          </>}
    </>
  );
}

/** Where a Splash lands. */
const SPLASH_AT = [
  { value: 'source', label: 'at the source', title: 'Where the water’s source is now (the pointer, its layer, or Source X/Y)' },
  { value: 'pointer', label: 'under the pointer', title: 'Where the pointer is over the picture (a click, say); at the source when it isn’t over it' },
  { value: 'random', label: 'somewhere random', title: 'A different place each time (the same places in a render)' },
  { value: 'point', label: 'at a point', title: 'Always at the same place: x across, y up, 0 to 1' },
];

/**
 * A Look action's own fields: Mosh's seconds; a pulse's or a set's setting (any of the effect's
 * numbers), the value it goes to (in the setting's range) and, for a pulse, for how long; a
 * Splash's place and size.
 */
function LookFields({ r, play, numStyle, onPatch }: { r: PlayReaction; play: PlayRecord; numStyle: React.CSSProperties; onPatch: (patch: Partial<PlayReaction>) => void }) {
  const tk = useTokens();
  const w = (t: string) => <span style={{ color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>{t}</span>;
  const e = lookEffectOf(play, r.layerId);
  const secs = (
    <NumberInput value={typeof r.seconds === 'number' ? r.seconds : 1} min={0} max={600} step={0.1} title="For how many seconds" onCommit={n => onPatch({ seconds: Math.max(0, Math.min(600, n)) })} style={numStyle} />
  );
  if (r.do === 'mosh') return <>{w('for')}{secs}{w('s')}</>;
  if (r.do === 'splash') {
    const at = r.key === 'random' || r.key === 'point' || r.key === 'pointer' ? r.key : 'source';
    const coord = (k: 'x' | 'y') => <NumberInput value={typeof r[k] === 'number' ? r[k]! : 0.5} min={0} max={1} step={0.01} title={k === 'x' ? 'Across: 0 is the left edge, 1 the right' : 'Up: 0 is the bottom, 1 the top'} onCommit={n => onPatch({ [k]: Math.max(0, Math.min(1, n)) })} style={numStyle} />;
    return (
      <>
        <Select ariaLabel="Where the splash lands" value={at} height={26} style={{ maxWidth: 150 }} options={SPLASH_AT} onChange={key => onPatch(key === 'point' ? { key, x: r.x ?? 0.5, y: r.y ?? 0.5 } : { key, x: undefined, y: undefined })} />
        {at === 'point' && <>{w('x')}{coord('x')}{w('y')}{coord('y')}</>}
        {w('size')}
        <NumberInput value={typeof r.value === 'number' ? r.value : 0.06} min={0.005} max={0.3} step={0.005} title="How big the splash is, in picture heights" onCommit={n => onPatch({ value: Math.max(0.005, Math.min(0.3, n)) })} style={numStyle} />
      </>
    );
  }
  if (r.do === 'moshreset' || !e) return null;
  const params = finishParamsOf(e);
  const p = (r.key ? finishParamOf(e, r.key) : undefined) ?? params[0];
  if (!p) return null;
  const clampTo = (v: number) => Math.max(p.min, Math.min(p.max, v));
  return (
    <>
      <Select ariaLabel="Setting" value={p.key} height={26} style={{ maxWidth: 160 }} options={params.map(x => ({ value: x.key, label: x.label }))}
        onChange={key => { const q = finishParamOf(e, key); if (q) onPatch({ key, value: q.max }); }} />
      {w('to')}
      <NumberInput value={typeof r.value === 'number' ? r.value : p.max} min={p.min} max={p.max} step={p.step} title={`${p.label}: ${p.min} to ${p.max}`} onCommit={n => onPatch({ value: clampTo(n) })} style={numStyle} />
      {r.do === 'fxpulse' && <>{w('for')}{secs}{w('s')}</>}
    </>
  );
}
