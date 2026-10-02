/**
 * Play notes (implementation guide, phase 8): a rule's reaction that plays
 * notes on a rack — the events it sends, the file, and the app host's
 * stuck-note safety.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { noteEvents, notesSummary, snapToScale } from '../notes';
import { defaultNotes, emptyPlayRecord, parsePlayRecord, type NotesSpec, type PlayRecord } from '../../types/play';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { audioEngineHost } from '../../lib/audioEngineHost';
import { startPlayNotes } from '../../lib/playNotes';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); playEngine.setRecord(emptyPlayRecord()); });

const spec = (over: Partial<NotesSpec> = {}): NotesSpec => ({ ...defaultNotes('rk'), ...over });
const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('the events', () => {
  it('a chord sounds every note at once, each let go after its length', () => {
    expect(noteEvents(spec(), 0, () => 0.5)).toEqual([
      { atMs: 0, bytes: [0x90, 60, 100] }, { atMs: 0, bytes: [0x90, 64, 100] }, { atMs: 0, bytes: [0x90, 67, 100] },
      { atMs: 400, bytes: [0x80, 60, 0] }, { atMs: 400, bytes: [0x80, 64, 0] }, { atMs: 400, bytes: [0x80, 67, 0] },
    ]);
  });

  it('strum spaces them, arp walks the list fire by fire, random picks one', () => {
    expect(noteEvents(spec({ play: 'strum', gapMs: 30 }), 0, () => 0.5).filter(e => e.bytes[0] === 0x90).map(e => e.atMs)).toEqual([0, 30, 60]);
    const arp = (n: number) => noteEvents(spec({ play: 'arp' }), n, () => 0.5)[0].bytes[1];
    expect([0, 1, 2, 3].map(arp)).toEqual([60, 64, 67, 60]);
    expect(noteEvents(spec({ play: 'random' }), 0, seq([0.9, 0.5]))[0].bytes[1]).toBe(67);
  });

  it('velocity strays within its spread; notes snap to a scale', () => {
    const v = noteEvents(spec({ velRandom: 0.5 }), 0, seq([1, 0, 0.5]));
    expect(v.filter(e => e.bytes[0] === 0x90).map(e => e.bytes[2])).toEqual([127, 50, 100]);
    expect(snapToScale(61, 'major', 0)).toBe(60);
    expect(snapToScale(66, 'pentatonic', 0)).toBe(67);
    expect(snapToScale(61, 'chromatic', 0)).toBe(61);
    expect(noteEvents(spec({ notes: [61, 63], scale: 'major' }), 0, () => 0.5).filter(e => e.bytes[0] === 0x90).map(e => e.bytes[1])).toEqual([60, 62]);
    expect(notesSummary(spec())).toBe('C4 E4 G4 · chord');
  });
});

describe('the file', () => {
  it('keeps a Play notes reaction, in range; one with no rack goes', () => {
    const rec = parsePlayRecord({ version: 1, layers: [], controls: [], mappings: [], signals: [{ id: 's', name: 'S', do: [
      { id: 'n', do: 'notes', enabled: true, notes: { rackId: 'rk', notes: [60, 200, -3, 64], play: 'arp', velocity: 999, lengthMs: 1, gapMs: 10, velRandom: 2, scale: 'nope', root: 14 } },
      { id: 'bad', do: 'notes', enabled: true, notes: { notes: [60] } },
    ] }] });
    expect(rec?.signals?.[0].do).toEqual([{ id: 'n', do: 'notes', layerId: '', amount: 1, enabled: true, notes: { rackId: 'rk', notes: [60, 127, 0, 64], play: 'arp', velocity: 127, lengthMs: 20, gapMs: 10, velRandom: 1, scale: 'chromatic', root: 11 } }]);
  });
});

describe('in the app', () => {
  it('a rule plays its notes on the rack, lets each go, and lets everything go when Play stops', () => {
    vi.useFakeTimers();
    const sent: Array<[string, number[]]> = [];
    vi.spyOn(audioEngineHost, 'input').mockImplementation((rackId, bytes) => { sent.push([rackId, [...bytes]]); });
    const play: PlayRecord = { ...emptyPlayRecord(), controls: [{ id: 'src', target: 'n::src', kind: 'float', label: 'src', min: 0, max: 1 }],
      signals: [{ id: 'hi', name: 'Hi', inputs: [{ kind: 'trigger', trigger: { on: 'value', value: 'ctl:src', cmp: 'above', threshold: 0.5, hysteresis: 0, tolerance: 0 } }],
        do: [{ id: 'n', do: 'notes', layerId: '', amount: 1, enabled: true, notes: spec({ play: 'strum', gapMs: 100, lengthMs: 1000 }) }] }] };
    inputBus.setParamBindings({ 'n::src': 'u_src' });
    playEngine.setRecord(play);
    const stop = startPlayNotes();
    let t = 1;
    for (const v of [0, 1]) { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(1 / 60, (t += 1 / 60)); }
    expect(sent).toEqual([['rk', [0x90, 60, 100]]]);
    vi.advanceTimersByTime(150);
    expect(sent.map(s => s[1][1])).toEqual([60, 64]);
    // Play stops before the notes end: every held note gets its note-off.
    stop();
    expect(sent.slice(2).map(s => s[1]).sort()).toEqual([[0x80, 60, 0], [0x80, 64, 0]]);
    vi.advanceTimersByTime(5000);
    expect(sent.length).toBe(4);
    inputBus.setParamBindings({});
  });
});
