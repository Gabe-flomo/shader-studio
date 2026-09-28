/**
 * The MIDI monitor (lib/midiMonitor.ts): decoding raw messages, the log per
 * device, pause, the cap, and the text that Copy puts on the clipboard.
 */
import { describe, it, expect } from 'vitest';
import { MidiMonitor, MONITOR_MAX, describeMidiBytes, formatMonitorLine, midiMessageLength } from '../midiMonitor';

describe('describeMidiBytes', () => {
  it('names notes, controllers and the rest', () => {
    expect(describeMidiBytes([0x90, 60, 100])).toEqual({ kind: 'note', channel: 1, text: 'Note on C4 (60) vel 100' });
    expect(describeMidiBytes([0x99, 36, 90])).toEqual({ kind: 'note', channel: 10, text: 'Note on C2 (36) vel 90' });
    expect(describeMidiBytes([0x90, 60, 0]).text).toBe('Note off C4 (60) (vel 0)');
    expect(describeMidiBytes([0x80, 61, 0])).toEqual({ kind: 'note', channel: 1, text: 'Note off C#4 (61)' });
    expect(describeMidiBytes([0xb0, 1, 64]).text).toBe('CC 1 Mod wheel = 64');
    expect(describeMidiBytes([0xb2, 74, 127])).toEqual({ kind: 'cc', channel: 3, text: 'CC 74 Cutoff = 127' });
    expect(describeMidiBytes([0xb0, 21, 5]).text).toBe('CC 21 = 5');
    expect(describeMidiBytes([0xc0, 7])).toEqual({ kind: 'program', channel: 1, text: 'Program 7' });
    expect(describeMidiBytes([0xa0, 36, 50]).text).toBe('Poly pressure C2 (36) = 50');
    expect(describeMidiBytes([0xd0, 77]).text).toBe('Channel pressure = 77');
    expect(describeMidiBytes([0xe0, 0, 64]).text).toBe('Pitch bend 0');
    expect(describeMidiBytes([0xe0, 127, 127]).text).toBe('Pitch bend 8191');
  });

  it('names sysex by maker and says when it is trimmed, and system messages', () => {
    expect(describeMidiBytes([0xf0, 0x47, 0x7f, 0x49, 0xf7])).toEqual({ kind: 'sysex', channel: null, text: 'SysEx Akai (5 bytes)' });
    expect(describeMidiBytes([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]).text).toBe('SysEx Universal (non-realtime) (6 bytes)');
    expect(describeMidiBytes([0xf0, 0x00, 0x20, 0x29], 120).text).toBe('SysEx id 00 20 29 (120 bytes, first 4 shown)');
    expect(describeMidiBytes([0xf8])).toEqual({ kind: 'system', channel: null, text: 'Clock' });
    expect(describeMidiBytes([0xfa]).text).toBe('Start');
    expect(describeMidiBytes([0xf2, 0, 1]).text).toBe('Song position 128');
    expect(describeMidiBytes([0x05]).kind).toBe('other');
    expect([0x90, 0xc0, 0xd0, 0xf0, 0xf2, 0xf8].map(midiMessageLength)).toEqual([3, 2, 2, 0, 3, 1]);
  });
});

describe('MidiMonitor', () => {
  it('logs per device, filters, pauses and caps', () => {
    const m = new MidiMonitor();
    let changes = 0;
    m.subscribe(() => changes++);
    m.push([0x90, 60, 100], 'MPK mini 3', '123');
    m.push([0x99, 36, 90], 'MPK mini 3', '123');
    m.push([0xb0, 21, 64], 'Push 3', '456');
    m.push([0xf0, 0x47, 0xf7], 'MPK mini 3', '123', 40);
    expect(m.list().map(e => e.device)).toEqual(['MPK mini 3', 'MPK mini 3', 'Push 3', 'MPK mini 3']);
    expect(m.list('Push 3')).toHaveLength(1);
    expect(m.list('MPK mini 3').at(-1)).toMatchObject({ bytes: [0xf0, 0x47, 0xf7], len: 40, id: '123' });
    expect(m.seen('MPK mini 3')).toMatchObject({ count: 3 });
    expect(m.seen('nobody')).toBeNull();
    expect(changes).toBe(4);
    // Paused: the log stands still, but the counts still say the device is alive.
    m.setPaused(true);
    m.push([0x90, 62, 1], 'Push 3');
    expect(m.list()).toHaveLength(4);
    expect(m.seen('Push 3')?.count).toBe(2);
    m.setPaused(false);
    for (let i = 0; i < MONITOR_MAX * 3; i++) m.push([0xb0, 1, i & 127], 'Push 3');
    expect(m.list().length).toBeLessThanOrEqual(MONITOR_MAX);
    expect(m.list(undefined, 10)).toHaveLength(10);
    m.clear();
    expect(m.list()).toEqual([]);
    expect(m.version()).toBe(changes); // every change bumps the version the view polls
  });

  it('formats lines for the clipboard', () => {
    const m = new MidiMonitor();
    m.push([0x99, 36, 90], 'MPK mini 3', '123');
    m.push([0xf0, 0x47, 0x7f], 'MPK mini 3', '123', 12);
    const [note, sysex] = m.text().split('\n');
    expect(note).toMatch(/^\d\d:\d\d:\d\d\.\d\d\d {2}MPK mini 3 {2}99 24 5A {2}Note on C2 \(36\) vel 90 · ch 10$/);
    expect(sysex).toMatch(/MPK mini 3 {2}F0 47 7F … {2}SysEx Akai \(12 bytes, first 3 shown\)$/);
    expect(formatMonitorLine({ seq: 1, at: 0, device: '', id: '', bytes: [0xf8], len: 1 })).toMatch(/\(no device\) {2}F8 {2}Clock$/);
    expect(m.text('nobody')).toBe('');
  });
});
