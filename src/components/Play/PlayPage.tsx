import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Segmented, Toggle } from '../ui/Choice';
import { Popover } from '../ui/Popover';
import { RulerSlider } from '../ui/RulerSlider';
import { collectPlayTargets, type PlayTargetInfo } from '../../lib/playTargets';
import { midiEngine, midiNoteName, type MidiEvent } from '../../lib/midiEngine';
import { toneSynth } from '../../lib/toneSynth';
import { playMapper } from '../../lib/playMapper';
import { describeSource, playTargetKey, sourceRange, type PlayControl, type PlayMapping, type PlaySource, type PlayTarget } from '../../types/play';

let idCounter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/** Source kinds offered in the mapping row. */
const SOURCE_OPTIONS = [
  { value: 'midi:velocity', label: 'MIDI velocity' },
  { value: 'midi:note',     label: 'MIDI note' },
  { value: 'midi:gate',     label: 'MIDI gate' },
  { value: 'midi:bend',     label: 'Pitch bend' },
  { value: 'midi:cc',       label: 'MIDI CC' },
  { value: 'mouse:x',       label: 'Mouse X' },
  { value: 'mouse:y',       label: 'Mouse Y' },
  { value: 'key',           label: 'Key held' },
] as const;

function sourceToOption(s: PlaySource): string {
  if (s.kind === 'midi') return `midi:${s.channel}`;
  if (s.kind === 'mouse') return `mouse:${s.axis}`;
  return 'key';
}

function optionToSource(v: string, prev: PlaySource): PlaySource {
  if (v === 'key') return { kind: 'key', code: prev.kind === 'key' ? prev.code : 'Space' };
  const [kind, sub] = v.split(':');
  if (kind === 'mouse') return { kind: 'mouse', axis: sub === 'y' ? 'y' : 'x' };
  const midiChannel = prev.kind === 'midi' ? prev.midiChannel : undefined;
  return { kind: 'midi', channel: sub as Extract<PlaySource, { kind: 'midi' }>['channel'], ...(sub === 'cc' ? { cc: prev.kind === 'midi' && prev.cc !== undefined ? prev.cc : 1 } : {}), ...(midiChannel ? { midiChannel } : {}) };
}

/**
 * Play: perform the current graph. The picture stays in the preview column;
 * this page is the instrument panel (exposed params as sliders) and the
 * mappings drawer (live inputs → params). Nothing here edits the graph.
 */
