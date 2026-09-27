/**
 * TriggerPicker — what fires a trigger: a key, a click, a beat, an audio hit,
 * a MIDI note, an OSC message, a shape (clicked, entered, filled), a hand
 * gesture, two things coming close (proximity), or an audio reader crossing
 * a level. Used by trigger mappings and by actions. Keys, notes, OSC
 * addresses, clicks and sounds are usually set with Learn; the fields here
 * fine-tune them.
 *
 * FirePicker is the row under it: when the trigger fires (once, every frame
 * while held, every N frames or seconds, on release), with a hint when the
 * thing it fires doesn't like being repeated.
 */
import { openProSheet, useCan } from '../../lib/plan';
import { FREE_TRIGGER_ONS } from '../../play/planGates';
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { ActionKind, FireMode, HandGesture, LiveAudioBand, TriggerMode, TriggerSpec } from '../../types/play';
import { parseHandAnchor } from '../../types/play';
import {
  CHANNELS, HAND_GESTURE_OPTIONS, HAND_POINT_OPTIONS, HAND_SIDES, LIVE_BAND_OPTIONS, TRIGGER_KINDS,
  anchorChoice, anchorOptions, anchorPick, fireModes, fireOf, keyName, repeatHint, triggerFromKind, triggerLabel, withFire,
} from '../../play/playSources';
import { playEngine } from '../../lib/playEngine';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { NumberInput } from '../NodeGraph/NumberInput';
import { LiveAudioChip, OscStatusChip } from './chips';
import { HandsChip } from './HandsChip';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { audioReaderBank } from '../../lib/audioReaderBank';
import { useReadersPanel } from './readersPanelUi';
import { Button } from '../ui/Button';
import { ReaderMeter } from './AudioReadersPanel';
import type { AudioReader } from '../../types/play';

export interface TriggerLayerRef { id: string; label: string; kind: string }

