import { describe, it, expect } from 'vitest';
import {
  KM_LAYOUTS, kmCellLevel, kmCellsOf, kmGridCreate, kmGridDown, kmGridFill, kmGridMessage, kmGridRead, kmGridUp, kmInRange, kmLayoutOf, kmLearnGrid,
  kmLockMatches, kmLockRead, kmLockRecord, kmNoteName, kmNoteOfPad, kmNoteUnit, kmPadOf, kmParseNote, kmRange, kmRangeRead, type KmLockEntry,
} from '../kit/midi.js';
import { DEFAULT_PAD_GRID, parseMidiLocks, parseNoteRange, parsePadGrid, type PlayPadGrid } from '../../types/playMidi';
import { parsePlayRecord } from '../../types/play';
import { midiEngine } from '../../lib/midiEngine';
import { kitScript } from '../exportHtml';

const pg = (over: Partial<PlayPadGrid> = {}): PlayPadGrid => ({ ...DEFAULT_PAD_GRID, ...over });

describe('knob locks', () => {
  it('matches only the locked device, channel and CC ("" and 0 are any)', () => {
    const lock = { device: 'Launch Control', channel: 2, cc: 21 };
    expect(kmLockMatches(lock, 'Launch Control', 2, 21)).toBe(true);
    expect(kmLockMatches(lock, 'Launch Control', 1, 21)).toBe(false);
    expect(kmLockMatches(lock, 'nanoKONTROL', 2, 21)).toBe(false);
    expect(kmLockMatches(lock, 'Launch Control', 2, 22)).toBe(false);
    expect(kmLockMatches({ device: '', channel: 0, cc: 21 }, 'anything', 9, 21)).toBe(true);
  });

  it('reads whichever locked control moved last, ignoring the rest', () => {
    const store = new Map<string, KmLockEntry>();
    const locks = [{ device: 'A', channel: 1, cc: 21 }, { device: 'B', channel: 3, cc: 74 }];
    expect(kmLockRead(store, locks)).toBeNull();
    kmLockRecord(store, 'A', 1, 21, 10, 1);
    kmLockRecord(store, 'C', 1, 21, 99, 2); // same CC, another device: ignored
    expect(kmLockRead(store, locks)).toBe(10);
    kmLockRecord(store, 'B', 3, 74, 64, 3);
    expect(kmLockRead(store, locks)).toBe(64);
    kmLockRecord(store, 'A', 2, 21, 5, 4); // right device, wrong channel
    expect(kmLockRead(store, locks)).toBe(64);
    kmLockRecord(store, 'A', 1, 21, 20, 5);
    expect(kmLockRead(store, locks)).toBe(20);
    // A lock on any device and channel sees every move of that CC.
    expect(kmLockRead(store, [{ device: '', channel: 0, cc: 21 }])).toBe(20);
  });

  it('the engine keeps locks per device, so a locked mapping ignores the same CC elsewhere', () => {
    midiEngine.handleBytes(0xb0, 21, 40, 'Knobs');
    midiEngine.handleBytes(0xb0, 21, 90, 'Other');
    expect(midiEngine.readLocked([{ device: 'Knobs', channel: 1, cc: 21 }])).toBe(40);
    expect(midiEngine.activeInput()).toMatchObject({ kind: 'cc', device: 'Other', channel: 1, number: 21, value: 90 });
  });

  it('parses locks: drops duplicates and bad CCs', () => {
    expect(parseMidiLocks([{ device: 'A', channel: 1, cc: 21 }, { device: 'A', channel: 1, cc: 21 }, { cc: 'x' }, { channel: 40, cc: 7 }])).toEqual([
      { device: 'A', channel: 1, cc: 21 }, { device: '', channel: 16, cc: 7 },
    ]);
    expect(parseMidiLocks([])).toBeUndefined();
    const rec = parsePlayRecord({ version: 1, controls: [{ id: 'c', target: 'n::p', kind: 'float', label: 'C', min: 0, max: 1 }], mappings: [{ id: 'm', controlId: 'c', source: { kind: 'midi', signal: 'cc', channel: 0, cc: 21, locks: [{ device: 'A', channel: 1, cc: 21 }] }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }], layers: [] });
    expect(rec.mappings[0].source).toEqual({ kind: 'midi', signal: 'cc', channel: 0, cc: 21, locks: [{ device: 'A', channel: 1, cc: 21 }] });
  });
});

