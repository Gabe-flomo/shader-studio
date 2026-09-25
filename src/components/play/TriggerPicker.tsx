/**
 * TriggerPicker — what fires a trigger: a key, a click, a beat, an audio hit,
 * a MIDI note, an OSC message or a shape (clicked, entered, filled). Used by
 * trigger mappings and by actions. Keys, notes, OSC addresses and clicks are
 * usually set with Learn; the fields here fine-tune them.
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import type { LiveAudioBand, TriggerSpec } from '../../types/play';
import { CHANNELS, LIVE_BAND_OPTIONS, TRIGGER_KINDS, keyName, triggerFromKind, triggerLabel } from '../../play/playSources';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { NumberInput } from '../NodeGraph/NumberInput';
import { LiveAudioChip, OscStatusChip } from './chips';

export function TriggerPicker({ trigger: t, shapes, numStyle, onChange }: {
  trigger: TriggerSpec;
  /** Shape layers a shape trigger can use. */
  shapes: ReadonlyArray<{ id: string; label: string }>;
  numStyle: React.CSSProperties;
  onChange: (t: TriggerSpec) => void;
}) {
  const tk = useTokens();
  const hint = (text: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{text}</span>;
  return (
    <>
      <Select ariaLabel="Trigger" value={t.on} options={TRIGGER_KINDS} onChange={v => onChange(triggerFromKind(v as TriggerSpec['on'], t, shapes[0]?.id ?? ''))} height={26} />
      {t.on === 'key' && <span style={{ height: 26, padding: '0 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', background: tk.bg.field, font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{keyName(t.code)}</span>}
      {t.on === 'note' && <>
        <NumberInput value={t.note} min={-1} max={127} step={1} title="Note number, -1 for any note" onCommit={n => onChange({ ...t, note: Math.max(-1, Math.min(127, Math.round(n))) })} style={{ ...numStyle, width: 44 }} />
        <Select ariaLabel="Trigger channel" value={`${t.channel}`} options={CHANNELS} onChange={v => onChange({ ...t, channel: parseInt(v, 10) || 0 })} height={26} />
      </>}
      {t.on === 'osc' && <>
        <Field value={t.address} onChange={e => onChange({ ...t, address: e.target.value.startsWith('/') ? e.target.value : `/${e.target.value}` })} height={26} mono style={{ flex: 1, minWidth: 110 }} placeholder="/1/push1" />
        <OscStatusChip />
      </>}
      {t.on === 'audio' && <>
        <Select ariaLabel="Hit band" value={t.band} options={LIVE_BAND_OPTIONS} onChange={v => onChange({ ...t, band: v as LiveAudioBand })} height={26} />
        <NumberInput value={t.threshold} min={0.01} max={0.99} step={0.05} title="Fires when the band goes above this (0–1)" onCommit={n => onChange({ ...t, threshold: Math.max(0.01, Math.min(0.99, n)) })} style={{ ...numStyle, width: 44 }} />
        {hint('threshold')}
        <LiveAudioChip />
      </>}
      {t.on === 'beat' && <>
        <NumberInput value={t.bpm} min={1} max={999} step={1} title="Beats per minute" onCommit={n => onChange({ ...t, bpm: Math.max(1, n) })} style={{ ...numStyle, width: 48 }} />
        {hint('bpm, every')}
        <NumberInput value={t.beats} min={0.0625} max={64} step={1} title="Fire every this many beats" onCommit={n => onChange({ ...t, beats: Math.max(0.0625, n) })} style={{ ...numStyle, width: 40 }} />
        {hint('beats')}
      </>}
      {t.on === 'zone' && (shapes.length === 0 ? hint('Add a Shape layer first') : <>
        <Select ariaLabel="Shape" value={t.layerId} options={shapes.map(s => ({ value: s.id, label: s.label }))} onChange={v => onChange({ ...t, layerId: v })} height={26} />
        <Segmented size="sm" ariaLabel="Shape event" value={t.event} options={[
          { value: 'click', label: 'Click', title: 'A press on the shape (on a website too)' },
          { value: 'enter', label: 'Enter', title: 'The pointer moving onto the shape' },
          { value: 'fill', label: 'Fill', title: 'Particles filling the shape past the level' },
        ]} onChange={v => onChange({ ...t, event: v })} />
        {t.event === 'fill' && <>
          <NumberInput value={t.threshold} min={0.01} max={0.99} step={0.05} title="Fires when the shape's fill goes above this (0.5 = as dense as average)" onCommit={n => onChange({ ...t, threshold: Math.max(0.01, Math.min(0.99, n)) })} style={{ ...numStyle, width: 44 }} />
          {hint('level')}
        </>}
      </>)}
      {(t.on === 'key' || t.on === 'note' || t.on === 'osc' || t.on === 'mouse') && hint(`${triggerLabel(t)} · Learn to change`)}
    </>
  );
}
