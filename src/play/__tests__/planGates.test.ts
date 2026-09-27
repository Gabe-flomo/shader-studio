/**
 * Free vs Pro on Play (play/planGates.ts), and that Free can't reach a few
 * representative Pro paths: layers and Pro sources don't play, takes don't
 * open, node packs aren't made. Nothing in the saved record is changed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { emptyPlayRecord, type PlayLayer, type PlayMapping, type PlayRecord, type PlaySource } from '../../types/play';
import { playableForPlan, proOnlyParts, sourceNeedsPro, sourceTypeNeedsPro, triggerNeedsPro } from '../planGates';
import { closeProSheet, usePlan, useProSheet } from '../../lib/plan';
import { useTakes } from '../../lib/takes';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

const free = () => usePlan.getState().setSession({ status: 'signed-in', user: 'free-test', plan: 'free', source: 'gate' });
afterEach(() => {
  usePlan.getState().setSession({ status: 'signed-in', user: '', plan: 'pro', source: 'open' });
  closeProSheet();
});

let n = 0;
const mapping = (source: PlaySource): PlayMapping => ({ id: `m${++n}`, controlId: 'c', source, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true });

function proSetup(): PlayRecord {
  return {
    ...emptyPlayRecord(),
    controls: [{ id: 'c', label: 'Speed', target: 'n::speed', kind: 'float', min: 0, max: 1 } as PlayRecord['controls'][number]],
    mappings: [
      mapping({ kind: 'mouse', axis: 'x' }),
      mapping({ kind: 'key', code: 'KeyA' }),
      mapping({ kind: 'live', band: 'bass', gain: 1 }),
      mapping({ kind: 'reader', readerId: 'r1' }),
      mapping({ kind: 'midi', signal: 'cc', channel: 0, cc: 1 }),
      mapping({ kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }),
      mapping({ kind: 'hand', side: 'any', read: 'pinch', point: 8, axis: 'x', gesture: 'pinch' }),
      mapping({ kind: 'trigger', trigger: { on: 'key', code: 'Space' }, mode: 'envelope', attack: 0, decay: 0.2, sustain: 0, release: 0.2, steps: 4, velocity: false }),
      mapping({ kind: 'trigger', trigger: { on: 'note', channel: 0, note: 60 }, mode: 'envelope', attack: 0, decay: 0.2, sustain: 0, release: 0.2, steps: 4, velocity: false }),
    ],
    layers: [{ id: 'l1', kind: 'shape', label: 'Box', visible: true } as unknown as PlayLayer],
    actions: [{ id: 'a1', enabled: true, trigger: { on: 'key', code: 'KeyB' }, do: 'burst', layerId: 'l1', amount: 60 } as unknown as NonNullable<PlayRecord['actions']>[number]],
    display: { picture: false, backdrop: [0, 0, 0], source: 'colour' },
  };
}

describe('which sources are Free', () => {
  it('mouse, keys, audio and other controls are Free; MIDI, LFOs, hands and the rest are Pro', () => {
    expect(sourceNeedsPro({ kind: 'mouse', axis: 'down' })).toBe(false);
    expect(sourceNeedsPro({ kind: 'key', code: 'KeyA' })).toBe(false);
    expect(sourceNeedsPro({ kind: 'live', band: 'level', gain: 1 })).toBe(false);
    expect(sourceNeedsPro({ kind: 'reader', readerId: 'x' })).toBe(false);
    expect(sourceNeedsPro({ kind: 'audio', nodeId: 'a', band: 0 })).toBe(false);
    expect(sourceNeedsPro({ kind: 'control', controlId: 'c' })).toBe(false);
    expect(sourceNeedsPro({ kind: 'midi', signal: 'note', channel: 0 })).toBe(true);
    expect(sourceNeedsPro({ kind: 'osc', address: '/a', arg: 0, min: 0, max: 1 })).toBe(true);
    expect(sourceNeedsPro({ kind: 'noise', type: 'smooth', rate: 1, seed: 1, steps: 0 })).toBe(true);
    expect(sourceNeedsPro({ kind: 'tilt', axis: 'beta' })).toBe(true);
  });
  it('triggers are Free when a key, a click or audio fires them', () => {
    expect(triggerNeedsPro({ on: 'key', code: 'KeyA' })).toBe(false);
    expect(triggerNeedsPro({ on: 'mouse' })).toBe(false);
    expect(triggerNeedsPro({ on: 'audio', band: 'bass', threshold: 0.5 })).toBe(false);
    expect(triggerNeedsPro({ on: 'reader', readerId: 'r', threshold: 0.5, hysteresis: 0.1 })).toBe(false);
    expect(triggerNeedsPro({ on: 'beat', bpm: 120, beats: 1 })).toBe(true);
    expect(triggerNeedsPro({ on: 'hand', side: 'any', gesture: 'fist' })).toBe(true);
  });
  it('marks the drop-down’s Pro entries', () => {
    for (const t of ['mouse:x', 'mouse:down', 'key', 'control', 'live', 'audio', 'trigger', 'reader:abc', 'readers:open']) expect(sourceTypeNeedsPro(t)).toBe(false);
    for (const t of ['midi:cc', 'lfo', 'noise', 'clock', 'osc', 'gamepad', 'tilt', 'null', 'sensor', 'data', 'hand:pinch']) expect(sourceTypeNeedsPro(t)).toBe(true);
  });
});

describe('what plays on each plan', () => {
  it('Pro plays the record itself', () => {
    const r = proSetup();
    expect(playableForPlan(r, 'pro')).toBe(r);
  });

  it('Free plays no layers, actions or background, and only its own mappings; the record is untouched', () => {
    const r = proSetup();
    const before = JSON.stringify(r);
    const shown = playableForPlan(r, 'free');
    expect(shown.layers).toEqual([]);
    expect(shown.actions).toBeUndefined();
    expect(shown.display).toEqual({ picture: true, backdrop: [0, 0, 0] });
    expect(shown.mappings.map(m => m.source.kind)).toEqual(['mouse', 'key', 'live', 'reader', 'trigger']);
    expect(shown.controls).toBe(r.controls);
    expect(JSON.stringify(r)).toBe(before);
    expect(playableForPlan(r, 'free')).toBe(shown); // cached per record
  });

  it('names what needs Pro', () => {
    expect(proOnlyParts(proSetup(), 'free')).toEqual(['1 layer', '1 action', '4 mappings', 'the background']);
    expect(proOnlyParts(proSetup(), 'pro')).toEqual([]);
  });
});

describe('Free can’t reach Pro paths', () => {
  it('Record a performance opens the Pro sheet, not Record', () => {
    free();
    const dispatch = vi.fn();
    vi.stubGlobal('window', { ...(globalThis.window ?? {}), dispatchEvent: dispatch, addEventListener: () => {}, removeEventListener: () => {} });
    useTakes.getState().openPerformance();
    useTakes.getState().renderTake('some-take');
    expect(dispatch).not.toHaveBeenCalled();
    expect(useProSheet.getState()).toEqual({ open: true, feature: 'play.takes' });
    vi.unstubAllGlobals();
  });

  it('exporting nodes (making a pack) is refused and nothing is written', async () => {
    free();
    const r = await useNodeGraphStore.getState().exportUserNodes();
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.cancelled).toBe(true);
    expect(useProSheet.getState().feature).toBe('nodes.pack');
  });
});
