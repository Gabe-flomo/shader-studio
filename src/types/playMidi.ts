/**
 * playMidi.ts — the Play record's MIDI extras: knob locks and note ranges on
 * a MIDI source, and the pad grid (a Push or Launchpad's pads as the cells of
 * a grid shader). Types, defaults and parsers; the reading itself is in
 * play/kit/midi.js, shared with exported pages.
 */

/** A CC mapping bound to one control: its device ('' any), channel (0 any) and CC number. */
export interface MidiLock { device: string; channel: number; cc: number }

/** Most locks a mapping keeps. */
export const MIDI_LOCKS_MAX = 16;

/** A pad layout as a line: pad (col, row) sends origin + col·colStep + row·rowStep, row 0 at the bottom. */
export interface PadGridLayoutGeo { origin: number; colStep: number; rowStep: number; cols: number; rows: number }

export type PadGridLayout = 'push' | 'launchpad' | 'launchpadClassic' | 'learned';
export type PadGridMode = 'hold' | 'latch' | 'decay';
/** What a Pad grid source reads: the last pad's column / row (0..1 across the pads), its velocity, pressure, any pad held, or one cell's level. */
export type PadGridRead = 'x' | 'y' | 'velocity' | 'pressure' | 'gate' | 'cell';

export const PAD_GRID_LAYOUTS: { value: PadGridLayout; label: string; title: string }[] = [
  { value: 'push', label: 'Push 2 / 3', title: 'Ableton Push 2 or 3 in User mode: note 36 bottom-left to 99 top-right' },
  { value: 'launchpad', label: 'Launchpad (programmer)', title: 'Launchpad X, Mini MK3, Pro MK3 or MK2 in programmer mode: 11 bottom-left to 88 top-right' },
  { value: 'launchpadClassic', label: 'Launchpad (classic)', title: 'The original Launchpad, S or Mini MK1/MK2 X-Y layout: 0 top-left, 16 notes a row' },
  { value: 'learned', label: 'Learned', title: 'Tap the bottom-left pad, then the top-right one' },
];

export const PAD_GRID_MODES: { value: PadGridMode; label: string; title: string }[] = [
  { value: 'hold', label: 'Hold', title: 'A cell is lit while its pad is held, then fades over Release' },
  { value: 'latch', label: 'Latch', title: 'Each hit toggles the cell on or off (fading out over Release)' },
  { value: 'decay', label: 'Decay', title: 'Each hit lights the cell, which fades over Release whether held or not' },
];

/** The pad grid: which controller, where its pads land on the shader's cells, and how a cell answers a hit. */
export interface PlayPadGrid {
  layout: PadGridLayout;
  /** The learned layout ('learned' only). */
  learned?: PadGridLayoutGeo;
  /** Only this input ('' any), and this channel (0 any). */
  device: string;
  channel: number;
  /** The shader's grid, in cells (1..32 each way). */
  cols: number;
  rows: number;
  /** Cells to move the pads by, and cells per pad. */
  offsetX: number;
  offsetY: number;
  scale: number;
  flipX: boolean;
  flipY: boolean;
  mode: PadGridMode;
  /** Seconds a cell takes to fade out. */
  release: number;
  /** A harder hit lights a cell brighter (off: every hit is full). */
  velocity: boolean;
  /** Light the controller's pads back over MIDI out (where the browser offers it). */
  light: boolean;
}

export const PAD_GRID_MAX = 32;

export const DEFAULT_PAD_GRID: PlayPadGrid = {
  layout: 'push', device: '', channel: 0, cols: 8, rows: 8, offsetX: 0, offsetY: 0, scale: 1, flipX: false, flipY: false,
  mode: 'hold', release: 0.4, velocity: true, light: false,
};

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v: unknown, d: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(num(v, d))));

export function parseMidiLocks(raw: unknown): MidiLock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MidiLock[] = [];
  const seen = new Set<string>();
  for (const x of raw.slice(0, MIDI_LOCKS_MAX)) {
    if (!x || typeof x !== 'object') continue;
    const l = x as Record<string, unknown>;
    const lock = { device: typeof l.device === 'string' ? l.device.slice(0, 120) : '', channel: int(l.channel, 0, 0, 16), cc: int(l.cc, -1, -1, 127) };
    const key = `${lock.device}\u0000${lock.channel}\u0000${lock.cc}`;
    if (lock.cc < 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(lock);
  }
  return out.length ? out : undefined;
}

export function parseNoteRange(raw: unknown): [number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== 'number' || typeof raw[1] !== 'number') return undefined;
  const lo = int(raw[0], 0, 0, 127), hi = int(raw[1], 127, 0, 127);
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  return a === 0 && b === 127 ? undefined : [a, b];
}

function parseGeo(raw: unknown): PadGridLayoutGeo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as Record<string, unknown>;
  const geo = { origin: int(g.origin, 0, -1024, 1024), colStep: int(g.colStep, 1, -256, 256), rowStep: int(g.rowStep, 8, -256, 256), cols: int(g.cols, 8, 1, PAD_GRID_MAX), rows: int(g.rows, 8, 1, PAD_GRID_MAX) };
  return geo.colStep === 0 || geo.rowStep === 0 ? undefined : geo;
}

export function parsePadGrid(raw: unknown): PlayPadGrid | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const d = DEFAULT_PAD_GRID;
  const learned = parseGeo(p.learned);
  let layout = PAD_GRID_LAYOUTS.some(l => l.value === p.layout) ? (p.layout as PadGridLayout) : d.layout;
  if (layout === 'learned' && !learned) layout = d.layout;
  const out: PlayPadGrid = {
    layout,
    device: typeof p.device === 'string' ? p.device.slice(0, 120) : '',
    channel: int(p.channel, 0, 0, 16),
    cols: int(p.cols, d.cols, 1, PAD_GRID_MAX),
    rows: int(p.rows, d.rows, 1, PAD_GRID_MAX),
    offsetX: int(p.offsetX, 0, -PAD_GRID_MAX, PAD_GRID_MAX),
    offsetY: int(p.offsetY, 0, -PAD_GRID_MAX, PAD_GRID_MAX),
    scale: Math.max(0.25, Math.min(8, num(p.scale, 1))),
    flipX: p.flipX === true,
    flipY: p.flipY === true,
    mode: PAD_GRID_MODES.some(m => m.value === p.mode) ? (p.mode as PadGridMode) : d.mode,
    release: Math.max(0, Math.min(10, num(p.release, d.release))),
    velocity: p.velocity !== false,
    light: p.light === true,
  };
  if (learned) out.learned = learned;
  return out;
}

export const PAD_GRID_READS: { value: PadGridRead; label: string; title: string }[] = [
  { value: 'x', label: 'Pad X', title: 'The last pad’s column, 0 at the left to 1 at the right' },
  { value: 'y', label: 'Pad Y', title: 'The last pad’s row, 0 at the bottom to 1 at the top' },
  { value: 'velocity', label: 'Velocity', title: 'How hard the last pad was hit' },
  { value: 'pressure', label: 'Pressure', title: 'Aftertouch on the last pad (0 once let go)' },
  { value: 'gate', label: 'Gate', title: '1 while any pad is held' },
  { value: 'cell', label: 'Cell', title: 'One cell’s level (hold, latch or decay), by column and row' },
];
