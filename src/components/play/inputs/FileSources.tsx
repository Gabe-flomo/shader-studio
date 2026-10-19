/**
 * FileSources — the setup's MIDI file and pad grid as cards in the Sources
 * column (Play audit P10). They used to be pages of their own under Controls
 * (the "MIDI file" and "Pad grid" sub-tabs); now they are source kinds: "+ Map"
 * adds one (mapPicker.ts), and its card sits with the other sources, folded to
 * one line until opened (remembered per card, like a source's).
 *
 * The cards hold the same editors as before (MidiFileCard, PadGridCard), so
 * MIDI-file playback and the pad grid behave exactly as they did; the record
 * keeps `midiFile` and `padGrid` as they are, so saved setups show theirs here.
 */
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { midiEngine } from '../../../lib/midiEngine';
import { formatDuration } from '../../../lib/midiFile';
import { kmLayoutOf } from '../../../play/kit/midi.js';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayMidiFile } from '../../../types/play';
import type { PlayPadGrid } from '../../../types/playMidi';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { ProLock } from '../../account/ProSheet';
import { MidiFileCard } from '../MidiFileCard';
import { PadGridCard } from '../PadGridCard';
import { sourceFoldKey } from '../mappingGroups';
import { usePlayUi } from '../playUi';

/** The fold keys of the two cards (playUi's `folded`, beside the sources'). */
export const MIDI_FILE_FOLD = sourceFoldKey('midi-file');
export const PAD_GRID_FOLD = sourceFoldKey('pad-grid');

/** "Song · 2:31 · loops" — the folded MIDI file card's line. */
export function midiFileSummary(f: Pick<PlayMidiFile, 'name' | 'loop' | 'offset'>, duration?: number): string {
  return [f.name, duration ? formatDuration(duration) : null, f.loop ? 'loops' : null, f.offset ? `starts at ${f.offset} s` : null].filter(Boolean).join(' · ');
}

/** "8×8 pads → 8×8 cells · Hold" — the folded pad grid card's line. */
export function padGridSummary(pg: PlayPadGrid): string {
  const geo = kmLayoutOf(pg);
  return `${geo.cols}×${geo.rows} pads → ${pg.cols}×${pg.rows} cells · ${pg.mode[0].toUpperCase()}${pg.mode.slice(1)}`;
}

function FileSourceCard({ kind, icon, title, summary, foldKey, children }: { kind: string; icon: IconName; title: string; summary: string; foldKey: string; children: React.ReactNode }) {
  const tk = useTokens();
  const open = usePlayUi(s => s.folded[foldKey] === false);
  const toggle = () => usePlayUi.getState().toggleFold(foldKey, open);
  return (
    <div data-file-source={kind} data-folded={open ? undefined : ''} style={{ marginTop: 6, padding: open ? '8px 10px 4px' : '6px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
      <button type="button" onClick={toggle} aria-expanded={open} title={open ? 'Collapse' : 'Expand'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0, padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint, flexShrink: 0, width: 16 }} />
        <Icon name={icon} size={14} style={{ color: tk.accent.base, flexShrink: 0 }} />
        <span style={{ font: `600 12px ${fontFamily.ui}`, flexShrink: 0 }}>{title}</span>
        {!open && <span style={{ color: tk.text.secondary, font: `500 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{summary}</span>}
      </button>
      {open && children}
    </div>
  );
}

/** The setup's MIDI file, when it has one (added from "+ Map" → MIDI file…). */
export function MidiFileSource() {
  const midiFile = useNodeGraphStore(s => s.play.midiFile);
  if (!midiFile) return null;
  const info = midiEngine.fileInfo();
  return (
    <FileSourceCard kind="midi-file" icon="wave" title="MIDI file" foldKey={MIDI_FILE_FOLD} summary={midiFileSummary(midiFile, info && 'duration' in info ? info.duration : undefined)}>
      <ProLock feature="play.midiFile" style={{ display: 'block', width: '100%' }}><MidiFileCard bare /></ProLock>
    </FileSourceCard>
  );
}

/** The setup's pad grid, when it has one (added from "+ Map" → Pad grid). */
export function PadGridSource() {
  const pg = useNodeGraphStore(s => s.play.padGrid);
  if (!pg) return null;
  return (
    <FileSourceCard kind="pad-grid" icon="grid" title="Pad grid" foldKey={PAD_GRID_FOLD} summary={padGridSummary(pg)}>
      <ProLock feature="play.sources" style={{ display: 'block', width: '100%' }}><PadGridCard bare /></ProLock>
    </FileSourceCard>
  );
}

/** Both, in the order the picker lists them. */
export function FileSources() {
  return <><MidiFileSource /><PadGridSource /></>;
}

/** Does the setup have a MIDI file or a pad grid (cards in the Sources column)? */
export function hasFileSources(p: { midiFile?: unknown; padGrid?: unknown }): boolean {
  return !!(p.midiFile || p.padGrid);
}
