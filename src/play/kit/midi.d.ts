import type { MidiLock, PadGridLayoutGeo, PadGridRead, PlayPadGrid } from '../../types/playMidi';

export interface KmLockEntry { v: number; seq: number }
export function kmLockKey(device: string, channel: number, cc: number): string;
export function kmLockRecord(store: Map<string, KmLockEntry>, device: string, channel: number, cc: number, value: number, seq: number): void;
export function kmLockMatches(lock: MidiLock, device: string, channel: number, cc: number): boolean;
export function kmLockRead(store: Map<string, KmLockEntry>, locks: readonly MidiLock[]): number | null;

export function kmNoteName(n: number): string;
export function kmParseNote(text: string): number | null;
export function kmRange(a: number, b: number): [number, number] | null;
export function kmInRange(range: readonly [number, number] | null | undefined, note: number): boolean;
export function kmRangeRead(seq: ArrayLike<number>, vel: ArrayLike<number>, held: { has(n: number): boolean }, range: readonly [number, number] | null | undefined): { note: number; vel: number; gate: boolean };
export function kmNoteUnit(range: readonly [number, number] | null | undefined, note: number): number;

export const KM_LAYOUTS: Record<'push' | 'launchpad' | 'launchpadClassic', PadGridLayoutGeo>;
export function kmLayoutOf(pg: PlayPadGrid): PadGridLayoutGeo;
export function kmPadOf(geo: PadGridLayoutGeo, note: number): { col: number; row: number } | null;
export function kmNoteOfPad(geo: PadGridLayoutGeo, col: number, row: number): number;
export function kmLearnGrid(bottomLeft: number, topRight: number, cols: number, rows: number): PadGridLayoutGeo | null;
export function kmCellsOf(pg: PlayPadGrid, geo: PadGridLayoutGeo, col: number, row: number): [number, number, number, number] | null;

export interface KmCell { held: number; on: number; off: number; peak: number; latched: boolean; vel: number; pressure: number }
export interface KmGrid {
  cols: number;
  rows: number;
  cells: KmCell[];
  pads: Map<string, number[]>;
  last: { col: number; row: number; cx: number; cy: number; vel: number; pressure: number };
  heldPads: number;
}
export function kmGridCreate(cols: number, rows: number): KmGrid;
export function kmGridFit(g: KmGrid | null, pg: PlayPadGrid): KmGrid;
export function kmCellLevel(cell: KmCell, pg: PlayPadGrid, t: number): number;
export function kmGridDown(g: KmGrid, pg: PlayPadGrid, geo: PadGridLayoutGeo, col: number, row: number, vel: number, t: number): [number, number, number, number] | null;
export function kmGridUp(g: KmGrid, pg: PlayPadGrid, col: number, row: number, t: number): void;
export function kmGridPressure(g: KmGrid, col: number, row: number, value: number): void;
export function kmGridReleaseAll(g: KmGrid, pg: PlayPadGrid, t: number): void;
export function kmGridClear(g: KmGrid): void;
export function kmGridMessage(g: KmGrid, pg: PlayPadGrid, status: number, d1: number, d2: number, device: string, t: number): 'down' | 'up' | 'pressure' | null;
export function kmGridFill(g: KmGrid, pg: PlayPadGrid, t: number, rgba: Uint8Array): boolean;
export function kmGridRead(g: KmGrid, pg: PlayPadGrid, read: PadGridRead, col: number, row: number, t: number): number | null;