describe('note ranges', () => {
  it('names and parses notes', () => {
    expect(kmNoteName(60)).toBe('C4');
    expect(kmNoteName(36)).toBe('C2');
    expect(kmParseNote('G3')).toBe(55);
    expect(kmParseNote('c#3')).toBe(49);
    expect(kmParseNote('Db3')).toBe(49);
    expect(kmParseNote('36')).toBe(36);
    expect(kmParseNote('H2')).toBeNull();
    expect(kmParseNote('200')).toBeNull();
  });

  it('builds a range from two presses in either order; the full range is none', () => {
    expect(kmRange(55, 36)).toEqual([36, 55]);
    expect(kmRange(0, 127)).toBeNull();
    expect(parseNoteRange([55, 36])).toEqual([36, 55]);
    expect(parseNoteRange([0, 127])).toBeUndefined();
    expect(parseNoteRange('C2')).toBeUndefined();
  });

  it('only notes inside the range count', () => {
    const seq = new Float64Array(128), vel = new Uint8Array(128), held = new Set<number>();
    const on = (n: number, v: number, s: number) => { seq[n] = s; vel[n] = v; held.add(n); };
    on(40, 100, 1);
    on(80, 30, 2); // outside C2–G3, and newer
    const r = kmRangeRead(seq, vel, held, [36, 55]);
    expect(r).toEqual({ note: 40, vel: 100, gate: true });
    held.delete(40);
    expect(kmRangeRead(seq, vel, held, [36, 55]).gate).toBe(false);
    expect(kmRangeRead(seq, vel, held, [60, 70]).note).toBe(-1);
    expect(kmRangeRead(seq, vel, held, null).note).toBe(80);
    expect(kmInRange([36, 55], 55)).toBe(true);
    expect(kmInRange([36, 55], 56)).toBe(false);
  });

  it('a note reads 0..1 across the range', () => {
    expect(kmNoteUnit([36, 48], 36)).toBe(0);
    expect(kmNoteUnit([36, 48], 42)).toBe(0.5);
    expect(kmNoteUnit([36, 48], 48)).toBe(1);
    expect(kmNoteUnit(null, 127)).toBe(1);
  });

  it('the engine filters by range per channel', () => {
    midiEngine.handleBytes(0x90 | 4, 50, 70); // channel 5
    midiEngine.handleBytes(0x90 | 4, 90, 20);
    expect(midiEngine.readRange(5, [48, 60])).toEqual({ note: 50, vel: 70, gate: true });
    expect(midiEngine.readRange(6, [48, 60]).note).toBe(-1);
    midiEngine.handleBytes(0x80 | 4, 50, 0);
    midiEngine.handleBytes(0x80 | 4, 90, 0);
    expect(midiEngine.readRange(5, [48, 60]).gate).toBe(false);
  });
});