export function TriggerPicker({ trigger: t, layers, numStyle, onChange }: {
  trigger: TriggerSpec;
  /** The setup's layers: shapes for a shape trigger, anything with a centre for proximity. */
  layers: ReadonlyArray<TriggerLayerRef>;
  numStyle: React.CSSProperties;
  onChange: (t: TriggerSpec) => void;
}) {
  const tk = useTokens();
  const hint = (text: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{text}</span>;
  const shapes = layers.filter(l => l.kind === 'shape');
  const readers = useNodeGraphStore(s => s.play.audioReaders?.readers) ?? NO_READERS;
  // Free: key, click and audio triggers; the rest say Pro and open the Pro sheet (play/planGates.ts).
  const allSources = useCan('play.sources');
  const kinds = allSources ? TRIGGER_KINDS : TRIGGER_KINDS.map(k => (FREE_TRIGGER_ONS.has(k.value) ? k : { ...k, label: `${k.label} · Pro` }));
  return (
    <>
      <Select ariaLabel="Trigger" value={t.on} options={kinds} onChange={v => {
        if (!allSources && !FREE_TRIGGER_ONS.has(v as TriggerSpec['on'])) { openProSheet('play.sources'); return; }
        onChange(triggerFromKind(v as TriggerSpec['on'], t, layers, readers[0]?.id ?? ''));
      }} height={26} />
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
      {t.on === 'hand' && <>
        <Segmented size="sm" ariaLabel="Which hand" value={t.side} options={HAND_SIDES} onChange={side => onChange({ ...t, side })} />
        <Select ariaLabel="Gesture" value={t.gesture} options={HAND_GESTURE_OPTIONS} onChange={v => onChange({ ...t, gesture: v as HandGesture })} height={26} />
        {hint('or Learn and make it')}
        <HandsChip settings={false} />
      </>}
      {t.on === 'proximity' && <ProximityFields trigger={t} layers={layers} onChange={onChange} />}
      {t.on === 'reader' && <ReaderFields trigger={t} readers={readers} onChange={onChange} />}
      {(t.on === 'key' || t.on === 'note' || t.on === 'osc' || t.on === 'mouse') && hint(`${triggerLabel(t)} · Learn to change`)}
    </>
  );
}

const NO_READERS: AudioReader[] = [];

/** An audio reader trigger: which reader, the level it fires at, how far it falls before it can fire again, and the level now. */
function ReaderFields({ trigger: t, readers, onChange }: {
  trigger: Extract<TriggerSpec, { on: 'reader' }>;
  readers: readonly AudioReader[];
  onChange: (t: TriggerSpec) => void;
}) {
  const tk = useTokens();
  const r = readers.find(x => x.id === t.readerId);
  const [now, setNow] = useState<{ v: number | null; on: boolean }>({ v: null, on: false });
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - last < 50) return;
      last = ms;
      audioReaderBank.update();
      const x = audioReaderBank.value(t.readerId);
      const v = x === null ? null : Math.round(x * 100) / 100;
      const on = playEngine.isHeld(t);
      setNow(p => (p.v === v && p.on === on ? p : { v, on }));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [t]);
  const open = () => useReadersPanel.getState().show({ focus: t.readerId });
  const cap: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 58, flexShrink: 0 };
  const line: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 };
  const colour = r ? `rgb(${r.colour.map(c => Math.round(c * 255)).join(',')})` : tk.text.disabled;
  if (!readers.length) {
    return (
      <div style={{ order: 1, flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2, color: tk.text.muted, font: `11.5px/1.4 ${fontFamily.ui}` }}>
        No readers yet. Place one on the live spectrum first.
        <Button size="sm" icon="wave" onClick={open}>Spectrum readers…</Button>
      </div>
    );
  }
  return (
    <div style={{ order: 1, flexBasis: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2, padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.text.primary, 0.03), boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      <div style={line}>
        <span style={cap}>Reader</span>
        <Select ariaLabel="Reader" value={r ? r.id : ''} options={[...(r ? [] : [{ value: '', label: 'Pick one' }]), ...readers.map(x => ({ value: x.id, label: x.name }))]} onChange={readerId => onChange({ ...t, readerId })} height={26} style={{ maxWidth: 170 }} />
        <Button size="sm" variant="ghost" icon="wave" onClick={open}>Spectrum</Button>
      </div>
      <div style={{ ...line, flexWrap: 'nowrap' }}>
        <span style={cap} title="Fires when the reader goes above this (0–1)">Fires at</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RulerSlider ariaLabel="Threshold" value={t.threshold} min={0.01} max={0.99} step={0.01} defaultValue={0.6} onChange={threshold => onChange({ ...t, threshold, hysteresis: Math.min(t.hysteresis, threshold) })} />
        </div>
      </div>
      <div style={{ ...line, flexWrap: 'nowrap' }}>
        <span style={cap}>Now</span>
        <ReaderMeter level={now.v} thresholds={[t.threshold, Math.max(0, t.threshold - t.hysteresis)]} colour={colour} />
        <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary, width: 34, textAlign: 'right', flexShrink: 0 }}>{now.v === null ? '–' : now.v.toFixed(2)}</span>
      </div>
      <div style={{ ...line, justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: now.on ? tk.accent.text : tk.text.muted, font: `500 11.5px ${fontFamily.ui}` }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: now.on ? tk.accent.base : tk.text.disabled }} />
          {now.v === null ? 'No sound coming in' : now.on ? 'Above: firing' : 'Below'}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }} title="It lets go only this far below the threshold, so a ringing sound doesn’t fire twice">Hysteresis</span>
          <NumberInput value={t.hysteresis} min={0} max={t.threshold} step={0.01} title="How far below the threshold it has to fall before it can fire again (0–1)" onCommit={n => onChange({ ...t, hysteresis: Math.max(0, Math.min(t.threshold, n)) })} style={{ width: 44, height: 22, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' }} />
        </span>
      </div>
    </div>
  );
}

/** A or B: a layer, or a hand and the point on it. */
export function AnchorPicker({ value, layers, exclude, ariaLabel, onChange }: {
  value: string;
  layers: ReadonlyArray<TriggerLayerRef>;
  /** The other end, left out of the list (a thing is never near itself). */
  exclude?: string;
  ariaLabel: string;
  onChange: (ref: string) => void;
}) {
  const hand = parseHandAnchor(value);
  const options = anchorOptions(layers, exclude);
  const pick = anchorPick(value);
  const known = options.some(o => o.value === pick);
  return (
    <span style={{ display: 'inline-flex', gap: 4, minWidth: 0, flexWrap: 'wrap' }}>
      <Select ariaLabel={ariaLabel} value={known ? pick : ''} options={known ? options : [{ value: '', label: 'Pick one' }, ...options]} onChange={v => onChange(anchorChoice(v, value))} height={26} style={{ maxWidth: 170 }} />
      {hand && <Select ariaLabel={`${ariaLabel}: point on the hand`} value={`${hand.point}`} options={HAND_POINT_OPTIONS} onChange={v => onChange(`hand:${hand.side}:${parseInt(v, 10) || 0}`)} height={26} style={{ maxWidth: 150 }} />}
    </span>
  );
}

