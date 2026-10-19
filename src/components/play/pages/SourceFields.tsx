/**
 * A source's fields (the Sources column, pages/SourcesColumn.tsx): its kind,
 * the options each kind needs, triggers, and the mapping meters and curve pad.
 */
import { openProSheet, useCan } from '../../../lib/plan';
import { sourceTypeNeedsPro } from '../../../play/planGates';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { DataSourceOptions } from '../DataSourceOptions';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayControl, PlayMapping, PlaySource } from '../../../types/play';
import { CHANNELS, HAND_GESTURE_OPTIONS, HAND_READ_HINTS, HAND_SIDES, LFO_SHAPES, LIVE_BAND_OPTIONS, NOISE_TYPES, PINCH_FINGERS, SENSOR_HINTS, SENSOR_LABELS, OPEN_READERS, TILT_AXES, TRIGGER_MODES, keyName, sourceFromType, sourceType, type SourceType } from '../../../play/playSources';
import { CAPTURE_POS, PER_GRAIN_READS, sensorReadsFor, type SensorRead } from '../../../types/play';
import { GRAIN_EACH } from '../../../types/playAudioEngine';
import type { LfoShape, LiveAudioBand, TriggerSpec } from '../../../types/play';
import { applyCurve, FN_BEAT_HZ, playEngine } from '../../../lib/playEngine';
import { fnEval } from '../../../play/kit/fn.js';
import { subscribeTimeTick } from '../../../lib/timeTick';
import { isUnassignedCc } from '../../../lib/midiAutoLearn';
import { MidiWaitChip } from '../MidiSourceOptions';
import { Button, IconButton } from '../../ui/Button';
import { rowField } from '../../ui/rowLayout';
import { useNarrow } from '../../../hooks/useNarrow';
import { Segmented, Toggle } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Select } from '../../ui/Select';
import { GroupedPicker } from '../../ui/GroupedPicker';
import { HAND_POINT_SECTIONS, sourcePickerSections } from '../sourcePickerSections';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { LiveAudioChip, OscStatusChip } from '../chips';
import { AbletonSourceOptions, useLive } from '../live/LiveFields';
import { liveClient } from '../../../lib/liveClient';
import { TrackPointPicker, TrackerChip } from '../TrackingChips';
import { BLEND_OPTIONS, FACE_GESTURE_OPTIONS, FACE_READ_HINTS, POSE_GESTURE_OPTIONS, POSE_READ_HINTS } from '../../../play/trackSources';
import type { FaceGesture, PoseGesture } from '../../../types/playTracking';
import type { HandGesture } from '../../../types/play';
import { usePolledNumber } from '../liveValueStore';
import { MidiSourceOptions, PadSourceOptions } from '../MidiSourceOptions';
import { BuiltInSignalOptions } from '../BuiltInSignals';
import { AnchorPicker, FirePicker, TriggerPicker, type TriggerLayerRef } from '../TriggerPicker';
import { useReadersPanel } from '../readersPanelUi';
import { formatHz, formatWidth } from '../../../play/audioReaders';
import { Menu } from '../../ui/Menu';
import type { IconName } from '../../ui/iconPaths';
import { signalSource } from '../../../lib/playEngine';
import { SIGNAL_SOURCE } from '../sourcePickerSections';
import { type AudioNodeOption, NO_READERS } from './SourcesColumn';

export const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A source's picker and the fields its kind needs (a Null layer and axis, a
 * captured signal, another control, a MIDI CC and channel, a key): the source
 * row of a mapping and of a source card on the Inputs board.
 */
/** A button of a source row that folds into its ⋯ menu when the card is narrow. */
interface RowAction { icon: IconName; label: string; danger?: boolean; onSelect: () => void }

/** Below this a source row puts its fields on a second line and its secondary buttons in a ⋯ menu. */
const SOURCE_ROW_NARROW = 360;

