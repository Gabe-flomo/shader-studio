import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { midiEngine } from '../midiEngine';
import { assignCc, claimMidiListen, isUnassignedCc, lastMidiAssignment, resetMidiAutoLearn, startMidiAutoLearn, withCcLocks } from '../midiAutoLearn';
import { claimKeyboard, releaseKeyboardClaim } from '../keyboardClaim';
import { parsePlayRecord, type PlayMapping, type PlaySource } from '../../types/play';
import { sourceFromType } from '../../play/playSources';
import { playEngine } from '../playEngine';

const NEW_CC: PlaySource = { kind: 'midi', signal: 'cc', channel: 0 };
const mapping = (id: string, source: PlaySource): PlayMapping => ({ id, controlId: 'c', source, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true });

/** A tiny record store: what the Play page does with `onUpdate`. */
function harness(...rows: PlayMapping[]) {
  const mappings = rows.slice();
  const assigned: string[] = [];
  const stop = startMidiAutoLearn({
    mappings: () => mappings,
    assign: (id, source) => { assigned.push(id); const i = mappings.findIndex(m => m.id === id); mappings[i] = { ...mappings[i], source }; },
    now: () => 1000,
  });
  return { mappings, assigned, stop, source: (id: string) => mappings.find(m => m.id === id)!.source };
}

let stops: (() => void)[] = [];
beforeEach(() => resetMidiAutoLearn());
afterEach(() => { for (const s of stops) s(); stops = []; releaseKeyboardClaim('rack'); });