/** How far apart two anchors are now (picture heights) and whether the trigger is open, polled while shown. */
function useProximityNow(t: Extract<TriggerSpec, { on: 'proximity' }>): { d: number | null; on: boolean } {
  const [now, setNow] = useState<{ d: number | null; on: boolean }>({ d: null, on: false });
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - last < 66) return;
      last = ms;
      const d = playEngine.anchorGap(t.a, t.b);
      const on = playEngine.isHeld(t);
      const r = d === null ? null : Math.round(d * 100) / 100;
      setNow(p => (p.d === r && p.on === on ? p : { d: r, on }));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [t]);
  return now;
}

const PROX_MAX = 1;

function ProximityFields({ trigger: t, layers, onChange }: {
  trigger: Extract<TriggerSpec, { on: 'proximity' }>;
  layers: ReadonlyArray<TriggerLayerRef>;
  onChange: (t: TriggerSpec) => void;
}) {
  const tk = useTokens();
  const now = useProximityNow(t);
  const usesHand = !!parseHandAnchor(t.a) || !!parseHandAnchor(t.b);
  const cap: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 58, flexShrink: 0 };
  const line: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 };
  // The meter: the whole track is 0 … PROX_MAX picture heights; the band is where it fires (and the margin it holds through).
  const pct = (d: number) => `${(Math.max(0, Math.min(PROX_MAX, d)) / PROX_MAX) * 100}%`;
  const closer = t.when === 'closer';
  const bandFrom = closer ? 0 : t.distance, bandTo = closer ? t.distance : PROX_MAX;
  const holdFrom = closer ? t.distance : Math.max(0, t.distance - t.margin), holdTo = closer ? t.distance + t.margin : t.distance;
  const state = now.d === null ? (usesHand ? 'Hand not in view' : 'Not on the picture yet') : now.on ? (closer ? 'Close: firing' : 'Far: firing') : (closer ? 'Apart' : 'Close');
  return (
    // `order` puts the block after the row's Learn button, on its own line.
    <div style={{ order: 1, flexBasis: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2, padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.text.primary, 0.03), boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      <div style={line}>
        <span style={cap}>From</span>
        <AnchorPicker value={t.a} layers={layers} exclude={t.b} ariaLabel="From (A)" onChange={a => onChange({ ...t, a })} />
      </div>
      <div style={line}>
        <span style={cap}>To</span>
        <AnchorPicker value={t.b} layers={layers} exclude={t.a} ariaLabel="To (B)" onChange={b => onChange({ ...t, b })} />
        {usesHand && <HandsChip settings={false} />}
      </div>
      <div style={line}>
        <span style={cap}>While</span>
        <Segmented size="sm" ariaLabel="Closer or farther" value={t.when} options={[
          { value: 'closer', label: 'Closer than', title: 'While their centres are nearer than the distance' },
          { value: 'farther', label: 'Farther than', title: 'While their centres are further apart than the distance' },
        ]} onChange={when => onChange({ ...t, when })} />
      </div>
      <div style={{ ...line, flexWrap: 'nowrap' }}>
        <span style={cap} title="In picture heights: 1 is the height of the picture">Distance</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RulerSlider ariaLabel="Distance, in picture heights" value={t.distance} min={0} max={PROX_MAX} step={0.01} defaultValue={0.15} onChange={distance => onChange({ ...t, distance })} />
        </div>
      </div>
      <div style={{ ...line, flexWrap: 'nowrap' }}>
        <span style={cap}>Now</span>
        <div
          role="meter" aria-label="Distance now" aria-valuemin={0} aria-valuemax={PROX_MAX} aria-valuenow={now.d ?? undefined}
          title="The shaded part is where it fires; the lighter strip is the margin it holds through before letting go"
          style={{ position: 'relative', flex: 1, minWidth: 60, height: 8, borderRadius: 4, background: tk.bg.field }}
        >
          <span style={{ position: 'absolute', top: 0, bottom: 0, left: pct(bandFrom), width: `calc(${pct(bandTo)} - ${pct(bandFrom)})`, borderRadius: 4, background: alpha(tk.accent.base, 0.28) }} />
          <span style={{ position: 'absolute', top: 0, bottom: 0, left: pct(holdFrom), width: `calc(${pct(holdTo)} - ${pct(holdFrom)})`, background: alpha(tk.accent.base, 0.12) }} />
          {now.d !== null && <span style={{
            position: 'absolute', top: '50%', left: pct(now.d), width: 12, height: 12, marginLeft: -6, marginTop: -6, borderRadius: 6,
            background: now.on ? tk.accent.base : tk.bg.panel, boxShadow: `0 0 0 1.5px ${now.on ? tk.accent.base : tk.text.muted}`, transition: 'left 60ms linear',
          }} />}
        </div>
        <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary, width: 34, textAlign: 'right', flexShrink: 0 }}>{now.d === null ? '–' : now.d.toFixed(2)}</span>
      </div>
      <div style={{ ...line, justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: now.on ? tk.accent.text : tk.text.muted, font: `500 11.5px ${fontFamily.ui}` }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: now.on ? tk.accent.base : tk.text.disabled }} />
          {state}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }} title="It lets go only this much past the distance, so it doesn't flicker at the edge">Margin</span>
          <NumberInput value={t.margin} min={0} max={1} step={0.01} title="How far past the distance it has to go to let go (picture heights)" onCommit={n => onChange({ ...t, margin: Math.max(0, Math.min(1, n)) })} style={{ width: 44, height: 22, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' }} />
        </span>
      </div>
    </div>
  );
}

