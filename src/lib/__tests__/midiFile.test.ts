/**
 * MIDI files: timing through the tempo map, running status, and playback on
 * the graph clock (pause, seek back, loop) through the MIDI engine.
 */
import { describe, it, expect } from 'vitest';
import { bytesToBase64, eventIndexAt, parseMidiFile } from '../midiFile';
import { MidiEngine, type MidiEvent } from '../midiEngine';
import { parsePlayRecord, type PlayMidiFile } from '../../types/play';

const vlq = (n: number): number[] => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
const chunk = (id: string, body: number[]) => [...id].map(c => c.charCodeAt(0)).concat([(body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255], body);

/**
 * Format 1, 480 ticks per quarter. Tempo track: 120 bpm, then 60 bpm from beat 2.
 * Note track: C4 on at 0 (off at beat 1, running status), a CC at beat 1, E4 at beat 3 for a beat.
 */
function song(): Uint8Array {
  const tempo = [
    ...vlq(0), 0xff, 0x51, 3, 0x07, 0xa1, 0x20,        // 500000 µs/quarter = 120 bpm
    ...vlq(960), 0xff, 0x51, 3, 0x0f, 0x42, 0x40,      // at beat 2: 1000000 = 60 bpm
    ...vlq(0), 0xff, 0x2f, 0,
  ];
  const notes = [
    ...vlq(0), 0x90, 60, 100,
    ...vlq(480), 60, 0,                                 // running status: note-on vel 0 = off, at beat 1
    ...vlq(0), 0xb0, 21, 64,                            // CC 21 at beat 1
    ...vlq(960), 0x90, 64, 90,                          // beat 3
    ...vlq(480), 0x80, 64, 0,                           // beat 4
    ...vlq(0), 0xff, 0x2f, 0,
  ];
  return new Uint8Array([...chunk('MThd', [0, 1, 0, 2, 0x01, 0xe0]), ...chunk('MTrk', tempo), ...chunk('MTrk', notes)]);
}

describe('parseMidiFile', () => {
  it('times events through the tempo map, with running status', () => {
    const f = parseMidiFile(song());
    // 120 bpm: beat 1 = 0.5 s, beat 2 = 1 s; then 60 bpm: beat 3 = 2 s, beat 4 = 3 s.
    expect(f.events.map(e => [+(e.t.toFixed(3)), e.status, e.d1, e.d2])).toEqual([
      [0, 0x90, 60, 100], [0.5, 0x90, 60, 0], [0.5, 0xb0, 21, 64], [2, 0x90, 64, 90], [3, 0x80, 64, 0],
    ]);
    expect(f.duration).toBeCloseTo(3);
    expect(f.notes).toBe(2);
    expect(f.channels).toEqual([1]);
    expect(eventIndexAt(f.events, 1)).toBe(3);
  });

  it('says what is wrong with a file that is not MIDI', () => {
    expect(() => parseMidiFile(new TextEncoder().encode('hello, this is not a midi file'))).toThrow(/Not a MIDI file/);
  });
});

describe('a MIDI file on the clock', () => {
  const file = (over: Partial<PlayMidiFile> = {}): PlayMidiFile => ({ name: 'song', data: bytesToBase64(song()), loop: false, offset: 0, ...over });
  const run = (engine: MidiEngine, times: number[]) => {
    const got: string[] = [];
    const off = engine.subscribe((e: MidiEvent) => {
      if (e.kind === 'noteOn') got.push(`on${e.note}`); else if (e.kind === 'noteOff') got.push(`off${e.note}`); else if (e.kind === 'cc') got.push(`cc${e.cc}`);
    });
    for (const t of times) engine.tickInputs(1 / 60, t, () => {});
    off();
    return got;
  };

  it('plays in order as the clock runs, and holds still while it is paused', () => {
    const engine = new MidiEngine();
    engine.setFile(file());
    expect(engine.wantsTick()).toBe(true);
    expect(run(engine, [0, 0.4, 0.4, 0.6, 2.1, 3.2])).toEqual(['on60', 'off60', 'cc21', 'on64', 'off64']);
  });

  it('a seek back releases held notes and plays from the new spot; the start offset delays it', () => {
    const engine = new MidiEngine();
    engine.setFile(file());
    expect(run(engine, [0, 0.6, 1.5, 2.1, 0])).toEqual(['on60', 'off60', 'cc21', 'on64', 'off64', 'on60']);
    // A jump further than a couple of seconds is a seek: what was skipped doesn't all fire at once.
    const jump = new MidiEngine();
    jump.setFile(file());
    expect(run(jump, [0, 2.5])).toEqual(['on60', 'off60']);
    const late = new MidiEngine();
    late.setFile(file({ offset: 1 }));
    expect(run(late, [0, 0.5, 1.0])).toEqual(['on60']);
  });

  it('loops without losing the note on the downbeat', () => {
    const engine = new MidiEngine();
    engine.setFile(file({ loop: true }));
    // 2.99 → 3.02 wraps: E4's note-off at 3 s still plays, then C4 on the downbeat.
    expect(run(engine, [0, 1, 2, 2.99, 3.02, 3.6])).toEqual(['on60', 'off60', 'cc21', 'on64', 'off64', 'on60', 'off60', 'cc21']);
  });

  it('keeps the file in the record, and drops one that is not base64', () => {
    const r = parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [], midiFile: { name: 'song', data: bytesToBase64(song()), loop: true, offset: 2 } });
    expect(r.midiFile).toMatchObject({ name: 'song', loop: true, offset: 2 });
    expect(parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [], midiFile: { name: 'x', data: '<script>' } }).midiFile).toBeUndefined();
  });
});
