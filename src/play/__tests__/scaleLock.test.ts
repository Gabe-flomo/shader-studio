/**
 * Snap to scale (docs/piano-roll-plan.md, phases 1–2): the scales and the
 * snap (play/scales.ts), the tape's scale and a rack's lock on the record,
 * and the host putting live notes in key where they enter a rack (with a
 * fake Tauri bridge: nothing is heard).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  const store = new Map<string, string>();
  g.localStorage = {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
});

import { SCALES, inScale, scaleOf, snapNote } from '../scales';
import { snapToScale } from '../notes';
import { AE_INST, newRack, parseAudioEngine, zonesFor, type AeRack, type PlayAudioEngine } from '../../types/playAudioEngine';
import { parseArrangement } from '../../types/playArrangement';
import { audioEngineHost } from '../../lib/audioEngineHost';
import { usePlan } from '../../lib/plan';

describe('the scales', () => {
  it('has Live’s list, each starting on its root', () => {
    expect(SCALES.length).toBeGreaterThan(30);
    for (const s of SCALES) { expect(s.steps[0]).toBe(0); expect(new Set(s.steps).size).toBe(s.steps.length); }
    expect(scaleOf('major').steps).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleOf('nope').id).toBe(SCALES[0].id);
  });

  it('knows which notes are in a scale on any root', () => {
    expect(inScale(60, 'major', 0)).toBe(true);
    expect(inScale(61, 'major', 0)).toBe(false);
    expect(inScale(61, 'major', 1)).toBe(true); // C# major
    expect(inScale(3, 'minor', 0)).toBe(true);
  });

  it('snaps to the nearest note, ties going down; up and down always one way', () => {
    // C major: C# sits between C and D → down to C.
    expect(snapNote(61, 'major', 0)).toBe(60);
    expect(snapNote(61, 'major', 0, 'up')).toBe(62);
    expect(snapNote(61, 'major', 0, 'down')).toBe(60);
    expect(snapNote(64, 'major', 0, 'up')).toBe(64); // in key stays
    // A minor pentatonic (A C D E G): A# is nearer A, B nearer C.
    expect(snapNote(70, 'minorPentatonic', 9)).toBe(69);
    expect(snapNote(71, 'minorPentatonic', 9)).toBe(72);
    expect(snapNote(70, 'minorPentatonic', 9, 'up')).toBe(72);
    // Chromatic changes nothing.
    for (let n = 0; n < 128; n++) expect(snapNote(n, 'chromatic', 0)).toBe(n);
  });

  it('stays in MIDI’s range at the edges', () => {
    for (const s of SCALES) for (const root of [0, 5, 11]) for (const mode of ['nearest', 'up', 'down'] as const) {
      for (const n of [0, 1, 126, 127]) { const v = snapNote(n, s.id, root, mode); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(127); }
    }
  });

  it('keeps the older notes scales working', () => {
    expect(snapToScale(61, 'major', 0)).toBe(60);
  });
});

describe('the record', () => {
  it('reads the tape’s scale', () => {
    expect(parseArrangement({ clips: [], scale: { on: true, root: 14, name: 'dorian' } })?.scale).toEqual({ on: true, root: 11, name: 'dorian' });
    expect(parseArrangement({ clips: [], scale: { on: false, root: 2, name: '<bad>' } })?.scale).toEqual({ on: false, root: 2, name: 'major' });
    expect(parseArrangement({ clips: [] })?.scale).toBeUndefined();
  });

  it('reads a rack’s lock', () => {
    const ae = parseAudioEngine({ racks: [{ ...newRack('rk_a', []), scaleLock: 'up' }, { ...newRack('rk_b', []), scaleLock: 'sideways' }] });
    expect(ae?.racks[0].scaleLock).toBe('up');
    expect(ae?.racks[1].scaleLock).toBeUndefined();
  });
});

describe('the host puts live notes in key', () => {
  const acts: Array<{ amount: number; vel: number }> = [];
  const taps: number[][] = [];
  const notes = () => acts.map(a => [a.amount - 1, a.vel > 0 ? 1 : 0]);
  let offTap: () => void = () => {};
  const rack = (over: Partial<AeRack> = {}): AeRack => ({
    ...newRack('rk_s', []), instrument: { id: AE_INST, kind: 'sampler', zones: zonesFor(Array.from({ length: 48 }, (_, i) => ({ id: `s${i}`, name: `S${i}` })), 'keys', 36) }, effects: [], ...over,
  });
  beforeEach(async () => {
    audioEngineHost.resetForTests();
    acts.length = 0; taps.length = 0;
    offTap();
    offTap = audioEngineHost.onInput((_r, b) => taps.push(b));
    audioEngineHost.configure({
      invoke: (async (cmd: string) => cmd === 'ae_status' ? { available: true, sampleRate: 48000 } : cmd === 'ae_sound_has' ? true : null) as never,
      listen: (async () => () => {}) as never,
      sounds: async id => ({ blob: new Blob([new Uint8Array([1])]), type: 'audio/wav', name: `${id}.wav` }),
      act: a => { acts.push(a); audioEngineHost.onPad(a); },
    });
    usePlan.getState().setSession({ status: 'signed-in', user: '', plan: 'pro', source: 'open' });
  });
  const start = async (over: Partial<AeRack>) => {
    const ae: PlayAudioEngine = { racks: [rack(over)] };
    audioEngineHost.frame(ae, []);
    await audioEngineHost.settled();
  };

  it('snaps a note and its note-off; the take records the snapped note', async () => {
    await start({ scaleLock: 'nearest' });
    audioEngineHost.setScale({ on: true, root: 0, name: 'major' });
    audioEngineHost.input('rk_s', [0x90, 61, 100]);
    audioEngineHost.input('rk_s', [0x80, 61, 0]);
    expect(notes()).toEqual([[60, 1], [60, 0]]);
    expect(taps).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
  });

  it('leaves notes alone with no lock, the scale off, or from the tape', async () => {
    await start({});
    audioEngineHost.setScale({ on: true, root: 0, name: 'major' });
    audioEngineHost.input('rk_s', [0x90, 61, 100]);
    await start({ scaleLock: 'nearest' });
    audioEngineHost.setScale({ on: false, root: 0, name: 'major' });
    audioEngineHost.input('rk_s', [0x90, 63, 100]);
    audioEngineHost.setScale({ on: true, root: 0, name: 'major' });
    audioEngineHost.input('rk_s', [0x90, 66, 100], true);
    expect(notes()).toEqual([[61, 1], [63, 1], [66, 1]]);
  });

  it('lets go of moved notes when the scale changes', async () => {
    await start({ scaleLock: 'up' });
    audioEngineHost.setScale({ on: true, root: 0, name: 'major' });
    audioEngineHost.input('rk_s', [0x90, 61, 100]); // → 62
    audioEngineHost.setScale({ on: true, root: 0, name: 'minor' });
    audioEngineHost.input('rk_s', [0x80, 61, 0]); // already let go: passes as played
    expect(notes()).toEqual([[62, 1], [62, 0], [61, 0]]);
  });
});