export function PlayPage() {
  const tk = useTokens();
  const nodes = useNodeGraphStore(s => s.nodes);
  const paramBindings = useNodeGraphStore(s => s.paramBindings);
  const play = useNodeGraphStore(s => s.play);
  const updatePlay = useNodeGraphStore(s => s.updatePlay);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);

  const targets = useMemo(() => collectPlayTargets(nodes, paramBindings), [nodes, paramBindings]);
  const targetByKey = useMemo(() => new Map(targets.map(t => [`${t.nodeId}::${t.paramKey}`, t])), [targets]);

  // ── Inputs: arm the piano keys and key mappings while the page is up ──
  const [midiStatus, setMidiStatus] = useState(() => midiEngine.webMidi());
  const [keys, setKeys] = useState(() => midiEngine.keyboard().enabled);
  const [sound, setSound] = useState(() => toneSynth.isEnabled());
  const [last, setLast] = useState('');
  useEffect(() => {
    midiEngine.armKeyboard('play');
    playMapper.setKeysEnabled(true);
    void midiEngine.connectWebMidi().then(() => setMidiStatus(midiEngine.webMidi()));
    const offMidi = midiEngine.subscribe((e: MidiEvent) => {
      if (e.kind === 'devices') setMidiStatus(midiEngine.webMidi());
      else if (e.kind === 'noteOn') setLast(`${midiNoteName(e.note)} · vel ${e.velocity}`);
      else if (e.kind === 'cc') setLast(`CC ${e.cc} · ${e.value}`);
      else if (e.kind === 'bend') setLast(`bend ${e.value.toFixed(2)}`);
    });
    const offSound = toneSynth.subscribe(setSound);
    return () => { offMidi(); offSound(); midiEngine.disarmKeyboard('play'); playMapper.setKeysEnabled(false); };
  }, []);

  // ── Controls ──
  const addRef = useRef<HTMLSpanElement>(null);
  const [picker, setPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const usedControlKeys = useMemo(() => new Set(play.controls.map(c => playTargetKey(c.target))), [play.controls]);
  const pickable = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return targets.filter(t => !usedControlKeys.has(`${t.nodeId}::${t.paramKey}`) && (!q || t.label.toLowerCase().includes(q)));
  }, [targets, usedControlKeys, pickerQuery]);

  const addControl = (t: PlayTargetInfo) => {
    updatePlay(p => ({ ...p, controls: [...p.controls, { id: newId('ctl'), target: { nodeId: t.nodeId, paramKey: t.paramKey }, min: t.min, max: t.max }] }));
    setPicker(false);
    setPickerQuery('');
  };
  const removeControl = (id: string) => updatePlay(p => ({ ...p, controls: p.controls.filter(c => c.id !== id) }));

  // ── Mappings ──
  const addMapping = () => {
    const first = targets[0];
    if (!first) return;
    const source: PlaySource = { kind: 'midi', channel: 'velocity' };
    const [inMin, inMax] = sourceRange(source);
    const m: PlayMapping = { id: newId('map'), source, target: { nodeId: first.nodeId, paramKey: first.paramKey }, inMin, inMax, outMin: first.min, outMax: first.max, curve: 'linear', smoothMs: 30, enabled: true };
    updatePlay(p => ({ ...p, mappings: [...p.mappings, m] }));
  };
  const patchMapping = (id: string, patch: Partial<PlayMapping>) =>
    updatePlay(p => ({ ...p, mappings: p.mappings.map(m => m.id === id ? { ...m, ...patch } : m) }));
  const removeMapping = (id: string) => updatePlay(p => ({ ...p, mappings: p.mappings.filter(m => m.id !== id) }));

  const section: CSSProperties = { padding: '14px 18px', borderBottom: `1px solid ${tk.border.subtle}` };
  const caps: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint };
  const card: CSSProperties = { background: tk.bg.panel, border: `1px solid ${tk.border.default}`, borderRadius: radius.card, padding: '10px 12px', boxShadow: tk.shadow.card };

  const devices = midiStatus.inputs.length
    ? midiStatus.inputs.join(', ')
    : midiStatus.status === 'ready' ? 'No MIDI devices'
    : midiStatus.status === 'requesting' ? 'Connecting MIDI…'
    : midiStatus.status === 'denied' ? 'MIDI access denied'
    : 'No Web MIDI in this browser';

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', background: tk.bg.app, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      {/* Header: what's feeding the instrument */}
      <div style={{ ...section, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: tk.bg.panel }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 160 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Play</span>
          <span style={{ color: tk.text.muted }}>Perform the graph. Nothing here edits it.</span>
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ color: midiStatus.inputs.length ? tk.text.secondary : tk.text.faint }} title={devices}>{devices}</span>
        <span style={{ fontFamily: 'monospace', color: last ? tk.status.success : tk.text.faint, minWidth: 100 }}>{last || 'no MIDI yet'}</span>
        <Toggle checked={keys} onChange={v => { midiEngine.setKeyboardEnabled(v); setKeys(v); }} label="Piano keys" />
        <Toggle checked={sound} onChange={v => toneSynth.setEnabled(v)} label="Sound" />
      </div>

      {/* Controls */}
      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={caps}>Controls</span>
          <span style={{ flex: 1 }} />
          <span ref={addRef} style={{ display: 'inline-flex' }}>
            <Button size="sm" icon="plus" onClick={() => setPicker(v => !v)} disabled={targets.length === 0}>Add control</Button>
          </span>
          {picker && (
            <Popover anchorRef={addRef} onClose={() => setPicker(false)} align="end" width={300} padding={8}>
              <Field autoFocus placeholder="Search params…" value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} height={30} style={{ marginBottom: 6 }} />
              <div style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {pickable.length === 0 && <span style={{ color: tk.text.faint, padding: 6 }}>No live float params left to add.</span>}
                {pickable.map(t => (
                  <button key={`${t.nodeId}::${t.paramKey}`} type="button" onClick={() => addControl(t)}
                    style={{ textAlign: 'left', background: 'none', border: 0, padding: '6px 8px', borderRadius: radius.md, color: tk.text.primary, cursor: 'pointer', font: 'inherit' }}
                    onMouseEnter={e => (e.currentTarget.style.background = tk.bg.hover)} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                    <span style={{ color: tk.text.muted }}>{t.nodeLabel} · </span>{t.paramLabel}
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>
        {play.controls.length === 0 ? (
          <div style={{ color: tk.text.faint, padding: '18px 0' }}>
            {targets.length === 0
              ? 'This graph has no live float params yet. Add nodes with sliders in Studio, then expose them here.'
              : 'No controls yet. Add the sliders you want to perform with.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {play.controls.map(c => <ControlCard key={c.id} control={c} info={targetByKey.get(playTargetKey(c.target))} nodes={nodes}
              onChange={v => updateNodeParams(c.target.nodeId, { [c.target.paramKey]: v }, { immediate: true })}
              onRemove={() => removeControl(c.id)} style={card} />)}
          </div>
        )}
      </div>

      {/* Mappings */}
      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={caps}>Mappings</span>
          <span style={{ color: tk.text.faint }}>source → param, with range, curve and smoothing</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" icon="plus" onClick={addMapping} disabled={targets.length === 0}>Add mapping</Button>
        </div>
        {play.mappings.length === 0 ? (
          <div style={{ color: tk.text.faint, padding: '18px 0' }}>No mappings yet. Map MIDI velocity, a CC knob, the mouse or a key onto any live param.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {play.mappings.map(m => (
              <MappingRow key={m.id} mapping={m} targets={targets} onChange={patch => patchMapping(m.id, patch)} onRemove={() => removeMapping(m.id)} style={card} />
            ))}
          </div>
        )}
      </div>

      <div style={{ ...section, borderBottom: 0, color: tk.text.faint, lineHeight: 1.5 }}>
        Piano keys: A–L rows play two octaves, Z/X shift the octave, C/V change velocity. Keys only play while this page is open or a MIDI Input node is selected in Studio.
      </div>
    </div>
  );
}

// ─── Control card ─────────────────────────────────────────────────────────────

function ControlCard({ control, info, nodes, onChange, onRemove, style }: {
  control: PlayControl;
  info: PlayTargetInfo | undefined;
  nodes: ReturnType<typeof useNodeGraphStore.getState>['nodes'];
  onChange: (v: number) => void;
  onRemove: () => void;
  style: CSSProperties;
}) {
  const tk = useTokens();
  const node = nodes.find(n => n.id === control.target.nodeId);
  const raw = node?.params[control.target.paramKey];
  const value = typeof raw === 'number' ? raw : info?.value ?? 0;
  const label = control.label ?? info?.label ?? `${control.target.nodeId} · ${control.target.paramKey}`;
  return (
    <div style={{ ...style, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="close" label="Remove control" size="sm" onClick={onRemove} />
      </div>
      {info ? (
        <RulerSlider value={value} min={control.min} max={control.max} step={info.step} onChange={onChange} ariaLabel={label} />
      ) : (
        <span style={{ color: tk.status.warningText }}>This param is no longer live (node removed, or the param is baked).</span>
      )}
    </div>
  );
}

// ─── Mapping row ──────────────────────────────────────────────────────────────

function MappingRow({ mapping: m, targets, onChange, onRemove, style }: {
  mapping: PlayMapping;
  targets: PlayTargetInfo[];
  onChange: (patch: Partial<PlayMapping>) => void;
  onRemove: () => void;
  style: CSSProperties;
}) {
  const tk = useTokens();
  const [learning, setLearning] = useState(false);
  const targetOptions = useMemo(() => targets.map(t => ({ value: `${t.nodeId}::${t.paramKey}`, label: t.label })), [targets]);
  const targetKey = playTargetKey(m.target);
  const targetKnown = targets.some(t => `${t.nodeId}::${t.paramKey}` === targetKey);

  // Learn: the next MIDI message (or key, for key sources) becomes the source.
  useEffect(() => {
    if (!learning) return;
    const done = (source: PlaySource) => {
      const [inMin, inMax] = sourceRange(source);
      onChange({ source, inMin, inMax });
      setLearning(false);
    };
    if (m.source.kind === 'key') {
      const onKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); done({ kind: 'key', code: e.code }); };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }
    return midiEngine.subscribe((e: MidiEvent) => {
      if (e.kind === 'cc') done({ kind: 'midi', channel: 'cc', cc: e.cc, midiChannel: e.channel });
      else if (e.kind === 'noteOn') done({ kind: 'midi', channel: m.source.kind === 'midi' && m.source.channel !== 'cc' ? m.source.channel : 'velocity', midiChannel: e.channel });
      else if (e.kind === 'bend') done({ kind: 'midi', channel: 'bend', midiChannel: e.channel });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learning]);

  const setTarget = (v: string) => {
    const t = targets.find(x => `${x.nodeId}::${x.paramKey}` === v);
    if (!t) return;
    onChange({ target: { nodeId: t.nodeId, paramKey: t.paramKey } as PlayTarget, outMin: t.min, outMax: t.max });
  };
  const numField = (label: string, value: number, key: keyof Pick<PlayMapping, 'inMin' | 'inMax' | 'outMin' | 'outMax' | 'smoothMs'>, width = 64) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: tk.text.muted }}>
      {label}
      <Field type="number" mono height={28} value={value} step="any" style={{ width }} onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange({ [key]: n }); }} />
    </label>
  );

  return (
    <div style={{ ...style, display: 'flex', flexDirection: 'column', gap: 8, opacity: m.enabled ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Select ariaLabel="Source" value={sourceToOption(m.source)} options={SOURCE_OPTIONS} height={28} onChange={v => {
          const source = optionToSource(v, m.source);
          const [inMin, inMax] = sourceRange(source);
          onChange({ source, inMin, inMax });
        }} />
        {m.source.kind === 'midi' && m.source.channel === 'cc' && (
          <Field type="number" mono height={28} min={0} max={127} value={m.source.cc ?? 1} style={{ width: 56 }}
            onChange={e => onChange({ source: { ...m.source, kind: 'midi', cc: Math.max(0, Math.min(127, Math.round(parseFloat(e.target.value) || 0))) } as PlaySource })} />
        )}
        {m.source.kind === 'key' && <span style={{ fontFamily: 'monospace', color: tk.text.secondary }}>{m.source.code}</span>}
        {m.source.kind === 'midi' && m.source.midiChannel ? <span style={{ color: tk.text.faint }}>ch {m.source.midiChannel}</span> : null}
        <Button size="sm" variant={learning ? 'primary' : 'secondary'} onClick={() => setLearning(v => !v)}>{learning ? 'Listening…' : 'Learn'}</Button>
        <span style={{ color: tk.text.faint }}>→</span>
        <Select ariaLabel="Target param" value={targetKey} options={targetKnown ? targetOptions : [{ value: targetKey, label: `${targetKey} (missing)` }, ...targetOptions]} height={28} onChange={setTarget} />
        <span style={{ flex: 1 }} />
        <Toggle checked={m.enabled} onChange={enabled => onChange({ enabled })} label="On" />
        <IconButton icon="close" label="Remove mapping" size="sm" onClick={onRemove} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: tk.text.faint }}>{describeSource(m.source)}</span>
        {numField('in', m.inMin, 'inMin')}{numField('to', m.inMax, 'inMax')}
        <span style={{ color: tk.text.faint }}>→</span>
        {numField('out', m.outMin, 'outMin')}{numField('to', m.outMax, 'outMax')}
        <Segmented size="sm" ariaLabel="Curve" value={m.curve} onChange={curve => onChange({ curve })} options={[{ value: 'linear', label: 'Lin' }, { value: 'exp', label: 'Exp' }, { value: 'log', label: 'Log' }]} />
        {numField('smooth ms', m.smoothMs, 'smoothMs', 56)}
      </div>
    </div>
  );
}
