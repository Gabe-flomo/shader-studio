/**
 * readerControls.ts — every audio reader is a control.
 *
 * A reader (a dot on the spectrum, types/play.ts AudioReader) comes with a
 * float control 0..1 whose target is `reader:<id>::level` and a mapping
 * reader → control, so the control shows the reader's live value and can
 * drive things as "Another control", in conditions and pairs. The controls
 * sit in a group named after what the readers listen to ("Audio readers ·
 * Live", "Audio readers · Rack 1"). Renaming a reader renames its control;
 * deleting it deletes both; changing the readers' input regroups them.
 *
 * Names: a new reader is named by the band its centre sits in (Sub, Lows,
 * Low mids, Mids, High mids, Highs, Air), numbered when the band already has
 * one ("Lows 2"). Dragging a reader to another band renames it while its name
 * is still one of these (or an old frequency name); a custom name sticks.
 *
 * Pure: record in, record out. The panels call these through setPlay, so each
 * is one undo step.
 */
import type { AudioReader, PlayAudioReaders, PlayControl, PlayMapping, PlayRecord, TriggerSpec } from '../types/play';
import { parseReaderTarget, readerControlTarget } from '../types/play';
import { padsLayerOfInput, videoLayerOfInput } from '../types/playLayers';
import { ENGINE_MASTER, engineRackOfInput } from '../lib/engineSound';
import { formatHz, newReader as newReaderAt } from './audioReaders';
import { playId } from './playControls';

// ── Bands and names ─────────────────────────────────────────────────────────

/** The bands a reader is named after, by the top of each (Hz). */
export const READER_BANDS: ReadonlyArray<{ name: string; below: number }> = [
  { name: 'Sub', below: 60 },
  { name: 'Lows', below: 250 },
  { name: 'Low mids', below: 500 },
  { name: 'Mids', below: 2000 },
  { name: 'High mids', below: 4000 },
  { name: 'Highs', below: 10000 },
  { name: 'Air', below: Infinity },
];

/** "Lows" for 120 Hz, "Air" above 10 kHz. */
export function bandName(hz: number): string {
  return (READER_BANDS.find(b => hz < b.below) ?? READER_BANDS[READER_BANDS.length - 1]).name;
}

const AUTO_RE = new RegExp(`^(${READER_BANDS.map(b => b.name).join('|')})(?: (\\d+))?$`);

/** Is a name one the app gave (a band, numbered or not, or an old frequency name like "120 Hz")? */
export function isAutoReaderName(name: string, hz?: number): boolean {
  if (AUTO_RE.test(name)) return true;
  if (hz !== undefined && name === formatHz(hz)) return true;
  return /^\d+(\.\d+)? (Hz|kHz)$/.test(name);
}

/** The band's name for `hz`, numbered past the readers (other than `skipId`) already named for it: "Lows", "Lows 2". */
export function autoReaderName(hz: number, existing: readonly AudioReader[], skipId?: string): string {
  const band = bandName(hz);
  const taken = new Set(existing.filter(r => r.id !== skipId).map(r => r.name));
  if (!taken.has(band)) return band;
  for (let n = 2; ; n++) if (!taken.has(`${band} ${n}`)) return `${band} ${n}`;
}

/** A new reader at `hz`, named by its band (see audioReaders.ts newReader for the rest). */
export function newReader(id: string, hz: number, topDb: number, existing: readonly AudioReader[] = []): AudioReader {
  const r = newReaderAt(id, hz, topDb, existing);
  return { ...r, name: autoReaderName(r.hz, existing) };
}

// ── Groups ──────────────────────────────────────────────────────────────────

export const READER_GROUP_PREFIX = 'Audio readers · ';

/** What the readers listen to, for the group's name: `songLabel` names an Audio Input node's song (else "Song"). */
export function readerSourceName(p: PlayRecord, songLabel?: (nodeId: string) => string | undefined): string {
  const input = p.audioReaders?.input ?? '';
  if (!input) return 'Live';
  const rack = engineRackOfInput(input);
  if (rack) return rack === ENGINE_MASTER ? 'Master' : p.audioEngine?.racks.find(r => r.id === rack)?.name ?? 'Rack';
  const video = videoLayerOfInput(input);
  if (video) return p.layers.find(l => l.id === video)?.label ?? 'Video';
  const pads = padsLayerOfInput(input);
  if (pads) return p.layers.find(l => l.id === pads)?.label ?? 'Drum pads';
  return songLabel?.(input) ?? 'Song';
}