/**
 * When the trigger fires: once (the default), every frame while it's held,
 * every N frames or seconds while it's held, or when it lets go. `what` is
 * the thing it fires (an action kind, or a trigger mapping's mode), for the
 * hint when repeating it would flicker.
 */
export function FirePicker({ trigger: t, what, numStyle, onChange }: {
  trigger: TriggerSpec;
  what: ActionKind | `mode:${TriggerMode}`;
  numStyle: React.CSSProperties;
  onChange: (t: TriggerSpec) => void;
}) {
  const tk = useTokens();
  const f = fireOf(t);
  const set = (patch: Partial<typeof f>) => onChange(withFire(t, { ...f, ...patch }));
  const warn = repeatHint(what, t.fire);
  // One wrapping box beside the row's label, so N and its unit (and the hint) line up under the modes.
  return (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Segmented size="sm" ariaLabel="When it fires" value={f.mode} options={fireModes(t)} onChange={(mode: FireMode) => set({ mode })} />
      {f.mode === 'every' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <NumberInput
            value={f.every} min={f.unit === 'frames' ? 1 : 0.01} max={f.unit === 'frames' ? 600 : 60} step={f.unit === 'frames' ? 1 : 0.05}
            title={f.unit === 'frames' ? 'Fire every this many frames while it is held' : 'Fire every this many seconds while it is held'}
            onCommit={n => set({ every: f.unit === 'frames' ? Math.max(1, Math.min(600, Math.round(n))) : Math.max(0.01, Math.min(60, n)) })}
            style={{ ...numStyle, width: 44 }}
          />
          <Segmented size="sm" ariaLabel="Unit" value={f.unit} options={[
            { value: 'frames', label: 'frames', title: 'Tied to the frame rate: exact in a render' },
            { value: 'seconds', label: 'seconds', title: 'The same rhythm at any frame rate' },
          ]} onChange={unit => {
            if (unit === f.unit) return;
            // Keep about the same rhythm at 60 frames a second.
            set({ unit, every: unit === 'frames' ? Math.max(1, Math.round(f.every * 60)) : Math.max(0.01, Math.round((f.every / 60) * 100) / 100) });
          }} />
        </span>
      )}
      {warn && (
        <div role="note" style={{ flexBasis: '100%', display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 8px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.12), color: tk.status.warningText, font: `11.5px/1.4 ${fontFamily.ui}` }}>
          <Icon name="alert" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{warn}</span>
        </div>
      )}
    </span>
  );
}
