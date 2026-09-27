/**
 * AudioReadersPanel — the live spectrum with readers on it, and the list of
 * readers. Opened from a mapping's source picker (Live audio → Spectrum
 * readers…), from a reader source or trigger, and from the Live audio chip.
 * A modal on a desktop, a sheet on a phone.
 *
 * Each reader is a source ("Reader · Kick", 0..1) and a trigger ("Audio
 * reader crosses"). They listen to the live input, or to the song in one of
 * the graph's Audio Input nodes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { AUDIO_READERS_MAX, type AudioReader, type PlayAudioReaders, type PlayRecord, type TriggerSpec } from '../../types/play';
import { READER_GAIN_MAX, READER_GAIN_MIN, READER_WIDTH_MAX, READER_WIDTH_MIN, formatHz, newReader } from '../../play/audioReaders';
import { audioReaderBank } from '../../lib/audioReaderBank';
import { audioEngine } from '../../lib/audioEngine';
import { liveAudio, type LiveStatus } from '../../lib/liveAudio';
import { Modal } from '../ui/Modal';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { NumberInput } from '../NodeGraph/NumberInput';
import { LiveAudioChip } from './chips';
import { SpectrumView } from './SpectrumView';
import { EMPTY_READERS as EMPTY, removeReader, usesReader, useReadersPanel, withReaders } from './readersPanelUi';

/** Mounted once on the Play page. */
export function AudioReadersHost({ compact }: { compact: boolean }) {
  const open = useReadersPanel(s => s.open);
  return open ? <AudioReadersPanel compact={compact} /> : null;
}

// ── Record edits ─────────────────────────────────────────────────────────────

const PEAK_KEY = 'shader-studio:play:readers-peak';

/** Thresholds of the triggers that listen to each reader, for the meters' ticks. */
function thresholdsByReader(p: PlayRecord): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const add = (t: TriggerSpec) => { if (t.on === 'reader') out.set(t.readerId, [...(out.get(t.readerId) ?? []), t.threshold]); };
  for (const m of p.mappings) if (m.source.kind === 'trigger') add(m.source.trigger);
  for (const a of p.actions ?? []) add(a.trigger);
  return out;
}

