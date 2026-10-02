/**
 * Behaviours (implementation guide, phase 9): the starter set fills its slots
 * and lands as ordinary rules and sources that play; a rule saved as a
 * behaviour comes back in another setup.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { BUILT_IN_BEHAVIOURS, applyBehaviour, behaviourFromRule, loadBehaviours, missingFor, saveBehaviour, slotChoices, type ListKV } from '../behaviours';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type PlayLayer, type PlayRecord } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); inputBus.setParamBindings({}); });

const sparks = { ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' } as PlayLayer;
const words = defaultLayer('text', 'w', 'Words') as PlayLayer;
const base = (): PlayRecord => ({ ...emptyPlayRecord(), layers: [sparks, words], controls: [{ id: 'r', target: 'n::r', kind: 'float', label: 'Radius', min: 0, max: 10 }] });
const byId = (id: string) => BUILT_IN_BEHAVIOURS.find(b => b.id === id)!;

describe('the starter set', () => {
  it('every one fills from a setup that has what it needs, and survives the file', () => {
    for (const b of BUILT_IN_BEHAVIOURS) {
      expect(missingFor(base(), b)).toBeNull();
      const fill = Object.fromEntries(b.slots.map(s => [s.key, slotChoices(base(), s)[0].id]));
      const r = applyBehaviour(base(), b, fill);
      const back = parsePlayRecord(JSON.parse(JSON.stringify({ ...r.play, version: 1 })));
      expect(back?.signals?.length ?? 0).toBe(b.rules.length);
      expect(back?.sources?.length ?? 0).toBe(b.sources.length);
      expect(JSON.stringify(r.play)).not.toContain('$slot');
    }
    expect(missingFor({ ...base(), controls: [] }, byId('b_wander'))).toMatch(/slider/);
    expect(slotChoices(base(), byId('b_kick_text').slots[0]).map(c => c.id)).toEqual(['w']);
  });

  it('Pinch to burst makes a rule bursting the layer; Every bar takes the layer’s first action', () => {
    const r = applyBehaviour(base(), byId('b_pinch_burst'), { layer: 'p' });
    expect(r.play.signals).toEqual([expect.objectContaining({ id: 'rule_1', inputs: [{ kind: 'trigger', trigger: { on: 'hand', side: 'right', gesture: 'pinch' } }], do: [expect.objectContaining({ do: 'burst', layerId: 'p', amount: 60 })] })]);
    const bar = applyBehaviour(r.play, byId('b_every_bar'), { layer: 'w' });
    expect(bar.ruleIds).toEqual(['rule_2']);
    expect(bar.play.signals![1].do![0]).toMatchObject({ do: 'next', layerId: 'w' });
  });

  it('Mouse moves it routes the mouse over the slider’s range and plays', () => {
    const r = applyBehaviour(base(), byId('b_mouse_moves'), { control: 'r' });
    expect(r.play.sources![0].outputs[0].routes[0]).toMatchObject({ to: 'r', mode: 'replace', outMin: 0, outMax: 10 });
    const swing = applyBehaviour(base(), byId('b_wander'), { control: 'r' });
    expect(swing.play.sources![0].outputs[0].routes[0]).toMatchObject({ mode: 'add', outMin: -5, outMax: 5 });
    inputBus.setParamBindings({ 'n::r': 'u_r' });
    playEngine.setRecord(r.play);
    inputBus.tick(1 / 60, 2);
    expect(typeof playEngine.liveValue('r')).toBe('number');
  });
});

describe('your own', () => {
  it('a rule saved as a behaviour keeps its layers and sliders as slots, and comes back elsewhere', () => {
    const p: PlayRecord = { ...base(), signals: [
      { id: 'x', name: 'Other' },
      { id: 'mine', name: 'Big and loud', inputs: [{ kind: 'trigger', trigger: { on: 'value', value: 'ctl:r', cmp: 'above', threshold: 5, hysteresis: 0, tolerance: 0 } }, { kind: 'signal', signal: 'x', as: 'mirror' }], do: [{ id: 'd', do: 'burst', layerId: 'p', amount: 9, enabled: true }] },
    ] };
    const { behaviour, left } = behaviourFromRule(p, 'mine', 'Loud burst');
    expect(left).toEqual(['listening to Other']);
    expect(behaviour!.slots).toEqual([{ key: 'control1', kind: 'control', label: 'Radius' }, { key: 'layer2', kind: 'layer', label: 'Sparks', layerKinds: ['particles'] }]);
    const store: Record<string, string> = {};
    const kv: ListKV = { get: k => store[k] ?? null, set: (k, v) => { store[k] = v; } };
    saveBehaviour(behaviour!, kv);
    const [again] = loadBehaviours(kv);
    const other: PlayRecord = { ...emptyPlayRecord(), layers: [{ ...sparks, id: 'p2' }], controls: [{ id: 'k', target: 'n::k', kind: 'float', label: 'K', min: 0, max: 1 }] };
    const r = applyBehaviour(other, again, { control1: 'k', layer2: 'p2' });
    expect(r.play.signals![0]).toMatchObject({ name: 'Big and loud', inputs: [{ kind: 'trigger', trigger: { value: 'ctl:k' } }], do: [{ do: 'burst', layerId: 'p2', amount: 9 }] });
  });
});

describe('removing what rules use', () => {
  it('removing a layer takes the reactions on it and the inputs watching it; the rule stays', async () => {
    const { removeLayer } = await import('../../components/play/layerOps');
    const p: PlayRecord = { ...base(), signals: [{ id: 'r', name: 'R', inputs: [{ kind: 'trigger', trigger: { on: 'zone', layerId: 'p', event: 'click', threshold: 0.5 } }, { kind: 'trigger', trigger: { on: 'key', code: 'KeyA' } }], do: [{ id: 'a', do: 'burst', layerId: 'p', amount: 1, enabled: true }, { id: 'b', do: 'next', layerId: 'w', amount: 1, enabled: true }] }] };
    const out = removeLayer(p, 'p');
    expect(out.signals).toEqual([{ id: 'r', name: 'R', inputs: [{ kind: 'trigger', trigger: { on: 'key', code: 'KeyA' } }], do: [{ id: 'b', do: 'next', layerId: 'w', amount: 1, enabled: true }] }]);
  });
});