describe('pad layouts', () => {
  it('Push 2/3: 36 bottom-left, 8 notes a row, 99 top-right', () => {
    const g = KM_LAYOUTS.push;
    expect(kmPadOf(g, 36)).toEqual({ col: 0, row: 0 });
    expect(kmPadOf(g, 43)).toEqual({ col: 7, row: 0 });
    expect(kmPadOf(g, 44)).toEqual({ col: 0, row: 1 });
    expect(kmPadOf(g, 99)).toEqual({ col: 7, row: 7 });
    expect(kmPadOf(g, 35)).toBeNull();
    expect(kmPadOf(g, 100)).toBeNull();
  });

  it('Launchpad programmer mode: 11 bottom-left, 10 a row, 88 top-right; 19 (side button) is no pad', () => {
    const g = KM_LAYOUTS.launchpad;
    expect(kmPadOf(g, 11)).toEqual({ col: 0, row: 0 });
    expect(kmPadOf(g, 18)).toEqual({ col: 7, row: 0 });
    expect(kmPadOf(g, 19)).toBeNull();
    expect(kmPadOf(g, 21)).toEqual({ col: 0, row: 1 });
    expect(kmPadOf(g, 88)).toEqual({ col: 7, row: 7 });
    expect(kmNoteOfPad(g, 3, 4)).toBe(54);
  });

  it('classic Launchpad X-Y: 0 top-left, 16 a row down', () => {
    const g = KM_LAYOUTS.launchpadClassic;
    expect(kmPadOf(g, 0)).toEqual({ col: 0, row: 7 });
    expect(kmPadOf(g, 112)).toEqual({ col: 0, row: 0 });
    expect(kmPadOf(g, 119)).toEqual({ col: 7, row: 0 });
    expect(kmPadOf(g, 8)).toBeNull(); // the side buttons
  });

  it('learns a grid from its bottom-left and top-right pads', () => {
    expect(kmLearnGrid(36, 99, 8, 8)).toEqual(KM_LAYOUTS.push);
    expect(kmLearnGrid(11, 88, 8, 8)).toEqual(KM_LAYOUTS.launchpad);
    expect(kmLearnGrid(112, 7, 8, 8)).toEqual(KM_LAYOUTS.launchpadClassic);
    // A 4 × 4 drum rack (36–51).
    expect(kmLearnGrid(36, 51, 4, 4)).toEqual({ origin: 36, colStep: 1, rowStep: 4, cols: 4, rows: 4 });
    // Rows of consecutive notes with gaps between rows (rows win when both fit).
    expect(kmLearnGrid(0, 18, 4, 4)).toEqual({ origin: 0, colStep: 1, rowStep: 5, cols: 4, rows: 4 });
    // Columns of consecutive notes, when no row layout fits.
    expect(kmLearnGrid(0, 14, 4, 3)).toEqual({ origin: 0, colStep: 4, rowStep: 1, cols: 4, rows: 3 });
    expect(kmPadOf(kmLearnGrid(0, 14, 4, 3)!, 9)).toEqual({ col: 2, row: 1 });
    // Nothing whole fits.
    expect(kmLearnGrid(36, 98, 8, 8)).toBeNull();
    const learned = kmLearnGrid(36, 51, 4, 4)!;
    expect(kmLayoutOf(pg({ layout: 'learned', learned }))).toBe(learned);
    expect(kmPadOf(learned, 41)).toEqual({ col: 1, row: 1 });
  });

  it('lines pads up with cells: offset, scale and flips, clipped to the grid', () => {
    const g = KM_LAYOUTS.push;
    expect(kmCellsOf(pg(), g, 2, 3)).toEqual([2, 2, 3, 3]);
    expect(kmCellsOf(pg({ offsetX: 1, offsetY: -1 }), g, 2, 3)).toEqual([3, 3, 2, 2]);
    expect(kmCellsOf(pg({ cols: 16, rows: 16, scale: 2 }), g, 2, 3)).toEqual([4, 5, 6, 7]);
    expect(kmCellsOf(pg({ flipX: true, flipY: true }), g, 0, 0)).toEqual([7, 7, 7, 7]);
    expect(kmCellsOf(pg({ offsetX: 7 }), g, 3, 0)).toBeNull();
    expect(kmCellsOf(pg({ cols: 4, rows: 4, scale: 0.5 }), g, 3, 3)).toEqual([1, 1, 1, 1]);
  });

  it('parses the pad grid, keeping a learned layout only with its geometry', () => {
    expect(parsePadGrid({})).toEqual(DEFAULT_PAD_GRID);
    expect(parsePadGrid({ layout: 'learned' })!.layout).toBe('push');
    const p = parsePadGrid({ layout: 'learned', learned: { origin: 36, colStep: 1, rowStep: 4, cols: 4, rows: 4 }, cols: 99, mode: 'latch', scale: 20 })!;
    expect(p.layout).toBe('learned');
    expect(p.cols).toBe(32);
    expect(p.scale).toBe(8);
    expect(p.mode).toBe('latch');
    const rec = parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [], padGrid: { mode: 'decay' } });
    expect(rec.padGrid?.mode).toBe('decay');
  });
});