/** What deleting a reader also removes: "Delete (and its 2 mappings)", or plain "Delete". */
function deleteLabel(p: PlayRecord, id: string): string {
  const m = p.mappings.filter(x => (x.source.kind === 'reader' && x.source.readerId === id) || (x.source.kind === 'trigger' && usesReader(x.source.trigger, id))).length;
  const a = (p.actions ?? []).filter(x => usesReader(x.trigger, id)).length;
  const parts = [m ? `${m} mapping${m === 1 ? '' : 's'}` : '', a ? `${a} action${a === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.length ? `Delete, with its ${parts.join(' and ')}` : 'Delete';
}

let idSeq = 0;
const readerId = () => `rd${Date.now().toString(36)}${(idSeq++).toString(36)}`;

// ── The panel ────────────────────────────────────────────────────────────────

function AudioReadersPanel({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const nodes = useNodeGraphStore(s => s.nodes);
  const { mappingId, focus, hide } = useReadersPanel();
  const cfg = play.audioReaders ?? EMPTY;
  const readers = cfg.readers;
  const [selected, setSelected] = useState(() => focus || readers[0]?.id || '');
  const [peak, setPeak] = useState(() => { try { return localStorage.getItem(PEAK_KEY) !== '0'; } catch { return true; } });
  const levels = useLevels(readers);
  const ticks = useMemo(() => thresholdsByReader(play), [play]);
  const status = useLiveStatus();

  const edit = (fn: (c: PlayAudioReaders) => PlayAudioReaders) => setPlay(p => withReaders(p, fn(p.audioReaders ?? EMPTY)));
  const patch = (id: string, over: Partial<AudioReader>) => edit(c => ({ ...c, readers: c.readers.map(r => (r.id === id ? { ...r, ...over } : r)) }));
  const add = (hz: number, topDb: number) => {
    if (readers.length >= AUDIO_READERS_MAX) return;
    const r = newReader(readerId(), hz, topDb, readers);
    edit(c => ({ ...c, readers: [...c.readers, r] }));
    setSelected(r.id);
  };
  // Moving a reader renames it too while it still has its frequency for a name.
  const move = (id: string, hz: number, gain: number) => {
    const r = readers.find(x => x.id === id);
    if (!r) return;
    const auto = r.name === formatHz(r.hz);
    patch(id, { hz, gain: Math.max(READER_GAIN_MIN, Math.min(READER_GAIN_MAX, gain)), ...(auto ? { name: formatHz(hz) } : {}) });
  };
  const reorder = (id: string, by: -1 | 1) => edit(c => {
    const i = c.readers.findIndex(r => r.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= c.readers.length) return c;
    const next = [...c.readers];
    [next[i], next[j]] = [next[j], next[i]];
    return { ...c, readers: next };
  });
  const remove = (id: string) => {
    setPlay(p => removeReader(p, id));
    if (selected === id) setSelected(readers.find(r => r.id !== id)?.id ?? '');
  };
  const use = (id: string) => {
    if (!mappingId) return;
    setPlay(p => ({ ...p, mappings: p.mappings.map(m => (m.id === mappingId ? { ...m, source: { kind: 'reader', readerId: id } } : m)) }));
    hide();
  };
  const togglePeak = (on: boolean) => { setPeak(on); try { localStorage.setItem(PEAK_KEY, on ? '1' : '0'); } catch { /* preference only */ } };

  // What they listen to: the live input, or an Audio Input node's song.
  const songs = nodes.filter(n => n.type === 'audioInput').map(n => ({
    id: n.id,
    label: (typeof n.params.label === 'string' && n.params.label.trim()) || 'Audio Input',
  }));
  const inputOptions = [
    { value: '', label: 'Live input (mic, interface, cable)' },
    ...songs.map(s => ({ value: s.id, label: `Song · ${s.label}${audioEngine.isLoaded(s.id) ? ` · ${audioEngine.getFileName(s.id)}` : ' (no song loaded)'}` })),
  ];
  if (cfg.input && !songs.some(s => s.id === cfg.input)) inputOptions.push({ value: cfg.input, label: 'Song · a node no longer in the graph' });
  const song = songs.find(s => s.id === cfg.input);

  const hint = (text: string) => <span style={{ color: tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>{text}</span>;
  const testing = status === 'on' && liveAudio.testing() === 'loop';
  const sourceRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={capStyle(tk)}>Listen to</span>
      <Select ariaLabel="What the readers listen to" value={cfg.input} options={inputOptions} onChange={v => edit(c => ({ ...c, input: v }))} height={28} style={{ flex: compact ? '1 1 100%' : '0 1 280px', minWidth: 0 }} />
      {!cfg.input && <LiveAudioChip readers={false} />}
      {!cfg.input && !testing && (
        <Button size="sm" icon="play" onClick={() => void liveAudio.startTest('loop')} title="A drum loop with a voice, made on the spot: try readers without a mic">Play test loop</Button>
      )}
    </div>
  );
  const sourceNote = cfg.input
    ? !song ? hint('That Audio Input node has been deleted. Pick another input.')
      : !audioEngine.isLoaded(cfg.input) ? hint(`${song.label} has no song loaded. Load one in the Studio, or listen to the live input.`)
        : !audioEngine.isPlaying(cfg.input) ? hint(`${song.label} is stopped. Press play on it in the Studio (or start the clock) to hear it here.`)
          : null
    : status === 'unsupported' ? hint('This browser can’t open an audio input here. The test loop still works.')
      : null;

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: compact ? 0 : '14px 16px 16px' }}>
      {sourceRow}
      {sourceNote}
      <SpectrumView
        readers={readers}
        selected={selected}
        peakHold={peak}
        height={compact ? 200 : 260}
        canAdd={readers.length < AUDIO_READERS_MAX}
        onSelect={setSelected}
        onAdd={add}
        onMove={move}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...capStyle(tk), width: 'auto' }}>Readers · {readers.length} of {AUDIO_READERS_MAX}</span>
        <span style={{ flex: 1 }} />
        <Toggle checked={peak} onChange={togglePeak} label="Peak hold" />
      </div>
      {readers.length === 0 ? (
        <div style={{ padding: '14px 12px', borderRadius: radius.md, background: tk.bg.field, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          Click the spectrum to place a reader at that frequency: low on the left (a kick sits near 60 Hz), high on the right (hi-hats near 8 kHz). Its height sets how loud reads as full.
        </div>
      ) : (
        <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {readers.map((r, i) => (
            <ReaderRow
              key={r.id}
              reader={r}
              level={levels.get(r.id) ?? null}
              thresholds={ticks.get(r.id) ?? []}
              deleteLabel={deleteLabel(play, r.id)}
              selected={r.id === selected}
              first={i === 0}
              last={i === readers.length - 1}
              compact={compact}
              canUse={!!mappingId}
              onSelect={() => setSelected(r.id)}
              onPatch={over => patch(r.id, over)}
              onMove={by => reorder(r.id, by)}
              onRemove={() => remove(r.id)}
              onUse={() => use(r.id)}
            />
          ))}
        </div>
      )}
      <div style={{ color: tk.text.faint, font: `11.5px/1.5 ${fontFamily.ui}` }}>
        Each reader is a source in mappings (Live audio → Reader · name) and a trigger (Audio reader crosses). Drag a dot sideways to retune it, up or down to change how loud reads as full. Saved with the setup; recorded by takes; works on exported websites.
      </div>
    </div>
  );

  if (compact) return <Sheet title="Audio readers" onClose={hide} maxHeight="92dvh">{body}</Sheet>;
  return (
    <Modal title="Audio readers" subtitle="Place dots on the live spectrum: each reads its frequency as 0–1" icon="wave" onClose={hide} width={760} height={680}>
      {body}
    </Modal>
  );
}

const capStyle = (tk: ReturnType<typeof useTokens>): React.CSSProperties => ({
  color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0,
});

/** The live input's status, kept current. */
function useLiveStatus(): LiveStatus {
  const [s, setS] = useState<LiveStatus>(() => liveAudio.getStatus());
  useEffect(() => liveAudio.onStatus(setS), []);
  return s;
}

/** Readers' levels for the rows' meters, about 30 times a second. */
function useLevels(readers: readonly AudioReader[]): Map<string, number | null> {
  const [v, setV] = useState<Map<string, number | null>>(() => new Map());
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      audioReaderBank.update();
      setV(prev => {
        let changed = prev.size !== readers.length;
        const next = new Map<string, number | null>();
        for (const r of readers) {
          const x = audioReaderBank.value(r.id);
          const q = x === null ? null : Math.round(x * 100) / 100;
          next.set(r.id, q);
          if (prev.get(r.id) !== q) changed = true;
        }
        return changed ? next : prev;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [readers]);
  return v;
}

// ── One reader ───────────────────────────────────────────────────────────────

const hex = (c: readonly number[]) => `#${c.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

function ReaderRow({ reader: r, level, thresholds, deleteLabel, selected, first, last, compact, canUse, onSelect, onPatch, onMove, onRemove, onUse }: {
  reader: AudioReader;
  level: number | null;
  thresholds: number[];
  deleteLabel: string;
  selected: boolean;
  first: boolean;
  last: boolean;
  compact: boolean;
  canUse: boolean;
  onSelect: () => void;
  onPatch: (over: Partial<AudioReader>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onUse: () => void;
}) {
  const tk = useTokens();
  const [name, setName] = useState(r.name);
  // Renamed elsewhere (a drag renames a reader named by its frequency): show the new name.
  const [shown, setShown] = useState(r.name);
  if (shown !== r.name) { setShown(r.name); setName(r.name); }
  const num: React.CSSProperties = { width: 56, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' };
  const unit = (t: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{t}</span>;
  const field = (label: string, input: React.ReactNode, u: string, title: string) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}` }}>{label}</span>{input}{unit(u)}
    </span>
  );
  const colour = hex(r.colour);
  const commitName = () => { const v = name.trim(); if (v && v !== r.name) onPatch({ name: v.slice(0, 60) }); else setName(r.name); };
  const pct = level === null ? null : Math.round(level * 100);
  return (
    <div
      role="listitem"
      onPointerDown={onSelect}
      style={{
        borderRadius: radius.md, padding: '6px 8px', background: tk.bg.panel,
        boxShadow: selected ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <label title="Colour" style={{ position: 'relative', width: 18, height: 18, borderRadius: 9, background: colour, flexShrink: 0, cursor: 'pointer', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.15)}` }}>
          <input type="color" aria-label={`${r.name} colour`} value={colour} onChange={e => onPatch({ colour: fromHex(e.target.value) })} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </label>
        <Field aria-label="Reader name" value={name} onChange={e => setName(e.target.value)} onBlur={commitName} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(r.name); (e.target as HTMLInputElement).blur(); } }} height={28} style={{ width: compact ? 110 : 150, flexShrink: 0 }} />
        <ReaderMeter level={level} thresholds={thresholds} colour={colour} />
        <span style={{ width: 34, textAlign: 'right', font: `600 11px ${fontFamily.mono}`, color: pct === null ? tk.text.faint : tk.text.primary, flexShrink: 0 }}>{pct === null ? '–' : `${pct}%`}</span>
        {canUse && <Button size="sm" variant="primary" onClick={onUse} title="Make this reader the mapping's source">Use</Button>}
        {!compact && <>
          <IconButton icon="chevU" label="Move up" size="sm" disabled={first} onClick={() => onMove(-1)} />
          <IconButton icon="chevD" label="Move down" size="sm" disabled={last} onClick={() => onMove(1)} />
        </>}
        <IconButton icon="trash" label={deleteLabel} size="sm" tone="danger" onClick={onRemove} />
      </div>
      {selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px 12px', flexWrap: 'wrap', marginTop: 8, paddingLeft: 26 }}>
          {field('Freq', <NumberInput value={Math.round(r.hz)} min={20} max={20000} step={1} title="Centre frequency" onCommit={n => onPatch({ hz: Math.max(20, Math.min(20000, n)), ...(r.name === formatHz(r.hz) ? { name: formatHz(Math.max(20, Math.min(20000, n))) } : {}) })} style={{ ...num, width: 62 }} />, 'Hz', 'Centre frequency, 20–20,000 Hz')}
          {field('Width', <NumberInput value={Math.round(r.width * 100) / 100} min={READER_WIDTH_MIN} max={READER_WIDTH_MAX} step={0.05} title="Bandwidth in octaves" onCommit={n => onPatch({ width: Math.max(READER_WIDTH_MIN, Math.min(READER_WIDTH_MAX, n)) })} style={num} />, 'oct', 'Bandwidth in octaves: 0.33 is a third of an octave; wider reads more of the neighbourhood')}
          {field('Gain', <NumberInput value={Math.round(r.gain)} min={READER_GAIN_MIN} max={READER_GAIN_MAX} step={1} title="Gain in dB" onCommit={n => onPatch({ gain: Math.max(READER_GAIN_MIN, Math.min(READER_GAIN_MAX, n)) })} style={num} />, 'dB', 'More gain: quieter sounds read as full (the dot sits lower)')}
          {field('Attack', <NumberInput value={r.attack} min={0} max={2000} step={5} title="Rise time, ms" onCommit={n => onPatch({ attack: Math.max(0, Math.min(2000, n)) })} style={num} />, 'ms', 'How fast it rises')}
          {field('Release', <NumberInput value={r.release} min={0} max={5000} step={10} title="Fall time, ms" onCommit={n => onPatch({ release: Math.max(0, Math.min(5000, n)) })} style={num} />, 'ms', 'How fast it falls back')}
          {compact && <span style={{ display: 'inline-flex', gap: 2, marginLeft: 'auto' }}>
            <IconButton icon="chevU" label="Move up" size="sm" disabled={first} onClick={() => onMove(-1)} />
            <IconButton icon="chevD" label="Move down" size="sm" disabled={last} onClick={() => onMove(1)} />
          </span>}
        </div>
      )}
    </div>
  );
}

/** A reader's level now, with a tick at each threshold a trigger listens for. */
export function ReaderMeter({ level, thresholds, colour, height = 8 }: { level: number | null; thresholds: number[]; colour: string; height?: number }) {
  const tk = useTokens();
  const v = level ?? 0;
  const over = thresholds.some(t => v >= t);
  return (
    <div
      role="meter" aria-label="Level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level ?? undefined}
      title={thresholds.length ? `Level now; ticks: the thresholds triggers fire at (${thresholds.map(t => `${Math.round(t * 100)}%`).join(', ')})` : 'Level now'}
      style={{ position: 'relative', flex: 1, minWidth: 48, height, borderRadius: height / 2, background: tk.bg.field, overflow: 'hidden' }}
    >
      <div style={{ width: `${v * 100}%`, height: '100%', background: level === null ? tk.text.disabled : colour, opacity: over ? 1 : 0.8, transition: 'width 50ms linear' }} />
      {thresholds.map((t, i) => (
        <span key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${t * 100}% - 1px)`, width: 2, background: tk.text.primary, opacity: 0.55 }} />
      ))}
    </div>
  );
}