describe('a new MIDI CC mapping', () => {
  it('starts without a CC, from the picker and from the parser', () => {
    expect(isUnassignedCc(sourceFromType('midi:cc', { kind: 'mouse', axis: 'x' }))).toBe(true);
    // Switching a row from note to CC keeps nothing to guess from either.
    expect(isUnassignedCc(sourceFromType('midi:cc', { kind: 'midi', signal: 'note', channel: 2 }))).toBe(true);
    // A row that already had its knob keeps it.
    expect(sourceFromType('midi:cc', { kind: 'midi', signal: 'cc', channel: 0, cc: 74 })).toMatchObject({ cc: 74 });
    const rec = parsePlayRecord({ controls: [{ id: 'c', target: 'n::k', min: 0, max: 1 }], mappings: [
      { id: 'a', controlId: 'c', source: { kind: 'midi', signal: 'cc', channel: 0 } },
      { id: 'b', controlId: 'c', source: { kind: 'midi', signal: 'cc', channel: 0, cc: 1 } },
    ] });
    expect(rec.mappings[0].source).toEqual({ kind: 'midi', signal: 'cc', channel: 0 });
    // An explicit CC (even the old default, 1) is kept: it can't be told from one typed on purpose.
    expect(rec.mappings[1].source).toEqual({ kind: 'midi', signal: 'cc', channel: 0, cc: 1 });
  });

  it('reads nothing until it has a knob, so the control is left alone', () => {
    midiEngine.handleBytes(0xb0, 70, 64, 'MPK mini 3');
    expect(playEngine.readSource(NEW_CC)).toBeNull();
    expect(playEngine.readSource({ ...NEW_CC, cc: 70 })).toBeCloseTo(64 / 127);
  });

  it('takes the first CC that moves, then ignores others', () => {
    const h = harness(mapping('m1', NEW_CC));
    stops.push(h.stop);
    midiEngine.handleBytes(0xb0, 70, 64, 'MPK mini 3');
    expect(h.source('m1')).toEqual({ kind: 'midi', signal: 'cc', channel: 1, cc: 70 });
    expect(lastMidiAssignment()).toMatchObject({ mappingId: 'm1', cc: 70, channel: 1, device: 'MPK mini 3' });
    midiEngine.handleBytes(0xb0, 71, 10, 'MPK mini 3');
    expect(h.source('m1')).toMatchObject({ cc: 70 });
    expect(h.assigned).toEqual(['m1']);
    // The row now follows CC 70 and not CC 71.
    midiEngine.handleBytes(0xb0, 70, 127, 'MPK mini 3');
    expect(playEngine.readSource(h.source('m1'))).toBeCloseTo(1);
  });

  it('keeps a channel the row already names', () => {
    expect(assignCc({ kind: 'midi', signal: 'cc', channel: 3 }, { channel: 1, cc: 20 })).toEqual({ kind: 'midi', signal: 'cc', channel: 3, cc: 20 });
  });

  it('fills unassigned rows one knob each: the knob still turning does not take the next row', () => {
    const h = harness(mapping('m1', NEW_CC), mapping('m2', NEW_CC));
    stops.push(h.stop);
    midiEngine.handleBytes(0xb0, 70, 64, 'MPK mini 3');
    midiEngine.handleBytes(0xb0, 70, 65, 'MPK mini 3');
    expect(h.source('m1')).toMatchObject({ cc: 70 });
    expect(isUnassignedCc(h.source('m2'))).toBe(true);
    midiEngine.handleBytes(0xb0, 71, 1, 'MPK mini 3');
    expect(h.source('m2')).toMatchObject({ cc: 71, channel: 1 });
  });

  it('re-learns after Change… (the CC removed again)', () => {
    const h = harness(mapping('m1', NEW_CC));
    stops.push(h.stop);
    midiEngine.handleBytes(0xb0, 70, 64);
    expect(h.source('m1')).toMatchObject({ cc: 70 });
    // Change… in the row: what assignCc does with the next knob, whatever the row had.
    expect(assignCc(h.source('m1'), { channel: 2, cc: 71 })).toMatchObject({ cc: 71, channel: 1 });
    h.mappings[0] = { ...h.mappings[0], source: NEW_CC };
    midiEngine.handleBytes(0xb0, 71, 5);
    expect(h.source('m1')).toMatchObject({ cc: 71 });
  });

  it('stands aside while a row is in Learn mode or a rack has the keyboard', () => {
    const h = harness(mapping('m1', NEW_CC));
    stops.push(h.stop);
    const release = claimMidiListen();
    midiEngine.handleBytes(0xb0, 70, 64);
    expect(isUnassignedCc(h.source('m1'))).toBe(true);
    release();
    claimKeyboard('rack');
    midiEngine.handleBytes(0xb0, 70, 64);
    expect(isUnassignedCc(h.source('m1'))).toBe(true);
    releaseKeyboardClaim('rack');
    midiEngine.handleBytes(0xb0, 70, 64);
    expect(h.source('m1')).toMatchObject({ cc: 70 });
  });

  it('keeps the CC through lock and unlock', () => {
    const learned = { kind: 'midi' as const, signal: 'cc' as const, channel: 1, cc: 70 };
    const locked = withCcLocks(learned, [{ device: 'MPK mini 3', channel: 1, cc: 70 }]);
    expect(locked).toEqual({ ...learned, locks: [{ device: 'MPK mini 3', channel: 1, cc: 70 }] });
    expect(isUnassignedCc(locked)).toBe(false);
    // Unlocking removes only the device binding: CC 70 stays, from any device.
    expect(withCcLocks(locked, [])).toEqual(learned);
    // A lock on a fresh row gives it that knob's CC too.
    expect(withCcLocks(NEW_CC as typeof learned, [{ device: 'X', channel: 2, cc: 9 }])).toMatchObject({ cc: 9 });
  });

  it('is not touched by notes or bend, and a locked row is not unassigned', () => {
    const h = harness(mapping('m1', NEW_CC));
    stops.push(h.stop);
    midiEngine.handleBytes(0x90, 60, 100);
    midiEngine.handleBytes(0xe0, 0, 64);
    midiEngine.handleBytes(0x80, 60, 0);
    expect(isUnassignedCc(h.source('m1'))).toBe(true);
    expect(isUnassignedCc({ kind: 'midi', signal: 'cc', channel: 0, locks: [{ device: 'X', channel: 1, cc: 9 }] })).toBe(false);
  });
});