/** "Audio readers · Live", "Audio readers · Rack 1". */
export function readerGroupName(p: PlayRecord, songLabel?: (nodeId: string) => string | undefined): string {
  return `${READER_GROUP_PREFIX}${readerSourceName(p, songLabel)}`;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/** The control a reader's level shows on. */
export function readerControlOf(p: PlayRecord, readerId: string): PlayControl | undefined {
  return p.controls.find(c => parseReaderTarget(c.target)?.readerId === readerId);
}

/** The reader a control shows, if it is a reader control. */
export function readerOfControl(p: PlayRecord, control: PlayControl): AudioReader | undefined {
  const rt = parseReaderTarget(control.target);
  return rt ? p.audioReaders?.readers.find(r => r.id === rt.readerId) : undefined;
}

/** Readers that have no control yet (an older setup, or a control removed by hand). */
export function readersWithoutControls(p: PlayRecord): AudioReader[] {
  return (p.audioReaders?.readers ?? []).filter(r => !readerControlOf(p, r.id));
}

// ── Record edits ─────────────────────────────────────────────────────────────

const EMPTY: PlayAudioReaders = { input: '', readers: [] };

/** The record with these readers (the key left out when there are none and no input is picked). */
export function withReaders(p: PlayRecord, next: PlayAudioReaders): PlayRecord {
  const out = { ...p };
  if (!next.readers.length && !next.input) delete out.audioReaders; else out.audioReaders = next;
  return out;
}

/** The control and the mapping that show a reader (the mapping is an ordinary reader → control mapping, so websites carry it). */
function controlFor(r: AudioReader, group: string): { control: PlayControl; mapping: PlayMapping } {
  const control: PlayControl = { id: playId('ctl'), target: readerControlTarget(r.id), kind: 'float', label: r.name, min: 0, max: 1, group };
  const mapping: PlayMapping = { id: playId('map'), controlId: control.id, source: { kind: 'reader', readerId: r.id }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true };
  return { control, mapping };
}

/** The record with a reader added, with its control (in the readers' group) and its mapping. */
export function addReader(p: PlayRecord, r: AudioReader, songLabel?: (nodeId: string) => string | undefined): PlayRecord {
  const cfg = p.audioReaders ?? EMPTY;
  const out = withReaders(p, { ...cfg, readers: [...cfg.readers, r] });
  const { control, mapping } = controlFor(r, readerGroupName(p, songLabel));
  return { ...out, controls: [...p.controls, control], mappings: [...p.mappings, mapping] };
}

/** Controls (and mappings) for every reader that lacks one: the one-time offer on an older setup. */
export function addMissingReaderControls(p: PlayRecord, songLabel?: (nodeId: string) => string | undefined): PlayRecord {
  const missing = readersWithoutControls(p);
  if (!missing.length) return p;
  const group = readerGroupName(p, songLabel);
  const made = missing.map(r => controlFor(r, group));
  return { ...p, controls: [...p.controls, ...made.map(m => m.control)], mappings: [...p.mappings, ...made.map(m => m.mapping)] };
}

/**
 * A reader changed: its name follows to its control. A move (`hz`) renames a
 * reader still carrying an automatic name for its new band (a custom name
 * sticks), and the control follows that too.
 */
export function patchReader(p: PlayRecord, id: string, over: Partial<AudioReader>): PlayRecord {
  const cfg = p.audioReaders ?? EMPTY;
  const r = cfg.readers.find(x => x.id === id);
  if (!r) return p;
  let next: AudioReader = { ...r, ...over };
  if (over.hz !== undefined && over.name === undefined && isAutoReaderName(r.name, r.hz) && bandName(over.hz) !== bandName(r.hz)) {
    next = { ...next, name: autoReaderName(over.hz, cfg.readers, id) };
  }
  const out = withReaders(p, { ...cfg, readers: cfg.readers.map(x => (x.id === id ? next : x)) });
  if (next.name === r.name) return out;
  const ctl = readerControlOf(p, id);
  return ctl ? { ...out, controls: out.controls.map(c => (c.id === ctl.id ? { ...c, label: next.name } : c)) } : out;
}

/** Rename a reader (and its control). */
export function renameReader(p: PlayRecord, id: string, name: string): PlayRecord {
  const v = name.trim().slice(0, 60);
  return v ? patchReader(p, id, { name: v }) : p;
}

export const usesReader = (t: TriggerSpec, id: string) => t.on === 'reader' && t.readerId === id;

/**
 * The record without a reader: its control, the mappings on that control and
 * the ones reading it, and every mapping and action that read the reader go too.
 */
export function removeReader(p: PlayRecord, id: string): PlayRecord {
  const cfg = p.audioReaders ?? EMPTY;
  const ctl = readerControlOf(p, id);
  const out = withReaders(p, { ...cfg, readers: cfg.readers.filter(r => r.id !== id) });
  if (ctl) out.controls = p.controls.filter(c => c.id !== ctl.id);
  out.mappings = p.mappings.filter(m => !(
    (m.source.kind === 'reader' && m.source.readerId === id)
    || (m.source.kind === 'trigger' && usesReader(m.source.trigger, id))
    || (ctl && (m.controlId === ctl.id || (m.source.kind === 'control' && m.source.controlId === ctl.id)))
  ));
  if (p.actions) {
    const actions = p.actions.filter(a => !usesReader(a.trigger, id));
    if (actions.length) out.actions = actions; else delete out.actions;
  }
  return out;
}

/** The readers' controls in the group for what they listen to now (after the input changed, or a rack or layer was renamed). */
export function regroupReaderControls(p: PlayRecord, songLabel?: (nodeId: string) => string | undefined): PlayRecord {
  const group = readerGroupName(p, songLabel);
  if (!p.controls.some(c => parseReaderTarget(c.target) && c.group !== group)) return p;
  return { ...p, controls: p.controls.map(c => (parseReaderTarget(c.target) && c.group !== group ? { ...c, group } : c)) };
}

/** The readers listening to `input`, their controls moved to its group. */
export function setReaderInput(p: PlayRecord, input: string, songLabel?: (nodeId: string) => string | undefined): PlayRecord {
  const cfg = p.audioReaders ?? EMPTY;
  if (cfg.input === input) return p;
  return regroupReaderControls(withReaders(p, { ...cfg, input }), songLabel);
}

/** Is the control one a reader drives (its slider follows the sound; there is nothing to set by hand)? */
export const isReaderControl = (c: PlayControl) => parseReaderTarget(c.target) !== null;