describe('pad grid cells', () => {
  const geo = KM_LAYOUTS.push;
  it('hold: lit while held, fading over Release after', () => {
    const p = pg({ mode: 'hold', release: 0.5 });
    const g = kmGridCreate(8, 8);
    kmGridDown(g, p, geo, 1, 2, 0.5, 10);
    const cell = g.cells[2 * 8 + 1];
    expect(kmCellLevel(cell, p, 12)).toBe(0.5);
    kmGridUp(g, p, 1, 2, 12);
    expect(kmCellLevel(cell, p, 12.25)).toBeCloseTo(0.25);
    expect(kmCellLevel(cell, p, 13)).toBe(0);
    // Velocity off: every hit is full.
    const full = pg({ mode: 'hold', velocity: false });
    const g2 = kmGridCreate(8, 8);
    kmGridDown(g2, full, geo, 0, 0, 0.2, 0);
    expect(kmCellLevel(g2.cells[0], full, 0)).toBe(1);
  });

  it('latch: each hit toggles', () => {
    const p = pg({ mode: 'latch', release: 0 });
    const g = kmGridCreate(8, 8);
    kmGridDown(g, p, geo, 0, 0, 1, 0); kmGridUp(g, p, 0, 0, 0.1);
    expect(kmCellLevel(g.cells[0], p, 5)).toBe(1);
    kmGridDown(g, p, geo, 0, 0, 1, 6); kmGridUp(g, p, 0, 0, 6.1);
    expect(kmCellLevel(g.cells[0], p, 6.2)).toBe(0);
  });

  it('decay: each hit flashes and fades whether held or not', () => {
    const p = pg({ mode: 'decay', release: 1 });
    const g = kmGridCreate(8, 8);
    kmGridDown(g, p, geo, 0, 0, 1, 0);
    expect(kmCellLevel(g.cells[0], p, 0.5)).toBeCloseTo(0.5);
    expect(kmCellLevel(g.cells[0], p, 1.5)).toBe(0);
  });

  it('reads MIDI: notes, poly aftertouch and channel pressure from the set device and channel', () => {
    const p = pg({ device: 'Push 2', channel: 1 });
    const g = kmGridCreate(8, 8);
    expect(kmGridMessage(g, p, 0x90, 44, 100, 'Other', 0)).toBeNull();
    expect(kmGridMessage(g, p, 0x91, 44, 100, 'Push 2', 0)).toBeNull(); // channel 2
    expect(kmGridMessage(g, p, 0x90, 44, 127, 'Push 2', 0)).toBe('down');
    expect(kmGridRead(g, p, 'x', 0, 0, 0)).toBe(0);
    expect(kmGridRead(g, p, 'y', 0, 0, 0)).toBeCloseTo(1 / 7);
    expect(kmGridRead(g, p, 'velocity', 0, 0, 0)).toBe(1);
    expect(kmGridRead(g, p, 'gate', 0, 0, 0)).toBe(1);
    expect(kmGridRead(g, p, 'cell', 0, 1, 0)).toBe(1);
    expect(kmGridMessage(g, p, 0xa0, 44, 64, 'Push 2', 0)).toBe('pressure');
    expect(kmGridRead(g, p, 'pressure', 0, 0, 0)).toBeCloseTo(64 / 127);
    expect(kmGridMessage(g, p, 0xd0, 127, 0, 'Push 2', 0)).toBe('pressure');
    expect(kmGridRead(g, p, 'pressure', 0, 0, 0)).toBe(1);
    expect(kmGridMessage(g, p, 0x80, 44, 0, 'Push 2', 1)).toBe('up');
    expect(kmGridRead(g, p, 'gate', 0, 0, 1)).toBe(0);
    expect(kmGridRead(g, p, 'pressure', 0, 0, 1)).toBe(0);
    // Not a pad of this layout.
    expect(kmGridMessage(g, p, 0x90, 10, 100, 'Push 2', 0)).toBeNull();
  });

  it('fills the texture: level, velocity, pressure, held; and says while something fades', () => {
    const p = pg({ mode: 'hold', release: 1 });
    const g = kmGridCreate(8, 8);
    const rgba = new Uint8Array(8 * 8 * 4);
    kmGridDown(g, p, geo, 7, 7, 1, 0);
    expect(kmGridFill(g, p, 0, rgba)).toBe(false);
    const i = (7 * 8 + 7) * 4;
    expect([...rgba.slice(i, i + 4)]).toEqual([255, 255, 0, 255]);
    kmGridUp(g, p, 7, 7, 0);
    expect(kmGridFill(g, p, 0.5, rgba)).toBe(true);
    expect(rgba[i]).toBe(128);
    expect(rgba[i + 3]).toBe(0);
    expect(kmGridFill(g, p, 2, rgba)).toBe(false);
  });

  it('is in the exported page\'s kit', () => {
    const js = kitScript();
    expect(js).toContain('function kmGridMessage');
    expect(js).toContain('midi: { lockRecord: kmLockRecord');
    expect(js).not.toMatch(/^export /m);
  });
});