export function SourceFields({ source, controls, excludeControlId, nullLayers, layerRefs, numStyle, onChange, onCaptured, mappingId, pickerOnly = false, lead, actions, secondary = [], style }: {
  source: PlaySource;
  controls: PlayControl[];
  /** The control it drives (a control source can't be it). */
  excludeControlId?: string;
  nullLayers: { id: string; label: string }[];
  layerRefs: LayerRef[];
  numStyle: React.CSSProperties;
  onChange: (source: PlaySource) => void;
  /** Set picked: the source, with no glide (a mapping drops its smoothing). */
  onCaptured: (source: PlaySource) => void;
  /** The readers panel opens on this mapping. */
  mappingId?: string;
  pickerOnly?: boolean;
  /** Before the picker: the fold chevron, the drag grip, the "Source" label. */
  lead?: ReactNode | ((narrow: boolean) => ReactNode);
  /** After the fields, always shown (Solo, Learn). */
  actions?: ReactNode;
  /** After those: buttons when there's room, a ⋯ menu when the card is narrow. */
  secondary?: readonly RowAction[];
  style?: React.CSSProperties;
}) {
  const tk = useTokens();
  const rowRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(rowRef, SOURCE_ROW_NARROW);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const type = sourceType(source);
  const readers = useNodeGraphStore(s => s.play.audioReaders?.readers) ?? NO_READERS;
  const allSources = useCan('play.sources');
  const signals = useNodeGraphStore(s => s.play.signals);
  const sourceSections = useMemo(() => sourcePickerSections(readers, !allSources, signals), [readers, allSources, signals]);
  const otherControls = controls.filter(c => c.id !== excludeControlId);
  const pickSource = (v: string) => {
    if (!allSources && sourceTypeNeedsPro(v)) { openProSheet('play.sources'); return; }
    if (v.startsWith(SIGNAL_SOURCE)) { onChange(signalSource(v.slice(SIGNAL_SOURCE.length))); return; }
    if (v === OPEN_READERS) { useReadersPanel.getState().show({ mappingId: mappingId ?? '', focus: source.kind === 'reader' ? source.readerId : '' }); return; }
    // Set: the first signal that captures a number, and no glide (it jumps).
    if (v === 'captured' && source.kind !== 'captured') { onCaptured({ kind: 'captured', signal: (signals ?? []).find(s => s.capture && !s.capture.what.startsWith(CAPTURE_POS))?.id ?? signals?.[0]?.id ?? '', release: 'stay' }); return; }
    onChange(sourceFromType(v as SourceType, source, otherControls[0]?.id ?? '', nullLayers[0]?.id ?? '', firstSensor(layerRefs), firstDataset()));
  };
  const picker = <GroupedPicker ariaLabel="Source" value={type} sections={sourceSections} onChange={pickSource} height={26} style={{ flex: 1, minWidth: 0 }} width={300} searchPlaceholder="Search sources" />;
  const extras = pickerOnly ? null : sourceExtras();
  const buttons = <>
    {actions}
    {narrow && secondary.length > 0
      ? <IconButton icon="more" label="More: map, details, remove" size="sm" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMore({ x: r.left, y: r.bottom + 4 }); }} />
      : secondary.map(a => <IconButton key={a.label} icon={a.icon} label={a.label} size="sm" tone={a.danger ? 'danger' : 'default'} onClick={a.onSelect} />)}
  </>;
  // Wide: one line that still wraps rather than clips. Narrow: the picker and the buttons on the
  // first line (the picker's name ellipsised), the source's own fields on the next.
  return (
    <div ref={rowRef} style={{ display: 'flex', alignItems: 'center', gap: 6, rowGap: 6, flexWrap: 'wrap', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: narrow ? '1 1 0' : '1 1 140px', minWidth: 0 }}>
        {typeof lead === 'function' ? lead(narrow) : lead}
        {picker}
      </div>
      {!narrow && extras && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>{extras}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>{buttons}</div>
      {narrow && extras && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 100%', minWidth: 0, flexWrap: 'wrap' }}>{extras}</div>}
      {more && <Menu x={more.x} y={more.y} onClose={() => setMore(null)} items={secondary.map(a => ({ label: a.label, icon: a.icon, danger: a.danger, onSelect: a.onSelect }))} />}
    </div>
  );

  // The fields a source kind needs beyond the picker (null when it needs none).
  function sourceExtras(): ReactNode {
    const parts = <>
        {source.kind === 'null' && (
          nullLayers.length === 0
            ? <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Add a Null layer first</span>
            : <>
                <Select ariaLabel="Null layer" value={source.layerId} options={nullLayers.map(l => ({ value: l.id, label: l.label }))} onChange={v => onChange({ kind: 'null', layerId: v, axis: source.kind === 'null' ? source.axis : 'x' })} height={26} style={{ flex: 1, minWidth: 0 }} />
                <Segmented size="sm" ariaLabel="Null axis" value={source.axis} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} onChange={v => onChange({ kind: 'null', layerId: source.kind === 'null' ? source.layerId : '', axis: v })} />
              </>
        )}
        {source.kind === 'captured' && (() => {
          const src = source;
          return <>
            <Select ariaLabel="Signal it takes the value from" value={src.signal} options={[...(signals ?? []).some(s => s.id === src.signal) ? [] : [{ value: src.signal, label: 'Pick a signal' }], ...(signals ?? []).map(s => ({ value: s.id, label: s.capture ? s.name : `${s.name} (captures nothing yet)` }))]} onChange={v => onChange({ ...src, signal: v })} height={26} style={{ flex: 1, minWidth: 0 }} />
            <Segmented size="sm" ariaLabel="When the signal lets go" value={src.release} options={[
              { value: 'stay', label: 'Stay', title: 'Keeps the value it was set to until the next capture' },
              { value: 'back', label: 'Go back', title: 'The control goes back to its own slider when the signal is false' },
              { value: 'value', label: 'Go to', title: 'Goes to a resting value when the signal is false' },
            ]} onChange={release => onChange(release === 'value' ? { ...src, release, rest: src.rest ?? 0 } : { kind: 'captured', signal: src.signal, release })} />
            {src.release === 'value' && <NumberInput value={src.rest ?? 0} step={0.01} title="Where it rests while the signal is false" onCommit={n => onChange({ ...src, rest: n })} style={{ ...numStyle, width: 52 }} />}
          </>;
        })()}
        {source.kind === 'control' && (
          otherControls.length === 0
            ? <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Add a second control</span>
            : <Select ariaLabel="Source control" value={source.controlId} options={otherControls.map(c => ({ value: c.id, label: c.label }))} onChange={v => onChange({ kind: 'control', controlId: v })} height={26} style={{ flex: 1, minWidth: 0 }} />
        )}
        {source.kind === 'midi' && source.signal === 'cc' && (isUnassignedCc(source)
          ? <MidiWaitChip title="This row has no knob yet: the first CC that moves on any device becomes its CC (or type one in the Knob row below)" />
          : <NumberInput value={source.cc ?? 0} min={0} max={127} step={1} title="CC number" onCommit={n => onChange({ ...source, kind: 'midi', signal: 'cc', channel: source.kind === 'midi' ? source.channel : 0, cc: Math.max(0, Math.min(127, Math.round(n))) })} style={{ ...numStyle, width: 44 }} />
        )}
        {source.kind === 'midi' && (
          <Select ariaLabel="MIDI channel" value={`${source.channel}`} options={CHANNELS} onChange={v => onChange({ ...(source as Extract<PlaySource, { kind: 'midi' }>), channel: parseInt(v, 10) || 0 })} height={26} style={{ flexShrink: 0 }} />
        )}
        {source.kind === 'key' && (
          <span style={{ height: 26, padding: '0 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', background: tk.bg.field, font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{keyName(source.code)}</span>
        )}
    </>;
    return source.kind === 'null' || source.kind === 'captured' || source.kind === 'control' || source.kind === 'midi' || source.kind === 'key' ? parts : null;
  }
}

export interface LayerRef { id: string; label: string; kind: string; shape?: string }

/** The first layer that measures something, and what it reads (a new sensor source starts there). */
export function firstSensor(layers: LayerRef[]): { layerId: string; read: SensorRead } | null {
  const l = layers.find(x => sensorReadsFor(x).length);
  return l ? { layerId: l.id, read: sensorReadsFor(l)[0] } : null;
}

/** The dataset a new Data source starts on: the first Data layer's, else the first in the graph. */
export function firstDataset(): string {
  const st = useNodeGraphStore.getState();
  const l = st.play.layers.find(x => x.kind === 'data' && x.dataset);
  return (l?.kind === 'data' ? l.dataset : '') || Object.keys(st.datasets)[0] || '';
}

/** The second row of a mapping: the fields a source kind needs beyond its name. */
export function SourceOptions({ source, audioNodes, layerRefs, numStyle, labelStyle, onChange }: {
  source: PlaySource;
  audioNodes: AudioNodeOption[];
  layerRefs: LayerRef[];
  numStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  onChange: (source: PlaySource) => void;
}) {
  const tk = useTokens();
  const taps = useRef<number[]>([]);
  const [tiltAsk, setTiltAsk] = useState(() => playEngine.tiltNeedsPermission());
  // A Clock following Live shows Live's tempo: re-render as the Live connector changes (only then).
  useSyncExternalStore(cb => liveClient.onChange(cb), () => (source.kind === 'clock' && source.follow ? liveClient.getVersion() : 0), () => 0);
  const hint = (text: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{text}</span>;
  const row = (children: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
      <span style={labelStyle}>Options</span>
      <div style={rowField}>{children}</div>
    </div>
  );
  switch (source.kind) {
    case 'lfo':
      return row(<>
        <Select ariaLabel="LFO shape" value={source.shape} options={LFO_SHAPES} onChange={v => onChange({ ...source, shape: v as LfoShape })} height={26} />
        <NumberInput value={source.rate} min={0.01} max={50} step={0.1} title="Cycles per second" onCommit={n => onChange({ ...source, rate: Math.max(0.001, n) })} style={numStyle} />
        {hint('Hz')}
        <NumberInput value={source.phase} min={0} max={1} step={0.05} title="Phase offset, 0–1" onCommit={n => onChange({ ...source, phase: n })} style={{ ...numStyle, width: 48 }} />
        {hint('phase')}
      </>);
    case 'clock': {
      const tap = () => {
        const now = performance.now();
        const t = taps.current.filter(x => now - x < 2500);
        t.push(now);
        taps.current = t;
        if (t.length >= 2) {
          const avg = (t[t.length - 1] - t[0]) / (t.length - 1);
          onChange({ ...source, bpm: Math.round(60000 / avg) });
        }
      };
      // Follow Live: Live's tempo and beat (the Live connector), shown in place of the BPM; Playfield's own while Live isn't connected.
      const following = !!source.follow && liveClient.hasTransport();
      return row(<>
        {following
          ? hint(`${Math.round(liveClient.state.follower.tempo * 10) / 10} bpm (Live)`)
          : <>
            <NumberInput value={source.bpm} min={1} max={999} step={1} title="Beats per minute" onCommit={n => onChange({ ...source, bpm: Math.max(1, n) })} style={numStyle} />
            {hint('bpm')}
            <Button size="sm" onClick={tap} title="Tap the tempo">Tap</Button>
          </>}
        <NumberInput value={source.beats} min={0.0625} max={64} step={1} title="Beats per cycle" onCommit={n => onChange({ ...source, beats: Math.max(0.0625, n) })} style={{ ...numStyle, width: 48 }} />
        {hint('beats')}
        <Select ariaLabel="Clock shape" value={source.shape} options={LFO_SHAPES} onChange={v => onChange({ ...source, shape: v as LfoShape })} height={26} />
        <ClockFollowToggle source={source} onChange={onChange} />
      </>);
    }
    case 'fn': {
      const { error } = fnEval(source.expr, { t: 0, b: 0 });
      return (
        <>
          {row(<>
            <Field value={source.expr} onChange={e => onChange({ ...source, expr: e.target.value })} height={26} mono style={{ flex: 1, minWidth: 140 }} placeholder="sin(t * 2) * 0.5 + 0.5" />
            <FnPreview expr={source.expr} />
          </>)}
          <div style={{ margin: '-2px 0 6px 60px', color: error ? tk.status.danger : tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
            {error || 't = seconds, b = beats · sin cos tan abs floor ceil round fract sqrt pow exp log sign min max mix clamp step smoothstep mod noise rand'}
          </div>
          {row(<>
            <NumberInput value={source.min} title="Raw value that reads as 0" onCommit={n => onChange({ ...source, min: n })} style={{ ...numStyle, width: 48 }} />
            {hint('→')}
            <NumberInput value={source.max} title="Raw value that reads as 1" onCommit={n => onChange({ ...source, max: n === source.min ? n + 1 : n })} style={{ ...numStyle, width: 48 }} />
            {hint('range: normalises the formula into 0–1')}
          </>)}
        </>
      );
    }
    case 'audio': {
      if (audioNodes.length === 0) return row(hint('Add an Audio Input node in the Studio and load a file or the mic.'));
      const node = audioNodes.find(n => n.id === source.nodeId) ?? audioNodes[0];
      const bands = Array.from({ length: node.bands }, (_, i) => ({ value: `${i}`, label: `Band ${i + 1}` }));
      return row(<>
        <Select ariaLabel="Audio node" value={node.id} options={audioNodes.map(n => ({ value: n.id, label: n.label }))} onChange={v => onChange({ ...source, nodeId: v, band: 0 })} height={26} style={{ flex: 1, minWidth: 0 }} />
        <Select ariaLabel="Band" value={`${Math.min(source.band, node.bands - 1)}`} options={bands} onChange={v => onChange({ ...source, nodeId: node.id, band: parseInt(v, 10) || 0 })} height={26} />
      </>);
    }
    case 'tilt':
      return row(<>
        <Select ariaLabel="Tilt axis" value={source.axis} options={TILT_AXES} onChange={v => onChange({ ...source, axis: v as 'beta' | 'gamma' | 'alpha' })} height={26} />
        {tiltAsk
          ? <Button size="sm" onClick={async () => { if (await playEngine.requestTiltPermission()) setTiltAsk(false); }}>Enable motion</Button>
          : hint('Phones and tablets only')}
      </>);
    case 'gamepad':
      return row(<>
        <NumberInput value={source.pad + 1} min={1} max={4} step={1} title="Which controller" onCommit={n => onChange({ ...source, pad: Math.max(0, Math.round(n) - 1) })} style={{ ...numStyle, width: 40 }} />
        {hint('pad')}
        <Select ariaLabel="Axis or button" value={source.control} options={[{ value: 'axis', label: 'Stick axis' }, { value: 'button', label: 'Button' }]} onChange={v => onChange({ ...source, control: v as 'axis' | 'button' })} height={26} />
        <NumberInput value={source.index} min={0} max={31} step={1} title="Axis or button number" onCommit={n => onChange({ ...source, index: Math.max(0, Math.round(n)) })} style={{ ...numStyle, width: 40 }} />
        {hint('or press Learn and move it')}
      </>);
    case 'noise':
      return row(<>
        <Segmented size="sm" ariaLabel="Noise type" value={source.type} options={NOISE_TYPES} onChange={v => onChange({ ...source, type: v })} />
        {source.type !== 'random' && <>
          <NumberInput value={source.rate} min={0.01} max={60} step={0.1} title={source.type === 'stepped' ? 'Jumps per second' : 'Changes per second'} onCommit={n => onChange({ ...source, rate: Math.max(0.01, n) })} style={{ ...numStyle, width: 48 }} />
          {hint('/ s')}
        </>}
        {source.type === 'stepped' && <>
          <NumberInput value={source.steps} min={0} max={64} step={1} title="Snap to this many levels (0 = any value)" onCommit={n => onChange({ ...source, steps: Math.max(0, Math.min(64, Math.round(n))) })} style={{ ...numStyle, width: 40 }} />
          {hint('levels')}
        </>}
        {source.type === 'biased' && <>
          <NumberInput value={Math.round((source.bias ?? 0.5) * 100)} min={0} max={100} step={5} title="Lean: 0 low, 50 even, 100 high" onCommit={n => onChange({ ...source, bias: Math.max(0, Math.min(100, n)) / 100 })} style={{ ...numStyle, width: 40 }} />
          {hint('lean %')}
        </>}
        <IconButton icon="dice" label="New seed: a different random path" size="sm" onClick={() => onChange({ ...source, seed: Math.floor(Math.random() * 100000) })} />
        <Toggle checked={!!source.reseed} onChange={reseed => { if (reseed) { onChange({ ...source, reseed }); return; } const rest = { ...source }; delete rest.reseed; onChange(rest); }} label="New each play" />
      </>);
    case 'osc':
      return (
        <>
          {row(<>
            <Field value={source.address} onChange={e => onChange({ ...source, address: e.target.value.startsWith('/') ? e.target.value : `/${e.target.value}` })} height={26} mono style={{ flex: 1, minWidth: 120 }} placeholder="/1/fader1" />
            <NumberInput value={source.arg} min={0} max={15} step={1} title="Which argument (0 = the first)" onCommit={n => onChange({ ...source, arg: Math.max(0, Math.round(n)) })} style={{ ...numStyle, width: 36 }} />
            {hint('arg')}
          </>)}
          {row(<>
            <NumberInput value={source.min} title="OSC value that means 0" onCommit={n => onChange({ ...source, min: n })} style={{ ...numStyle, width: 48 }} />
            {hint('→')}
            <NumberInput value={source.max} title="OSC value that means 1" onCommit={n => onChange({ ...source, max: n === source.min ? n + 1 : n })} style={{ ...numStyle, width: 48 }} />
            <OscStatusChip />
          </>)}
        </>
      );
    case 'ableton':
      return <AbletonSourceOptions source={source} row={row} onChange={onChange} />;
    case 'live':
      return row(<>
        <Select ariaLabel="Band" value={source.band} options={LIVE_BAND_OPTIONS} onChange={v => onChange({ ...source, band: v as LiveAudioBand })} height={26} />
        <NumberInput value={source.gain} min={0.1} max={10} step={0.1} title="Gain: turn up for quiet inputs" onCommit={n => onChange({ ...source, gain: Math.max(0.1, Math.min(10, n)) })} style={{ ...numStyle, width: 44 }} />
        {hint('×')}
        <LiveAudioChip />
      </>);
    case 'reader':
      return <ReaderSourceOptions source={source} row={row} hint={hint} onChange={onChange} />;
    case 'trigger':
      return <TriggerOptions source={source} layers={layerRefs} numStyle={numStyle} labelStyle={labelStyle} onChange={onChange} />;
    case 'hand':
      return (
        <>
          {row(<>
            {source.read !== 'spread' && <Segmented size="sm" ariaLabel="Which hand" value={source.side} options={HAND_SIDES} onChange={side => onChange({ ...source, side })} />}
            {source.read === 'point' && <>
              <GroupedPicker ariaLabel="Point on the hand" value={`${source.point}`} sections={HAND_POINT_SECTIONS} onChange={v => onChange({ ...source, point: parseInt(v, 10) || 0 })} height={26} style={{ flex: 1, minWidth: 110 }} width={220} searchPlaceholder="Search points" />
              <Segmented size="sm" ariaLabel="Axis" value={source.axis} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z', title: 'Toward the camera (from the wrist)' }]} onChange={axis => onChange({ ...source, axis })} />
            </>}
            {source.read === 'palm' && <Segmented size="sm" ariaLabel="Axis" value={source.axis === 'y' ? 'y' : 'x'} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} onChange={axis => onChange({ ...source, axis })} />}
            {source.read === 'pinch' && <Select ariaLabel="Finger the thumb pinches" value={`${source.point}`} options={PINCH_FINGERS} onChange={v => onChange({ ...source, point: parseInt(v, 10) || 8 })} height={26} />}
            {source.read === 'gesture' && <Select ariaLabel="Gesture" value={source.gesture} options={HAND_GESTURE_OPTIONS} onChange={v => onChange({ ...source, gesture: v as HandGesture })} height={26} />}
          </>)}
          <div style={{ margin: '-2px 0 6px 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{HAND_READ_HINTS[source.read]}</div>
        </>
      );
    case 'face':
    case 'pose': {
      const reads = source.kind === 'face' ? FACE_READ_HINTS : POSE_READ_HINTS;
      return (
        <>
          {row(<>
            {(source.read === 'point' || source.read === 'visibility') && <TrackPointPicker kind={source.kind} value={source.point} onChange={point => onChange({ ...source, point })} />}
            {source.read === 'point' && <Segmented size="sm" ariaLabel="Axis" value={source.axis} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z', title: 'Toward the camera' }]} onChange={axis => onChange({ ...source, axis })} />}
            {source.kind === 'face' && source.read === 'blend' && <Select ariaLabel="Blendshape" value={`${source.point}`} options={BLEND_OPTIONS} onChange={v => onChange({ ...source, point: parseInt(v, 10) || 0 })} height={26} style={{ flex: 1, minWidth: 0 }} />}
            {source.kind === 'face' && source.read === 'gesture' && <Select ariaLabel="Face gesture" value={source.gesture} options={FACE_GESTURE_OPTIONS} onChange={v => onChange({ ...source, gesture: v as FaceGesture })} height={26} />}
            {source.kind === 'pose' && source.read === 'gesture' && <Select ariaLabel="Pose gesture" value={source.gesture} options={POSE_GESTURE_OPTIONS} onChange={v => onChange({ ...source, gesture: v as PoseGesture })} height={26} />}
            <TrackerChip kind={source.kind} />
          </>)}
          <div style={{ margin: '-2px 0 6px 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{(reads as Record<string, string>)[source.read]}</div>
        </>
      );
    }
    case 'data':
      return <DataSourceOptions source={source} labelStyle={labelStyle} onChange={onChange} />;
    case 'midi':
      return <MidiSourceOptions source={source} labelStyle={labelStyle} numStyle={numStyle} onChange={onChange} />;
    case 'pad':
      return <PadSourceOptions source={source} labelStyle={labelStyle} numStyle={numStyle} onChange={onChange} />;
    case 'signals':
      return <BuiltInSignalOptions source={source} labelStyle={labelStyle} numStyle={numStyle} onChange={onChange} />;
    case 'sensor': {
      const sensing = layerRefs.filter(l => sensorReadsFor(l).length);
      if (!sensing.length) return row(hint('Add a layer first: a shape, particles, a null…'));
      const layer = layerRefs.find(l => l.id === source.layerId);
      const reads = sensorReadsFor(layer);
      return (
        <>
          {row(<>
            <Select ariaLabel="Sensor layer" value={source.layerId} options={sensing.map(l => ({ value: l.id, label: l.label }))} onChange={v => { const r = sensorReadsFor(layerRefs.find(l => l.id === v)); onChange({ ...source, layerId: v, read: r.includes(source.read) ? source.read : r[0] ?? 'fill' }); }} height={26} />
            {reads.length > 1 && reads.length <= 4 && <Segmented size="sm" ariaLabel="Reads" value={source.read} options={reads.map(r => ({ value: r, label: SENSOR_LABELS[r], title: SENSOR_HINTS[r] }))} onChange={v => onChange({ ...source, read: v })} />}
            {reads.length > 4 && <Select ariaLabel="Reads" value={source.read} options={reads.map(r => ({ value: r, label: SENSOR_LABELS[r] }))} onChange={v => onChange({ ...source, read: v as SensorRead })} height={26} />}
            {PER_GRAIN_READS.includes(source.read) && <Select ariaLabel="Which grain" value={source.otherId || '1'} options={Array.from({ length: GRAIN_EACH }, (_, i) => ({ value: String(i + 1), label: `Grain ${i + 1}` }))} onChange={v => onChange({ ...source, otherId: v })} height={26} />}
            {reads.length === 1 && hint(SENSOR_LABELS[reads[0]])}
            {source.read === 'distance' && <>{hint('to')}<AnchorPicker value={source.otherId} layers={layerRefs} exclude={source.layerId} ariaLabel="Distance to" onChange={otherId => onChange({ ...source, otherId })} /></>}
          </>)}
          <div style={{ margin: '-2px 0 6px 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{SENSOR_HINTS[source.read]}</div>
        </>
      );
    }
    default:
      return null;
  }
}

/** A reader source: which reader, what it reads, and the way to the spectrum. */
function ReaderSourceOptions({ source, row, hint, onChange }: {
  source: Extract<PlaySource, { kind: 'reader' }>;
  row: (children: ReactNode) => ReactNode;
  hint: (text: string) => ReactNode;
  onChange: (source: PlaySource) => void;
}) {
  const readers = useNodeGraphStore(s => s.play.audioReaders?.readers) ?? NO_READERS;
  const input = useNodeGraphStore(s => s.play.audioReaders?.input ?? '');
  const r = readers.find(x => x.id === source.readerId);
  const open = () => useReadersPanel.getState().show({ focus: source.readerId });
  return row(<>
    {readers.length > 1 && <Select ariaLabel="Reader" value={r ? r.id : ''} options={[...(r ? [] : [{ value: '', label: 'Missing reader' }]), ...readers.map(x => ({ value: x.id, label: x.name }))]} onChange={v => onChange({ kind: 'reader', readerId: v })} height={26} style={{ maxWidth: 150 }} />}
    {r ? hint(`${formatHz(r.hz)} · ${formatWidth(r.width)} · ${r.gain > 0 ? '+' : ''}${Math.round(r.gain)} dB`) : hint('This reader was deleted')}
    <Button size="sm" icon="wave" onClick={open}>Spectrum</Button>
    {!input && <LiveAudioChip readers={false} />}
  </>);
}

/** Where a trigger fires from and what it does. */
function TriggerOptions({ source, layers, numStyle, labelStyle, onChange }: {
  source: Extract<PlaySource, { kind: 'trigger' }>;
  layers: ReadonlyArray<TriggerLayerRef>;
  numStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  onChange: (source: PlaySource) => void;
}) {
  const row = (label: string, children: ReactNode, top = false) => (
    <div style={{ display: 'flex', alignItems: top ? 'flex-start' : 'baseline', gap: 6, marginBottom: 6 }}>
      <span style={top ? { ...labelStyle, lineHeight: '26px' } : labelStyle}>{label}</span>
      {top ? <div style={{ flex: '1 1 0', minWidth: 0 }}>{children}</div> : <div style={rowField}>{children}</div>}
    </div>
  );
  const t = source.trigger;
  const setT = (trigger: TriggerSpec) => onChange({ ...source, trigger });
  return (
    <>
      {row('On', <TriggerPicker trigger={t} layers={layers} numStyle={numStyle} onChange={setT} />)}
      {row('Fires', <FirePicker trigger={t} what={`mode:${source.mode}`} numStyle={numStyle} onChange={setT} />, true)}
      {row('Does', <Segmented size="sm" ariaLabel="Trigger mode" value={source.mode} options={TRIGGER_MODES} onChange={v => onChange({ ...source, mode: v })} />)}
      {source.mode === 'envelope' && (
        <>
          {row('ADSR', <>
            <NumberInput value={source.attack} min={0} max={10000} step={10} title="Attack, ms" onCommit={n => onChange({ ...source, attack: Math.max(0, n) })} style={{ ...numStyle, width: 44 }} />
            <NumberInput value={source.decay} min={0} max={10000} step={10} title="Decay, ms" onCommit={n => onChange({ ...source, decay: Math.max(0, n) })} style={{ ...numStyle, width: 44 }} />
            <NumberInput value={source.sustain} min={0} max={1} step={0.05} title="Sustain level while held, 0–1" onCommit={n => onChange({ ...source, sustain: Math.max(0, Math.min(1, n)) })} style={{ ...numStyle, width: 40 }} />
            <NumberInput value={source.release} min={0} max={20000} step={10} title="Release, ms" onCommit={n => onChange({ ...source, release: Math.max(0, n) })} style={{ ...numStyle, width: 44 }} />
            <EnvelopeGlyph a={source.attack} d={source.decay} s={source.sustain} r={source.release} />
          </>)}
          {t.on === 'note' && row('Velocity', <Toggle checked={source.velocity} onChange={velocity => onChange({ ...source, velocity })} label="Harder hits peak higher" />)}
        </>
      )}
      {source.mode === 'step' && row('Steps', <NumberInput value={source.steps} min={2} max={64} step={1} title="How many steps before it wraps" onCommit={n => onChange({ ...source, steps: Math.max(2, Math.min(64, Math.round(n))) })} style={{ ...numStyle, width: 44 }} />)}
    </>
  );
}

/** A small picture of the ADSR shape, with a fixed hold between decay and release. */
function EnvelopeGlyph({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  const tk = useTokens();
  const hold = Math.max(150, (a + d + r) * 0.3);
  const total = Math.max(1, a + d + hold + r);
  const W = 64, H = 22;
  const x = (ms: number) => (ms / total) * W;
  const pts = [[0, H], [x(a), 2], [x(a + d), H - s * (H - 2)], [x(a + d + hold), H - s * (H - 2)], [W, H]];
  return (
    <svg width={W} height={H} aria-hidden style={{ flexShrink: 0 }}>
      <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={tk.accent.base} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * OSC in. Desktop app: the app listens on UDP itself (Start / Stop, the UDP
 * port, and whether phones on the network may send). Browser: a small bridge
 * has to run on the computer; the chip offers it as a download and shows the
 * one command to start it.
 */
/**
 * The drawn remap curve: x is the source (0..1), y what the mapping sees.
 * Drag across the pad to draw; the faint diagonal is the untouched 1:1 line and
 * the dot is the source's reading right now, so you can see where you are on
 * the curve while you turn the knob.
 */
/**
 * A mapping's meter: the bar is what the control gets (after the curve), the
 * tick is the source's raw reading. With a straight curve they sit together;
 * a drawn or Exp/Log curve pulls them apart, so its effect is visible.
 */
/**
 * A Function source's live raw value, next to its expression field. Follows
 * the preview clock directly (lib/timeTick, the same one ShaderCanvas emits
 * every frame) and writes the span's text on each tick instead of setting
 * React state, so typing a formula never fights a per-frame re-render.
 */
function FnPreview({ expr }: { expr: string }) {
  const tk = useTokens();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => subscribeTimeTick(t => {
    const el = ref.current;
    if (!el) return;
    const { value, error } = fnEval(expr, { t, b: t * FN_BEAT_HZ });
    el.textContent = error ? '—' : value.toFixed(3);
  }), [expr]);
  return <span ref={ref} style={{ minWidth: 52, textAlign: 'right', flexShrink: 0, font: `11px ${fontFamily.mono}`, color: tk.text.faint }}>0.000</span>;
}

/** Where a meter's reading comes from: polled from the source while `live` (only the meter renders as it moves), else `given`. */
export type MeterFeed = { read: () => number; live: boolean; given: number };

/** A mapping meter that reads its own source; with a curve, the bar is the curved value. */
export function FedMeter({ feed, curved = false, curve, curveY, on, margin }: { feed: MeterFeed; curved?: boolean; curve?: PlayMapping['curve']; curveY?: number[]; on: boolean; margin: string }) {
  const meter = usePolledNumber(feed.read, feed.live, 50, feed.given);
  return <MappingMeter input={meter} output={curved ? applyCurve(meter, curve as PlayMapping['curve'], curveY) : meter} on={on} margin={margin} />;
}

/** The curve editor with its live dot, read here. */
export function FedCurvePad({ feed, ...rest }: { feed: MeterFeed } & Omit<ComponentProps<typeof CurvePad>, 'meter'>) {
  const meter = usePolledNumber(feed.read, feed.live, 50, feed.given);
  return <CurvePad {...rest} meter={meter} />;
}

function MappingMeter({ input, output, on, margin }: { input: number; output: number; on: boolean; margin: string }) {
  const tk = useTokens();
  const i = Math.max(0, Math.min(1, input)), o = Math.max(0, Math.min(1, output));
  return (
    <div title={`Bar: what the control gets (${Math.round(o * 100)}% of its range). Tick: the source (${Math.round(i * 100)}%).`} style={{ position: 'relative', height: 5, margin, borderRadius: 2, background: tk.bg.field, overflow: 'hidden' }}>
      <div style={{ width: `${o * 100}%`, height: '100%', background: on ? tk.accent.base : tk.text.disabled, transition: 'width 60ms linear' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${i * 100}% - 1px)`, width: 2, background: on ? tk.text.secondary : tk.text.disabled, opacity: 0.7, transition: 'left 60ms linear' }} />
    </div>
  );
}

function CurvePad({ value, meter, range, onChange, onReset }: { value: number[]; meter: number; range: [number, number]; onChange: (ys: number[]) => void; onReset: () => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const draw = useRef<{ ys: number[]; lastI: number; lastY: number } | null>(null);
  const n = value.length;
  const W = 100, H = 60;
  const pointAt = (e: React.PointerEvent): { i: number; y: number } | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    return { i: Math.round(x * (n - 1)), y };
  };
  const onDown = (e: React.PointerEvent) => {
    const pt = pointAt(e);
    if (!pt) return;
    e.preventDefault();
    const ys = [...value];
    ys[pt.i] = pt.y;
    draw.current = { ys, lastI: pt.i, lastY: pt.y };
    onChange([...ys]);
    // Keep the stroke even when the pointer leaves the pad. Some inputs have no capturable pointer; drawing still works without it.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fall back to window-level tracking below */ }
  };
  useEffect(() => {
    const up = () => { draw.current = null; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);
  const onMove = (e: React.PointerEvent) => {
    const d = draw.current;
    const pt = pointAt(e);
    if (!d || !pt) return;
    // Fill every grid column the pointer crossed since the last event, so a fast stroke has no gaps.
    const from = d.lastI, to = pt.i;
    const step = to >= from ? 1 : -1;
    for (let i = from; ; i += step) {
      const t = to === from ? 1 : (i - from) / (to - from);
      d.ys[i] = d.lastY + (pt.y - d.lastY) * t;
      if (i === to) break;
    }
    d.lastI = to; d.lastY = pt.y;
    onChange([...d.ys]);
  };
  const onUp = () => { draw.current = null; };
  const path = value.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i / (n - 1)) * W},${(1 - y) * H}`).join(' ');
  const mx = Math.max(0, Math.min(1, meter));
  const pos = mx * (n - 1);
  const mi = Math.min(n - 2, Math.floor(pos));
  const my = value[mi] + (value[mi + 1] - value[mi]) * (pos - mi);
  const fmtOut = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, marginTop: 6, marginLeft: 60 }}>
      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        title="Drag to draw the remap: left to right is the source, bottom to top is what the control gets"
        style={{ flex: 1, height: 96, borderRadius: radius.md, background: tk.bg.field, cursor: 'crosshair', touchAction: 'none', position: 'relative', overflow: 'hidden' }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
          <line x1={0} y1={H} x2={W} y2={0} stroke={tk.text.disabled} strokeWidth={0.6} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={tk.accent.base} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {/* Up from the source, across to what the control gets. */}
          <line x1={mx * W} y1={H} x2={mx * W} y2={(1 - my) * H} stroke={tk.text.faint} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={(1 - my) * H} x2={mx * W} y2={(1 - my) * H} stroke={tk.accent.base} strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        </svg>
        <span style={{ position: 'absolute', right: 6, top: 4, color: tk.text.faint, font: `500 10px ${fontFamily.mono}`, pointerEvents: 'none' }}>
          in {mx.toFixed(2)} → {fmtOut(range[0] + (range[1] - range[0]) * my)}
        </span>
        <span style={{ position: 'absolute', left: `calc(${mx * 100}% - 4px)`, top: `calc(${(1 - my) * 100}% - 4px)`, width: 8, height: 8, borderRadius: '50%', background: tk.accent.base, boxShadow: `0 0 0 2px ${tk.bg.panel}`, pointerEvents: 'none' }} />
      </div>
      <IconButton icon="reset" label="Back to a straight line" size="sm" onClick={onReset} style={{ alignSelf: 'flex-start' }} />
    </div>
  );
}

/** The Clock's Follow Live switch (it re-renders as Live connects, so the BPM shows Live's). */
function ClockFollowToggle({ source, onChange }: { source: Extract<PlaySource, { kind: 'clock' }>; onChange: (s: PlaySource) => void }) {
  useLive();
  return (
    <span title="On Ableton Live’s tempo and beat through the Live connector; this BPM while Live isn’t connected" style={{ display: 'inline-flex' }}>
      <Toggle checked={!!source.follow} label="Follow Live" onChange={on => { const n = { ...source }; if (on) n.follow = true; else delete n.follow; onChange(n); }} />
    </span>
  );
}
